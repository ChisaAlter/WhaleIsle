package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.*
import kotlinx.serialization.json.*

internal fun historyEvent(entry: JsonObject): JsonObject = (entry["event"] as? JsonObject) ?: entry
internal fun historySeq(entry: JsonObject): Long? = historyEvent(entry)["seq"].number() ?: entry["seqStart"].number()
internal fun mergeHistory(older: List<JsonObject>, current: List<JsonObject>): List<JsonObject> {
    val known = current.mapNotNull(::historySeq).toSet()
    return older.filter { historySeq(it) == null || historySeq(it) !in known } + current
}
private fun blocksText(blocks: List<JsonObject>): String = blocks.joinToString("") { it.string("text") }
private fun images(blocks: List<JsonObject>): List<NativeImage> = blocks.filter { it.string("type") == "image" }
    .map { NativeImage(it.string("mediaType"), it.string("data")) }

/** Fold the host's raw events and projected items without discarding loaded pages. */
internal fun foldNativeHistory(entries: List<JsonObject>): List<NativeRow> {
    val rows = mutableListOf<NativeRow>()
    val tools = mutableMapOf<String, Int>()
    val partial = sortedMapOf<Int, Pair<String, String>>()
    var partialSeq = 0L
    var running = false
    fun flush() {
        partial.forEach { (index, block) -> if (block.second.isNotEmpty()) rows += NativeRow("stream-$partialSeq-$index", block.first, block.second, false) }
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
                "tool_call" -> rows += NativeRow(itemId, "tool", item.string("name") + " · " + when(item.string("status")) {
                    "running" -> "运行中"; "completed" -> "完成"; "failed" -> "失败"; "canceled" -> "已取消"; else -> item.string("status")
                }, item.string("status") == "running", detail = item["detail"]?.toString().orEmpty())
                "reasoning" -> rows += NativeRow(itemId, "reasoning", item.string("text"), false)
                "error" -> rows += NativeRow(itemId, "error", item.string("message"), false)
                "todo" -> rows += NativeRow(itemId, "meta", item.objects("items").joinToString("\n") {
                    (if(it["completed"].flag()) "✓ " else "○ ") + it.string("text") }, false)
                "turn_changes" -> rows += NativeRow(itemId,"meta",item.string("changeSummary") + "\n" + item.objects("changedFiles").joinToString("\n") {
                    "${it.string("path")} +${it["additions"].number() ?: 0} -${it["deletions"].number() ?: 0}" },false)
                "compaction" -> rows += NativeRow(itemId,"meta",when(item.string("status")) {
                    "completed" -> "上下文已压缩"; "failed" -> "上下文压缩失败：${item.string("error")}"; else -> "正在压缩上下文…" },false)
                "generative_ui" -> rows += NativeRow(itemId,"meta","交互组件「${item.string("title") }」需要在电脑端查看",false)
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
                val index = delta["index"].number()?.toInt() ?: 0
                val role = if(type == "reasoning-delta" || type == "reasoning" || delta.string("blockType") == "reasoning") "reasoning" else "assistant"
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
                tools[callId] = rows.size
                rows += NativeRow(callId, "tool", data.string("name"), true, detail = data["arguments"]?.toString().orEmpty())
            }
            "tool/result" -> {
                flush()
                val message = data["message"].objectValue()
                val callId = message["source"].objectValue().string("callId").ifBlank { data.string("callId") }
                val result = blocksText(message.objects("content").flatMap { it.objects("content") })
                val index = tools[callId]
                if(index != null) rows[index] = rows[index].copy(running = false,detail = rows[index].detail + "\n" + result)
                else if(callId.isNotBlank()) rows += NativeRow(callId,"tool",message["source"].objectValue().string("name"),false,detail=result)
            }
            "turn/end", "turn/completed" -> {
                flush(); running = false
                for (index in tools.values) rows[index] = rows[index].copy(running = false)
                val reason = data["reason"].objectValue()
                if (reason.string("kind") in setOf("error", "aborted")) rows += NativeRow(id, "error",
                    reason["error"].objectValue().string("message").ifBlank { reason.string("message").ifBlank { "本轮运行失败" } }, false)
                else if(reason.string("kind") == "max-tokens") rows += NativeRow(id,"meta","输出达到长度上限",false)
            }
            "turn/interrupt" -> { flush(); rows += NativeRow(id, "meta", "已停止", false) }
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
