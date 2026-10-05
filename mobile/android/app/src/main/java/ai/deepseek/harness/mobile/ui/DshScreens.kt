package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.DshViewModel
import ai.deepseek.harness.mobile.Route
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Capsule = RoundedCornerShape(20.dp)
private val FieldShape = RoundedCornerShape(12.dp)
private val ConnectionDockShape = RoundedCornerShape(24.dp)
private val ConnectionStars = listOf(
    0.09f to 0.18f,
    0.22f to 0.38f,
    0.37f to 0.12f,
    0.51f to 0.31f,
    0.69f to 0.16f,
    0.84f to 0.36f,
    0.94f to 0.10f,
)
private val ConnectionParticles = listOf(
    0.18f to 0.74f,
    0.72f to 0.82f,
    0.42f to 0.91f,
)

/** Whale brand mark, drawn from the same SVG path as the shared mobile entry. */
private const val WHALE_PATH =
    "M6 27c0-8.3 7.6-15 17-15 7 0 12.5 3.6 15 9 2.3-.9 4.2-2.6 5.2-4.8" +
        ".8 4-1 8-4.3 10.2C36.6 33.2 30.6 37 23 37 13.6 37 6 33.3 6 27Z"

@Composable
private fun WhaleMark(modifier: Modifier = Modifier) {
    val connection = dsh().connection
    val path = remember { PathParser().parsePathString(WHALE_PATH).toPath() }
    Canvas(modifier) {
        val scale = size.width / 48f
        val scaled = Path().apply {
            addPath(path)
            transform(Matrix().apply { scale(scale, scale) })
        }
        drawPath(scaled, color = connection.mark)
        drawCircle(
            connection.markCutout,
            radius = 1.8f * scale,
            center = Offset(16f * scale, 24f * scale),
        )
    }
}
@Composable
internal fun ConnectionScene(modifier: Modifier = Modifier) {
    val connection = dsh().connection
    Canvas(modifier) {
        val horizon = size.height * 0.62f
        drawRect(
            brush = Brush.verticalGradient(colorStops = connection.sceneStops.toTypedArray()),
        )
        val firstHazeCenter = Offset(size.width * 0.16f, size.height * 0.18f)
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(connection.hazePrimary, Color.Transparent),
                center = firstHazeCenter,
                radius = size.width * 0.58f,
            ),
            radius = size.width * 0.58f,
            center = firstHazeCenter,
        )
        val secondHazeCenter = Offset(size.width * 0.86f, size.height * 0.20f)
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(connection.hazeSecondary, Color.Transparent),
                center = secondHazeCenter,
                radius = size.width * 0.52f,
            ),
            radius = size.width * 0.52f,
            center = secondHazeCenter,
        )
        if (connection.star.alpha > 0f) {
            ConnectionStars.forEachIndexed { index, (x, y) ->
                drawCircle(
                    color = connection.star.copy(alpha = connection.star.alpha * (0.72f + index % 3 * 0.12f)),
                    radius = (0.8f + index % 3 * 0.22f).dp.toPx(),
                    center = Offset(size.width * x, size.height * y),
                )
            }
        }
        drawRect(
            brush = Brush.radialGradient(
                colors = listOf(connection.seaLight, Color.Transparent),
                center = Offset(size.width * 0.5f, horizon),
                radius = size.width.coerceAtLeast(size.height * 0.46f),
            ),
            topLeft = Offset(0f, horizon),
        )
        drawLine(
            color = connection.hairline,
            start = Offset(0f, horizon),
            end = Offset(size.width, horizon),
            strokeWidth = 1.dp.toPx(),
        )
        ConnectionParticles.forEachIndexed { index, (x, y) ->
            drawCircle(
                color = connection.particle.copy(alpha = connection.particle.alpha * (1f - index * 0.12f)),
                radius = (0.75f + index * 0.12f).dp.toPx(),
                center = Offset(size.width * x, size.height * y),
            )
        }
    }
}

