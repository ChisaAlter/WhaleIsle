package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.DshViewModel
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
internal fun NativeDesktopScreen(vm: DshViewModel) {
    val controller = vm.desktop
    val state = controller.state
    val colors = dsh()
    val keyboard = LocalSoftwareKeyboardController.current
    val ime = WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current) > 0
    val available = !state.busy && !vm.chat.offline && !vm.chat.loading
    val title = when (state.section) { "files" -> "文件"; "diff" -> "更改"; "mcp" -> "MCP 服务器"; "skills" -> "技能"; "plugins" -> "插件"; "settings" -> "电脑设置与供应商"; "account" -> "账户"; else -> "电脑功能" }
    fun back() { if (ime) keyboard?.hide() else if (state.detail.isNotEmpty()) controller.dismissDetail() else vm.panel = "" }
    BackHandler(onBack = ::back)
    Column(Modifier.fillMaxSize().background(colors.bgBase)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
            NativeIconButton(NativeGlyph.Back, "返回", ::back)
            Text(title, Modifier.weight(1f), fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold, color = colors.labelPrimary)
            if (state.busy) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) }
            else TextButton(onClick = controller::refresh, enabled = available) { Text("刷新") }
        }
        HorizontalDivider(color = colors.borderHair)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            Column(Modifier.fillMaxSize()) {
                if (vm.chat.offline || vm.chat.loading) DesktopNote(if (vm.chat.offline) "连接已断开，内容已保留；恢复连接后可继续。" else "正在同步电脑，请稍候…")
                when (state.section) {
                    "files" -> NativeFilesPanel(controller, available)
                    "diff" -> NativeDiffPanel(controller, available)
                    "mcp" -> NativeMcpPanel(controller, available)
                    "skills" -> NativeSkillsPanel(controller, available)
                    "plugins" -> NativePluginsPanel(controller, available)
                    "settings" -> NativeComputerSettings(controller, available)
                    "account" -> NativeAccountPanel(controller, available, vm::openExternal)
                }
            }
            if (state.error.isNotBlank() || state.notice.isNotBlank()) {
                val clipboard = LocalClipboardManager.current
                Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(12.dp), color = colors.bgLayer2,
                    border = BorderStroke(1.dp, colors.borderL2), shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp), shadowElevation = 4.dp) {
                    Column(Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState()).padding(12.dp)) {
                        SelectionContainer { Text(state.error.ifBlank { state.notice }, color = if (state.error.isBlank()) colors.labelPrimary else colors.error, fontSize = 12.sp, lineHeight = 18.sp) }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { clipboard.setText(AnnotatedString(state.error.ifBlank { state.notice })) }) { Text("复制") }
                            TextButton(onClick = controller::clearFeedback) { Text("收起") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NativeFilesPanel(controller: NativeDesktopController, available: Boolean) {
    val state = controller.state
    val detail = state.detail
    var gallery by remember { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (detail.isEmpty()) {
            item { DesktopNote(state.path.ifBlank { "工作区根目录" }) }
            if (state.path.isNotBlank()) item { NativeChoiceRow("上一级", enabled = available, glyph = NativeGlyph.Back, onClick = { controller.listFiles(nativeParentPath(state.path)) }) }
            if (state.data["truncated"].flag()) item { DesktopNote("目录项达到电脑端上限；此处仅显示返回的条目。") }
            val entries = state.data.objects("entries").sortedWith(compareBy<JsonObject> { it.string("type") != "directory" }.thenBy { it.string("name").lowercase() })
            if (state.loaded && entries.isEmpty()) item { DesktopNote("此目录为空") }
            items(entries, key = { it.string("name") }) { entry ->
                val directory = entry.string("type") == "directory"
                NativeChoiceRow(entry.string("name"), enabled = available && entry.string("type") in setOf("directory", "file"),
                    detail = if (directory) "文件夹" else nativeFileSize(entry["size"].number()), glyph = if (directory) NativeGlyph.Folder else null,
                    onClick = { val path = nativeRelativeChild(state.path, entry.string("name")); if (directory) controller.listFiles(path) else controller.readFile(path) })
            }
        } else {
            item { SelectionContainer { DesktopNote(detail.string("path")) } }
            if (detail["image"].flag()) item {
                val image = NativeImage(detail.string("mediaType"), detail.string("data"))
                NativeImagePreview(image, Modifier.fillMaxWidth().heightIn(max = 440.dp).clickable { gallery = true })
                TextButton(onClick = { gallery = true }) { Text("展开图片") }
                DesktopNote(nativeFileSize(detail["bytes"].number()) + " · 图片预览上限 2 MB")
            } else {
                val offset = detail["offset"].number() ?: state.offset.toLong()
                val lines = detail["lines"].number() ?: 0
                item { DesktopNote(if (lines == 0L) "空文件或已到文件末尾" else "第 $offset–${offset + lines - 1} 行 · ${nativeFileSize(detail["bytes"].number())}") }
                item { SelectionContainer { Text(detail.string("text"), Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), fontFamily = FontFamily.Monospace, color = dsh().labelPrimary, fontSize = 13.sp, lineHeight = 20.sp, softWrap = false) } }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(enabled = available && offset > 1, onClick = { controller.readFile(detail.string("path"), (offset - 200).toInt().coerceAtLeast(1)) }) { Text("上一页") }
                        OutlinedButton(enabled = available && !detail["eof"].flag() && lines > 0, onClick = { controller.readFile(detail.string("path"), (offset + lines).toInt()) }) { Text("下一页") }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }
    if (gallery) NativeImageLightbox(listOf(NativeImage(detail.string("mediaType"), detail.string("data"))), 0, { gallery = false })
}

@Composable
private fun NativeDiffPanel(controller: NativeDesktopController, available: Boolean) {
    val state = controller.state
    var base by rememberSaveable { mutableStateOf(state.baseRef) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.detail.isEmpty()) {
            item { NativeField(base, { base = it }, "对比引用（留空查看未提交更改）", available) }
            item { DesktopButton("查看更改", available) { controller.diff(base) } }
            if (state.data["truncated"].flag()) item { DesktopNote("电脑端差异达到输出上限，内容不完整。") }
            val files = state.data.objects("files")
            if (state.loaded && files.isEmpty()) item { DesktopNote("此范围没有文件更改") }
            items(files, key = { it.string("path") }) { file -> NativeChoiceRow(file.string("path"), detail = file.string("status"), onClick = { controller.showDiff(file) }) }
        } else {
            item { SelectionContainer { DesktopNote(state.detail.string("path")) } }
            val hunks = state.detail.objects("hunks")
            if (hunks.isEmpty()) item { DesktopNote("此文件没有可显示的文本差异，可能为二进制文件或超出预览上限。") }
            hunks.forEachIndexed { index, hunk ->
                item(key = "hunk:$index") {
                    Column(Modifier.horizontalScroll(rememberScrollState())) {
                        Text(hunk.string("header"), color = dsh().labelTertiary, fontFamily = FontFamily.Monospace, fontSize = 12.sp, softWrap = false)
                        SelectionContainer {
                            Column {
                                hunk.objects("lines").forEach { line ->
                                    val kind = line.string("kind")
                                    val prefix = when (kind) { "add" -> "+"; "del" -> "−"; else -> " " }
                                    Text(prefix + line.string("text"), color = when (kind) { "add" -> dsh().success; "del" -> dsh().error; else -> dsh().labelPrimary }, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp, softWrap = false)
                                }
                            }
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }
}

@Composable
internal fun DesktopNote(text: String) { Text(text, Modifier.fillMaxWidth().padding(vertical = 4.dp), color = dsh().labelTertiary, fontSize = 12.sp, lineHeight = 18.sp) }
@Composable
internal fun DesktopButton(label: String, enabled: Boolean, onClick: () -> Unit) { OutlinedButton(onClick, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) { Text(label, fontSize = 14.sp) } }
@Composable
internal fun DesktopToggle(label: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = dsh().labelPrimary, fontSize = 14.sp, lineHeight = 22.sp)
        Switch(checked, onChange, enabled = enabled)
    }
}
