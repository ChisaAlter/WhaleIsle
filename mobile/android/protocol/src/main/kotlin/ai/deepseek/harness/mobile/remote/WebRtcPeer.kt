package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.IceServerConfig

data class SessionDescriptionData(
    val type: String, // "offer" | "answer"
    val sdp: String,
)

data class IceCandidateData(
    val candidate: String,
    val sdpMid: String?,
    val sdpMLineIndex: Int?,
)

enum class WebRtcConnectionState {
    NEW,
    CONNECTING,
    CONNECTED,
    DISCONNECTED,
    FAILED,
    CLOSED,
}

interface WebRtcDataChannelObserver {
    fun onOpen()
    fun onMessage(bytes: ByteArray)
    fun onClose()
}

interface WebRtcDataChannel {
    val label: String
    fun setObserver(observer: WebRtcDataChannelObserver?)
    fun send(bytes: ByteArray): Boolean
    fun bufferedAmount(): Long
    fun close()
}

interface WebRtcPeerObserver {
    fun onIceCandidate(candidate: IceCandidateData?)
    fun onConnectionStateChange(state: WebRtcConnectionState)
}

interface WebRtcPeerConnection {
    fun createDataChannel(label: String, ordered: Boolean = true): WebRtcDataChannel
    suspend fun createOffer(): SessionDescriptionData
    suspend fun setLocalDescription(sdp: SessionDescriptionData)
    suspend fun setRemoteDescription(sdp: SessionDescriptionData)
    fun addIceCandidate(candidate: IceCandidateData)
    fun close()
}

interface WebRtcPeerFactory {
    fun createPeerConnection(
        iceServers: List<IceServerConfig>,
        observer: WebRtcPeerObserver,
    ): WebRtcPeerConnection
}
