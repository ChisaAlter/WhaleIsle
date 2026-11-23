package ai.deepseek.harness.mobile.pair

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.net.URI
import java.util.Base64

@Serializable
data class RelayOffer(
    val endpoint: String,
    val useTls: Boolean,
)

@Serializable
data class LanOffer(
    val endpoints: List<String> = emptyList(),
    val useTls: Boolean = false,
)

object FlexibleIceUrlsSerializer : KSerializer<List<String>> {
    private val delegate = ListSerializer(String.serializer())
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun serialize(encoder: Encoder, value: List<String>) {
        delegate.serialize(encoder, value)
    }

    override fun deserialize(decoder: Decoder): List<String> {
        val jsonDecoder = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        val element = jsonDecoder.decodeJsonElement()
        return when (element) {
            is JsonPrimitive -> {
                if (!element.isString) throw IllegalArgumentException("ICE urls must be string or string array")
                listOf(element.content)
            }
            is JsonArray -> element.map { item ->
                val prim = item as? JsonPrimitive
                if (prim == null || !prim.isString) throw IllegalArgumentException("ICE url entry must be string")
                prim.content
            }
            else -> throw IllegalArgumentException("ICE urls must be string or string array")
        }
    }
}

@Serializable
data class IceServerConfig(
    @Serializable(with = FlexibleIceUrlsSerializer::class)
    val urls: List<String>,
    val username: String? = null,
    val credential: String? = null,
)

val DEFAULT_PUBLIC_STUN_SERVERS: List<IceServerConfig> = listOf(
    IceServerConfig(
        urls = listOf(
            "stun:stun.cloudflare.com:3478",
            "stun:stun.l.google.com:19302",
        ),
    ),
)

object IceServerConfigCodec {
    private val json = Json { ignoreUnknownKeys = true }

    fun parseJsonArray(element: JsonElement?): List<IceServerConfig>? {
        val array = element as? JsonArray ?: return null
        val out = ArrayList<IceServerConfig>(array.size)
        for (item in array) {
            val parsed = parseJsonObject(item) ?: return null
            out.add(parsed)
        }
        return out
    }

    fun parseJsonObject(element: JsonElement?): IceServerConfig? {
        val obj = element as? JsonObject ?: return null
        val urlsElem = obj["urls"] ?: return null
        val urls = when (urlsElem) {
            is JsonPrimitive -> {
                if (!urlsElem.isString) return null
                val s = urlsElem.content.trim()
                if (s.isEmpty()) return null
                listOf(s)
            }
            is JsonArray -> {
                if (urlsElem.isEmpty()) return null
                val list = ArrayList<String>(urlsElem.size)
                for (entry in urlsElem) {
                    val prim = entry as? JsonPrimitive ?: return null
                    if (!prim.isString) return null
                    val s = prim.content.trim()
                    if (s.isEmpty()) return null
                    list.add(s)
                }
                list
            }
            else -> return null
        }
        val usernameElem = obj["username"]
        val username = when (usernameElem) {
            null, is JsonNull -> null
            is JsonPrimitive -> if (usernameElem.isString) usernameElem.content else return null
            else -> return null
        }
        val credentialElem = obj["credential"]
        val credential = when (credentialElem) {
            null, is JsonNull -> null
            is JsonPrimitive -> if (credentialElem.isString) credentialElem.content else return null
            else -> return null
        }
        return IceServerConfig(urls = urls, username = username, credential = credential)
    }

    /**
     * Parses user-supplied ICE server configuration text.
     * Supports either a JSON array of IceServerConfig objects (accepting string or array `urls`),
     * a single JSON IceServerConfig object, or newline/comma-separated STUN/TURN URLs.
     * Blank input returns an empty list. Invalid input throws IllegalArgumentException.
     */
    fun parseUserInput(raw: String?): List<IceServerConfig> {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return emptyList()
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            val element = try {
                json.parseToJsonElement(trimmed)
            } catch (e: Exception) {
                throw IllegalArgumentException("ICE 配置 JSON 格式无效：${e.message}")
            }
            val parsed = when (element) {
                is JsonArray -> parseJsonArray(element)
                is JsonObject -> parseJsonObject(element)?.let { listOf(it) }
                else -> null
            } ?: throw IllegalArgumentException("ICE 配置项格式无效，需包含有效的 urls 字段")
            validateSchemes(parsed)
            return parsed
        }
        val urls = trimmed.split('\n', '\r', ',').map { it.trim() }.filter { it.isNotEmpty() }
        if (urls.isEmpty()) return emptyList()
        val parsed = listOf(IceServerConfig(urls = urls))
        validateSchemes(parsed)
        return parsed
    }

    fun encodeJson(servers: List<IceServerConfig>): String =
        if (servers.isEmpty()) "" else json.encodeToString(ListSerializer(IceServerConfig.serializer()), servers)

    private fun validateSchemes(servers: List<IceServerConfig>) {
        for (server in servers) {
            require(server.urls.isNotEmpty()) { "ICE 服务器 urls 不能为空" }
            for (url in server.urls) {
                val lower = url.lowercase()
                require(
                    lower.startsWith("stun:") ||
                        lower.startsWith("stuns:") ||
                        lower.startsWith("turn:") ||
                        lower.startsWith("turns:"),
                ) { "ICE URL 必须以 stun:/stuns:/turn:/turns: 开头：$url" }
            }
        }
    }
}

