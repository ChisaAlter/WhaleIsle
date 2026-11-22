package ai.deepseek.harness.mobile.remote

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class RtcChunkCodecTest {
    private fun fakeBundle(seq: Long, bodyBytes: Int = 32): ByteArray {
        val out = ByteArray(24 + bodyBytes)
        for (i in 0 until 16) out[i] = (i + 1).toByte()
        ByteBuffer.wrap(out, 16, 8).order(ByteOrder.LITTLE_ENDIAN).putLong(seq)
        for (i in 24 until out.size) out[i] = ((i * 31) and 0xFF).toByte()
        return out
    }

    @Test
    fun dshuFrameRoundTripsAndValidatesHeaderMatchesBundleSeq() {
        val bundle = fakeBundle(seq = 42L, bodyBytes = 64)
        val encoded = DshuFrameCodec.encode(42L, bundle)
        assertEquals(DSHU_HEADER_BYTES + bundle.size, encoded.size)
        assertTrue(DshuFrameCodec.hasMagic(encoded))
        assertEquals(42L, ByteBuffer.wrap(encoded, 4, 8).order(ByteOrder.BIG_ENDIAN).long)

        val decoded = DshuFrameCodec.decode(encoded)
        assertEquals(42L, decoded.seq)
        assertArrayEquals(bundle, decoded.bundle)

        // Mismatched header vs bundle seq is rejected on encode and decode
        assertThrows(IllegalArgumentException::class.java) { DshuFrameCodec.encode(43L, bundle) }
        val tampered = encoded.copyOf()
        ByteBuffer.wrap(tampered, 4, 8).order(ByteOrder.BIG_ENDIAN).putLong(99L)
        assertThrows(IllegalArgumentException::class.java) { DshuFrameCodec.decode(tampered) }

        // Bad magic or truncated frame rejected
        val badMagic = encoded.copyOf().also { it[0] = 'X'.code.toByte() }
        assertThrows(IllegalArgumentException::class.java) { DshuFrameCodec.decode(badMagic) }
        assertThrows(IllegalArgumentException::class.java) { DshuFrameCodec.decode(ByteArray(20)) }
    }

    @Test
    fun rtchExactBoundary8192IsUnchunkedAnd8193ChunksIntoTwo() {
        val idGen = RtcMessageIdGenerator()
        val decoder = RtcChunkDecoder()

        val exactBundle = fakeBundle(seq = 1L, bodyBytes = RTC_CHUNK_PAYLOAD_BYTES - DSHU_HEADER_BYTES - 24)
        val exactDshu = DshuFrameCodec.encode(1L, exactBundle)
        assertEquals(RTC_CHUNK_PAYLOAD_BYTES, exactDshu.size)

        val exactFrames = RtcChunkCodec.encode(exactDshu, idGen::next)
        assertEquals(1, exactFrames.size)
        assertFalse(RtcChunkCodec.hasRtchMagic(exactFrames[0]))
        assertArrayEquals(exactDshu, decoder.feed(exactFrames[0]))

        val overBundle = fakeBundle(seq = 2L, bodyBytes = RTC_CHUNK_PAYLOAD_BYTES - DSHU_HEADER_BYTES - 24 + 1)
        val overDshu = DshuFrameCodec.encode(2L, overBundle)
        assertEquals(RTC_CHUNK_PAYLOAD_BYTES + 1, overDshu.size)

        val overFrames = RtcChunkCodec.encode(overDshu, idGen::next)
        assertEquals(2, overFrames.size)
        assertTrue(RtcChunkCodec.hasRtchMagic(overFrames[0]))
        assertEquals(RTCH_HEADER_BYTES + RTC_CHUNK_PAYLOAD_BYTES, overFrames[0].size)
        assertEquals(RTCH_HEADER_BYTES + 1, overFrames[1].size)

        assertNull(decoder.feed(overFrames[0]))
        val reassembled = decoder.feed(overFrames[1])
        assertNotNull(reassembled)
        assertArrayEquals(overDshu, reassembled)
    }

    @Test
    fun rtchLargeOver64KiBAnd4MiBMaxRoundTripAndExceeding4MiBRejected() {
        val idGen = RtcMessageIdGenerator()
        val decoder = RtcChunkDecoder()

        val largeBundle = fakeBundle(seq = 7L, bodyBytes = 120 * 1024)
        val largeDshu = DshuFrameCodec.encode(7L, largeBundle)
        val chunks = RtcChunkCodec.encode(largeDshu, idGen::next)
        assertTrue(chunks.size >= 15)

        var output: ByteArray? = null
        for ((i, chunk) in chunks.withIndex()) {
            val res = decoder.feed(chunk)
            if (i < chunks.lastIndex) assertNull(res) else output = res
        }
        assertArrayEquals(largeDshu, output)
        assertEquals(0, decoder.inFlightCount())

        // Exact 4 MiB boundary succeeds (512 chunks)
        val maxPayload = ByteArray(RTC_CHUNK_MAX_MESSAGE_BYTES) { (it and 0xFF).toByte() }
        maxPayload[0] = 'D'.code.toByte()
        val maxChunks = RtcChunkCodec.encode(maxPayload, idGen::next)
        assertEquals(RTC_CHUNK_MAX_TOTAL, maxChunks.size)
        var maxOut: ByteArray? = null
        for (chunk in maxChunks) maxOut = decoder.feed(chunk)
        assertArrayEquals(maxPayload, maxOut)

        // 4 MiB + 1 rejected
        assertThrows(IllegalArgumentException::class.java) {
            RtcChunkCodec.encode(ByteArray(RTC_CHUNK_MAX_MESSAGE_BYTES + 1), idGen::next)
        }
    }

    @Test
    fun rtchDecoderRejectsCorruptOutOfOrderOverflowAndExpiredAssemblies() {
        var now = 1_000L
        val idGen = RtcMessageIdGenerator()
        val decoder = RtcChunkDecoder(clock = { now })

        val payload = DshuFrameCodec.encode(10L, fakeBundle(10L, 20_000))
        val chunks = RtcChunkCodec.encode(payload, idGen::next)
        assertEquals(3, chunks.size)

        // Starting with index != 0 rejected
        assertThrows(IllegalArgumentException::class.java) { decoder.feed(chunks[1]) }

        // Short non-last chunk rejected
        val shortFirst = chunks[0].copyOf(RTCH_HEADER_BYTES + 100)
        assertThrows(IllegalArgumentException::class.java) { decoder.feed(shortFirst) }

        // Duplicate chunk rejected
        assertNull(decoder.feed(chunks[0]))
        assertThrows(IllegalArgumentException::class.java) { decoder.feed(chunks[0]) }

        // Assembly expiration (> 30s) rejected
        now += RTC_CHUNK_MAX_ASSEMBLY_AGE_MS + 1
        assertThrows(IllegalStateException::class.java) { decoder.feed(chunks[1]) }

        // > 8 concurrent in-flight messages rejected
        val decoder2 = RtcChunkDecoder(clock = { now })
        val pending = (1..RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES).map { seq ->
            RtcChunkCodec.encode(DshuFrameCodec.encode(seq.toLong(), fakeBundle(seq.toLong(), 10_000)), idGen::next)
        }
        for (c in pending) assertNull(decoder2.feed(c[0]))
        assertEquals(RTC_CHUNK_MAX_IN_FLIGHT_MESSAGES, decoder2.inFlightCount())
        val ninth = RtcChunkCodec.encode(DshuFrameCodec.encode(99L, fakeBundle(99L, 10_000)), idGen::next)
        assertThrows(IllegalArgumentException::class.java) { decoder2.feed(ninth[0]) }

        // Completing the 8 interleaved in-flight messages succeeds
        for (c in pending) assertNotNull(decoder2.feed(c[1]))
        assertEquals(0, decoder2.inFlightCount())
    }

    @Test
    fun reorderBufferReleasesStrictlyInOrderAndEnforcesLimitsAndGapTimeout() {
        var now = 5_000L
        val buffer = SequencedCiphertextReorderBuffer(initialNextExpectedSeq = 5L, clock = { now })

        // Seq 6 and 7 arrive early from DataChannel while seq 5 is still in-flight on Relay WS
        assertEquals(emptyList<Pair<Long, ByteArray>>(), buffer.push(6L, fakeBundle(6L)))
        assertEquals(emptyList<Pair<Long, ByteArray>>(), buffer.push(7L, fakeBundle(7L)))
        assertTrue(buffer.hasGap())
        assertEquals(2, buffer.bufferedFrameCount())

        // Duplicate buffered seq rejected
        assertThrows(IllegalArgumentException::class.java) { buffer.push(6L, fakeBundle(6L)) }
        // Replay seq < nextExpectedSeq rejected
        assertThrows(IllegalArgumentException::class.java) { buffer.push(4L, fakeBundle(4L)) }

        // Seq 5 arrives -> releases 5, 6, 7 in exact order
        val released = buffer.push(5L, fakeBundle(5L))
        assertEquals(listOf(5L, 6L, 7L), released.map { it.first })
        assertFalse(buffer.hasGap())
        assertEquals(8L, buffer.nextExpectedSeq())

        // Gap timeout after 5000ms
        assertEquals(emptyList<Pair<Long, ByteArray>>(), buffer.push(9L, fakeBundle(9L)))
        now += REORDER_GAP_TIMEOUT_MS
        buffer.checkGapTimeout() // exactly at boundary is still valid
        now += 1
        assertThrows(IllegalStateException::class.java) { buffer.checkGapTimeout() }

        // Frame count cap (256)
        val capBuf = SequencedCiphertextReorderBuffer(initialNextExpectedSeq = 0L, maxFrames = 3)
        capBuf.push(1L, fakeBundle(1L))
        capBuf.push(2L, fakeBundle(2L))
        capBuf.push(3L, fakeBundle(3L))
        assertThrows(IllegalStateException::class.java) { capBuf.push(4L, fakeBundle(4L)) }

        // Byte cap
        val byteBuf = SequencedCiphertextReorderBuffer(initialNextExpectedSeq = 0L, maxBytes = 100)
        byteBuf.push(1L, fakeBundle(1L, 36)) // 60B
        assertThrows(IllegalStateException::class.java) { byteBuf.push(2L, fakeBundle(2L, 36)) } // 120B > 100B
    }
}
