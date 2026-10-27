package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.*
import kotlinx.serialization.json.*

/** A remote task belongs to one computer/session and is published only after its RPC settles. */
internal data class NativeDesktopState(
    val section: String = "",
    val busy: Boolean = false,
    val loaded: Boolean = false,
    val error: String = "",
    val notice: String = "",
    val data: JsonObject = obj(),
    val detail: JsonObject = obj(),
    val path: String = "",
    val offset: Int = 1,
    val baseRef: String = "",
)

internal data class NativeSessionTreeRow(val session: NativeSession, val depth: Int, val hasChildren: Boolean)

/** Forks remain ordinary rows; only subagent origin participates in the child tree. */
internal fun nativeSessionTree(sessions: List<NativeSession>, collapsed: Set<String> = emptySet()): List<NativeSessionTreeRow> {
    val ids = sessions.map { it.id }.toSet()
    val children = sessions.filter { it.origin == "subagent" && it.parentSessionId in ids && it.parentSessionId != it.id }
        .groupBy { it.parentSessionId }
    val result = mutableListOf<NativeSessionTreeRow>()
    val visited = mutableSetOf<String>()
    fun visit(row: NativeSession, depth: Int) {
        if (!visited.add(row.id)) return
        val nested = children[row.id].orEmpty()
        result += NativeSessionTreeRow(row, depth, nested.isNotEmpty())
        if (row.id !in collapsed) nested.forEach { visit(it, depth + 1) }
        else {
            fun hide(child: NativeSession) { if (visited.add(child.id)) children[child.id].orEmpty().forEach(::hide) }
            nested.forEach(::hide)
        }
    }
    sessions.filter { it.origin != "subagent" || it.parentSessionId !in ids || it.parentSessionId == it.id }.forEach { visit(it, 0) }
    // A malformed cycle must not erase its members or recurse forever.
    sessions.filter { it.id !in visited && it.parentSessionId !in collapsed }.forEach { visit(it, 0) }
    return result
}

internal data class NativeGitQuick(val label: String, val steps: List<String> = emptyList(), val target: String = "", val hint: String = "")

/** Same decision table as desktop/mobile git quick actions. */
internal fun nativeGitQuick(status: JsonObject): NativeGitQuick {
    if (!status["isRepo"].flag()) return NativeGitQuick("Initialize Git", listOf("git-init"))
    if (status.string("refName").isBlank()) return NativeGitQuick("Commit", hint = "请先创建并检出分支。")
    val changes = status["hasWorkingTreeChanges"].flag()
    val remote = status["hasPrimaryRemote"].flag()
    val upstream = status["hasUpstream"].flag()
    val openPr = status["pr"].objectValue().string("state") == "open"
    val default = status["isDefaultRef"].flag()
    val ahead = (status["aheadCount"].number() ?: 0) > 0
    val behind = (status["behindCount"].number() ?: 0) > 0
    if (changes) {
        if (!upstream && !remote) return NativeGitQuick("Commit", listOf("git-commit"))
        if (openPr || default) return NativeGitQuick("Commit & push", listOf("git-commit", "git-push"))
        return NativeGitQuick("Commit, push & PR", listOf("git-commit", "git-push", "git-create-change-request"))
    }
    if (!upstream) return if (!remote) NativeGitQuick("Publish repository", target = "publish") else NativeGitQuick("Push", listOf("git-push"))
    if (ahead && behind) return NativeGitQuick("Sync branch", hint = "分支已分叉，请先合并或变基。")
    if (behind) return NativeGitQuick("Pull", listOf("git-pull"))
    if (ahead) return if (openPr || default) NativeGitQuick("Push", listOf("git-push")) else NativeGitQuick("Push & create PR", listOf("git-push", "git-create-change-request"))
    if (openPr) return NativeGitQuick("View PR", target = "pr")
    return NativeGitQuick("Commit", hint = "分支已是最新，无需操作。")
}

internal fun nativeRelativeChild(parent: String, name: String): String {
    require(name.isNotBlank() && name != "." && name != ".." && '/' !in name && '\\' !in name) { "电脑返回了无效的文件名称" }
    return if (parent.isBlank()) name else "$parent/$name"
}
internal fun nativeParentPath(path: String) = path.substringBeforeLast('/', "")
internal fun nativeFileSize(bytes: Long?): String = when {
    bytes == null -> "大小未知"
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> "${bytes / (1024 * 1024)} MB"
}

internal data class NativeSettingField(
    val path: List<String>,
    val label: String,
    val description: String,
    val schema: JsonObject,
    val value: JsonElement?,
    val secret: Boolean,
)

