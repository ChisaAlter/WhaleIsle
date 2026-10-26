package ai.deepseek.harness.mobile.ui



internal data class NativeSession(
    val id: String,
    val title: String,
    val workspace: String,
    val running: Boolean,
    val readOnly: Boolean,
    val cwd: String = "",
    val workspaceId: String = "",
    val archived: Boolean = false,
    val origin: String = "",
    val parentSessionId: String = "",
)

internal data class NativeRow(
    val id: String,
    val role: String,
    val text: String,
    val running: Boolean,
    val images: List<NativeImage> = emptyList(),
    val detail: String = "",
)

internal data class NativeImage(val mediaType: String, val data: String, val attachmentId: String = "", val error: String = "")
internal data class NativeWorkspace(val id: String, val title: String, val path: String)

internal data class NativeSessionGroup(
    val id: String,
    val title: String,
    val workspace: NativeWorkspace?,
    val sessions: List<NativeSession>,
)

/** Preserve catalog order and every non-archived session, including legacy ungrouped rows. */
internal fun nativeSessionGroups(workspaces: List<NativeWorkspace>, sessions: List<NativeSession>): List<NativeSessionGroup> {
    val visible = sessions.filterNot { it.archived }
    val knownIds = workspaces.map { it.id }.toSet()
    val groups = workspaces.map { workspace ->
        NativeSessionGroup("workspace:${workspace.id}", workspace.title.ifBlank {
            workspace.path.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifBlank { workspace.path }
        }, workspace, visible.filter { it.workspaceId == workspace.id })
    }
    val remaining = visible.filter { it.workspaceId !in knownIds }
    return groups + remaining.groupBy { it.workspaceId.ifBlank { it.cwd } }.map { (key, rows) ->
        val first = rows.first()
        NativeSessionGroup("other:$key", first.workspace.ifBlank {
            first.cwd.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifBlank { "无工作目录" }
        }, null, rows)
    }
}

internal data class NativeApprovalAction(val id: String, val label: String)
internal data class NativeModelEffort(val id: String, val label: String)
internal data class NativeModelOption(
    val provider: String,
    val id: String,
    val label: String,
    val efforts: List<NativeModelEffort>,
    val supportsImages: Boolean? = null,
)
internal data class NativePermissionOption(val id: String, val label: String)
internal data class NativeSlashCommand(val name: String, val description: String, val hint: String)
internal data class NativeApproval(
    val id: String,
    val title: String,
    val command: String,
    val error: String,
    val actions: List<NativeApprovalAction>,
    val rpcId: String = "",
    val sessionId: String = "",
)

/** Kotlin-owned UI state. Device secrets live only in the encrypted credential store. */
internal data class NativeChatState(
    val seq: Long = 0,
    val epoch: String = "",
    val route: String = "connect",
    val connected: Boolean = false,
    val hostName: String = "",
    val connLabel: String = "",
    val sessions: List<NativeSession> = emptyList(),
    val sessionId: String = "",
    val title: String = "新会话",
    val rows: List<NativeRow> = emptyList(),
    val loading: Boolean = false,
    val error: String = "",
    val hasOlder: Boolean = false,
    val olderLoading: Boolean = false,
    val running: Boolean = false,
    val readOnly: String = "",
    val approval: NativeApproval? = null,
    val model: String = "",
    val modelOptions: List<NativeModelOption> = emptyList(),
    val slashCommands: List<NativeSlashCommand> = emptyList(),
    val modelCurrentProvider: String = "",
    val modelCurrentId: String = "",
    val modelCurrentEffort: String = "",
    val permission: String = "",
    val permissionCurrent: String = "",
    val permissionOptions: List<NativePermissionOption> = emptyList(),
    val planOn: Boolean = false,
    val offline: Boolean = false,
    val banner: String = "",
    val draft: String = "",
    val attachments: List<NativeImage> = emptyList(),
    val busy: Boolean = false,
)
