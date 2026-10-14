/**
 * Browser half of the browse directory-picker backend: fills ui-workspace's
 * two directory-flow holes with the in-app Select Workspace Directory dialog
 * (figma `Harness` 813-23126 family), driving the node half's
 * `directoryPicker/list`/`directoryPicker/createDirectory` primitives.
 * Each flow entry also declares a `.remote` child hole so a remote-workspace
 * plugin mounts a remote pane inside the same dialog, reached through the
 * dialog's local/remote tab strip — an empty remote hole leaves the strip
 * unrendered and the local pane alone. Mounting this package therefore
 * composes both sides of the browse interaction with one cordis.yml row; no
 * client code branches on a capability kind. The dialog's copy is
 * locale-registered here — the flow package owns its own strings.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './contract/slots.ts'
import type { BrowseFlowInjected } from './flow.ts'
import { BrowseDirectoryFlowHero, BrowseDirectoryFlowSidebar } from './flow.ts'
import type { RemoteFlowSlotName } from './contract/slots.ts'
export type { RemoteFlowOwnerProps, RemoteFlowSlotName } from './contract/slots.ts'

/** Locale namespace owning the browser dialog's copy. */
const LOCALE_NS = 'directory-browser'

/** Required services (cordis fiber inject): the slot registry, workspace UI service, and locale. */
export const inject = ['slots', 'uiWorkspace', 'locale']

/**
 * Client plugin body: register the dialog's dictionaries and the browse flow
 * into both directory-flow holes through `slots.inject()` because the
 * ui-workspace entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    // The two dictionaries land as a unit: if the second registration hits a
    // rival owner of the namespace, the first rolls back before the throw —
    // a failed activation must not squat the namespace's other locale.
    const disposers: (() => void)[] = []
    const dictionaries: [locale: string, dict: Record<string, string>][] = [
      ['zh', {
        'browser.title': '选择工作区目录',
        'browser.home': '主目录',
        'browser.goHome': '转到主目录',
        'browser.computer': '此电脑',
        'browser.newFolder': '新建文件夹',
        'browser.folderName': '文件夹名称',
        'browser.createIn': '在"{name}"中新建文件夹',
        'browser.untitledFolder': '未命名文件夹',
        'browser.create': '创建',
        'browser.retry': '重试',
        'browser.dismiss': '关闭提示',
        'browser.cancel': '取消',
        'browser.open': '打开',
        'browser.editPath': '编辑路径',
        'browser.loading': '加载中…',
        'browser.truncated': '文件夹过多，仅显示开头部分。',
        'browser.showHidden': '显示隐藏文件',
        'browser.tabLocal': '本机',
        'browser.tabRemote': '远程',
      }],
      ['en', {
        'browser.title': 'Select Workspace Directory',
        'browser.home': 'Home',
        'browser.goHome': 'Go to Home',
        'browser.computer': 'This PC',
        'browser.newFolder': 'New folder',
        'browser.folderName': 'Folder name',
        'browser.createIn': 'New folder in "{name}"',
        'browser.untitledFolder': 'Untitled folder',
        'browser.create': 'Create',
        'browser.retry': 'Retry',
        'browser.dismiss': 'Dismiss notification',
        'browser.cancel': 'Cancel',
        'browser.open': 'Open',
        'browser.editPath': 'Edit path',
        'browser.loading': 'Loading…',
        'browser.truncated': 'Too many folders to list; only the beginning is shown.',
        'browser.showHidden': 'Show hidden files',
        'browser.tabLocal': 'Local',
        'browser.tabRemote': 'Remote',
      }],
    ]
    try {
      for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers) dispose() }
  }, 'directory-picker-browse: dialog dictionaries')

  // Each flow entry declares its own `.remote` child hole (the registry
  // rejects a child key declared twice, so one shared key cannot serve both
  // parents). The dialog renders the hole through its local/remote tab
  // strip; an unoccupied hole leaves the strip unrendered and the local
  // pane alone. Occupancy rides a HostObservable per hole, the same shape
  // ui-workspace uses for the flow holes themselves.
  const remoteFlowSource = (hole: RemoteFlowSlotName): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const injected = (remoteHole: RemoteFlowSlotName) => (): BrowseFlowInjected => ({
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
    createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
    hooks: { remoteFlow: remoteFlowSource(remoteHole) },
    t: ctx.locale.bind(LOCALE_NS),
  })
  // All declaration lifetimes must be live before the pair installs; the
  // generator makes the two registrations one transactional effect. The
  // outer/inner nesting order is arbitrary; neither hole has precedence.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow',
        children: {
          'conversation.hero.workspace.directoryFlow.remote': { kind: 'single', scope: 'root' },
        },
        inject: injected('conversation.hero.workspace.directoryFlow.remote'),
      }, BrowseDirectoryFlowHero)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow',
        children: {
          'sidebar.workspaces.directoryFlow.remote': { kind: 'single', scope: 'root' },
        },
        inject: injected('sidebar.workspaces.directoryFlow.remote'),
      }, BrowseDirectoryFlowSidebar)
    }))
}
