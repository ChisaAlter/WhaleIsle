package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.NativeAccountLogin
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger

class NativeAccountLoginTest {
    @Test(timeout = 15_000) fun successfulCallbackBridgesDecodedParametersAndClosesListener() = runBlocking {
        val login = NativeAccountLogin()
        val received = CompletableDeferred<Pair<String, String>>()
        val completion = CompletableDeferred<String>()
        val waiting = async { runCatching { login.awaitCallback { code, state ->
            received.complete(code to state)
            completion.await()
        } } }
        try {
            val response = async { request(login.origin, "/oauth/callback?code=code%2Bvalue&state=state%2Fvalue") }
            assertEquals("code+value" to "state/value", withTimeout(5_000) { received.await() })
            assertFalse("The browser must wait for completion", response.isCompleted)
            completion.complete("https://platform.example/dsh/authorized?result=complete")
            val http = withTimeout(5_000) { response.await() }
            assertEquals("HTTP/1.1 302 Found", http.lineSequence().first())
            assertTrue(http.contains("\r\nLocation: https://platform.example/dsh/authorized?result=complete\r\n"))
            assertTrue(http.contains("\r\nCache-Control: no-store\r\n"))
            withTimeout(5_000) { waiting.await() }.getOrThrow()
            assertListenerClosed(login.origin)
        } finally {
            stop(login, waiting)
        }
    }

    @Test(timeout = 15_000) fun rejectedStateOrFailedCompletionReturnsErrorWithoutRedirect() = runBlocking {
        for ((state, expectedError) in listOf("wrong" to "state mismatch", "expected" to "credential commit failed")) {
            val login = NativeAccountLogin()
            val calls = AtomicInteger()
            val waiting = async { runCatching { login.awaitCallback { code, returnedState ->
                calls.incrementAndGet()
                assertEquals("code", code)
                require(returnedState == "expected") { "state mismatch" }
                error("credential commit failed")
            } } }
            try {
                val http = request(login.origin, "/oauth/callback?code=code&state=$state")
                assertEquals("HTTP/1.1 400", http.lineSequence().first())
                assertFalse(http.lineSequence().any { it.startsWith("Location:", ignoreCase = true) })
                assertTrue(http.substringAfter("\r\n\r\n").startsWith("Sign-in failed."))
                assertEquals(expectedError, withTimeout(5_000) { waiting.await() }.exceptionOrNull()?.message)
                assertEquals(1, calls.get())
            } finally {
                // The controller owns cleanup after a rejected completion.
                stop(login, waiting)
            }
            assertListenerClosed(login.origin)
        }
    }

    @Test(timeout = 15_000) fun ownerCancellationAndCloseReleaseTheWaitingListener() = runBlocking {
        for (cancel in listOf(false, true)) {
            val login = NativeAccountLogin()
            val calls = AtomicInteger()
            val waiting = async { runCatching { login.awaitCallback { _, _ ->
                calls.incrementAndGet()
                "https://platform.example/dsh/authorized"
            } } }
            try {
                assertEquals("HTTP/1.1 404", request(login.origin, "/not-a-callback").lineSequence().first())
                assertTrue(waiting.isActive)
                if (cancel) waiting.cancel()
                login.close()
                withTimeout(5_000) { waiting.join() }
                assertTrue(waiting.isCompleted)
                if (cancel) assertTrue(waiting.isCancelled)
                assertEquals(0, calls.get())
                assertListenerClosed(login.origin)
            } finally {
                stop(login, waiting)
            }
        }
    }

    @Test(timeout = 15_000) fun invalidPathAndMissingParametersDoNotInvokeCompletion() = runBlocking {
        val login = NativeAccountLogin()
        val calls = AtomicInteger()
        val waiting = async { runCatching { login.awaitCallback { _, _ ->
            calls.incrementAndGet()
            "https://platform.example/dsh/authorized"
        } } }
        try {
            for ((path, status) in listOf(
                "/other?code=code&state=state" to 404,
                "/oauth/callback?state=state" to 400,
                "/oauth/callback?code=code" to 400,
            )) {
                val http = request(login.origin, path)
                assertEquals("HTTP/1.1 $status", http.lineSequence().first())
                assertFalse(http.lineSequence().any { it.startsWith("Location:", ignoreCase = true) })
                assertEquals(0, calls.get())
                assertTrue(waiting.isActive)
            }
            assertEquals("HTTP/1.1 302 Found", request(login.origin, "/oauth/callback?code=code&state=state").lineSequence().first())
            withTimeout(5_000) { waiting.await() }.getOrThrow()
            assertEquals(1, calls.get())
            assertListenerClosed(login.origin)
        } finally {
            stop(login, waiting)
        }
    }

    private suspend fun request(origin: String, path: String): String = withContext(Dispatchers.IO) {
        val uri = URI(origin)
        Socket().use { socket ->
            socket.connect(InetSocketAddress(uri.host, uri.port), 2_000)
            socket.soTimeout = 5_000
            socket.getOutputStream().write(("GET $path HTTP/1.1\r\nHost: ${uri.rawAuthority}\r\nConnection: close\r\n\r\n").toByteArray(StandardCharsets.US_ASCII))
            socket.getInputStream().bufferedReader(StandardCharsets.UTF_8).readText()
        }
    }

    private fun assertListenerClosed(origin: String) {
        val uri = URI(origin)
        val failure = runCatching {
            Socket().use { it.connect(InetSocketAddress(uri.host, uri.port), 1_000) }
        }.exceptionOrNull()
        assertTrue("The callback listener must refuse new TCP connections", failure is ConnectException)
    }

    private suspend fun stop(login: NativeAccountLogin, waiting: Job) {
        waiting.cancel()
        login.close()
        withTimeout(5_000) { waiting.join() }
    }
}
