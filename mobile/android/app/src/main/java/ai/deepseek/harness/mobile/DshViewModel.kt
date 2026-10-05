package ai.deepseek.harness.mobile

import ai.deepseek.harness.mobile.pair.*
import ai.deepseek.harness.mobile.remote.*
import ai.deepseek.harness.mobile.store.DeviceStore
import ai.deepseek.harness.mobile.ui.*
import android.os.Build
import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.*

enum class Route { Connect, Permission, Scan, Chat }
class DshViewModel(private val store: DeviceStore) : ViewModel() {
    var route by mutableStateOf(Route.Connect)
    var paste by mutableStateOf("")
    var error by mutableStateOf("")
    var pasteExpanded by mutableStateOf(false)
        private set
    var pasteFocusRequestId by mutableStateOf(0L)
        private set
    var scheme by mutableStateOf(store.scheme)
    internal var externalUrl by mutableStateOf("")
    internal var chat by mutableStateOf(NativeChatState())
        private set
    internal var workspaces by mutableStateOf(emptyList<NativeWorkspace>())
        private set
    internal var allSessions by mutableStateOf(emptyList<NativeSession>())
        private set
    internal var panel by mutableStateOf("")
    internal var panelData by mutableStateOf(obj())
        private set
    internal var panelBusy by mutableStateOf(false)
        private set
    internal var gitRemaining by mutableStateOf(emptyList<String>())
        private set
    internal var gitCompleted by mutableStateOf(emptyList<String>())
        private set
    private var gitPayload = obj()
    private var gitSession = ""
    var computers by mutableStateOf(readComputers())
        private set
    val hasRememberedComputer get() = computers.isNotEmpty()
    val needsLegacyMigration get() = !store.nativeMigrationDone && store.webAppUrl.isNotEmpty()
    private var client: RelayClient? = null
    private var selectedServer = store.selectedComputer
    @Volatile private var generation = 0L
    private var connectionJob: Job? = null
    private var observerJob: Job? = null
    private var pollJob: Job? = null
    private var foreground = true
    private var refreshingHistory = false
    private var historyDirty = false
    private val imageDrafts = mutableMapOf<String, List<NativeImage>>()
    private var history: List<JsonObject> = emptyList()
    private var beforeSeq: Long? = null
    private val approvalRpcIds = mutableMapOf<String, String>()
    private val liveApprovals = linkedMapOf<String, NativeApproval>()
    private var draftData = Json.parseToJsonElement(store.draftsJson).objectValue()
    private val computerSerializer = ListSerializer(SavedComputer.serializer())