@Composable
private fun ConnectionBrand(compact: Boolean, supportingText: String?) {
    val connection = dsh().connection
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        WhaleMark(Modifier.size(if (compact) 34.dp else 42.dp))
        Spacer(Modifier.height(if (compact) 6.dp else 10.dp))
        Text(
            "Whale Isle",
            color = connection.ink,
            fontFamily = FontFamily.Serif,
            fontSize = if (compact) 30.sp else 38.sp,
            lineHeight = if (compact) 36.sp else 44.sp,
            fontWeight = FontWeight.Normal,
            letterSpacing = 0.4.sp,
        )
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(28.dp).height(1.dp).background(connection.hairline))
            Text(
                "鲸屿 · MOBILE",
                color = connection.muted,
                fontSize = 11.sp,
                lineHeight = 18.sp,
                letterSpacing = 1.6.sp,
                modifier = Modifier.padding(horizontal = 10.dp),
            )
            Box(Modifier.width(28.dp).height(1.dp).background(connection.hairline))
        }
        if (!supportingText.isNullOrEmpty() && !compact) {
            Spacer(Modifier.height(10.dp))
            Text(
                supportingText,
                color = connection.muted,
                fontSize = 13.sp,
                lineHeight = 20.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ConnectionLayout(
    supportingText: String?,
    dockContent: @Composable () -> Unit,
) {
    val connection = dsh().connection
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 540.dp
        val maxDockHeight = maxHeight * if (compact) 0.58f else 0.46f
        ConnectionScene(Modifier.fillMaxSize())
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier.weight(1f).fillMaxWidth(),
                contentAlignment = Alignment.Center,
            ) {
                ConnectionBrand(compact = compact, supportingText = supportingText)
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .widthIn(max = 440.dp)
                    .heightIn(max = maxDockHeight)
                    .shadow(
                        elevation = 16.dp,
                        shape = ConnectionDockShape,
                        clip = false,
                        ambientColor = connection.panelShadow,
                        spotColor = connection.panelShadow,
                    )
                    .clip(ConnectionDockShape)
                    .background(connection.panel)
                    .border(1.dp, connection.panelBorder, ConnectionDockShape),
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    content = { dockContent() },
                )
            }
        }
    }
}

@Composable
internal fun NavigationRecoveryBanner(
    waiting: Boolean,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = dsh()
    Column(
        modifier.fillMaxWidth().background(palette.bgLayer1)
            .verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            if (waiting) "正在重试返回" else "暂时无法返回，当前页面已保留",
            color = palette.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) {
                DshButton("重试返回", primary = true, enabled = !waiting, onClick = onRetry)
            }
            Box(Modifier.weight(1f)) {
                DshButton("继续使用", onClick = onDismiss)
            }
        }
    }
}

@Composable
fun DshRoot(
    vm: DshViewModel,
    onRequestScan: () -> Unit,
    onOpenAppSettings: () -> Unit,
) {
    val palette = dsh()
    Box(Modifier.fillMaxSize().background(palette.bgBase)) {
        when (vm.route) {
            Route.Connect -> ConnectScreen(
                vm = vm,
                onRequestScan = onRequestScan,
                pasteExpanded = vm.pasteExpanded,
                pasteFocusRequestId = vm.pasteFocusRequestId,
                onPasteExpandedChange = vm::updatePasteExpanded,
            )
            Route.Permission -> PermissionScreen(
                onUsePaste = vm::openPasteEntry,
                onOpenAppSettings = onOpenAppSettings,
            )
            Route.Scan, Route.Chat -> Unit
        }
    }
}

