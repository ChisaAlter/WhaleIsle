package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.IceServerConfig
import ai.deepseek.harness.mobile.pair.LanOffer
import ai.deepseek.harness.mobile.pair.Offer
import ai.deepseek.harness.mobile.pair.RelayOffer
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okio.ByteString
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

@Serializable data class SavedComputer(
    val serverId: String,
    val deviceId: String,
    val deviceSecret: String,
    val daemonPublicKeyB64: String,
    val relayEndpoint: String = "",
    val relayUseTls: Boolean = false,
    val computerName: String = "我的电脑",
    val savedAt: Long = System.currentTimeMillis(),
    val lanEndpoints: List<String> = emptyList(),
    val lanUseTls: Boolean = false,
    val iceServers: List<IceServerConfig> = emptyList(),
) {
    fun offer() = Offer(
        v = 2,
        serverId = serverId,
        daemonPublicKeyB64 = daemonPublicKeyB64,
        relay = relayEndpoint.takeIf { it.isNotBlank() }?.let { RelayOffer(it, relayUseTls) },
        authBootstrap = null,
        lan = lanEndpoints.takeIf { it.isNotEmpty() }?.let { LanOffer(it, lanUseTls) },
        iceServers = iceServers,
    )
}

class RelayAuthenticationException(message: String) : IllegalArgumentException(message)

