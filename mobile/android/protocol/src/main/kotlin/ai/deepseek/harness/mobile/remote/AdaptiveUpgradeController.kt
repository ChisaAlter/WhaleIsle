package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.DEFAULT_PUBLIC_STUN_SERVERS
import ai.deepseek.harness.mobile.pair.IceServerConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.ArrayDeque
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors

const val RTC_NEGOTIATE_TIMEOUT_MS: Long = 8_000L
const val RTC_NEGOTIATE_HOST_ONLY_TIMEOUT_MS: Long = 4_000L
const val RTC_ACTIVATE_TIMEOUT_MS: Long = 6_000L
const val RTC_ATTEMPT_TTL_MS: Long = 20_000L
const val RTC_DRAIN_TIMEOUT_MS: Long = 3_000L
const val RTC_MAX_SDP_BYTES: Int = 128 * 1024
const val RTC_SERIAL_SEND_MAX_BYTES: Int = 8 * 1024 * 1024
const val RTC_SERIAL_SEND_MAX_FRAMES: Int = 256

/**
 * In-band WebRTC upgrade state machine adhering to the unified WhaleIsle P2P contract:
 * - Negotiates WebRTC DataChannel ("dsh", ordered=true) over the authenticated E2EE Relay WS.
 * - Cuts over atomically via rtc_upgrade_activate(clientPreviousLegEndSeq) / rtc_upgrade_activated(hostPreviousLegEndSeq).
 * - Frames outbound/inbound DataChannel messages with DSHU + RTCH (8192B chunks).
 * - Reorders cross-leg frames via SequencedCiphertextReorderBuffer and closes drained Relay WS (1000, "upgraded_to_webrtc").
 * - Gracefully falls back to Relay WS on any pre-activation failure without disconnecting RelayClient.
 */
