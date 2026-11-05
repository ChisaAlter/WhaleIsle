package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.theme.DshPalette
import ai.deepseek.harness.mobile.ui.theme.dsh
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.HorizontalScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import java.io.ByteArrayInputStream
import java.io.File

internal data class NativeWhaleUiPayload(
    val instanceKey: String,
    val language: String = "whale-ui",
    val program: String,
    val title: String = "",
    val streaming: Boolean = false,
)

private val WHALE_UI_TITLE_REGEX = Regex("""Title\(\s*"([^"]+)"""")
private val ALLOWED_WHALE_BUNDLES = setOf(
    "mermaid.js",
    "three.js",
    "echarts-core.js",
    "echarts-full.js",
    "icons.js",
    "standalone-runtime.js",
)

internal fun extractWhaleUiTitle(program: String): String? =
    WHALE_UI_TITLE_REGEX.find(program)?.groupValues?.getOrNull(1)?.takeIf { it.isNotBlank() }

internal fun formatWhaleUiAssistantPrompt(
    message: String,
    formState: JsonElement? = null,
    context: JsonElement? = null,
): String {
    fun renderValue(value: JsonElement?): String? {
        if (value == null || value is JsonNull) return null
        if (value is JsonPrimitive && value.isString) return value.content.takeIf { it.isNotBlank() }
        return value.toString().takeIf { it.isNotBlank() && it != "{}" && it != "null" }
    }
    return listOfNotNull(
        message.trim().takeIf { it.isNotEmpty() },
        renderValue(formState)?.let { "Whale UI form state:\n$it" },
        renderValue(context)?.let { "Whale UI context:\n$it" },
    ).joinToString("\n\n")
}

private fun Color.toCssColor(): String {
    val argb = toArgb()
    val a = (argb ushr 24) and 0xFF
    val r = (argb ushr 16) and 0xFF
    val g = (argb ushr 8) and 0xFF
    val b = argb and 0xFF
    return if (a == 255) {
        String.format("#%02x%02x%02x", r, g, b)
    } else {
        String.format(java.util.Locale.US, "rgba(%d, %d, %d, %.3f)", r, g, b, a / 255f)
    }
}

internal fun buildWhaleUiThemeVariables(colors: DshPalette): Map<String, String> {
    val bgBase = colors.bgBase.toCssColor()
    val bgLayer1 = colors.bgLayer1.toCssColor()
    val bgLayer2 = colors.bgLayer2.toCssColor()
    val bgModule = colors.bgModule.toCssColor()
    val borderL1 = colors.borderL1.toCssColor()
    val borderL2 = colors.borderL2.toCssColor()
    val labelPrimary = colors.labelPrimary.toCssColor()
    val labelSecondary = colors.labelSecondary.toCssColor()
    val labelTertiary = colors.labelTertiary.toCssColor()
    val labelPrimaryFg = colors.labelPrimaryForeground.toCssColor()
    val buttonPrimaryFill = colors.buttonPrimaryFill.toCssColor()
    val buttonPrimaryHover = colors.buttonPrimaryHover.toCssColor()
    val buttonInfoFill = colors.buttonInfoFill.toCssColor()
    val interactiveHover = colors.interactiveHover.toCssColor()
    val interactiveActive = colors.interactiveActive.toCssColor()
    val success = colors.success.toCssColor()
    val warn = colors.warn.toCssColor()
    val error = colors.error.toCssColor()
    return mapOf(
        "--bg" to bgBase,
        "--background" to bgBase,
        "--surface" to bgLayer1,
        "--text" to labelPrimary,
        "--text-secondary" to labelSecondary,
        "--border" to borderL2,
        "--accent" to buttonInfoFill,
        "--dsh-bg-base" to bgBase,
        "--dsh-bg-layer-1" to bgLayer1,
        "--dsh-bg-layer-2" to bgLayer2,
        "--dsh-bg-module" to bgModule,
        "--dsh-border-l1" to borderL1,
        "--dsh-border-l2" to borderL2,
        "--dsh-label-primary" to labelPrimary,
        "--dsh-label-secondary" to labelSecondary,
        "--dsh-label-tertiary" to labelTertiary,
        "--dsh-button-info" to buttonInfoFill,
        "--dsw-alias-bg-base" to bgBase,
        "--dsw-alias-bg-layer-1" to bgLayer1,
        "--dsw-alias-interactive-bg-hover" to interactiveHover,
        "--dsw-alias-interactive-bg-active" to interactiveActive,
        "--dsw-alias-border-l2" to borderL2,
        "--dsw-alias-label-primary" to labelPrimary,
        "--dsw-alias-label-secondary" to labelSecondary,
        "--dsw-alias-label-tertiary" to labelTertiary,
        "--dsw-alias-label-primary-foreground" to labelPrimaryFg,
        "--dsw-alias-state-business-primary" to buttonInfoFill,
        "--dsw-alias-brand-primary" to buttonInfoFill,
        "--dsw-alias-button-primary-fill" to buttonPrimaryFill,
        "--dsw-alias-button-primary-hover" to buttonPrimaryHover,
        "--dsw-alias-state-success-primary" to success,
        "--dsw-alias-state-warn-primary" to warn,
        "--dsw-alias-state-error-primary" to error,
    )
}

internal fun injectWhaleUiBootstrap(html: String, instanceId: String): String {
    val safeInstanceId = Json.encodeToString(instanceId)
    val bootstrap = """
        <script>
        (function() {
          const instanceId = $safeInstanceId;
          window.name = "whale-ui:" + instanceId;
          const hostParent = {
            postMessage: function(data) {
              try {
                if (data && data.channel === "whale-ui" && typeof AndroidWhaleUiHost !== "undefined") {
                  AndroidWhaleUiHost.onViewerMessage(JSON.stringify(data));
                }
              } catch (_) {}
            }
          };
          try {
            Object.defineProperty(window, "parent", { value: hostParent, configurable: true });
          } catch (_) {}
          window.__dshReceiveFromHost = function(rawJson) {
            try {
              const data = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
              const ev = new MessageEvent("message", { data: data, origin: "https://whale-ui.local" });
              Object.defineProperty(ev, "source", { value: hostParent });
              window.dispatchEvent(ev);
            } catch (_) {}
          };
        })();
        </script>
    """.trimIndent()
    val scriptIdx = html.indexOf("<script")
    return if (scriptIdx >= 0) {
        html.substring(0, scriptIdx) + bootstrap + "\n" + html.substring(scriptIdx)
    } else {
        bootstrap + "\n" + html
    }
}

private object WhaleUiStateMemory {
    val formStates = mutableMapOf<String, JsonObject>()
}

@Composable
internal fun NativeWhaleUiCard(
    payload: NativeWhaleUiPayload,
    modifier: Modifier = Modifier,
    onSendAssistantMessage: ((String) -> Unit)? = null,
) {
    val colors = dsh()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val density = LocalDensity.current
    val scale = LocalMobilePreferences.current?.messageScale ?: 1f
    val lineHeight = with(density) { (20 * scale).sp.toPx() }
    val instanceId = payload.instanceKey.ifBlank { "whale-ui-default" }

    var showSource by rememberSaveable(instanceId) { mutableStateOf(false) }
    var viewerTitle by rememberSaveable(instanceId) { mutableStateOf("") }
    var viewerHeightDp by rememberSaveable(instanceId) { mutableIntStateOf(220) }
    var viewerReady by remember { mutableStateOf(false) }
    var viewerError by remember { mutableStateOf("") }

    val displayTitle = viewerTitle.ifBlank {
        payload.title.ifBlank {
            extractWhaleUiTitle(payload.program) ?: "交互卡片"
        }
    }

    val appearance = if (colors.bgBase.luminance() < 0.5f) "dark" else "light"
    val themeVars = remember(colors) { buildWhaleUiThemeVariables(colors) }

    val currentPayload by rememberUpdatedState(payload)
    val currentAppearance by rememberUpdatedState(appearance)
    val currentThemeVars by rememberUpdatedState(themeVars)
    val currentOnSend by rememberUpdatedState(onSendAssistantMessage)

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = colors.bgLayer1,
        border = BorderStroke(1.dp, colors.borderL2),
    ) {
        Column(Modifier.fillMaxWidth()) {
            // Card Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(colors.bgModule)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (payload.streaming) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(12.dp),
                        color = colors.buttonInfoFill,
                        strokeWidth = 1.5.dp,
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(colors.buttonInfoFill, CircleShape),
                    )
                }
                Text(
                    text = displayTitle + if (payload.streaming) " · 生成中…" else "",
                    modifier = Modifier.weight(1f),
                    color = colors.labelPrimary,
                    fontSize = (13 * scale).sp,
                    lineHeight = (18 * scale).sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (showSource) {
                    Text(
                        text = "复制",
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(role = Role.Button) {
                                clipboard.setText(AnnotatedString(payload.program))
                                Toast.makeText(context, "已复制源码", Toast.LENGTH_SHORT).show()
                            }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        color = colors.labelSecondary,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(colors.bgLayer1)
                        .padding(2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val tabModifier = Modifier.clip(RoundedCornerShape(6.dp))
                    Text(
                        text = "预览",
                        modifier = tabModifier
                            .background(if (!showSource) colors.navActive else Color.Transparent)
                            .clickable(role = Role.Button) { showSource = false }
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                        color = if (!showSource) colors.labelPrimary else colors.labelTertiary,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                    Text(
                        text = "源码",
                        modifier = tabModifier
                            .background(if (showSource) colors.navActive else Color.Transparent)
                            .clickable(role = Role.Button) { showSource = true }
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                        color = if (showSource) colors.labelPrimary else colors.labelTertiary,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }

            if (showSource || viewerError.isNotBlank()) {
                if (viewerError.isNotBlank() && !showSource) {
                    Text(
                        text = viewerError,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        color = colors.warn,
                        fontSize = 12.sp,
                        lineHeight = 18.sp,
                    )
                }
                AndroidView(
                    modifier = Modifier.fillMaxWidth(),
                    factory = { ctx ->
                        HorizontalScrollView(ctx).apply {
                            isFillViewport = true
                            isHorizontalScrollBarEnabled = true
                            addView(
                                TextView(ctx).apply {
                                    typeface = Typeface.MONOSPACE
                                    setTextIsSelectable(true)
                                    setHorizontallyScrolling(true)
                                    val pad = (ctx.resources.displayMetrics.density * 12 + 0.5f).toInt()
                                    setPadding(pad, pad, pad, pad)
                                },
                                ViewGroup.LayoutParams(
                                    ViewGroup.LayoutParams.WRAP_CONTENT,
                                    ViewGroup.LayoutParams.WRAP_CONTENT,
                                ),
                            )
                        }
                    },
                    update = { scroll ->
                        scroll.setBackgroundColor(colors.bgBase.toArgb())
                        val view = scroll.getChildAt(0) as TextView
                        view.textSize = 13f * scale
                        view.setTextColor(colors.labelPrimary.toArgb())
                        view.setLineSpacing((lineHeight - view.paint.fontSpacing).coerceAtLeast(0f), 1f)
                        if (view.text.toString() != payload.program) {
                            view.text = payload.program
                        }
                    },
                )
            } else {
                var webViewRef by remember { mutableStateOf<WebView?>(null) }

                fun postToViewer(view: WebView?, message: JsonObject) {
                    val wv = view ?: return
                    val encoded = Json.encodeToString(JsonObject.serializer(), message)
                    val jsLiteral = Json.encodeToString(encoded)
                    wv.evaluateJavascript("window.__dshReceiveFromHost && window.__dshReceiveFromHost($jsLiteral);", null)
                }

                fun sendRenderMessage(view: WebView?) {
                    val wv = view ?: return
                    val savedState = WhaleUiStateMemory.formStates[instanceId] ?: obj()
                    postToViewer(
                        wv,
                        obj(
                            "channel" to "whale-ui",
                            "version" to 2,
                            "instanceId" to instanceId,
                            "type" to "render",
                            "program" to currentPayload.program,
                            "language" to currentPayload.language,
                            "streaming" to currentPayload.streaming,
                            "state" to savedState,
                            "theme" to obj(
                                "appearance" to currentAppearance,
                                "variables" to JsonObject(currentThemeVars.mapValues { JsonPrimitive(it.value) }),
                            ),
                            "locale" to "zh",
                            "panel" to false,
                        ),
                    )
                }

                LaunchedEffect(viewerReady, payload.program, payload.streaming, payload.language, appearance, themeVars) {
                    if (viewerReady) {
                        sendRenderMessage(webViewRef)
                    }
                }

                DisposableEffect(instanceId) {
                    onDispose {
                        webViewRef?.let { wv ->
                            wv.stopLoading()
                            wv.removeJavascriptInterface("AndroidWhaleUiHost")
                            wv.destroy()
                        }
                        webViewRef = null
                    }
                }

                val targetHeight = viewerHeightDp.coerceIn(80, 1600).dp
                AndroidView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(targetHeight),
                    factory = { ctx ->
                        createSandboxedWhaleUiWebView(
                            context = ctx,
                            instanceId = instanceId,
                            onReady = { wv ->
                                viewerReady = true
                                sendRenderMessage(wv)
                            },
                            onHeight = { heightPx ->
                                if (heightPx > 0) {
                                    viewerHeightDp = heightPx.coerceIn(80, 1600)
                                }
                            },
                            onTitle = { title ->
                                if (title.isNotBlank()) viewerTitle = title
                            },
                            onState = { stateJson ->
                                if (stateJson != null) {
                                    WhaleUiStateMemory.formStates[instanceId] = stateJson
                                }
                            },
                            onAssistantAction = { prompt ->
                                currentOnSend?.invoke(prompt)
                            },
                            onClipboardAction = { text ->
                                clipboard.setText(AnnotatedString(text))
                                Toast.makeText(ctx, "已复制到剪贴板", Toast.LENGTH_SHORT).show()
                            },
                            onPostMessage = { wv, msg ->
                                postToViewer(wv, msg)
                            },
                            onMissingAssets = { err ->
                                viewerError = err
                            },
                        ).also { webViewRef = it }
                    },
                    update = { wv ->
                        wv.setBackgroundColor(colors.bgBase.toArgb())
                        webViewRef = wv
                    },
                )
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
private fun createSandboxedWhaleUiWebView(
    context: Context,
    instanceId: String,
    onReady: (WebView) -> Unit,
    onHeight: (Int) -> Unit,
    onTitle: (String) -> Unit,
    onState: (JsonObject?) -> Unit,
    onAssistantAction: (String) -> Unit,
    onClipboardAction: (String) -> Unit,
    onPostMessage: (WebView, JsonObject) -> Unit,
    onMissingAssets: (String) -> Unit,
): WebView {
    val mainHandler = Handler(Looper.getMainLooper())
    val webView = WebView(context)

    webView.setBackgroundColor(AndroidColor.TRANSPARENT)
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = true

    webView.setOnTouchListener { v, event ->
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                v.parent?.requestDisallowInterceptTouchEvent(true)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                v.parent?.requestDisallowInterceptTouchEvent(false)
            }
        }
        false
    }

    webView.settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = false
        allowFileAccess = false
        allowContentAccess = false
        @Suppress("DEPRECATION")
        allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        allowUniversalAccessFromFileURLs = false
        setSupportMultipleWindows(false)
        javaScriptCanOpenWindowsAutomatically = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        cacheMode = WebSettings.LOAD_NO_CACHE
    }

    val bridge = object {
        @JavascriptInterface
        fun onViewerMessage(rawJson: String) {
            val parsed = try {
                Json.parseToJsonElement(rawJson).objectValue()
            } catch (_: Exception) {
                return
            }
            if (parsed.string("channel") != "whale-ui") return
            val type = parsed.string("type")
            mainHandler.post {
                when (type) {
                    "ready" -> onReady(webView)
                    "height" -> {
                        val heightVal = (parsed["height"] ?: parsed["value"])
                            ?.jsonPrimitive?.doubleOrNull?.toInt() ?: return@post
                        onHeight(heightVal)
                    }
                    "title" -> {
                        val titleVal = parsed.string("title").ifBlank { parsed.string("value") }
                        onTitle(titleVal)
                    }
                    "state" -> {
                        val stateObj = (parsed["state"] ?: parsed["value"]) as? JsonObject
                        onState(stateObj)
                    }
                    "bundle" -> {
                        val requestId = parsed.string("requestId")
                        val rawName = parsed.string("name").ifBlank { parsed.string("bundle") }
                        val bundleFile = when (rawName) {
                            "charts" -> "echarts-core.js"
                            "mermaid" -> "mermaid.js"
                            else -> rawName
                        }
                        if (bundleFile !in ALLOWED_WHALE_BUNDLES) {
                            onPostMessage(
                                webView,
                                obj(
                                    "channel" to "whale-ui",
                                    "version" to 2,
                                    "instanceId" to instanceId,
                                    "type" to "bundle-response",
                                    "requestId" to requestId,
                                    "name" to rawName,
                                    "error" to "Unsupported bundle: $rawName",
                                ),
                            )
                            return@post
                        }
                        try {
                            val bytes = context.assets.open("whale-ui/assets/$bundleFile").use { it.readBytes() }
                            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                            onPostMessage(
                                webView,
                                obj(
                                    "channel" to "whale-ui",
                                    "version" to 2,
                                    "instanceId" to instanceId,
                                    "type" to "bundle-response",
                                    "requestId" to requestId,
                                    "name" to rawName,
                                    "base64" to b64,
                                ),
                            )
                        } catch (e: Exception) {
                            onPostMessage(
                                webView,
                                obj(
                                    "channel" to "whale-ui",
                                    "version" to 2,
                                    "instanceId" to instanceId,
                                    "type" to "bundle-response",
                                    "requestId" to requestId,
                                    "name" to rawName,
                                    "error" to (e.message ?: "Failed to load bundle $rawName"),
                                ),
                            )
                        }
                    }
                    "resource" -> {
                        val requestId = parsed.string("requestId")
                        onPostMessage(
                            webView,
                            obj(
                                "channel" to "whale-ui",
                                "version" to 2,
                                "instanceId" to instanceId,
                                "type" to "resource-response",
                                "requestId" to requestId,
                                "status" to 503,
                                "body" to obj("error" to "Resource API is unavailable on mobile"),
                            ),
                        )
                    }
                    "action" -> {
                        val requestId = parsed.string("requestId")
                        val nested = parsed["action"] as? JsonObject
                        val actionKind = if (nested != null) nested.string("kind") else parsed.string("action")
                        val sourceObj = nested ?: parsed
                        when (actionKind) {
                            "assistant" -> {
                                val prompt = formatWhaleUiAssistantPrompt(
                                    message = sourceObj.string("message"),
                                    formState = sourceObj["formState"],
                                    context = sourceObj["context"],
                                )
                                if (prompt.isNotBlank()) onAssistantAction(prompt)
                            }
                            "clipboard" -> {
                                val text = sourceObj.string("text")
                                if (text.isNotEmpty()) onClipboardAction(text)
                            }
                            "open-url" -> {
                                openExternalWhaleUiUrl(context, sourceObj.string("url"))
                            }
                            "download" -> {
                                shareWhaleUiDownload(
                                    context = context,
                                    filename = sourceObj.string("filename").ifBlank { "whale-ui-export.txt" },
                                    mimeType = sourceObj.string("mime").ifBlank { sourceObj.string("mimeType").ifBlank { "text/plain" } },
                                    content = sourceObj.string("content"),
                                    encoding = sourceObj.string("encoding"),
                                )
                            }
                        }
                        if (requestId.isNotBlank()) {
                            onPostMessage(
                                webView,
                                obj(
                                    "channel" to "whale-ui",
                                    "version" to 2,
                                    "instanceId" to instanceId,
                                    "type" to "action-response",
                                    "requestId" to requestId,
                                    "result" to obj("ok" to true),
                                ),
                            )
                        }
                    }
                }
            }
        }
    }

    webView.addJavascriptInterface(bridge, "AndroidWhaleUiHost")

    webView.webViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?,
        ): WebResourceResponse? {
            val url = request?.url ?: return blockedResponse()
            val scheme = url.scheme?.lowercase() ?: ""
            val host = url.host?.lowercase() ?: ""
            if (scheme != "https" || host != "whale-ui.local") {
                return blockedResponse()
            }
            val rawPath = url.path?.trimStart('/').orEmpty().ifBlank { "viewer.html" }
            if (rawPath.contains("..")) return blockedResponse()
            return try {
                if (rawPath == "viewer.html") {
                    val rawHtml = context.assets.open("whale-ui/viewer.html").bufferedReader(Charsets.UTF_8).use { it.readText() }
                    val injected = injectWhaleUiBootstrap(rawHtml, instanceId)
                    WebResourceResponse(
                        "text/html",
                        "utf-8",
                        ByteArrayInputStream(injected.toByteArray(Charsets.UTF_8)),
                    )
                } else {
                    val assetPath = "whale-ui/$rawPath"
                    val stream = context.assets.open(assetPath)
                    val mime = when {
                        rawPath.endsWith(".js") -> "application/javascript"
                        rawPath.endsWith(".css") -> "text/css"
                        rawPath.endsWith(".json") -> "application/json"
                        rawPath.endsWith(".svg") -> "image/svg+xml"
                        rawPath.endsWith(".png") -> "image/png"
                        rawPath.endsWith(".woff2") -> "font/woff2"
                        rawPath.endsWith(".ttf") -> "font/ttf"
                        else -> "application/octet-stream"
                    }
                    WebResourceResponse(mime, "utf-8", stream)
                }
            } catch (e: Exception) {
                mainHandler.post {
                    onMissingAssets("未找到 Whale UI 本地组件资源，已切换至源码视图")
                }
                blockedResponse()
            }
        }

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?,
        ): Boolean {
            val url = request?.url?.toString().orEmpty()
            if (url.isNotBlank() && !url.startsWith("https://whale-ui.local")) {
                openExternalWhaleUiUrl(context, url)
            }
            return true
        }
    }

    webView.loadUrl("https://whale-ui.local/viewer.html")
    return webView
}