    private fun readComputers() = Json.decodeFromString(ListSerializer(SavedComputer.serializer()), store.computersJson)
    init { store.clearLegacyHttpCredentials() }
    fun start() { if (!needsLegacyMigration && hasRememberedComputer && client == null) reopenComputer() }
    fun connectFromPaste() = pair(paste)
    fun updatePasteExpanded(expanded: Boolean) { pasteExpanded = expanded; if (expanded) pasteFocusRequestId++ }
    fun openPasteEntry() { updatePasteExpanded(true); route = Route.Connect }
    fun onScanned(raw: String) = pair(raw)
    fun pair(text: String) {
        val link = OfferCodec.parsePairingLink(text)
        if (link == null) {
            error = "无效的配对链接（需要完整的 dshd offer URL）"
            pasteExpanded = true; route = Route.Connect; return
        }
        connect(link.offer, computers.find { it.serverId == link.offer.serverId })
    }
    fun openPairingLink(action: String?, dataString: String?) {
        if (PairingIntent.fromViewIntent(action, dataString) != null) pair(dataString.orEmpty())
        else if (action == PairingIntent.ACTION_VIEW && dataString != null) error = "打开的链接里没有配对密钥——请扫桌面远程弹窗里的二维码"
    }
    fun reopenComputer(serverId: String = selectedServer) {
        val saved = computers.find { it.serverId == serverId } ?: computers.maxByOrNull { it.savedAt } ?: return
        connect(saved.offer(), saved)
    }
    fun leaveComputer() {
        generation++; connectionJob?.cancel(); observerJob?.cancel(); pollJob?.cancel(); client?.close(); client = null
        chat = NativeChatState(); panel = ""; route = Route.Connect
    }
    fun forgetComputer(serverId: String) {
        if (selectedServer == serverId) leaveComputer()
        computers = computers.filterNot { it.serverId == serverId }
        store.computersJson = Json.encodeToString(computerSerializer, computers)
    }
    private fun persist(saved: SavedComputer) {
        synchronized(store) { store.computersJson = Json.encodeToString(computerSerializer, readComputers().filterNot { it.serverId == saved.serverId } + saved) }
        viewModelScope.launch { computers = readComputers() }
    }
    private fun connect(offer: Offer, saved: SavedComputer?) {
        generation++
        val epoch = generation
        connectionJob?.cancel(); observerJob?.cancel(); pollJob?.cancel(); client?.close(); client = null
        selectedServer = offer.serverId; store.selectedComputer = selectedServer
        history = emptyList(); beforeSeq = null; approvalRpcIds.clear(); liveApprovals.clear(); panel = ""; panelBusy = false; refreshingHistory = false; historyDirty = false
        chat = NativeChatState(route = "chat", offline = true, connLabel = "正在连接电脑…", hostName = saved?.computerName.orEmpty())
        error = ""; route = Route.Chat
        val connection = try { RelayClient(offer, saved, "${Build.MANUFACTURER} ${Build.MODEL}", { record -> if (epoch == generation) persist(record) },
            onMux = { payload -> viewModelScope.launch { if (epoch == generation) onMux(payload) } },
            onComputerName = { name -> viewModelScope.launch { if (epoch == generation) update { copy(hostName = name) } } })
        } catch (failure: Exception) { error = failure.message ?: "无效的配对数据"; route = Route.Connect; return }
        client = connection
        observerJob = viewModelScope.launch { connection.status.collect { status ->
            if (epoch == generation) update { copy(connLabel = status, offline = !connection.connected) }
        } }
        connectionJob = viewModelScope.launch {
            try {
                connection.connect()
                if (epoch != generation) return@launch
                update { copy(connected = true, offline = false) }
                refreshCatalog(connection, epoch)
                chat.sessions.firstOrNull()?.let { openSession(it.id) }
                connection.subscribe(); startPoll()
            } catch (failure: Throwable) {
                if (failure !is CancellationException && epoch == generation) update { copy(error = failure.message ?: "连接失败", offline = !connection.connected) }
            }
        }
    }
    internal fun update(transform: NativeChatState.() -> NativeChatState) { chat = chat.transform().copy(seq = chat.seq + 1) }
    internal fun report(message: String) { update { copy(banner = message) } }
    private fun action(work: suspend (RelayClient, Long) -> Unit) {
        val connection = client ?: return
        val epoch = generation
        viewModelScope.launch {
            try { work(connection, epoch) } catch (failure: Throwable) {
                if (failure !is CancellationException && epoch == generation) report(failure.message ?: "电脑没有响应")
            }
        }
    }
    private suspend fun refreshCatalog(connection: RelayClient, epoch: Long) {
        val sessions = connection.host("session.list").objectValue().objects("items")
        val data = connection.host("workspace.list").objectValue()
        if (epoch != generation) return
        val items = data.objects("items")
        workspaces = items.map { NativeWorkspace(it.string("workspaceId"), it.string("title"), it.string("path")) }
        val bySession = mutableMapOf<String, JsonObject>()
        items.forEach { ws -> ws["sessionIds"].arrayValue().forEach { bySession[it.text()] = ws } }
        val archived = data["archivedSessionIds"].arrayValue().map { it.text() }.toSet()
        val order = items.flatMap { it["sessionIds"].arrayValue().map { id -> id.text() } }.withIndex().associate { it.value to it.index }
        allSessions = sessions.filter { it.string("origin") != "dshbot" }.mapNotNull { row ->
            val ws = bySession[row.string("sessionId")]
            if (ws == null && row.string("cwd") != data.string("scratchCwd") && row.string("sessionId") !in archived) return@mapNotNull null
            val title = row["projections"].objectValue()["values"].objectValue().string("title")
            if (row["blank"].flag() && title.isBlank() && row.string("sessionId") != chat.sessionId && row.string("sessionId") !in archived) return@mapNotNull null
            NativeSession(row.string("sessionId"), title.ifBlank { "新会话" }, ws?.string("title").orEmpty(),
                row["running"].flag(), row.string("parentSessionId").isNotBlank() || row.string("sessionId") in archived,
                row.string("cwd").ifBlank { ws?.string("path").orEmpty() }, ws?.string("workspaceId").orEmpty(), row.string("sessionId") in archived)
        }.sortedBy { order[it.id] ?: Int.MAX_VALUE } + archived.filter { id -> sessions.none { it.string("sessionId") == id } }
            .map { NativeSession(it, "缺失会话", "", false, true, archived = true) }
        val current = currentSession()
        update { copy(sessions = allSessions.filterNot { it.archived }, title = current?.title ?: title,
            running = current?.running ?: running, readOnly = if (current?.readOnly == true) "只读会话" else "", error = "") }
    }
    internal fun currentSession() = allSessions.find { it.id == chat.sessionId }
    private fun draftKey(sessionId: String) = "$selectedServer/$sessionId"
    private fun saveDraft(sessionId: String, value: String) {
        val key = draftKey(sessionId)
        draftData = JsonObject(if (value.isEmpty()) draftData - key else draftData + (key to JsonPrimitive(value)))
        store.draftsJson = draftData.toString()
        if (chat.sessionId == sessionId) update { copy(draft = value) }
    }
    internal fun openSession(id: String) {
        if (chat.busy) return
        if (chat.sessionId.isNotBlank()) imageDrafts[draftKey(chat.sessionId)] = chat.attachments
        history = emptyList(); beforeSeq = null; approvalRpcIds.clear(); liveApprovals.clear()
        val session = allSessions.find { it.id == id }
        update { copy(sessionId = id, title = session?.title ?: "新会话", rows = emptyList(), approval = null,
            hasOlder = false, loading = true, readOnly = if (session?.readOnly == true) "只读会话" else "",
            running = session?.running == true, draft = draftData.string(draftKey(id)), attachments = imageDrafts[draftKey(id)].orEmpty(), error = "",
            model = "", modelOptions = emptyList(), slashCommands = emptyList(), modelCurrentId = "", modelCurrentProvider = "", modelCurrentEffort = "") }
        action { connection, epoch ->
            try {
                loadHistory(connection, epoch, id)
                val catalog = connection.host("session.models", obj("sessionId" to id)).objectValue()
                val commands = connection.host("commands/list", obj("args" to obj("agentId" to id))).arrayValue().map { command ->
                    val item = command.objectValue()
                    NativeSlashCommand(item.string("name"), item.string("description"), item["input"].objectValue().string("hint"))
                }
                if (epoch != generation || chat.sessionId != id) return@action
                val routable = catalog["routableProviders"]?.arrayValue()?.map { it.text() }?.toSet()
                val models = catalog.objects("groups").flatMap { group ->
                    if (routable != null && group.string("id") !in routable) emptyList() else group.objects("models").map { model ->
                        NativeModelOption(group.string("id"), model.string("id"), model.string("name").ifBlank { model.string("id") },
                            model["reasoning"].objectValue().objects("efforts").map { NativeModelEffort(it.string("id"), it.string("name").ifBlank { it.string("id") }) },
                            (model["inputModalities"] as? JsonArray)?.any { it.text() == "image" })
                    }
                }
                val selected = if (chat.modelCurrentId.isNotBlank()) obj("provider" to chat.modelCurrentProvider, "model" to chat.modelCurrentId,
                    "reasoningEffort" to chat.modelCurrentEffort) else (catalog["current"] ?: catalog["default"]).objectValue()
                update { copy(modelOptions = models, slashCommands = commands, modelCurrentProvider = selected.string("provider"), modelCurrentId = selected.string("model"),
                    modelCurrentEffort = selected.string("reasoningEffort"), model = selected.string("model")) }
            } catch (failure: Throwable) {
                if (failure !is CancellationException && epoch == generation && chat.sessionId == id) update { copy(loading = false, error = failure.message ?: "无法载入会话") }
            }
        }
    }
    private suspend fun loadHistory(connection: RelayClient, epoch: Long, id: String, older: Boolean = false) {
        val payload = obj("sessionId" to id, "maxMessages" to 50).toMutableMap()
        if (older) payload["beforeSeq"] = jsonValue(beforeSeq)
        val result = connection.host("session.history", JsonObject(payload)).objectValue()
        val projections = connection.host("session.projections", obj("sessionId" to id)).objectValue()
        if (epoch != generation || chat.sessionId != id) return
        val events = result.objects("events")
        history = if (older) mergeHistory(events, history) else mergeHistory(history, events).sortedBy { historySeq(it) ?: Long.MAX_VALUE }
        history.forEach { entry ->
            val event = historyEvent(entry)
            if (event.string("type") == "approval/decided") {
                val approvalId = event["data"].objectValue().string("id")
                liveApprovals.remove(approvalId); approvalRpcIds.remove(approvalId)
            }
        }
        val minSeq = events.mapNotNull(::historySeq).minOrNull()
        if (older || beforeSeq == null) beforeSeq = minSeq
        val values = projections["values"].objectValue()
        val selection = values["modelSelection"].objectValue()
        val currentModel = (selection["next"] ?: selection["pending"] ?: selection["lastUsed"]).objectValue()
        val permissions = values["permissions"].objectValue().string("currentValue")
        val plan = values["plan"].objectValue()
        val lastTurn = history.lastOrNull { historyEvent(it).string("type") in setOf("turn/start", "turn/end") }
        update { copy(rows = foldNativeHistory(history), loading = false, olderLoading = false, error = "",
            title = values.string("title").ifBlank { title },
            running = lastTurn?.let { historyEvent(it).string("type") == "turn/start" } ?: running,
            hasOlder = if (older || beforeSeq == minSeq) result["hasMore"].flag() && minSeq != null else hasOlder,
            approval = historyApprovals(history).firstOrNull() ?: liveApprovals.values.firstOrNull(), permission = PERMISSIONS.find { it.id == permissions }?.label ?: permissions.ifBlank { permission },
            permissionCurrent = permissions.ifBlank { permissionCurrent }, permissionOptions = PERMISSIONS,
            planOn = if (plan.isNotEmpty()) if (plan["pending"].flag()) !plan["active"].flag() else plan["active"].flag() else planOn,
            modelCurrentProvider = currentModel.string("provider").ifBlank { modelCurrentProvider },
            modelCurrentId = currentModel.string("model").ifBlank { modelCurrentId },
            modelCurrentEffort = currentModel.string("reasoningEffort").ifBlank { modelCurrentEffort },
            model = currentModel.string("model").ifBlank { model }) }
    }
    private fun onMux(payload: JsonObject) {
        val envelope = payload["envelope"].objectValue()
        val event = (envelope["payload"] ?: envelope).objectValue()
        val type = event.string("type")
        if (type in setOf("host/session-added", "host/session-removed", "host/session-status", "host/workspace-changed",
                "host/workspace-removed", "host/workspace-order-changed", "host/archived-sessions-changed") ||
            type == "session/projection" && event.string("key") in setOf("title", "sessionListMetadata")) {
            action { connection, epoch -> refreshCatalog(connection, epoch) }
        }
        if (event.string("sessionId") != chat.sessionId) return
        when (type) {
            "host/session-status", "session/running" -> { update { copy(running = event["running"].flag()) }; refreshHistory() }
            "approval/requested" -> {
                val id = event.string("approvalId"); approvalRpcIds[id] = payload.string("rpcId").ifBlank { envelope.string("rpcId") }
                liveApprovals[id] = NativeApproval(id, event.string("toolName"), event.string("reason"), "",
                    listOf(NativeApprovalAction("rejected", "拒绝"), NativeApprovalAction("allowed-once", "允许一次")))
                update { copy(approval = liveApprovals.values.firstOrNull()) }
            }
            "approval/resolved" -> { liveApprovals.remove(event.string("approvalId")); update { copy(approval = liveApprovals.values.firstOrNull()) }; refreshHistory() }
            "session/event" -> {
                val message = event["event"].objectValue()
                val entry = obj("event" to message)
                if (history.none { historySeq(it) == historySeq(entry) }) {
                    history = history + entry
                    update { copy(rows = foldNativeHistory(history), running = when (message.string("type")) {
                        "turn/start" -> true; "turn/end" -> false; else -> running
                    }) }
                }
                refreshHistory()
            }
            else -> refreshHistory()
        }
    }
    private fun refreshHistory() {
        if (chat.sessionId.isBlank() || client == null) return
        if (refreshingHistory) { historyDirty = true; return }
        refreshingHistory = true
        val id = chat.sessionId
        action { connection, epoch -> try { loadHistory(connection, epoch, id) } finally {
            if (epoch == generation) { refreshingHistory = false; if (historyDirty) { historyDirty = false; refreshHistory() } }
        } }
    }
    private fun startPoll() {
        pollJob?.cancel(); if (!foreground) return
        pollJob = viewModelScope.launch { while (isActive) { delay(1_500); if (client?.connected == true && (chat.running || chat.approval != null)) refreshHistory() } }
    }
    fun onForeground() {
        foreground = true
        if (route != Route.Chat) return
        if (connectionJob?.isActive == true) return
        if (client?.connected != true) {
            if (computers.any { it.serverId == selectedServer }) reopenComputer(selectedServer)
            else { error = "配对尚未完成，请在电脑端刷新二维码后重新扫描"; route = Route.Connect }
            return
        }
        action { connection, epoch -> refreshCatalog(connection, epoch); refreshHistory(); startPoll() }
    }
    fun onBackground() { foreground = false; pollJob?.cancel() }
    fun onNetworkAvailable() { if (foreground && route == Route.Chat && connectionJob?.isActive != true && client?.connected != true) onForeground() }
    internal fun onChatAction(request: NativeChatAction) {
        if (request.type == "draft") { if (request.sessionId == chat.sessionId && chat.readOnly.isBlank()) saveDraft(request.sessionId, request.text); return }
        if (request.type == "refresh") { onForeground(); return }
        if (request.type == "new") { panel = "new"; return }
        if (request.type == "open") { openSession(request.sessionId); return }
        if (request.sessionId != chat.sessionId) return
        if (request.type == "retry") { if (chat.offline) onForeground() else openSession(request.sessionId); return }
        if (chat.offline || chat.busy || chat.readOnly.isNotBlank() && request.type != "older") return
        val id = request.sessionId
        val submitted = request.text
        update { copy(busy = true, banner = "") }
        action { connection, epoch ->
            try {
                when (request.type) {
                    "older" -> { update { copy(olderLoading = true) }; loadHistory(connection, epoch, id, true) }
                    "send" -> {
                        if (chat.approval != null || submitted.isBlank() && chat.attachments.isEmpty()) return@action
                        val attachments = chat.attachments
                        require(attachments.isEmpty() || chat.modelOptions.find { it.provider == chat.modelCurrentProvider && it.id == chat.modelCurrentId }?.supportsImages != false) {
                            "当前模型不支持图片，请切换模型或移除图片后发送"
                        }
                        if (submitted.trim().startsWith('/')) command(connection, id, submitted.trim(), attachments)
                        else connection.host("session.prompt", obj("sessionId" to id, "mode" to "queue", "content" to
                            listOfNotNull(submitted.takeIf { it.isNotBlank() }?.let { obj("type" to "text", "text" to it) }) +
                            attachments.map { obj("type" to "image", "mediaType" to it.mediaType, "data" to it.data) }))
                        if (epoch == generation && chat.sessionId == id) {
                            if (chat.draft == submitted) saveDraft(id, "")
                            imageDrafts.remove(draftKey(id)); update { copy(attachments = emptyList(), running = true) }; loadHistory(connection, epoch, id)
                        }
                    }
                    "cancel" -> connection.host("session.cancel", obj("sessionId" to id))
                    "model" -> {
                        require(chat.modelOptions.any { it.provider == request.provider && it.id == request.model })
                        val value = obj("sessionId" to id, "provider" to request.provider, "model" to request.model).toMutableMap()
                        if (request.reasoningEffort.isNotEmpty()) value["reasoningEffort"] = JsonPrimitive(request.reasoningEffort)
                        connection.host("session.selectModel", JsonObject(value))
                        if (epoch == generation && chat.sessionId == id) update { copy(model = request.model, modelCurrentProvider = request.provider,
                            modelCurrentId = request.model, modelCurrentEffort = request.reasoningEffort) }
                    }
                    "permission" -> { require(PERMISSIONS.any { it.id == request.id }); command(connection, id, "/permission ${request.id}") }
                    "planOff" -> command(connection, id, "/plan off")
                    "slash" -> command(connection, id, request.line)
                    "approve" -> {
                        val approval = chat.approval ?: return@action
                        require(approval.id == request.approvalId && approval.actions.any { it.id == request.actionId })
                        connection.host("respond", obj("rpcId" to approvalRpcIds[approval.id].orEmpty(), "value" to
                            obj("sessionId" to id, "approvalId" to approval.id, "outcome" to request.actionId)))
                        if (epoch == generation && chat.sessionId == id) { liveApprovals.remove(approval.id); update { copy(approval = liveApprovals.values.firstOrNull()) } }
                    }
                }
                if (epoch == generation && chat.sessionId == id && request.type !in setOf("older", "send", "model")) loadHistory(connection, epoch, id)
            } finally { if (epoch == generation) update { copy(busy = false, olderLoading = false) } }
        }
    }
    private suspend fun command(connection: RelayClient, id: String, line: String, images: List<NativeImage> = emptyList()) {
        val result = connection.host("commands/execute", obj("args" to obj("agentId" to id, "line" to line,
            "submittedAttachments" to images.map { obj("type" to "image", "mediaType" to it.mediaType, "data" to it.data) }))).objectValue()
        require(result.string("commandId").isNotBlank()) { "未知命令：$line" }
        val value = result["result"].objectValue(); require(value.string("kind") != "error") { value.string("text") }
    }
    internal fun addImage(server: String, session: String, image: NativeImage) {
        if (selectedServer == server && session == chat.sessionId && chat.readOnly.isBlank()) update { copy(attachments = attachments + image) }
    }
    internal fun attachmentOwner() = selectedServer to chat.sessionId
    internal fun removeImage(index: Int) { update { copy(attachments = attachments.filterIndexed { i, _ -> i != index }) } }
    internal fun createSession(workspaceId: String? = null) = panelAction { connection, epoch ->
        val result = connection.host("session.create", if (workspaceId == null) obj() else obj("workspaceId" to workspaceId)).objectValue()
        if (epoch != generation) return@panelAction
        val id = result.string("sessionId"); require(id.isNotBlank()) { "新会话未返回 id" }
        panel = ""; update { copy(sessionId = id) }; refreshCatalog(connection, epoch); openSession(id)
    }
    internal fun browse(path: String = "") = panelAction { connection, epoch ->
        val data = connection.host("host.listDirectory", if (path.isBlank()) obj() else obj("path" to path)).objectValue()
        if (epoch == generation) { panelData = data; panel = "browse" }
    }
    internal fun createDirectory(name: String) = panelAction { connection, epoch ->
        val path = panelData.string("path")
        connection.host("host.createDirectory", obj("path" to path, "name" to name))
        val data = connection.host("host.listDirectory", obj("path" to path)).objectValue()
        if (epoch == generation) panelData = data
    }
    internal fun registerDirectory() = panelAction { connection, epoch ->
        val existing = workspaces.find { it.path == panelData.string("path") }
        val created = if (existing == null) connection.host("workspace.create", obj("path" to panelData.string("path"))).objectValue() else obj()
        val id = existing?.id ?: created["workspace"].objectValue().string("workspaceId")
        require(id.isNotBlank()) { "工作区创建失败" }
        val session = connection.host("session.create", obj("workspaceId" to id)).objectValue().string("sessionId")
        if (epoch == generation) { panel = ""; update { copy(sessionId = session) }; refreshCatalog(connection, epoch); openSession(session) }
    }
    internal fun sessionAction(method: String, row: NativeSession, title: String = "") = panelAction { connection, epoch ->
        val payload = obj("sessionId" to row.id).toMutableMap()
        if (method == "session.rename") payload["title"] = JsonPrimitive(title)
        val result = connection.host(method, JsonObject(payload)).objectValue()
        if (epoch == generation) {
            refreshCatalog(connection, epoch)
            if (method == "session.fork" && result.string("sessionId").isNotEmpty()) openSession(result.string("sessionId"))
            if (method == "session.delete" && chat.sessionId == row.id) update { copy(sessionId = "", rows = emptyList(), draft = "") }
        }
    }
    internal fun moveSession(row: NativeSession, direction: Int) = panelAction { connection, epoch ->
        val siblings = allSessions.filter { it.workspaceId == row.workspaceId && !it.archived }
        val index = siblings.indexOfFirst { it.id == row.id }
        if (row.workspaceId.isBlank() || index + direction !in siblings.indices) return@panelAction
        val payload = if (direction < 0) obj("workspaceId" to row.workspaceId, "sessionId" to row.id, "beforeSessionId" to siblings[index - 1].id)
            else obj("workspaceId" to row.workspaceId, "sessionId" to siblings[index + 1].id, "beforeSessionId" to row.id)
        connection.host("workspace.insertSessionBefore", payload)
        if (epoch == generation) refreshCatalog(connection, epoch)
    }
    internal fun workspaceAction(method: String, workspace: NativeWorkspace, title: String = "") = panelAction { connection, epoch ->
        val payload = obj("workspaceId" to workspace.id).toMutableMap()
        if (method == "workspace.rename") payload["title"] = JsonPrimitive(title)
        connection.host(method, JsonObject(payload))
        if (epoch == generation) refreshCatalog(connection, epoch)
    }
    internal fun findSessions(query: String) = panelAction { connection, epoch ->
        val data = connection.host("session.search", obj("query" to query)).objectValue()
        if (epoch == generation) panelData = data
    }
    internal fun openGit() = panelAction { connection, epoch ->
        val cwd = currentSession()?.cwd ?: error("当前会话没有工作目录")
        val status = connection.git("git-status", cwd).objectValue()
        require(status.isNotEmpty()) { "Git 状态不可用，请确认电脑端的工作区权限" }
        val branches = connection.git("git-branch-list", cwd)
        val entries = connection.git("git-status-entries", cwd)
        if (epoch == generation) { gitRemaining = emptyList(); gitCompleted = emptyList(); panelData = obj("status" to status, "branches" to branches, "entries" to entries); panel = "git" }
    }
    internal fun viewPullRequest() = panelAction { connection, epoch ->
        val cwd = currentSession()?.cwd ?: throw IllegalStateException("当前会话没有工作目录")
        val result = connection.git("git-pull-request", cwd).objectValue()
        val pr = (result["pr"] ?: result["value"].objectValue()["pr"]).objectValue()
        val url = pr.string("url")
        require(url.startsWith("https://") || url.startsWith("http://")) { "当前分支没有可查看的 PR" }
        if (epoch == generation) externalUrl = url
    }
    internal fun gitAction(steps: List<String>, payload: JsonObject = obj(), completed: List<String> = emptyList()) = panelAction { connection, epoch ->
        val cwd = currentSession()?.cwd ?: error("当前会话没有工作目录")
        val owner = chat.sessionId
        gitPayload = payload; gitSession = owner; gitRemaining = steps; gitCompleted = completed
        for (step in steps) {
            require(epoch == generation && chat.sessionId == owner) { "电脑或会话已切换，剩余 Git 操作已停止" }
            val result = connection.git(step, cwd, payload).objectValue()
            require(result.string("status") != "confirmation_required") { "请先创建并切换工作分支，再执行此操作" }
            gitCompleted = gitCompleted + step
            gitRemaining = gitRemaining.drop(1)
        }
        if (epoch == generation) { panel = ""; report("Git 操作完成") }
    }
    internal fun retryGit() {
        if (chat.sessionId != gitSession) { report("请先回到原会话再继续 Git 操作"); return }
        val completed = gitCompleted
        val remaining = gitRemaining
        gitAction(remaining, gitPayload, completed)
    }
    private fun panelAction(work: suspend (RelayClient, Long) -> Unit) {
        if (panelBusy || chat.offline || client == null) return
        panelBusy = true
        action { connection, epoch -> try { work(connection, epoch) } finally { if (epoch == generation) panelBusy = false } }
    }
    fun persistScheme(value: String) { scheme = value; store.scheme = value }
    internal fun importLegacy(raw: String) {
        val data = Json.parseToJsonElement(raw).objectValue()
        val legacy = Json.parseToJsonElement(data.string("computers").ifBlank { "{}" }).objectValue()
        val imported = legacy.map { (id, entry) ->
            val record = entry.objectValue()
            SavedComputer(id, record.string("deviceId"), record.string("deviceSecret"), record.string("daemonPublicKeyB64"),
                record.string("relayEndpoint"), record["useTls"].flag(), record.string("computerName").ifBlank { "我的电脑" }, record["savedAt"].number() ?: 0)
        }.filter { it.deviceId.isNotBlank() && it.deviceSecret.isNotBlank() && it.relayEndpoint.isNotBlank() && it.daemonPublicKeyB64.isNotBlank() }
        for (record in imported) if (readComputers().none { it.serverId == record.serverId }) persist(record)
        val migrated = mutableMapOf<String, JsonElement>()
        for ((server, value) in data["drafts"].objectValue()) {
            val drafts = Json.parseToJsonElement(value.text()).objectValue()
            for ((session, text) in drafts) migrated["$server/$session"] = text
        }
        draftData = JsonObject(migrated + draftData); store.draftsJson = draftData.toString(); store.nativeMigrationDone = true
        computers = readComputers()
        if (route == Route.Connect && computers.isNotEmpty()) reopenComputer()
    }
    override fun onCleared() { client?.close(); super.onCleared() }
    companion object {
        internal val PERMISSIONS = listOf(NativePermissionOption("read-only", "仅可查看"),
            NativePermissionOption("workspace-write", "可写入工作区"), NativePermissionOption("danger-full-access", "完全权限"))
    }
}
