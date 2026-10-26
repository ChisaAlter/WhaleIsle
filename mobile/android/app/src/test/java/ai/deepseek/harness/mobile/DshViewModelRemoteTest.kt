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

    @Test fun firstCatalogFailureStillSubscribesAndForegroundRetryRefreshesCatalogWithoutOpeningSession() = remoteTest {
        val (vm, clients) = model { _, relay -> relay.catalogFailures = 1 }
        vm.reopenComputer(); runCurrent()
        val relay = clients.single()
        assertEquals(1, relay.subscriptions)
        assertTrue(vm.chat.error.contains("catalog unavailable"))
        vm.onForeground(); runCurrent()
        assertEquals("", vm.chat.sessionId)
        assertEquals(listOf("s1", "s2", "created"), vm.chat.sessions.map { it.id })
        assertTrue(relay.hostCalls.none { it.first in setOf("session.history", "session.models", "commands/list") })
        assertEquals(1, relay.subscriptions)
        assertTrue(vm.chat.error.isEmpty())
        vm.openSession("s1"); runCurrent()
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
        var catalogFailures = 0
        var connectGate: CompletableDeferred<Unit>? = null
        var connectFailure: Throwable? = null
        var connectAttempt: (suspend () -> Unit)? = null
        var gitReply: suspend (String, String) -> JsonElement = { _, _ -> obj("isRepo" to true) }
        var attachmentReply: suspend (String) -> JsonObject = { error("unexpected image read") }
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
        override fun subscribe() { subscriptions++ }
        override suspend fun host(method: String, payload: JsonObject): JsonElement {
            hostCalls += method to payload
            return when (method) {
                "session.list" -> {
                    if (catalogFailures-- > 0) error("catalog unavailable")
                    obj("items" to sessions)
                }
                "workspace.list" -> obj("items" to listOf(obj("workspaceId" to "w", "title" to "Workspace", "path" to "C:/repo", "sessionIds" to (workspaceSessionIds ?: sessions.map { it.string("sessionId") }))))
                "session.create" -> obj("sessionId" to "created")
                "session.search" -> obj("items" to listOf(obj("sessionId" to "s1", "snippet" to payload.string("query"))))
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
                "session.models" -> { modelGate?.await(); modelCatalog }
                "commands/list" -> { commandsGate?.await(); JsonArray(emptyList()) }
                "host.listDirectory" -> obj("path" to "C:/new", "entries" to emptyList<JsonObject>())
                "workspace.create" -> obj("workspace" to obj("workspaceId" to "new-workspace"))
                "session.attachment" -> attachmentReply(payload.string("attachmentId"))
                "respond", "session.prompt" -> obj()
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
        private fun imageEvent(vararg ids: String) = obj("event" to obj("seq" to 1, "type" to "user/message", "data" to obj(
            "id" to "images", "source" to obj("kind" to "user"), "content" to ids.map { id ->
                obj("type" to "image", "attachment" to obj("attachmentId" to id, "mediaType" to "image/png"))
            })))
    }
}
