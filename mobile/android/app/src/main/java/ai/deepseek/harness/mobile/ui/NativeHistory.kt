package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*

internal fun historyEvent(entry: JsonObject): JsonObject = (entry["event"] as? JsonObject) ?: entry
internal fun historySeq(entry: JsonObject): Long? = historyEvent(entry)["seq"].number() ?: entry["seqStart"].number()
internal fun mergeHistory(older: List<JsonObject>, current: List<JsonObject>): List<JsonObject> {
    val known = current.mapNotNull(::historySeq).toSet()
    return older.filter { historySeq(it) == null || historySeq(it) !in known } + current
}
private fun blocksText(blocks: List<JsonObject>): String = blocks.joinToString("") { it.string("text") }
private fun images(blocks: List<JsonObject>): List<NativeImage> = blocks.filter { it.string("type") == "image" }
    .map { block ->
        val attachment = block["attachment"].objectValue()
        NativeImage(attachment.string("mediaType").ifBlank { block.string("mediaType") }, block.string("data"), attachment.string("attachmentId"))
    }

internal suspend fun resolveHistoryImages(
    rows: List<NativeRow>,
    onResolved: (NativeImage) -> Unit = {},
    read: suspend (String) -> JsonObject,
): List<NativeRow> {
    val resolved = mutableMapOf<String, NativeImage>()
    return rows.map { row -> row.copy(images = row.images.map { image ->
        currentCoroutineContext().ensureActive()
        if (image.data.isNotEmpty() || image.error.isNotEmpty() || image.attachmentId.isBlank()) image else resolved.getOrPut(image.attachmentId) {
            val result = try {
                val value = read(image.attachmentId)
                val attachment = value["attachment"].objectValue()
                require(attachment.string("attachmentId") == image.attachmentId && value.string("data").isNotBlank()) { "图片附件响应无效" }
                image.copy(mediaType = attachment.string("mediaType").ifBlank { image.mediaType }, data = value.string("data"))
            } catch (failure: Exception) {
                currentCoroutineContext().ensureActive()
                if (failure is CancellationException && failure !is TimeoutCancellationException) throw failure
                image.copy(error = failure.message ?: "无法读取历史图片")
            }
            onResolved(result)
            result
        }
    }) }
}

private fun parseJsonObjectOrNull(element: JsonElement?): JsonObject? = when (element) {
    is JsonObject -> element
    is JsonPrimitive -> if (element.isString) {
        try {
            Json.parseToJsonElement(element.content) as? JsonObject
        } catch (_: Exception) {
            null
        }
    } else null
    else -> null
}

private fun extractWhaleUiFromCall(callId: String, name: String, arguments: JsonElement?, streaming: Boolean): NativeWhaleUiPayload? {
    if (name != "render_ui") return null
    val argsObj = parseJsonObjectOrNull(arguments) ?: return null
    val program = argsObj.string("program").ifBlank { argsObj.string("spec") }.trim()
    if (program.isBlank()) return null
    val title = argsObj.string("title").ifBlank { extractWhaleUiTitle(program).orEmpty() }
    val language = argsObj.string("language").ifBlank { "whale-ui" }
    return NativeWhaleUiPayload(
        instanceKey = "tool:$callId",
        language = language,
        program = program,
        title = title,
        streaming = streaming,
    )
}

private fun extractWhaleUiFromMeta(callId: String, metaOwner: JsonObject, fallback: NativeWhaleUiPayload? = null): NativeWhaleUiPayload? {
    val meta = parseJsonObjectOrNull(metaOwner["meta"])
        ?: parseJsonObjectOrNull(metaOwner["result"].objectValue()["meta"])
        ?: metaOwner
    val whaleUiObj = parseJsonObjectOrNull(meta["whaleUi"]) ?: parseJsonObjectOrNull(metaOwner["whaleUi"])
    if (whaleUiObj != null) {
        val program = whaleUiObj.string("program")
            .ifBlank { whaleUiObj.string("code") }
            .ifBlank { whaleUiObj.string("spec") }
            .trim()
            .ifBlank { fallback?.program.orEmpty() }
        if (program.isNotBlank()) {
            val title = whaleUiObj.string("title")
                .ifBlank { fallback?.title.orEmpty() }
                .ifBlank { extractWhaleUiTitle(program).orEmpty() }
            val language = whaleUiObj.string("language").ifBlank { fallback?.language ?: "whale-ui" }
            return NativeWhaleUiPayload(
                instanceKey = "tool:$callId",
                language = language,
                program = program,
                title = title,
                streaming = false,
            )
        }
    }
    return fallback?.copy(streaming = false)
}

internal fun buildNativeChatRows(entries: List<JsonObject>): List<NativeRow> = foldNativeHistory(entries)

