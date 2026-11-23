package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.pair.AuthBootstrap
import ai.deepseek.harness.mobile.pair.IceServerConfig
import ai.deepseek.harness.mobile.pair.LanOffer
import ai.deepseek.harness.mobile.pair.Offer
import ai.deepseek.harness.mobile.pair.RelayOffer
import ai.deepseek.harness.mobile.remote.RelayClient
import ai.deepseek.harness.mobile.remote.SavedComputer
import ai.deepseek.harness.mobile.remote.TransportMode
import ai.deepseek.harness.mobile.remote.number
import ai.deepseek.harness.mobile.remote.obj
import ai.deepseek.harness.mobile.remote.objectValue
import ai.deepseek.harness.mobile.remote.string
import ai.deepseek.harness.mobile.webrtc.AndroidWebRtcPeerFactory
import android.app.Instrumentation
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Opt-in real-device WebRTC P2P + zero-server LAN interop instrumentation.
 *
 * Gated by `-e hostControlUrl http://<host>:<controlPort>` so default instrumentation runs
 * skip cleanly when no live `werift-device-host.mjs` server is attached.
 *
 * Exercises REAL `AndroidWebRtcPeerFactory` (`org.webrtc.PeerConnectionFactory` / native
 * `libjingle_peerconnection_so.so`) and REAL `RelayClient` against a live Windows Host running
 * `@chisacode/server` (`lan-e2ee-transport.ts`, `relay-transport.ts`, `webrtc-host.ts` + `werift`).
 */
class WebRtcDeviceInteropInstrumentation : Instrumentation() {
    private var hostControlUrl: String = ""
    private var hostAddressOverride: String = ""
    private var lanEndpointOverride: String = ""
    private var relayEndpointOverride: String = ""
    private var fallbackEndpointOverride: String = ""
    private var upgradeTimeoutMs: Long = 15_000L
    private var allowTurn: Boolean = false
    private var selectedCases: Set<Int> = setOf(1, 2, 3, 4)

