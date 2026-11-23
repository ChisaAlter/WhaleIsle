package ai.deepseek.harness.mobile.remote

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger

const val DSHU_HEADER_BYTES: Int = 12
const val RTCH_HEADER_BYTES: Int = 12
const val RTC_CHUNK_PAYLOAD_BYTES: Int = 8 * 1024
const val RTC_CHUNK_MAX_MESSAGE_BYTES: Int = 4 * 1024 * 1024
const val RTC_CHUNK_MAX_TOTAL: Int = RTC_CHUNK_MAX_MESSAGE_BYTES / RTC_CHUNK_PAYLOAD_BYTES // 512
const val RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES: Int = 8
const val RTC_CHUNK_MAX_ASSEMBLY_AGE_MS: Long = 30_000L

const val REORDER_MAX_BUFFERED_FRAMES: Int = 256
const val REORDER_MAX_BUFFERED_BYTES: Int = 4 * 1024 * 1024
const val REORDER_GAP_TIMEOUT_MS: Long = 5_000L

data class DshuFrame(
    val seq: Long,
    val bundle: ByteArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DshuFrame) return false
        return seq == other.seq && bundle.contentEquals(other.bundle)
    }

    override fun hashCode(): Int = 31 * seq.hashCode() + bundle.contentHashCode()
}

/**
 * DSHU framing (12-byte header + raw TweetNaCl bundle):
 * - [0..4): ASCII "DSHU" (0x44 0x53 0x48 0x55)
 * - [4..12): uint64 big-endian seq (must equal uint64 little-endian seq at bundle[16..24))
 * - [12..): raw bundle ([0..16) salt | [16..24) uint64_le seq | [24..) box ciphertext)
 */
object DshuFrameCodec {
    private val MAGIC = byteArrayOf(0x44, 0x53, 0x48, 0x55) // "DSHU"

    fun hasMagic(bytes: ByteArray): Boolean =
        bytes.size >= 4 &&
            bytes[0] == MAGIC[0] &&
            bytes[1] == MAGIC[1] &&
            bytes[2] == MAGIC[2] &&
            bytes[3] == MAGIC[3]

    fun encode(seq: Long, bundle: ByteArray): ByteArray {
        require(bundle.size >= RelayCrypto.MIN_BUNDLE_BYTES) { "无效的加密帧长度: ${bundle.size}" }
        val bundleSeq = RelayCrypto.extractSeqFromBundle(bundle)
        require(bundleSeq == seq) { "DSHU 序号与密文包序号不匹配: header=$seq bundle=$bundleSeq" }
        val out = ByteArray(DSHU_HEADER_BYTES + bundle.size)
        System.arraycopy(MAGIC, 0, out, 0, 4)
        ByteBuffer.wrap(out, 4, 8).order(ByteOrder.BIG_ENDIAN).putLong(seq)
        System.arraycopy(bundle, 0, out, DSHU_HEADER_BYTES, bundle.size)
        return out
    }

    fun decode(frame: ByteArray): DshuFrame {
        require(frame.size >= DSHU_HEADER_BYTES + RelayCrypto.MIN_BUNDLE_BYTES) {
            "DSHU 帧过短: ${frame.size}"
        }
        require(hasMagic(frame)) { "无效的 DSHU 魔数" }
        val headerSeq = ByteBuffer.wrap(frame, 4, 8).order(ByteOrder.BIG_ENDIAN).long
        val bundle = frame.copyOfRange(DSHU_HEADER_BYTES, frame.size)
        val bundleSeq = RelayCrypto.extractSeqFromBundle(bundle)
        require(headerSeq == bundleSeq) {
            "DSHU 帧头序号与密文包序号不匹配: header=$headerSeq bundle=$bundleSeq"
        }
        return DshuFrame(seq = headerSeq, bundle = bundle)
    }
}

/**
 * RTCH chunking codec (12-byte big-endian header, only when payload > 8192B):
 * - <= 8192B: sent verbatim without RTCH header (DSHU magic never collides with RTCH).
 * - > 8192B: split into total = ceil(len / 8192) chunks (2..512):
 *   [0..4) "RTCH" (0x52 0x54 0x43 0x48)
 *   [4..8) uint32_be messageId (1..0xFFFFFFFF, never 0)
 *   [8..10) uint16_be index (0..total-1)
 *   [10..12) uint16_be total (2..512)
 *   [12..) chunk payload (non-last chunk MUST be 8192B; last chunk 1..8192B)
 */
object RtcChunkCodec {
    internal val MAGIC = byteArrayOf(0x52, 0x54, 0x43, 0x48) // "RTCH"

    fun hasRtchMagic(bytes: ByteArray): Boolean =
        bytes.size >= 4 &&
            bytes[0] == MAGIC[0] &&
            bytes[1] == MAGIC[1] &&
            bytes[2] == MAGIC[2] &&
            bytes[3] == MAGIC[3]

