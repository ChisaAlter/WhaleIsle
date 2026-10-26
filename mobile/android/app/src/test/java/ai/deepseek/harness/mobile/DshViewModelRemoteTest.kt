package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.pair.*
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.store.DeviceStore
import ai.deepseek.harness.mobile.ui.*
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.Base64

@OptIn(ExperimentalCoroutinesApi::class)
class DshViewModelRemoteTest {
    private val models = mutableListOf<DshViewModel>()
    @Before fun mainDispatcher() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun resetDispatcher() { closeModels(); Dispatchers.resetMain() }

    private fun closeModels() {
        models.forEach { it.leaveComputer(); it.viewModelScope.cancel() }
        models.clear()
    }
    private fun remoteTest(block: suspend TestScope.() -> Unit) = runTest {
        try { block() } finally {
            // Cancel the polling loop before runTest drains the shared Main scheduler.
            // JUnit @After runs only after that drain has returned.
            closeModels()
            runCurrent()
        }
    }

    private fun model(store: FakeStore = FakeStore(), setup: (Int, FakeRelay) -> Unit = { _, _ -> }): Pair<DshViewModel, MutableList<FakeRelay>> {
        val clients = mutableListOf<FakeRelay>()
        val vm = DshViewModel(store) { offer, saved, _, persist, mux, _ ->
            FakeRelay(offer, saved, persist, mux).also { setup(clients.size, it); clients += it }
        }
        models += vm
        return vm to clients
    }

    @Test fun firstConnectionStaysOnConnectThroughAuthenticationCatalogHistoryAndControls() = remoteTest {
        val connect = CompletableDeferred<Unit>()
        val catalog = CompletableDeferred<Unit>()
        val history = CompletableDeferred<Unit>()
        val models = CompletableDeferred<Unit>()
        val commands = CompletableDeferred<Unit>()
        val (vm, clients) = model { _, relay ->
            relay.connectGate = connect; relay.catalogGate = catalog; relay.historyGates["s1"] = history
            relay.modelGate = models; relay.commandsGate = commands
        }
        vm.start(); runCurrent()
        assertEquals(Route.Connect, vm.route)
        assertTrue(vm.connecting)
        assertFalse(vm.canRetryConnection)
        vm.start(); vm.reopenComputer(); vm.connectFromPaste(); runCurrent()
        assertEquals(1, clients.size)
        connect.complete(Unit); runCurrent()
        assertEquals(Route.Connect, vm.route)
        assertTrue(vm.connectionStatus.contains("同步"))
        assertEquals(1, clients.single().subscriptions)
        catalog.complete(Unit); runCurrent()
        assertEquals(Route.Connect, vm.route)
        assertTrue(vm.connectionStatus.contains("控制项"))
        assertTrue(vm.chat.modelOptions.isEmpty())
        vm.openSession("s2"); assertEquals("s1", vm.chat.sessionId)
        history.complete(Unit); runCurrent()
        assertEquals(Route.Connect, vm.route)
        models.complete(Unit); runCurrent()
        assertEquals(Route.Connect, vm.route)
        assertTrue(vm.connecting)
        commands.complete(Unit); runCurrent()
        assertEquals(Route.Chat, vm.route)
        assertFalse(vm.connecting)
        assertEquals("s1", vm.chat.sessionId)
        assertFalse(vm.chat.loading)
        assertTrue(vm.error.isEmpty())
        assertFalse(vm.canRetryConnection)
    }

    @Test fun initialFailuresAtEveryRemoteStageBelongToConnectAndDoNotAutomaticallyRetry() = remoteTest {
        for (stage in listOf("connect", "subscribe", "session.list", "workspace.list", "session.history", "session.projections", "session.models", "commands/list")) {
            val (vm, clients) = model { _, relay ->
                when (stage) {
                    "connect" -> relay.connectFailure = IllegalStateException("failed $stage")
                    "subscribe" -> relay.subscribeFailure = IllegalStateException("failed $stage")
                    else -> relay.hostFailures[stage] = IllegalStateException("failed $stage")
                }
            }
            vm.reopenComputer(); runCurrent()
            assertEquals(stage, Route.Connect, vm.route)
            assertFalse(vm.connecting)
            assertTrue(vm.error.contains("failed $stage"))
            assertTrue(vm.chat.error.isEmpty())
            assertTrue(vm.chat.offline)
            assertFalse(vm.chat.loading)
            assertTrue(vm.canRetryConnection)
            vm.start(); vm.onForeground(); vm.onNetworkAvailable(); advanceTimeBy(60_000); runCurrent()
            assertEquals(stage, 1, clients.size)
            vm.leaveComputer()
        }
    }

    @Test fun cancelRetiresLateFirstConnectionAndStartCannotReenterBeforeExplicitRetry() = remoteTest {
        val late = CompletableDeferred<Unit>()
        val store = FakeStore()
        val (vm, clients) = model(store) { index, relay ->
            if (index == 0) relay.connectAttempt = { withContext(NonCancellable) { late.await() } }
        }
        vm.start(); runCurrent()
        assertTrue(vm.connecting)
        val remembered = store.computersJson
        vm.cancelConnecting()
        assertEquals(Route.Connect, vm.route)
        assertFalse(vm.connecting)
        assertTrue(vm.canRetryConnection)
        assertEquals(remembered, store.computersJson)
        vm.start(); vm.onForeground(); vm.onNetworkAvailable(); runCurrent()
        assertEquals(1, clients.size)
        late.complete(Unit); runCurrent()
        clients[0].emitApproval("s1", "late", "retired"); runCurrent()
        assertEquals(Route.Connect, vm.route)
        assertNull(vm.chat.approval)
        assertEquals(0, clients[0].subscriptions)
        vm.retryConnection(); runCurrent()
        assertEquals(Route.Chat, vm.route)
        assertEquals(2, clients.size)
        assertTrue(clients[1].usedSavedSecret)
    }

    @Test fun freshPairingRetryAfterCatalogFailureUsesIssuedSecretInsteadOfBootstrap() = remoteTest {
        val store = FakeStore(computersJson = "[]")
        val (vm, clients) = model(store) { index, relay -> if (index == 0) relay.catalogFailures = 1 }
        val offer = obj("v" to 2, "serverId" to "computer", "daemonPublicKeyB64" to KEY,
            "relay" to obj("endpoint" to "127.0.0.1:1", "useTls" to false),
            "authBootstrap" to obj("version" to 1, "pairingToken" to "fresh-pairing-token-for-test", "expiresAtMs" to (System.currentTimeMillis() + 60_000)))
        vm.onScanned("https://example.test/#offer=" + Base64.getUrlEncoder().withoutPadding().encodeToString(offer.toString().toByteArray())); runCurrent()
        assertEquals(Route.Connect, vm.route)
        assertFalse(clients.single().usedSavedSecret)
        assertTrue(store.computersJson.contains("test-device-secret"))
        vm.retryConnection(); runCurrent()
        assertEquals(Route.Chat, vm.route)
        assertTrue(clients.last().usedSavedSecret)
        assertNull(clients.last().usedOffer.authBootstrap)
    }

    @Test fun pairingFromSettingsPreservesComputersAndDraftsButRequiresExplicitSelection() = remoteTest {
        val gate = CompletableDeferred<Unit>()
        val store = FakeStore(computersJson = Json.encodeToString(listOf(saved(), saved("other"))))
        val (vm, clients) = model(store) { index, relay -> if (index == 1) relay.connectGate = gate }
        vm.start(); runCurrent()
        vm.onChatAction(NativeChatAction("draft", "s1", text = "preserved text"))
        vm.addImage("computer", "s1", NativeImage("image/png", "preserved image"))
        vm.openSettings(); assertEquals("settings", vm.panel)
        assertEquals("computer", vm.selectedComputerId)
        assertTrue(vm.isCurrentComputer("computer"))
        val remembered = store.computersJson
        vm.beginPairing()
        assertEquals(Route.Connect, vm.route)
        assertEquals("", vm.panel)
        assertEquals(remembered, store.computersJson)
        assertTrue(store.draftsJson.contains("preserved text"))
        vm.start(); vm.onForeground(); vm.onNetworkAvailable(); runCurrent()
        assertEquals(1, clients.size)
        vm.openSettings(); vm.reopenComputer("other"); runCurrent()
        assertEquals(Route.Connect, vm.route)
        assertTrue(vm.connecting)
        assertEquals("", vm.panel)
        assertTrue(vm.isCurrentComputer("other"))
        gate.complete(Unit); runCurrent()
        assertEquals(Route.Chat, vm.route)
        vm.reopenComputer("computer"); runCurrent()
        assertEquals("preserved text", vm.chat.draft)
        assertEquals(listOf("preserved image"), vm.chat.attachments.map { it.data })
    }