private fun blockedResponse(): WebResourceResponse =
    WebResourceResponse(
        "text/plain",
        "utf-8",
        403,
        "Forbidden",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
    )

private fun openExternalWhaleUiUrl(context: Context, rawUrl: String) {
    val uri = try {
        Uri.parse(rawUrl.trim())
    } catch (_: Exception) {
        return
    }
    val scheme = uri.scheme?.lowercase() ?: return
    if (scheme !in setOf("http", "https", "mailto")) return
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
    }
}

private fun shareWhaleUiDownload(
    context: Context,
    filename: String,
    mimeType: String,
    content: String,
    encoding: String,
) {
    try {
        val safeName = filename.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("""[^a-zA-Z0-9._-]"""), "_")
            .ifBlank { "whale-ui-export.txt" }
        val bytes = when {
            encoding == "base64" -> Base64.decode(content, Base64.DEFAULT)
            content.startsWith("data:") && content.contains(",") -> {
                val header = content.substringBefore(',')
                val payload = content.substringAfter(',')
                if (header.endsWith(";base64", ignoreCase = true)) {
                    Base64.decode(payload, Base64.DEFAULT)
                } else {
                    Uri.decode(payload).toByteArray(Charsets.UTF_8)
                }
            }
            else -> content.toByteArray(Charsets.UTF_8)
        }
        val dir = File(context.cacheDir, "whale-ui-exports").apply { mkdirs() }
        val file = File(dir, safeName)
        file.writeBytes(bytes)
        val uri = try {
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        } catch (_: Exception) {
            null
        }
        val intent = if (uri != null) {
            Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        } else {
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, content)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }
        context.startActivity(Intent.createChooser(intent, safeName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
    }
}
