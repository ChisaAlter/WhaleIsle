package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.remote.*
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.util.TimeZone
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

private class NativeDesktopOwner(val identity: String) : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<NativeDesktopOwner>
}

/** Native consumers of the existing authenticated Host/Git endpoints. No secrets are persisted here. */
internal class NativeDesktopController(
    private val scope: CoroutineScope,
    private val owner: () -> String,
    private val sessionId: () -> String,
    private val cwd: () -> String,
    host: suspend (String, JsonObject) -> JsonElement,
    git: suspend (String, JsonObject) -> JsonElement,
    private val accountConnection: (() -> suspend (String, JsonObject) -> JsonElement)? = null,
) {
    var state by mutableStateOf(NativeDesktopState())
        private set
    private var revision = 0L
    private var login: NativeAccountLogin? = null
    private var loginJob: Job? = null
    private var loginAttemptId = ""
    fun pendingLoginAttempt() = loginAttemptId
    private var appVersion = ""
    var installRequestId by mutableStateOf("")
        private set
    var installUncertain by mutableStateOf(false)
        private set
    var uncertainInstallRequestId by mutableStateOf("")
        private set
    private val host: suspend (String, JsonObject) -> JsonElement = { method, payload ->
        val identity = currentCoroutineContext()[NativeDesktopOwner]?.identity
        check(identity == null || identity == owner()) { "电脑或会话已切换，请重新打开" }
        host(method, payload).also { check(identity == null || identity == owner()) { "电脑或会话已切换，请重新打开" } }
    }
    private val git: suspend (String, JsonObject) -> JsonElement = { method, payload ->
        val identity = currentCoroutineContext()[NativeDesktopOwner]?.identity
        check(identity == null || identity == owner()) { "电脑或会话已切换，请重新打开" }
        git(method, payload).also { check(identity == null || identity == owner()) { "电脑或会话已切换，请重新打开" } }
    }
    fun setAppVersion(version: String) { appVersion = version }
    private fun clientMetadata() = obj("version" to appVersion, "locale" to "zh", "timezoneOffsetSeconds" to TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 1000)
    private fun skillScope() = obj("cwd" to cwd()).let { if (sessionId().isBlank()) it else JsonObject(it + ("sessionId" to JsonPrimitive(sessionId()))) }
    private fun args(vararg values: Pair<String, Any?>) = obj("args" to obj(*values))
    private fun fileArgs(path: String, vararg values: Pair<String, Any?>) = args("workspaceFileScopeId" to sessionId(), "path" to path.ifBlank { "." }, *values)
    fun reset() { revision++; loginJob?.cancel(); loginJob = null; login?.close(); login = null; loginAttemptId = ""; installRequestId = ""; installUncertain = false; uncertainInstallRequestId = ""; state = NativeDesktopState() }
    fun open(section: String) { revision++; state = NativeDesktopState(section = section); refresh() }
    fun dismissDetail() { revision++; state = state.copy(detail = obj(), busy = false, error = "", notice = "") }
    fun clearFeedback() { state = state.copy(error = "", notice = "") }

    private fun run(work: suspend () -> NativeDesktopState) {
        if (state.busy) return
        val request = ++revision
        val identity = owner()
        state = state.copy(busy = true, error = "", notice = "")
        scope.launch(NativeDesktopOwner(identity)) {
            try {
                val result = work()
                if (request == revision && owner() == identity) state = result.copy(busy = false, loaded = true, error = "")
            } catch (failure: Throwable) {
                if (failure is CancellationException && failure !is TimeoutCancellationException) throw failure
                if (request == revision && owner() == identity) state = state.copy(error = failure.message ?: "电脑没有响应")
            } finally { if (request == revision) state = state.copy(busy = false) }
        }
    }
    private suspend fun readSection(): JsonObject = when (state.section) {
        "files" -> host("workspaceFiles.list", fileArgs(state.path)).objectValue()
        "diff" -> {
            val value = git("git-diff", obj("options" to if (state.baseRef.isBlank()) obj() else obj("baseRef" to state.baseRef)))
            require(value is JsonObject && value["files"] is JsonArray) { "无法读取差异，请确认工作目录已登记为 Git 仓库，且对比引用有效。" }
            value
        }
        "mcp" -> host("mcpServers.list", args()).objectValue()
        "skills" -> host("skillInventory.list", args("request" to skillScope())).objectValue()
        "plugins" -> {
            val inventory = host("pluginInventory.list", args()).objectValue()
            if (inventory["managementAvailable"].flag()) obj("inventory" to inventory, "plugins" to host("pluginManager.listPlugins", args()), "bundles" to host("pluginManager.listBundles", args()))
            else obj("inventory" to inventory, "plugins" to inventory["entries"], "bundles" to emptyList<JsonObject>())
        }
        "settings" -> host("settings.describe", args()).objectValue()
        "account" -> readAccount()
        else -> error("未知的电脑功能")
    }
    fun refresh() = run { state.copy(data = readSection()) }
    fun listFiles(path: String) { if (!state.busy) { state = state.copy(path = path, detail = obj(), loaded = false); refresh() } }
    fun diff(baseRef: String) { if (!state.busy) { state = state.copy(baseRef = baseRef.trim(), detail = obj(), loaded = false); refresh() } }
    fun readFile(path: String, offset: Int = 1) = run {
        require(sessionId().isNotBlank()) { "先打开有工作目录的会话" }
        val image = path.substringAfterLast('.', "").lowercase() in setOf("png", "jpg", "jpeg", "gif", "webp", "bmp")
        val page = if (image) host("workspaceFiles.readImage", fileArgs(path)).objectValue()
            else host("workspaceFiles.read", fileArgs(path, "range" to obj("offset" to offset, "limit" to 200))).objectValue()
        state.copy(detail = JsonObject(page + obj("path" to path, "image" to image)), offset = offset)
    }
    fun showDiff(file: JsonObject) { state = state.copy(detail = file) }
    fun showNamespace(ns: JsonObject) { state = state.copy(detail = ns) }
    fun showMcp(server: JsonObject) { state = state.copy(detail = server) }
    fun loadSkill(name: String) = run { state.copy(detail = host("skillInventory.get", args("request" to JsonObject(skillScope() + ("name" to JsonPrimitive(name))))).objectValue()) }

    private fun mutate(method: String, payload: JsonObject, keepDetail: Boolean = false) = run {
        val value = host(method, payload)
        val notice = when {
            method.startsWith("pluginManager.") -> nativePluginResult(value.objectValue())
            method == "mcpServers.test" -> value.toString()
            else -> "修改已保存"
        }
        state.copy(data = readSection(), detail = if (keepDetail) state.detail else obj(), notice = notice)
    }
    fun mcpAction(method: String, id: String, enabled: Boolean? = null) = mutate("mcpServers.$method", args("request" to if (enabled == null) obj("id" to id) else obj("id" to id, "enabled" to enabled)))
    fun saveMcp(spec: JsonObject) = mutate("mcpServers.upsert", args("request" to obj("spec" to spec)))
    fun skillInvocation(skill: JsonObject, model: Boolean, user: Boolean) = mutate("skillInventory.setInvocation", args("request" to JsonObject(skillScope() + obj("name" to skill.string("name"), "modelInvocable" to model, "userInvocable" to user))))
    fun saveSkill(skill: JsonObject, create: Boolean) = mutate(if (create) "skillInventory.create" else "skillInventory.update", args("request" to JsonObject(skillScope() + skill)))
    fun deleteSkill(name: String) = mutate("skillInventory.delete", args("request" to JsonObject(skillScope() + ("name" to JsonPrimitive(name)))))
    fun pluginEnabled(id: String, enabled: Boolean) = mutate("pluginManager.setPluginEnabled", args("id" to id, "enabled" to enabled))
    fun bundleEnabled(name: String, enabled: Boolean) = mutate("pluginManager.setBundleEnabled", args("name" to name, "enabled" to enabled))
    fun removeBundle(name: String) = mutate("pluginManager.removeBundle", args("name" to name))
    fun inspectPlugin(spec: String) = run { state.copy(detail = obj("inspection" to host("pluginManager.inspect", args("spec" to spec.trim())), "spec" to spec.trim())) }
    fun installPlugin(spec: String, approvedBuilds: List<String> = emptyList()) {
        if (state.busy || installRequestId.isNotBlank() || installUncertain) return
        val requestId = java.util.UUID.randomUUID().toString()
        val identity = owner()
        installRequestId = requestId
        run {
            try {
                val result = host("pluginManager.installBundle", args("spec" to spec, "options" to obj("requestId" to requestId, "enabled" to true, "saveExact" to true, "approvedBuilds" to approvedBuilds))).objectValue()
                state.copy(data = readSection(), detail = obj("installation" to result, "spec" to spec), notice = nativePluginResult(result))
            } catch (failure: Throwable) {
                if (installRequestId == requestId) { installUncertain = true; uncertainInstallRequestId = requestId }
                throw IllegalStateException("安装结果未确认。请先刷新核对电脑的插件状态；不会自动重复安装。", failure)
            } finally {
                if (installRequestId == requestId) {
                    if (owner() != identity) { installUncertain = true; uncertainInstallRequestId = requestId }
                    installRequestId = ""
                }
            }
        }
    }
    fun cancelInstall() {
        val id = installRequestId.ifBlank { uncertainInstallRequestId }.takeIf { it.isNotBlank() } ?: return
        val identity = owner()
        scope.launch(NativeDesktopOwner(identity)) {
            try {
                val result = host("pluginManager.cancelInstall", args("requestId" to id)).objectValue()
                if (owner() == identity) state = state.copy(notice = when (result.string("status")) { "cancelled" -> "已取消安装，配置已恢复"; "too-late" -> "安装已进入应用阶段，请等待结果"; else -> "电脑上没有对应的进行中安装，请刷新核对" })
            } catch (failure: Exception) {
                currentCoroutineContext().ensureActive()
                if (owner() == identity) state = state.copy(error = failure.message ?: "取消安装失败")
            }
        }
    }
    fun recoverInstall() {
        val id = uncertainInstallRequestId.takeIf { it.isNotBlank() } ?: return
        run {
            val result = host("pluginManager.waitForInstall", args("requestId" to id))
            if (result is JsonObject) {
                installUncertain = false; uncertainInstallRequestId = ""
                state.copy(data = readSection(), detail = obj("installation" to result), notice = nativePluginResult(result))
            } else {
                installUncertain = false; uncertainInstallRequestId = ""
                state.copy(data = readSection(), notice = "电脑未保留这次安装的进行中结果。未确认成功，请核对插件清单后再决定是否重新安装。")
            }
        }
    }
    fun saveSetting(descriptor: JsonObject, field: NativeSettingField, value: JsonElement) = run {
        val revision = descriptor["revision"].number() ?: error("设置缺少版本，请刷新后再保存")
        val result = host("settings.mutate", args("ns" to descriptor.string("ns"), "expectedRevision" to revision,
            "ops" to listOf(obj("op" to "set", "path" to field.path, "value" to value)))).objectValue()
        val data = state.data
        val namespaces = data.objects("namespaces").map { if (it.string("ns") == result.string("ns")) result else it }
        state.copy(data = JsonObject(data + ("namespaces" to JsonArray(namespaces))), detail = result, notice = "修改已保存")
    }
    fun credential(ref: String, value: String?, remove: Boolean = false) = run {
        require(Regex("^[A-Za-z_][A-Za-z0-9_]*$").matches(ref)) { "凭据名称只能包含字母、数字和下划线，且不能以数字开头" }
        host(if (remove) "credentials.unset" else "credentials.set", if (remove) args("ref" to ref) else args("ref" to ref, "value" to value.orEmpty()))
        val info = host("credentials.describe", args("refs" to listOf(ref))).objectValue()
        state.copy(detail = JsonObject(state.detail + ("credential" to info)), notice = if (remove) "凭据已移除" else "凭据已保存")
    }
    fun describeCredential(ref: String) = run {
        val info = host("credentials.describe", args("refs" to listOf(ref))).objectValue()
        state.copy(detail = JsonObject(state.detail + ("credential" to info)))
    }
    private suspend fun readAccount(): JsonObject {
        val view = host("account.getState", args()).objectValue()
        if (view.string("status") != "credential-stored") return obj("view" to view)
        suspend fun query(method: String): JsonElement = try { host(method, args("client" to clientMetadata())) }
        catch (failure: Exception) { currentCoroutineContext().ensureActive(); obj("status" to "failed", "error" to (failure.message ?: "读取失败")) }
        return obj("view" to view, "profile" to query("account.getProfile"), "balance" to query("account.getBalance"), "bonuses" to query("account.getUnnotifiedBonuses"))
    }
    fun checkSignOut() = run { state.copy(detail = obj("signOut" to true, "running" to host("account.hasRunningAccountTasks", args()))) }
    fun signOut() = mutate("account.signOut", args("client" to clientMetadata()))
    fun cancelSignIn(attemptId: String) {
        loginJob?.cancel(); loginJob = null; login?.close(); login = null; loginAttemptId = ""
        mutate("account.cancelSignIn", args("attemptId" to attemptId))
    }
    fun startSignIn(openUrl: (String) -> Unit) {
        val phase = state.data["view"].objectValue()["attempt"].objectValue().string("phase")
        if (state.busy || loginJob?.isActive == true || phase in setOf("initializing", "waiting-browser", "exchanging", "committing")) return
        run {
        val identity = owner()
        val request = revision
        val connection = accountConnection?.invoke() ?: host
        loginJob?.cancel(); login?.close()
        val callback = withContext(Dispatchers.IO) { NativeAccountLogin() }
        try {
            check(owner() == identity && revision == request) { "电脑或会话已切换，请重新登录" }
            login = callback
            var view = connection("account.startSignIn", args("client" to clientMetadata(), "callbackOrigin" to callback.origin, "loginSource" to "web")).objectValue()
            val staleAttempt = view["attempt"].objectValue().string("id")
            if (owner() != identity || revision != request) {
                if (staleAttempt.isNotBlank()) try { connection("account.cancelSignIn", args("attemptId" to staleAttempt)) } catch (_: Exception) { /* The initiating transport may already be closed. */ }
                error("电脑或会话已切换，请重新登录")
            }
            val attemptId = view["attempt"].objectValue().string("id")
            require(attemptId.isNotBlank()) { "账户服务未返回登录身份" }
            loginAttemptId = attemptId
            loginJob = scope.launch(NativeDesktopOwner(identity)) {
                try {
                    suspend fun ownedAccount(method: String, payload: JsonObject): JsonElement {
                        check(owner() == identity) { "电脑或会话已切换，请重新登录" }
                        return connection(method, payload).also { check(owner() == identity) { "电脑或会话已切换，请重新登录" } }
                    }
                    val callbackJob = async {
                        callback.awaitCallback { code, token ->
                            val current = ownedAccount("account.getState", args()).objectValue()["attempt"].objectValue()
                            require(current.string("id") == attemptId) { "登录请求已变化，请重新登录" }
                            val completed = ownedAccount("account.completeSignIn", args("code" to code, "state" to token)).objectValue()
                            require(completed["completed"].flag()) { "账户授权未完成" }
                            completed.string("completionUrl")
                        }
                    }
                    try {
                        withTimeout(60_000) {
                            while (view["attempt"].objectValue().string("phase") == "initializing") {
                                delay(500)
                                view = ownedAccount("account.getState", args()).objectValue()
                                require(view["attempt"].objectValue().string("id") == attemptId) { "登录请求已变化，请重新登录" }
                                if (owner() == identity && state.section == "account") state = state.copy(data = obj("view" to view))
                            }
                        }
                        val attempt = view["attempt"].objectValue()
                        require(attempt.string("phase") == "waiting-browser") { "账户授权失败：${attempt.string("errorCode").ifBlank { attempt.string("phase") }}" }
                        val url = attempt.string("authorizeUrl")
                        require(url.startsWith("https://")) { "账户服务未返回有效授权地址" }
                        check(owner() == identity) { "电脑或会话已切换，请重新登录" }
                        openUrl(url)
                        callbackJob.await()
                        if (owner() == identity && state.section == "account") state = state.copy(data = readAccount(), notice = "账户已登录")
                    } finally { callbackJob.cancel(); callback.close() }
                } catch (failure: Throwable) {
                    if (failure is CancellationException && failure !is TimeoutCancellationException) throw failure
                    if (owner() == identity && state.section == "account") state = state.copy(error = failure.message ?: "账户登录失败，请取消后重试")
                } finally {
                    callback.close()
                    if (login === callback) login = null
                    if (loginAttemptId == attemptId) loginAttemptId = ""
                    withContext(NonCancellable) {
                        try { connection("account.cancelSignIn", args("attemptId" to attemptId)) }
                        catch (_: Exception) { /* A closed initiating connection leaves only its expiring server attempt. */ }
                    }
                }
            }
            state.copy(data = obj("view" to view))
        } catch (failure: Throwable) { callback.close(); login = null; throw failure }
        }
    }
    fun acknowledgeBonus(accountId: String, orderId: String) = mutate("account.ackBonusNotified", args("accountId" to accountId, "orderId" to orderId, "client" to clientMetadata()))
}
