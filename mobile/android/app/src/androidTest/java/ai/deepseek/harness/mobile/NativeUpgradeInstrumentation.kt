package ai.deepseek.harness.mobile

import android.app.Instrumentation
import android.os.Bundle
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.store.EncryptedDeviceStore
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

/** Read-only, on-device comparison of shipped WebView storage and migrated encrypted storage. */
class NativeUpgradeInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        try {
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
}
