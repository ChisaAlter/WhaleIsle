package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList

class RelayInteropTest {
    private fun peer(mode: String) = ProcessBuilder("node", File("src/test/fixtures/relay-peer.mjs").absolutePath, mode).redirectError(ProcessBuilder.Redirect.INHERIT).start()
    @Test fun naclFramesAndProofInteroperateWithDesktopAndRejectReplayTamperingAndSaltChanges() {
        val crypto = RelayCrypto("B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=")
        val process = peer("crypto")
        try {
            process.outputStream.bufferedWriter().use { it.write(obj("key" to crypto.publicKeyB64,"frame" to crypto.encrypt("手机请求")).toString()); it.newLine() }
            val result = Json.parseToJsonElement(process.inputStream.bufferedReader().readLine()).objectValue()
            assertEquals("手机请求",result.string("plain"))
            assertEquals(result.string("proof"),crypto.proof("native-interop-secret-012345678901234567890","native-test","B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=","device-test","challenge-test"))
            val altered = Base64.getDecoder().decode(result.string("frame0")); altered[altered.lastIndex] = (altered.last().toInt() xor 1).toByte()
            assertThrows(IllegalStateException::class.java) { crypto.decrypt(Base64.getEncoder().encodeToString(altered)) }
            assertEquals("桌面回复",crypto.decrypt(result.string("frame0")))
            assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(result.string("frame0")) }
            assertEquals("桌面回复",crypto.decrypt(result.string("frame1")))
            assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(result.string("changedSalt")) }
            assertThrows(IllegalArgumentException::class.java) { crypto.decrypt(result.string("frame0")) }
        } finally { process.destroyForcibly() }
    }
    @Test fun freshPairingSavedSecretReconnectRpcErrorsAndMuxUseDesktopEncryptedChannel() = runBlocking {
        val process = peer("server")
        val records = CopyOnWriteArrayList<SavedComputer>()
        var client: RelayClient? = null
        try {
            val config = Json.parseToJsonElement(process.inputStream.bufferedReader().readLine()).objectValue()
            val offer = Offer(2,"native-test",config.string("key"),RelayOffer("127.0.0.1:${config["port"].number()}",false),
                AuthBootstrap(1,"fresh-pairing-token-123456789",System.currentTimeMillis()+60_000))
            val mux = CompletableDeferred<JsonObject>()
            client = RelayClient(offer,null,"Kotlin phone",records::add,{mux.complete(it)},{})
            client.connect()
            assertTrue(client.connected)
            assertEquals("Native test desktop",records.last().computerName)
            val answer = client.host("session.list",obj("sample" to "native")).objectValue()
            assertEquals("session.list",answer.string("method"))
            assertEquals("native",answer["payload"].objectValue().string("sample"))
            assertEquals("git-status",client.git("git-status","C:/repo").objectValue().string("action"))
            try { client.host("fail"); fail("RPC error was hidden") } catch (error: IllegalStateException) { assertEquals("Expected RPC failure",error.message) }
            client.subscribe()
            assertEquals("session/event",withTimeout(5_000) { mux.await() }["envelope"].objectValue().string("type"))
            client.close()
            val saved = records.last()
            client = RelayClient(saved.offer(),saved,"Kotlin phone",records::add,{},{})
            client.connect()
            assertTrue(client.connected)
            assertEquals("session.list",client.host("session.list").objectValue().string("method"))
            client.close()
            client = RelayClient(saved.offer(),saved.copy(deviceSecret="wrong-secret"),"Kotlin phone",records::add,{},{})
            try { client.connect(); fail("Invalid saved credentials accepted") } catch (_: IllegalArgumentException) { }
            assertFalse(client.connected)
        } finally { client?.close(); process.destroyForcibly() }
    }

    @Test fun dshuAndRtchBinaryFramingInteroperatesByteExactWithNode() {
        val crypto = RelayCrypto("B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=")
        val process = peer("webrtc_framing")
        try {
            val largeText = "K".repeat(72 * 1024)
            val (seq, rawBundle) = crypto.encryptToBytesWithSeq(largeText)
            assertEquals(0L, seq)
            assertEquals(1L, crypto.peekNextSendSeq())
            val dshu = DshuFrameCodec.encode(seq, rawBundle)
            val idGen = RtcMessageIdGenerator()
            val chunks = RtcChunkCodec.encode(dshu, idGen::next)
            assertTrue("Expected >1 chunk for 72 KiB payload", chunks.size >= 9)

            val b64Chunks = chunks.map { Base64.getEncoder().encodeToString(it) }
            process.outputStream.bufferedWriter().use {
                it.write(obj("key" to crypto.publicKeyB64, "chunks" to b64Chunks, "replySeq" to 5).toString())
                it.newLine()
            }

            val result = Json.parseToJsonElement(process.inputStream.bufferedReader().readLine()).objectValue()
            assertEquals(largeText.length, result["plainLength"].number()?.toInt())
            assertEquals(0L, result["headerSeq"].number())

            val nodeChunks = result["chunks"].arrayValue().map { Base64.getDecoder().decode(it.text()) }
            assertTrue("Expected >1 chunk from Node", nodeChunks.size >= 9)
            val decoder = RtcChunkDecoder()
            var reassembled: ByteArray? = null
            for (chunk in nodeChunks) {
                reassembled = decoder.feed(chunk)
            }
            assertNotNull(reassembled)
            val decodedDshu = DshuFrameCodec.decode(reassembled!!)
            assertEquals(5L, decodedDshu.seq)
            val decodedPlain = crypto.decryptFromBytes(decodedDshu.bundle)
            assertEquals(result["replyPlainLength"].number()?.toInt(), decodedPlain.length)
            assertTrue(decodedPlain.startsWith("node-ack:${largeText.length}:"))
        } finally {
            process.destroyForcibly()
        }
    }
}