    override fun onCreate(arguments: Bundle?) {
        hostControlUrl = arguments?.getString("hostControlUrl").orEmpty().trim().trimEnd('/')
        hostAddressOverride = arguments?.getString("hostAddress").orEmpty().trim()
        lanEndpointOverride = arguments?.getString("lanEndpoint").orEmpty().trim()
        relayEndpointOverride = arguments?.getString("relayEndpoint").orEmpty().trim()
        fallbackEndpointOverride = arguments?.getString("fallbackEndpoint").orEmpty().trim()
        arguments?.getString("upgradeTimeoutMs")?.toLongOrNull()?.let { if (it > 0) upgradeTimeoutMs = it }
        allowTurn = arguments?.getString("allowTurn") == "true"
        arguments?.getString("cases")?.takeIf { it.isNotBlank() }?.let { raw ->
            selectedCases = raw.split(",").mapNotNull { it.trim().toIntOrNull() }.toSet()
        }
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        val result = Bundle()
        if (hostControlUrl.isBlank()) {
            result.putString(
                "stream",
                "SKIP: hostControlUrl instrumentation arg not provided; skipping live device WebRTC interop\n",
            )
            finish(-1, result)
            return
        }

        val http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()

        val report = StringBuilder()
        try {
            runBlocking {
                val info = fetchJson(http, "$hostControlUrl/info")
                val serverId = info.string("serverId")
                val daemonPublicKeyB64 = info.string("daemonPublicKeyB64")
                val baseHost = hostAddressOverride.ifBlank {
                    java.net.URI(hostControlUrl).host ?: "127.0.0.1"
                }
                val lanEndpoint = lanEndpointOverride.ifBlank { "$baseHost:${info.int("lanPort")}" }
                val relayEndpoint = relayEndpointOverride.ifBlank { "$baseHost:${info.int("relayPort")}" }
                val fallbackEndpoint = fallbackEndpointOverride.ifBlank { "$baseHost:${info.int("fallbackPort")}" }
                val iceServers = parseIceServers(info["iceServers"])
                val expiresAtMs = System.currentTimeMillis() + 600_000L

                Log.i(
                    TAG,
                    "Starting device interop: serverId=$serverId lan=$lanEndpoint relay=$relayEndpoint fallback=$fallbackEndpoint iceServers=${iceServers.size}",
                )
                val peerFactory = AndroidWebRtcPeerFactory(targetContext)

                // ---------------------------------------------------------------
                // Case 1: Zero-External-Server LAN Direct (/ws -> /lan-ws)
                // ---------------------------------------------------------------
                if (1 in selectedCases) {
                    val t0 = SystemClock.elapsedRealtime()
                    var persisted: SavedComputer? = null
                    val offer = Offer(
                        v = 2,
                        serverId = serverId,
                        daemonPublicKeyB64 = daemonPublicKeyB64,
                        relay = null,
                        authBootstrap = AuthBootstrap(1, info.string("lanPairingToken"), expiresAtMs),
                        lan = LanOffer(listOf(lanEndpoint), useTls = false),
                        iceServers = emptyList(),
                    )
                    val client = RelayClient(
                        offer = offer,
                        saved = null,
                        deviceName = "Android16-Device-Case1",
                        persist = { persisted = it },
                        onMux = {},
                        onComputerName = {},
                        webRtcPeerFactory = peerFactory,
                    )
                    try {
                        client.connect()
                        check(client.connected) { "Case 1: client not connected" }
                        check(client.transportMode.value == TransportMode.LAN) {
                            "Case 1: expected TransportMode.LAN, got ${client.transportMode.value}"
                        }
                        check(persisted != null && persisted!!.deviceSecret.length >= 32) {
                            "Case 1: deviceSecret not persisted"
                        }
                        val rpcStart = SystemClock.elapsedRealtime()
                        val rpcResp = client.host(
                            "device.lan.ping",
                            obj("case" to 1, "msg" to "hello-zero-server-lan"),
                        ).objectValue()
                        val rpcMs = SystemClock.elapsedRealtime() - rpcStart
                        check(rpcResp.string("method") == "device.lan.ping") {
                            "Case 1: unexpected RPC method ${rpcResp.string("method")}"
                        }
                        check(rpcResp["echo"].objectValue().string("msg") == "hello-zero-server-lan") {
                            "Case 1: RPC echo mismatch"
                        }
                        check(client.transportMode.value == TransportMode.LAN) {
                            "Case 1: transport mode drifted to ${client.transportMode.value}"
                        }
                        val totalMs = SystemClock.elapsedRealtime() - t0
                        val line = "CASE1_PASS: mode=LAN rpcMs=$rpcMs totalMs=$totalMs endpoint=$lanEndpoint"
                        Log.i(TAG, line)
                        report.appendLine(line)
                    } finally {
                        client.close()
                    }
                }

                // ---------------------------------------------------------------
                // Case 2: Real Android libwebrtc <-> Windows werift WebRTC P2P Upgrade (Initial Pairing)
                // ---------------------------------------------------------------
                var savedForCase3: SavedComputer? = null
                if (2 in selectedCases || 3 in selectedCases) {
                    val t0 = SystemClock.elapsedRealtime()
                    var persisted: SavedComputer? = null
                    val offer = Offer(
                        v = 2,
                        serverId = serverId,
                        daemonPublicKeyB64 = daemonPublicKeyB64,
                        relay = RelayOffer(relayEndpoint, useTls = false),
                        authBootstrap = AuthBootstrap(1, info.string("relayPairingToken"), expiresAtMs),
                        lan = null,
                        iceServers = iceServers,
                    )
                    val client = TrackingRelayClient(
                        offer = offer,
                        saved = null,
                        deviceName = "Android16-Device-Case2",
                        persist = { persisted = it },
                        onMux = {},
                        onComputerName = {},
                        webRtcPeerFactory = peerFactory,
                    )
                    try {
                        client.connect()
                        check(client.connected) { "Case 2: client not connected" }
                        check(persisted != null && persisted!!.deviceSecret.length >= 32) {
                            "Case 2: deviceSecret not persisted"
                        }
                        savedForCase3 = persisted

                        val upgradedMode = waitForWebRtcUpgrade(
                            label = "Case 2",
                            client = client,
                            http = http,
                            expectedConnIndex = 0,
                            timeoutMs = upgradeTimeoutMs,
                        )
                        val upgradeMs = SystemClock.elapsedRealtime() - t0

                        // Verify 72 KiB RTCH-chunked E2EE RPC round-trip AFTER Relay WS is CLOSED
                        val payload72k = "W".repeat(72 * 1024)
                        val rpcStart = SystemClock.elapsedRealtime()
                        val rpcResp = client.host(
                            "device.rtc.large72k",
                            obj("case" to 2, "blob" to payload72k),
                        ).objectValue()
                        val rpcMs = SystemClock.elapsedRealtime() - rpcStart
                        val echoedBlob = rpcResp["echo"].objectValue().string("blob")
                        check(echoedBlob == payload72k) {
                            "Case 2: 72 KiB RTCH echo mismatch (expected=${payload72k.length}, got=${echoedBlob.length})"
                        }
                        check(client.connected) { "Case 2: client disconnected during 72 KiB RPC" }
                        check(client.transportMode.value == upgradedMode) {
                            "Case 2: transportMode drifted from $upgradedMode to ${client.transportMode.value}"
                        }

                        val statsAfter = fetchJson(http, "$hostControlUrl/stats")
                        val conn0 = statsAfter["relay"].objectValue()["connections"]!!.jsonArray[0].jsonObject
                        val relayClosed = conn0["relayClosed"]?.jsonPrimitive?.booleanOrNull == true
                        val closeCode = conn0.int("relayCloseCode")
                        val closeReason = conn0.string("relayCloseReason")
                        val hostInitCode = conn0.int("hostInitiatedCloseCode")
                        val hostInitReason = conn0.string("hostInitiatedCloseReason")
                        val inboundAfter = conn0.int("relayFramesAfterUpgrade")
                        val outboundAfter = conn0.int("relayOutboundFramesAfterUpgrade")
                        val upperClosed = statsAfter["relay"].objectValue().int("upperSessionClosedCount")
                        check(relayClosed && hostInitCode == 1000 && hostInitReason == "upgraded_to_webrtc") {
                            "Case 2: expected Host Relay WS close(1000, upgraded_to_webrtc), got closed=$relayClosed hostInit=$hostInitCode/$hostInitReason peerEvent=$closeCode/$closeReason"
                        }
                        check(
                            (client.closingCode == 1000 && client.closingReason == "upgraded_to_webrtc") ||
                                (client.closedCode == 1000 && client.closedReason == "upgraded_to_webrtc"),
                        ) {
                            "Case 2: expected Android Relay WS close(1000, upgraded_to_webrtc), got closing=${client.closingCode}/${client.closingReason} closed=${client.closedCode}/${client.closedReason}"
                        }
                        check(inboundAfter == 0 && outboundAfter == 0) {
                            "Case 2: expected 0 Relay frames after upgrade, got in=$inboundAfter out=$outboundAfter"
                        }
                        check(upperClosed == 0) {
                            "Case 2: upper session unexpectedly closed ($upperClosed)"
                        }

                        val line =
                            "CASE2_PASS: mode=$upgradedMode upgradeMs=$upgradeMs rpc72kMs=$rpcMs payloadBytes=${payload72k.length} hostClose=$hostInitCode/$hostInitReason clientClose=${client.closingCode ?: client.closedCode}/${client.closingReason ?: client.closedReason} relayFramesAfter=0/0"
                        Log.i(TAG, line)
                        report.appendLine(line)
                    } finally {
                        client.close()
                        delay(300)
                    }
                }

                // ---------------------------------------------------------------
                // Case 3: Saved deviceSecret HMAC Reconnect -> WebRTC P2P Upgrade
                // ---------------------------------------------------------------
                if (3 in selectedCases) {
                    val saved = checkNotNull(savedForCase3) { "Case 3 requires Case 2 saved credentials" }
                    val t0 = SystemClock.elapsedRealtime()
                    val client = TrackingRelayClient(
                        offer = saved.offer(),
                        saved = saved,
                        deviceName = "Android16-Device-Case3",
                        persist = {},
                        onMux = {},
                        onComputerName = {},
                        webRtcPeerFactory = peerFactory,
                    )
                    try {
                        client.connect()
                        check(client.connected) { "Case 3: reconnect client not connected" }

                        val upgradedMode = waitForWebRtcUpgrade(
                            label = "Case 3",
                            client = client,
                            http = http,
                            expectedConnIndex = 1,
                            timeoutMs = upgradeTimeoutMs,
                        )
                        val upgradeMs = SystemClock.elapsedRealtime() - t0

                        val payload72k = "R".repeat(72 * 1024)
                        val rpcStart = SystemClock.elapsedRealtime()
                        val rpcResp = client.host(
                            "device.rtc.reconnect_large72k",
                            obj("case" to 3, "blob" to payload72k),
                        ).objectValue()
                        val rpcMs = SystemClock.elapsedRealtime() - rpcStart
                        val echoedBlob = rpcResp["echo"].objectValue().string("blob")
                        check(echoedBlob == payload72k) {
                            "Case 3: 72 KiB reconnect echo mismatch (got=${echoedBlob.length})"
                        }

                        val statsAfter = fetchJson(http, "$hostControlUrl/stats")
                        val conn1 = statsAfter["relay"].objectValue()["connections"]!!.jsonArray[1].jsonObject
                        val relayClosed = conn1["relayClosed"]?.jsonPrimitive?.booleanOrNull == true
                        val closeCode = conn1.int("relayCloseCode")
                        val closeReason = conn1.string("relayCloseReason")
                        val hostInitCode = conn1.int("hostInitiatedCloseCode")
                        val hostInitReason = conn1.string("hostInitiatedCloseReason")
                        val inboundAfter = conn1.int("relayFramesAfterUpgrade")
                        val outboundAfter = conn1.int("relayOutboundFramesAfterUpgrade")
                        check(relayClosed && hostInitCode == 1000 && hostInitReason == "upgraded_to_webrtc") {
                            "Case 3: expected Host Relay WS close(1000, upgraded_to_webrtc), got closed=$relayClosed hostInit=$hostInitCode/$hostInitReason peerEvent=$closeCode/$closeReason"
                        }
                        check(
                            (client.closingCode == 1000 && client.closingReason == "upgraded_to_webrtc") ||
                                (client.closedCode == 1000 && client.closedReason == "upgraded_to_webrtc"),
                        ) {
                            "Case 3: expected Android Relay WS close(1000, upgraded_to_webrtc), got closing=${client.closingCode}/${client.closingReason} closed=${client.closedCode}/${client.closedReason}"
                        }
                        check(inboundAfter == 0 && outboundAfter == 0) {
                            "Case 3: expected 0 Relay frames after reconnect upgrade, got in=$inboundAfter out=$outboundAfter"
                        }

                        val line =
                            "CASE3_PASS: mode=$upgradedMode upgradeMs=$upgradeMs rpc72kMs=$rpcMs payloadBytes=${payload72k.length} hostClose=$hostInitCode/$hostInitReason clientClose=${client.closingCode ?: client.closedCode}/${client.closingReason ?: client.closedReason} relayFramesAfter=0/0"
                        Log.i(TAG, line)
                        report.appendLine(line)
                    } finally {
                        client.close()
                        delay(300)
                    }
                }

                // ---------------------------------------------------------------
                // Case 4: WebRTC Failure -> Graceful Relay Fallback
                // ---------------------------------------------------------------
                if (4 in selectedCases) {
                    val t0 = SystemClock.elapsedRealtime()
                    val offer = Offer(
                        v = 2,
                        serverId = serverId,
                        daemonPublicKeyB64 = daemonPublicKeyB64,
                        relay = RelayOffer(fallbackEndpoint, useTls = false),
                        authBootstrap = AuthBootstrap(1, info.string("fallbackPairingToken"), expiresAtMs),
                        lan = null,
                        iceServers = iceServers,
                    )
                    val client = RelayClient(
                        offer = offer,
                        saved = null,
                        deviceName = "Android16-Device-Case4",
                        persist = {},
                        onMux = {},
                        onComputerName = {},
                        webRtcPeerFactory = peerFactory,
                    )
                    try {
                        client.connect()
                        check(client.connected) { "Case 4: client not connected" }

                        // Wait until host actually received rtc_upgrade_offer and sent rtc_upgrade_abort
                        val deadline = SystemClock.elapsedRealtime() + 10_000L
                        var abortSent = 0
                        while (SystemClock.elapsedRealtime() < deadline) {
                            val st = fetchJson(http, "$hostControlUrl/stats")
                            abortSent = st["fallback"].objectValue().int("abortSentCount")
                            if (abortSent >= 1) break
                            delay(100)
                        }
                        check(abortSent >= 1) { "Case 4: host never received rtc_upgrade_offer to abort" }
                        delay(400)

                        check(client.connected) { "Case 4: client disconnected after WebRTC abort" }
                        check(client.transportMode.value == TransportMode.RELAY) {
                            "Case 4: expected TransportMode.RELAY after abort, got ${client.transportMode.value}"
                        }

                        val payload16k = "F".repeat(16 * 1024)
                        val rpcStart = SystemClock.elapsedRealtime()
                        val rpcResp = client.host(
                            "device.fallback.rpc",
                            obj("case" to 4, "blob" to payload16k),
                        ).objectValue()
                        val rpcMs = SystemClock.elapsedRealtime() - rpcStart
                        check(rpcResp["echo"].objectValue().string("blob") == payload16k) {
                            "Case 4: fallback RPC echo mismatch"
                        }
                        check(client.connected && client.transportMode.value == TransportMode.RELAY) {
                            "Case 4: transport state degraded after fallback RPC"
                        }

                        val totalMs = SystemClock.elapsedRealtime() - t0
                        val line =
                            "CASE4_PASS: mode=RELAY abortSent=$abortSent rpc16kMs=$rpcMs totalMs=$totalMs"
                        Log.i(TAG, line)
                        report.appendLine(line)
                    } finally {
                        client.close()
                        delay(200)
                    }
                }

                val finalStats = fetchJson(http, "$hostControlUrl/stats")
                val pairs = finalStats["observedCandidatePairs"]?.toString().orEmpty()
                report.appendLine("HOST_ICE_PAIRS: $pairs")
                report.appendLine("PASS: all selected real-device WebRTC & LAN interop cases succeeded")
            }

            result.putString("stream", report.toString())
            finish(-1, result)
        } catch (error: Throwable) {
            Log.e(TAG, "Device interop failed", error)
            report.appendLine("FAIL: ${error::class.java.simpleName}: ${error.message}")
            result.putString("stream", report.toString())
            finish(0, result)
        } finally {
            http.dispatcher.executorService.shutdown()
            http.connectionPool.evictAll()
        }
    }

