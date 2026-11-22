package ai.deepseek.harness.mobile.webrtc

import ai.deepseek.harness.mobile.pair.IceServerConfig
import ai.deepseek.harness.mobile.remote.IceCandidateData
import ai.deepseek.harness.mobile.remote.SessionDescriptionData
import ai.deepseek.harness.mobile.remote.WebRtcConnectionState
import ai.deepseek.harness.mobile.remote.WebRtcDataChannel
import ai.deepseek.harness.mobile.remote.WebRtcDataChannelObserver
import ai.deepseek.harness.mobile.remote.WebRtcPeerConnection
import ai.deepseek.harness.mobile.remote.WebRtcPeerFactory
import ai.deepseek.harness.mobile.remote.WebRtcPeerObserver
import android.content.Context
import kotlinx.coroutines.CompletableDeferred
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android native libwebrtc (io.getstream:stream-webrtc-android) implementation of WebRtcPeerFactory.
 * Uses a dedicated single-thread executor for DataChannel operations & native disposal to prevent
 * deadlocks when closing from inside libwebrtc signaling/network callbacks.
 */
class AndroidWebRtcPeerFactory(context: Context) : WebRtcPeerFactory {
    private val appContext = context.applicationContext

    private fun getOrCreateFactory(): PeerConnectionFactory {
        synchronized(FACTORY_LOCK) {
            sharedFactory?.let { return it }
            if (!initialized) {
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions
                        .builder(appContext)
                        .setEnableInternalTracer(false)
                        .createInitializationOptions(),
                )
                initialized = true
            }
            return PeerConnectionFactory.builder()
                .createPeerConnectionFactory()
                .also { sharedFactory = it }
        }
    }

    override fun createPeerConnection(
        iceServers: List<IceServerConfig>,
        observer: WebRtcPeerObserver,
    ): WebRtcPeerConnection {
        val factory = getOrCreateFactory()
        val rtcServers = iceServers.mapNotNull { config ->
            if (config.urls.isEmpty()) return@mapNotNull null
            val builder = PeerConnection.IceServer.builder(config.urls)
            if (!config.username.isNullOrEmpty()) builder.setUsername(config.username)
            if (!config.credential.isNullOrEmpty()) builder.setPassword(config.credential)
            builder.createIceServer()
        }
        val rtcConfig = PeerConnection.RTCConfiguration(rtcServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        }

        val executor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "dsh-android-rtc").apply { isDaemon = true }
        }
        val closed = AtomicBoolean(false)

        val pcObserver = object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate?) {
                if (closed.get()) return
                val mapped = candidate?.let {
                    IceCandidateData(
                        candidate = it.sdp,
                        sdpMid = it.sdpMid,
                        sdpMLineIndex = it.sdpMLineIndex,
                    )
                }
                observer.onIceCandidate(mapped)
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                if (closed.get()) return
                val mapped = when (newState) {
                    PeerConnection.PeerConnectionState.NEW -> WebRtcConnectionState.NEW
                    PeerConnection.PeerConnectionState.CONNECTING -> WebRtcConnectionState.CONNECTING
                    PeerConnection.PeerConnectionState.CONNECTED -> WebRtcConnectionState.CONNECTED
                    PeerConnection.PeerConnectionState.DISCONNECTED -> WebRtcConnectionState.DISCONNECTED
                    PeerConnection.PeerConnectionState.FAILED -> WebRtcConnectionState.FAILED
                    PeerConnection.PeerConnectionState.CLOSED -> WebRtcConnectionState.CLOSED
                    null -> return
                }
                observer.onConnectionStateChange(mapped)
            }

            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
                if (closed.get()) return
                if (newState == PeerConnection.IceConnectionState.FAILED) {
                    observer.onConnectionStateChange(WebRtcConnectionState.FAILED)
                } else if (newState == PeerConnection.IceConnectionState.CLOSED) {
                    observer.onConnectionStateChange(WebRtcConnectionState.CLOSED)
                }
            }

            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {
                if (closed.get()) return
                if (newState == PeerConnection.IceGatheringState.COMPLETE) {
                    observer.onIceCandidate(null)
                }
            }

            override fun onSignalingChange(newState: PeerConnection.SignalingState?) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dataChannel: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {}
        }

        val pc = factory.createPeerConnection(rtcConfig, pcObserver)
            ?: run {
                executor.shutdownNow()
                error("无法创建 Android WebRTC PeerConnection")
            }

        return AndroidWebRtcPeerConnection(pc, executor, closed)
    }

    private class AndroidWebRtcPeerConnection(
        private val pc: PeerConnection,
        private val executor: java.util.concurrent.ExecutorService,
        private val closed: AtomicBoolean,
    ) : WebRtcPeerConnection {
        private val channels = CopyOnWriteArrayList<AndroidWebRtcDataChannel>()

        override fun createDataChannel(label: String, ordered: Boolean): WebRtcDataChannel {
            check(!closed.get()) { "PeerConnection 已关闭" }
            val init = DataChannel.Init().apply {
                this.ordered = ordered
            }
            val nativeChannel = pc.createDataChannel(label, init)
                ?: error("无法创建 WebRTC DataChannel: $label")
            return AndroidWebRtcDataChannel(label, nativeChannel, executor, closed).also {
                channels.add(it)
            }
        }

        override suspend fun createOffer(): SessionDescriptionData {
            check(!closed.get()) { "PeerConnection 已关闭" }
            val result = CompletableDeferred<SessionDescriptionData>()
            pc.createOffer(
                object : SdpObserver {
                    override fun onCreateSuccess(sdp: SessionDescription?) {
                        if (sdp == null) {
                            result.completeExceptionally(IllegalStateException("createOffer 返回空 SDP"))
                        } else {
                            result.complete(
                                SessionDescriptionData(
                                    type = sdp.type.canonicalForm(),
                                    sdp = sdp.description,
                                ),
                            )
                        }
                    }

                    override fun onCreateFailure(error: String?) {
                        result.completeExceptionally(IllegalStateException(error ?: "createOffer 失败"))
                    }

                    override fun onSetSuccess() {}
                    override fun onSetFailure(error: String?) {}
                },
                MediaConstraints(),
            )
            return result.await()
        }

        override suspend fun setLocalDescription(sdp: SessionDescriptionData) {
            check(!closed.get()) { "PeerConnection 已关闭" }
            val result = CompletableDeferred<Unit>()
            val nativeSdp = SessionDescription(SessionDescription.Type.fromCanonicalForm(sdp.type), sdp.sdp)
            pc.setLocalDescription(
                object : SdpObserver {
                    override fun onSetSuccess() {
                        result.complete(Unit)
                    }

                    override fun onSetFailure(error: String?) {
                        result.completeExceptionally(IllegalStateException(error ?: "setLocalDescription 失败"))
                    }

                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                },
                nativeSdp,
            )
            result.await()
        }

        override suspend fun setRemoteDescription(sdp: SessionDescriptionData) {
            check(!closed.get()) { "PeerConnection 已关闭" }
            val result = CompletableDeferred<Unit>()
            val nativeSdp = SessionDescription(SessionDescription.Type.fromCanonicalForm(sdp.type), sdp.sdp)
            pc.setRemoteDescription(
                object : SdpObserver {
                    override fun onSetSuccess() {
                        result.complete(Unit)
                    }

                    override fun onSetFailure(error: String?) {
                        result.completeExceptionally(IllegalStateException(error ?: "setRemoteDescription 失败"))
                    }

                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                },
                nativeSdp,
            )
            result.await()
        }

        override fun addIceCandidate(candidate: IceCandidateData) {
            if (closed.get()) return
            val ice = IceCandidate(
                candidate.sdpMid ?: "",
                candidate.sdpMLineIndex ?: 0,
                candidate.candidate,
            )
            runCatching { pc.addIceCandidate(ice) }
        }

        override fun close() {
            if (!closed.compareAndSet(false, true)) return
            val snapshot = ArrayList(channels)
            channels.clear()
            runCatching {
                executor.execute {
                    for (channel in snapshot) {
                        channel.disposeOnExecutor()
                    }
                    runCatching { pc.close() }
                    runCatching { pc.dispose() }
                    executor.shutdown()
                }
            }.onFailure {
                executor.shutdownNow()
            }
        }
    }

    private class AndroidWebRtcDataChannel(
        override val label: String,
        private val dc: DataChannel,
        private val executor: java.util.concurrent.ExecutorService,
        private val peerClosed: AtomicBoolean,
    ) : WebRtcDataChannel {
        private val disposed = AtomicBoolean(false)
        @Volatile
        private var activeObserver: WebRtcDataChannelObserver? = null

        private val nativeObserver = object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {}

            override fun onStateChange() {
                if (disposed.get() || peerClosed.get()) return
                when (dc.state()) {
                    DataChannel.State.OPEN -> activeObserver?.onOpen()
                    DataChannel.State.CLOSED -> activeObserver?.onClose()
                    else -> Unit
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) {
                if (disposed.get() || peerClosed.get()) return
                // Immediately copy native buffer bytes on callback thread before dispatching.
                val data = buffer.data
                val bytes = ByteArray(data.remaining())
                data.get(bytes)
                activeObserver?.onMessage(bytes)
            }
        }

        init {
            dc.registerObserver(nativeObserver)
        }

        override fun setObserver(observer: WebRtcDataChannelObserver?) {
            this.activeObserver = observer
            if (observer != null && !disposed.get() && !peerClosed.get() && dc.state() == DataChannel.State.OPEN) {
                observer.onOpen()
            }
        }

        override fun send(bytes: ByteArray): Boolean {
            if (disposed.get() || peerClosed.get()) return false
            return try {
                val future = executor.submit<Boolean> {
                    if (disposed.get() || peerClosed.get()) return@submit false
                    dc.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), true))
                }
                future.get()
            } catch (_: Throwable) {
                false
            }
        }

        override fun bufferedAmount(): Long {
            if (disposed.get() || peerClosed.get()) return 0L
            return runCatching { dc.bufferedAmount() }.getOrDefault(0L)
        }

        override fun close() {
            activeObserver = null
            if (!disposed.compareAndSet(false, true)) return
            runCatching {
                executor.execute {
                    runCatching { dc.unregisterObserver() }
                    runCatching { dc.close() }
                    runCatching { dc.dispose() }
                }
            }
        }

        fun disposeOnExecutor() {
            activeObserver = null
            if (!disposed.compareAndSet(false, true)) return
            runCatching { dc.unregisterObserver() }
            runCatching { dc.close() }
            runCatching { dc.dispose() }
        }
    }

    companion object {
        private val FACTORY_LOCK = Any()
        private var initialized = false
        private var sharedFactory: PeerConnectionFactory? = null
    }
}