/** Fold the host's raw events and projected items without discarding loaded pages. */
internal fun foldNativeHistory(entries: List<JsonObject>): List<NativeRow> {
    val rows = mutableListOf<NativeRow>()
    val tools = mutableMapOf<String, Int>()
    val partial = sortedMapOf<Int, Pair<String, String>>()
    var partialSeq = 0L
    var running = false
    fun flush() {
        partial.forEach { (index, block) ->
            if (block.second.isNotEmpty()) {
                rows += NativeRow("stream-$partialSeq-$index", block.first, block.second, running && block.first == "assistant")
            }
        }
        partial.clear()
    }
    for (entry in entries) {
        val event = historyEvent(entry)
        val data = event["data"].objectValue()
        val seq = historySeq(entry) ?: rows.size.toLong()
        val id = data.string("id").ifBlank { "event-$seq" }
        val item = entry["item"] as? JsonObject
        if (item != null) {
            flush()
            val type = item.string("type")
            val itemId = item.string("messageId").ifBlank { item.string("callId").ifBlank { "item-$seq" } }
            val content = item.objects("content")
            when (type) {
                "user_message", "assistant_message" -> rows += NativeRow(itemId, if (type == "user_message") "user" else "assistant",
                    item.string("text").ifBlank { blocksText(content) }, false, images(content))
                "tool_call" -> {
                    val isRunning = item.string("status") == "running"
                    val callWhaleUi = extractWhaleUiFromCall(itemId, item.string("name"), item["arguments"] ?: item["input"], isRunning)
                    val whaleUi = if (isRunning) callWhaleUi else extractWhaleUiFromMeta(itemId, item, callWhaleUi)
                    rows += NativeRow(itemId, "tool", item.string("name") + " · " + when(item.string("status")) {
                        "running" -> "运行中"; "completed" -> "完成"; "failed" -> "失败"; "canceled" -> "已取消"; else -> item.string("status")
                    }, isRunning, detail = item["detail"]?.toString().orEmpty(), whaleUi = whaleUi)
                }
                "reasoning" -> rows += NativeRow(itemId, "reasoning", item.string("text"), false)
                "error" -> rows += NativeRow(itemId, "error", item.string("message"), false)
                "todo" -> rows += NativeRow(itemId, "meta", item.objects("items").joinToString("\n") {
                    (if(it["completed"].flag()) "✓ " else "○ ") + it.string("text") }, false)
                "turn_changes" -> rows += NativeRow(itemId,"meta",item.string("changeSummary") + "\n" + item.objects("changedFiles").joinToString("\n") {
                    "${it.string("path")} +${it["additions"].number() ?: 0} -${it["deletions"].number() ?: 0}" },false)
                "compaction" -> rows += NativeRow(itemId,"meta",when(item.string("status")) {
                    "completed" -> "上下文已压缩"; "failed" -> "上下文压缩失败：${item.string("error")}"; else -> "正在压缩上下文…" },false)
                "generative_ui" -> {
                    val program = item.string("program").ifBlank { item.string("code") }.ifBlank { item.string("spec") }.trim()
                    val whaleUi = if (program.isNotBlank()) {
                        NativeWhaleUiPayload(
                            instanceKey = "gen:$itemId",
                            language = item.string("language").ifBlank { "whale-ui" },
                            program = program,
                            title = item.string("title").ifBlank { extractWhaleUiTitle(program).orEmpty() },
                            streaming = item.string("status") == "running",
                        )
                    } else extractWhaleUiFromMeta(itemId, item)
                    rows += NativeRow(itemId, "meta", "交互组件「${item.string("title")}」需要在电脑端查看", false, whaleUi = whaleUi)
                }
                else -> rows += NativeRow(itemId, "meta", "暂不支持的消息类型：$type", false)
            }
            continue
        }
        when (event.string("type")) {
            "turn/start", "turn/started" -> { flush(); running = true }
            "step/start", "step/end" -> flush()
            "user/message" -> if (data["source"].objectValue().string("kind") == "user") {
                flush()
                val content = data.objects("content")
                rows += NativeRow(id, "user", blocksText(content), false, images(content))
            }
            "assistant/chunk" -> {
                if (partial.isEmpty()) partialSeq = seq
                val chunk = data["chunk"]
                val delta = chunk.objectValue()
                val type = delta.string("type")
                val role = if(type == "reasoning-delta" || type == "reasoning" || delta.string("blockType") == "reasoning") "reasoning" else "assistant"
                val index = delta["index"].number()?.toInt() ?: if (role == "reasoning") -1 else 0
                if(type == "block-start") partial.putIfAbsent(index,role to "")
                else if(type in setOf("", "text", "text-delta", "reasoning", "reasoning-delta")) {
                    val text = if(chunk is JsonPrimitive) chunk.text() else delta.string("text").ifBlank { data.string("text") }
                    val previous = partial[index]?.second.orEmpty()
                    partial[index] = role to previous + text
                }
            }
            "assistant/message" -> {
                // The completed message replaces the current step's deltas.
                partial.clear()
                val blocks = data["message"].objectValue().objects("content")
                blocks.filter { it.string("type") == "reasoning" }.forEachIndexed { index,it -> rows += NativeRow("$id-reasoning-$index", "reasoning", it.string("text"), false) }
                val text = blocksText(blocks.filter { it.string("type") != "reasoning" })
                if(text.isNotEmpty() || images(blocks).isNotEmpty()) rows += NativeRow(id, "assistant", text, false, images(blocks))
            }
            "tool/call" -> {
                flush()
                val callId = data.string("callId").ifBlank { id }
                val name = data.string("name")
                val rawArgs = data["arguments"] ?: data["input"]
                val whaleUi = extractWhaleUiFromCall(callId, name, rawArgs, streaming = true)
                tools[callId] = rows.size
                rows += NativeRow(callId, "tool", name, true, detail = rawArgs?.toString().orEmpty(), whaleUi = whaleUi)
            }
            "tool/result" -> {
                flush()
                val message = data["message"].objectValue()
                val callId = message["source"].objectValue().string("callId").ifBlank { data.string("callId") }
                val rawBlocks = message.objects("content")
                val content = rawBlocks.flatMap { if (it.string("type") == "tool-result") it.objects("content") else listOf(it) }
                val result = blocksText(content).ifBlank { data.string("output") }
                val index = tools[callId]
                val blockMetaOwner = rawBlocks.firstOrNull { it.containsKey("meta") || it.containsKey("whaleUi") }
                if(index != null) {
                    val prev = rows[index]
                    val resolvedWhaleUi = extractWhaleUiFromMeta(callId, data, null)
                        ?: extractWhaleUiFromMeta(callId, message, null)
                        ?: blockMetaOwner?.let { extractWhaleUiFromMeta(callId, it, null) }
                        ?: prev.whaleUi?.copy(streaming = false)
                    val combinedDetail = if (prev.detail.isBlank()) result else if (result.isBlank()) prev.detail else prev.detail + "\n" + result
                    rows[index] = prev.copy(running = false, detail = combinedDetail, images = images(content), whaleUi = resolvedWhaleUi)
                } else if(callId.isNotBlank()) {
                    val resolvedWhaleUi = extractWhaleUiFromMeta(callId, data, null)
                        ?: extractWhaleUiFromMeta(callId, message, null)
                        ?: blockMetaOwner?.let { extractWhaleUiFromMeta(callId, it, null) }
                    val toolName = message["source"].objectValue().string("name").ifBlank { data.string("name") }
                    rows += NativeRow(callId, "tool", toolName, false, images = images(content), detail = result, whaleUi = resolvedWhaleUi)
                }
            }
            "turn/end", "turn/completed" -> {
                flush(); running = false
                for (index in rows.indices) {
                    val prev = rows[index]
                    if (prev.running || prev.whaleUi?.streaming == true) {
                        rows[index] = prev.copy(running = false, whaleUi = prev.whaleUi?.copy(streaming = false))
                    }
                }
                val reason = data["reason"].objectValue()
                if (reason.string("kind") == "aborted" && reason["reason"].objectValue().string("kind") == "user") rows += NativeRow(id, "meta", "已停止", false)
                else if (reason.string("kind") in setOf("error", "aborted")) rows += NativeRow(id, "error",
                    reason["error"].objectValue().string("message").ifBlank { reason.string("message").ifBlank { "本轮运行失败" } }, false)
                else if(reason.string("kind") == "max-tokens") rows += NativeRow(id,"meta","输出达到长度上限",false)
            }
            "turn/interrupt" -> {
                flush(); running = false
                for (index in rows.indices) {
                    val prev = rows[index]
                    if (prev.running || prev.whaleUi?.streaming == true) {
                        rows[index] = prev.copy(running = false, whaleUi = prev.whaleUi?.copy(streaming = false))
                    }
                }
                rows += NativeRow(id, "meta", "已停止", false)
            }
            "compaction/start" -> { flush(); rows += NativeRow(id,"meta","正在压缩上下文…",false) }
            "compaction/end" -> { flush(); rows += NativeRow(id,"meta","上下文已压缩",false) }
        }
    }
    flush()
    if(running && rows.lastOrNull()?.role in setOf("assistant","reasoning")) rows[rows.lastIndex] = rows.last().copy(running = true)
    return rows.distinctBy { it.id }
}

internal fun historyApprovals(entries: List<JsonObject>): List<NativeApproval> {
    val pending = linkedMapOf<String, NativeApproval>()
    for (entry in entries) {
        val event = historyEvent(entry)
        val data = event["data"].objectValue()
        val id = data.string("id")
        if (id.isBlank()) continue
        when (event.string("type")) {
            "approval/asked" -> pending[id] = NativeApproval(id, data.string("toolName"), data.string("reason"), "",
                listOf(NativeApprovalAction("rejected", "拒绝"), NativeApprovalAction("allowed-once", "允许一次")))
            "approval/decided" -> pending.remove(id)
        }
    }
    return pending.values.toList()
}
