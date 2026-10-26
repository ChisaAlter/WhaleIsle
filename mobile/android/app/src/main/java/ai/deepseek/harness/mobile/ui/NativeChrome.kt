package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.R
import ai.deepseek.harness.mobile.ui.theme.dsh
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat

@Composable
internal fun WhaleAvatar(modifier: Modifier = Modifier) {
    Image(painterResource(R.drawable.whale_head), "鲸屿", modifier)
}

@Composable
internal fun WhaleWordmark(modifier: Modifier = Modifier) {
    val colors = dsh()
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        WhaleAvatar(Modifier.size(44.dp))
        Column {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row {
                    Text("鲸", color = colors.labelPrimary, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold)
                    Text("屿", color = colors.buttonInfoFill, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold)
                }
                Text("WHALE ISLE", color = colors.labelPrimary, fontSize = 10.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
            }
            Text("BASED ON DEEPSEEK HARNESS", color = colors.labelTertiary, fontSize = 8.sp, lineHeight = 14.sp)
        }
    }
}

/** Geometry mirrors the product's ui-primitives current-color icons. */
internal enum class NativeGlyph(val paths: List<String>, val filled: Boolean = false) {
    Panel(listOf("M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z", "M5.5 1.5V14.5")),
    Plus(listOf("M8 2V14", "M2 8H14")),
    Close(listOf("M2.5 2.5L13.5 13.5", "M13.5 2.5L2.5 13.5")),
    Back(listOf("M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12")),
    Down(listOf("M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6")),
    Check(listOf("M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4")),
    Search(listOf("M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z", "M10.2991 10.3933L14.7783 14.8725")),
    Folder(listOf("M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z", "M3.63501 7.66614H12.3647")),
    Shield(listOf("M6.80132 2.14853C7.70663 1.80917 8.70422 1.80919 9.60952 2.14859L14.1296 3.84317V7.11961C14.1296 11.6089 10.7615 13.5975 8.20543 14.5779C5.64931 13.5975 2.28052 11.6089 2.28052 7.11961V3.84317L6.80132 2.14853Z")),
    Settings(listOf("M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z", "M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z")),
    More(listOf("M3 9a1 1 0 1 0 0-2a1 1 0 0 0 0 2Z", "M8 9a1 1 0 1 0 0-2a1 1 0 0 0 0 2Z", "M13 9a1 1 0 1 0 0-2a1 1 0 0 0 0 2Z"), true),
    Send(listOf("M8 14.5V2", "M2.5 7.25L8 1.75L13.5 7.25")),
    Stop(listOf("M12.5 2.5H3.5C2.94772 2.5 2.5 2.94772 2.5 3.5V12.5C2.5 13.0523 2.94772 13.5 3.5 13.5H12.5C13.0523 13.5 13.5 13.0523 13.5 12.5V3.5C13.5 2.94772 13.0523 2.5 12.5 2.5Z"), true),
}

@Composable
internal fun NativeIcon(glyph: NativeGlyph, modifier: Modifier = Modifier, tint: Color = dsh().labelPrimary) {
    val paths = remember(glyph) { glyph.paths.map { PathParser().parsePathString(it).toPath() } }
    Canvas(modifier.size(16.dp)) {
        val scale = size.width / 16f
        paths.forEach { original ->
            val path = Path().apply { addPath(original); transform(Matrix().apply { scale(scale, scale) }) }
            if (glyph.filled) drawPath(path, tint) else drawPath(path, tint, style = Stroke(scale * 1.2f))
        }
    }
}

@Composable
internal fun NativeIconButton(
    glyph: NativeGlyph,
    description: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    primary: Boolean = false,
    avatar: Boolean = false,
) {
    val colors = dsh()
    Box(Modifier.size(48.dp).clip(RoundedCornerShape(8.dp))
        .semantics { contentDescription = description }
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        if (avatar) WhaleAvatar(Modifier.size(30.dp)) else {
            Box(Modifier.size(32.dp).background(if (primary) colors.buttonPrimaryFill else Color.Transparent, CircleShape), contentAlignment = Alignment.Center) {
                NativeIcon(glyph, tint = if (!enabled) colors.labelCaption else if (primary) colors.labelPrimaryForeground else colors.labelPrimary)
            }
        }
    }
}

