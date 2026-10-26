package ai.deepseek.harness.mobile.ui

import android.content.Context
import androidx.compose.runtime.*

/** Device-local presentation settings; never writes the paired computer's configuration. */
internal class MobilePreferences(context: Context) {
    private val prefs = context.getSharedPreferences("native_interface", Context.MODE_PRIVATE)
    var messageScale by mutableStateOf(prefs.getFloat("messageScale", 1f).coerceIn(0.85f, 1.3f))
        private set
    var showReasoning by mutableStateOf(prefs.getBoolean("showReasoning", true))
        private set
    var expandToolDetails by mutableStateOf(prefs.getBoolean("expandToolDetails", false))
        private set
    var sendWithEnter by mutableStateOf(prefs.getBoolean("sendWithEnter", false))
        private set
    var runningSendMode by mutableStateOf(prefs.getString("runningSendMode", "queue").orEmpty().let { if (it == "steer") it else "queue" })
        private set

    fun updateMessageScale(value: Float) { messageScale = value.coerceIn(0.85f, 1.3f); prefs.edit().putFloat("messageScale", messageScale).apply() }
    fun updateShowReasoning(value: Boolean) { showReasoning = value; prefs.edit().putBoolean("showReasoning", value).apply() }
    fun updateExpandToolDetails(value: Boolean) { expandToolDetails = value; prefs.edit().putBoolean("expandToolDetails", value).apply() }
    fun updateSendWithEnter(value: Boolean) { sendWithEnter = value; prefs.edit().putBoolean("sendWithEnter", value).apply() }
    fun updateRunningSendMode(value: String) { require(value == "queue" || value == "steer"); runningSendMode = value; prefs.edit().putString("runningSendMode", value).apply() }
}

internal val LocalMobilePreferences = staticCompositionLocalOf<MobilePreferences?> { null }
