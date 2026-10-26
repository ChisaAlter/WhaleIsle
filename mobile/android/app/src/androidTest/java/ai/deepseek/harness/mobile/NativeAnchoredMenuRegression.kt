package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.ui.*
import ai.deepseek.harness.mobile.ui.theme.DshTheme
import android.app.Instrumentation
import android.content.Intent
import android.view.Choreographer
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.InternalComposeUiApi
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.input.InputModeManager
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import kotlin.math.abs
import kotlin.coroutines.resume

/** Real Compose layout, popup and focus assertions through the existing opt-in instrumentation. */
@OptIn(InternalComposeUiApi::class, ExperimentalComposeUiApi::class)
internal class NativeAnchoredMenuRegression(private val instrumentation: Instrumentation) {
    private val roots = mutableListOf<ViewRootForTest>()
    private val height = mutableStateOf(320)
    private var keyboardHides = 0
    private val actions = mutableListOf<NativeChatAction>()
    private val keyboard = object : SoftwareKeyboardController {
        override fun show() = Unit
        override fun hide() { keyboardHides++ }
    }
    private val trace = StringBuilder()
    private lateinit var activity: ComponentActivity
    private lateinit var inputMode: InputModeManager

    fun run(): String = runBlocking {
        val oldCallback = withContext(Dispatchers.Main) {
            ViewRootForTest.onViewCreatedCallback.also { previous ->
                ViewRootForTest.onViewCreatedCallback = { root -> previous?.invoke(root); roots.add(root) }
            }
        }
        try {
            activity = instrumentation.startActivitySync(Intent().apply {
                setClassName(instrumentation.targetContext.packageName, ComponentActivity::class.java.name)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }) as ComponentActivity
            withContext(Dispatchers.Main) {
                activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
                activity.setContent {
                    DshTheme(false) {
                        val currentInputMode = LocalInputModeManager.current
                        SideEffect { inputMode = currentInputMode }
                        CompositionLocalProvider(LocalSoftwareKeyboardController provides keyboard) {
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopStart) {
                                Box(Modifier.width(340.dp).height(height.value.dp).testTag("fixture-chat")) {
                                    NativeChatScreen(
                                        state = NativeChatState(sessionId = "menu-fixture", connected = true,
                                            title = "Menu regression", draft = "kept draft", planOn = true,
                                            permission = "默认", permissionCurrent = "default",
                                            permissionOptions = listOf(NativePermissionOption("default", "默认权限"), NativePermissionOption("safe", "只读权限"))),
                                        workspaces = emptyList(), onAction = { actions.add(it) }, onPanel = {},
                                        onWorkspaceMenu = {}, onSessionMenu = {}, onAttachment = {},
                                        onRemoveAttachment = {}, onLeave = {}, showConnectionNotice = false,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            await("compact tools trigger") { described("权限与 Plan 选项") != null }
            main { check(inputMode.requestInputMode(InputMode.Keyboard)) { "Fixture cannot enter keyboard input mode for focus checks" } }
            frames(2)
            val initial = main {
                // Focus another button so dismissal must actively restore the menu trigger.
                // Avoid focusing the editor: the fixture controls height independently of the real IME.
                check(described("添加图片")!!.config[SemanticsActions.RequestFocus].action?.invoke() == true) { "Fixture did not accept initial keyboard focus" }
                described("权限与 Plan 选项")!!.boundsInWindow
            }
            main { click(described("权限与 Plan 选项")!!) }
            await("tools popup") { pane() != null }
            val before = main { pane()!!.boundsInWindow }
            main {
                check(keyboardHides > 0) { "Opening tools did not hide the keyboard" }
                height.value = 520 // Drive the IME-hide constraint change after the popup has mounted.
            }
            await("normal composer after viewport expansion") {
                tagged("fixture-chat")!!.boundsInWindow.height > 480 * density() && described("切换权限：默认") != null
            }
            frames(3)
            main {
                check(described("权限与 Plan 选项") == null) { "Fixture did not actually switch out of compact composer" }
                val trigger = described("切换权限：默认")!!
                val menu = pane() ?: error("Tools popup disappeared during viewport expansion")
                val gap = trigger.boundsInWindow.top - menu.boundsInWindow.bottom
                trace.appendLine("expanded trigger=${trigger.boundsInWindow}; menu=${menu.boundsInWindow}; gap=$gap")
                check(trigger.boundsInWindow.top > initial.top + 48 * density()) { "Live trigger did not move with the viewport" }
                check(menu.boundsInWindow.bottom > before.bottom + 48 * density()) { "Popup stayed at stale compact bounds: before=$before after=${menu.boundsInWindow}" }
                check(abs(gap - 8 * density()) <= 2) { "Popup is not 8dp above the live trigger: gap=$gap" }
                check(menu.boundsInWindow.left >= 0 && menu.boundsInWindow.right <= tagged("fixture-chat")!!.boundsInWindow.right) { "Popup escaped the chat viewport" }
            }
            // Selection closes the tools menu and must restore focus to its current visible trigger.
            main { click(text("只读权限")!!) }
            await("selection dismissal and visible trigger focus") {
                pane() == null && described("切换权限：默认")?.config?.getOrNull(SemanticsProperties.Focused) == true
            }
            main {
                check(actions.single().let { it.type == "permission" && it.id == "safe" && it.sessionId == "menu-fixture" }) { "Permission action was lost or changed" }
                check(described("消息")!!.config[SemanticsProperties.EditableText].text == "kept draft") { "Composer draft changed" }
                check(described("消息")!!.config.getOrNull(SemanticsProperties.Focused) != true) { "Focus returned to the composer instead of the trigger" }
                trace.appendLine("PASS selection: normal trigger focused; permission action and draft preserved")
            }
            // Also check the reverse transition and Back dismissal, without remounting the chat.
            main { click(described("切换权限：默认")!!) }
            await("permission popup") { pane("权限") != null }
            main { height.value = 320 }
            await("compact composer after viewport contraction") { described("权限与 Plan 选项") != null }
            frames(3)
            main {
                val trigger = described("权限与 Plan 选项")!!
                val menu = pane("权限")!!
                val gap = trigger.boundsInWindow.top - menu.boundsInWindow.bottom
                check(abs(gap - 8 * density()) <= 2) { "Reverse transition lost live trigger: gap=$gap" }
            }
            instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
            await("Back dismissal and compact trigger focus") {
                pane("权限") == null && described("权限与 Plan 选项")?.config?.getOrNull(SemanticsProperties.Focused) == true
            }
            trace.appendLine("PASS Back: compact trigger focused after reverse transition")
            "PASS: 2 Compose runtime cases (compact-to-normal selection; normal-to-compact Back)\n$trace"
        } catch (error: Throwable) {
            throw AssertionError("${error.message}\n$trace", error)
        } finally {
            withContext(Dispatchers.Main) {
                if (::activity.isInitialized) activity.finish()
                ViewRootForTest.onViewCreatedCallback = oldCallback
            }
        }
    }

    private suspend fun <T> main(block: () -> T): T = withContext(Dispatchers.Main) { block() }
    private suspend fun frames(count: Int) = repeat(count) {
        withContext(Dispatchers.Main) { suspendCancellableCoroutine { continuation ->
            Choreographer.getInstance().postFrameCallback { if (continuation.isActive) continuation.resume(Unit) }
        } }
    }
    private suspend fun await(label: String, predicate: () -> Boolean) {
        try {
            withTimeout(10_000) { while (!main(predicate)) delay(16) }
        } catch (error: TimeoutCancellationException) {
            val focused = main { nodes().filter { it.config.contains(SemanticsProperties.Focused) }.joinToString { it.config.toString() } }
            throw AssertionError("Timed out waiting for $label; focus states=$focused", error)
        }
        frames(2)
        trace.appendLine("observed $label")
    }
    private fun nodes(): List<SemanticsNode> = roots.filter { it.view.isAttachedToWindow }.flatMap { root ->
        fun descend(node: SemanticsNode): List<SemanticsNode> = listOf(node) + node.children.flatMap(::descend)
        descend(root.semanticsOwner.rootSemanticsNode)
    }
    private fun described(value: String) = nodes().firstOrNull { it.config.getOrNull(SemanticsProperties.ContentDescription)?.contains(value) == true }
    private fun tagged(value: String) = nodes().firstOrNull { it.config.getOrNull(SemanticsProperties.TestTag) == value }
    private fun pane(title: String = "输入选项") = nodes().firstOrNull { it.config.getOrNull(SemanticsProperties.PaneTitle) == title }
    private fun text(value: String) = nodes().firstOrNull { it.config.getOrNull(SemanticsProperties.Text)?.any { text -> text.text == value } == true && it.config.contains(SemanticsActions.OnClick) }
    private fun click(node: SemanticsNode) { check(node.config[SemanticsActions.OnClick].action?.invoke() == true) { "Visible control did not accept click" } }
    private fun density() = roots.first { it.view.isAttachedToWindow }.density.density
}