@Composable
internal fun NativeChoiceRow(label: String, onClick: () -> Unit, selected: Boolean = false, enabled: Boolean = true, detail: String = "", danger: Boolean = false, glyph: NativeGlyph? = null) {
    val colors = dsh()
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
        .background(if (selected) colors.navActive else Color.Transparent)
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (glyph != null) NativeIcon(glyph, tint = colors.labelSecondary)
        Column(Modifier.weight(1f)) {
            Text(label, color = if (!enabled) colors.labelCaption else if (danger) colors.error else colors.labelPrimary,
                fontSize = 14.sp, lineHeight = 22.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (detail.isNotBlank()) Text(detail, color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (selected) NativeIcon(NativeGlyph.Check, tint = colors.buttonInfoFill)
    }
}

@Composable
internal fun NativeField(value: String, onValueChange: (String) -> Unit, label: String, enabled: Boolean = true, minLines: Int = 1) {
    val colors = dsh()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
        BasicTextField(value, onValueChange, enabled = enabled, singleLine = minLines == 1, minLines = minLines,
            maxLines = if (minLines == 1) 1 else 12, textStyle = TextStyle(color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp),
            cursorBrush = SolidColor(colors.buttonInfoFill),
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(8.dp))
                .background(colors.bgBase).border(1.dp, colors.borderL2, RoundedCornerShape(8.dp)).padding(12.dp)
                .semantics { contentDescription = label })
    }
}

/** A bounded native modal keeps its close control outside the scrolling body. */
@Composable
internal fun NativeDialog(title: String, onDismiss: () -> Unit, onBack: (() -> Unit)? = null, actions: (@Composable () -> Unit)? = null, feedback: String = "", feedbackHint: String = "", content: @Composable ColumnScope.() -> Unit) {
    val colors = dsh()
    val keyboard = LocalSoftwareKeyboardController.current
    val ime = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val dismissLayer: () -> Unit = { if (ime) keyboard?.hide() else if (onBack != null) onBack() else onDismiss(); Unit }
    Dialog(onDismissRequest = dismissLayer, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val dialogWindow = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect {
            dialogWindow?.let { window ->
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    val light = colors.bgBase.luminance() > 0.5f
                    isAppearanceLightStatusBars = light
                    isAppearanceLightNavigationBars = light
                }
                @Suppress("DEPRECATION")
                window.statusBarColor = android.graphics.Color.TRANSPARENT
                @Suppress("DEPRECATION")
                window.navigationBarColor = android.graphics.Color.TRANSPARENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.isStatusBarContrastEnforced = false
                    window.isNavigationBarContrastEnforced = false
                }
            }
        }
        BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.union(WindowInsets.ime)).padding(16.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.matchParentSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss))
            Surface(Modifier.widthIn(max = 440.dp).fillMaxWidth().heightIn(max = maxHeight), shape = RoundedCornerShape(24.dp),
                color = colors.bgLayer2, border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderL2), shadowElevation = 8.dp) {
                Column {
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = if (onBack == null) 20.dp else 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (onBack != null) NativeIconButton(NativeGlyph.Back, "返回", onBack)
                        Text(title, Modifier.weight(1f).padding(vertical = 4.dp), color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        NativeIconButton(NativeGlyph.Close, "关闭$title", onDismiss)
                    }
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (feedbackHint.isNotBlank()) Box(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 8.dp, vertical = 8.dp)) {
                            Text(feedback.ifBlank { feedbackHint }, Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                                color = if (feedback.isBlank()) colors.labelTertiary else colors.error, fontSize = 12.sp, lineHeight = 18.sp)
                        }
                        content()
                    }
                    if (actions != null) Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) { actions() }
                }
            }
        }
    }
}
