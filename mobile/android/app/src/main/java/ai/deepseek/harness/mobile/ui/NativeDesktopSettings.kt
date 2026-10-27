package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
internal fun NativeComputerSettings(controller: NativeDesktopController, available: Boolean) {
    val state = controller.state
    var query by rememberSaveable { mutableStateOf("") }
    var selectedField by remember { mutableStateOf<NativeSettingField?>(null) }
    var credentials by remember { mutableStateOf(false) }
    val descriptor = state.detail
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (descriptor.string("ns").isBlank()) {
            item { DesktopNote("修改当前电脑的配置，其他客户端会使用相同配置。隐藏值只显示已配置状态；保存时校验读取的版本。") }
            item { NativeField(query, { query = it }, "搜索设置与供应商") }
            item { DesktopButton("供应商 API 凭据", available) { credentials = true } }
            val namespaces = state.data.objects("namespaces").filter { query.isBlank() || (it.string("ns") + nativeSettingTitle(nativeSettingSchema(it["schema"].objectValue())) + nativeSettingFields(it).joinToString { f -> f.label }).contains(query, true) }
            if (state.loaded && namespaces.isEmpty()) item { DesktopNote("没有匹配的电脑设置") }
            items(namespaces, key = { it.string("ns") }) { row ->
                NativeChoiceRow(nativeSettingTitle(nativeSettingSchema(row["schema"].objectValue())).ifBlank { row.string("ns") }, detail = row.string("ns"), onClick = { controller.showNamespace(row) })
            }
        } else {
            item { Text(nativeSettingTitle(nativeSettingSchema(descriptor["schema"].objectValue())).ifBlank { descriptor.string("ns") }, color = dsh().labelPrimary, fontSize = 16.sp) }
            if (descriptor["applies"].text().isNotBlank()) item { DesktopNote("生效方式：" + descriptor["applies"].text()) }
            val fields = nativeSettingFields(descriptor)
            if (fields.isEmpty()) item { DesktopNote("此配置没有可编辑字段。") }
            items(fields, key = { it.path.joinToString("/") }) { field ->
                val secretInfo = descriptor.objects("secrets").firstOrNull { it["path"].arrayValue().map { p -> p.text() } == field.path }
                val summary = if (field.secret) if (secretInfo?.get("set").flag()) "已配置；只能输入新值" else "未配置" else when (val value = field.value) { null, JsonNull -> "未设置"; is JsonPrimitive -> value.content; else -> if (value is JsonArray) "${value.size} 项" else "编辑配置项" }
                NativeChoiceRow(field.label, detail = summary.take(160), enabled = available && state.data["writable"].flag(), onClick = { selectedField = field })
                if (field.description.isNotBlank()) DesktopNote(field.description)
            }
        }
        item { Spacer(Modifier.height(88.dp)) }
    }
    selectedField?.let { field -> NativeSettingEditor(controller, descriptor, field, available && state.data["writable"].flag()) { selectedField = null } }
    if (credentials) NativeCredentialEditor(controller, available) { credentials = false }
}

@Composable
private fun NativeSettingEditor(controller: NativeDesktopController, descriptor: JsonObject, field: NativeSettingField, available: Boolean, close: () -> Unit) {
    var text by remember(field.path) { mutableStateOf(if (field.secret) "" else if (field.value is JsonPrimitive) field.value.content else field.value?.toString().orEmpty()) }
    var localError by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }
    val state = controller.state
    LaunchedEffect(state.notice, state.busy) { if (submitted && !state.busy && state.error.isBlank() && state.notice == "修改已保存") close() }
    val enums = nativeSettingChoices(field.schema)
    NativeDialog(field.label, close, actions = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = close) { Text("取消") }
            TextButton(enabled = available && (!field.secret || text.isNotBlank()), onClick = {
                try { val value = nativeSettingValue(field, text); localError = ""; submitted = true; controller.saveSetting(descriptor, field, value) }
                catch (failure: Exception) { localError = failure.message ?: "输入无效" }
            }) { Text(if (state.busy) "正在保存…" else "保存") }
        }
    }, feedback = localError.ifBlank { state.error }, feedbackHint = "保存后应用到当前电脑；版本冲突时请返回刷新后重新编辑。") {
        if (field.description.isNotBlank()) DesktopNote(field.description)
        when {
            field.secret -> NativeSecretField(text, { text = it }, "新值（留空不修改）", available)
            field.schema.string("type") == "boolean" -> DesktopToggle(field.label, text == "true", available) { text = it.toString() }
            enums.isNotEmpty() -> enums.forEach { value -> NativeChoiceRow(value.text(), selected = text == value.text(), enabled = available, onClick = { text = value.text() }) }
            else -> NativeField(text, { text = it }, field.label, available, if (field.schema.string("type") in setOf("object", "array") || text.contains('\n')) 6 else 1)
        }
    }
}

