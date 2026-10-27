package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class NativeDesktopDataTest {
    private fun row(id: String, parent: String = "", origin: String = "") = NativeSession(id, id, "", false, origin == "subagent", parentSessionId = parent, origin = origin)

    @Test fun subagentTreeKeepsForksEditableAndCollapsesAllDescendants() {
        val rows = listOf(row("child", "parent", "subagent"), row("parent"), row("grandchild", "child", "subagent"), row("fork", "parent", "fork"))
        assertEquals(listOf("parent", "child", "grandchild", "fork"), nativeSessionTree(rows).map { it.session.id })
        assertEquals(listOf(0, 1, 2, 0), nativeSessionTree(rows).map { it.depth })
        assertEquals(listOf("parent", "fork"), nativeSessionTree(rows, setOf("parent")).map { it.session.id })
        assertFalse(nativeSessionTree(rows).last().session.readOnly)
    }
    @Test fun treePreservesOrphansAndCyclesOnceAndUsesParentWorkspace() {
        val rows = listOf(row("orphan", "missing", "subagent"), row("a", "b", "subagent"), row("b", "a", "subagent"))
        assertEquals(setOf("orphan", "a", "b"), nativeSessionTree(rows).map { it.session.id }.toSet())
        assertEquals(3, nativeSessionTree(rows).size)
        val grouped = nativeSessionGroups(listOf(NativeWorkspace("w", "Project", "/project")), listOf(row("parent").copy(workspaceId = "w", cwd = "/project"), row("child", "parent", "subagent")))
        assertEquals(listOf("parent", "child"), grouped.first().sessions.map { it.id })
        assertEquals(1, grouped.size)
    }
    @Test fun gitQuickChoosesEntireStackAndRejectsDivergedSync() {
        val base = obj("isRepo" to true, "refName" to "feature", "hasWorkingTreeChanges" to true, "hasPrimaryRemote" to true)
        assertEquals(listOf("git-commit", "git-push", "git-create-change-request"), nativeGitQuick(base).steps)
        assertEquals(listOf("git-commit", "git-push"), nativeGitQuick(JsonObject(base + ("isDefaultRef" to JsonPrimitive(true)))).steps)
        val diverged = obj("isRepo" to true, "refName" to "feature", "hasUpstream" to true, "aheadCount" to 2, "behindCount" to 3)
        assertTrue(nativeGitQuick(diverged).steps.isEmpty())
        assertTrue(nativeGitQuick(diverged).hint.contains("分叉"))
    }
    @Test fun settingFieldsResolveActualSchemasteryReferencesAndNeverExposeSecretValues() {
        val descriptor = obj("schema" to obj("uid" to 1, "refs" to obj(
            "1" to obj("type" to "object", "dict" to obj("enabled" to 2, "token" to 3, "route" to 4)),
            "2" to obj("type" to "boolean", "meta" to obj("description" to "Enabled")),
            "3" to obj("type" to "string", "meta" to obj("role" to "secret")),
            "4" to obj("type" to "union", "list" to listOf(5, 6)),
            "5" to obj("type" to "const", "value" to "first"), "6" to obj("type" to "const", "value" to "second"))),
            "value" to obj("enabled" to true, "route" to "first"), "secrets" to listOf(obj("path" to listOf("token"), "set" to true)))
        val fields = nativeSettingFields(descriptor)
        assertEquals(listOf("enabled", "token", "route"), fields.map { it.path.single() })
        assertTrue(fields[1].secret)
        assertNull(fields[1].value)
        assertEquals(listOf("first", "second"), nativeSettingChoices(fields[2].schema).map { it.text() })
        assertEquals(JsonPrimitive(false), nativeSettingValue(fields[0], "false"))
        assertEquals(JsonPrimitive("second"), nativeSettingValue(fields[2], "second"))
    }
    @Test fun secretDictionaryMembersCannotBeReplacedFromRedactedParent() {
        val provider = obj("type" to "object", "dict" to obj("key" to obj("type" to "string", "meta" to obj("role" to "secret")), "model" to obj("type" to "string")))
        val schema = obj("type" to "object", "dict" to obj("providers" to obj("type" to "dict", "inner" to provider)))
        val descriptor = obj("schema" to schema, "value" to obj("providers" to obj("test" to obj("model" to "m"))),
            "secrets" to listOf(obj("path" to listOf("providers", "test", "key"), "set" to true)))
        val fields = nativeSettingFields(descriptor)
        assertFalse(fields.any { it.path == listOf("providers") })
        assertTrue(fields.first { it.path.last() == "key" }.secret)
    }
    @Test fun fileChildRejectsTraversalAndRetainsSpaces() {
        assertEquals("folder/a b.kt", nativeRelativeChild("folder", "a b.kt"))
        for (name in listOf("..", ".", "a/b", "a\\b", "")) assertThrows(IllegalArgumentException::class.java) { nativeRelativeChild("", name) }
    }
    @Test fun toolResultImagesRemainInTimelineAndCanResolveAsAttachments() {
        val event = obj("event" to obj("seq" to 1, "type" to "tool/result", "data" to obj("message" to obj("source" to obj("callId" to "call", "name" to "mcp__image"), "content" to listOf(obj("type" to "image", "attachment" to obj("attachmentId" to "img", "mediaType" to "image/png")))))))
        assertEquals("img", foldNativeHistory(listOf(event)).single().images.single().attachmentId)
    }
}
