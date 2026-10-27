package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.store.DeviceStore
import ai.deepseek.harness.mobile.ui.NativeChatAction
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.*
import okhttp3.Response
import okhttp3.WebSocket
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** Explicit opt-in, real encrypted relay: one delayed success must not affect another session. */
@OptIn(ExperimentalCoroutinesApi::class)
class AndroidRelaySessionRaceTest {
    @Test fun lateAcceptedReplyAfterTimeoutDoesNotClearAnotherSessionsDraft() = runBlocking {
        val inputPath = System.getenv("DSH_ANDROID_RACE_INPUT")
        assumeTrue("Requires an explicitly configured dedicated QA desktop", !inputPath.isNullOrBlank())
        val input = Json.parseToJsonElement(File(inputPath!!).readText()).objectValue()
        check(ProcessBuilder("node", input.string("refreshScript"), "pair").inheritIO().start().waitFor() == 0)
        val pairingUrl = Json.parseToJsonElement(File(input.string("pairingFile")).readText()).objectValue().string("url")
        val control = File(input.string("faultControl"))
        val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        Dispatchers.setMain(dispatcher)
        val clients = mutableListOf<ObservedRelayClient>()
        val vm = withContext(dispatcher) { DshViewModel(MemoryStore()) { offer, saved, device, persist, mux, name ->
            ObservedRelayClient(offer, saved, device, persist, mux, name).also { clients += it }
        } }
        var workspaceId = ""
        var sessionA = ""
        var sessionB = ""
        suspend fun state(block: () -> Unit) = withContext(dispatcher) { block() }
        suspend fun await(label: String, timeoutMs: Long = 45_000, condition: () -> Boolean) {
            try { withTimeout(timeoutMs) { while (!withContext(dispatcher) { condition() }) delay(25) } }
            catch (error: TimeoutCancellationException) { throw AssertionError("Timed out: $label; route=${vm.route}, error=${vm.error}, banner=${vm.chat.banner}", error) }
        }
        fun gate(): JsonObject = runCatching { Json.parseToJsonElement(control.readText()).objectValue() }.getOrElse { obj() }
        try {
            state { vm.pair(pairingUrl) }
            await("authenticated catalog") { vm.route == Route.Chat && !vm.chat.loading && !vm.chat.offline }
            val connection = withContext(dispatcher) { clients.single() }
            val workspace = connection.host("workspace.create", obj("path" to input.string("workspacePath"))).objectValue()
            workspaceId = workspace["workspace"].objectValue().string("workspaceId").ifBlank { workspace.string("workspaceId") }
            check(workspaceId.isNotBlank()) { "Dedicated race workspace was not created" }
            sessionA = connection.host("session.create", obj("workspaceId" to workspaceId)).objectValue().string("sessionId")
            sessionB = connection.host("session.create", obj("workspaceId" to workspaceId)).objectValue().string("sessionId")
            check(sessionA.isNotBlank() && sessionB.isNotBlank() && sessionA != sessionB)
            connection.host("session.rename", obj("sessionId" to sessionA, "title" to "Android Late ACK A"))
            connection.host("session.rename", obj("sessionId" to sessionB, "title" to "Android Late ACK B"))
            state { vm.onForeground() }
            await("both dedicated sessions in catalog") { vm.chat.sessions.any { it.id == sessionA } && vm.chat.sessions.any { it.id == sessionB } }
            state { vm.onBackground(); vm.openSession(sessionA) }
            await("session A ready") { vm.chat.sessionId == sessionA && !vm.chat.loading }
            val marker = "Reply only QA_ANDROID_LATE_ACK_${System.currentTimeMillis()}. No tools."
            control.writeText(obj("sessionId" to sessionA, "gateNextAck" to true, "releaseAck" to false).toString())
            state { vm.onChatAction(NativeChatAction("draft", sessionA, text = marker)); vm.onChatAction(NativeChatAction("send", sessionA, text = marker)) }
            await("actual Host accepted A and success reply gated") { gate()["hostAccepted"].flag() && gate()["gateWaiting"].flag() }
            assertTrue(withContext(dispatcher) { vm.chat.busy })
            state { vm.openSession(sessionB) }
            assertEquals("busy switching is blocked by the actual UI guard", sessionA, withContext(dispatcher) { vm.chat.sessionId })
            await("real 30-second prompt timeout", 40_000) { !vm.chat.busy }
            assertEquals(marker, withContext(dispatcher) { vm.chat.draft })
            assertFalse("success must still be gated", gate()["gateReleased"].flag())
            assertTrue(connection.connected)
            state { vm.openSession(sessionB) }
            await("session B ready") { vm.chat.sessionId == sessionB && !vm.chat.loading && !vm.chat.offline }
            val draftB = "QA_SESSION_B_UNSENT_DRAFT_20261027"
            state { vm.onChatAction(NativeChatAction("draft", sessionB, text = draftB)) }
            val before = withContext(dispatcher) { vm.chat }
            control.writeText(JsonObject(gate() + ("releaseAck" to JsonPrimitive(true))).toString())
            val late = withTimeout(10_000) { connection.acceptedReply.await() }
            assertTrue("the real late ACK must reach the original live socket", connection.connected)
            assertTrue("the timed-out transport request must already be retired", late["retiredBeforeDispatch"].flag())
            assertTrue(late["accepted"].flag())
            val historyB = connection.host("session.history", obj("sessionId" to sessionB, "maxMessages" to 100)).objectValue()
            val historyA = connection.host("session.history", obj("sessionId" to sessionA, "maxMessages" to 100)).objectValue()
            fun occurrences(history: JsonObject): Int = history.objects("events").count {
                val event = it["event"].objectValue().ifEmpty { it }
                event.string("type") == "user/message" && event["data"].objectValue().objects("content").any { part -> part.string("text") == marker }
            }
            assertEquals(1, occurrences(historyA))
            assertEquals(0, occurrences(historyB))
            withContext(dispatcher) {
                assertEquals(sessionB, vm.chat.sessionId)
                assertEquals(before.title, vm.chat.title)
                assertEquals(draftB, vm.chat.draft)
                assertEquals(before.rows, vm.chat.rows)
                assertEquals(before.attachments, vm.chat.attachments)
                assertEquals(before.approval, vm.chat.approval)
                assertEquals(before.running, vm.chat.running)
                assertFalse(vm.chat.busy)
                assertEquals(1, clients.size)
                assertSame(connection, clients.single())
            }
            assertEquals(1, connection.opens.get())
            assertEquals(1, connection.acceptedReplies.get())
            check(gate()["releasedExplicitly"].flag()) { "Gate reached automatic timeout instead of explicit release" }
            File(input.string("report")).writeText(obj(
                "transport" to "real Kotlin RelayClient over public TLS encrypted relay",
                "case" to "late-success-after-timeout-and-session-switch",
                "hostAcceptedBeforeGate" to true,
                "busySwitchBlocked" to true,
                "realTimeoutMs" to 30_000,
                "releaseAfterSessionBReady" to true,
                "lateAcceptedFrameObservedOnOriginalSocket" to true,
                "retiredRequestBeforeLateFrameDispatch" to true,
                "socketOpenCount" to connection.opens.get(),
                "sameRelayClient" to true,
                "postReleaseSessionBEchoSucceeded" to true,
                "sessionBDraftPreserved" to true,
                "sessionBRowsAttachmentsApprovalAndRunningUnchanged" to true,
                "durableAMessages" to occurrences(historyA),
                "durableBMessagesWithAMarker" to occurrences(historyB),
                "manualSubmissions" to 1,
                "gateReleasedAfterMs" to gate()["releasedAfterMs"],
            ).toString())
        } finally {
            runCatching { control.writeText(JsonObject(gate() + ("releaseAck" to JsonPrimitive(true))).toString()) }
            clients.lastOrNull()?.takeIf { it.connected }?.let { connection ->
                if (sessionA.isNotBlank()) runCatching { connection.host("session.cancel", obj("sessionId" to sessionA)) }
                for (session in listOf(sessionA, sessionB).filter { it.isNotBlank() }) runCatching { connection.host("workspace.archiveSession", obj("sessionId" to session)) }
                if (workspaceId.isNotBlank()) runCatching { connection.host("workspace.delete", obj("workspaceId" to workspaceId)) }
            }
            withContext(dispatcher) { vm.leaveComputer(); vm.viewModelScope.cancel() }
            clients.forEach { it.close() }
            Dispatchers.resetMain(); dispatcher.close()
        }
    }