    @Test fun emptyInitialCatalogIsReadyWithoutOpeningAnInventedSession() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.sessions = emptyList() }
        vm.start(); runCurrent()
        assertEquals(Route.Chat, vm.route)
        assertFalse(vm.connecting)
        assertFalse(vm.chat.loading)
        assertEquals("", vm.chat.sessionId)
        assertTrue(clients.single().hostCalls.none { it.first in setOf("session.history", "session.models", "commands/list") })
    }

    @Test fun sessionModelSelectionDoesNotSaveDesktopDefaultAndRunningSendHonorsChosenMode() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.modelCatalog = obj("groups" to listOf(obj("id" to "provider", "models" to listOf(obj("id" to "model"))))) }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        vm.onChatAction(NativeChatAction("model", "s1", provider = "provider", model = "model")); runCurrent()
        val selection = relay.hostCalls.single { it.first == "session.selectModel" }.second
        assertEquals(false, (selection["saveAsDefault"] as JsonPrimitive).boolean)
        vm.update { copy(running = true) }
        vm.onChatAction(NativeChatAction("send", "s1", text = "steer now", mode = "steer")); runCurrent()
        assertEquals("steer", relay.hostCalls.last { it.first == "session.prompt" }.second.string("mode"))
        vm.update { copy(running = false) }
        vm.onChatAction(NativeChatAction("send", "s1", text = "idle normal send", mode = "steer")); runCurrent()
        assertEquals("queue", relay.hostCalls.last { it.first == "session.prompt" }.second.string("mode"))
        val count = relay.hostCalls.count { it.first == "session.prompt" }
        vm.onChatAction(NativeChatAction("send", "s1", text = "invalid mode", mode = "unsupported")); runCurrent()
        assertEquals(count, relay.hostCalls.count { it.first == "session.prompt" })
        assertTrue(vm.chat.banner.contains("未知发送方式"))
    }

    @Test fun readySessionDraftsKeepTheirOwnerAndOfflineEditsCannotSwitchSessions() = remoteTest {
        val store = FakeStore()
        val (vm, clients) = model(store)
        vm.reopenComputer(); runCurrent()
        vm.onChatAction(NativeChatAction("draft", "s1", text = "first draft"))
        vm.addImage("computer", "s1", NativeImage("image/png", "first-image"))
        vm.openSession("s2"); runCurrent()
        vm.onChatAction(NativeChatAction("draft", "s1", text = "late overwrite"))
        vm.addImage("computer", "s1", NativeImage("image/png", "late-image"))
        vm.addImage("other-computer", "s2", NativeImage("image/png", "wrong-computer"))
        assertTrue(vm.chat.attachments.isEmpty())
        vm.onChatAction(NativeChatAction("draft", "s2", text = "second draft"))
        vm.openSession("s1"); runCurrent()
        assertEquals("first draft", vm.chat.draft)
        assertEquals(listOf("first-image"), vm.chat.attachments.map { it.data })
        vm.openSession("s2"); runCurrent()
        assertEquals("second draft", vm.chat.draft)
        assertEquals("first draft", Json.parseToJsonElement(store.draftsJson).objectValue().string("computer/s1"))
        clients.single().disconnect(IllegalStateException("offline draft test")); runCurrent()
        assertTrue(vm.chat.offline)
        val offline = vm.chat
        val calls = clients.single().hostCalls.size
        vm.openSession("s1")
        vm.onChatAction(NativeChatAction("open", "s1"))
        assertSame(offline, vm.chat)
        vm.onChatAction(NativeChatAction("draft", "s2", text = "second offline draft"))
        vm.onChatAction(NativeChatAction("draft", "s1", text = "offline late overwrite"))
        vm.addImage("computer", "s1", NativeImage("image/png", "offline late-image"))
        runCurrent()
        assertEquals(calls, clients.single().hostCalls.size)
        assertEquals("s2", vm.chat.sessionId)
        assertEquals("second offline draft", vm.chat.draft)
        assertTrue(vm.chat.attachments.isEmpty())
        val drafts = Json.parseToJsonElement(store.draftsJson).objectValue()
        assertEquals("first draft", drafts.string("computer/s1"))
        assertEquals("second offline draft", drafts.string("computer/s2"))
    }

    @Test fun createAndRegisterOpenWithoutCopyingThePreviousSessionsImages() = remoteTest {
        val (vm, _) = model()
        vm.reopenComputer(); runCurrent()
        vm.addImage("computer", "s1", NativeImage("image/png", "original"))
        vm.panel = "new"; vm.createSession(); runCurrent()
        assertEquals("created", vm.chat.sessionId)
        assertTrue(vm.chat.attachments.isEmpty())
        vm.openSession("s1"); runCurrent()
        assertEquals(listOf("original"), vm.chat.attachments.map { it.data })
        vm.panel = "new"; vm.browse("C:/new"); runCurrent()
        vm.registerDirectory(); runCurrent()
        assertEquals("created", vm.chat.sessionId)
        assertTrue(vm.chat.attachments.isEmpty())
        vm.openSession("s1"); runCurrent()
        assertEquals(listOf("original"), vm.chat.attachments.map { it.data })
    }

    @Test fun changingComputersClearsCatalogImmediatelyAndRetainsEachComputersImageDraft() = remoteTest {
        val store = FakeStore(computersJson = Json.encodeToString(listOf(saved(), saved("other"))))
        val waiting = CompletableDeferred<Unit>()
        val (vm, clients) = model(store) { index, relay -> if (index == 1) relay.connectGate = waiting }
        vm.reopenComputer("computer"); runCurrent()
        assertFalse(vm.workspaces.isEmpty())
        vm.addImage("computer", "s1", NativeImage("image/png", "first computer"))
        vm.reopenComputer("other")
        assertTrue(vm.workspaces.isEmpty()); assertTrue(vm.allSessions.isEmpty()); assertTrue(vm.chat.sessions.isEmpty())
        runCurrent()
        assertEquals(2, clients.size)
        waiting.complete(Unit); runCurrent()
        assertTrue(vm.chat.attachments.isEmpty())
        vm.addImage("other", "s1", NativeImage("image/png", "other computer"))
        vm.reopenComputer("computer"); runCurrent()
        assertEquals(listOf("first computer"), vm.chat.attachments.map { it.data })
        vm.leaveComputer()
        assertTrue(vm.workspaces.isEmpty()); assertTrue(vm.allSessions.isEmpty())
        assertTrue(vm.panelData.isEmpty())
    }

    @Test fun nonRepositoryOpensInitializeWithoutReadingBranchesOrEntries() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.gitReply = { _, _ -> obj("isRepo" to false) } }
        vm.reopenComputer(); runCurrent()
        vm.panel = "work"; vm.openGit(); runCurrent()
        assertEquals("git", vm.panel)
        assertFalse(vm.panelData["status"].objectValue()["isRepo"].flag())
        assertEquals(listOf("git-status"), clients.single().gitCalls)
        assertTrue(vm.panelError.isEmpty())
    }

    @Test fun delayedGitForAnotherSessionOrDismissedPanelCannotReopenThePage() = remoteTest {
        val status = CompletableDeferred<JsonElement>()
        val (vm, clients) = model { _, relay -> relay.gitReply = { _, _ -> status.await() } }
        vm.reopenComputer(); runCurrent()
        vm.panel = "work"; vm.openGit(); runCurrent()
        vm.openSession("s2"); runCurrent()
        vm.panel = "settings"
        status.complete(obj("isRepo" to true)); runCurrent()
        assertEquals("settings", vm.panel)
        assertTrue(vm.panelData.isEmpty())
        assertEquals(listOf("git-status"), clients.single().gitCalls)
        val second = CompletableDeferred<JsonElement>()
        clients.single().gitReply = { _, _ -> second.await() }
        vm.panel = "work"; vm.openGit(); runCurrent()
        vm.panel = ""; vm.panel = "work"
        second.complete(obj("isRepo" to false)); runCurrent()
        assertEquals("work", vm.panel)
        assertTrue(vm.panelData.isEmpty())
    }

    @Test fun approvalsFromOtherSessionsKeepTheirReplyAddressAndResolvedHistoryDoesNotReturn() = remoteTest {
        val (vm, clients) = model()
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        relay.histories["s2"] = listOf(asked("same-id"))
        relay.emitApproval("s2", "same-id", "remote-event:{\"clientId\":\"owner\",\"eventId\":\"second\"}")
        relay.emitApproval("s1", "same-id", "remote-event:{\"clientId\":\"owner\",\"eventId\":\"first\"}")
        runCurrent()
        vm.openSession("s2"); runCurrent()
        assertEquals("second", Json.parseToJsonElement(vm.chat.approval!!.rpcId.substringAfter("remote-event:")).objectValue().string("eventId"))
        vm.openSession("s1"); runCurrent()
        vm.openSession("s2"); runCurrent()
        vm.onChatAction(NativeChatAction("approve", "s2", approvalId = "same-id", actionId = "allowed-once")); runCurrent()
        val response = relay.hostCalls.last { it.first == "respond" }.second
        assertTrue(response.string("rpcId").contains("second"))
        assertEquals("s2", response["value"].objectValue().string("sessionId"))
        assertNull(vm.chat.approval)
        vm.openSession("s1"); runCurrent()
        assertTrue(vm.chat.approval!!.rpcId.contains("first"))
        relay.emitResolved("s1", "same-id"); runCurrent()
        assertNull(vm.chat.approval)
    }

    @Test fun firstCatalogFailureStaysOnConnectAndOnlyExplicitRetryLoadsSessionAndControls() = remoteTest {
        val (vm, clients) = model { index, relay -> if (index == 0) relay.catalogFailures = 1 }
        vm.reopenComputer(); runCurrent()
        val failed = clients.single()
        assertEquals(1, failed.subscriptions)
        assertEquals(Route.Connect, vm.route)
        assertFalse(vm.connecting)
        assertTrue(vm.error.contains("catalog unavailable"))
        assertTrue(vm.chat.error.isEmpty())
        assertTrue(vm.canRetryConnection)
        vm.panel = "new"; vm.createSession(); runCurrent()
        assertTrue(failed.hostCalls.none { it.first == "session.create" })
        vm.start(); vm.onForeground(); vm.onNetworkAvailable(); advanceTimeBy(60_000); runCurrent()
        assertEquals(1, clients.size)
        vm.retryConnection(); runCurrent()
        val relay = clients.last()
        assertEquals(Route.Chat, vm.route)
        assertEquals("s1", vm.chat.sessionId)
        assertEquals(listOf("s1", "s2", "created"), vm.chat.sessions.map { it.id })
        assertEquals(1, relay.hostCalls.count { it.first == "session.models" })
        assertEquals(1, relay.hostCalls.count { it.first == "commands/list" })
        assertEquals(1, relay.subscriptions)
        assertTrue(vm.error.isEmpty())
        assertFalse(vm.chat.loading)
        relay.emitApproval("s1", "a", "reply-address"); runCurrent()
        assertEquals("reply-address", vm.chat.approval!!.rpcId)
    }

    @Test fun connectedForegroundRefreshKeepsBrowseAndSearchStateWithoutReopeningSession() = remoteTest {
        val (vm, clients) = model { _, relay ->
            relay.histories["s1"] = listOf(obj("event" to obj("seq" to 1, "type" to "user/message", "data" to obj("id" to "message", "source" to obj("kind" to "user"),
                "content" to listOf(obj("type" to "text", "text" to "retained history"))))))
            relay.projections["s1"] = obj("modelSelection" to obj("next" to obj("provider" to "provider", "model" to "plain")))
            relay.modelCatalog = obj("groups" to listOf(obj("id" to "provider", "models" to listOf(obj("id" to "plain", "name" to "Plain model")))))
        }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        val epoch = vm.chat.epoch
        val options = vm.chat.modelOptions
        assertFalse(options.isEmpty())
        vm.panel = "new"; vm.browse("C:/new"); runCurrent()
        val directory = vm.panelData
        repeat(3) {
            val rows = vm.chat.rows
            vm.onBackground(); vm.onForeground()
            assertEquals("browse", vm.panel)
            assertSame(rows, vm.chat.rows)
            assertSame(options, vm.chat.modelOptions)
            assertFalse(vm.chat.loading)
            runCurrent()
            assertEquals("browse", vm.panel)
            assertEquals(directory, vm.panelData)
            assertEquals("retained history", vm.chat.rows.single().text)
            assertEquals("plain", vm.chat.modelCurrentId)
            assertEquals(epoch, vm.chat.epoch)
        }
        vm.panel = "sessions"; vm.findSessions("retained query"); runCurrent()
        val search = vm.panelData
        repeat(3) {
            vm.onBackground(); vm.onForeground(); runCurrent()
            assertEquals("sessions", vm.panel)
            assertEquals(search, vm.panelData)
            assertEquals("retained query", vm.panelData.objects("items").single().string("snippet"))
            assertSame(options, vm.chat.modelOptions)
            assertFalse(vm.chat.loading)
        }
        assertEquals(1, relay.hostCalls.count { it.first == "session.models" })
        assertEquals(1, relay.hostCalls.count { it.first == "commands/list" })
        assertEquals(1, relay.hostCalls.count { it.first == "host.listDirectory" })
        assertEquals(1, relay.hostCalls.count { it.first == "session.search" })
        assertEquals(7, relay.hostCalls.count { it.first == "session.list" })
        assertEquals(7, relay.hostCalls.count { it.first == "session.history" })
        assertEquals(1, clients.size)
    }

    @Test fun connectedForegroundRefreshKeepsGitReviewCandidateAndEditedDraft() = remoteTest {
        val candidate = obj("title" to "generated title", "body" to "generated body")
        val (vm, clients) = model { _, relay -> relay.gitReply = { _, _ -> candidate } }
        vm.reopenComputer(); runCurrent()
        vm.panel = "git"; vm.gitAction(listOf("git-create-change-request")); runCurrent()
        assertTrue(vm.gitReview)
        vm.gitDraftTitle = "edited title"; vm.gitDraftBody = "edited body"
        vm.generateGitDraft(); runCurrent()
        assertEquals(candidate, vm.gitDraftCandidate)
        repeat(3) {
            vm.onBackground(); vm.onForeground(); runCurrent()
            assertEquals("git", vm.panel)
            assertTrue(vm.gitReview)
            assertEquals(candidate, vm.gitDraftCandidate)
            assertEquals("edited title", vm.gitDraftTitle)
            assertEquals("edited body", vm.gitDraftBody)
            assertEquals(listOf("git-create-change-request"), vm.gitRemaining)
        }
        assertEquals(1, clients.single().hostCalls.count { it.first == "session.models" })
        assertEquals(listOf("git-create-change-request"), clients.single().gitCalls)
    }

    @Test fun automaticRecoveryRetriesSavedSecretAndRestoresTheOpenedSessionAndDraft() = remoteTest {
        val (vm, clients) = model { index, relay ->
            if (index == 1) relay.connectAttempt = { withTimeout(25) { awaitCancellation() } }
            if (index == 2) relay.connectFailure = IllegalStateException("temporary network failure")
        }
        vm.reopenComputer(); runCurrent()
        vm.openSession("s2"); runCurrent()
        vm.onChatAction(NativeChatAction("draft", "s2", text = "keep this draft"))
        vm.addImage("computer", "s2", NativeImage("image/png", "kept image"))
        clients[0].disconnect(IllegalStateException("network interrupted")); runCurrent()
        advanceTimeBy(1_000); runCurrent()
        advanceTimeBy(25); runCurrent()
        advanceTimeBy(2_000); runCurrent()
        advanceTimeBy(4_000); runCurrent()
        assertEquals(4, clients.size)
        assertTrue(clients.drop(1).all { it.usedSavedSecret && it.usedOffer.authBootstrap == null })
        assertEquals("s2", vm.chat.sessionId)
        assertEquals("keep this draft", vm.chat.draft)
        assertEquals(listOf("kept image"), vm.chat.attachments.map { it.data })
        assertFalse(vm.chat.offline)
        assertEquals(1, clients.last().subscriptions)
    }

    @Test fun sameComputerRecoveryKeepsWhitelistedDialogsAndUiOwnerAcrossEveryTransport() = remoteTest {
        val (vm, clients) = model()
        vm.reopenComputer(); runCurrent()
        val owner = vm.uiOwnerEpoch
        for (page in listOf("work", "new", "settings")) {
            vm.panel = page
            val transport = vm.chat.epoch
            clients.last().disconnect(IllegalStateException("network lost")); runCurrent()
            assertEquals(page, vm.panel)
            assertEquals(owner, vm.uiOwnerEpoch)
            assertNotEquals(transport, vm.chat.epoch)
            assertTrue(vm.chat.offline)
            assertFalse(vm.panelBusy)
            advanceTimeBy(1_000); runCurrent()
            assertEquals(page, vm.panel)
            assertEquals(owner, vm.uiOwnerEpoch)
            assertFalse(vm.chat.offline)
            assertEquals("s1", vm.chat.sessionId)
            assertTrue(clients.last().hostCalls.none { it.first in setOf("session.create", "workspace.create", "host.createDirectory") })
        }
    }

    @Test fun browseDataCatalogAndDraftSurviveRecoveryAndOfflineActionsDoNotRun() = remoteTest {
        val gate = CompletableDeferred<Unit>()
        val (vm, clients) = model { index, relay -> if (index == 1) relay.connectGate = gate }
        vm.reopenComputer(); runCurrent()
        vm.openSession("s2"); runCurrent()
        vm.onChatAction(NativeChatAction("draft", "s2", text = "kept draft"))
        vm.addImage("computer", "s2", NativeImage("image/png", "kept picture"))
        vm.panel = "new"; vm.browse("C:/new"); runCurrent()
        val data = vm.panelData
        val sessions = vm.allSessions
        val workspaces = vm.workspaces
        val owner = vm.uiOwnerEpoch
        clients.single().disconnect(IllegalStateException("network lost")); runCurrent()
        val previousCalls = clients.single().hostCalls.size
        vm.browse("C:/should-not-read"); vm.createDirectory("offline"); vm.registerDirectory(); vm.findSessions("offline"); runCurrent()
        assertEquals(previousCalls, clients.single().hostCalls.size)
        assertEquals("browse", vm.panel)
        assertEquals(data, vm.panelData)
        assertSame(sessions, vm.allSessions)
        assertSame(workspaces, vm.workspaces)
        assertEquals(owner, vm.uiOwnerEpoch)
        advanceTimeBy(1_000); runCurrent()
        assertTrue(vm.chat.offline)
        assertEquals("s2", vm.chat.sessionId)
        assertEquals("browse", vm.panel)
        gate.complete(Unit); runCurrent()
        assertFalse(vm.chat.offline)
        assertFalse(vm.chat.loading)
        assertEquals("browse", vm.panel)
        assertEquals(data, vm.panelData)
        assertEquals(owner, vm.uiOwnerEpoch)
        assertEquals("kept draft", vm.chat.draft)
        assertEquals(listOf("kept picture"), vm.chat.attachments.map { it.data })
        assertTrue(clients[1].hostCalls.none { it.first in setOf("host.listDirectory", "host.createDirectory", "workspace.create", "session.create", "session.search") })
    }

    @Test fun searchSnapshotSurvivesRecoveryWhileOldTransportRepliesCannotReplaceIt() = remoteTest {
        val lateSearch = CompletableDeferred<JsonObject>()
        val (vm, clients) = model { _, relay -> relay.projections["s1"] = obj("title" to "refreshed") }
        vm.reopenComputer(); runCurrent()
        vm.panel = "sessions"; vm.findSessions("retained query"); runCurrent()
        val snapshot = vm.panelData
        val owner = vm.uiOwnerEpoch
        clients[0].searchReply = { lateSearch.await() }
        vm.findSessions("late old query"); runCurrent()
        assertTrue(vm.panelBusy)
        clients[0].disconnect(IllegalStateException("network lost")); runCurrent()
        assertFalse(vm.panelBusy)
        assertEquals("sessions", vm.panel)
        advanceTimeBy(1_000); runCurrent()
        assertEquals(snapshot, vm.panelData)
        assertEquals(owner, vm.uiOwnerEpoch)
        assertEquals("refreshed", vm.chat.title)
        lateSearch.complete(obj("items" to listOf(obj("sessionId" to "s1", "snippet" to "stale"))))
        clients[0].emitApproval("s1", "stale", "old transport")
        runCurrent()
        assertEquals(snapshot, vm.panelData)
        assertNull(vm.chat.approval)
        assertTrue(clients[1].hostCalls.none { it.first == "session.search" })
    }

    @Test fun closingDuringRecoveryDoesNotResurrectPageAndGitReviewIsNotRetained() = remoteTest {
        val gate = CompletableDeferred<Unit>()
        val (vm, clients) = model { index, relay -> if (index == 1) relay.connectGate = gate }
        vm.reopenComputer(); runCurrent()
        vm.panel = "new"; vm.browse(); runCurrent()
        clients[0].disconnect(IllegalStateException("network lost")); runCurrent()
        vm.panel = ""
        advanceTimeBy(1_000); runCurrent()
        gate.complete(Unit); runCurrent()
        assertEquals("", vm.panel)
        vm.panel = "git"; vm.gitAction(listOf("git-create-change-request")); runCurrent()
        assertTrue(vm.gitReview)
        clients[1].disconnect(IllegalStateException("network lost again")); runCurrent()
        assertEquals("", vm.panel)
        assertFalse(vm.gitReview)
        assertTrue(vm.panelData.isEmpty())
        advanceTimeBy(1_000); runCurrent()
        assertEquals("", vm.panel)
        assertTrue(clients.last().gitCalls.isEmpty())
    }

    @Test fun manualSameComputerRecoveryKeepsTaskButSwitchAndLeaveResetItsOwner() = remoteTest {
        val store = FakeStore(computersJson = Json.encodeToString(listOf(saved(), saved("other"))))
        val (vm, _) = model(store)
        vm.reopenComputer(); runCurrent()
        vm.panel = "sessions"; vm.findSessions("saved query"); runCurrent()
        val snapshot = vm.panelData
        val owner = vm.uiOwnerEpoch
        vm.reopenComputer(); runCurrent()
        assertEquals(owner, vm.uiOwnerEpoch)
        assertEquals("sessions", vm.panel)
        assertEquals(snapshot, vm.panelData)
        vm.openSession("s2"); runCurrent()
        assertEquals("", vm.panel)
        vm.panel = "new"; vm.browse(); runCurrent()
        vm.reopenComputer("other")
        assertNotEquals(owner, vm.uiOwnerEpoch)
        assertEquals("", vm.panel)
        assertTrue(vm.panelData.isEmpty())
        assertTrue(vm.allSessions.isEmpty())
        runCurrent()
        val otherOwner = vm.uiOwnerEpoch
        vm.panel = "settings"; vm.leaveComputer()
        assertNotEquals(otherOwner, vm.uiOwnerEpoch)
        assertEquals("", vm.panel)
        assertTrue(vm.panelData.isEmpty())
    }

    @Test fun recoveryBlocksTaskRpcsUntilCatalogAndSessionControlsHaveLoaded() = remoteTest {
        for (manual in listOf(false, true)) {
            val catalog = CompletableDeferred<Unit>()
            val controls = CompletableDeferred<Unit>()
            val (vm, clients) = model { index, relay ->
                if (index == 1) { relay.catalogGate = catalog; relay.modelGate = controls }
            }
            vm.reopenComputer(); runCurrent()
            vm.panel = "new"; vm.browse(); runCurrent()
            val snapshot = vm.panelData
            if (manual) vm.reopenComputer() else {
                clients[0].disconnect(IllegalStateException("network lost")); runCurrent()
                advanceTimeBy(1_000)
            }
            runCurrent()
            val recovered = clients[1]
            assertFalse(vm.chat.offline)
            assertTrue(vm.chat.loading)
            repeat(3) { vm.onForeground(); runCurrent() }
            assertEquals(1, recovered.hostCalls.count { it.first == "session.list" })
            val before = recovered.hostCalls.size
            vm.onChatAction(NativeChatAction("open", "s2"))
            vm.browse("C:/not-ready"); vm.findSessions("not-ready"); vm.registerDirectory(); runCurrent()
            assertEquals(before, recovered.hostCalls.size)
            assertEquals("browse", vm.panel)
            assertEquals(snapshot, vm.panelData)
            catalog.complete(Unit); runCurrent()
            assertTrue(vm.chat.loading)
            val duringControls = recovered.hostCalls.size
            vm.createSession(); vm.browse(); runCurrent()
            assertEquals(duringControls, recovered.hostCalls.size)
            controls.complete(Unit); runCurrent()
            assertFalse(vm.chat.loading)
            assertEquals("browse", vm.panel)
            vm.findSessions("now-ready"); runCurrent()
            assertEquals("now-ready", recovered.hostCalls.last { it.first == "session.search" }.second.string("query"))
        }
    }

    @Test fun failedRecoveryCatalogCanRetryWithoutDroppingTheTaskAndEmptyCatalogFinishesLoading() = remoteTest {
        val (vm, clients) = model { index, relay -> if (index == 1) relay.catalogFailures = 1 }
        vm.reopenComputer(); runCurrent()
        vm.panel = "new"; vm.browse(); runCurrent()
        val snapshot = vm.panelData
        clients[0].disconnect(IllegalStateException("network lost")); runCurrent()
        advanceTimeBy(1_000); runCurrent()
        assertFalse(vm.chat.offline)
        assertTrue(vm.chat.loading)
        assertTrue(vm.chat.error.contains("catalog unavailable"))
        val failedCalls = clients[1].hostCalls.size
        val failedError = vm.chat.error
        vm.onChatAction(NativeChatAction("open", "s2"))
        vm.openSession("s2")
        vm.onChatAction(NativeChatAction("send", "s1", text = "must not bypass catalog"))
        vm.findSessions("blocked"); runCurrent()
        assertEquals(failedCalls, clients[1].hostCalls.size)
        assertEquals("s1", vm.chat.sessionId)
        assertEquals("browse", vm.panel)
        assertEquals(snapshot, vm.panelData)
        assertEquals(failedError, vm.chat.error)
        assertTrue(vm.chat.loading)
        clients[1].emitProjection("s1"); runCurrent()
        assertTrue(vm.chat.loading)
        assertTrue(vm.chat.error.contains("catalog unavailable"))
        vm.onForeground(); runCurrent()
        assertFalse(vm.chat.loading)
        assertTrue(vm.chat.error.isEmpty())
        assertEquals("browse", vm.panel)
        assertEquals(snapshot, vm.panelData)
        assertEquals("s1", vm.chat.sessionId)
        assertEquals(1, clients[1].hostCalls.count { it.first == "session.models" })
        val (empty, emptyClients) = model { _, relay -> relay.sessions = emptyList() }
        empty.reopenComputer(); runCurrent()
        assertFalse(empty.chat.loading)
        assertEquals("", empty.chat.sessionId)
        assertTrue(emptyClients.single().hostCalls.none { it.first == "session.models" })
    }

    @Test fun catalogSyncCoalescesForegroundAndOldFailureCannotClearTheNewEpochOwner() = remoteTest {
        val oldGate = CompletableDeferred<Unit>()
        val newGate = CompletableDeferred<Unit>()
        val (vm, clients) = model { index, relay ->
            if (index == 1) relay.catalogFailures = 1
            if (index == 2) relay.catalogGate = newGate
        }
        vm.reopenComputer(); runCurrent()
        assertEquals(Route.Chat, vm.route)
        vm.reopenComputer(); runCurrent()
        assertEquals(Route.Chat, vm.route)
        assertTrue(vm.chat.error.contains("catalog unavailable"))
        val old = clients[1]
        old.catalogGate = oldGate; old.catalogFailures = 1
        vm.onForeground(); runCurrent()
        val oldCallCount = old.hostCalls.count { it.first == "session.list" }
        repeat(3) { vm.onForeground(); runCurrent() }
        assertEquals(oldCallCount, old.hostCalls.count { it.first == "session.list" })
        vm.reopenComputer(); runCurrent()
        val current = clients[2]
        assertTrue(vm.chat.loading)
        assertFalse(vm.chat.offline)
        assertTrue(vm.chat.error.isEmpty())
        oldGate.complete(Unit); runCurrent()
        assertTrue(vm.chat.loading)
        assertTrue(vm.chat.error.isEmpty())
        repeat(3) { vm.onForeground(); runCurrent() }
        assertEquals(1, current.hostCalls.count { it.first == "session.list" })
        newGate.complete(Unit); runCurrent()
        assertFalse(vm.chat.loading)
        assertTrue(vm.chat.error.isEmpty())
        assertEquals("s1", vm.chat.sessionId)
        assertEquals(1, current.hostCalls.count { it.first == "session.models" })
    }

    @Test fun freshPairingRecoveryUsesIssuedCredentialAndAuthenticationFailureStopsRetry() = remoteTest {
        val store = FakeStore(computersJson = "[]")
        val (vm, clients) = model(store)
        val freshOffer = obj("v" to 2, "serverId" to "computer", "daemonPublicKeyB64" to KEY,
            "relay" to obj("endpoint" to "127.0.0.1:1", "useTls" to false),
            "authBootstrap" to obj("version" to 1, "pairingToken" to "fresh-pairing-token-for-test", "expiresAtMs" to (System.currentTimeMillis() + 60_000)))
        vm.pair("https://example.test/#offer=" + Base64.getUrlEncoder().withoutPadding().encodeToString(freshOffer.toString().toByteArray()))
        runCurrent()
        assertFalse(clients.single().usedSavedSecret)
        clients[0].disconnect(IllegalStateException("connection lost")); runCurrent()
        advanceTimeBy(1_000); runCurrent()
        assertEquals(2, clients.size)
        assertTrue(clients[1].usedSavedSecret)
        assertNull(clients[1].usedOffer.authBootstrap)
        clients[1].disconnect(RelayAuthenticationException("authorization revoked")); runCurrent()
        advanceTimeBy(60_000); runCurrent()
        vm.onNetworkAvailable(); vm.onForeground(); runCurrent()
        assertEquals(2, clients.size)
        assertTrue(vm.chat.offline)
        assertTrue(store.computersJson.contains("computer"))
    }

    @Test fun reconnectReplacesApprovalReplyAddressAndIgnoresThePreviousClientsFrames() = remoteTest {
        val (vm, clients) = model()
        vm.reopenComputer(); runCurrent()
        vm.openSession("s2"); runCurrent()
        clients[0].emitApproval("s2", "a", "old-generation"); runCurrent()
        vm.reopenComputer(); runCurrent()
        assertEquals("s2", vm.chat.sessionId)
        clients[1].emitApproval("s2", "a", "current-generation")
        clients[0].emitApproval("s2", "a", "late-old-generation")
        runCurrent()
        assertEquals("current-generation", vm.chat.approval!!.rpcId)
        vm.onChatAction(NativeChatAction("approve", "s2", approvalId = "a", actionId = "rejected")); runCurrent()
        assertEquals("current-generation", clients[1].hostCalls.last { it.first == "respond" }.second.string("rpcId"))
        assertTrue(clients[0].hostCalls.none { it.first == "respond" })
    }

    @Test fun historyOnlyApprovalNeverSendsAnEmptyReplyAddress() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.histories["s1"] = listOf(asked("awaiting-mux")) }
        vm.reopenComputer(); runCurrent()
        assertTrue(vm.chat.approval!!.error.contains("同步"))
        vm.onChatAction(NativeChatAction("approve", "s1", approvalId = "awaiting-mux", actionId = "allowed-once")); runCurrent()
        assertTrue(clients.single().hostCalls.none { it.first == "respond" })
        assertTrue(vm.chat.banner.contains("尚未同步"))
    }

    @Test fun initialConnectionFailureDoesNotEnableAutomaticRetries() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.connectFailure = IllegalStateException("first connection failed") }
        vm.reopenComputer(); runCurrent()
        advanceTimeBy(60_000); runCurrent()
        vm.onNetworkAvailable(); runCurrent()
        assertEquals(1, clients.size)
        assertTrue(vm.chat.offline)
    }

    @Test fun switchingSessionResetsPermissionPlanAndBlocksActionsUntilAllControlsAreLoaded() = remoteTest {
        val (vm, clients) = model { _, relay ->
            relay.projections["s1"] = obj("permissions" to obj("currentValue" to "danger-full-access"), "plan" to obj("active" to true),
                "modelSelection" to obj("next" to obj("provider" to "provider", "model" to "reasoning-model", "reasoningEffort" to "high")))
            relay.projections["s2"] = obj("permissions" to obj("currentValue" to "read-only"), "plan" to obj("active" to false))
        }
        vm.reopenComputer(); runCurrent()
        assertEquals("danger-full-access", vm.chat.permissionCurrent)
        assertTrue(vm.chat.planOn)
        assertEquals("high", vm.chat.modelCurrentEffort)
        val relay = clients.single()
        val historyReady = CompletableDeferred<Unit>()
        val modelsReady = CompletableDeferred<Unit>()
        val commandsReady = CompletableDeferred<Unit>()
        relay.historyGates["s2"] = historyReady
        relay.modelGate = modelsReady
        relay.commandsGate = commandsReady
        vm.openSession("s2")
        assertTrue(vm.chat.loading)
        assertEquals("", vm.chat.permission)
        assertEquals("", vm.chat.permissionCurrent)
        assertTrue(vm.chat.permissionOptions.isEmpty())
        assertFalse(vm.chat.planOn)
        assertEquals("", vm.chat.modelCurrentEffort)
        runCurrent()
        relay.emitApproval("s2", "loading-approval", "reply-address"); runCurrent()
        val readsBeforeActions = relay.hostCalls.size
        val actions = listOf(NativeChatAction("send", "s2", text = "must wait"), NativeChatAction("permission", "s2", id = "danger-full-access"),
            NativeChatAction("model", "s2", provider = "provider", model = "reasoning-model", reasoningEffort = "high"), NativeChatAction("planOff", "s2"),
            NativeChatAction("slash", "s2", line = "/plan off"), NativeChatAction("approve", "s2", approvalId = "loading-approval", actionId = "allowed-once"))
        actions.forEach(vm::onChatAction); runCurrent()
        assertEquals(readsBeforeActions, relay.hostCalls.size)
        historyReady.complete(Unit); runCurrent()
        assertEquals("read-only", vm.chat.permissionCurrent)
        assertFalse(vm.chat.planOn)
        assertTrue(vm.chat.loading)
        modelsReady.complete(Unit); runCurrent()
        assertTrue(vm.chat.loading)
        vm.onChatAction(NativeChatAction("permission", "s2", id = "danger-full-access")); runCurrent()
        assertTrue(relay.hostCalls.none { it.first == "commands/execute" })
        commandsReady.complete(Unit); runCurrent()
        assertFalse(vm.chat.loading)
        assertEquals("read-only", vm.chat.permissionCurrent)
        vm.onChatAction(NativeChatAction("approve", "s2", approvalId = "loading-approval", actionId = "allowed-once")); runCurrent()
        assertEquals(1, relay.hostCalls.count { it.first == "respond" })
    }

    @Test fun modelProjectionClearsMissingEffortButAnAbsentSelectionKeepsTheCurrentEffort() = remoteTest {
        val (vm, clients) = model { _, relay ->
            relay.projections["s1"] = obj("modelSelection" to obj("next" to obj("provider" to "provider", "model" to "reasoning-model", "reasoningEffort" to "high")))
        }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        assertEquals("high", vm.chat.modelCurrentEffort)
        relay.projections["s1"] = obj("modelSelection" to obj("next" to null, "lastUsed" to null))
        relay.emitProjection("s1"); runCurrent()
        assertEquals("high", vm.chat.modelCurrentEffort)
        assertEquals("reasoning-model", vm.chat.modelCurrentId)
        relay.projections["s1"] = obj("modelSelection" to obj("next" to null, "lastUsed" to obj("provider" to "provider", "model" to "plain-model")))
        relay.emitProjection("s1"); runCurrent()
        assertEquals("plain-model", vm.chat.modelCurrentId)
        assertEquals("", vm.chat.modelCurrentEffort)
        relay.projections["s1"] = obj()
        relay.emitProjection("s1"); runCurrent()
        assertEquals("plain-model", vm.chat.modelCurrentId)
        assertEquals("", vm.chat.modelCurrentEffort)
    }

    @Test fun subagentFirstInCatalogUsesDurableDirectParentAddressAndSkipsComposerCatalogs() = remoteTest {
        val (vm, clients) = model { _, relay ->
            relay.sessions = listOf(sessionRow("child", "subagent", "parent"), sessionRow("parent"), sessionRow("nested", "subagent", "child"))
            relay.histories["child"] = listOf(obj("event" to obj("seq" to 1, "type" to "assistant/message", "data" to obj("id" to "child-answer",
                "message" to obj("content" to listOf(obj("type" to "text", "text" to "child history")))))))
            relay.projections["child"] = obj("title" to "Child title")
        }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        assertEquals(listOf("child", "parent", "nested"), vm.chat.sessions.map { it.id })
        assertEquals("child", vm.chat.sessionId)
        assertEquals("subagent", vm.currentSession()!!.origin)
        assertEquals("parent", vm.currentSession()!!.parentSessionId)
        assertEquals("只读会话", vm.chat.readOnly)
        assertEquals("child history", vm.chat.rows.single().text)
        assertEquals("Child title", vm.chat.title)
        assertFalse(vm.chat.loading)
        assertTrue(vm.chat.error.isEmpty())
        val first = relay.hostCalls.single { it.first == "session.history" }.second
        assertEquals(obj("kind" to "subagent", "parentSessionId" to "parent", "childSessionId" to "child", "mode" to "unknown"), first["address"])
        assertEquals(50L, first["maxMessages"].number())
        assertTrue(relay.hostCalls.any { it.first == "session.projections" && it.second.string("sessionId") == "child" })
        assertTrue(relay.hostCalls.none { it.first in setOf("session.models", "commands/list") })
        vm.onChatAction(NativeChatAction("send", "child", text = "read only")); runCurrent()
        assertTrue(relay.hostCalls.none { it.first == "session.prompt" })
        vm.onChatAction(NativeChatAction("older", "child")); runCurrent()
        val older = relay.hostCalls.last { it.first == "session.history" }.second
        assertEquals(first["address"], older["address"])
        assertEquals(1L, older["beforeSeq"].number())
        vm.openSession("nested"); runCurrent()
        val nested = relay.hostCalls.last { it.first == "session.history" }.second["address"].objectValue()
        assertEquals("child", nested.string("parentSessionId"))
        assertEquals("nested", nested.string("childSessionId"))
        assertTrue(relay.hostCalls.none { it.first in setOf("session.models", "commands/list") })
        relay.workspaceSessionIds = listOf("parent")
        vm.onForeground(); runCurrent()
        assertEquals(setOf("child", "parent", "nested"), vm.chat.sessions.map { it.id }.toSet())
        vm.openSession("parent"); runCurrent()
        assertEquals("", vm.chat.readOnly)
        assertNull(relay.hostCalls.last { it.first == "session.history" }.second["address"])
        assertEquals(1, relay.hostCalls.count { it.first == "session.models" })
        assertEquals(1, relay.hostCalls.count { it.first == "commands/list" })
    }

    @Test fun forkWithParentIdentityAndOrdinaryOriginKeepsAnEditableComposer() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.sessions = listOf(sessionRow("fork", "user", "parent"), sessionRow("parent")) }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        assertEquals("fork", vm.chat.sessionId)
        assertEquals("parent", vm.currentSession()!!.parentSessionId)
        assertFalse(vm.currentSession()!!.readOnly)
        assertEquals("", vm.chat.readOnly)
        assertNull(relay.hostCalls.single { it.first == "session.history" }.second["address"])
        assertEquals(1, relay.hostCalls.count { it.first == "session.models" })
        assertEquals(1, relay.hostCalls.count { it.first == "commands/list" })
        vm.onChatAction(NativeChatAction("send", "fork", text = "continue fork")); runCurrent()
        assertEquals("fork", relay.hostCalls.single { it.first == "session.prompt" }.second.string("sessionId"))
    }

    @Test fun failedImageKeepsReadableErrorWhileGoodImageLoadsAndPollingDoesNotRepeatReads() = remoteTest {
        val goodImage = CompletableDeferred<JsonObject>()
        val (vm, clients) = model { _, relay ->
            relay.histories["s1"] = listOf(imageEvent("bad", "good"))
            relay.attachmentReply = { id -> if (id == "bad") error("Image is not referenced by this session.") else goodImage.await() }
        }
        vm.reopenComputer(); runCurrent()
        assertEquals("Image is not referenced by this session.", vm.chat.rows.single().images[0].error)
        assertTrue(vm.chat.banner.contains("Image is not referenced"))
        assertEquals("", vm.chat.rows.single().images[1].data)
        goodImage.complete(obj("attachment" to obj("attachmentId" to "good", "mediaType" to "image/png"), "data" to "good-image-data")); runCurrent()
        assertEquals("good-image-data", vm.chat.rows.single().images[1].data)
        val relay = clients.single()
        repeat(3) { relay.emitProjection("s1"); runCurrent() }
        assertEquals(listOf("bad", "good"), relay.hostCalls.filter { it.first == "session.attachment" }.map { it.second.string("attachmentId") })
        assertTrue(vm.chat.rows.single().images[0].error.contains("not referenced"))
        assertEquals("good-image-data", vm.chat.rows.single().images[1].data)
    }

    @Test fun successfulImageIsVisibleBeforeTheNextReadEndsAndIsReadAgainAfterSessionReopen() = remoteTest {
        val waiting = CompletableDeferred<JsonObject>()
        val canceled = CompletableDeferred<Unit>()
        val (vm, clients) = model { _, relay ->
            relay.histories["s1"] = listOf(imageEvent("good", "waiting"))
            relay.attachmentReply = { id ->
                if (id == "good") obj("attachment" to obj("attachmentId" to id, "mediaType" to "image/png"), "data" to "immediate-image")
                else try { waiting.await() } finally { canceled.complete(Unit) }
            }
        }
        vm.reopenComputer(); runCurrent()
        assertEquals("immediate-image", vm.chat.rows.single().images[0].data)
        assertEquals("", vm.chat.rows.single().images[1].data)
        assertFalse(canceled.isCompleted)
        vm.openSession("s2"); runCurrent()
        assertTrue(canceled.isCompleted)
        assertTrue(vm.chat.rows.isEmpty())
        assertTrue(vm.chat.banner.isEmpty())
        waiting.complete(obj("attachment" to obj("attachmentId" to "waiting", "mediaType" to "image/png"), "data" to "late-image")); runCurrent()
        assertEquals("s2", vm.chat.sessionId)
        assertTrue(vm.chat.rows.isEmpty())
        vm.openSession("s1"); runCurrent()
        assertEquals(listOf("immediate-image", "late-image"), vm.chat.rows.single().images.map { it.data })
        assertEquals(2, clients.single().hostCalls.count { it.first == "session.attachment" && it.second.string("attachmentId") == "good" })
    }

    @Test fun durableHistoryImagesAreLoadedByAttachmentAndLateImagesCannotReachAnotherSession() = remoteTest {
        val imageValue = CompletableDeferred<JsonObject>()
        val (vm, clients) = model { _, relay ->
            relay.histories["s1"] = listOf(obj("event" to obj("seq" to 1, "type" to "user/message", "data" to obj("id" to "image-message", "source" to obj("kind" to "user"),
                "content" to listOf(obj("type" to "image", "attachment" to obj("attachmentId" to "image-id", "mediaType" to "image/png")))))))
            relay.attachmentReply = { imageValue.await() }
        }
        vm.reopenComputer(); runCurrent()
        assertEquals("image-id", vm.chat.rows.single().images.single().attachmentId)
        vm.openSession("s2"); runCurrent()
        imageValue.complete(obj("attachment" to obj("attachmentId" to "image-id", "mediaType" to "image/png"), "data" to "restored-bytes")); runCurrent()
        assertEquals("s2", vm.chat.sessionId)
        assertTrue(vm.chat.rows.isEmpty())
        vm.openSession("s1"); runCurrent()
        assertEquals("restored-bytes", vm.chat.rows.single().images.single().data)
        val request = clients.single().hostCalls.last { it.first == "session.attachment" }.second
        assertEquals("s1", request.string("sessionId")); assertEquals("image-id", request.string("attachmentId"))
    }

    @Test fun queueUsesCurrentProjectionAndBlocksBlankAttachmentAndUnavailableSteeringMutations() = remoteTest {
        val (vm, clients) = model { _, relay ->
            relay.projections["s1"] = queueProjection(
                nextTurn = listOf(queueMessage("plain", "original"), queueMessage("photo", "caption", image = true)),
                nextStep = listOf(queueMessage("step", "next step")))
        }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        assertEquals(listOf("plain", "photo", "step"), vm.chat.queue.map { it.id })
        assertEquals(NativeSessionUsage(100, 20, 5, 2), vm.chat.usage)
        val before = relay.hostCalls.size
        listOf(
            NativeChatAction("queue", "s2", id = "plain", line = "remove"),
            NativeChatAction("queue", "s1", id = "plain", line = "edit", text = "  "),
            NativeChatAction("queue", "s1", id = "photo", line = "edit", text = "drop attachment"),
            NativeChatAction("queue", "s1", id = "missing", line = "remove"),
            NativeChatAction("queue", "s1", id = "plain", line = "steer"),
            NativeChatAction("queue", "s1", id = "plain", line = "reorder"),
        ).forEach { vm.onChatAction(it); runCurrent() }
        assertEquals(before, relay.hostCalls.size)
        vm.update { copy(running = true) }
        vm.onChatAction(NativeChatAction("queue", "s1", id = "step", line = "steer")); runCurrent()
        assertEquals(before, relay.hostCalls.size)
        relay.queueReply = { payload ->
            assertEquals("s1", payload.string("sessionId")); assertEquals("plain", payload.string("itemId"))
            assertEquals(obj("kind" to "steer"), payload["action"])
            relay.projections["s1"] = queueProjection(nextStep = listOf(queueMessage("step", "next step")))
            obj("accepted" to true)
        }
        vm.onChatAction(NativeChatAction("queue", "s1", id = "plain", line = "steer")); runCurrent()
        assertEquals(listOf("step"), vm.chat.queue.map { it.id })
        vm.openSession("s2"); runCurrent()
        assertTrue(vm.chat.queue.isEmpty()); assertNull(vm.chat.usage)
    }

    @Test fun queueAcknowledgementRereadsServerTruthAndFailuresNeverOptimisticallyDeleteOrClearDrafts() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.projections["s1"] = queueProjection(nextTurn = listOf(queueMessage("q", "original"))) }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        vm.onChatAction(NativeChatAction("draft", "s1", text = "keep draft"))
        vm.addImage("computer", "s1", NativeImage("image/png", "keep image"))
        relay.queueReply = { error("queue acknowledgement lost") }
        vm.onChatAction(NativeChatAction("queue", "s1", id = "q", line = "remove")); runCurrent()
        assertEquals("original", vm.chat.queue.single().text)
        assertEquals("queue acknowledgement lost", vm.chat.banner)
        relay.queueReply = { obj("accepted" to false) }
        vm.onChatAction(NativeChatAction("queue", "s1", id = "q", line = "remove")); runCurrent()
        assertEquals("q", vm.chat.queue.single().id)
        relay.queueReply = { payload ->
            assertEquals(obj("kind" to "edit", "content" to listOf(obj("type" to "text", "text" to "edited"))), payload["action"])
            relay.projections["s1"] = queueProjection(nextTurn = listOf(queueMessage("q", "server-edited")))
            obj("accepted" to true)
        }
        vm.onChatAction(NativeChatAction("queue", "s1", id = "q", line = "edit", text = "edited")); runCurrent()
        assertEquals("server-edited", vm.chat.queue.single().text)
        assertEquals("keep draft", vm.chat.draft); assertEquals("keep image", vm.chat.attachments.single().data)
        assertFalse(vm.chat.busy)
        relay.queueReply = { payload ->
            assertEquals(obj("kind" to "remove"), payload["action"])
            relay.projections["s1"] = queueProjection()
            obj("accepted" to true)
        }
        vm.onChatAction(NativeChatAction("queue", "s1", id = "q", line = "remove")); runCurrent()
        assertTrue(vm.chat.queue.isEmpty())
        assertEquals("keep draft", vm.chat.draft); assertEquals("keep image", vm.chat.attachments.single().data)
    }

    @Test fun retiredQueueAcknowledgementCannotReplaceAnotherComputerAndOfflineActionsDoNotWrite() = remoteTest {
        val receipt = CompletableDeferred<Unit>()
        val (vm, clients) = model(FakeStore(computersJson = Json.encodeToString(listOf(saved(), saved("other"))))) { index, relay ->
            relay.projections["s1"] = queueProjection(nextTurn = listOf(queueMessage(if (index == 0) "old" else "new", "pending")))
        }
        vm.reopenComputer("computer"); runCurrent()
        val old = clients.single()
        old.queueReply = { withContext(NonCancellable) { receipt.await() }; obj("accepted" to true) }
        vm.onChatAction(NativeChatAction("queue", "s1", id = "old", line = "remove")); runCurrent()
        assertTrue(vm.chat.busy)
        vm.reopenComputer("other"); runCurrent()
        assertEquals("new", vm.chat.queue.single().id)
        val current = vm.chat
        receipt.complete(Unit); runCurrent()
        assertSame(current, vm.chat)
        clients.last().disconnect(IllegalStateException("offline queue")); runCurrent()
        val count = clients.last().hostCalls.size
        vm.onChatAction(NativeChatAction("queue", "s1", id = "new", line = "remove")); runCurrent()
        assertEquals(count, clients.last().hostCalls.size)
        assertEquals("new", vm.chat.queue.single().id)
    }

    private class FakeRelay(
        val usedOffer: Offer,
        credential: SavedComputer?,
        private val persistRecord: (SavedComputer) -> Unit,
        private val mux: (JsonObject) -> Unit,
    ) : RelayClient(usedOffer, credential, "test phone", persistRecord, mux, {}) {
        val usedSavedSecret = credential != null
        override val status = MutableStateFlow("test connection")
        val hostCalls = mutableListOf<Pair<String, JsonObject>>()
        val gitCalls = mutableListOf<String>()
        var sessions = listOf("s1", "s2", "created").map { id -> sessionRow(id) }
        var workspaceSessionIds: List<String>? = null
        val histories = mutableMapOf<String, List<JsonObject>>()
        val projections = mutableMapOf<String, JsonObject>()
        val historyGates = mutableMapOf<String, CompletableDeferred<Unit>>()
        var modelGate: CompletableDeferred<Unit>? = null
        var modelCatalog = obj("groups" to emptyList<JsonObject>())
        var commandsGate: CompletableDeferred<Unit>? = null
        var subscriptions = 0
        var subscribeFailure: Throwable? = null
        val hostFailures = mutableMapOf<String, Throwable>()
        var catalogFailures = 0
        var catalogGate: CompletableDeferred<Unit>? = null
        var connectGate: CompletableDeferred<Unit>? = null
        var connectFailure: Throwable? = null
        var connectAttempt: (suspend () -> Unit)? = null
        var gitReply: suspend (String, String) -> JsonElement = { _, _ -> obj("isRepo" to true) }
        var attachmentReply: suspend (String) -> JsonObject = { error("unexpected image read") }
        var queueReply: suspend (JsonObject) -> JsonElement = { obj("accepted" to true) }
        var searchReply: suspend (String) -> JsonObject = { query -> obj("items" to listOf(obj("sessionId" to "s1", "snippet" to query))) }
        private val ended = CompletableDeferred<Throwable>()
        override suspend fun connect() {
            connectGate?.await()
            connectAttempt?.invoke()
            connectFailure?.let { throw it }
            connected = true
            persistRecord(saved(usedOffer.serverId))
            status.value = "connected"
        }
        override suspend fun awaitDisconnect() = ended.await()
        fun disconnect(failure: Throwable) { connected = false; status.value = failure.message.orEmpty(); ended.complete(failure) }
        override fun close() { connected = false; ended.complete(CancellationException("closed")); super.close() }
        override fun subscribe() { subscriptions++; subscribeFailure?.let { throw it } }
        override suspend fun host(method: String, payload: JsonObject): JsonElement {
            hostCalls += method to payload
            hostFailures[method]?.let { throw it }
            return when (method) {
                "session.list" -> {
                    catalogGate?.await()
                    if (catalogFailures-- > 0) error("catalog unavailable")
                    obj("items" to sessions)
                }
                "workspace.list" -> obj("items" to listOf(obj("workspaceId" to "w", "title" to "Workspace", "path" to "C:/repo", "sessionIds" to (workspaceSessionIds ?: sessions.map { it.string("sessionId") }))))
                "session.create" -> obj("sessionId" to "created")
                "session.search" -> searchReply(payload.string("query"))
                "session.history" -> {
                    val owner = payload.string("sessionId")
                    sessions.find { it.string("sessionId") == owner && it.string("origin") == "subagent" }?.let { child ->
                        require(payload["address"] == obj("kind" to "subagent", "parentSessionId" to child.string("parentSessionId"), "childSessionId" to owner, "mode" to "unknown")) {
                            "subagent Sessions require their durable parent address"
                        }
                    }
                    historyGates[owner]?.await()
                    obj("events" to histories[owner].orEmpty(), "hasMore" to false)
                }
                "session.projections" -> obj("values" to (projections[payload.string("sessionId")] ?: obj()))
                "session.updateQueue" -> queueReply(payload)
                "session.models" -> { modelGate?.await(); modelCatalog }
                "commands/list" -> { commandsGate?.await(); JsonArray(emptyList()) }
                "host.listDirectory" -> obj("path" to "C:/new", "entries" to emptyList<JsonObject>())
                "workspace.create" -> obj("workspace" to obj("workspaceId" to "new-workspace"))
                "session.attachment" -> attachmentReply(payload.string("attachmentId"))
                "respond", "session.prompt", "session.selectModel" -> obj()
                else -> error("unexpected host method $method")
            }
        }
        override suspend fun git(action: String, cwd: String, payload: JsonObject): JsonElement {
            gitCalls += action
            return gitReply(action, cwd)
        }
        fun emitApproval(session: String, id: String, rpc: String) = mux(obj("rpcId" to rpc, "envelope" to obj("payload" to
            obj("type" to "approval/requested", "sessionId" to session, "approvalId" to id, "toolName" to "pwsh", "reason" to "test request"))))
        fun emitResolved(session: String, id: String) = mux(obj("envelope" to obj("payload" to obj("type" to "approval/resolved", "sessionId" to session, "approvalId" to id))))
        fun emitProjection(session: String) = mux(obj("envelope" to obj("payload" to obj("type" to "session/projection", "sessionId" to session, "key" to "modelSelection"))))
    }
    private class FakeStore(
        override var webAppUrl: String = "", override var scheme: String = "system", override var computersJson: String = Json.encodeToString(listOf(saved())),
        override var draftsJson: String = "{}", override var selectedComputer: String = "computer", override var nativeMigrationDone: Boolean = true,
    ) : DeviceStore { override fun clearLegacyHttpCredentials() {} }
    companion object {
        private val KEY = Base64.getEncoder().encodeToString(ByteArray(32) { (it + 1).toByte() })
        private fun saved(id: String = "computer") = SavedComputer(id, "device", "test-device-secret", KEY, "127.0.0.1:1", false, "Test computer")
        private fun asked(id: String) = obj("event" to obj("seq" to 1, "type" to "approval/asked", "data" to obj("id" to id, "toolName" to "pwsh")))
        private fun sessionRow(id: String, origin: String = "", parent: String = "") = obj("sessionId" to id, "cwd" to "C:/repo", "origin" to origin,
            "parentSessionId" to parent, "projections" to obj("values" to obj("title" to id)))
        private fun queueMessage(id: String, text: String, image: Boolean = false) = obj("id" to id, "source" to obj("kind" to "user"),
            "content" to (listOf(obj("type" to "text", "text" to text)) + if (image) listOf(obj("type" to "image", "attachment" to obj("attachmentId" to "photo"))) else emptyList()))
        private fun queueProjection(nextTurn: List<JsonObject> = emptyList(), nextStep: List<JsonObject> = emptyList()) = obj(
            "inbox" to obj("next-turn" to nextTurn, "next-step" to nextStep),
            "usagePanel" to obj("totals" to obj("input" to 100, "output" to 20, "cacheRead" to 5, "cacheWrite" to 2)))
        private fun imageEvent(vararg ids: String) = obj("event" to obj("seq" to 1, "type" to "user/message", "data" to obj(
            "id" to "images", "source" to obj("kind" to "user"), "content" to ids.map { id ->
                obj("type" to "image", "attachment" to obj("attachmentId" to id, "mediaType" to "image/png"))
            })))
    }
}
