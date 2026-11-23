package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.AuthBootstrap
import ai.deepseek.harness.mobile.pair.IceServerConfig
import ai.deepseek.harness.mobile.pair.LanOffer
import ai.deepseek.harness.mobile.pair.Offer
import ai.deepseek.harness.mobile.pair.RelayOffer
import com.iwebpp.crypto.TweetNaclFast
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList

class AdaptiveUpgradeTest {
    /** Minimal daemon-side Curve25519 box matching RelayCrypto for pure-JVM test harnesses. */
    private class MockHostCrypto {
        val keys = TweetNaclFast.Box.keyPair()
        val publicKeyB64: String = Base64.getEncoder().encodeToString(keys.publicKey)
        private lateinit var box: TweetNaclFast.Box
        private val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        var sendSeq = 0L
            private set
        var lastReceivedSeq: Long? = null
            private set

        fun attachClient(clientPublicKeyB64: String) {
            val clientPub = Base64.getDecoder().decode(clientPublicKeyB64)
            box = TweetNaclFast.Box(clientPub, keys.secretKey)
        }

        fun encryptRawWithSeq(plaintext: String): Pair<Long, ByteArray> {
            val seq = sendSeq++
            val nonce = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN).put(salt).putLong(seq).array()
            val cipher = box.box(plaintext.toByteArray(Charsets.UTF_8), nonce)!!
            return seq to (nonce + cipher)
        }

        fun encryptBase64WithSeq(plaintext: String): Pair<Long, String> {
            val (seq, raw) = encryptRawWithSeq(plaintext)
            return seq to Base64.getEncoder().encodeToString(raw)
        }

        fun decryptRaw(bundle: ByteArray): Pair<Long, String> {
            val nonce = bundle.copyOfRange(0, 24)
            val seq = ByteBuffer.wrap(nonce, 16, 8).order(ByteOrder.LITTLE_ENDIAN).long
            val plain = box.open(bundle.copyOfRange(24, bundle.size), nonce)!!
            lastReceivedSeq = seq
            return seq to plain.toString(Charsets.UTF_8)
        }