@Composable
private fun ConnectScreen(
    vm: DshViewModel,
    onRequestScan: () -> Unit,
    pasteExpanded: Boolean,
    pasteFocusRequestId: Long,
    onPasteExpandedChange: (Boolean) -> Unit,
) {
    val palette = dsh()
    val pasteFocusRequester = remember { FocusRequester() }
    LaunchedEffect(pasteFocusRequestId, pasteExpanded) {
        if (pasteExpanded && pasteFocusRequestId > 0L) pasteFocusRequester.requestFocus()
    }
    ConnectionLayout(
        supportingText = "扫一下，接着电脑上的工作。",
    ) {
        if (vm.error.isNotEmpty()) {
            Text(
                vm.error,
                color = palette.error,
                fontSize = 12.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(FieldShape)
                    .background(palette.error.copy(alpha = 0.08f))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
        for (computer in vm.computers.sortedByDescending { it.savedAt }) {
            SavedComputerRow(computer.computerName, onClick = { vm.reopenComputer(computer.serverId) })
        }
        ConnectionButton(
            label = "扫描二维码",
            primary = true,
            onClick = onRequestScan,
        )
        ConnectionButton(
            label = if (pasteExpanded) "收起粘贴输入" else "粘贴配对链接",
            onClick = { onPasteExpandedChange(!pasteExpanded) },
        )
        if (pasteExpanded) {
            ConnectionField(
                value = vm.paste,
                onValueChange = { vm.paste = it },
                placeholder = "粘贴含 #offer= 的完整链接",
                modifier = Modifier.focusRequester(pasteFocusRequester),
            )
            ConnectionButton(label = "连接", onClick = vm::connectFromPaste)
        }
        Text(
            "端到端加密，只连接你的电脑",
            color = palette.connection.muted,
            fontSize = 12.sp,
            lineHeight = 18.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun PermissionScreen(
    onUsePaste: () -> Unit,
    onOpenAppSettings: () -> Unit,
) {
    val palette = dsh()
    ConnectionLayout(supportingText = null) {
        Text(
            "相机权限",
            color = palette.connection.muted,
            fontSize = 12.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.2.sp,
        )
        Text(
            "让鲸屿看见二维码",
            color = palette.connection.ink,
            fontSize = 17.sp,
            lineHeight = 24.sp,
            fontWeight = FontWeight.Medium,
        )
        Text(
            "在系统设置里允许相机，或改用桌面复制的完整配对链接。",
            color = palette.connection.muted,
            fontSize = 13.sp,
            lineHeight = 20.sp,
        )
        ConnectionButton("去系统设置", primary = true, onClick = onOpenAppSettings)
        ConnectionButton("改用粘贴链接", onClick = onUsePaste)
    }
}

@Composable
private fun SavedComputerRow(name: String, onClick: () -> Unit) {
    val connection = dsh().connection
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(FieldShape)
            .border(1.dp, connection.panelBorder, FieldShape)
            .then(dshClickable(onClick = onClick))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).clip(Capsule).background(connection.mark))
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            Text(
                name,
                color = connection.ink,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                "继续连接并管理电脑",
                color = connection.muted,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )
        }
        Text("继续", color = connection.ink, fontSize = 12.sp, lineHeight = 18.sp)
    }
}

@Composable
private fun ConnectionButton(
    label: String,
    primary: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val connection = dsh().connection
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .then(dshClickable(enabled = enabled, onClick = onClick)),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 40.dp)
                .alpha(if (enabled) 1f else 0.45f)
                .clip(Capsule)
                .background(if (primary) connection.primary else Color.Transparent)
                .border(
                    width = 1.dp,
                    color = if (primary) connection.primary else connection.panelBorder,
                    shape = Capsule,
                )
                .padding(horizontal = 18.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label,
                color = if (primary) connection.primaryInk else connection.ink,
                fontSize = 14.sp,
                lineHeight = 22.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
@Composable
private fun ConnectionField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    val connection = dsh().connection
    Box(
        Modifier.fillMaxWidth().heightIn(min = 48.dp),
        contentAlignment = Alignment.Center,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                color = connection.ink,
                fontSize = 16.sp,
                lineHeight = 24.sp,
            ),
            cursorBrush = SolidColor(connection.ink),
            modifier = modifier
                .fillMaxWidth()
                .heightIn(min = 40.dp)
                .clip(FieldShape)
                .border(1.dp, connection.panelBorder, FieldShape),
            decorationBox = { field ->
                Box(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (value.isEmpty()) {
                        Text(
                            placeholder,
                            color = connection.muted,
                            fontSize = 16.sp,
                            lineHeight = 24.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    field()
                }
            },
        )
    }
}

@Composable
private fun DshButton(
    label: String,
    primary: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = dsh()
    // 40dp visual pill inside a ≥48dp touch target (mobile remote contract).
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .then(dshClickable(enabled = enabled, onClick = onClick)),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 40.dp)
                .alpha(if (enabled) 1f else 0.45f)
                .clip(Capsule)
                .background(if (primary) palette.buttonPrimaryFill else palette.bgLayer1)
                .border(1.dp, if (primary) palette.buttonPrimaryFill else palette.borderL2, Capsule)
                .padding(horizontal = 18.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                label,
                color = if (primary) palette.labelPrimaryForeground else palette.labelPrimary,
                fontSize = 14.sp,
                lineHeight = 22.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
