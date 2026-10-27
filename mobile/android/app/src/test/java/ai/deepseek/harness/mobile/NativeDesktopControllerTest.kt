package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NativeDesktopControllerTest {
    @Test fun workspaceFilesUseRealLookupAndPagedReadArguments() = runTest {
        val requests = mutableListOf<Pair<String, JsonObject>>()
        val controller = NativeDesktopController(this, { "owner" }, { "session" }, { "/project" }, { method, payload ->
            requests += method to payload
            if (method == "workspaceFiles.list") obj("entries" to listOf(obj("name" to "file.kt", "type" to "file")))
            else obj("offset" to 201, "text" to "line", "lines" to 1, "eof" to true)
        }, { _, _ -> obj() })
        controller.open("files"); runCurrent()
        assertTrue(controller.state.loaded)
        assertEquals("session", requests.first().second["args"].objectValue().string("workspaceFileScopeId"))
        controller.readFile("file.kt", 201); runCurrent()
        val read = requests.last()
        assertEquals("workspaceFiles.read", read.first)
        assertEquals(201L, read.second["args"].objectValue()["range"].objectValue()["offset"].number())
        assertEquals(200L, read.second["args"].objectValue()["range"].objectValue()["limit"].number())
    }
    @Test fun oldComputerReplyCannotPerformFollowupOnNewComputer() = runTest {
        var owner = "first"
        val gate = CompletableDeferred<JsonElement>()
        val methods = mutableListOf<String>()
        val controller = NativeDesktopController(this, { owner }, { "session" }, { "/project" }, { method, _ ->
            methods += method
            if (method == "mcpServers.list") obj("servers" to emptyList<JsonObject>()) else gate.await()
        }, { _, _ -> obj() })
        controller.open("mcp"); runCurrent()
        controller.mcpAction("setEnabled", "server", true); runCurrent()
        owner = "second"
        gate.complete(JsonNull); runCurrent()
        assertEquals(listOf("mcpServers.list", "mcpServers.setEnabled"), methods)
        assertTrue(controller.state.notice.isBlank())
    }
    @Test fun missingPluginManagementUsesRealInventoryWithoutCallingMissingService() = runTest {
        val methods = mutableListOf<String>()
        val controller = NativeDesktopController(this, { "o" }, { "s" }, { "/p" }, { method, _ -> methods += method; obj("entries" to listOf(obj("entryId" to "one", "moduleName" to "test", "enabled" to true))) }, { _, _ -> obj() })
        controller.open("plugins"); runCurrent()
        assertEquals(listOf("pluginInventory.list"), methods)
        assertEquals("test", controller.state.data.objects("plugins").single().string("moduleName"))
        assertTrue(controller.state.error.isBlank())
    }
    @Test fun settingWriteCarriesRevisionAndConflictKeepsOriginalDetail() = runTest {
        var request = obj()
        val descriptor = obj("ns" to "models", "revision" to 7, "value" to obj("model" to "old"))
        val controller = NativeDesktopController(this, { "o" }, { "s" }, { "/p" }, { method, payload ->
            if (method == "settings.describe") obj("writable" to true, "namespaces" to listOf(descriptor))
            else { request = payload; error("settings/conflict") }
        }, { _, _ -> obj() })
        controller.open("settings"); runCurrent(); controller.showNamespace(descriptor)
        controller.saveSetting(descriptor, NativeSettingField(listOf("model"), "model", "", obj("type" to "string"), JsonPrimitive("old"), false), JsonPrimitive("new")); runCurrent()
        assertEquals(7L, request["args"].objectValue()["expectedRevision"].number())
        assertEquals(descriptor, controller.state.detail)
        assertTrue(controller.state.error.contains("conflict"))
    }
    @Test fun nullDiffIsFailureAndEmptyFilesIsHonestEmptySuccess() = runTest {
        var response: JsonElement = JsonNull
        val controller = NativeDesktopController(this, { "o" }, { "s" }, { "/p" }, { _, _ -> obj() }, { _, _ -> response })
        controller.open("diff"); runCurrent()
        assertFalse(controller.state.loaded)
        assertTrue(controller.state.error.contains("无法读取差异"))
        response = obj("files" to emptyList<JsonObject>())
        controller.refresh(); runCurrent()
        assertTrue(controller.state.loaded)
        assertTrue(controller.state.error.isBlank())
    }
    @Test fun existingSignInAttemptCannotStartAgainOrReplaceCallback() = runTest {
        val methods = mutableListOf<String>()
        val controller = NativeDesktopController(this, { "o" }, { "s" }, { "/p" }, { method, _ ->
            methods += method; obj("status" to "signed-out", "attempt" to obj("id" to "active", "phase" to "waiting-browser", "authorizeUrl" to "https://platform.example/auth"))
        }, { _, _ -> obj() })
        controller.open("account"); runCurrent()
        controller.startSignIn { fail("Must not open a second authorization URL") }; runCurrent()
        assertEquals(listOf("account.getState"), methods)
    }
    @Test fun reconnectDuringInstallReleasesOperationAndRetainsUnknownResult() = runTest {
        var owner = "one"
        val gate = CompletableDeferred<JsonElement>()
        var installs = 0
        val controller = NativeDesktopController(this, { owner }, { "s" }, { "/p" }, { method, _ -> when (method) {
            "pluginInventory.list" -> obj("managementAvailable" to true)
            "pluginManager.listPlugins", "pluginManager.listBundles" -> JsonArray(emptyList())
            "pluginManager.installBundle" -> { installs++; gate.await() }
            else -> obj()
        } }, { _, _ -> obj() })
        controller.open("plugins"); runCurrent(); controller.installPlugin("test-bundle"); runCurrent()
        assertTrue(controller.installRequestId.isNotBlank())
        owner = "two"; gate.complete(obj("application" to "applied")); runCurrent()
        assertEquals("", controller.installRequestId)
        assertTrue(controller.installUncertain)
        assertTrue(controller.uncertainInstallRequestId.isNotBlank())
        controller.installPlugin("test-bundle"); runCurrent()
        assertEquals(1, installs)
        controller.recoverInstall(); runCurrent()
        assertFalse(controller.installUncertain)
        assertEquals("", controller.uncertainInstallRequestId)
        assertEquals(1, installs)
    }
    @Test fun absentInstallRecoveryDoesNotClaimSuccessOrReplayInstallation() = runTest {
        var owner = "one"
        val gate = CompletableDeferred<JsonElement>()
        var installs = 0
        val controller = NativeDesktopController(this, { owner }, { "s" }, { "/p" }, { method, _ -> when (method) {
            "pluginInventory.list" -> obj("managementAvailable" to true)
            "pluginManager.listPlugins", "pluginManager.listBundles" -> JsonArray(emptyList())
            "pluginManager.installBundle" -> { installs++; gate.await() }
            "pluginManager.waitForInstall" -> JsonNull
            else -> obj()
        } }, { _, _ -> obj() })
        controller.open("plugins"); runCurrent(); controller.installPlugin("bundle"); runCurrent()
        owner = "two"; gate.complete(JsonNull); runCurrent()
        controller.recoverInstall(); runCurrent()
        assertFalse(controller.installUncertain)
        assertTrue(controller.state.notice.contains("未确认成功"))
        assertEquals(1, installs)
    }
    @Test fun delayedAccountStartCannotPollNewComputerOrOpenItsBrowser() = runTest {
        var owner = "first"
        val started = CompletableDeferred<Unit>()
        val response = CompletableDeferred<JsonElement>()
        val initiatingCalls = mutableListOf<String>()
        var browserOpened = false
        val initiating: suspend (String, JsonObject) -> JsonElement = { method, _ ->
            initiatingCalls += method
            if (method == "account.startSignIn") { started.complete(Unit); response.await() } else obj()
        }
        val controller = NativeDesktopController(this, { owner }, { "s" }, { "/p" }, { _, _ -> obj("status" to "signed-out", "attempt" to JsonNull) }, { _, _ -> obj() }, accountConnection = { initiating })
        controller.open("account"); runCurrent(); controller.startSignIn { browserOpened = true }
        started.await()
        owner = "second"; controller.reset()
        response.complete(obj("status" to "signed-out", "attempt" to obj("id" to "late", "phase" to "waiting-browser", "authorizeUrl" to "https://platform.example/auth")))
        runCurrent()
        assertFalse(browserOpened)
        assertEquals("", controller.pendingLoginAttempt())
        assertEquals(listOf("account.startSignIn", "account.cancelSignIn"), initiatingCalls)
    }
    @Test fun failedFileReadRetainsDirectoryAndNeverClaimsEmptySuccess() = runTest {
        val controller = NativeDesktopController(this, { "o" }, { "s" }, { "/p" }, { _, _ -> error("permission denied") }, { _, _ -> obj() })
        controller.open("files"); runCurrent()
        assertFalse(controller.state.loaded)
        assertEquals("permission denied", controller.state.error)
        assertFalse(controller.state.busy)
    }
}