data class AuthBootstrap(
    val version: Int,
    val pairingToken: String,
    val expiresAtMs: Long,
)

data class Offer(
    val v: Int,
    val serverId: String,
    val daemonPublicKeyB64: String,
    val relay: RelayOffer? = null,
    val authBootstrap: AuthBootstrap? = null,
    val lan: LanOffer? = null,
    val iceServers: List<IceServerConfig> = emptyList(),
)

data class PairingLink(
    val url: String,
    val landingUrl: String,
    val offer: Offer,
)

object OfferCodec {
    const val VERSION = 2

    fun decode(raw: String?): Offer? {
        if (raw.isNullOrBlank()) return null
        return try {
            val padded = raw.replace('-', '+').replace('_', '/')
            val pad = (4 - padded.length % 4) % 4
            val bytes = Base64.getDecoder().decode(padded + "=".repeat(pad))
            val value = Json.parseToJsonElement(String(bytes, Charsets.UTF_8)).jsonObject
            val v = value["v"]?.jsonPrimitive?.intOrNull
            if (v != VERSION) return null
            val serverId = value.string("serverId") ?: return null
            val daemonPublicKeyB64 = value.string("daemonPublicKeyB64") ?: return null

            val relay: RelayOffer? = when (val relayElem = value["relay"]) {
                null, is JsonNull -> null
                is JsonObject -> {
                    val endpoint = relayElem.string("endpoint") ?: return null
                    val useTlsValue = relayElem["useTls"]
                    val useTls = when (useTlsValue) {
                        null, is JsonNull -> false
                        else -> useTlsValue.jsonPrimitive.booleanOrNull ?: return null
                    }
                    RelayOffer(endpoint, useTls)
                }
                else -> return null
            }

            val lan: LanOffer? = when (val lanElem = value["lan"]) {
                null, is JsonNull -> null
                is JsonObject -> {
                    val endpointsElem = lanElem["endpoints"] as? JsonArray ?: return null
                    val endpoints = ArrayList<String>(endpointsElem.size)
                    for (entry in endpointsElem) {
                        val prim = entry as? JsonPrimitive ?: return null
                        if (!prim.isString) return null
                        val ep = prim.content.trim()
                        if (ep.isEmpty()) return null
                        endpoints.add(ep)
                    }
                    val useTlsValue = lanElem["useTls"]
                    val useTls = when (useTlsValue) {
                        null, is JsonNull -> false
                        else -> useTlsValue.jsonPrimitive.booleanOrNull ?: return null
                    }
                    LanOffer(endpoints = endpoints, useTls = useTls)
                }
                else -> return null
            }

            val hasRelay = relay != null && relay.endpoint.isNotEmpty()
            val hasLan = lan != null && lan.endpoints.isNotEmpty()
            if (!hasRelay && !hasLan) return null

            val iceServers: List<IceServerConfig> = when (val iceElem = value["iceServers"]) {
                null, is JsonNull -> emptyList()
                else -> IceServerConfigCodec.parseJsonArray(iceElem) ?: return null
            }

            val authBootstrap = value["authBootstrap"]?.takeIf { it !is JsonNull }?.let { element ->
                val auth = element as? JsonObject ?: return null
                val version = auth["version"]?.jsonPrimitive?.intOrNull
                val pairingToken = auth.string("pairingToken")
                val expiresAtMs = auth["expiresAtMs"]?.jsonPrimitive?.longOrNull
                if (
                    version != 1 ||
                    pairingToken == null ||
                    pairingToken.length !in 16..256 ||
                    expiresAtMs == null ||
                    expiresAtMs <= 0
                ) {
                    return null
                }
                AuthBootstrap(version, pairingToken, expiresAtMs)
            }

            Offer(
                v = VERSION,
                serverId = serverId,
                daemonPublicKeyB64 = daemonPublicKeyB64,
                relay = relay,
                authBootstrap = authBootstrap,
                lan = lan,
                iceServers = iceServers,
            )
        } catch (_: Exception) {
            null
        }
    }

    fun fromHash(hash: String?): Offer? {
        val match = Regex("(?:^|#|&)offer=([^&]+)").find(hash ?: "") ?: return null
        return decode(match.groupValues[1])
    }

    fun fromPaste(value: String?): Offer? {
        val text = value?.trim().orEmpty()
        if (text.isEmpty()) return null
        fromHash(if (text.startsWith("#")) text else "#$text")?.let { return it }
        return try {
            fromHash(URI(text).rawFragment?.let { "#$it" } ?: "")
        } catch (_: Exception) {
            null
        }
    }

    fun parsePairingLink(value: String?): PairingLink? {
        val text = value?.trim().orEmpty()
        if (text.isEmpty()) return null
        return try {
            val uri = URI(text)
            if (
                uri.scheme?.lowercase() !in setOf("http", "https") ||
                uri.host.isNullOrEmpty() ||
                uri.userInfo != null
            ) {
                return null
            }
            val rawFragment = uri.rawFragment ?: return null
            if (!rawFragment.matches(Regex("^offer=[A-Za-z0-9_-]+$"))) return null
            val offer = decode(rawFragment.removePrefix("offer=")) ?: return null
            PairingLink(
                url = text,
                landingUrl = text.substringBefore('#'),
                offer = offer,
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun JsonObject.string(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }
}
