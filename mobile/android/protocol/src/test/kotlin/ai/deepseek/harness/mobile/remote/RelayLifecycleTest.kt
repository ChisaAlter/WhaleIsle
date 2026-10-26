package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.Offer
import ai.deepseek.harness.mobile.pair.RelayOffer
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.Request
import okhttp3.WebSocket
import okio.ByteString
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class RelayLifecycleTest {
    private fun client(): RelayClient {
        val key = Base64.getEncoder().encodeToString(ByteArray(32) { (it + 1).toByte() })
        val saved = SavedComputer("test", "device", "local-test-secret", key, "127.0.0.1:1", false)
        return RelayClient(Offer(2, "test", key, RelayOffer("127.0.0.1:1", false), null), saved, "test phone", {}, {}, {})
    }
    @Test fun authenticationCloseIsTerminalAndLaterCloseCannotReplaceTheReason() = runBlocking {
        val relay = client()
        try {
            val socket = FakeSocket()
            relay.onClosing(socket, 4401, "Relay device auth failed")
            relay.onClosed(socket, 1000, "closed")
            val failure = withTimeout(1_000) { relay.awaitDisconnect() }
            assertTrue(failure is RelayAuthenticationException)
            assertEquals("配对授权已失效，请重新扫码", failure.message)
            assertFalse(relay.connected)
            assertEquals(4401, socket.closeCode)
        } finally { relay.close() }
    }
    @Test fun transportFailureWakesRecoveryAndKeepsTheActualCause() = runBlocking {
        val relay = client()
        try {
            val failure = java.io.IOException("relay transport lost")
            relay.onFailure(FakeSocket(), failure, null)
            assertSame(failure, withTimeout(1_000) { relay.awaitDisconnect() })
            assertEquals("relay transport lost", relay.status.value)
        } finally { relay.close() }
    }
    private class FakeSocket : WebSocket {
        var closeCode = 0
        override fun request() = Request.Builder().url("http://127.0.0.1/").build()
        override fun queueSize() = 0L
        override fun send(text: String) = true
        override fun send(bytes: ByteString) = true
        override fun close(code: Int, reason: String?): Boolean { closeCode = code; return true }
        override fun cancel() {}
    }
}
