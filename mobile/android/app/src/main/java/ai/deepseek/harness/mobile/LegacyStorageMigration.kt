package ai.deepseek.harness.mobile

import android.content.Context
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import ai.deepseek.harness.mobile.remote.text
import java.io.ByteArrayInputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Upgrade-only reader for the shipped app's localStorage. Never runs the SPA or opens a connection. */
internal suspend fun readLegacyStorage(context: Context): String = suspendCancellableCoroutine { continuation ->
    val view = WebView(context)
    val origin = "https://appassets.androidplatform.net/assets/migration.html"
    view.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false; blockNetworkLoads = true }
    continuation.invokeOnCancellation { view.post { view.destroy() } }
    view.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
            WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
        override fun onPageFinished(webView: WebView, url: String?) {
            if (!continuation.isActive) return
            if (url != origin) { continuation.resumeWithException(IllegalStateException("旧数据来源无效")); webView.destroy(); return }
            webView.evaluateJavascript("""
                (() => {
                  const drafts = {};
                  for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key.startsWith('dsh-chisacode-drafts:')) drafts[key.slice('dsh-chisacode-drafts:'.length)] = localStorage.getItem(key);
                  }
                  return JSON.stringify({computers: localStorage.getItem('dsh-chisacode-device-secrets') || '{}', drafts});
                })()
            """.trimIndent()) { result ->
                if (continuation.isActive) {
                    try { continuation.resume(Json.parseToJsonElement(result).text().also { require(it.isNotBlank()) }) }
                    catch (error: Exception) { continuation.resumeWithException(error) }
                }
                webView.destroy()
            }
        }
    }
    view.loadDataWithBaseURL(origin, "<!doctype html><meta charset='utf-8'>", "text/html", "UTF-8", origin)
}
