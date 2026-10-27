package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.pair.OfferCodec
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors

/** Explicit opt-in against the dedicated QA Electron desktop through the public encrypted relay. */
class NativeDesktopRealHostTest {
    @Test fun nativeManagementConsumersUseRealHostServices() = runBlocking {
        val inputPath = System.getenv("DSH_ANDROID_E2E_INPUT")
        assumeTrue("Requires the dedicated QA desktop input", !inputPath.isNullOrBlank())
        val inputFile = File(inputPath!!).canonicalFile
        val input = Json.parseToJsonElement(inputFile.readText()).objectValue()
        val refresh = input.string("refreshScript")
        check(refresh.isNotBlank() && input.string("pairingFile").isNotBlank()) { "Dedicated QA pairing configuration is required" }
        check(ProcessBuilder("node", refresh, "pair").inheritIO().start().waitFor() == 0) { "Dedicated QA offer refresh failed" }
        val pairing = Json.parseToJsonElement(File(input.string("pairingFile")).readText()).objectValue().string("url")
        val offer = OfferCodec.fromPaste(pairing) ?: error("Invalid dedicated QA offer")
        val relay = RelayClient(offer, null, "Android native management QA", {}, {}, {})
        val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
        val scope = CoroutineScope(SupervisorJob() + dispatcher)
        val results = mutableListOf<JsonObject>()
        val selectedCases = System.getenv("DSH_ANDROID_NATIVE_CASES").orEmpty().split(',').map { it.trim() }.filter { it.isNotBlank() }.toSet()
        val failures = mutableListOf<String>()
        val workspaceParent = input.string("workspacePath").ifBlank { File(inputFile.parentFile, "test-workspace").path }
        check(File(workspaceParent).isDirectory) { "Dedicated fixture workspace is required" }
        val stamp = UUID.randomUUID().toString().take(8)
        val fixture = File(workspaceParent, "native-management-$stamp").canonicalFile
        check(fixture.parentFile == File(workspaceParent).canonicalFile) { "Fixture must be inside the dedicated workspace" }
        fixture.mkdirs()
        val lines = (1..450).map { "NATIVE_MANAGEMENT_LINE_${it.toString().padStart(3, '0')}" }
        File(fixture, "pages.txt").writeText(lines.joinToString("\n", postfix = "\n"))
        val imageBytes = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=")
        File(fixture, "pixel.png").writeBytes(imageBytes)
        fun gitFixture(vararg arguments: String) {
            check(ProcessBuilder(listOf("git", "-C", fixture.path) + arguments).inheritIO().start().waitFor() == 0) { "Dedicated fixture Git setup failed" }
        }
        gitFixture("init", "-b", "main")
        gitFixture("add", "pages.txt", "pixel.png")
        gitFixture("-c", "user.name=Android QA", "-c", "user.email=qa@example.invalid", "commit", "-m", "Seed native management fixture")
        File(fixture, "change.txt").writeText("NATIVE_MANAGEMENT_DIFF\n")
        var workspace = ""
        var session = ""
        var controller: NativeDesktopController? = null
        suspend fun rpc(method: String, vararg fields: Pair<String, Any?>) = relay.host(method, obj("args" to obj(*fields)))
        suspend fun perform(label: String, allowError: Boolean = false, action: NativeDesktopController.() -> Unit): NativeDesktopState {
            val current = controller ?: error("Controller is not initialized")
            withContext(dispatcher) { current.action() }
            withTimeout(60_000) { while (withContext(dispatcher) { current.state.busy }) delay(25) }
            val state = withContext(dispatcher) { current.state }
            if (!allowError) assertTrue("$label: ${state.error}", state.error.isBlank())
            return state
        }
        suspend fun probe(name: String, action: suspend () -> Unit) {
            if (selectedCases.isNotEmpty() && name !in selectedCases) return
            try { action(); results += obj("case" to name, "status" to "passed") }
            catch (failure: Throwable) {
                if (failure is CancellationException) throw failure
                failures += "$name: ${failure.message}"
                results += obj("case" to name, "status" to "failed", "error" to (failure.message ?: failure.javaClass.simpleName))
            }
        }
        try {
            relay.connect()
            workspace = rpc("workspace.create", "request" to obj("path" to fixture.path)).objectValue()["workspace"].objectValue().string("workspaceId")
            check(workspace.isNotBlank()) { "Real workspace registration failed" }
            session = rpc("session.create", "request" to obj("workspaceId" to workspace)).objectValue().string("sessionId")
            check(session.isNotBlank()) { "Real session creation failed" }
            controller = withContext(dispatcher) { NativeDesktopController(scope, { "qa/$session" }, { session }, { fixture.path }, { method, payload -> relay.host(method, payload) }, { method, payload -> relay.git(method, fixture.path, payload) }).also { it.setAppVersion("0.3.10") } }
            probe("workspace-files-paging-and-image") {
                val listing = perform("list files") { open("files") }
                assertTrue(listing.loaded)
                assertTrue(listing.data.objects("entries").any { it.string("name") == "pages.txt" })
                val page1 = perform("first page") { readFile("pages.txt") }.detail
                assertEquals(lines.take(200).joinToString("\n"), page1.string("text"))
                assertFalse(page1["eof"].flag())
                val page2 = perform("second page") { readFile("pages.txt", 201) }.detail
                assertEquals(lines.drop(200).take(200).joinToString("\n"), page2.string("text"))
                val page3 = perform("last page") { readFile("pages.txt", 401) }.detail
                assertEquals(lines.drop(400).joinToString("\n"), page3.string("text"))
                assertTrue(page3["eof"].flag())
                val image = perform("image") { readFile("pixel.png") }.detail
                assertEquals("image/png", image.string("mediaType"))
                assertArrayEquals(imageBytes, Base64.getDecoder().decode(image.string("data")))
            }
            probe("git-diff-and-invalid-reference") {
                val diff = perform("real diff") { open("diff") }
                assertTrue(diff.data.objects("files").any { it.string("path") == "change.txt" })
                val invalid = perform("invalid reference", true) { diff("refs/heads/qa-does-not-exist-$stamp") }
                assertTrue(invalid.error.contains("无法读取差异"))
                perform("recover working tree diff") { diff("") }
            }
            probe("mcp-create-edit-disable-delete") {
                perform("MCP list") { open("mcp") }
                val id = nativeMcpId()
                val spec = obj("id" to id, "serverName" to "qa_native_$stamp", "enabled" to false, "transport" to "stdio", "command" to "node", "args" to listOf("--version"))
                try {
                    val saved = perform("MCP create") { saveMcp(spec) }
                    assertEquals(id, saved.data.objects("servers").first { it.string("id") == id }.string("id"))
                    val edited = JsonObject(spec + obj("serverName" to "qa_edited_$stamp", "toolCallTimeoutMs" to 12345))
                    val updated = perform("MCP edit") { saveMcp(edited) }
                    assertEquals("qa_edited_$stamp", updated.data.objects("servers").first { it.string("id") == id }["spec"].objectValue().string("serverName"))
                    val disabled = perform("MCP disable") { mcpAction("setEnabled", id, false) }
                    assertFalse(disabled.data.objects("servers").first { it.string("id") == id }["enabled"].flag())
                    val deleted = perform("MCP delete") { mcpAction("delete", id) }
                    assertFalse(deleted.data.objects("servers").any { it.string("id") == id })
                } finally {
                    val present = rpc("mcpServers.list").objectValue().objects("servers").any { it.string("id") == id }
                    if (present) rpc("mcpServers.delete", "request" to obj("id" to id))
                }
            }
            probe("skills-create-read-update-invocation-delete") {
                perform("skills list") { open("skills") }
                val name = "qa-native-$stamp"
                val skill = obj("name" to name, "description" to "Dedicated native management fixture", "content" to "QA original body", "root" to "project-dsh", "groups" to listOf("native-qa"), "modelInvocable" to false, "userInvocable" to true)
                try {
                    val created = perform("skill create") { saveSkill(skill, true) }
                    assertTrue(created.data.objects("skills").any { it.string("name") == name })
                    val loaded = perform("skill get") { loadSkill(name) }
                    assertTrue(loaded.detail.string("content").contains("QA original body"))
                    perform("skill update") { saveSkill(JsonObject(skill + obj("content" to "QA edited body", "groups" to listOf("native-qa", "edited"))), false) }
                    val edited = perform("skill edited get") { loadSkill(name) }.detail
                    assertTrue(edited.string("content").contains("QA edited body"))
                    val flags = perform("skill invocation") { skillInvocation(edited, false, false) }
                    assertFalse(flags.data.objects("skills").first { it.string("name") == name }["userInvocable"].flag())
                    val deleted = perform("skill delete") { deleteSkill(name) }
                    assertFalse(deleted.data.objects("skills").any { it.string("name") == name })
                } finally {
                    val request = obj("cwd" to fixture.path, "sessionId" to session)
                    val present = rpc("skillInventory.list", "request" to request).objectValue().objects("skills").any { it.string("name") == name }
                    if (present) rpc("skillInventory.delete", "request" to JsonObject(request + obj("name" to name)))
                }
            }
            probe("settings-write-readback-and-stale-revision") {
                val settings = perform("settings describe") { open("settings") }
                assertTrue(settings.data["writable"].flag())
                val candidates = settings.data.objects("namespaces").flatMap { descriptor -> nativeSettingFields(descriptor).filter { !it.secret && it.value is JsonPrimitive && it.schema.string("type") in setOf("string", "number", "integer", "boolean") }.map { descriptor to it } }
                val chosen = candidates.firstOrNull { it.first.string("ns").startsWith("ui-") && it.second.schema.string("type") == "boolean" } ?: candidates.firstOrNull { it.second.schema.string("type") == "boolean" } ?: candidates.firstOrNull() ?: error("No writable primitive setting is configured")
                val descriptor = chosen.first
                val field = chosen.second
                val original = field.value!!
                val changed = when {
                    original is JsonPrimitive && !original.isString && original.booleanOrNull != null -> JsonPrimitive(!original.boolean)
                    else -> original
                }
                try {
                    val write = perform("settings write") { saveSetting(descriptor, field, changed) }
                    val changedDescriptor = write.detail
                    assertEquals(changed, atPath(changedDescriptor["value"], field.path))
                    val stale = perform("settings stale revision", true) { saveSetting(descriptor, field, original) }
                    assertTrue("Expected a revision conflict, got: ${stale.error}", stale.error.contains("revision", true) || stale.error.contains("conflict", true))
                } finally {
                    val fresh = rpc("settings.describe").objectValue().objects("namespaces").first { it.string("ns") == descriptor.string("ns") }
                    val userValue = atPath(descriptor["user"], field.path)
                    val operation = if (userValue == null) obj("op" to "unset", "path" to field.path) else obj("op" to "set", "path" to field.path, "value" to userValue)
                    rpc("settings.mutate", "ns" to descriptor.string("ns"), "ops" to listOf(operation), "expectedRevision" to fresh["revision"])
                }
            }
            probe("synthetic-credential-write-describe-unset") {
                val reference = "QA_ONLY_NATIVE_${stamp.uppercase()}"
                val value = "qa-synthetic-$stamp"
                try {
                    val write = perform("credential set") { credential(reference, value) }
                    val info = write.detail["credential"].objectValue()[reference].objectValue()
                    assertTrue(info["configured"].flag())
                    assertFalse(write.detail.toString().contains(value))
                    val removed = perform("credential unset") { credential(reference, null, true) }
                    assertFalse(removed.detail["credential"].objectValue()[reference].objectValue()["configured"].flag())
                } finally { rpc("credentials.unset", "ref" to reference) }
            }
            probe("plugin-inventory-and-owned-bundle-lifecycle") {
                val inventory = perform("plugins") { open("plugins") }
                assertTrue(inventory.loaded)
                if (!inventory.data["inventory"].objectValue()["managementAvailable"].flag()) {
                    results += obj("case" to "plugin-bundle-write", "status" to "unavailable", "reason" to "Dedicated Host has no pluginManager; real read-only inventory passed")
                } else {
                    val bundleName = "dsh-native-qa-$stamp"
                    val bundle = File(fixture, "bundle")
                    bundle.mkdirs()
                    File(bundle, "package.json").writeText(obj("name" to bundleName, "version" to "1.0.0", "type" to "module", "dsh" to obj("bundle" to obj("patch" to "./cordis.patch.yml"))).toString())
                    File(bundle, "cordis.patch.yml").writeText("- insert:\n    - id: native-qa-$stamp\n      name: ./plugin.mjs\n")
                    File(bundle, "plugin.mjs").writeText("export function apply(ctx) { ctx.provide('nativeQa${stamp}', true) }\n")
                    var installed = false
                    try {
                        val inspected = perform("plugin inspect") { inspectPlugin(bundle.path) }
                        assertEquals("accepted", inspected.detail["inspection"].objectValue().string("status"))
                        val installedState = perform("plugin install") { installPlugin(bundle.path) }
                        installed = installedState.data["bundles"].arrayValue().any { it.objectValue().string("name") == bundleName && it.objectValue()["installed"].flag() }
                        assertTrue("Owned bundle was not installed: ${installedState.notice}", installed)
                        val disabled = perform("plugin bundle disable") { bundleEnabled(bundleName, false) }
                        assertFalse(disabled.data["bundles"].arrayValue().first { it.objectValue().string("name") == bundleName }.objectValue()["enabled"].flag())
                        val enabled = perform("plugin bundle enable") { bundleEnabled(bundleName, true) }
                        assertTrue(enabled.data["bundles"].arrayValue().first { it.objectValue().string("name") == bundleName }.objectValue()["enabled"].flag())
                        val removed = perform("plugin remove") { removeBundle(bundleName) }
                        assertFalse(removed.data["bundles"].arrayValue().any { it.objectValue().string("name") == bundleName && it.objectValue()["installed"].flag() })
                        installed = false
                    } finally { if (installed) rpc("pluginManager.removeBundle", "name" to bundleName) }
                }
            }
            probe("account-read-only-state") {
                val state = perform("account state") { open("account") }
                assertTrue(state.data["view"].objectValue().string("status").isNotBlank())
                assertEquals("", controller!!.pendingLoginAttempt())
            }
        } finally {
            File(inputFile.parentFile, if (selectedCases.isEmpty()) "native-management-report.json" else "native-management-selected-report.json").writeText(obj("transport" to "Kotlin NativeDesktopController -> RelayClient -> public TLS E2EE -> dedicated official Electron Host", "cases" to results, "failures" to failures.size).toString())
            withContext(dispatcher) { controller?.reset() }
            if (session.isNotBlank()) try { rpc("workspace.archiveSession", "request" to obj("sessionId" to session)); rpc("session.delete", "request" to obj("sessionId" to session)) } catch (failure: Exception) { System.err.println("Dedicated QA session cleanup failed: ${failure.javaClass.simpleName}") }
            if (workspace.isNotBlank()) try { rpc("workspace.delete", "request" to obj("workspaceId" to workspace)) } catch (failure: Exception) { System.err.println("Dedicated QA workspace cleanup failed: ${failure.javaClass.simpleName}") }
            scope.cancel(); relay.close(); dispatcher.close()
        }
        assertTrue("Real Host failures:\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    private fun atPath(value: JsonElement?, path: List<String>): JsonElement? = path.fold(value) { node, key -> when (node) {
        is JsonObject -> node[key]
        is JsonArray -> key.toIntOrNull()?.let { node.getOrNull(it) }
        else -> null
    } }
}
