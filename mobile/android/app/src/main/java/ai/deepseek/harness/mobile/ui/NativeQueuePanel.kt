package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun NativeQueuePanel(
    queue: List<NativeQueuedMessage>,
    running: Boolean,
    available: Boolean,
    feedback: String = "",
    onAction: (kind: String, id: String, text: String) -> Unit,
) {
    if (queue.isEmpty()) return
    val colors = dsh()
    var expanded by rememberSaveable { mutableStateOf(false) }
    var editingId by rememberSaveable { mutableStateOf("") }
    var editedText by rememberSaveable { mutableStateOf("") }
    var draftOwner by rememberSaveable { mutableStateOf("") }
    var submitted by rememberSaveable { mutableStateOf(false) }
    val editing = queue.firstOrNull { it.id == editingId }
    LaunchedEffect(editingId, editing?.id) {
        if (editingId.isNotBlank() && editing == null) { editingId = ""; submitted = false }
    }
    LaunchedEffect(editing?.text, available, submitted) {
        // A failed or uncertain write keeps the editor and its text. Close only after server truth agrees.
        if (submitted && available && editing?.text == editedText) { editingId = ""; submitted = false }
    }

    Column(Modifier.fillMaxWidth()) {
        NativeChoiceRow(
            label = if (expanded) "收起待发送消息（${queue.size}）" else "待发送消息（${queue.size}）",
            onClick = { expanded = !expanded },
            glyph = NativeGlyph.Down,
        )
        if (expanded) Column(
            Modifier.fillMaxWidth().heightIn(max = 280.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            queue.forEach { item ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                        .background(colors.bgModule).padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        if (item.target == "next-step") "当前回复中的下一步" else "下一轮回复",
                        Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp,
                    )
                    Text(
                        item.text.ifBlank { if (item.hasAttachments) "附件消息" else "空消息" },
                        Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                        color = colors.labelPrimary, fontSize = 14.sp, lineHeight = 22.sp,
                        maxLines = 3, overflow = TextOverflow.Ellipsis,
                    )
                    if (item.hasAttachments) Text(
                        "含附件，无法只编辑文字。转入当前回复会带上附件。",
                        Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp,
                    )
                    Row(Modifier.fillMaxWidth()) {
                        Column(Modifier.weight(1f)) {
                            NativeChoiceRow("编辑", enabled = available && item.editable && !item.hasAttachments, onClick = {
                                if (available && item.editable && !item.hasAttachments) {
                                    editingId = item.id
                                    if (draftOwner != item.id) editedText = item.text
                                    draftOwner = item.id
                                    submitted = false
                                }
                            })
                        }
                        Column(Modifier.weight(1f)) {
                            NativeChoiceRow("删除", danger = true, enabled = available, onClick = {
                                if (available) onAction("remove", item.id, "")
                            })
                        }
                    }
                    if (item.target == "next-turn" && running) NativeChoiceRow(
                        "发送到当前回复", enabled = available, onClick = {
                            if (available && running) onAction("steer", item.id, "")
                        },
                    )
                }
            }
        }
    }
    if (editing != null) {
        val canEdit = available && editing.editable && !editing.hasAttachments
        val focusRequester = remember(editing.id) { FocusRequester() }
        val keyboard = LocalSoftwareKeyboardController.current
        NativeDialog(
            title = "编辑待发送消息",
            onDismiss = { editingId = ""; submitted = false },
            feedback = feedback,
            actions = {
                NativePill("保存修改", primary = true, enabled = canEdit && editedText.isNotBlank(), onClick = {
                    if (canEdit && editedText.isNotBlank()) {
                        submitted = true
                        onAction("edit", editing.id, editedText)
                    }
                })
            },
        ) {
            LaunchedEffect(editing.id) {
                focusRequester.requestFocus()
                keyboard?.show()
            }
            Text("消息内容", color = colors.labelSecondary, fontSize = 12.sp, lineHeight = 18.sp)
            BasicTextField(
                value = editedText,
                onValueChange = { editedText = it; submitted = false },
                enabled = canEdit,
                minLines = 3,
                maxLines = 8,
                textStyle = TextStyle(color = colors.labelPrimary, fontSize = 16.sp, lineHeight = 24.sp),
                cursorBrush = SolidColor(colors.buttonInfoFill),
                modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp).focusRequester(focusRequester)
                    .clip(RoundedCornerShape(8.dp)).background(colors.bgBase)
                    .border(1.dp, colors.borderL2, RoundedCornerShape(8.dp)).padding(12.dp)
                    .semantics { contentDescription = "待发送消息内容" },
            )
            if (!available) Text("连接或同步恢复后可保存。", color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
            if (!editing.editable || editing.hasAttachments) Text("该消息含非文本内容，无法编辑。", color = colors.labelTertiary, fontSize = 12.sp, lineHeight = 18.sp)
        }
    }
}