    /** Read-only observer: authenticate/decrypt a copy with the existing Box, then run the unchanged listener. */
    private class ObservedRelayClient(
        offer: ai.deepseek.harness.mobile.pair.Offer, saved: SavedComputer?, device: String,
        persist: (SavedComputer) -> Unit, mux: (JsonObject) -> Unit, name: (String) -> Unit,
    ) : RelayClient(offer, saved, device, persist, mux, name) {
        val opens = AtomicInteger()
        val acceptedReplies = AtomicInteger()
        val acceptedReply = CompletableDeferred<JsonObject>()
        override fun onOpen(webSocket: WebSocket, response: Response) { opens.incrementAndGet(); super.onOpen(webSocket, response) }
        override fun onMessage(webSocket: WebSocket, text: String) {
            val accepted = if (text.startsWith("{")) null else observe(text)
            super.onMessage(webSocket, text)
            if (accepted != null) { acceptedReplies.incrementAndGet(); acceptedReply.complete(accepted) }
        }
        private fun observe(text: String): JsonObject? {
            // Box.open is stateless; this neither changes RelayCrypto replay state nor replaces its validation.
            val cryptoField = RelayClient::class.java.getDeclaredField("crypto").apply { isAccessible = true }
            val crypto = cryptoField.get(this)
            val box = crypto.javaClass.getDeclaredField("box").apply { isAccessible = true }.get(crypto)
            val bytes = Base64.getDecoder().decode(text)
            val plain = box.javaClass.getMethod("open", ByteArray::class.java, ByteArray::class.java)
                .invoke(box, bytes.copyOfRange(24, bytes.size), bytes.copyOfRange(0, 24)) as? ByteArray ?: return null
            val wire = Json.parseToJsonElement(plain.toString(Charsets.UTF_8)).objectValue()
            val frame = if (wire.string("type") == "session") wire["message"].objectValue() else wire
            val payload = frame["payload"].objectValue()
            if (frame.string("type") != "dshd.host.rpc.response" || !payload["ok"].flag() || !payload["value"].objectValue()["accepted"].flag()) return null
            val pending = RelayClient::class.java.getDeclaredField("pending").apply { isAccessible = true }.get(this) as Map<*, *>
            return obj("accepted" to true, "retiredBeforeDispatch" to !pending.containsKey(payload.string("requestId")))
        }
    }
    private class MemoryStore : DeviceStore {
        override var webAppUrl = ""
        override var scheme = "system"
        override var computersJson = "[]"
        override var draftsJson = "{}"
        override var selectedComputer = ""
        override var nativeMigrationDone = true
        override fun clearLegacyHttpCredentials() {}
    }
}