class AdaptiveUpgradeController(
    private val scope: CoroutineScope,
    private val crypto: RelayCrypto,
    private val peerFactory: WebRtcPeerFactory,
    private val iceServers: List<IceServerConfig>,
    private val sendRelayEncrypted: (String) -> Boolean,
    private val closeDrainedRelay: (Int, String) -> Unit,
    private val onDecryptedPlaintext: (String) -> Unit,
    private val onModeChanged: (TransportMode) -> Unit,
    private val onFatalError: (Throwable) -> Unit,
    private val fallbackToDefaultStun: Boolean = true,
    private val clock: () -> Long = System::currentTimeMillis,
    private val negotiateTimeoutMs: Long? = null,
    private val activateTimeoutMs: Long = RTC_ACTIVATE_TIMEOUT_MS,
    private val attemptTtlMs: Long = RTC_ATTEMPT_TTL_MS,
    private val drainTimeoutMs: Long = RTC_DRAIN_TIMEOUT_MS,
    private val gapTimeoutMs: Long = REORDER_GAP_TIMEOUT_MS,
) {
    enum class State {
        IDLE,
        NEGOTIATING,
        ACTIVATING,
        ACTIVE,
        FALLBACK,
        CLOSED,
    }

    private val effectiveIceServers: List<IceServerConfig> = when {
        iceServers.isNotEmpty() -> iceServers
        fallbackToDefaultStun -> DEFAULT_PUBLIC_STUN_SERVERS
        else -> emptyList()
    }

    private val effectiveNegotiateTimeoutMs: Long = negotiateTimeoutMs
        ?: if (effectiveIceServers.isNotEmpty()) RTC_NEGOTIATE_TIMEOUT_MS else RTC_NEGOTIATE_HOST_ONLY_TIMEOUT_MS

    private val stateLock = Any()
    private val outboundLock = Any()
    private val inboundLock = Any()

    @Volatile
    var state: State = State.IDLE
        private set

    private var attemptId: String? = null
    private var peerConnection: WebRtcPeerConnection? = null
    private var dataChannel: WebRtcDataChannel? = null
    private var offerSent: Boolean = false
    private var remoteDescriptionSet: Boolean = false
    private val pendingLocalIce = ArrayList<IceCandidateData?>()
    private val pendingRemoteIce = ArrayList<IceCandidateData>()

    private var hostPreviousLegEndSeq: Long? = null
    private var relayClosed: Boolean = false

    private var negotiateTimeoutJob: Job? = null
    private var activateTimeoutJob: Job? = null
    private var attemptTtlJob: Job? = null
    private var drainTimeoutJob: Job? = null
    private var gapTimeoutJob: Job? = null

    private val chunkDecoder = RtcChunkDecoder(clock = clock)
    private val messageIdGen = RtcMessageIdGenerator()
    private var reorderBuffer: SequencedCiphertextReorderBuffer? = null

    private data class QueuedFrame(val text: String, val byteSize: Int)

    private val sendQueue = ArrayDeque<QueuedFrame>()
    private var sendQueueBytes: Int = 0
    private var sendDrainScheduled: Boolean = false
    private val sendExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "dsh-webrtc-send").apply { isDaemon = true }
    }

    fun startUpgrade() {
        val currentAttemptId: String
        synchronized(stateLock) {
            if (state != State.IDLE) return
            state = State.NEGOTIATING
            currentAttemptId = "rtc_${UUID.randomUUID().toString().replace("-", "").take(16)}"
            attemptId = currentAttemptId
            offerSent = false
            remoteDescriptionSet = false
            pendingLocalIce.clear()
            pendingRemoteIce.clear()
        }

        synchronized(inboundLock) {
            if (reorderBuffer == null) {
                reorderBuffer = SequencedCiphertextReorderBuffer(
                    initialNextExpectedSeq = crypto.nextExpectedReceiveSeq(),
                    clock = clock,
                    gapTimeoutMs = gapTimeoutMs,
                )
            }
        }

        negotiateTimeoutJob = scope.launch {
            delay(effectiveNegotiateTimeoutMs)
            abortUpgrade(currentAttemptId, reason = "negotiate_timeout", notifyHost = true)
        }
        attemptTtlJob = scope.launch {
            delay(attemptTtlMs)
            abortUpgrade(currentAttemptId, reason = "attempt_ttl_expired", notifyHost = true)
        }

        scope.launch {
            try {
                val peerObserver = object : WebRtcPeerObserver {
                    override fun onIceCandidate(candidate: IceCandidateData?) {
                        handleLocalIceCandidate(currentAttemptId, candidate)
                    }

                    override fun onConnectionStateChange(state: WebRtcConnectionState) {
                        handlePeerConnectionStateChange(currentAttemptId, state)
                    }
                }
                val pc = peerFactory.createPeerConnection(effectiveIceServers, peerObserver)
                val dc = pc.createDataChannel(label = "dsh", ordered = true)

                val shouldCloseEarly = synchronized(stateLock) {
                    if (state != State.NEGOTIATING || attemptId != currentAttemptId) {
                        true
                    } else {
                        peerConnection = pc
                        dataChannel = dc
                        false
                    }
                }
                if (shouldCloseEarly) {
                    runCatching { dc.close() }
                    runCatching { pc.close() }
                    return@launch
                }

                dc.setObserver(object : WebRtcDataChannelObserver {
                    override fun onOpen() {
                        handleDataChannelOpen(currentAttemptId)
                    }

                    override fun onMessage(bytes: ByteArray) {
                        handleDataChannelMessage(currentAttemptId, bytes)
                    }

                    override fun onClose() {
                        handleDataChannelClose(currentAttemptId)
                    }
                })

                val offer = pc.createOffer()
                require(offer.sdp.toByteArray(Charsets.UTF_8).size <= RTC_MAX_SDP_BYTES) {
                    "Local SDP exceeds 128 KiB limit"
                }
                pc.setLocalDescription(offer)

                val bufferedIce: List<IceCandidateData?>
                val stillNegotiating = synchronized(stateLock) {
                    if (state != State.NEGOTIATING || attemptId != currentAttemptId) {
                        bufferedIce = emptyList()
                        false
                    } else {
                        true.also {
                            bufferedIce = ArrayList(pendingLocalIce)
                            pendingLocalIce.clear()
                        }
                    }
                }
                if (!stillNegotiating) return@launch

                val offerSentOk = sendSignalingOnRelay(
                    obj(
                        "type" to "rtc_upgrade_offer",
                        "attemptId" to currentAttemptId,
                        "sdp" to offer.sdp,
                    ),
                )
                if (!offerSentOk) {
                    abortUpgrade(currentAttemptId, reason = "relay_send_failed", notifyHost = false)
                    return@launch
                }

                val extraIce = synchronized(stateLock) {
                    offerSent = true
                    ArrayList(pendingLocalIce).also { pendingLocalIce.clear() }
                }
                for (candidate in bufferedIce + extraIce) {
                    sendLocalIceFrame(currentAttemptId, candidate)
                }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                abortUpgrade(currentAttemptId, reason = error.message ?: "offer_failed", notifyHost = true)
            }
        }
    }

    /**
     * Routes an outbound application frame through the appropriate active transport:
     * - IDLE / NEGOTIATING / FALLBACK: Relay WS directly (ordered under outboundLock).
     * - ACTIVATING: queued safely until rtc_upgrade_activated (flush to DC) or abort (flush to Relay WS).
     * - ACTIVE: queued into bounded serial DataChannel sender (DSHU + RTCH).
     */
    fun sendAppFrame(frame: JsonObject) {
        val text = frame.toString()
        val approxBytes = text.toByteArray(Charsets.UTF_8).size
        synchronized(outboundLock) {
            when (state) {
                State.IDLE, State.NEGOTIATING, State.FALLBACK -> {
                    val encrypted = crypto.encrypt(text)
                    check(sendRelayEncrypted(encrypted)) { "连接已断开" }
                }
                State.ACTIVATING -> {
                    enqueueBoundedLocked(QueuedFrame(text, approxBytes))
                }
                State.ACTIVE -> {
                    enqueueBoundedLocked(QueuedFrame(text, approxBytes))
                    scheduleDataChannelDrainLocked()
                }
                State.CLOSED -> throw IllegalStateException("连接已断开")
            }
        }
    }

    /**
     * Handles an inbound encrypted Base64 frame received over the Relay WebSocket.
     */
    fun onRelayEncryptedFrame(base64Text: String) {
        val bundle = Base64.getDecoder().decode(base64Text)
        val seq = RelayCrypto.extractSeqFromBundle(bundle)
        deliverEncryptedBundle(seq, bundle, fromDataChannel = false)
    }

    /**
     * Handles an inbound decrypted rtc_upgrade_* signaling frame from the Host.
     */
    fun onSignalingFrame(frame: JsonObject) {
        val type = frame.string("type")
        val frameAttemptId = frame.string("attemptId")
        when (type) {
            "rtc_upgrade_answer" -> handleAnswer(frameAttemptId, frame)
            "rtc_upgrade_ice" -> handleRemoteIce(frameAttemptId, frame)
            "rtc_upgrade_activated" -> handleActivated(frameAttemptId, frame)
            "rtc_upgrade_abort" -> handleRemoteAbort(frameAttemptId, frame)
        }
    }

    fun close() {
        val pc: WebRtcPeerConnection?
        val dc: WebRtcDataChannel?
        synchronized(stateLock) {
            if (state == State.CLOSED) return
            state = State.CLOSED
            pc = peerConnection
            dc = dataChannel
            peerConnection = null
            dataChannel = null
            pendingLocalIce.clear()
            pendingRemoteIce.clear()
        }
        cancelTimers()
        synchronized(outboundLock) {
            sendQueue.clear()
            sendQueueBytes = 0
        }
        synchronized(inboundLock) {
            chunkDecoder.clear()
            reorderBuffer?.clear()
        }
        runCatching { dc?.setObserver(null) }
        runCatching { dc?.close() }
        runCatching { pc?.close() }
        sendExecutor.shutdownNow()
    }

    private fun handleAnswer(frameAttemptId: String, frame: JsonObject) {
        val sdp = frame.string("sdp")
        if (sdp.isBlank() || sdp.toByteArray(Charsets.UTF_8).size > RTC_MAX_SDP_BYTES) {
            abortUpgrade(frameAttemptId, reason = "invalid_answer_sdp", notifyHost = true)
            return
        }
        val pc = synchronized(stateLock) {
            if (state != State.NEGOTIATING || attemptId != frameAttemptId) return
            peerConnection
        } ?: return

        scope.launch {
            try {
                pc.setRemoteDescription(SessionDescriptionData(type = "answer", sdp = sdp))
                val toAdd = synchronized(stateLock) {
                    if (state != State.NEGOTIATING && state != State.ACTIVATING) return@launch
                    if (attemptId != frameAttemptId) return@launch
                    remoteDescriptionSet = true
                    ArrayList(pendingRemoteIce).also { pendingRemoteIce.clear() }
                }
                for (candidate in toAdd) {
                    pc.addIceCandidate(candidate)
                }
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                abortUpgrade(frameAttemptId, reason = error.message ?: "set_remote_description_failed", notifyHost = true)
            }
        }
    }

    private fun handleRemoteIce(frameAttemptId: String, frame: JsonObject) {
        val candidateElem = frame["candidate"]
        if (candidateElem == null || candidateElem is JsonNull) return
        val candidateObj = candidateElem as? JsonObject ?: return
        val candidateStr = candidateObj.string("candidate")
        if (candidateStr.isBlank()) return
        val sdpMid = candidateObj["sdpMid"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content
        val sdpMLineIndex = candidateObj["sdpMLineIndex"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.intOrNull
        val candidate = IceCandidateData(
            candidate = candidateStr,
            sdpMid = sdpMid,
            sdpMLineIndex = sdpMLineIndex,
        )

        val pcToAdd: WebRtcPeerConnection? = synchronized(stateLock) {
            if ((state != State.NEGOTIATING && state != State.ACTIVATING) || attemptId != frameAttemptId) return
            if (!remoteDescriptionSet) {
                pendingRemoteIce.add(candidate)
                null
            } else {
                peerConnection
            }
        }
        if (pcToAdd != null) {
            runCatching { pcToAdd.addIceCandidate(candidate) }
        }
    }

    private fun handleLocalIceCandidate(currentAttemptId: String, candidate: IceCandidateData?) {
        val sendNow = synchronized(stateLock) {
            // Once ACTIVATING/ACTIVE, rtc_upgrade_activate was already sent as the final Relay WS frame.
            if (state != State.NEGOTIATING || attemptId != currentAttemptId) return
            if (!offerSent) {
                pendingLocalIce.add(candidate)
                false
            } else {
                true
            }
        }
        if (sendNow) {
            sendLocalIceFrame(currentAttemptId, candidate)
        }
    }

    private fun sendLocalIceFrame(currentAttemptId: String, candidate: IceCandidateData?) {
        val candidateJson: Any? = if (candidate == null) {
            null
        } else {
            obj(
                "candidate" to candidate.candidate,
                "sdpMid" to candidate.sdpMid,
                "sdpMLineIndex" to candidate.sdpMLineIndex,
            )
        }
        sendSignalingOnRelay(
            obj(
                "type" to "rtc_upgrade_ice",
                "attemptId" to currentAttemptId,
                "candidate" to candidateJson,
            ),
        )
    }

    private fun handleDataChannelOpen(currentAttemptId: String) {
        val shouldActivate = synchronized(outboundLock) {
            synchronized(stateLock) {
                if (state != State.NEGOTIATING || attemptId != currentAttemptId) {
                    false
                } else {
                    state = State.ACTIVATING
                    true
                }
            }.also { enteredActivating ->
                if (enteredActivating) {
                    // Atomically compute clientPreviousLegEndSeq and send rtc_upgrade_activate
                    // as the exact last frame on Relay WS.
                    val (_, encryptedActivate) = crypto.encryptWithPlannedSeq { seq ->
                        obj(
                            "type" to "rtc_upgrade_activate",
                            "attemptId" to currentAttemptId,
                            "clientPreviousLegEndSeq" to seq,
                        ).toString()
                    }
                    if (!sendRelayEncrypted(encryptedActivate)) {
                        synchronized(stateLock) {
                            if (state == State.ACTIVATING && attemptId == currentAttemptId) {
                                state = State.NEGOTIATING
                            }
                        }
                        return@handleDataChannelOpen abortUpgrade(
                            currentAttemptId,
                            reason = "activate_send_failed",
                            notifyHost = false,
                        )
                    }
                }
            }
        }
        if (!shouldActivate) return

        negotiateTimeoutJob?.cancel()
        negotiateTimeoutJob = null
        activateTimeoutJob = scope.launch {
            delay(activateTimeoutMs)
            abortUpgrade(currentAttemptId, reason = "activate_timeout", notifyHost = true)
        }
    }

    private fun handleActivated(frameAttemptId: String, frame: JsonObject) {
        val mode = TransportMode.fromWireName(frame.string("mode"))
        if (mode == null || mode == TransportMode.RELAY) {
            abortUpgrade(frameAttemptId, reason = "invalid_activated_mode", notifyHost = true)
            return
        }
        val endSeq = frame["hostPreviousLegEndSeq"].number()
        if (endSeq == null || endSeq < 0L) {
            abortUpgrade(frameAttemptId, reason = "invalid_host_end_seq", notifyHost = true)
            return
        }

        val enteredActive = synchronized(outboundLock) {
            synchronized(stateLock) {
                if (state != State.ACTIVATING || attemptId != frameAttemptId) {
                    false
                } else {
                    state = State.ACTIVE
                    hostPreviousLegEndSeq = endSeq
                    true
                }
            }.also { ok ->
                if (ok && sendQueue.isNotEmpty()) {
                    scheduleDataChannelDrainLocked()
                }
            }
        }
        if (!enteredActive) return

        negotiateTimeoutJob?.cancel()
        activateTimeoutJob?.cancel()
        attemptTtlJob?.cancel()
        negotiateTimeoutJob = null
        activateTimeoutJob = null
        attemptTtlJob = null

        onModeChanged(mode)

        val lastSeq = crypto.lastReceivedSeq()
        if (lastSeq != null && java.lang.Long.compareUnsigned(lastSeq, endSeq) >= 0) {
            completeRelayDrain()
        } else {
            drainTimeoutJob = scope.launch {
                delay(drainTimeoutMs)
                completeRelayDrain()
            }
        }
    }

    private fun handleRemoteAbort(frameAttemptId: String, frame: JsonObject) {
        val matches = synchronized(stateLock) {
            (state == State.NEGOTIATING || state == State.ACTIVATING) &&
                (frameAttemptId.isBlank() || attemptId == frameAttemptId)
        }
        if (!matches) return
        val reason = frame.string("reason").ifBlank { "host_aborted" }
        abortUpgrade(attemptId ?: frameAttemptId, reason = reason, notifyHost = false)
    }

    private fun handleDataChannelMessage(currentAttemptId: String, bytes: ByteArray) {
        val activeAttempt = synchronized(stateLock) {
            (state == State.ACTIVATING || state == State.ACTIVE) && attemptId == currentAttemptId
        }
        if (!activeAttempt) return

        try {
            val reassembled = chunkDecoder.feed(bytes) ?: return
            val dshu = DshuFrameCodec.decode(reassembled)
            deliverEncryptedBundle(dshu.seq, dshu.bundle, fromDataChannel = true)
        } catch (error: Throwable) {
            val isActive = synchronized(stateLock) { state == State.ACTIVE }
            if (isActive) {
                onFatalError(error)
            } else {
                abortUpgrade(currentAttemptId, reason = error.message ?: "dc_protocol_error", notifyHost = true)
            }
        }
    }

    private fun handleDataChannelClose(currentAttemptId: String) {
        val wasActive = synchronized(stateLock) {
            if (attemptId != currentAttemptId) return
            state == State.ACTIVE
        }
        if (wasActive) {
            onFatalError(IllegalStateException("WebRTC 连接已断开，草稿已保留"))
        } else {
            abortUpgrade(currentAttemptId, reason = "dc_closed_before_active", notifyHost = false)
        }
    }

    private fun handlePeerConnectionStateChange(currentAttemptId: String, pcState: WebRtcConnectionState) {
        if (pcState != WebRtcConnectionState.FAILED && pcState != WebRtcConnectionState.CLOSED) return
        val wasActive = synchronized(stateLock) {
            if (attemptId != currentAttemptId) return
            state == State.ACTIVE
        }
        if (wasActive) {
            onFatalError(IllegalStateException("WebRTC 连接已断开，草稿已保留"))
        } else {
            abortUpgrade(currentAttemptId, reason = "pc_${pcState.name.lowercase()}", notifyHost = true)
        }
    }

    private fun deliverEncryptedBundle(seq: Long, bundle: ByteArray, fromDataChannel: Boolean) {
        val readyToDecrypt: List<Pair<Long, ByteArray>>
        val shouldStartGapTimer: Boolean
        val shouldCancelGapTimer: Boolean

        synchronized(inboundLock) {
            if (state == State.CLOSED) return
            val buffer = reorderBuffer
            if (buffer == null) {
                readyToDecrypt = listOf(seq to bundle)
                shouldStartGapTimer = false
                shouldCancelGapTimer = false
            } else {
                readyToDecrypt = buffer.push(seq, bundle)
                shouldStartGapTimer = buffer.hasGap()
                shouldCancelGapTimer = !buffer.hasGap()
            }
        }

        if (shouldCancelGapTimer) {
            gapTimeoutJob?.cancel()
            gapTimeoutJob = null
        } else if (shouldStartGapTimer && gapTimeoutJob?.isActive != true) {
            gapTimeoutJob = scope.launch {
                delay(gapTimeoutMs)
                val gapError = synchronized(inboundLock) {
                    runCatching { reorderBuffer?.checkGapTimeout() }.exceptionOrNull()
                }
                if (gapError != null) {
                    onFatalError(gapError)
                }
            }
        }

        for ((orderedSeq, orderedBundle) in readyToDecrypt) {
            val plaintext = crypto.decryptFromBytes(orderedBundle)
            onDecryptedPlaintext(plaintext)
            checkDrainComplete(orderedSeq)
        }
    }

    private fun checkDrainComplete(decryptedSeq: Long) {
        val shouldClose = synchronized(stateLock) {
            state == State.ACTIVE &&
                !relayClosed &&
                hostPreviousLegEndSeq != null &&
                java.lang.Long.compareUnsigned(decryptedSeq, hostPreviousLegEndSeq!!) >= 0
        }
        if (shouldClose) {
            completeRelayDrain()
        }
    }

    private fun completeRelayDrain() {
        val doClose = synchronized(stateLock) {
            if (relayClosed || state != State.ACTIVE) {
                false
            } else {
                relayClosed = true
                true
            }
        }
        if (!doClose) return
        drainTimeoutJob?.cancel()
        drainTimeoutJob = null
        closeDrainedRelay(1000, "upgraded_to_webrtc")
    }

    private fun abortUpgrade(currentAttemptId: String, reason: String, notifyHost: Boolean) {
        var pc: WebRtcPeerConnection? = null
        var dc: WebRtcDataChannel? = null
        val didAbort = synchronized(outboundLock) {
            val queuedToFlush: List<QueuedFrame>
            val transitioned = synchronized(stateLock) {
                if ((state != State.NEGOTIATING && state != State.ACTIVATING) || attemptId != currentAttemptId) {
                    queuedToFlush = emptyList()
                    false
                } else {
                    state = State.FALLBACK
                    pc = peerConnection
                    dc = dataChannel
                    peerConnection = null
                    dataChannel = null
                    pendingLocalIce.clear()
                    pendingRemoteIce.clear()
                    queuedToFlush = ArrayList(sendQueue)
                    sendQueue.clear()
                    sendQueueBytes = 0
                    true
                }
            }
            if (transitioned) {
                if (notifyHost && !relayClosed) {
                    runCatching {
                        val abortEncrypted = crypto.encrypt(
                            obj(
                                "type" to "rtc_upgrade_abort",
                                "attemptId" to currentAttemptId,
                                "reason" to reason,
                            ).toString(),
                        )
                        sendRelayEncrypted(abortEncrypted)
                    }
                }
                // Flush any app frames buffered during ACTIVATING back onto Relay WS in exact order.
                for (queued in queuedToFlush) {
                    val encrypted = crypto.encrypt(queued.text)
                    if (!sendRelayEncrypted(encrypted)) break
                }
            }
            transitioned
        }
        if (!didAbort) return

        negotiateTimeoutJob?.cancel()
        activateTimeoutJob?.cancel()
        attemptTtlJob?.cancel()
        negotiateTimeoutJob = null
        activateTimeoutJob = null
        attemptTtlJob = null

        runCatching { dc?.setObserver(null) }
        runCatching { dc?.close() }
        runCatching { pc?.close() }
    }

    private fun sendSignalingOnRelay(frame: JsonObject): Boolean {
        return synchronized(outboundLock) {
            if (state != State.NEGOTIATING || relayClosed) return false
            val encrypted = crypto.encrypt(frame.toString())
            sendRelayEncrypted(encrypted)
        }
    }

    private fun enqueueBoundedLocked(frame: QueuedFrame) {
        if (sendQueue.size + 1 > RTC_SERIAL_SEND_MAX_FRAMES) {
            throw IllegalStateException("WebRTC 发送队列帧数超限 ($RTC_SERIAL_SEND_MAX_FRAMES)")
        }
        if (sendQueueBytes + frame.byteSize > RTC_SERIAL_SEND_MAX_BYTES) {
            throw IllegalStateException("WebRTC 发送队列字节数超限 ($RTC_SERIAL_SEND_MAX_BYTES)")
        }
        sendQueue.addLast(frame)
        sendQueueBytes += frame.byteSize
    }

    private fun scheduleDataChannelDrainLocked() {
        if (sendDrainScheduled) return
        sendDrainScheduled = true
        runCatching {
            sendExecutor.execute { drainDataChannelQueue() }
        }.onFailure {
            sendDrainScheduled = false
        }
    }

    private fun drainDataChannelQueue() {
        while (true) {
            val next: QueuedFrame
            val dc: WebRtcDataChannel
            synchronized(outboundLock) {
                if (state != State.ACTIVE || sendQueue.isEmpty()) {
                    sendDrainScheduled = false
                    return
                }
                val channel = synchronized(stateLock) { dataChannel }
                if (channel == null) {
                    sendDrainScheduled = false
                    return
                }
                next = sendQueue.removeFirst()
                sendQueueBytes -= next.byteSize
                dc = channel
            }
            try {
                val (seq, bundle) = crypto.encryptToBytesWithSeq(next.text)
                val dshu = DshuFrameCodec.encode(seq, bundle)
                val chunks = RtcChunkCodec.encode(dshu, messageIdGen::next)
                for (chunk in chunks) {
                    if (!dc.send(chunk)) {
                        throw IllegalStateException("WebRTC DataChannel 发送失败")
                    }
                }
            } catch (error: Throwable) {
                synchronized(outboundLock) { sendDrainScheduled = false }
                if (state == State.ACTIVE) {
                    onFatalError(error)
                }
                return
            }
        }
    }

    private fun cancelTimers() {
        negotiateTimeoutJob?.cancel()
        activateTimeoutJob?.cancel()
        attemptTtlJob?.cancel()
        drainTimeoutJob?.cancel()
        gapTimeoutJob?.cancel()
        negotiateTimeoutJob = null
        activateTimeoutJob = null
        attemptTtlJob = null
        drainTimeoutJob = null
        gapTimeoutJob = null
    }
}
