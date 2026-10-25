package ai.deepseek.harness.mobile

import android.app.Instrumentation
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.core.view.WindowCompat
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.store.EncryptedDeviceStore
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** On-device storage migration comparison, or opt-in system-bar regression checks. */
class NativeUpgradeInstrumentation : Instrumentation() {
    private var systemBars = false
    override fun onCreate(arguments: Bundle?) {
        systemBars = arguments?.getString("systemBars") == "true"
        super.onCreate(arguments)
        start()
    }
    override fun onStart() {
        val result = Bundle()
        try {
            if (systemBars) {
                checkSystemBars(result)
                finish(-1, result)
                return
            }
            runBlocking {
                val store=EncryptedDeviceStore(targetContext)
                check(store.nativeMigrationDone) { "Migration has not completed" }
                val legacy=Json.parseToJsonElement(withContext(Dispatchers.Main) { withTimeout(10_000) { readLegacyStorage(targetContext) } }).objectValue()
                val oldComputers=Json.parseToJsonElement(legacy.string("computers")).objectValue()
                val saved=Json.decodeFromString<List<SavedComputer>>(store.computersJson)
                var computers=0; var drafts=0
                for((id,value) in oldComputers) {
                    val old=value.objectValue()
                    if(old.string("deviceId").isBlank() || old.string("deviceSecret").isBlank() || old.string("relayEndpoint").isBlank() || old.string("daemonPublicKeyB64").isBlank()) continue
                    val current=saved.find {it.serverId==id} ?: error("Legacy computer was not migrated")
                    check(current.deviceId==old.string("deviceId") && current.deviceSecret==old.string("deviceSecret") && current.daemonPublicKeyB64==old.string("daemonPublicKeyB64") &&
                        current.relayEndpoint==old.string("relayEndpoint") && current.relayUseTls==old["useTls"].flag()) { "Legacy credential changed" }
                    computers++
                }
                val currentDrafts=Json.parseToJsonElement(store.draftsJson).objectValue()
                for((server,value) in legacy["drafts"].objectValue()) for((session,text) in Json.parseToJsonElement(value.text()).objectValue()) {
                    check(currentDrafts["$server/$session"]==text) { "Legacy draft changed" }; drafts++
                }
                result.putString("stream","PASS: preserved $computers legacy computers and $drafts drafts in encrypted native storage\n")
            }
            finish(-1,result)
        } catch(error:Throwable) {
            result.putString("stream","FAIL: ${error.message}\n"); finish(0,result)
        }
    }

    @Suppress("DEPRECATION")
    private fun checkSystemBars(result: Bundle) {
        val store = EncryptedDeviceStore(targetContext)
        val originalScheme = store.scheme
        var activity: MainActivity? = null
        try {
            for (scheme in listOf("light", "dark")) {
                runOnMainSync { store.scheme = scheme }
                val current = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
                activity = current
                val dark = scheme == "dark"
                // Compose's first frame can be scheduled after the main queue becomes idle.
                val deadline = SystemClock.uptimeMillis() + 10_000
                var themed = false
                while (!themed && SystemClock.uptimeMillis() < deadline) {
                    waitForIdleSync()
                    runOnMainSync {
                        val bars = WindowCompat.getInsetsController(current.window, current.window.decorView)
                        themed = bars.isAppearanceLightStatusBars == !dark && bars.isAppearanceLightNavigationBars == !dark
                    }
                    if (!themed) SystemClock.sleep(50)
                }
                check(themed) { "$scheme status/navigation icon appearance did not settle" }
                runOnMainSync {
                    val window = current.window
                    check(window.statusBarColor == Color.TRANSPARENT) { "$scheme status bar is not transparent" }
                    check(window.navigationBarColor == Color.TRANSPARENT) { "$scheme navigation bar is not transparent" }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        check(!window.isNavigationBarContrastEnforced) { "$scheme navigation contrast scrim is enabled" }
                    }
                    current.finish()
                }
                activity = null
                waitForIdleSync()
            }
            result.putString("stream", "PASS: light/dark status and navigation icons, transparent bars, API-gated contrast scrim\n")
        } finally {
            runOnMainSync {
                activity?.finish()
                store.scheme = originalScheme
                // Instrumentation can exit before apply() reaches disk; flush its pending restore.
                check(targetContext.getSharedPreferences("dsh_remote_device", Context.MODE_PRIVATE).edit().commit())
            }
        }
    }
}
