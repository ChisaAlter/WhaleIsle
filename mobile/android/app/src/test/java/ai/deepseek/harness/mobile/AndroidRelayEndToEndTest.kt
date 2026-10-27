package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.store.DeviceStore
import ai.deepseek.harness.mobile.ui.*
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.Executors

/** Explicit opt-in: real Kotlin client, encrypted relay and dedicated desktop; never uses a default user host. */
@OptIn(ExperimentalCoroutinesApi::class)
class AndroidRelayEndToEndTest {
    @Test fun completePagingAndLostAcknowledgementUseTheRealDesktopChannel() = runBlocking {
        val inputPath = System.getenv("DSH_ANDROID_E2E_INPUT")
        assumeTrue("Requires an explicitly configured dedicated QA desktop", !inputPath.isNullOrBlank())
        val input = Json.parseToJsonElement(File(inputPath!!).readText()).objectValue()
        input.string("refreshScript").takeIf { it.isNotBlank() }?.let { script ->
            check(ProcessBuilder("node", script, "pair").inheritIO().start().waitFor() == 0) { "Dedicated QA offer refresh failed" }
        }
        val pairingUrl = input.string("pairingFile").takeIf { it.isNotBlank() }?.let {
            Json.parseToJsonElement(File(it).readText()).objectValue().string("url")
        } ?: input.string("url")
        val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        Dispatchers.setMain(dispatcher)
        val clients = mutableListOf<RelayClient>()
        val store = MemoryStore()
        val vm = withContext(dispatcher) { DshViewModel(store) { offer, saved, device, persist, mux, name ->
            RelayClient(offer, saved, device, persist, mux, name).also { clients += it }
        } }
        val report = mutableListOf<JsonObject>()
        suspend fun state(block: () -> Unit) = withContext(dispatcher) { block() }
        suspend fun await(label: String, timeoutMs: Long = 45_000, condition: () -> Boolean) {
            try { withTimeout(timeoutMs) { while (!withContext(dispatcher) { condition() }) delay(25) } }
            catch (error: TimeoutCancellationException) { throw AssertionError("Timed out: $label; route=${vm.route}, error=${vm.error}, banner=${vm.chat.banner}", error) }
        }
        try {
            state { vm.pair(pairingUrl) }
            await("authenticated catalog and controls") { vm.route == Route.Chat && !vm.chat.loading && !vm.chat.offline }
            val historyId = input.string("historyId")
            state { vm.openSession(historyId) }
            await("first history page") { vm.chat.sessionId == historyId && !vm.chat.loading && vm.chat.rows.isNotEmpty() }
            val pageSizes = mutableListOf(vm.chat.rows.size)
            while (withContext(dispatcher) { vm.chat.hasOlder }) {
                val before = withContext(dispatcher) { vm.chat.rows.size }
                state { vm.onChatAction(NativeChatAction("older", historyId)) }
                await("older page") { !vm.chat.busy && !vm.chat.olderLoading && vm.chat.rows.size > before }
                pageSizes += withContext(dispatcher) { vm.chat.rows.size }
                assertTrue("paging failed to terminate", pageSizes.size < 20)
            }
            val texts = withContext(dispatcher) { vm.chat.rows.map { it.text }.filter { it.startsWith("QA_HISTORY_") } }
            val expected = (1..260).map { "QA_HISTORY_${it.toString().padStart(4, '0')} ${if (it % 2 == 1) "question" else "answer"}" }
            assertEquals(expected, texts)
            state { vm.onBackground(); vm.onForeground() }
            delay(1_000)
            assertEquals(260, withContext(dispatcher) { vm.chat.rows.count { it.text.startsWith("QA_HISTORY_") } })
            report += obj("case" to "complete-history", "pageSizes" to pageSizes, "messages" to texts.size, "hasOlderAtEnd" to false, "refreshDuplicates" to false)

            val target = input.string("sessionId")
            state { vm.openSession(target) }
            await("dedicated prompt session") { vm.chat.sessionId == target && !vm.chat.loading && !vm.chat.offline }
            val marker = "Reply only QA_ANDROID_ACK_ONCE_${System.currentTimeMillis()}. No tools."
            File(input.string("faultControl")).writeText(obj("sessionId" to target, "dropNextAck" to true, "disconnect" to false).toString())
            state { vm.onChatAction(NativeChatAction("draft", target, text = marker)); vm.onChatAction(NativeChatAction("send", target, text = marker)) }
            await("send started") { vm.chat.busy }
            await("lost reply timeout", 40_000) { !vm.chat.busy }
            assertEquals(marker, withContext(dispatcher) { vm.chat.draft })
            val connection = withContext(dispatcher) { clients.last() }
            suspend fun occurrences(): Int = connection.host("session.history", obj("sessionId" to target, "maxMessages" to 100)).objectValue().objects("events").count {
                val event = it["event"].objectValue().ifEmpty { it }
                event.string("type") == "user/message" && event["data"].objectValue().objects("content").any { part -> part.string("text") == marker }
            }
            assertEquals(1, occurrences())
            state { vm.onChatAction(NativeChatAction("send", target, text = marker)) }
            await("explicit retry accepted") { !vm.chat.busy && vm.chat.draft.isEmpty() }
            assertEquals(1, occurrences())
            report += obj("case" to "actual-dropped-ack", "manualSubmissions" to 2, "durableMessages" to 1, "draftClearedAfterConfirmedRetry" to true)
            File(input.string("report")).writeText(obj("transport" to "real Kotlin RelayClient over public TLS encrypted relay", "cases" to report).toString())
        } finally {
            withContext(dispatcher) { vm.leaveComputer(); vm.viewModelScope.cancel() }
            clients.forEach { it.close() }
            Dispatchers.resetMain(); dispatcher.close()
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
