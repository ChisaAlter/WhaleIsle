package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.Offer
import ai.deepseek.harness.mobile.pair.RelayOffer
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okio.ByteString
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

@Serializable data class SavedComputer(
    val serverId: String, val deviceId: String, val deviceSecret: String,
    val daemonPublicKeyB64: String, val relayEndpoint: String, val relayUseTls: Boolean,
    val computerName: String = "我的电脑", val savedAt: Long = System.currentTimeMillis(),
) {
    fun offer() = Offer(2, serverId, daemonPublicKeyB64, RelayOffer(relayEndpoint, relayUseTls), null)
}

/** One authenticated connection. Reconnects explicitly reuse a saved secret, never an offer token. */
class RelayClient(
    private val offer: Offer,
    saved: SavedComputer?,
    private val deviceName: String,
    private val persist: (SavedComputer) -> Unit,
    private val onMux: (JsonObject) -> Unit,
    private val onComputerName: (String) -> Unit,
    private val http: OkHttpClient = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build(),
) : WebSocketListener() {
    private val crypto = RelayCrypto(offer.daemonPublicKeyB64)
    private var deviceId = saved?.deviceId ?: "dev_${UUID.randomUUID().toString().replace("-", "")}"
    private var secret = saved?.deviceSecret.orEmpty()
    private var name = saved?.computerName ?: "我的电脑"
    private var socket: WebSocket? = null
    private val ready = CompletableDeferred<Unit>()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JsonElement>>()
    private val _status = MutableStateFlow("未连接")
    val status = _status.asStateFlow()
    @Volatile var connected = false
        private set
    private var authenticated = false
    private var serverInfo = false
    @Volatile private var helloSent = false
    @Volatile private var transportOpen = false

    suspend fun connect() {
        val bootstrap = offer.authBootstrap
        require(bootstrap == null || bootstrap.expiresAtMs > System.currentTimeMillis()) { "配对码已过期，请在电脑端刷新后重新扫码" }
        require(bootstrap != null || secret.isNotEmpty()) { "需要扫码配对" }
        val base = "${if (offer.relay.useTls) "https" else "http"}://${offer.relay.endpoint}/ws".toHttpUrl()
        require(base.username.isEmpty() && base.password.isEmpty()) { "中继地址不可包含凭据" }
        val url = base.newBuilder().addQueryParameter("serverId", offer.serverId)
            .addQueryParameter("role", "client").addQueryParameter("v", "2").build()
        _status.value = "正在连接电脑…"
        socket = http.newWebSocket(Request.Builder().url(url).build(), this)
        try {
            coroutineScope {
                // The relay creates the daemon data socket after accepting the client.
                // Match createClientChannel: repeat only the plaintext key handshake until ready.
                val handshake = launch {
                    while (isActive) {
                        delay(1_000)
                        if (transportOpen && !helloSent) socket?.send(keyHandshake())
                    }
                }
                try { withTimeout(30_000) { ready.await() } } finally { handshake.cancel() }
            }
        } catch (error: Throwable) { close(); throw error }
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        socket = webSocket
        transportOpen = true
        webSocket.send(keyHandshake())
    }
    override fun onMessage(webSocket: WebSocket, bytes: ByteString) = onMessage(webSocket, bytes.utf8())
    override fun onMessage(webSocket: WebSocket, text: String) {
        try {
            if (text.startsWith("{")) {
                val frame = Json.parseToJsonElement(text).objectValue()
                require(frame.string("type") == "e2ee_ready") { "拒绝未加密的消息" }
                if (!helloSent) {
                    helloSent = true
                    val challenge = frame.string("authChallenge")
                    require(challenge.isNotBlank()) { "电脑未提供安全认证挑战" }
                    val binding = mutableMapOf<String, JsonElement>(
                        "version" to JsonPrimitive(1), "deviceId" to JsonPrimitive(deviceId),
                        "deviceName" to JsonPrimitive(deviceName), "clientPublicKeyB64" to JsonPrimitive(crypto.publicKeyB64),
                        "challenge" to JsonPrimitive(challenge),
                    )
                    if (offer.authBootstrap != null) binding["pairingToken"] = JsonPrimitive(offer.authBootstrap.pairingToken)
                    else binding["proof"] = JsonPrimitive(crypto.proof(secret, offer.serverId, offer.daemonPublicKeyB64, deviceId, challenge))
                    send(obj("type" to "hello", "clientId" to "android-$deviceId", "clientType" to "mobile",
                        "protocolVersion" to 1, "relayDeviceAuth" to JsonObject(binding)))
                }
                return
            }
            val wire = Json.parseToJsonElement(crypto.decrypt(text)).objectValue()
            val frame = if (wire.string("type") == "session") wire["message"].objectValue() else wire
            val payload = frame["payload"].objectValue()
            when (frame.string("type")) {
                "relay_device_auth_result" -> {
                    require(frame["ok"].flag()) { "配对授权已失效，请重新扫码" }
                    if (frame.string("deviceId").isNotEmpty()) deviceId = frame.string("deviceId")
                    if (frame.string("deviceSecret").isNotEmpty()) secret = frame.string("deviceSecret")
                    require(secret.isNotEmpty()) { "电脑未返回设备凭据" }
                    authenticated = true
                    save()
                    finishConnect()
                }
                "status" -> if (payload.string("status") == "server_info") {
                    // Saved-secret hellos receive server_info after proof validation,
                    // without a separate auth-result frame (only first pairing issues it).
                    if (offer.authBootstrap == null && secret.isNotEmpty()) authenticated = true
                    name = payload.string("hostname").ifBlank { name }
                    serverInfo = true
                    onComputerName(name)
                    if (authenticated) save()
                    finishConnect()
                }
                "dshd.host.rpc.response", "dshd.git.rpc.response" -> {
                    val request = pending.remove(payload.string("requestId")) ?: return
                    if (!payload["ok"].flag()) request.completeExceptionally(IllegalStateException(errorText(payload["error"])))
                    else {
                        val value = payload["value"] ?: JsonNull
                        if (value is JsonObject && value["ok"] is JsonPrimitive && !value["ok"].flag()) {
                            request.completeExceptionally(IllegalStateException(value.string("message").ifBlank { errorText(value["error"]) }))
                        } else request.complete(value)
                    }
                }
                "dshd.host.mux.frame" -> onMux(payload)
                "error" -> error(frame.string("message").ifBlank { "电脑连接失败" })
            }
        } catch (error: Throwable) { fail(error); webSocket.close(4001, "Protocol error") }
    }
    private fun save() = persist(SavedComputer(offer.serverId, deviceId, secret, offer.daemonPublicKeyB64,
        offer.relay.endpoint, offer.relay.useTls, name))
    private fun keyHandshake() = obj("type" to "e2ee_hello", "key" to crypto.publicKeyB64).toString()
    private fun finishConnect() {
        if (!authenticated || !serverInfo) return
        connected = true
        _status.value = "已连接"
        ready.complete(Unit)
    }
    private fun send(frame: JsonObject) { check(socket?.send(crypto.encrypt(frame.toString())) == true) { "连接已断开" } }
    private fun sendSession(frame: JsonObject) = send(obj("type" to "session", "message" to frame))
    private suspend fun rpc(type: String, fields: JsonObject, timeout: Long): JsonElement {
        check(connected) { "连接已断开，草稿已保留" }
        val id = UUID.randomUUID().toString()
        val answer = CompletableDeferred<JsonElement>()
        pending[id] = answer
        try {
            sendSession(JsonObject(fields + mapOf("type" to JsonPrimitive(type), "requestId" to JsonPrimitive(id))))
            return withTimeout(timeout) { answer.await() }
        } finally { pending.remove(id) }
    }
    suspend fun host(method: String, payload: JsonObject = obj()): JsonElement =
        rpc("dshd.host.rpc.request", obj("method" to method, "payload" to payload), 30_000)
    suspend fun git(action: String, cwd: String, payload: JsonObject = obj()): JsonElement =
        rpc("dshd.git.rpc.request", obj("action" to action, "cwd" to cwd, "payload" to payload), 120_000)
    fun subscribe() = sendSession(obj("type" to "dshd.host.mux.subscribe", "requestId" to UUID.randomUUID().toString()))
    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = fail(t)
    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = fail(IllegalStateException(reason.ifBlank { "连接已断开，草稿已保留" }))
    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
    private fun fail(error: Throwable) {
        connected = false
        transportOpen = false
        _status.value = error.message ?: "连接失败"
        ready.completeExceptionally(error)
        pending.values.forEach { it.completeExceptionally(error) }
        pending.clear()
    }
    fun close() {
        fail(CancellationException("连接已关闭"))
        socket?.close(1000, "Client closed")
        socket = null
        http.dispatcher.executorService.shutdown()
        http.connectionPool.evictAll()
    }
}
fun errorText(value: JsonElement?): String = value.objectValue().string("message").ifBlank { value.text().ifBlank { "电脑没有响应" } }
