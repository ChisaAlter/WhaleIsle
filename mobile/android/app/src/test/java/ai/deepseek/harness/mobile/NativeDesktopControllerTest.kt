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
    @Test fun failedFileReadRetainsDirectoryAndNeverClaimsEmptySuccess() = runTest {
        val controller = NativeDesktopController(this, { "o" }, { "s" }, { "/p" }, { _, _ -> error("permission denied") }, { _, _ -> obj() })
        controller.open("files"); runCurrent()
        assertFalse(controller.state.loaded)
        assertEquals("permission denied", controller.state.error)
        assertFalse(controller.state.busy)
    }
}
