package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.arrayValue
import ai.deepseek.harness.mobile.remote.number
import ai.deepseek.harness.mobile.remote.objectValue
import ai.deepseek.harness.mobile.remote.string
import kotlinx.serialization.json.JsonObject

internal data class NativeQueuedMessage(
    val id: String,
    val text: String,
    val target: String,
    val editable: Boolean,
    val hasAttachments: Boolean,
)

internal data class NativeSessionUsage(
    val input: Long,
    val output: Long,
    val cacheRead: Long,
    val cacheWrite: Long,
)

/** Only identified user input is offered for queue mutation; non-text blocks stay intact. */
internal fun nativeQueuedMessages(values: JsonObject): List<NativeQueuedMessage> {
    val inbox = values["inbox"].objectValue()
    return listOf("next-turn", "next-step").flatMap { target ->
        inbox[target].arrayValue().mapNotNull { value ->
            val message = value as? JsonObject ?: return@mapNotNull null
            val id = message.string("id")
            if (id.isBlank() || message["source"].objectValue().string("kind") != "user") return@mapNotNull null
            val content = message["content"].arrayValue()
            val hasAttachments = content.any { it.objectValue().string("type") != "text" }
            NativeQueuedMessage(
                id = id,
                text = content.mapNotNull { block ->
                    val item = block.objectValue()
                    if (item.string("type") == "text") item.string("text") else null
                }.joinToString("\n"),
                target = target,
                editable = content.isNotEmpty() && !hasAttachments,
                hasAttachments = hasAttachments,
            )
        }
    }
}

/** An unpublished or incomplete usage projection remains absent, including its totals. */
internal fun nativeSessionUsage(values: JsonObject): NativeSessionUsage? {
    val totals = values["usagePanel"].objectValue()["totals"] as? JsonObject ?: return null
    fun count(name: String): Long? = totals[name].number()?.takeIf { it >= 0L }
    return NativeSessionUsage(
        input = count("input") ?: return null,
        output = count("output") ?: return null,
        cacheRead = count("cacheRead") ?: return null,
        cacheWrite = count("cacheWrite") ?: return null,
    )
}
