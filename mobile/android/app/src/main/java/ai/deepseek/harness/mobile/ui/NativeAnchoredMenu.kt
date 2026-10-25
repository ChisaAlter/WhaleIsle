package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.ui.theme.dsh
import android.graphics.Rect
import android.view.ViewTreeObserver
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties

@Stable
internal class NativeMenuAnchor {
    var bounds by mutableStateOf(IntRect.Zero)
        private set
    private var coordinates: LayoutCoordinates? = null
    val focusRequester = FocusRequester()

    fun update(value: LayoutCoordinates) {
        coordinates = value
        bounds = value.boundsInWindow().roundToIntRect()
    }

    fun restoreFocus() { if (coordinates?.isAttached == true) focusRequester.requestFocus() }
}

internal fun Modifier.nativeMenuAnchor(anchor: NativeMenuAnchor): Modifier =
    onGloballyPositioned(anchor::update).focusRequester(anchor.focusRequester)

/** Match desktop ModelSelect: above the trigger, right aligned, with an 8dp gap and 12dp edge margin. */
internal fun nativeAnchoredMenuBounds(
    anchor: IntRect,
    viewport: IntRect,
    contentSize: IntSize,
    gap: Int,
    margin: Int,
): IntRect {
    val horizontalMargin = margin.coerceIn(0, ((viewport.width - 1) / 2).coerceAtLeast(0))
    val verticalMargin = margin.coerceIn(0, ((viewport.height - 1) / 2).coerceAtLeast(0))
    val left = viewport.left + horizontalMargin
    val right = (viewport.right - horizontalMargin).coerceAtLeast(left + 1)
    val top = viewport.top + verticalMargin
    val bottom = (viewport.bottom - verticalMargin).coerceAtLeast(top + 1)
    val width = contentSize.width.coerceIn(1, right - left)
    val height = contentSize.height.coerceIn(1, bottom - top)
    val x = (anchor.right - width).coerceIn(left, right - width)
    val y = (anchor.top - gap - height).coerceIn(top, bottom - height)
    return IntRect(x, y, x + width, y + height)
}

private object MenuWindowOrigin : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize) = IntOffset.Zero
}

/** A transparent focusable popup owns outside taps; only the small anchored menu paints a surface. */
@Composable
internal fun NativeAnchoredMenu(
    anchor: NativeMenuAnchor,
    viewport: IntRect,
    title: String,
    onDismiss: () -> Unit,
    onBack: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = dsh()
    val density = LocalDensity.current
    val keyboard = LocalSoftwareKeyboardController.current
    var popupImeVisible by remember { mutableStateOf(false) }
    var visibleFrame by remember { mutableStateOf<IntRect?>(null) }
    val gap = with(density) { 8.dp.roundToPx() }
    val margin = with(density) { 12.dp.roundToPx() }
    val preferredSize = with(density) { IntSize(320.dp.roundToPx(), 420.dp.roundToPx()) }
    Popup(
        popupPositionProvider = MenuWindowOrigin,
        onDismissRequest = { if (popupImeVisible) keyboard?.hide() else if (onBack != null) onBack() else onDismiss() },
        properties = PopupProperties(focusable = true, dismissOnClickOutside = false, clippingEnabled = false),
    ) {
        val view = LocalView.current
        val ime = WindowInsets.ime.getBottom(density) > 0
        SideEffect { popupImeVisible = ime }
        DisposableEffect(view) {
            val rect = Rect()
            val origin = IntArray(2)
            fun updateFrame() {
                view.getWindowVisibleDisplayFrame(rect)
                view.rootView.getLocationOnScreen(origin)
                if (rect.width() > 0 && rect.height() > 0) {
                    visibleFrame = IntRect(rect.left - origin[0], rect.top - origin[1], rect.right - origin[0], rect.bottom - origin[1])
                }
            }
            val listener = ViewTreeObserver.OnGlobalLayoutListener { updateFrame() }
            view.viewTreeObserver.addOnGlobalLayoutListener(listener)
            updateFrame()
            onDispose { view.viewTreeObserver.removeOnGlobalLayoutListener(listener) }
        }
        Layout(modifier = Modifier.fillMaxSize(), content = {
            Box(Modifier.fillMaxSize().pointerInput(onDismiss) { detectTapGestures { onDismiss() } })
            Surface(modifier = Modifier.semantics { paneTitle = title }, shape = RoundedCornerShape(12.dp), color = colors.bgLayer2,
                border = BorderStroke(1.dp, colors.borderL2), shadowElevation = 8.dp) {
                Column {
                    if (onBack != null) Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        NativeIconButton(NativeGlyph.Back, "返回模型", onBack)
                        Text(title, Modifier.weight(1f), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp,
                            fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 8.dp, end = 8.dp, top = if (onBack == null) 8.dp else 0.dp, bottom = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
                }
            }
        }) { measurables, constraints ->
            val frame = visibleFrame
            val safeLeft = maxOf(0, viewport.left, frame?.left ?: 0).coerceAtMost(constraints.maxWidth - 1)
            val safeTop = maxOf(0, viewport.top, frame?.top ?: 0).coerceAtMost(constraints.maxHeight - 1)
            val safeRight = minOf(constraints.maxWidth, viewport.right, frame?.right ?: constraints.maxWidth).coerceAtLeast(safeLeft + 1)
            val safeBottom = minOf(constraints.maxHeight, viewport.bottom, frame?.bottom ?: constraints.maxHeight).coerceAtLeast(safeTop + 1)
            val safeViewport = IntRect(safeLeft, safeTop, safeRight, safeBottom)
            val maximum = nativeAnchoredMenuBounds(anchor.bounds, safeViewport, preferredSize, gap, margin)
            val outside = measurables[0].measure(Constraints.fixed(constraints.maxWidth, constraints.maxHeight))
            val menu = measurables[1].measure(Constraints(minWidth = maximum.width, maxWidth = maximum.width, maxHeight = maximum.height))
            val placed = nativeAnchoredMenuBounds(anchor.bounds, safeViewport, IntSize(menu.width, menu.height), gap, margin)
            layout(constraints.maxWidth, constraints.maxHeight) {
                outside.place(0, 0)
                menu.place(placed.left, placed.top)
            }
        }
    }
}
