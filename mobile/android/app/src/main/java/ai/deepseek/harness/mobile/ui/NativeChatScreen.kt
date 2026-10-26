package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.ui.theme.dsh
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.widget.TextView
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.linkify.LinkifyPlugin
import java.util.Base64
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

/** Compose owns conversation state; opening a short modal never unmounts the chat. */
@Composable
internal fun NativeChatScreen(
    state: NativeChatState,
    workspaces: List<NativeWorkspace>,
    onAction: (NativeChatAction) -> Unit,
    onPanel: (String) -> Unit,
    onWorkspaceMenu: (NativeWorkspace) -> Unit,
    onSessionMenu: (NativeSession) -> Unit,
    onAttachment: () -> Unit,
    onRemoveAttachment: (Int) -> Unit,
    onLeave: () -> Unit,
    showConnectionNotice: Boolean = true,
) {
    val colors = dsh()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var picker by remember { mutableStateOf("") }
    var selectedModel by remember { mutableStateOf<NativeModelOption?>(null) }
    var modelQuery by rememberSaveable { mutableStateOf("") }
    val sessionId = state.sessionId
    val keyboard = LocalSoftwareKeyboardController.current
    val imeVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    fun closeDrawer(action: () -> Unit) { scope.launch { drawer.close(); action() } }
    fun openPicker(value: String) { keyboard?.hide(); selectedModel = null; modelQuery = ""; picker = value }

    BackHandler {
        when {
            imeVisible -> keyboard?.hide()
            picker.isNotBlank() -> if (selectedModel != null) selectedModel = null else picker = ""
            drawer.isOpen -> scope.launch { drawer.close() }
            else -> onLeave()
        }
    }
    LaunchedEffect(sessionId, state.approval?.id, state.readOnly) {
        picker = ""; selectedModel = null
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(colors.bgBase)) {
        val narrow = maxWidth < 360.dp || state.running && state.planOn && maxWidth < 440.dp
        val compactHeight = maxHeight < 480.dp
        val editLineHeight = with(LocalDensity.current) { 24.sp.toDp() }
        val tightIme = imeVisible && maxHeight < 160.dp + editLineHeight
        ModalNavigationDrawer(
            drawerState = drawer,
            gesturesEnabled = drawer.isOpen,
            scrimColor = colors.mask,
            drawerContent = {
                ModalDrawerSheet(
                    modifier = Modifier.width(minOf(340.dp, maxWidth * 0.90f)).fillMaxHeight(),
                    drawerShape = RectangleShape,
                    drawerContainerColor = colors.sidebarFill,
                    drawerContentColor = colors.labelPrimary,
                    drawerTonalElevation = 0.dp,
                    windowInsets = WindowInsets(0, 0, 0, 0),
                ) {
                    NativeSidebar(state, workspaces,
                        onClose = { scope.launch { drawer.close() } },
                        onNew = { closeDrawer { onPanel("new") } },
                        onSearch = { closeDrawer { onPanel("sessions") } },
                        onWork = { closeDrawer { onPanel("work") } },
                        onSettings = { closeDrawer { onPanel("settings") } },
                        onOpen = { row -> closeDrawer { onAction(NativeChatAction("open", row.id)) } },
                        onSessionMenu = { row -> closeDrawer { onSessionMenu(row) } },
                        onWorkspaceMenu = { ws -> closeDrawer { onWorkspaceMenu(ws) } })
                }
            },
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().heightIn(min = if (tightIme) 48.dp else 52.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    NativeIconButton(NativeGlyph.Panel, "展开侧栏", { keyboard?.hide(); scope.launch { drawer.open() } }, avatar = true)
                    Column(Modifier.weight(1f).padding(4.dp)) {
                        Text(state.title, color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp,
                            fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (!tightIme && state.hostName.isNotBlank()) Text(state.hostName, color = colors.labelTertiary,
                            fontSize = 12.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    NativeIconButton(NativeGlyph.More, "会话与工作区操作", { keyboard?.hide(); onPanel("work") })
                    NativeIconButton(NativeGlyph.Plus, "新会话", { keyboard?.hide(); onPanel("new") }, enabled = !state.offline)
                }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    // This is the height left after the actual, font-scaled header and IME insets.
                    val controlsHeight = if (compactHeight) maxHeight else maxHeight * 0.65f
                    Column(Modifier.fillMaxSize()) {
                        Box(Modifier.weight(1f).fillMaxWidth()) {
                            NativeTimeline(state, onAction, compactHeight)
                            if (showConnectionNotice && picker.isBlank()) NativeConnectionNotice(state, onAction, Modifier.align(Alignment.TopCenter))
                        }
                        when {
                            state.approval != null -> NativeApprovalCard(state, onAction, compactHeight, controlsHeight)
                            state.readOnly.isNotBlank() -> Text(state.readOnly, Modifier.fillMaxWidth().heightIn(max = controlsHeight)
                                .verticalScroll(rememberScrollState()).padding(16.dp), color = colors.labelSecondary, fontSize = 13.sp, lineHeight = 20.sp)
                            else -> NativeComposer(state, onAction, onAttachment, onRemoveAttachment,
                                onModel = { openPicker("model") }, onPermission = { openPicker("permission") }, onTools = { openPicker("tools") },
                                narrow = narrow, compactHeight = compactHeight, maxHeight = controlsHeight, tightHeight = tightIme)
                        }
                    }
                }
            }
        }
    }
    if (picker.isNotBlank()) {
        val chosen = selectedModel
        NativeDialog(if (chosen != null) "思考强度" else if (picker == "model") "选择模型" else if (picker == "tools") "输入选项" else "权限",
            onDismiss = { picker = ""; selectedModel = null },
            onBack = if (chosen == null) null else ({ selectedModel = null })) {
            if (picker == "model" && chosen != null) {
                Text(chosen.label, Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
                chosen.efforts.forEach { effort ->
                    NativeChoiceRow(effort.label, selected = chosen.provider == state.modelCurrentProvider && chosen.id == state.modelCurrentId && effort.id == state.modelCurrentEffort,
                        enabled = !state.busy && !state.offline && !state.loading, onClick = {
                            onAction(NativeChatAction("model", sessionId, provider = chosen.provider, model = chosen.id, reasoningEffort = effort.id))
                            picker = ""; selectedModel = null
                        })
                }
            } else if (picker == "model") {
                NativeField(modelQuery, { modelQuery = it }, "搜索模型")
                val matches = state.modelOptions.filter { modelQuery.isBlank() || it.label.contains(modelQuery, true) || it.id.contains(modelQuery, true) || it.provider.contains(modelQuery, true) }
                if (matches.isEmpty()) Text("没有匹配的模型", Modifier.padding(12.dp), color = colors.labelSecondary, fontSize = 14.sp, lineHeight = 22.sp)
                matches.groupBy { it.provider }.forEach { (provider, models) ->
                    Text(provider, Modifier.padding(horizontal = 12.dp, vertical = 8.dp), color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
                    models.forEach { model ->
                        NativeChoiceRow(model.label, selected = model.provider == state.modelCurrentProvider && model.id == state.modelCurrentId,
                            enabled = !state.busy && !state.offline && !state.loading, onClick = {
                                if (model.efforts.isNotEmpty()) { keyboard?.hide(); selectedModel = model }
                                else { onAction(NativeChatAction("model", sessionId, provider = model.provider, model = model.id)); picker = "" }
                            })
                    }
                }
            } else {
                if (picker == "tools" && state.planOn) NativeChoiceRow("关闭 Plan", enabled = !state.busy && !state.offline && !state.loading, onClick = { onAction(NativeChatAction("planOff", sessionId)); picker = "" })
                if (picker == "tools") Text("权限", Modifier.padding(12.dp), color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
                state.permissionOptions.forEach { option ->
                    NativeChoiceRow(option.label, selected = option.id == state.permissionCurrent, enabled = !state.busy && !state.offline && !state.loading, glyph = NativeGlyph.Shield, onClick = {
                        onAction(NativeChatAction("permission", sessionId, id = option.id)); picker = ""
                    })
                }
                if (state.permissionOptions.isEmpty()) Text("权限选项尚未载入", Modifier.padding(12.dp), color = colors.labelSecondary, fontSize = 14.sp, lineHeight = 22.sp)
            }
        }
    }
}

@Composable
private fun NativeSidebar(state: NativeChatState, workspaces: List<NativeWorkspace>, onClose: () -> Unit,
    onNew: () -> Unit, onSearch: () -> Unit, onWork: () -> Unit, onSettings: () -> Unit,
    onOpen: (NativeSession) -> Unit, onSessionMenu: (NativeSession) -> Unit, onWorkspaceMenu: (NativeWorkspace) -> Unit) {
    val colors = dsh()
    var collapsed by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val groups = nativeSessionGroups(workspaces, state.sessions)
    Column(Modifier.fillMaxSize().drawSidebarEdge(colors.borderHair)) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            WhaleWordmark(Modifier.weight(1f))
            NativeIconButton(NativeGlyph.Panel, "收起侧栏", onClose)
        }
        Box(Modifier.padding(horizontal = 12.dp)) {
            NativePill("新会话", onNew, primary = true, glyph = NativeGlyph.Plus, enabled = !state.offline)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { NativeChoiceRow("搜索会话", onSearch, glyph = NativeGlyph.Search) }
            NativeIconButton(NativeGlyph.Folder, "工作区管理", onWork)
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
            groups.forEach { group ->
                item(key = "group:${group.id}") {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                            .clickable(role = Role.Button) { collapsed = if (group.id in collapsed) collapsed - group.id else collapsed + group.id }
                            .padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            NativeIcon(if (group.id in collapsed) NativeGlyph.Folder else NativeGlyph.Down, tint = colors.labelTertiary)
                            Text(group.title, color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        group.workspace?.let { ws -> NativeIconButton(NativeGlyph.More, "管理${group.title}", { onWorkspaceMenu(ws) }) }
                    }
                }
                if (group.id !in collapsed) {
                    if (group.sessions.isEmpty()) item(key = "empty:${group.id}") {
                        Text("还没有会话", Modifier.padding(start = 32.dp, bottom = 12.dp), color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
                    }
                    items(group.sessions, key = { "session:${it.id}" }) { row ->
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (row.id == state.sessionId) colors.navActive else Color.Transparent), verticalAlignment = Alignment.CenterVertically) {
                            Row(Modifier.weight(1f).heightIn(min = 48.dp).clickable(role = Role.Button) { onOpen(row) }
                                .padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (row.running || row.id == state.sessionId && state.approval != null) Box(Modifier.size(6.dp).background(if (row.id == state.sessionId && state.approval != null) colors.warn else colors.success, CircleShape))
                                Text(row.title, color = colors.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            NativeIconButton(NativeGlyph.More, "管理会话${row.title}", { onSessionMenu(row) })
                        }
                    }
                }
            }
            if (groups.isEmpty()) item { Text(if (state.connected) "还没有会话，开始一次新对话" else "正在同步电脑上的会话…", Modifier.padding(12.dp), color = colors.labelSecondary, fontSize = 14.sp, lineHeight = 22.sp) }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.borderHair))
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onSettings).padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(32.dp).background(colors.navHover, CircleShape), contentAlignment = Alignment.Center) {
                    Text(state.hostName.ifBlank { "电脑" }.take(1), color = colors.labelPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                }
                Column(Modifier.weight(1f)) {
                    Text(state.hostName.ifBlank { "我的电脑" }, color = colors.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (state.offline) "连接已断开 · 设置" else "已连接 · 设置", color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
                }
            }
            NativeIconButton(NativeGlyph.More, "电脑与外观设置", onSettings)
        }
    }
}

