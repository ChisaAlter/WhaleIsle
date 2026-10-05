package ai.deepseek.harness.mobile.remote

import kotlinx.serialization.json.*

fun obj(vararg fields: Pair<String, Any?>): JsonObject = JsonObject(fields.associate { it.first to jsonValue(it.second) })
fun jsonValue(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Iterable<*> -> JsonArray(value.map(::jsonValue))
    else -> error("Unsupported JSON value")
}
fun JsonElement?.objectValue(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
fun JsonElement?.arrayValue(): List<JsonElement> = (this as? JsonArray)?.toList() ?: emptyList()
fun JsonElement?.text(): String = (this as? JsonPrimitive)?.contentOrNull.orEmpty()
fun JsonElement?.flag(): Boolean = (this as? JsonPrimitive)?.booleanOrNull == true
fun JsonElement?.number(): Long? = (this as? JsonPrimitive)?.longOrNull
fun JsonObject.string(key: String): String = this[key].text()
fun JsonObject.objects(key: String): List<JsonObject> = this[key].arrayValue().mapNotNull { it as? JsonObject }