/** Resolve Schemastery's reference envelope without evaluating its callbacks. */
internal fun nativeSettingSchema(envelope: JsonObject): JsonObject {
    val refs = envelope["refs"].objectValue()
    if (refs.isEmpty()) return envelope
    fun resolve(value: JsonElement?, stack: Set<String>): JsonObject {
        val key = value.text()
        if (value !is JsonObject && key in stack) return obj("type" to "any")
        val node = if (value is JsonObject) value else refs[key].objectValue()
        val next = if (value is JsonObject) stack else stack + key
        val fields = node.toMutableMap()
        if (node["dict"] != null) fields["dict"] = JsonObject(node["dict"].objectValue().mapValues { resolve(it.value, next) })
        if (node["inner"] != null) fields["inner"] = resolve(node["inner"], next)
        if (node["list"] != null) fields["list"] = JsonArray(node["list"].arrayValue().map { resolve(it, next) })
        return JsonObject(fields)
    }
    return resolve(envelope["uid"], emptySet())
}

internal fun nativeSettingTitle(schema: JsonObject): String = schema["meta"].objectValue().string("description").substringBefore('\n')

/** Object, dictionary and array members retain their real paths and secret sidecars. */
internal fun nativeSettingFields(descriptor: JsonObject): List<NativeSettingField> {
    val result = linkedMapOf<List<String>, NativeSettingField>()
    val secrets = descriptor.objects("secrets").map { it["path"].arrayValue().map { p -> p.text() } }
    fun visit(schema: JsonObject, value: JsonElement?, path: List<String>) {
        val meta = schema["meta"].objectValue()
        if (meta["hidden"].flag()) return
        when (schema.string("type")) {
            "object" -> schema["dict"].objectValue().forEach { (key, child) -> visit(child.objectValue(), value.objectValue()[key], path + key) }
            "dict" -> {
                value.objectValue().forEach { (key, child) -> visit(schema["inner"].objectValue(), child, path + key) }
                if (path.isNotEmpty() && secrets.none { it.take(path.size) == path }) result[path] = NativeSettingField(path, path.joinToString(" › "), meta.string("description"), schema, value ?: obj(), false)
            }
            "array" -> {
                value.arrayValue().forEachIndexed { index, child -> visit(schema["inner"].objectValue(), child, path + index.toString()) }
                if (path.isNotEmpty() && secrets.none { it.take(path.size) == path }) result[path] = NativeSettingField(path, path.joinToString(" › "), meta.string("description"), schema, value ?: JsonArray(emptyList()), false)
            }
            "intersect" -> schema["list"].arrayValue().forEach { visit(it.objectValue(), value, path) }
            "transform" -> visit(schema["inner"].objectValue(), value, path)
            else -> if (path.isNotEmpty()) {
                val choice = schema.string("type") == "union" && schema["list"].arrayValue().all { it.objectValue().string("type") == "const" }
                if (schema.string("type") == "union" && !choice && value is JsonObject) {
                    schema["list"].arrayValue().filter { it.objectValue().string("type") == "object" }.forEach { visit(it.objectValue(), value, path) }
                } else if (schema.string("type") != "const") result[path] = NativeSettingField(path, path.joinToString(" › "), meta.string("description"), schema,
                    value, secrets.any { it == path } || meta.string("role") == "secret")
            }
        }
    }
    visit(nativeSettingSchema(descriptor["schema"].objectValue()), descriptor["value"], emptyList())
    return result.values.toList()
}

internal fun nativeSettingChoices(schema: JsonObject): List<JsonElement> = if (schema.string("type") == "union") schema["list"].arrayValue().filter { it.objectValue().string("type") == "const" }.mapNotNull { it.objectValue()["value"] } else emptyList()

internal fun nativeSettingValue(field: NativeSettingField, text: String): JsonElement {
    if (field.secret) return JsonPrimitive(text)
    val choices = nativeSettingChoices(field.schema)
    if (choices.isNotEmpty()) return choices.firstOrNull { it.text() == text } ?: error("请选择有效选项")
    return when (field.schema.string("type")) {
        "string" -> JsonPrimitive(text)
        "integer" -> JsonPrimitive(text.toLongOrNull() ?: error("请输入整数"))
        "number" -> JsonPrimitive(text.toDoubleOrNull()?.takeIf { it.isFinite() } ?: error("请输入有限数值"))
        "boolean" -> JsonPrimitive(text.toBooleanStrictOrNull() ?: error("请选择开启或关闭"))
        else -> Json.parseToJsonElement(text)
    }
}

internal fun nativePluginResult(result: JsonObject): String {
    val failure = result["error"].objectValue()
    val diagnostic = failure.string("diagnostic").ifBlank { failure.string("code") }
    return when (result.string("application")) {
        "applied" -> "修改已应用"
        "restart-required" -> "修改已保存，电脑端重启后生效：${result.string("restartReason")}"
        "overridden" -> "修改已保存，但被更高优先级配置覆盖"
        "cancelled" -> "已取消，配置已恢复"
        else -> diagnostic.ifBlank { result["packageResult"].objectValue().string("output").ifBlank { "未能确认插件操作结果，请刷新核对" } }
    }
}