private fun Modifier.drawSidebarEdge(color: Color): Modifier = this.then(Modifier.drawBehind {
    drawLine(color, androidx.compose.ui.geometry.Offset(size.width - 0.5.dp.toPx(), 0f), androidx.compose.ui.geometry.Offset(size.width - 0.5.dp.toPx(), size.height), 1.dp.toPx())
})

@Composable
internal fun NativePill(label: String, onClick: () -> Unit, primary: Boolean = false, glyph: NativeGlyph? = null, enabled: Boolean = true) {
    val colors = dsh()
    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
        Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).clip(RoundedCornerShape(18.dp))
            .background(if (primary) colors.buttonPrimaryFill else colors.navHover).padding(horizontal = 14.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val ink = if (!enabled) colors.labelCaption else if (primary) colors.labelPrimaryForeground else colors.labelPrimary
            if (glyph != null) NativeIcon(glyph, tint = ink)
            Text(label, Modifier.weight(1f), color = ink, fontSize = 14.sp, lineHeight = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun NativeTimeline(state: NativeChatState, onAction: (NativeChatAction) -> Unit, compactHeight: Boolean) {
    val colors = dsh()
    val list = rememberSaveable(state.sessionId, saver = LazyListState.Saver) { LazyListState() }
    var initialShown by rememberSaveable(state.sessionId) { mutableStateOf(false) }
    var followTail by rememberSaveable(state.sessionId) { mutableStateOf(true) }
    var lastSize by remember(state.sessionId) { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    var viewportSize by remember(state.sessionId) { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    LaunchedEffect(list) {
        list.interactionSource.interactions.collect { interaction ->
            if (interaction is DragInteraction.Start) followTail = false
        }
    }
    LaunchedEffect(list) {
        snapshotFlow { !list.isScrollInProgress && !list.canScrollForward && list.layoutInfo.visibleItemsInfo.isNotEmpty() }
            .collect { atBottom -> if (atBottom) followTail = true }
    }
    LaunchedEffect(state.sessionId, state.loading, state.olderLoading, state.rows.size, state.rows.lastOrNull()?.id,
        state.rows.lastOrNull()?.text, state.rows.lastOrNull()?.detail, lastSize, viewportSize, followTail) {
        if (!state.olderLoading && !state.loading && state.rows.isNotEmpty() && (!initialShown || followTail)) {
            // A tiny final item is a real end anchor, even when the last message is taller than the viewport.
            val bottom = state.rows.size + if (state.hasOlder) 1 else 0
            list.scrollToItem(bottom)
            initialShown = true
        }
    }
    LazyColumn(state = list, modifier = Modifier.fillMaxSize().onSizeChanged { viewportSize = it },
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (state.hasOlder) item(key = "older") {
            NativeChoiceRow(if (state.olderLoading) "正在加载…" else "加载更早消息", enabled = !state.olderLoading, onClick = { onAction(NativeChatAction("older", state.sessionId)) })
        }
        if (state.loading && state.rows.isEmpty()) item(key = "loading") { Text("正在载入会话…", color = colors.labelSecondary, fontSize = 14.sp, lineHeight = 22.sp) }
        if (!state.loading && state.rows.isEmpty() && state.error.isEmpty()) item(key = "empty") {
            Column(Modifier.fillMaxWidth().heightIn(min = if (compactHeight) 88.dp else 220.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                if (!compactHeight) { WhaleAvatar(Modifier.size(64.dp)); Spacer(Modifier.height(16.dp)) }
                Text("探索未至之鲸", fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold, color = colors.labelPrimary)
                if (!compactHeight) Text(if (state.sessionId.isBlank()) "选择工作区，开始新会话" else "接着电脑上的工作", color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
            }
        }
        items(state.rows, key = { it.id }) { row ->
            Box(if (row.id == state.rows.lastOrNull()?.id) Modifier.onSizeChanged { lastSize = it } else Modifier) { NativeMessage(row) }
        }
        if (state.rows.isNotEmpty()) item(key = "tail") { Spacer(Modifier.height(1.dp)) }
    }
}

@Composable
private fun NativeConnectionNotice(state: NativeChatState, onAction: (NativeChatAction) -> Unit, modifier: Modifier) {
    val colors = dsh()
    val message = state.error.ifBlank { state.banner.ifBlank { if (state.offline) state.connLabel.ifBlank { "连接已断开，草稿已保留" } else "" } }
    var dismissed by remember(message) { mutableStateOf(false) }
    LaunchedEffect(message) { if (message.isNotBlank() && !state.offline) { delay(if (state.error.isBlank()) 4_000 else 6_000); dismissed = true } }
    if (message.isNotBlank() && !dismissed) Surface(modifier.padding(horizontal = 12.dp, vertical = 4.dp), shape = RoundedCornerShape(12.dp), color = colors.bgLayer2,
        border = BorderStroke(1.dp, colors.borderL2), shadowElevation = 4.dp) {
        Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, Modifier.weight(1f), color = colors.labelPrimary, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (state.offline || state.error.isNotBlank()) TextButton(onClick = { onAction(NativeChatAction(if (state.error.isNotBlank() && state.sessionId.isNotBlank()) "retry" else "refresh", state.sessionId)) }) { Text("重试", fontSize = 12.sp) }
        }
    }
}

@Composable
private fun NativeComposer(state: NativeChatState, onAction: (NativeChatAction) -> Unit, onAttachment: () -> Unit, onRemoveAttachment: (Int) -> Unit,
    onModel: () -> Unit, onPermission: () -> Unit, onTools: () -> Unit, narrow: Boolean, compactHeight: Boolean, maxHeight: Dp, tightHeight: Boolean) {
    val colors = dsh()
    val editLineHeight = with(LocalDensity.current) { 24.sp.toDp() }
    val editableHeight = (maxHeight - 48.dp - if (tightHeight) 0.dp else if (compactHeight) 16.dp else 28.dp).coerceAtLeast(0.dp)
    val draft = state.draft
    val sessionId = state.sessionId
    var fieldValue by rememberSaveable(state.epoch, sessionId, stateSaver = TextFieldValue.Saver) { mutableStateOf(TextFieldValue(draft, TextRange(draft.length))) }
    LaunchedEffect(draft) { if (fieldValue.text != draft) fieldValue = TextFieldValue(draft, TextRange(draft.length)) }
    val editable = sessionId.isNotBlank() && !state.loading
    val available = editable && !state.offline && !state.busy
    val modelLabel = state.modelOptions.find { it.provider == state.modelCurrentProvider && it.id == state.modelCurrentId }?.label ?: state.model.ifBlank { if (state.loading) "正在同步模型…" else "选择模型" }
    val effortLabel = state.modelOptions.find { it.provider == state.modelCurrentProvider && it.id == state.modelCurrentId }?.efforts?.find { it.id == state.modelCurrentEffort }?.label ?: state.modelCurrentEffort
    var slashDismissed by remember(draft) { mutableStateOf(false) }
    val commands = if (editable && !slashDismissed && draft.startsWith('/') && !draft.contains(' ')) state.slashCommands.filter { "/${it.name}".startsWith(draft, true) } else emptyList()
    Box(Modifier.fillMaxWidth()) {
    if (commands.isNotEmpty()) Box(Modifier.align(Alignment.TopCenter)) {
        Popup(onDismissRequest = { slashDismissed = true },
            popupPositionProvider = ComposerPopupPosition(), properties = PopupProperties(focusable = false)) {
            Surface(Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(horizontal = 12.dp), shape = RoundedCornerShape(12.dp), color = colors.bgLayer2,
                border = BorderStroke(1.dp, colors.borderL2), shadowElevation = 8.dp) {
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = if (compactHeight) 96.dp else 192.dp)) {
                    items(commands, key = { it.name }) { command -> NativeChoiceRow("/${command.name} ${command.hint}", detail = command.description, enabled = editable, onClick = { onAction(NativeChatAction("draft", sessionId, text = "/${command.name} ")) }) }
                }
            }
        }
    }
    Surface(shape = RoundedCornerShape(22.dp), color = colors.inputMajor, border = BorderStroke(1.dp, colors.borderL2),
        modifier = Modifier.fillMaxWidth().heightIn(max = maxHeight)
            .padding(start = 12.dp, end = 12.dp, top = if (tightHeight) 0.dp else 4.dp, bottom = if (tightHeight) 0.dp else if (compactHeight) 4.dp else 8.dp)) {
        Column(Modifier.padding(start = 12.dp, end = 4.dp, top = if (tightHeight) 0.dp else if (compactHeight) 4.dp else 12.dp, bottom = if (tightHeight) 0.dp else 4.dp)) {
            Column(Modifier.weight(1f, fill = false).fillMaxWidth()
                .heightIn(min = minOf(editLineHeight, editableHeight)).verticalScroll(rememberScrollState())) {
                if (state.attachments.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                    items(state.attachments.size) { index ->
                        Column(Modifier.heightIn(min = 48.dp).clickable(enabled = editable && !state.busy, role = Role.Button, onClickLabel = "移除图片附件") { onRemoveAttachment(index) }) {
                            NativeImagePreview(state.attachments[index], Modifier.size(if (compactHeight) 40.dp else 56.dp).clip(RoundedCornerShape(8.dp)))
                            Text("移除", color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
                        }
                    }
                }
                BasicTextField(value = fieldValue, onValueChange = { if (editable) { fieldValue = it; if (it.text != draft) onAction(NativeChatAction("draft", sessionId, text = it.text)) } }, enabled = editable,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp), cursorBrush = SolidColor(colors.buttonInfoFill),
                    keyboardOptions = KeyboardOptions.Default, minLines = if (compactHeight) 1 else 2, maxLines = if (compactHeight) 3 else 6,
                    decorationBox = { inner -> Box { if (draft.isEmpty()) Text(if (sessionId.isBlank()) "新建会话后开始对话…" else "给电脑发送消息…", fontSize = 16.sp, lineHeight = 24.sp, color = colors.labelTertiary); inner() } },
                    modifier = Modifier.fillMaxWidth().heightIn(min = if (compactHeight) 24.dp else 48.dp).padding(end = 12.dp).semantics { contentDescription = "消息" })
            }

            @Composable fun modelControl(modifier: Modifier) {
                Row(modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(14.dp)).clickable(enabled = available && state.modelOptions.isNotEmpty(), role = Role.Button, onClick = onModel).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(modelLabel + if (effortLabel.isBlank()) "" else " · $effortLabel", Modifier.weight(1f), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    NativeIcon(NativeGlyph.Down, tint = colors.labelTertiary)
                }
            }
            @Composable fun RowScope.actions() {
                NativeIconButton(NativeGlyph.Plus, "添加图片", onAttachment, enabled = editable && !state.busy)
                if (state.planOn) Text("Plan", Modifier.widthIn(min = 48.dp).heightIn(min = 48.dp).clickable(enabled = available) { onAction(NativeChatAction("planOff", sessionId)) }.wrapContentHeight().padding(horizontal = 8.dp), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
                Spacer(Modifier.weight(1f))
                NativeIconButton(NativeGlyph.Shield, "切换权限：${state.permission}", onPermission, enabled = available && state.permissionOptions.isNotEmpty())
                if (state.running) NativeIconButton(NativeGlyph.Stop, "停止生成", { onAction(NativeChatAction("cancel", sessionId)) }, enabled = available, primary = true)
                NativeIconButton(NativeGlyph.Send, if (state.running) "排队发送消息" else "发送消息", { onAction(NativeChatAction("send", sessionId, text = draft)) }, enabled = available && (draft.isNotBlank() || state.attachments.isNotEmpty()), primary = true)
            }
            if (compactHeight) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    NativeIconButton(NativeGlyph.Plus, "添加图片", onAttachment, enabled = editable && !state.busy)
                    modelControl(Modifier.weight(1f))
                    NativeIconButton(NativeGlyph.More, "权限与 Plan 选项", onTools, enabled = available)
                    if (state.running) NativeIconButton(NativeGlyph.Stop, "停止生成", { onAction(NativeChatAction("cancel", sessionId)) }, enabled = available, primary = true)
                    NativeIconButton(NativeGlyph.Send, if (state.running) "排队发送消息" else "发送消息", { onAction(NativeChatAction("send", sessionId, text = draft)) }, enabled = available && (draft.isNotBlank() || state.attachments.isNotEmpty()), primary = true)
                }
            } else if (narrow) {
                modelControl(Modifier.fillMaxWidth().padding(end = 12.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { actions() }
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    NativeIconButton(NativeGlyph.Plus, "添加图片", onAttachment, enabled = editable && !state.busy)
                    modelControl(Modifier.weight(1f))
                    if (state.planOn) Text("Plan", Modifier.widthIn(min = 48.dp).heightIn(min = 48.dp).clickable(enabled = available) { onAction(NativeChatAction("planOff", sessionId)) }.wrapContentHeight().padding(horizontal = 8.dp), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
                    NativeIconButton(NativeGlyph.Shield, "切换权限：${state.permission}", onPermission, enabled = available && state.permissionOptions.isNotEmpty())
                    if (state.running) NativeIconButton(NativeGlyph.Stop, "停止生成", { onAction(NativeChatAction("cancel", sessionId)) }, enabled = available, primary = true)
                    NativeIconButton(NativeGlyph.Send, if (state.running) "排队发送消息" else "发送消息", { onAction(NativeChatAction("send", sessionId, text = draft)) }, enabled = available && (draft.isNotBlank() || state.attachments.isNotEmpty()), primary = true)
                }
            }
        }
    }
    }
}

private class ComposerPopupPosition : androidx.compose.ui.window.PopupPositionProvider {
    override fun calculatePosition(anchorBounds: androidx.compose.ui.unit.IntRect, windowSize: androidx.compose.ui.unit.IntSize,
        layoutDirection: androidx.compose.ui.unit.LayoutDirection, popupContentSize: androidx.compose.ui.unit.IntSize): androidx.compose.ui.unit.IntOffset =
        androidx.compose.ui.unit.IntOffset(((windowSize.width - popupContentSize.width) / 2).coerceAtLeast(0),
            (anchorBounds.top - popupContentSize.height).coerceAtLeast(0))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NativeApprovalCard(state: NativeChatState, onAction: (NativeChatAction) -> Unit, compactHeight: Boolean, maxHeight: Dp) {
    val approval = state.approval ?: return
    val colors = dsh()
    Surface(shape = RoundedCornerShape(22.dp), color = colors.inputMajor, border = BorderStroke(1.dp, colors.borderL2),
        modifier = Modifier.fillMaxWidth().heightIn(max = maxHeight)
            .padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = if (compactHeight) 4.dp else 8.dp)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = if (compactHeight) 4.dp else 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Column(Modifier.weight(1f, fill = false).heightIn(max = if (compactHeight) 96.dp else 208.dp)
                .verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(approval.title.ifBlank { "需要审批" }, fontWeight = FontWeight.SemiBold, color = colors.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp)
                if (approval.command.isNotBlank()) SelectionContainer { Text(approval.command, color = colors.labelSecondary, fontSize = 13.sp, lineHeight = 20.sp) }
                if (approval.error.isNotBlank()) Text(approval.error, color = colors.error, fontSize = 13.sp, lineHeight = 20.sp)
            }
            @Composable fun approvalAction(action: NativeApprovalAction) {
                TextButton(onClick = { onAction(NativeChatAction("approve", state.sessionId, approvalId = approval.id, actionId = action.id)) },
                    enabled = !state.busy && !state.offline && !state.loading && approval.rpcId.isNotBlank(), modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(action.label, fontSize = 14.sp, lineHeight = 22.sp)
                }
            }
            if (compactHeight) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(approval.actions, key = { it.id }) { action -> approvalAction(action) }
            } else FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                approval.actions.forEach { action -> approvalAction(action) }
            }
        }
    }
}

/** Typed native UI commands; the client owns authorization and the request lifetime. */
internal data class NativeChatAction(
    val type: String,
    val sessionId: String = "",
    val text: String = "",
    val approvalId: String = "",
    val actionId: String = "",
    val provider: String = "",
    val model: String = "",
    val reasoningEffort: String = "",
    val id: String = "",
    val line: String = "",
)

@Composable
private fun NativeMessage(row: NativeRow) {
    val colors = dsh()
    val user = row.role == "user"
    val background = when { user -> colors.bubble; row.role == "error" -> colors.warnTertiary; else -> Color.Transparent }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
        if (row.role !in setOf("user", "assistant")) Text(when (row.role) { "tool" -> "工具"; "error" -> "运行失败"; else -> "过程" }, Modifier.padding(start = 8.dp, bottom = 4.dp), color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
        Surface(shape = RoundedCornerShape(12.dp), color = background) {
            Column(Modifier.padding(horizontal = if (user) 12.dp else 0.dp, vertical = if (user) 10.dp else 4.dp)) {
                if (row.role == "assistant") NativeMarkdown(row.text)
                else SelectionContainer { Text(row.text.ifBlank { if (row.running) "正在思考…" else " " }, color = colors.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp) }
                row.images.forEach { NativeImagePreview(it, Modifier.fillMaxWidth().heightIn(max = 280.dp)) }
                if (row.detail.isNotBlank()) {
                    var expanded by remember(row.id) { mutableStateOf(false) }
                    Text(if (expanded) "收起详情" else "查看详情", Modifier.clickable { expanded = !expanded }.padding(vertical = 8.dp), color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
                    if (expanded) SelectionContainer { Text(row.detail, color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp) }
                }
            }
        }
    }
}

@Composable
internal fun NativeImagePreview(image: NativeImage, modifier: Modifier) {
    val bitmap = remember(image.data) { runCatching {
        val bytes = Base64.getDecoder().decode(image.data)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val options = BitmapFactory.Options().apply { inSampleSize = (maxOf(bounds.outWidth, bounds.outHeight) / 1024).coerceAtLeast(1) }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
    }.getOrNull() }
    if (bitmap != null) Image(bitmap, "图片附件", modifier) else Text(image.error.ifBlank { "图片无法预览" }, color = dsh().labelSecondary)
}

@Composable
private fun NativeMarkdown(text: String) {
    val colors = dsh()
    val context = LocalContext.current
    val lineHeight = with(LocalDensity.current) { 22.sp.toPx() }
    val markdown = remember(context, colors) {
        Markwon.builder(context).usePlugin(LinkifyPlugin.create())
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder.linkColor(colors.buttonInfoFill.toArgb())
                        .codeTextColor(colors.labelPrimary.toArgb())
                        .codeBlockTextColor(colors.labelPrimary.toArgb())
                        .codeBackgroundColor(colors.bgModule.toArgb())
                        .codeBlockBackgroundColor(colors.bgModule.toArgb())
                        .codeTypeface(Typeface.MONOSPACE)
                        .codeBlockTypeface(Typeface.MONOSPACE)
                        .blockQuoteColor(colors.labelTertiary.toArgb())
                        .headingBreakColor(colors.borderL2.toArgb())
                        .thematicBreakColor(colors.borderL2.toArgb())
                }
            }).build()
    }
    AndroidView(factory = { viewContext -> TextView(viewContext).apply {
        textSize = 14f; includeFontPadding = false; setTextIsSelectable(true)
    } }, update = { view ->
        view.setTextColor(colors.labelPrimary.toArgb())
        view.setLinkTextColor(colors.buttonInfoFill.toArgb())
        view.setLineSpacing((lineHeight - view.paint.fontSpacing).coerceAtLeast(0f), 1f)
        markdown.setMarkdown(view, text)
    })
}
