package ai.deepseek.harness.mobile

import android.app.Instrumentation
import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.webkit.WebView
import android.webkit.WebViewClient
import ai.deepseek.harness.mobile.store.EncryptedDeviceStore
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Uses historical targetContext, origin and encrypted preferences; no product data or real credentials. */
class LegacySeedInstrumentation : Instrumentation() {
    private var readOnly = false
    override fun onCreate(arguments: Bundle?) { readOnly = arguments?.getString("readOnly") == "true"; super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        val done = CountDownLatch(1)
        var failure: Throwable? = null
        var view: WebView? = null
        val origin = "https://appassets.androidplatform.net/assets/index.html"
        try {
            runOnMainSync {
                if (!readOnly) {
                    val store = EncryptedDeviceStore(targetContext)
                    store.webAppUrl = origin
                    check(targetContext.getSharedPreferences("dsh_remote_device", Context.MODE_PRIVATE).edit().commit())
                }
                view = WebView(targetContext).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.blockNetworkLoads = true
                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(webView: WebView, url: String?) {
                            webView.evaluateJavascript("""
                                (()=>{
                                  if (!${readOnly}) {
                                    const key=btoa(String.fromCharCode(...Array.from({length:32},(_,i)=>i+1)));
                                    const records={
                                      'qa-legacy-a':{deviceId:'qa-device-a',deviceSecret:'synthetic-old-secret-a',daemonPublicKeyB64:key,relayEndpoint:'127.0.0.1:1',useTls:false,computerName:'QA Legacy A',savedAt:1},
                                      'qa-legacy-b':{deviceId:'qa-device-b',deviceSecret:'synthetic-old-secret-b',daemonPublicKeyB64:key,relayEndpoint:'127.0.0.1:1',useTls:false,computerName:'QA Legacy B',savedAt:2}
                                    };
                                    localStorage.setItem('dsh-chisacode-device-secrets',JSON.stringify(records));
                                    localStorage.setItem('dsh-chisacode-drafts:qa-legacy-a',JSON.stringify({'s1':'旧草稿中文 A','s2':'line one\nline two'}));
                                    localStorage.setItem('dsh-chisacode-drafts:qa-legacy-b',JSON.stringify({'s1':'other computer draft'}));
                                  }
                                  const computers=Object.keys(JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets')||'{}')).length;
                                  const drafts=['qa-legacy-a','qa-legacy-b'].reduce((n,id)=>n+Object.keys(JSON.parse(localStorage.getItem('dsh-chisacode-drafts:'+id)||'{}')).length,0);
                                  return computers===2 && drafts===3;
                                })()
                            """.trimIndent()) { answer ->
                                if (answer != "true") failure = IllegalStateException("Historical localStorage expected 2 computers and 3 drafts")
                                done.countDown()
                            }
                        }
                    }
                    loadDataWithBaseURL(origin,"<!doctype html><meta charset='utf-8'>","text/html","UTF-8",origin)
                }
            }
            check(done.await(20, TimeUnit.SECONDS)) { "Historical WebView timed out" }
            failure?.let { throw it }
            if (!readOnly) {
                // Give Chromium's DOM storage task a chance to flush, then require an actual nonempty database.
                // Persistence is independently proved by the subsequent readOnly run in a new target process.
                SystemClock.sleep(2_000)
                runOnMainSync { view?.destroy(); view = null }
                val db = File(targetContext.applicationInfo.dataDir, "app_webview/Default/Local Storage/leveldb")
                val deadline = SystemClock.uptimeMillis() + 10_000
                while (db.listFiles()?.none { it.extension in setOf("log", "ldb") && it.length() > 100 } != false && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(100)
                check(db.listFiles()?.any { it.extension in setOf("log", "ldb") && it.length() > 100 } == true) { "Historical storage did not persist before instrumentation shutdown" }
            }
            result.putString("stream", if(readOnly) "PASS: cold historical WebView read exactly 2 computers and 3 drafts\n" else "PASS: historical WebView seeded 2 computers and 3 drafts with nonempty storage\n")
            runOnMainSync { view?.destroy(); view = null }
            finish(-1,result)
        } catch (error: Throwable) {
            runOnMainSync { view?.destroy(); view = null }
            result.putString("stream","FAIL: ${error.message}\n"); finish(0,result)
        }
    }
}