    fun encode(payload: ByteArray, nextMessageId: () -> Int): List<ByteArray> {
        require(payload.isNotEmpty()) { "RTCH 负载不能为空" }
        require(payload.size <= RTC_CHUNK_MAX_MESSAGE_BYTES) {
            "RTCH 消息超过上限: ${payload.size} > $RTC_CHUNK_MAX_MESSAGE_BYTES"
        }
        if (payload.size <= RTC_CHUNK_PAYLOAD_BYTES) {
            require(!hasRtchMagic(payload)) { "未分片负载不可包含 RTCH 魔数前缀" }
            return listOf(payload)
        }
        val total = (payload.size + RTC_CHUNK_PAYLOAD_BYTES - 1) / RTC_CHUNK_PAYLOAD_BYTES
        require(total in 2..RTC_CHUNK_MAX_TOTAL) { "RTCH 分片数非法: $total" }
        val messageId = nextMessageId()
        require(messageId != 0) { "RTCH messageId 不可为 0" }
        val chunks = ArrayList<ByteArray>(total)
        for (index in 0 until total) {
            val start = index * RTC_CHUNK_PAYLOAD_BYTES
            val end = minOf(start + RTC_CHUNK_PAYLOAD_BYTES, payload.size)
            val len = end - start
            val frame = ByteArray(RTCH_HEADER_BYTES + len)
            System.arraycopy(MAGIC, 0, frame, 0, 4)
            val header = ByteBuffer.wrap(frame, 4, 8).order(ByteOrder.BIG_ENDIAN)
            header.putInt(messageId)
            header.putShort(index.toShort())
            header.putShort(total.toShort())
            System.arraycopy(payload, start, frame, RTCH_HEADER_BYTES, len)
            chunks.add(frame)
        }
        return chunks
    }
}

class RtcMessageIdGenerator {
    private val counter = AtomicInteger(0)

    fun next(): Int {
        while (true) {
            val current = counter.get()
            val candidate = if (current == -1) 1 else current + 1
            val nonZero = if (candidate == 0) 1 else candidate
            if (counter.compareAndSet(current, nonZero)) return nonZero
        }
    }
}

class RtcChunkDecoder(
    private val clock: () -> Long = System::currentTimeMillis,
    private val maxInFlightMessages: Int = RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES,
    private val maxAssemblyAgeMs: Long = RTC_CHUNK_MAX_ASSEMBLY_AGE_MS,
) {
    private class Assembly(
        val total: Int,
        val createdAtMs: Long,
        val chunks: Array<ByteArray?> = arrayOfNulls(total),
        var nextIndex: Int = 0,
        var totalBytes: Int = 0,
    )

    private val assemblies = LinkedHashMap<Int, Assembly>()

    @Synchronized
    fun feed(frame: ByteArray): ByteArray? {
        val now = clock()
        checkExpired(now)
        if (!RtcChunkCodec.hasRtchMagic(frame)) {
            require(frame.isNotEmpty()) { "收到空 DataChannel 帧" }
            require(frame.size <= RTC_CHUNK_PAYLOAD_BYTES) {
                "未分片帧超过 8192B 上限: ${frame.size}"
            }
            return frame
        }
        require(frame.size > RTCH_HEADER_BYTES) { "RTCH 分片帧过短: ${frame.size}" }
        val header = ByteBuffer.wrap(frame, 4, 8).order(ByteOrder.BIG_ENDIAN)
        val messageId = header.int
        val index = header.short.toInt() and 0xFFFF
        val total = header.short.toInt() and 0xFFFF
        require(messageId != 0) { "RTCH messageId 非法: 0" }
        require(total in 2..RTC_CHUNK_MAX_TOTAL) { "RTCH total 非法: $total" }
        require(index in 0 until total) { "RTCH index 越界: $index / $total" }

        val chunkPayloadLen = frame.size - RTCH_HEADER_BYTES
        if (index < total - 1) {
            require(chunkPayloadLen == RTC_CHUNK_PAYLOAD_BYTES) {
                "RTCH 非末片长度必须为 $RTC_CHUNK_PAYLOAD_BYTES，实际: $chunkPayloadLen"
            }
        } else {
            require(chunkPayloadLen in 1..RTC_CHUNK_PAYLOAD_BYTES) {
                "RTCH 末片长度非法: $chunkPayloadLen"
            }
        }

        val existing = assemblies[messageId]
        val assembly = if (existing == null) {
            require(assemblies.size < maxInFlightMessages) {
                "RTCH 并发重组消息数超过上限: $maxInFlightMessages"
            }
            require(index == 0) { "RTCH 首片序号必须为 0，实际: $index" }
            Assembly(total = total, createdAtMs = now).also { assemblies[messageId] = it }
        } else {
            require(existing.total == total) {
                "RTCH total 不一致: expected=${existing.total} actual=$total"
            }
            require(index == existing.nextIndex) {
                "RTCH 分片乱序或重复: expected=${existing.nextIndex} actual=$index"
            }
            existing
        }

        val nextTotalBytes = assembly.totalBytes + chunkPayloadLen
        require(nextTotalBytes <= RTC_CHUNK_MAX_MESSAGE_BYTES) {
            "RTCH 重组消息超过上限: $nextTotalBytes > $RTC_CHUNK_MAX_MESSAGE_BYTES"
        }
        assembly.chunks[index] = frame.copyOfRange(RTCH_HEADER_BYTES, frame.size)
        assembly.nextIndex = index + 1
        assembly.totalBytes = nextTotalBytes

        if (assembly.nextIndex < assembly.total) return null

        assemblies.remove(messageId)
        val merged = ByteArray(assembly.totalBytes)
        var offset = 0
        for (chunk in assembly.chunks) {
            val part = chunk!!
            System.arraycopy(part, 0, merged, offset, part.size)
            offset += part.size
        }
        return merged
    }

    @Synchronized
    fun inFlightCount(): Int = assemblies.size

    @Synchronized
    fun clear() {
        assemblies.clear()
    }

    private fun checkExpired(now: Long) {
        for (assembly in assemblies.values) {
            if (now - assembly.createdAtMs > maxAssemblyAgeMs) {
                assemblies.clear()
                throw IllegalStateException("RTCH 分片重组超时")
            }
        }
    }
}

