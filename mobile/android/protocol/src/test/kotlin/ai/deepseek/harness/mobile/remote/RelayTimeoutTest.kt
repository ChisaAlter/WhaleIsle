package ai.deepseek.harness.mobile.remote

import ai.deepseek.harness.mobile.pair.Offer
import ai.deepseek.harness.mobile.pair.RelayOffer
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import okhttp3.Request
import okhttp3.WebSocket
import okio.ByteString
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

@OptIn(ExperimentalCoroutinesApi::class)
class RelayTimeoutTest {
    @Test fun pluginMutationsHaveBoundedLongWaitWhileOrdinaryRequestsKeepThirtySeconds() = runTest {
        val key = Base64.getEncoder().encodeToString(ByteArray(32) { (it + 1).toByte() })
        val client = object : RelayClient(Offer(2, "test", key, RelayOffer("127.0.0.1:1", false), null), null, "QA", {}, {}, {}) {
            init { connected = true }
        }
        val socket = object : WebSocket {
            override fun request() = Request.Builder().url("http://127.0.0.1/").build()
            override fun queueSize() = 0L
            override fun send(text: String) = true
            override fun send(bytes: ByteString) = true
            override fun close(code: Int, reason: String?) = true
            override fun cancel() {}
        }
        client.onOpen(socket, okhttp3.Response.Builder().request(socket.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(101).message("upgrade").build())
        try {
            val normal = async { runCatching { client.host("session.list") } }
            val install = async { runCatching { client.host("pluginManager.installBundle") } }
            val remove = async { runCatching { client.host("pluginManager.removeBundle") } }
            val recovery = async { runCatching { client.host("pluginManager.waitForInstall") } }
            runCurrent(); advanceTimeBy(29_999); runCurrent()
            assertTrue(normal.isActive); assertTrue(install.isActive); assertTrue(remove.isActive); assertTrue(recovery.isActive)
            advanceTimeBy(1); runCurrent()
            assertTrue(normal.await().exceptionOrNull() is TimeoutCancellationException)
            assertTrue(install.isActive); assertTrue(remove.isActive); assertTrue(recovery.isActive)
            advanceTimeBy(689_999); runCurrent()
            assertTrue(install.isActive); assertTrue(remove.isActive); assertTrue(recovery.isActive)
            advanceTimeBy(1); runCurrent()
            assertTrue(install.await().exceptionOrNull() is TimeoutCancellationException)
            assertTrue(remove.await().exceptionOrNull() is TimeoutCancellationException)
            assertTrue(recovery.await().exceptionOrNull() is TimeoutCancellationException)
        } finally { client.close() }
    }
}
