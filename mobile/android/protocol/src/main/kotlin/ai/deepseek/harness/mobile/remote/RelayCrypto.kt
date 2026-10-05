package ai.deepseek.harness.mobile.remote

import com.iwebpp.crypto.TweetNaclFast
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Same Curve25519 / XSalsa20-Poly1305 frames as @chisacode/relay. */
class RelayCrypto(daemonPublicKeyB64: String) {
    private val keys = TweetNaclFast.Box.keyPair()
    val publicKeyB64: String = Base64.getEncoder().encodeToString(keys.publicKey)
    private val peer = Base64.getDecoder().decode(daemonPublicKeyB64).also { require(it.size == 32) { "无效的电脑公钥" } }
    private val box = TweetNaclFast.Box(peer, keys.secretKey)
    private val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
    private var sendSeq = 0L
    private var receivedSeq: Long? = null
    private var receivedSalt: ByteArray? = null

    @Synchronized fun encrypt(text: String): String {
        check(sendSeq != -1L) { "加密序号已耗尽" }
        val nonce = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN).put(salt).putLong(sendSeq++).array()
        val encrypted = box.box(text.toByteArray(Charsets.UTF_8), nonce) ?: error("加密失败")
        return Base64.getEncoder().encodeToString(nonce + encrypted)
    }

    @Synchronized fun decrypt(frame: String): String {
        val bundle = Base64.getDecoder().decode(frame)
        require(bundle.size >= 40) { "无效的加密帧" }
        val nonce = bundle.copyOfRange(0, 24)
        val plain = box.open(bundle.copyOfRange(24, bundle.size), nonce) ?: error("消息认证失败")
        val nextSalt = nonce.copyOfRange(0, 16)
        val seq = ByteBuffer.wrap(nonce, 16, 8).order(ByteOrder.LITTLE_ENDIAN).long
        require(receivedSalt == null || receivedSalt!!.contentEquals(nextSalt)) { "加密通道 salt 改变" }
        require(receivedSeq == null || java.lang.Long.compareUnsigned(seq, receivedSeq!!) > 0) { "加密消息重放或乱序" }
        receivedSalt = nextSalt
        receivedSeq = seq
        return plain.toString(Charsets.UTF_8)
    }

    fun proof(secret: String, serverId: String, daemonKey: String, deviceId: String, challenge: String): String {
        val transcript = listOf("v=1", "serverId=$serverId", "daemonPublicKeyB64=$daemonKey",
            "clientPublicKeyB64=$publicKeyB64", "deviceId=$deviceId", "challenge=$challenge").joinToString("\n")
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(transcript.toByteArray(Charsets.UTF_8)))
    }
}