/**
 * Buffers out-of-order encrypted frames across Relay WS -> WebRTC DataChannel cutover
 * and releases them strictly in ascending nextExpectedSeq order to RelayCrypto.
 */
class SequencedCiphertextReorderBuffer(
    initialNextExpectedSeq: Long = 0L,
    private val clock: () -> Long = System::currentTimeMillis,
    private val maxFrames: Int = REORDER_MAX_BUFFERED_FRAMES,
    private val maxBytes: Int = REORDER_MAX_BUFFERED_BYTES,
    private val gapTimeoutMs: Long = REORDER_GAP_TIMEOUT_MS,
) {
    private var nextExpectedSeq: Long = initialNextExpectedSeq
    private val buffered = HashMap<Long, ByteArray>()
    private var bufferedBytes: Int = 0
    private var gapStartedAtMs: Long? = null

    @Synchronized
    fun push(seq: Long, bundle: ByteArray): List<Pair<Long, ByteArray>> {
        val cmp = java.lang.Long.compareUnsigned(seq, nextExpectedSeq)
        if (cmp < 0) {
            throw IllegalArgumentException("加密消息重放或乱序: seq=$seq expected>=$nextExpectedSeq")
        }
        if (cmp == 0) {
            val out = ArrayList<Pair<Long, ByteArray>>()
            out.add(seq to bundle)
            advanceExpectedSeq()
            while (true) {
                val next = buffered.remove(nextExpectedSeq) ?: break
                bufferedBytes -= next.size
                out.add(nextExpectedSeq to next)
                advanceExpectedSeq()
            }
            gapStartedAtMs = if (buffered.isEmpty()) null else clock()
            return out
        }

        // seq > nextExpectedSeq: buffer until missing seq arrives
        if (buffered.containsKey(seq)) {
            throw IllegalArgumentException("重复的加密消息序号: seq=$seq")
        }
        val now = clock()
        val gapStart = gapStartedAtMs
        if (gapStart == null) {
            gapStartedAtMs = now
        } else if (now - gapStart > gapTimeoutMs) {
            throw IllegalStateException("加密消息重排缺口超时")
        }
        if (buffered.size + 1 > maxFrames) {
            throw IllegalStateException("加密消息重排缓冲帧数超限: $maxFrames")
        }
        if (bufferedBytes + bundle.size > maxBytes) {
            throw IllegalStateException("加密消息重排缓冲字节数超限: $maxBytes")
        }
        buffered[seq] = bundle
        bufferedBytes += bundle.size
        return emptyList()
    }

    @Synchronized
    fun checkGapTimeout() {
        val gapStart = gapStartedAtMs ?: return
        if (buffered.isNotEmpty() && clock() - gapStart > gapTimeoutMs) {
            throw IllegalStateException("加密消息重排缺口超时")
        }
    }

    @Synchronized
    fun hasGap(): Boolean = buffered.isNotEmpty()

    @Synchronized
    fun bufferedFrameCount(): Int = buffered.size

    @Synchronized
    fun bufferedByteCount(): Int = bufferedBytes

    @Synchronized
    fun nextExpectedSeq(): Long = nextExpectedSeq

    @Synchronized
    fun clear() {
        buffered.clear()
        bufferedBytes = 0
        gapStartedAtMs = null
    }

    private fun advanceExpectedSeq() {
        check(nextExpectedSeq != -1L) { "接收序号已耗尽" }
        nextExpectedSeq += 1L
    }
}
