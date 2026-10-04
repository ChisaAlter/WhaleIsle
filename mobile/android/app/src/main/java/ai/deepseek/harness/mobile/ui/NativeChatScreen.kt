package ai.deepseek.harness.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.graphics.toArgb
import android.graphics.BitmapFactory
import android.widget.TextView
import io.noties.markwon.Markwon
import io.noties.markwon.linkify.LinkifyPlugin
import java.util.Base64
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.deepseek.harness.mobile.ui.theme.dsh

/** Compose owns both conversation state and navigation; all actions go to Kotlin. */
@Composable
internal fun NativeChatScreen(
    state: NativeChatState,
    onAction: (NativeChatAction) -> Unit,
    onWorkPage: () -> Unit,
    onAttachment: () -> Unit,
    onRemoveAttachment: (Int) -> Unit,
    onLeave: () -> Unit,
) {
    val colors = dsh()
    var sessionsOpen by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf("") }
    var selectedModel by remember { mutableStateOf<NativeModelOption?>(null) }
    val sessionId = state.sessionId
    val draft = state.draft
    val keyboard = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    val imeVisible = WindowInsets.ime.getBottom(density) > 0

    BackHandler {
        when {
            imeVisible -> keyboard?.hide()
            picker.isNotBlank() -> {
                if (selectedModel != null) selectedModel = null else picker = ""
            }
            sessionsOpen -> sessionsOpen = false
            else -> onLeave()
        }
    }

    Column(Modifier.fillMaxSize().background(colors.sidebarFill).imePadding()) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).background(colors.bgLayer1).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            NativeRoundButton("☰", "会话列表", { picker = ""; sessionsOpen = !sessionsOpen })
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (sessionsOpen) "会话" else state.title, color = colors.labelPrimary,
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
                if (!sessionsOpen && state.hostName.isNotBlank()) {
                    Text(state.hostName, color = colors.labelTertiary, fontSize = 12.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            NativeRoundButton("＋", "新会话", {
                sessionsOpen = false
                onAction(NativeChatAction("new"))
            })
        }

        if (sessionsOpen) {
            if (state.sessions.isEmpty()) {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Text(if (state.connected) "还没有会话" else "等待电脑连接…", color = colors.labelSecondary)
                }
            } else {
                LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
                    items(state.sessions, key = { it.id }) { session ->
                        Surface(
                            onClick = {
                                sessionsOpen = false
                                onAction(NativeChatAction("open", session.id))
                            },
                            shape = RoundedCornerShape(14.dp),
                            color = if (session.id == sessionId) colors.navActive else colors.bgLayer1,
                            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp).heightIn(min = 54.dp),
                        ) {
                            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (session.running) {
                                    Box(Modifier.size(7.dp).background(colors.success, CircleShape))
                                    Spacer(Modifier.width(10.dp))
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(session.title, fontSize = 15.sp, color = colors.labelPrimary,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (session.workspace.isNotBlank() || session.readOnly) {
                                        Text(if (session.readOnly) "只读 · ${session.workspace}" else session.workspace,
                                            fontSize = 12.sp, color = colors.labelTertiary, maxLines = 1,
                                            overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Surface(onClick = onWorkPage, color = colors.bgLayer1,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Text("工作区 · Git · 设置", fontSize = 13.sp, color = colors.labelSecondary)
                }
            }
        } else {
            if (state.banner.isNotBlank() || state.offline || state.error.isNotBlank()) {
                val message = state.error.ifBlank { state.banner.ifBlank { "连接已断开，草稿已保留" } }
                Row(Modifier.fillMaxWidth().background(colors.warnTertiary).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(message, Modifier.weight(1f), color = colors.labelPrimary, fontSize = 13.sp)
                    if (state.offline || state.error.isNotBlank()) {
                        Text("重试", Modifier.clickable {
                            onAction(NativeChatAction(if (state.error.isNotBlank() && sessionId.isNotBlank()) "retry" else "refresh", sessionId))
                        }.padding(8.dp), color = colors.buttonInfoFill, fontSize = 13.sp)
                    }
                }
            }
            val listState = remember(sessionId) { LazyListState() }
            var initialTimelineShown by remember(sessionId) { mutableStateOf(false) }
            LaunchedEffect(sessionId, state.loading, state.rows.size, state.rows.lastOrNull()?.text) {
                if (!state.olderLoading && state.rows.isNotEmpty()) {
                    val bottom = state.rows.lastIndex + if (state.hasOlder) 1 else 0
                    if (!initialTimelineShown && !state.loading) {
                        // A newly opened conversation starts at its latest answer.
                        listState.scrollToItem(bottom)
                        initialTimelineShown = true
                    } else if (initialTimelineShown &&
                        listState.firstVisibleItemIndex >= (state.rows.size - 5).coerceAtLeast(0)) {
                        // A streaming answer follows only while the reader is at the tail.
                        listState.scrollToItem(bottom)
                    }
                }
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.hasOlder) item(key = "older") {
                    Text(if (state.olderLoading) "正在加载…" else "加载更早消息",
                        Modifier.fillMaxWidth().clickable(enabled = !state.olderLoading) {
                            onAction(NativeChatAction("older", sessionId))
                        }.padding(14.dp), color = colors.labelSecondary, fontSize = 13.sp)
                }
                if (state.loading && state.rows.isEmpty()) item(key = "loading") {
                    Text("正在载入会话…", color = colors.labelSecondary, fontSize = 14.sp)
                }
                if (!state.loading && state.rows.isEmpty() && state.error.isEmpty()) item(key = "empty") {
                    Box(Modifier.fillMaxWidth().height(240.dp), contentAlignment = Alignment.Center) {
                        Text("从这里开始对话", fontSize = 17.sp, color = colors.labelSecondary)
                    }
                }
                items(state.rows, key = { it.id }) { row -> NativeMessage(row) }
            }

            val approval = state.approval
            if (picker.isNotBlank() && approval == null && state.readOnly.isBlank()) {
                Surface(shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
                    color = colors.bgLayer1, border = BorderStroke(1.dp, colors.borderL2),
                    modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (selectedModel != null) "思考强度" else if (picker == "model") "选择模型" else "权限",
                                Modifier.weight(1f), color = colors.labelPrimary, fontSize = 17.sp,
                                fontWeight = FontWeight.SemiBold)
                            NativeRoundButton("×", "关闭选择", { picker = ""; selectedModel = null })
                        }
                        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 350.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            val chosen = selectedModel
                            if (picker == "model" && chosen != null) {
                                items(chosen.efforts, key = { it.id }) { effort ->
                                    NativePickerRow(effort.label, effort.id == state.modelCurrentEffort) {
                                        onAction(NativeChatAction("model", sessionId, provider = chosen.provider,
                                            model = chosen.id, reasoningEffort = effort.id))
                                        picker = ""; selectedModel = null
                                    }
                                }
                            } else if (picker == "model") {
                                items(state.modelOptions, key = { "${it.provider}:${it.id}" }) { model ->
                                    NativePickerRow(model.label, model.provider == state.modelCurrentProvider &&
                                        model.id == state.modelCurrentId) {
                                        if (model.efforts.isNotEmpty()) selectedModel = model
                                        else {
                                            onAction(NativeChatAction("model", sessionId, provider = model.provider,
                                                model = model.id))
                                            picker = ""
                                        }
                                    }
                                }
                            } else {
                                items(state.permissionOptions, key = { it.id }) { option ->
                                    NativePickerRow(option.label, option.id == state.permissionCurrent) {
                                        onAction(NativeChatAction("permission", sessionId, id = option.id))
                                        picker = ""
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (approval != null) {
                Surface(shape = RoundedCornerShape(20.dp), color = colors.bgLayer1,
                    border = BorderStroke(1.dp, colors.borderL2),
                    modifier = Modifier.fillMaxWidth().padding(10.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(approval.title.ifBlank { "需要审批" }, fontWeight = FontWeight.SemiBold,
                            color = colors.labelPrimary)
                        if (approval.command.isNotBlank()) Text(approval.command, fontSize = 13.sp,
                            color = colors.labelSecondary, maxLines = 5, overflow = TextOverflow.Ellipsis)
                        if (approval.error.isNotBlank()) Text(approval.error, fontSize = 13.sp, color = colors.error)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            approval.actions.forEach { action ->
                                Surface(onClick = {
                                    onAction(NativeChatAction("approve", sessionId, approvalId = approval.id,
                                        actionId = action.id))
                                }, enabled = !state.busy && !state.offline, shape = RoundedCornerShape(16.dp), color = colors.navHover,
                                    modifier = Modifier.heightIn(min = 48.dp)) {
                                    Box(Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                                        Text(action.label, fontSize = 14.sp, color = colors.labelPrimary)
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (state.readOnly.isNotBlank()) {
                Text(state.readOnly, Modifier.fillMaxWidth().padding(16.dp),
                    color = colors.labelSecondary, fontSize = 13.sp)
            } else {
                Surface(shape = RoundedCornerShape(20.dp), color = colors.bgLayer1,
                    border = BorderStroke(1.dp, colors.borderL2),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp)
                        .shadow(2.dp, RoundedCornerShape(20.dp))) {
                    Column(Modifier.padding(start = 14.dp, end = 8.dp, top = 12.dp, bottom = 7.dp)) {
                        if (state.attachments.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            state.attachments.forEachIndexed { index, image ->
                                Column(Modifier.clickable { onRemoveAttachment(index) }) {
                                    NativeImagePreview(image, Modifier.size(64.dp))
                                    Text("移除", color = colors.labelSecondary, fontSize = 12.sp)
                                }
                            }
                        }
                        BasicTextField(
                            value = draft,
                            onValueChange = { value ->
                                if (sessionId.isNotBlank()) onAction(NativeChatAction("draft", sessionId, text = value))
                            },
                            enabled = sessionId.isNotBlank(),
                            textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.labelPrimary, fontSize = 16.sp,
                                lineHeight = 24.sp),
                            cursorBrush = SolidColor(colors.buttonInfoFill),
                            keyboardOptions = KeyboardOptions.Default,
                            minLines = 2,
                            maxLines = 6,
                            decorationBox = { inner ->
                                Box {
                                    if (draft.isEmpty()) Text("给电脑发送消息…", fontSize = 16.sp,
                                        color = colors.labelTertiary)
                                    inner()
                                }
                            },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp, max = 156.dp),
                        )
                        if (draft.startsWith('/') && !draft.contains(' ')) {
                            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 180.dp)) {
                                items(state.slashCommands.filter { "/${it.name}".startsWith(draft, true) }, key = { it.name }) { command ->
                                    NativePickerRow("/${command.name} ${command.hint} · ${command.description}", false) {
                                        onAction(NativeChatAction("draft", sessionId, text = "/${command.name} "))
                                    }
                                }
                            }
                        }
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Surface(onClick = { keyboard?.hide(); picker = "model" },
                                enabled = sessionId.isNotBlank() && state.modelOptions.isNotEmpty() && !state.offline,
                                shape = RoundedCornerShape(16.dp), color = colors.navHover,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                Box(Modifier.padding(horizontal = 10.dp), contentAlignment = Alignment.CenterStart) {
                                    Text(state.model.ifBlank { "选择模型" } + state.modelCurrentEffort.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty(), color = colors.labelSecondary,
                                        fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            if (state.planOn) NativeRoundButton("P", "关闭 Plan", {
                                onAction(NativeChatAction("planOff", sessionId))
                            })
                            NativeRoundButton("◇", "切换权限：${state.permission}", {
                                keyboard?.hide(); picker = "permission"
                            }, enabled = sessionId.isNotBlank() && state.permissionOptions.isNotEmpty() && !state.offline)
                            if (state.running) NativeRoundButton("■", "停止生成", {
                                onAction(NativeChatAction("cancel", sessionId))
                            }, filled = true)
                            NativeRoundButton("＋", "添加图片", onAttachment, enabled = sessionId.isNotBlank() && !state.busy)
                            NativeRoundButton("↑", "发送消息", {
                                onAction(NativeChatAction("send", sessionId, text = draft))
                            }, enabled = (draft.isNotBlank() || state.attachments.isNotEmpty()) && sessionId.isNotBlank() && !state.offline && !state.busy,
                                filled = true)
                        }
                    }
                }
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
private fun NativePickerRow(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = dsh()
    Surface(onClick = onClick, shape = RoundedCornerShape(14.dp),
        color = if (selected) colors.navActive else colors.bgModule,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Row(Modifier.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = colors.labelPrimary, fontSize = 14.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (selected) Text("✓", color = colors.buttonInfoFill)
        }
    }
}

@Composable
private fun NativeMessage(row: NativeRow) {
    val colors = dsh()
    val user = row.role == "user"
    val background = when {
        user -> colors.bubble
        row.role == "error" -> colors.warnTertiary
        else -> colors.bgLayer1
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
        if (row.role !in setOf("user", "assistant")) {
            Text(when (row.role) { "tool" -> "工具"; "error" -> "运行失败"; else -> "过程" },
                Modifier.padding(start = 8.dp, bottom = 3.dp), color = colors.labelTertiary, fontSize = 12.sp)
        }
        Surface(shape = RoundedCornerShape(16.dp), color = background,
            border = if (user) null else BorderStroke(1.dp, colors.borderHair)) {
            Column(Modifier.padding(horizontal = 13.dp, vertical = 10.dp)) {
                if (row.role == "assistant") NativeMarkdown(row.text, colors.labelPrimary.toArgb())
                else SelectionContainer { Text(row.text.ifBlank { if (row.running) "正在思考…" else " " },
                    color = colors.labelPrimary, fontSize = 15.sp, lineHeight = 22.sp) }
                row.images.forEach { NativeImagePreview(it, Modifier.fillMaxWidth().heightIn(max = 280.dp)) }
                if (row.detail.isNotBlank()) {
                    var expanded by remember(row.id) { mutableStateOf(false) }
                    Text(if (expanded) "收起详情" else "查看详情", Modifier.clickable { expanded = !expanded }.padding(vertical = 8.dp), color = colors.labelSecondary)
                    if (expanded) SelectionContainer { Text(row.detail, color = colors.labelSecondary, fontSize = 12.sp) }
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
        val options = BitmapFactory.Options().apply {
            inSampleSize = (maxOf(bounds.outWidth, bounds.outHeight) / 1024).coerceAtLeast(1)
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
    }.getOrNull() }
    if (bitmap != null) Image(bitmap, "图片附件", modifier)
    else Text("图片无法预览", color = dsh().labelSecondary)
}

@Composable
private fun NativeMarkdown(text: String, color: Int) {
    AndroidView(factory = { context -> TextView(context).apply {
        textSize = 15f; setTextIsSelectable(true)
        tag = Markwon.builder(context).usePlugin(LinkifyPlugin.create()).build()
    } }, update = { view -> view.setTextColor(color); (view.tag as Markwon).setMarkdown(view, text) })
}

@Composable
private fun NativeRoundButton(label: String, description: String, onClick: () -> Unit,
    enabled: Boolean = true, filled: Boolean = false) {
    val colors = dsh()
    Box(Modifier.size(48.dp).clickable(enabled = enabled, onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center) {
        Box(Modifier.size(32.dp).background(
            if (filled && enabled) colors.buttonPrimaryFill else colors.navHover, CircleShape),
            contentAlignment = Alignment.Center) {
            Text(label, fontSize = 18.sp, color = if (filled && enabled) colors.labelPrimaryForeground
                else if (enabled) colors.labelPrimary else colors.labelCaption)
        }
    }
}