@Composable
private fun NativeCredentialEditor(controller: NativeDesktopController, available: Boolean, close: () -> Unit) {
    var ref by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    var removing by remember { mutableStateOf(false) }
    val state = controller.state
    val info = state.detail["credential"].objectValue()[ref].objectValue()
    LaunchedEffect(state.notice) { if (state.notice == "凭据已保存") value = "" }
    NativeDialog("供应商 API 凭据", close, feedback = state.error, feedbackHint = "凭据只写入电脑的正规凭据库，不读回、不保存在手机。凭据名应与供应商配置中的引用一致。") {
        NativeField(ref, { ref = it }, "凭据引用名称（例如 DEEPSEEK_API_KEY）", available)
        DesktopButton("查看配置状态", available && ref.isNotBlank()) { controller.describeCredential(ref.trim()) }
        if (info.isNotEmpty()) DesktopNote((if (info["configured"].flag()) "已配置" else "未配置") + " · " + info.string("source") + if (info["writable"].flag()) " · 可修改" else " · 只读")
        NativeSecretField(value, { value = it }, "新 API 密钥", available)
        DesktopButton("保存新密钥", available && ref.isNotBlank() && value.isNotBlank() && info["writable"]?.flag() != false) { controller.credential(ref.trim(), value) }
        DesktopButton("移除凭据", available && info["configured"].flag() && info["writable"].flag()) { removing = true }
        if (state.notice.isNotBlank()) DesktopNote(state.notice)
    }
    if (removing) DesktopConfirm("移除 API 凭据？", "使用 $ref 的模型请求可能失败；不会删除会话。", available, { removing = false }) { controller.credential(ref.trim(), null, true); removing = false }
}

@Composable
internal fun NativeSecretField(value: String, onChange: (String) -> Unit, label: String, enabled: Boolean) {
    OutlinedTextField(value, onChange, Modifier.fillMaxWidth(), enabled = enabled, label = { Text(label, fontSize = 12.sp) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp, color = dsh().labelPrimary))
}

@Composable
internal fun NativeAccountPanel(controller: NativeDesktopController, available: Boolean, openUrl: (String) -> Unit) {
    val state = controller.state
    val view = state.data["view"].objectValue()
    val signedIn = view.string("status") == "credential-stored"
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { DesktopNote("当前电脑的 DeepSeek 账户") }
        if (!state.loaded && !state.busy) item { DesktopNote("账户尚未读取；请刷新。") }
        if (state.loaded && !signedIn) item { DesktopButton("登录账户", available) { controller.startSignIn(openUrl) } }
        val attempt = view["attempt"].objectValue()
        if (attempt.isNotEmpty() && attempt.string("phase") in setOf("initializing", "waiting-browser", "exchanging", "committing")) {
            item { DesktopNote("登录进行中：" + attempt.string("phase")) }
            item { DesktopButton("取消登录", available) { controller.cancelSignIn(attempt.string("id")) } }
        }
        if (signedIn) {
            val profile = state.data["profile"].objectValue()
            item { Text(profile["value"].objectValue().string("name").ifBlank { "已登录" }, color = dsh().labelPrimary, fontSize = 16.sp) }
            item { DesktopNote(profile["value"].objectValue().string("contact")) }
            if (profile.string("status") != "ready") item { DesktopNote("账户资料读取失败，可以刷新重试。") }
            val balance = state.data["balance"].objectValue()
            if (balance.string("status") == "ready") {
                item { DesktopNote("充值余额") }
                items(balance.objects("value")) { wallet -> Text(wallet.string("balance") + " " + wallet.string("currency"), color = dsh().labelPrimary, fontSize = 16.sp) }
                if (balance.objects("bonusWallets").isNotEmpty()) item { DesktopNote("赠送余额") }
                items(balance.objects("bonusWallets")) { wallet -> Text(wallet.string("balance") + " " + wallet.string("currency"), color = dsh().labelPrimary, fontSize = 14.sp) }
            } else item { DesktopNote("余额读取失败，可以刷新重试。") }
            val bonuses = state.data["bonuses"].objectValue()
            items(bonuses.objects("bonuses"), key = { it.string("orderId") }) { bonus ->
                Text(bonus.string("title"), color = dsh().labelPrimary, fontSize = 14.sp)
                SelectionContainer { DesktopNote(bonus.string("message")) }
                DesktopButton("已阅读", available) { controller.acknowledgeBonus(bonuses.string("accountId"), bonus.string("orderId")) }
            }
            item { DesktopButton("退出电脑账户", available) { controller.checkSignOut() } }
        }
        val links = view["links"].objectValue()
        if (links.string("usageUrl").isNotBlank()) item { DesktopButton("打开完整账户用量", available) { openUrl(links.string("usageUrl")) } }
        if (links.string("topUpUrl").isNotBlank()) item { DesktopButton("充值", available) { openUrl(links.string("topUpUrl")) } }
        item { Spacer(Modifier.height(88.dp)) }
    }
    if (state.detail["signOut"].flag()) DesktopConfirm("退出电脑账户？", if (state.detail["running"].flag()) "当前有使用此账户的任务正在运行，退出可能使后续请求失败。会话和独立 API 密钥会保留。" else "移除电脑的账户授权，保留会话与独立 API 密钥。", available, controller::dismissDetail, controller::signOut)
}