        fun decryptBase64(b64: String): Pair<Long, String> = decryptRaw(Base64.getDecoder().decode(b64))
    }

    private class FakeDataChannel(override val label: String) : WebRtcDataChannel {
        @Volatile var currentObserver: WebRtcDataChannelObserver? = null
        val sentChunks = CopyOnWriteArrayList<ByteArray>()
        @Volatile var closed = false
        var onSendHook: ((ByteArray) -> Unit)? = null

        override fun setObserver(observer: WebRtcDataChannelObserver?) {
            this.currentObserver = observer
        }

        override fun send(bytes: ByteArray): Boolean {
            if (closed) return false
            val copy = bytes.copyOf()
            sentChunks.add(copy)
            onSendHook?.invoke(copy)
            return true
        }

        override fun bufferedAmount(): Long = 0L

        override fun close() {
            closed = true
        }

        fun simulateOpen() {
            currentObserver?.onOpen()
        }

        fun simulateMessage(bytes: ByteArray) {
            currentObserver?.onMessage(bytes)
        }

        fun simulateClose() {
            closed = true
            currentObserver?.onClose()
        }
    }

    private class FakePeerConnection(
        val iceServers: List<IceServerConfig>,
        val observer: WebRtcPeerObserver,
    ) : WebRtcPeerConnection {
        var createdChannel: FakeDataChannel? = null
        val channelCreated = CompletableDeferred<FakeDataChannel>()
        var localDescription: SessionDescriptionData? = null
        var remoteDescription: SessionDescriptionData? = null
        val addedIceCandidates = CopyOnWriteArrayList<IceCandidateData>()
        @Volatile var closed = false
        val offerCreated = CompletableDeferred<Unit>()
        val remoteDescriptionSet = CompletableDeferred<Unit>()

        override fun createDataChannel(label: String, ordered: Boolean): WebRtcDataChannel {
            return FakeDataChannel(label).also {
                createdChannel = it
                channelCreated.complete(it)
            }
        }

        override suspend fun createOffer(): SessionDescriptionData {
            return SessionDescriptionData("offer", "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=dsh\r\n")
        }

        override suspend fun setLocalDescription(sdp: SessionDescriptionData) {
            localDescription = sdp
            offerCreated.complete(Unit)
        }

        override suspend fun setRemoteDescription(sdp: SessionDescriptionData) {
            remoteDescription = sdp
            remoteDescriptionSet.complete(Unit)
        }

        override fun addIceCandidate(candidate: IceCandidateData) {
            addedIceCandidates.add(candidate)
        }

        override fun close() {
            closed = true
        }
    }

    private class FakeWebRtcPeerFactory : WebRtcPeerFactory {
        val connections = CopyOnWriteArrayList<FakePeerConnection>()
        val firstConnection = CompletableDeferred<FakePeerConnection>()

        override fun createPeerConnection(
            iceServers: List<IceServerConfig>,
            observer: WebRtcPeerObserver,
        ): WebRtcPeerConnection {
            val pc = FakePeerConnection(iceServers, observer)
            connections.add(pc)
            firstConnection.complete(pc)
            return pc
        }
    }

    @Test
    fun p2pUpgradeHandlesEarlyIceCrossLegReorderDrainsRelayAndTransfersLargeChunkedRpc() = runBlocking {
        val hostCrypto = MockHostCrypto()
        val clientCrypto = RelayCrypto(hostCrypto.publicKeyB64)
        hostCrypto.attachClient(clientCrypto.publicKeyB64)

        val peerFactory = FakeWebRtcPeerFactory()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val relaySentFrames = CopyOnWriteArrayList<Pair<Long, JsonObject>>()
        val offerReceived = CompletableDeferred<JsonObject>()
        val activateReceived = CompletableDeferred<Pair<Long, JsonObject>>()
        val relayClosed = CompletableDeferred<Pair<Int, String>>()
        val modeChanges = CopyOnWriteArrayList<TransportMode>()
        val decryptedMessages = CopyOnWriteArrayList<JsonObject>()
        val fatalError = CompletableDeferred<Throwable>()
        val hostChunkDecoder = RtcChunkDecoder()
        val hostMsgIdGen = RtcMessageIdGenerator()
        val dcAppFrameReceived = CompletableDeferred<Pair<Long, JsonObject>>()

        val controller = AdaptiveUpgradeController(
            scope = scope,
            crypto = clientCrypto,
            peerFactory = peerFactory,
            iceServers = listOf(IceServerConfig(listOf("stun:stun.cloudflare.com:3478"))),
            sendRelayEncrypted = { b64 ->
                val (seq, plain) = hostCrypto.decryptBase64(b64)
                val frame = Json.parseToJsonElement(plain).objectValue()
                relaySentFrames.add(seq to frame)
                when (frame.string("type")) {
                    "rtc_upgrade_offer" -> offerReceived.complete(frame)
                    "rtc_upgrade_activate" -> activateReceived.complete(seq to frame)
                }
                true
            },
            closeDrainedRelay = { code, reason -> relayClosed.complete(code to reason) },
            onDecryptedPlaintext = { plain ->
                val frame = Json.parseToJsonElement(plain).objectValue()
                decryptedMessages.add(frame)
                if (frame.string("type").startsWith("rtc_upgrade_")) {
                    // Routed below via controller reference
                }
            },
            onModeChanged = { mode -> modeChanges.add(mode) },
            onFatalError = { err -> fatalError.complete(err) },
        )

        // Wrap onDecryptedPlaintext to dispatch signaling frames to controller cleanly
        // Re-create with proper wiring so signaling frames hit controller.onSignalingFrame
        controller.close()
        val peerFactory2 = FakeWebRtcPeerFactory()
        val clientCrypto2 = RelayCrypto(hostCrypto.publicKeyB64)
        val hostCrypto2 = MockHostCrypto()
        hostCrypto2.attachClient(clientCrypto2.publicKeyB64)
        val clientCryptoReal = RelayCrypto(hostCrypto2.publicKeyB64)
        hostCrypto2.attachClient(clientCryptoReal.publicKeyB64)

        val relayFrames2 = CopyOnWriteArrayList<Pair<Long, JsonObject>>()
        val offerDef = CompletableDeferred<JsonObject>()
        val activateDef = CompletableDeferred<Pair<Long, JsonObject>>()
        val relayClosedDef = CompletableDeferred<Pair<Int, String>>()
        val modeDef = CompletableDeferred<TransportMode>()
        val largeRespDef = CompletableDeferred<JsonObject>()
        val earlyDcFrameDef = CompletableDeferred<JsonObject>()
        val fatalDef = CompletableDeferred<Throwable>()
        lateinit var ctrl: AdaptiveUpgradeController

        ctrl = AdaptiveUpgradeController(
            scope = scope,
            crypto = clientCryptoReal,
            peerFactory = peerFactory2,
            iceServers = listOf(IceServerConfig(listOf("stun:stun.cloudflare.com:3478"))),
            sendRelayEncrypted = { b64 ->
                val (seq, plain) = hostCrypto2.decryptBase64(b64)
                val frame = Json.parseToJsonElement(plain).objectValue()
                relayFrames2.add(seq to frame)
                when (frame.string("type")) {
                    "rtc_upgrade_offer" -> offerDef.complete(frame)
                    "rtc_upgrade_activate" -> activateDef.complete(seq to frame)
                }
                true
            },
            closeDrainedRelay = { code, reason -> relayClosedDef.complete(code to reason) },
            onDecryptedPlaintext = { plain ->
                val frame = Json.parseToJsonElement(plain).objectValue()
                when (frame.string("type")) {
                    "rtc_upgrade_answer", "rtc_upgrade_ice", "rtc_upgrade_activated", "rtc_upgrade_abort" ->
                        ctrl.onSignalingFrame(frame)
                    "early_dc_event" -> earlyDcFrameDef.complete(frame)
                    "large_rpc_response" -> largeRespDef.complete(frame)
                }
            },
            onModeChanged = { mode -> modeDef.complete(mode) },
            onFatalError = { err -> fatalDef.complete(err) },
        )

        try {
            ctrl.startUpgrade()
            val offerFrame = withTimeout(3_000) { offerDef.await() }
            val attemptId = offerFrame.string("attemptId")
            assertTrue(attemptId.length in 1..64)
            assertTrue(offerFrame.string("sdp").startsWith("v=0"))

            val pc = withTimeout(3_000) { peerFactory2.firstConnection.await() }
            val dc = withTimeout(3_000) { pc.channelCreated.await() }
            assertEquals("dsh", dc.label)

            // Host sends an early ICE candidate BEFORE sending rtc_upgrade_answer -> must be buffered!
            val (_, earlyIceB64) = hostCrypto2.encryptBase64WithSeq(
                obj(
                    "type" to "rtc_upgrade_ice",
                    "attemptId" to attemptId,
                    "candidate" to obj("candidate" to "candidate:1 1 UDP 1 192.168.1.5 50000 typ host", "sdpMid" to "0", "sdpMLineIndex" to 0),
                ).toString(),
            )
            ctrl.onRelayEncryptedFrame(earlyIceB64)
            assertEquals(0, pc.addedIceCandidates.size)

            // Host sends rtc_upgrade_answer -> setRemoteDescription flushes pendingRemoteIce!
            val (_, answerB64) = hostCrypto2.encryptBase64WithSeq(
                obj("type" to "rtc_upgrade_answer", "attemptId" to attemptId, "sdp" to "v=0\r\ns=answer\r\n").toString(),
            )
            ctrl.onRelayEncryptedFrame(answerB64)
            withTimeout(3_000) { pc.remoteDescriptionSet.await() }
            delay(50)
            assertEquals(1, pc.addedIceCandidates.size)
            assertEquals("candidate:1 1 UDP 1 192.168.1.5 50000 typ host", pc.addedIceCandidates[0].candidate)

            // Hook Host DC receive to decode RTCH + DSHU + raw TweetNaCl and reply with >64 KiB payload
            dc.onSendHook = { chunk ->
                val reassembled = hostChunkDecoder.feed(chunk)
                if (reassembled != null) {
                    val dshu = DshuFrameCodec.decode(reassembled)
                    val (seq, plain) = hostCrypto2.decryptRaw(dshu.bundle)
                    val req = Json.parseToJsonElement(plain).objectValue()
                    dcAppFrameReceived.complete(seq to req)
                    // Echo large payload back over DC using DSHU + RTCH
                    val respText = obj("type" to "large_rpc_response", "size" to req.string("blob").length, "blob" to req.string("blob")).toString()
                    val (respSeq, respBundle) = hostCrypto2.encryptRawWithSeq(respText)
                    val respDshu = DshuFrameCodec.encode(respSeq, respBundle)
                    for (respChunk in RtcChunkCodec.encode(respDshu, hostMsgIdGen::next)) {
                        dc.simulateMessage(respChunk)
                    }
                }
            }

            // DataChannel opens -> Client sends rtc_upgrade_activate with exact clientPreviousLegEndSeq
            dc.simulateOpen()
            val (activateSeq, activateFrame) = withTimeout(3_000) { activateDef.await() }
            assertEquals(activateSeq, activateFrame["clientPreviousLegEndSeq"].number())

            // Verify late local ICE during ACTIVATING is NOT sent on Relay WS (activate was final Relay frame)
            val relayCountAfterActivate = relayFrames2.size
            pc.observer.onIceCandidate(IceCandidateData("candidate:late", "0", 0))
            assertEquals(relayCountAfterActivate, relayFrames2.size)

            // Simulate cross-leg race: Host encrypts rtc_upgrade_activated (seq H) on Relay WS
            // AND encrypts an app frame (seq H+1) on DataChannel, delivering H+1 BEFORE H!
            val hostEndSeq = hostCrypto2.sendSeq
            val (_, activatedB64) = hostCrypto2.encryptBase64WithSeq(
                obj(
                    "type" to "rtc_upgrade_activated",
                    "attemptId" to attemptId,
                    "mode" to "p2p",
                    "hostPreviousLegEndSeq" to hostEndSeq,
                ).toString(),
            )
            val (earlyDcSeq, earlyDcBundle) = hostCrypto2.encryptRawWithSeq(
                obj("type" to "early_dc_event", "value" to "arrived-before-activated").toString(),
            )
            assertEquals(hostEndSeq + 1, earlyDcSeq)
            val earlyDshu = DshuFrameCodec.encode(earlyDcSeq, earlyDcBundle)
            dc.simulateMessage(earlyDshu) // Arrives on DC BEFORE activated arrives on Relay WS!
            assertFalse(earlyDcFrameDef.isCompleted) // Must wait in reorderBuffer for seq H

            // Now Relay WS delivers rtc_upgrade_activated (seq H) -> releases H and H+1 in order!
            ctrl.onRelayEncryptedFrame(activatedB64)
            assertEquals(TransportMode.P2P, withTimeout(3_000) { modeDef.await() })
            assertEquals("arrived-before-activated", withTimeout(3_000) { earlyDcFrameDef.await() }.string("value"))

            // Relay WS must be drained and closed with (1000, "upgraded_to_webrtc")!
            assertEquals(1000 to "upgraded_to_webrtc", withTimeout(3_000) { relayClosedDef.await() })
            assertEquals(AdaptiveUpgradeController.State.ACTIVE, ctrl.state)

            // Send > 64 KiB (72 KiB) RPC frame over DataChannel -> must be RTCH-chunked and round-tripped!
            val hugeBlob = "A".repeat(72 * 1024)
            ctrl.sendAppFrame(obj("type" to "large_rpc_request", "blob" to hugeBlob))
            val (dcReqSeq, dcReq) = withTimeout(5_000) { dcAppFrameReceived.await() }
            assertEquals(activateSeq + 1, dcReqSeq)
            assertEquals(hugeBlob.length, dcReq.string("blob").length)
            assertTrue("Expected multi-chunk RTCH frames on DataChannel", dc.sentChunks.size >= 9)

            val largeResp = withTimeout(5_000) { largeRespDef.await() }
            assertEquals(hugeBlob.length, largeResp["size"].number()?.toInt())
            assertEquals(hugeBlob, largeResp.string("blob"))

            // Closing DataChannel after ACTIVE must trigger fatalError (so RelayClient reconnects)
            assertFalse(fatalDef.isCompleted)
            dc.simulateClose()
            val disconnectErr = withTimeout(3_000) { fatalDef.await() }
            assertTrue(disconnectErr.message?.contains("WebRTC") == true)
        } finally {
            ctrl.close()
            scope.cancel()
        }
    }

    @Test
    fun upgradeAbortOrTimeoutFallsBackToRelayGracefullyWithoutDisconnecting() = runBlocking {
        val hostCrypto = MockHostCrypto()
        val clientCrypto = RelayCrypto(hostCrypto.publicKeyB64)
        hostCrypto.attachClient(clientCrypto.publicKeyB64)

        val peerFactory = FakeWebRtcPeerFactory()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val relayFrames = CopyOnWriteArrayList<JsonObject>()
        val offerDef = CompletableDeferred<JsonObject>()
        val queuedAppOnRelay = CompletableDeferred<JsonObject>()
        var fatalCalled = false
        lateinit var ctrl: AdaptiveUpgradeController

        ctrl = AdaptiveUpgradeController(
            scope = scope,
            crypto = clientCrypto,
            peerFactory = peerFactory,
            iceServers = emptyList(),
            fallbackToDefaultStun = false,
            sendRelayEncrypted = { b64 ->
                val (_, plain) = hostCrypto.decryptBase64(b64)
                val frame = Json.parseToJsonElement(plain).objectValue()
                relayFrames.add(frame)
                if (frame.string("type") == "rtc_upgrade_offer") offerDef.complete(frame)
                if (frame.string("type") == "queued_during_activating") queuedAppOnRelay.complete(frame)
                true
            },
            closeDrainedRelay = { _, _ -> throw AssertionError("Relay should NOT be closed on fallback") },
            onDecryptedPlaintext = { plain ->
                val frame = Json.parseToJsonElement(plain).objectValue()
                if (frame.string("type").startsWith("rtc_upgrade_")) ctrl.onSignalingFrame(frame)
            },
            onModeChanged = { throw AssertionError("Mode should remain RELAY on fallback") },
            onFatalError = { fatalCalled = true },
        )

        try {
            ctrl.startUpgrade()
            val offer = withTimeout(3_000) { offerDef.await() }
            val attemptId = offer.string("attemptId")
            val pc = withTimeout(3_000) { peerFactory.firstConnection.await() }
            val dc = withTimeout(3_000) { pc.channelCreated.await() }

            // Open DC -> enters ACTIVATING, then enqueue an app frame during ACTIVATING
            dc.simulateOpen()
            ctrl.sendAppFrame(obj("type" to "queued_during_activating", "payload" to "must-not-be-lost"))

            // Host aborts upgrade -> controller must fall back to Relay WS and flush queued app frame!
            val (_, abortB64) = hostCrypto.encryptBase64WithSeq(
                obj("type" to "rtc_upgrade_abort", "attemptId" to attemptId, "reason" to "ice_failed").toString(),
            )
            ctrl.onRelayEncryptedFrame(abortB64)

            val flushed = withTimeout(3_000) { queuedAppOnRelay.await() }
            assertEquals("must-not-be-lost", flushed.string("payload"))
            assertEquals(AdaptiveUpgradeController.State.FALLBACK, ctrl.state)
            assertFalse(fatalCalled)
            assertTrue(pc.closed)
            assertTrue(dc.closed)

            // Subsequent app frames continue over Relay WS without issue
            ctrl.sendAppFrame(obj("type" to "after_fallback", "ok" to true))
            assertTrue(relayFrames.any { it.string("type") == "after_fallback" })
        } finally {
            ctrl.close()
            scope.cancel()
        }
    }

    @Test
    fun relayClientConnectsLanOnlyDirectWithZeroExternalServerAndFallsBackToRelayWhenLanUnreachable() = runBlocking {
        val process = ProcessBuilder("node", File("src/test/fixtures/relay-peer.mjs").absolutePath, "server")
            .redirectError(ProcessBuilder.Redirect.INHERIT)
            .start()
        var client: RelayClient? = null
        try {
            val config = Json.parseToJsonElement(process.inputStream.bufferedReader().readLine()).objectValue()
            val port = config["port"].number()!!
            val key = config.string("key")

            // 1. Pure LAN-only offer (relay == null) connects directly -> TransportMode.LAN
            val lanOnlyOffer = Offer(
                v = 2,
                serverId = "native-test",
                daemonPublicKeyB64 = key,
                relay = null,
                authBootstrap = AuthBootstrap(1, "fresh-pairing-token-123456789", System.currentTimeMillis() + 60_000),
                lan = LanOffer(endpoints = listOf("127.0.0.1:$port"), useTls = false),
            )
            val savedRecords = CopyOnWriteArrayList<SavedComputer>()
            val fakeFactory = FakeWebRtcPeerFactory()
            client = RelayClient(
                offer = lanOnlyOffer,
                saved = null,
                deviceName = "LAN phone",
                persist = savedRecords::add,
                onMux = {},
                onComputerName = {},
                webRtcPeerFactory = fakeFactory,
            )
            client.connect()
            assertTrue(client.connected)
            assertEquals(TransportMode.LAN, client.transportMode.value)
            assertEquals("session.list", client.host("session.list").objectValue().string("method"))
            // LAN mode must NOT trigger WebRTC upgrade
            delay(100)
            assertEquals(0, fakeFactory.connections.size)
            // SavedComputer preserves LAN endpoints with empty relayEndpoint
            assertEquals("", savedRecords.last().relayEndpoint)
            assertEquals(listOf("127.0.0.1:$port"), savedRecords.last().lanEndpoints)
            client.close()

            // 2. Hybrid offer where LAN port is unreachable (port 1) falls back cleanly to Relay WS -> TransportMode.RELAY
            val hybridOffer = Offer(
                v = 2,
                serverId = "native-test",
                daemonPublicKeyB64 = key,
                relay = RelayOffer("127.0.0.1:$port", false),
                authBootstrap = null,
                lan = LanOffer(endpoints = listOf("127.0.0.1:1"), useTls = false),
            )
            client = RelayClient(
                offer = hybridOffer,
                saved = savedRecords.last(),
                deviceName = "Hybrid phone",
                persist = savedRecords::add,
                onMux = {},
                onComputerName = {},
                lanConnectTimeoutMs = 400L,
            )
            client.connect()
            assertTrue(client.connected)
            assertEquals(TransportMode.RELAY, client.transportMode.value)
            assertEquals("session.list", client.host("session.list").objectValue().string("method"))
            client.close()
        } finally {
            client?.close()
            process.destroyForcibly()
        }
    }

    @Test
    fun relayClientUpgradesInBandToWebRtcDrainsAndClosesRelayWsWithoutDisconnecting() = runBlocking {
        val hostCrypto = MockHostCrypto()
        val peerFactory = FakeWebRtcPeerFactory()
        val offer = Offer(
            v = 2,
            serverId = "rtc-e2e",
            daemonPublicKeyB64 = hostCrypto.publicKeyB64,
            relay = RelayOffer("127.0.0.1:1", false),
            authBootstrap = AuthBootstrap(1, "pairing-token-0123456789", System.currentTimeMillis() + 60_000),
        )
        val relayClosed = CompletableDeferred<Pair<Int, String?>>()
        val hostChunkDecoder = RtcChunkDecoder()
        val hostMsgIdGen = RtcMessageIdGenerator()
        var activeDc: FakeDataChannel? = null

        val client = RelayClient(
            offer = offer,
            saved = null,
            deviceName = "E2E phone",
            persist = {},
            onMux = {},
            onComputerName = {},
            webRtcPeerFactory = peerFactory,
        )

        lateinit var fakeWs: WebSocket
        fakeWs = object : WebSocket {
            override fun request() = Request.Builder().url("http://127.0.0.1/ws").build()
            override fun queueSize() = 0L
            override fun send(bytes: ByteString) = send(bytes.utf8())
            override fun send(text: String): Boolean {
                if (text.startsWith("{")) {
                    val hello = Json.parseToJsonElement(text).objectValue()
                    if (hello.string("type") == "e2ee_hello") {
                        hostCrypto.attachClient(hello.string("key"))
                        client.onMessage(
                            fakeWs,
                            obj("type" to "e2ee_ready", "authChallenge" to "challenge-e2e").toString(),
                        )
                    }
                    return true
                }
                val (seq, plain) = hostCrypto.decryptBase64(text)
                val frame = Json.parseToJsonElement(plain).objectValue()
                when (frame.string("type")) {
                    "hello" -> {
                        val (_, authRes) = hostCrypto.encryptBase64WithSeq(
                            obj("type" to "relay_device_auth_result", "version" to 1, "ok" to true, "deviceSecret" to "issued-secret-123").toString(),
                        )
                        val (_, infoRes) = hostCrypto.encryptBase64WithSeq(
                            obj("type" to "session", "message" to obj("type" to "status", "payload" to obj("status" to "server_info", "hostname" to "P2P Desktop"))).toString(),
                        )
                        client.onMessage(fakeWs, authRes)
                        client.onMessage(fakeWs, infoRes)
                    }
                    "rtc_upgrade_offer" -> {
                        val attemptId = frame.string("attemptId")
                        val (_, answer) = hostCrypto.encryptBase64WithSeq(
                            obj("type" to "rtc_upgrade_answer", "attemptId" to attemptId, "sdp" to "v=0\r\ns=host-answer\r\n").toString(),
                        )
                        client.onMessage(fakeWs, answer)
                    }
                    "rtc_upgrade_activate" -> {
                        val attemptId = frame.string("attemptId")
                        assertEquals(seq, frame["clientPreviousLegEndSeq"].number())
                        val hostEndSeq = hostCrypto.sendSeq
                        val (_, activated) = hostCrypto.encryptBase64WithSeq(
                            obj("type" to "rtc_upgrade_activated", "attemptId" to attemptId, "mode" to "p2p", "hostPreviousLegEndSeq" to hostEndSeq).toString(),
                        )
                        client.onMessage(fakeWs, activated)
                    }
                }
                return true
            }

            override fun close(code: Int, reason: String?): Boolean {
                relayClosed.complete(code to reason)
                // Simulate OkHttp firing onClosed after close() — must NOT disconnect RelayClient!
                client.onClosed(fakeWs, code, reason.orEmpty())
                return true
            }

            override fun cancel() {}
        }

        try {
            // Set initial mode to RELAY as connect() does, then drive handshake via fakeWs
            val modeField = RelayClient::class.java.getDeclaredField("_transportMode").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            (modeField.get(client) as kotlinx.coroutines.flow.MutableStateFlow<TransportMode?>).value = TransportMode.RELAY

            val resp = Response.Builder().request(fakeWs.request()).protocol(Protocol.HTTP_1_1).code(101).message("Switching Protocols").build()
            client.onOpen(fakeWs, resp)
            assertTrue(client.connected)
            assertEquals(TransportMode.RELAY, client.transportMode.value)

            val pc = withTimeout(3_000) { peerFactory.firstConnection.await() }
            val dc = withTimeout(3_000) { pc.channelCreated.await() }
            activeDc = dc

            // Wire host-side DataChannel RPC responder (supports >64 KiB chunked RPC!)
            dc.onSendHook = { chunk ->
                val reassembled = hostChunkDecoder.feed(chunk)
                if (reassembled != null) {
                    val dshu = DshuFrameCodec.decode(reassembled)
                    val (_, plain) = hostCrypto.decryptRaw(dshu.bundle)
                    val wire = Json.parseToJsonElement(plain).objectValue()
                    val msg = wire["message"].objectValue()
                    if (msg.string("type") == "dshd.host.rpc.request") {
                        val reqId = msg.string("requestId")
                        val method = msg.string("method")
                        val replyText = obj(
                            "type" to "session",
                            "message" to obj(
                                "type" to "dshd.host.rpc.response",
                                "payload" to obj(
                                    "requestId" to reqId,
                                    "ok" to true,
                                    "value" to obj("method" to method, "echoLen" to msg["payload"].objectValue().string("blob").length),
                                ),
                            ),
                        ).toString()
                        val (rSeq, rBundle) = hostCrypto.encryptRawWithSeq(replyText)
                        val rDshu = DshuFrameCodec.encode(rSeq, rBundle)
                        for (c in RtcChunkCodec.encode(rDshu, hostMsgIdGen::next)) {
                            dc.simulateMessage(c)
                        }
                    }
                }
            }

            withTimeout(3_000) { pc.remoteDescriptionSet.await() }
            dc.simulateOpen()

            // Relay WS must close with (1000, "upgraded_to_webrtc") and RelayClient must stay connected on P2P!
            assertEquals(1000 to "upgraded_to_webrtc", withTimeout(3_000) { relayClosed.await() })
            assertEquals(TransportMode.P2P, client.transportMode.value)
            assertTrue(client.connected)

            // Perform a 72 KiB RPC exclusively over WebRTC DataChannel (Relay WS is already closed!)
            val huge = "Z".repeat(72 * 1024)
            val rpcResult = withTimeout(5_000) { client.host("session.echo", obj("blob" to huge)).objectValue() }
            assertEquals("session.echo", rpcResult.string("method"))
            assertEquals(huge.length, rpcResult["echoLen"].number()?.toInt())
            assertTrue(activeDc.sentChunks.size >= 9)
        } finally {
            client.close()
        }
    }
}
