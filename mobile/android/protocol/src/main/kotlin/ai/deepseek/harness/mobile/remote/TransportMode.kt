package ai.deepseek.harness.mobile.remote

enum class TransportMode(
    val wireName: String,
    val priority: Int,
    val displayLabel: String,
) {
    LAN("lan", 3, "局域网直连"),
    P2P("p2p", 2, "P2P 直连"),
    TURN("turn", 1, "TURN 中继"),
    RELAY("relay", 0, "服务器中继");

    companion object {
        fun fromWireName(value: String?): TransportMode? =
            entries.firstOrNull { it.wireName.equals(value?.trim(), ignoreCase = true) }
    }
}
