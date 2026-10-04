package ai.deepseek.harness.mobile.store

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class EncryptedDeviceStore(context: Context) : DeviceStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "dsh_remote_device",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override var webAppUrl: String
        get() = prefs.getString("webAppUrl", "").orEmpty()
        set(value) { prefs.edit().putString("webAppUrl", value).apply() }

    override var scheme: String
        get() = prefs.getString("scheme", "system").orEmpty().ifEmpty { "system" }
        set(value) { prefs.edit().putString("scheme", value).apply() }

    override var computersJson: String
        get() = prefs.getString("nativeComputers", "[]").orEmpty()
        set(value) { check(prefs.edit().putString("nativeComputers", value).commit()) { "无法保存配对凭据" } }
    override var draftsJson: String
        get() = prefs.getString("nativeDrafts", "{}").orEmpty()
        set(value) { prefs.edit().putString("nativeDrafts", value).apply() }
    override var selectedComputer: String
        get() = prefs.getString("nativeSelectedComputer", "").orEmpty()
        set(value) { prefs.edit().putString("nativeSelectedComputer", value).apply() }
    override var nativeMigrationDone: Boolean
        get() = prefs.getBoolean("nativeMigrationDone", false)
        set(value) { check(prefs.edit().putBoolean("nativeMigrationDone", value).commit()) }

    override fun clearLegacyHttpCredentials() {
        if (prefs.getBoolean("httpV1CredentialsCleared", false)) return
        prefs.edit()
            .remove("origin")
            .remove("deviceToken")
            .putBoolean("httpV1CredentialsCleared", true)
            .apply()
    }
}
