package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.R
import ai.deepseek.harness.mobile.ui.theme.dsh
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
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
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = false,
    avatar: Boolean = false,
) {
    val colors = dsh()
    Box(modifier.size(48.dp).clip(RoundedCornerShape(8.dp))
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
        BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.union(WindowInsets.ime)).padding(16.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.matchParentSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss))
            Surface(Modifier.widthIn(max = 440.dp).fillMaxWidth().heightIn(max = maxHeight), shape = RoundedCornerShape(24.dp),
                color = colors.bgLayer2, border = androidx.compose.foundation.BorderStroke(1.dp, colors.borderL2), shadowElevation = 8.dp) {
                Column {
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = if (onBack == null) 20.dp else 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (onBack != null) NativeIconButton(NativeGlyph.Back, "返回", onBack)
                        Text(title, Modifier.weight(1f), color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        NativeIconButton(NativeGlyph.Close, "关闭$title", onDismiss)
                    }
                    if (feedbackHint.isNotBlank()) Box(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 20.dp, vertical = 8.dp)) {
                        Text(feedback.ifBlank { feedbackHint }, Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                            color = if (feedback.isBlank()) colors.labelTertiary else colors.error, fontSize = 12.sp, lineHeight = 18.sp)
                    }
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
                    if (actions != null) Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) { actions() }
                }
            }
        }
    }
}