    private suspend fun waitForWebRtcUpgrade(
        label: String,
        client: RelayClient,
        http: OkHttpClient,
        expectedConnIndex: Int,
        timeoutMs: Long,
    ): TransportMode {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            check(client.connected) { "$label: client disconnected while awaiting WebRTC upgrade" }
            val mode = client.transportMode.value
            val upgraded = mode == TransportMode.LAN ||
                mode == TransportMode.P2P ||
                (allowTurn && mode == TransportMode.TURN)
            if (upgraded) {
                val upgradedMode = mode!!
                val stats = fetchJson(http, "$hostControlUrl/stats")
                val conns = stats["relay"].objectValue()["connections"]?.jsonArray
                val conn = conns?.getOrNull(expectedConnIndex)?.jsonObject
                val relayClosed = conn?.get("relayClosed")?.jsonPrimitive?.booleanOrNull == true
                if (relayClosed) {
                    return upgradedMode
                }
            }
            delay(100)
        }
        val finalStats = runCatching { fetchJson(http, "$hostControlUrl/stats") }.getOrNull()
        error(
            "$label: timed out after ${timeoutMs}ms waiting for WebRTC LAN/P2P upgrade + Relay WS close " +
                "(clientMode=${client.transportMode.value}, connected=${client.connected}, hostStats=$finalStats)",
        )
    }

    private fun JsonObject.int(key: String): Int = this[key].number()?.toInt() ?: 0

    private fun fetchJson(http: OkHttpClient, url: String): JsonObject {
        val req = Request.Builder().url(url).get().build()
        http.newCall(req).execute().use { resp ->
            check(resp.isSuccessful) { "HTTP ${resp.code} from $url" }
            val body = resp.body?.string().orEmpty()
            return Json.parseToJsonElement(body).objectValue()
        }
    }

    private fun parseIceServers(elem: JsonElement?): List<IceServerConfig> {
        val arr = elem as? JsonArray ?: return emptyList()
        return arr.mapNotNull { item ->
            val o = item as? JsonObject ?: return@mapNotNull null
            val urlsElem = o["urls"] ?: return@mapNotNull null
            val urls = when (urlsElem) {
                is JsonPrimitive -> listOf(urlsElem.content)
                is JsonArray -> urlsElem.mapNotNull { (it as? JsonPrimitive)?.content }
                else -> emptyList()
            }.filter { it.isNotBlank() }
            if (urls.isEmpty()) return@mapNotNull null
            IceServerConfig(
                urls = urls,
                username = o["username"]?.let { (it as? JsonPrimitive)?.content },
                credential = o["credential"]?.let { (it as? JsonPrimitive)?.content },
            )
        }
    }

    private class TrackingRelayClient(
        offer: Offer,
        saved: SavedComputer?,
        deviceName: String,
        persist: (SavedComputer) -> Unit,
        onMux: (JsonObject) -> Unit,
        onComputerName: (String) -> Unit,
        webRtcPeerFactory: AndroidWebRtcPeerFactory,
    ) : RelayClient(
        offer = offer,
        saved = saved,
        deviceName = deviceName,
        persist = persist,
        onMux = onMux,
        onComputerName = onComputerName,
        webRtcPeerFactory = webRtcPeerFactory,
    ) {
        @Volatile var closingCode: Int? = null
        @Volatile var closingReason: String? = null
        @Volatile var closedCode: Int? = null
        @Volatile var closedReason: String? = null

        override fun onClosing(webSocket: okhttp3.WebSocket, code: Int, reason: String) {
            closingCode = code
            closingReason = reason
            super.onClosing(webSocket, code, reason)
        }

        override fun onClosed(webSocket: okhttp3.WebSocket, code: Int, reason: String) {
            closedCode = code
            closedReason = reason
            super.onClosed(webSocket, code, reason)
        }
    }

    companion object {
        private const val TAG = "WebRtcDeviceInterop"
    }
}