/** One authenticated connection. Reconnects explicitly reuse a saved secret, never an offer token. */
open class RelayClient(
    private val offer: Offer,
    saved: SavedComputer?,
    private val deviceName: String,
    private val persist: (SavedComputer) -> Unit,
    private val onMux: (JsonObject) -> Unit,
    private val onComputerName: (String) -> Unit,
    private val http: OkHttpClient = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build(),
    private val webRtcPeerFactory: WebRtcPeerFactory? = null,
    private val extraIceServers: List<IceServerConfig> = emptyList(),
    private val lanConnectTimeoutMs: Long = 2_500L,
) : WebSocketListener() {
    private val crypto = RelayCrypto(offer.daemonPublicKeyB64)
    private var deviceId = saved?.deviceId ?: "dev_${UUID.randomUUID().toString().replace("-", "")}"
    private var secret = saved?.deviceSecret.orEmpty()
    private var name = saved?.computerName ?: "我的电脑"
    @Volatile private var socket: WebSocket? = null
    @Volatile private var retiredRelaySocket: WebSocket? = null
    private val ready = CompletableDeferred<Unit>()
    private val ended = CompletableDeferred<Throwable>()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JsonElement>>()
    private val _status = MutableStateFlow("未连接")
    open val status = _status.asStateFlow()
    private val _transportMode = MutableStateFlow<TransportMode?>(null)
    open val transportMode: StateFlow<TransportMode?> = _transportMode.asStateFlow()
    @Volatile open var connected = false
        protected set
    @Volatile private var disposed = false
    private var authenticated = false
    private var serverInfo = false
    @Volatile private var helloSent = false
    @Volatile private var transportOpen = false
    private val sendLock = Any()
    private val upgradeScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var upgradeController: AdaptiveUpgradeController? = null

    open suspend fun connect() {
        check(!disposed) { "连接已关闭" }
        val bootstrap = offer.authBootstrap
        require(bootstrap == null || bootstrap.expiresAtMs > System.currentTimeMillis()) { "配对码已过期，请在电脑端刷新后重新扫码" }
        require(bootstrap != null || secret.isNotEmpty()) { "需要扫码配对" }
        val lanOffer = offer.lan?.takeIf { it.endpoints.isNotEmpty() }
        val relayOffer = offer.relay?.takeIf { it.endpoint.isNotBlank() }
        require(lanOffer != null || relayOffer != null) { "缺少可用的电脑连接地址" }

        var connectedViaLan = false
        if (lanOffer != null) {
            _status.value = "正在直连局域网…"
            connectedViaLan = tryConnectLan(lanOffer)
        }

        if (!connectedViaLan) {
            if (relayOffer == null) {
                val err = IllegalStateException("局域网直连失败，请确认手机与电脑在同一局域网")
                fail(err)
                close()
                throw err
            }
            val url = buildWsUrl(relayOffer.endpoint, relayOffer.useTls)
            _status.value = "正在连接电脑…"
            _transportMode.value = TransportMode.RELAY
            socket = http.newWebSocket(Request.Builder().url(url).build(), this)
        }

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

    private fun buildWsUrl(endpoint: String, useTls: Boolean): HttpUrl {
        val base = "${if (useTls) "https" else "http"}://$endpoint/ws".toHttpUrl()
        require(base.username.isEmpty() && base.password.isEmpty()) { "中继地址不可包含凭据" }
        return base.newBuilder()
            .addQueryParameter("serverId", offer.serverId)
            .addQueryParameter("role", "client")
            .addQueryParameter("v", "2")
            .build()
    }

    private suspend fun tryConnectLan(lanOffer: LanOffer): Boolean {
        val urls = lanOffer.endpoints.mapNotNull { endpoint ->
            runCatching { buildWsUrl(endpoint, lanOffer.useTls) }.getOrNull()
        }
        if (urls.isEmpty()) return false

        val won = AtomicBoolean(false)
        val remaining = AtomicInteger(urls.size)
        val result = CompletableDeferred<Boolean>()
        val probeSockets = ConcurrentHashMap.newKeySet<WebSocket>()

        for (url in urls) {
            val probeListener = object : WebSocketListener() {
                @Volatile var isWinner = false

                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (!disposed && !ended.isCompleted && won.compareAndSet(false, true)) {
                        isWinner = true
                        _transportMode.value = TransportMode.LAN
                        this@RelayClient.onOpen(webSocket, response)
                        result.complete(true)
                        // Cancel all losing LAN probe sockets immediately.
                        for (other in probeSockets) {
                            if (other !== webSocket) runCatching { other.cancel() }
                        }
                    } else {
                        runCatching { webSocket.close(1000, "lan_race_lost") }
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (isWinner) this@RelayClient.onMessage(webSocket, text)
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    if (isWinner) this@RelayClient.onMessage(webSocket, bytes)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    if (isWinner) this@RelayClient.onClosing(webSocket, code, reason)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (isWinner) this@RelayClient.onClosed(webSocket, code, reason)
                    else if (remaining.decrementAndGet() == 0 && !won.get()) result.complete(false)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (isWinner) this@RelayClient.onFailure(webSocket, t, response)
                    else if (remaining.decrementAndGet() == 0 && !won.get()) result.complete(false)
                }
            }
            val ws = http.newWebSocket(Request.Builder().url(url).build(), probeListener)
            probeSockets.add(ws)
        }

        val succeeded = withTimeoutOrNull(lanConnectTimeoutMs) { result.await() } == true
        if (!succeeded) {
            // Prevent any slow LAN probe from winning after timeout.
            if (won.compareAndSet(false, true)) {
                for (ws in probeSockets) {
                    runCatching { ws.cancel() }
                }
            } else {
                // Won right at the timeout boundary; keep the winning LAN connection.
                return true
            }
        }
        return succeeded
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        if (disposed || ended.isCompleted) { webSocket.close(1000, "Client closed"); return }
        socket = webSocket
        transportOpen = true
        webSocket.send(keyHandshake())
    }
    override fun onMessage(webSocket: WebSocket, bytes: ByteString) = onMessage(webSocket, bytes.utf8())
    override fun onMessage(webSocket: WebSocket, text: String) {
        if (disposed || ended.isCompleted) return
        if (retiredRelaySocket != null && webSocket === retiredRelaySocket) return
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
            val controller = upgradeController
            if (controller != null) {
                controller.onRelayEncryptedFrame(text)
            } else {
                handleDecryptedPlaintext(crypto.decrypt(text))
            }
        } catch (error: Throwable) { fail(error); webSocket.close(4001, "Protocol error") }
    }

    private fun handleDecryptedPlaintext(plaintext: String) {
        if (disposed || ended.isCompleted) return
        val wire = Json.parseToJsonElement(plaintext).objectValue()
        val frame = if (wire.string("type") == "session") wire["message"].objectValue() else wire
        val payload = frame["payload"].objectValue()
        when (frame.string("type")) {
            "relay_device_auth_result" -> {
                if (!frame["ok"].flag()) throw RelayAuthenticationException("配对授权已失效，请重新扫码")
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
            "rtc_upgrade_answer", "rtc_upgrade_ice", "rtc_upgrade_activated", "rtc_upgrade_abort" -> {
                if (!authenticated) return
                upgradeController?.onSignalingFrame(frame)
            }
            "error" -> error(frame.string("message").ifBlank { "电脑连接失败" })
        }
    }

    private fun save() = persist(
        SavedComputer(
            serverId = offer.serverId,
            deviceId = deviceId,
            deviceSecret = secret,
            daemonPublicKeyB64 = offer.daemonPublicKeyB64,
            relayEndpoint = offer.relay?.endpoint.orEmpty(),
            relayUseTls = offer.relay?.useTls ?: false,
            computerName = name,
            lanEndpoints = offer.lan?.endpoints.orEmpty(),
            lanUseTls = offer.lan?.useTls ?: false,
            iceServers = offer.iceServers,
        ),
    )
    private fun keyHandshake() = obj("type" to "e2ee_hello", "key" to crypto.publicKeyB64).toString()
    private fun finishConnect() {
        if (!authenticated || !serverInfo) return
        connected = true
        _status.value = "已连接"
        ready.complete(Unit)
        maybeStartWebRtcUpgrade()
    }

    private fun maybeStartWebRtcUpgrade() {
        val factory = webRtcPeerFactory ?: return
        if (disposed || ended.isCompleted) return
        if (_transportMode.value != TransportMode.RELAY) return
        if (upgradeController != null) return
        val mergedIce = (extraIceServers + offer.iceServers).distinct()
        val controller = AdaptiveUpgradeController(
            scope = upgradeScope,
            crypto = crypto,
            peerFactory = factory,
            iceServers = mergedIce,
            sendRelayEncrypted = { encrypted ->
                synchronized(sendLock) {
                    socket?.send(encrypted) == true
                }
            },
            closeDrainedRelay = { code, reason ->
                val drained = synchronized(sendLock) {
                    val current = socket
                    if (current != null) {
                        retiredRelaySocket = current
                        socket = null
                    }
                    current
                }
                runCatching { drained?.close(code, reason) }
            },
            onDecryptedPlaintext = { plaintext -> handleDecryptedPlaintext(plaintext) },
            onModeChanged = { mode -> _transportMode.value = mode },
            onFatalError = { error -> fail(error) },
        )
        upgradeController = controller
        controller.startUpgrade()
    }

    private fun send(frame: JsonObject) {
        val controller = upgradeController
        if (controller != null) {
            controller.sendAppFrame(frame)
        } else {
            synchronized(sendLock) {
                check(socket?.send(crypto.encrypt(frame.toString())) == true) { "连接已断开" }
            }
        }
    }
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
    open suspend fun host(method: String, payload: JsonObject = obj()): JsonElement =
        rpc("dshd.host.rpc.request", obj("method" to method, "payload" to payload),
            if (method == "pluginManager.installBundle" || method == "pluginManager.removeBundle" || method == "pluginManager.waitForInstall") 720_000 else 30_000)
    open suspend fun git(action: String, cwd: String, payload: JsonObject = obj()): JsonElement =
        rpc("dshd.git.rpc.request", obj("action" to action, "cwd" to cwd, "payload" to payload), 120_000)
    open fun subscribe() = sendSession(obj("type" to "dshd.host.mux.subscribe", "requestId" to UUID.randomUUID().toString()))
    open suspend fun awaitDisconnect(): Throwable = ended.await()
    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        if (retiredRelaySocket != null && webSocket === retiredRelaySocket) return
        fail(t)
    }
    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        if (retiredRelaySocket != null && webSocket === retiredRelaySocket) return
        fail(closeError(code, reason))
    }
    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        if (retiredRelaySocket != null && webSocket === retiredRelaySocket) {
            webSocket.close(code, reason)
            return
        }
        fail(closeError(code, reason)); webSocket.close(code, reason)
    }
    private fun closeError(code: Int, reason: String): Throwable = if (code == 4401)
        RelayAuthenticationException("配对授权已失效，请重新扫码") else IllegalStateException(reason.ifBlank { "连接已断开，草稿已保留" })
    @Synchronized private fun fail(error: Throwable) {
        if (ended.isCompleted) return
        connected = false
        transportOpen = false
        _status.value = error.message ?: "连接失败"
        ready.completeExceptionally(error)
        pending.values.forEach { it.completeExceptionally(error) }
        pending.clear()
        ended.complete(error)
    }
    open fun close() {
        disposed = true
        upgradeController?.close()
        upgradeController = null
        upgradeScope.cancel()
        fail(CancellationException("连接已关闭"))
        socket?.close(1000, "Client closed")
        socket = null
        retiredRelaySocket = null
        http.dispatcher.executorService.shutdown()
        http.connectionPool.evictAll()
    }
}
fun errorText(value: JsonElement?): String = value.objectValue().string("message").ifBlank { value.text().ifBlank { "电脑没有响应" } }
