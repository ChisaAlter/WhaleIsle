// Thin JS facade over vendored ACP ACP packages.
// Every exported function wraps ACP runtime implementations with Effect.runPromise —
// no protocol, auth, policy, or session logic is implemented here.

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import * as EffectCrypto from "effect/Crypto";
import { FetchHttpClient } from "effect/http";

import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import * as AcpRuntimeModel from "@t3tools/provider-acp/server/runtimeModel";
import * as AcpSessionConfig from "@t3tools/provider-acp/server/sessionConfig";
export { parseElicitationForm } from "./upstream/packages/provider-acp/src/server/elicitationForm.ts";

export const modelOptionDescriptors = AcpSessionConfig.acpProviderOptionDescriptors;
import * as AcpClientPolicy from "@t3tools/provider-acp/server/clientPolicy";
import * as AcpClientTerminals from "@t3tools/provider-acp/server/clientTerminals";
import * as AcpStderr from "@t3tools/provider-acp/server/stderr";
import * as AcpNativeLogging from "@t3tools/provider-acp/server/nativeLogging";
import * as AcpMcpOverAcpBridge from "@t3tools/provider-acp/server/mcpOverAcpBridge";
import * as AcpRegistrySupport from "@t3tools/provider-acp-registry/server/AcpRegistrySupport";
import * as AcpRegistryRuntimeCoordinator from "@t3tools/provider-acp-registry/server/AcpRegistryRuntimeCoordinator";
import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";

// Subpaths absent from package export maps: resolved as direct file paths.
import * as AcpRegistryAuth from "./upstream/packages/provider-acp-registry/src/server/auth.ts";
import * as AcpRegistryAuthenticationState from "./upstream/packages/provider-acp-registry/src/server/authenticationState.ts";
import * as AcpRegistryProbe from "./upstream/packages/provider-acp-registry/src/server/probe.ts";
import * as DevinAcp from "./upstream/packages/provider-acp-registry/src/server/devinAcp.ts";
import * as ClaudeAcp from "./upstream/packages/provider-acp-registry/src/server/claudeAcp.ts";
import * as CopilotAcp from "./upstream/packages/provider-acp-registry/src/server/copilotAcp.ts";
import * as DroidAcp from "./upstream/packages/provider-acp-registry/src/server/droidAcp.ts";
import * as AcpMcpStdioBridge from "./upstream/apps/server/src/mcp/AcpMcpStdioBridge.ts";
import * as AntigravityAuthSupport from "./upstream/apps/server/src/provider/antigravityAuthSupport.ts";
import * as AntigravityClientFiles from "./upstream/apps/server/src/provider/acp/AntigravityClientFiles.ts";
import * as AntigravityAuth from "./upstream/apps/server/src/provider/AntigravityAuth.ts";
import * as AntigravityInstallation from "./upstream/apps/server/src/provider/AntigravityInstallation.ts";
import * as AntigravityProtocol from "./upstream/apps/server/src/provider/acp/AntigravityProtocol.ts";
import * as AntigravityAcpSupport from "./upstream/apps/server/src/provider/acp/AntigravityAcpSupport.ts";
import * as AntigravitySessionFiles from "./upstream/apps/server/src/provider/acp/AntigravitySessionFiles.ts";
import * as NodePath from "node:path";

type AnyEffect<A = unknown> = Effect.Effect<A, unknown, unknown>;

let runtime: ManagedRuntime.ManagedRuntime<unknown, unknown> | undefined;

function rt(): ManagedRuntime.ManagedRuntime<unknown, unknown> {
  if (!runtime) throw new Error("initAgentRuntime() has not been called.");
  return runtime;
}

const run = <A>(effect: AnyEffect<A>): Promise<A> =>
  rt().runPromise(effect as Effect.Effect<A, never, never>);

const runScoped = <A>(effect: AnyEffect<A>): Promise<A> =>
  run(Effect.scoped(effect) as AnyEffect<A>);

function squashError(error: unknown): Error {
  if (error instanceof Error) return error;
  const squashed = Cause.squash(error as Cause.Cause<unknown>);
  return squashed instanceof Error ? squashed : new Error(String(squashed));
}

async function runCatch<A>(effect: AnyEffect<A>): Promise<A> {
  try {
    return await run(effect);
  } catch (error) {
    throw squashError(error);
  }
}

// Effect finalizers run inside the runtime; plain callbacks wrap them.
const asEffect = (fn: () => unknown): Effect.Effect<void> => Effect.sync(fn);
const asPromiseEffect = (fn: () => unknown) =>
  Effect.promise(async () => {
    await fn();
  });

// ---------------------------------------------------------------------------
// Runtime assembly
// ---------------------------------------------------------------------------

export interface AgentRuntimeInit {
  readonly cacheDir: string;
  readonly toolsDir: string;
  readonly registryUrl?: string;
  readonly ptyAdapter?: PtyAdapter.PtyAdapter["Service"];
  readonly paths: {
    readonly cwd: string;
    readonly baseDir: string;
    readonly stateDir: string;
    readonly attachmentsDir: string;
  };
  /** Live provider-instance map for managed-binary reference checks. */
  readonly getProviderInstances?: () => Record<string, { driver: string; config: unknown }>;
}

export async function initAgentRuntime(init: AgentRuntimeInit): Promise<void> {
  if (runtime) return;
  const deps = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, FetchHttpClient.layer);
  // the runtime's host-integration seam; only `settings.withSnapshot` and `paths` are
  // exercised by the ACP registry packages we vendor.
  const settingsSnapshot = () =>
    ({
      providerInstances: init.getProviderInstances?.() ?? {},
    }) as never;
  const providerHostLayer = Layer.succeed(ProviderHost.ProviderHost, {
    paths: {
      cwd: init.paths.cwd,
      baseDir: init.paths.baseDir,
      stateDir: init.paths.stateDir,
      providerStatusCacheDir: init.cacheDir,
      attachmentsDir: init.paths.attachmentsDir,
    },
    settings: {
      get: Effect.sync(settingsSnapshot),
      withSnapshot: (use: (settings: never) => AnyEffect) =>
        Effect.suspend(() => use(settingsSnapshot())),
      changes: Stream.empty,
      subscribe: Effect.succeed(Stream.empty),
    },
    shouldRunBackgroundWork: () => Effect.succeed(true),
    resolveAttachmentPath: () => null,
    credentials: () =>
      Effect.die(new Error("ProviderHost.credentials is not wired in dsh-acp.")),
  } as never);
  const provided = Layer.mergeAll(deps, providerHostLayer);
  const catalogLayer = Layer.effect(
    AcpRegistrySupport.AcpRegistryCatalog,
    AcpRegistrySupport.makeAcpRegistryCatalog({
      cacheDir: init.cacheDir,
      toolsDir: init.toolsDir,
      ...(init.registryUrl === undefined ? {} : { registryUrl: init.registryUrl }),
    }),
  ).pipe(Layer.provide(provided));
  const coordinatorLayer = AcpRegistryRuntimeCoordinator.layer.pipe(
    Layer.provide(provided),
  );
  const ptyLayer =
    init.ptyAdapter === undefined
      ? Layer.empty
      : Layer.succeed(PtyAdapter.PtyAdapter, init.ptyAdapter);
  const base = Layer.mergeAll(
    provided,
    catalogLayer,
    coordinatorLayer,
    ptyLayer,
  );
  runtime = ManagedRuntime.make(base as Layer.Layer<unknown, unknown, never>);
}

export async function disposeAgentRuntime(): Promise<void> {
  const current = runtime;
  await agyInstallationPromise?.catch(() => {});
  if (current && agyInstallationService) {
    await current.runPromise(Scope.close(agyInstallationService.scope, Exit.void));
    agyInstallationService = undefined;
  }
  if (current) await current.dispose();
  agyInstallationPromise = undefined;
  runtime = undefined;
}

// ---------------------------------------------------------------------------
// ACP registry catalog (agent discovery / install / resolve)
// ---------------------------------------------------------------------------

export const catalog = {
  search: (input: Parameters<AcpRegistrySupport.AcpRegistryCatalog["Service"]["search"]>[0]) =>
    runCatch(Effect.flatMap(AcpRegistrySupport.AcpRegistryCatalog, (svc) => svc.search(input))),
  inspect: (
    settings: Parameters<AcpRegistrySupport.AcpRegistryCatalog["Service"]["inspect"]>[0],
    environment?: NodeJS.ProcessEnv,
  ) =>
    runCatch(
      Effect.flatMap(AcpRegistrySupport.AcpRegistryCatalog, (svc) =>
        svc.inspect(settings, environment),
      ),
    ),
  resolve: (
    settings: Parameters<AcpRegistrySupport.AcpRegistryCatalog["Service"]["resolve"]>[0],
    cwd: string,
    environment?: NodeJS.ProcessEnv,
  ) =>
    runCatch(
      Effect.flatMap(AcpRegistrySupport.AcpRegistryCatalog, (svc) =>
        svc.resolve(settings, cwd, environment),
      ),
    ),
  prepare: (input: Parameters<AcpRegistrySupport.AcpRegistryCatalog["Service"]["prepare"]>[0]) =>
    runCatch(Effect.flatMap(AcpRegistrySupport.AcpRegistryCatalog, (svc) => svc.prepare(input))),
  uninstallManagedBinary: (
    input: Parameters<
      AcpRegistrySupport.AcpRegistryCatalog["Service"]["uninstallManagedBinary"]
    >[0],
  ) =>
    runCatch(
      Effect.flatMap(AcpRegistrySupport.AcpRegistryCatalog, (svc) =>
        svc.uninstallManagedBinary(input),
      ),
    ),
};

// ---------------------------------------------------------------------------
// Session runtime
// ---------------------------------------------------------------------------

export const registryAuthAction = {
  get: (instanceId: string) => runCatch(Effect.flatMap(AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator, (coordinator) =>
    coordinator.getUrlAuthAction(instanceId as never).pipe(Effect.map(Option.getOrNull)))),
  accept: (instanceId: string, elicitationId: string) => runCatch(Effect.flatMap(AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator, (coordinator) =>
    coordinator.acceptUrlAuthentication({ instanceId: instanceId as never, elicitationId }))),
};

export interface SessionHandle {
  readonly scope: Scope.Closeable;
  readonly service: AcpSessionRuntime.AcpSessionRuntime["Service"];
  readonly eventsFiber: Fiber.RuntimeFiber<void>;
}

export interface CreateSessionInput {
  readonly options: AcpSessionRuntime.AcpSessionRuntimeOptions;
  readonly onEvent?: (event: AcpSessionRuntime.AcpSessionRuntimeEvent) => void;
}

export async function createSession(input: CreateSessionInput): Promise<SessionHandle> {
  const scope = await run(Scope.make());
  const context = await runCatch(
    Layer.build(AcpSessionRuntime.layer(input.options)).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  ).catch(async (error) => { await run(Scope.close(scope, Exit.void)); throw error; });
  const service = Context.get(context, AcpSessionRuntime.AcpSessionRuntime);
  const eventsFiber = rt().runFork(
    Stream.runForEach(service.getEvents(), (event) =>
      Effect.sync(() => {
        try {
          input.onEvent?.(event);
        } catch {
          // Session event consumers must not kill the stream.
        }
      }),
    ),
  );
  return { scope, service, eventsFiber };
}

export async function disposeSession(handle: SessionHandle): Promise<void> {
  await rt().runPromise(Fiber.interrupt(handle.eventsFiber));
  await runCatch(Scope.close(handle.scope, Exit.void));
}

export function sessionApi(service: AcpSessionRuntime.AcpSessionRuntime["Service"]) {
  return {
    initialize: () => runCatch(service.initialize()),
    authenticate: service.authenticate
      ? (methodId: string) => runCatch(service.authenticate!(methodId))
      : undefined,
    start: () => runCatch(service.start()),
    prompt: (
      payload: Parameters<typeof service.prompt>[0],
      options?: Parameters<typeof service.prompt>[1],
    ) => runCatch(service.prompt(payload, options)),
    makeDeferred: <A = void>() => run(Deferred.make<A>()),
    awaitDeferred: <A>(deferred: Deferred.Deferred<A>) => runCatch(Deferred.await(deferred)),
    cancel: () => runCatch(service.cancel),
    setMode: (modeId: string) => runCatch(service.setMode(modeId)),
    setSessionModel: (modelId: string, meta?: unknown) =>
      runCatch(service.setSessionModel(modelId, meta as never)),
    setModel: (model: unknown) => runCatch(service.setModel(model as never)),
    setConfigOption: (
      optionId: string,
      value: string | boolean,
      options?: { allowUnlistedValue?: boolean },
    ) => runCatch(service.setConfigOption(optionId, value, options)),
    loadSession: (sessionId: string, options?: AcpSessionRuntime.AcpSessionActivationOptions) =>
      runCatch(service.loadSession(sessionId, options)),
    resumeSession: (sessionId: string, options?: AcpSessionRuntime.AcpSessionActivationOptions) =>
      runCatch(service.resumeSession(sessionId, options)),
    forkSession: (sessionId: string, options?: AcpSessionRuntime.AcpSessionActivationOptions) =>
      runCatch(service.forkSession(sessionId, options)),
    listSessions: (cursor?: string) => runCatch(service.listSessions(cursor)),
    closeSession: (sessionId?: string) => runCatch(service.closeSession(sessionId)),
    deleteSession: (sessionId: string) => runCatch(service.deleteSession(sessionId)),
    listProviders: () => runCatch(service.listProviders),
    setProvider: (provider: unknown) => runCatch(service.setProvider(provider as never)),
    disableProvider: (providerId: string) => runCatch(service.disableProvider(providerId)),
    logout: () => runCatch(service.logout),
    getModeState: () => runCatch(service.getModeState),
    getConfigOptions: () => runCatch(service.getConfigOptions),
    drainEvents: () => runCatch(service.drainEvents),
    request: (method: string, payload: unknown) => runCatch(service.request(method, payload)),
    notify: (method: string, payload: unknown) => runCatch(service.notify(method, payload)),
    processContainment: service.processContainment,
    terminateProcessGroup: service.terminateProcessGroup
      ? () => runCatch(service.terminateProcessGroup!)
      : undefined,
    // Client-side handlers are settable methods on the service. Each setter
    // returns an Effect — it must be run or the handler is never registered
    // and the agent's request comes back as Method-not-found.
    assignHandlers: async (handlers: Partial<
      Record<
        | "handleRequestPermission"
        | "handleElicitation"
        | "handleMcpConnect"
        | "handleMcpMessage"
        | "handleMcpDisconnect"
        | "handleMcpNotification"
        | "handleReadTextFile"
        | "handleWriteTextFile"
        | "handleCreateTerminal"
        | "handleTerminalOutput"
        | "handleTerminalWaitForExit"
        | "handleTerminalKill"
        | "handleTerminalRelease"
        | "handleSessionUpdate"
        | "handleElicitationComplete"
        | "handleUnknownExtRequest"
        | "handleUnknownExtNotification"
        | "handleExtRequest"
        | "handleExtNotification",
        (request: never, requestContext?: never) => unknown
      >
    >) => {
      for (const [key, fn] of Object.entries(handlers)) {
        const setter = service[key as keyof typeof service];
        if (typeof setter === "function") {
          await runCatch(
            (setter as (h: unknown) => AnyEffect<unknown>)(
              (request: unknown, requestContext: unknown) =>
                Effect.promise(async () =>
                  (fn as (r: unknown, c: unknown) => unknown)(request, requestContext),
                ),
            ),
          );
        }
      }
    },
  };
}

export type SessionApi = ReturnType<typeof sessionApi>;

// ---------------------------------------------------------------------------
// Auth flow (providerAuthFlow state machine + ACP registry authenticate)
// ---------------------------------------------------------------------------

export interface CreateAuthInput {
  readonly instanceId: string;
  readonly settings: Parameters<
    Parameters<typeof AcpRegistryAuth.makeAcpRegistryAuth>[0]
  >[0]["settings"];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly onChanged?: (authenticated: boolean) => unknown;
  readonly owner?: string;
  readonly stopSessions?: () => Promise<void>;
}

export interface AuthFlowHandle {
  readonly controller: ProviderAuthFlow.ProviderAuthController;
  readonly owner: string;
  readonly scope: Scope.Closeable;
  readonly subscriptionFiber: Fiber.RuntimeFiber<void>;
  readonly stopSessions?: () => Promise<void>;
}

export async function createAuthFlow(
  input: CreateAuthInput,
  onState?: (state: unknown) => void,
): Promise<AuthFlowHandle> {
  const scope = await run(Scope.make());
  const controller = await runCatch(
    AcpRegistryAuth.makeAcpRegistryAuth({
      // Flow/error wire ids are slugs. Keep persisted auth-state and AGY
      // profile ids unchanged below so existing credentials retain their paths.
      instanceId: input.instanceId.replace(/^dsh:/, "dsh-") as never,
      settings: input.settings,
      cwd: input.cwd,
      environment: input.environment,
      onChanged: (authenticated) => asPromiseEffect(() => input.onChanged?.(authenticated)),
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  ).catch(async (error) => { await run(Scope.close(scope, Exit.void)); throw error; });
  const owner = input.owner ?? "dsh-webview";
  const subscriptionFiber = rt().runFork(
    Stream.runForEach(controller.subscribe(owner), (state) =>
      Effect.sync(() => {
        try {
          onState?.(state);
        } catch {
          // Listener errors must not kill auth state propagation.
        }
      }),
    ),
  );
  return { controller, owner, scope, subscriptionFiber, stopSessions: input.stopSessions };
}

export function authFlowApi(handle: AuthFlowHandle) {
  const { controller, owner } = handle;
  const stopSessions = asPromiseEffect(() => handle.stopSessions?.());
  return {
    credentialBinding: controller.credentialBinding,
    start: (options?: {
      selectedMethodId?: string;
      returnUrl?: string;
      callbackMode?: "server" | "client";
      forceReauthentication?: boolean;
    }) =>
      runCatch(
        controller.start(
          owner,
          stopSessions,
          options?.selectedMethodId,
          options?.returnUrl,
          options?.callbackMode,
          options?.forceReauthentication,
        ),
      ),
    respond: (input: { flowId: string; interactionId: string; response: unknown }) =>
      runCatch(controller.respond(owner, input as never)),
    complete: (input: { flowId: string; callbackUrl: string }) =>
      runCatch(controller.complete(owner, input as never)),
    cancel: (flowId: string) => runCatch(controller.cancel(owner, flowId)),
    logout: () => runCatch(controller.logout(stopSessions)),
    refreshMethods: () => runCatch(controller.refreshMethods),
    invalidate: () => runCatch(controller.invalidate),
    isChangingCredentials: () => runCatch(controller.isChangingCredentials),
    adoptCredentials: (update: AnyEffect<void>) =>
      runCatch(controller.adoptCredentials(update, stopSessions)),
    dispose: async () => {
      await rt().runPromise(Fiber.interrupt(handle.subscriptionFiber));
      await runCatch(Scope.close(handle.scope, Exit.void));
    },
  };
}

export type AuthFlowApi = ReturnType<typeof authFlowApi>;

// ACP runtime driver.ts:522-529 — the confirmed-authentication marker is persisted per
// instance and keyed by a binding hash of command/env/auth settings.
export function makeAuthState(input: {
  readonly cacheDir: string;
  readonly instanceId: string;
  readonly settings: unknown;
  readonly environment: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly processEnvironment: NodeJS.ProcessEnv;
}) {
  return runCatch(
    AcpRegistryAuthenticationState.makeAcpRegistryAuthenticationState({
      cacheDir: input.cacheDir,
      instanceId: input.instanceId as never,
      settings: input.settings as never,
      environment: input.environment as never,
      processEnvironment: input.processEnvironment,
    }),
  ).then((state) => ({
    get: () => runCatch(state.get),
    set: (authenticated: boolean) => runCatch(state.set(authenticated)),
  }));
}

// ---------------------------------------------------------------------------
// MCP injection — verbatim port of provider-acp adapter.ts acpMcpContext().
// ACP runtime injects its own binary running `acp-mcp-bridge`; we inject the vendored
// bridge bundle the same way.
// ---------------------------------------------------------------------------

export interface AcpMcpInjectionInput {
  readonly endpoint: string;
  readonly authorization: string;
  readonly bridgeCommand: string;
  readonly bridgeEntrypoint: string;
}

export function acpMcpInjection(input: AcpMcpInjectionInput) {
  return {
    servers: [
      {
        name: "whaleisle",
        command: input.bridgeCommand,
        args: [input.bridgeEntrypoint, "acp-mcp-bridge"],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          { name: "DSH_ACP_MCP_ENDPOINT", value: input.endpoint },
          { name: "DSH_ACP_MCP_AUTHORIZATION", value: input.authorization },
        ],
      },
    ],
    // serverId is the runtime's bridge-side correlation constant — the vendored
    // AcpMcpOverAcpBridge validates it verbatim (mcpOverAcpBridge.ts).
    acpServers: [{ type: "acp" as const, name: "whaleisle", serverId: "dsh-acp-agents" }],
    processEnvironment: {
      DSH_ACP_MCP_ENDPOINT: input.endpoint,
      DSH_ACP_MCP_AUTHORIZATION: input.authorization,
      DSH_ACP_MCP_NODE: input.bridgeCommand,
      DSH_ACP_MCP_ENTRYPOINT: input.bridgeEntrypoint,
    },
  };
}

// ---------------------------------------------------------------------------
// Client filesystem — the runtime's own symlink-aware containment implementation
// (apps/server AntigravityClientFiles.ts): realpath with parent fallback for
// missing files, allowed-roots check, 8 MiB read cap, 1-indexed line/limit.
// ---------------------------------------------------------------------------

export function clientFileSystem(allowedRoots: ReadonlyArray<string>) {
  // Pure NodeServices — no ManagedRuntime needed, resolve service values once.
  return Effect.runPromise(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return { fileSystem, path };
    }).pipe(Effect.provide(NodeServices.layer) as never) as AnyEffect<{
      fileSystem: FileSystem.FileSystem;
      path: Path.Path;
    }>,
  ).then((services) => ({
    readTextFile: (request: { path: string; line?: number | null; limit?: number | null }) =>
      Effect.runPromise(
        AntigravityClientFiles.readAntigravityClientTextFile({
          ...services,
          allowedRoots,
          request: request as never,
        }),
      ),
    writeTextFile: (request: { path: string; content: string }) =>
      Effect.runPromise(
        AntigravityClientFiles.writeAntigravityClientTextFile({
          ...services,
          allowedRoots,
          request: request as never,
        }),
      ),
  }));
}

// ---------------------------------------------------------------------------
// Antigravity — ACP runtime AntigravityDriver.makeRuntime verbatim: per-instance
// isolated profile, sealed spawn env (extendEnv:false), per-process runtime
// temp. Without this path the agent inherits the real GEMINI_HOME and its
// bundled localharness pairs with the user's live Antigravity IDE.
// ---------------------------------------------------------------------------

export interface AntigravityAuthConfigInput {
  readonly authMethod: string;
  readonly apiKey?: string;
  readonly gcpProject?: string;
  readonly gcpLocation?: string;
}

const antigravityAuthConfig = (input: AntigravityAuthConfigInput) =>
  ({
    authMethod: input.authMethod || "oauth-personal",
    apiKey: input.apiKey || "",
    gcpProject: input.gcpProject || "",
    gcpLocation: input.gcpLocation || "",
  }) as Parameters<typeof AntigravityAuthSupport.prepareAntigravityProfile>[0]["auth"];

const antigravityHarnessName =
  process.platform === "win32" ? "localharness_external.exe" : "localharness_external";

// The managed runtime installer (antigravityRelease.ts): hash-verified
// download from dl.google.com — NOT the ACP registry, whose latest build is a
// different behavior branch. The managed install lives under
// <stateDir>/tools/antigravity-acp/<platform>-<arch>/versions/<sha256>.
let agyInstallationService:
  | { service: AntigravityInstallation.AntigravityInstallationService; scope: Scope.Closeable }
  | undefined;
let agyInstallationPromise: Promise<AntigravityInstallation.AntigravityInstallationService> | undefined;

async function agyInstallation(baseDir: string) {
  if (agyInstallationPromise) return agyInstallationPromise;
  agyInstallationPromise = (async () => {
  if (!agyInstallationService) {
    const scope = await run(Scope.make());
    const service = await runCatch(
      AntigravityInstallation.makeAntigravityInstallation({ baseDir }).pipe(
        Effect.provideService(Scope.Scope, scope),
      ) as AnyEffect<AntigravityInstallation.AntigravityInstallationService>,
    ).catch(async (error) => { await run(Scope.close(scope, Exit.void)); throw error; });
    agyInstallationService = { service, scope };
  }
  return agyInstallationService.service;
  })();
  try { return await agyInstallationPromise; }
  catch (error) { agyInstallationPromise = undefined; throw error; }
}

export interface AntigravityManagedExecutable {
  readonly executablePath: string;
  readonly harnessPath: string | null;
  readonly version: string | null;
  readonly managedVersionDirectory: string | null;
}

/**
 * ACP runtime AntigravityInstallation.resolve — the active pinned release only.
 * `installIfMissing` runs service.start (pinned download + validation) when
 * resolve finds nothing, then resolves again.
 */
export async function antigravityManagedExecutable(input: {
  readonly baseDir: string;
  readonly installIfMissing?: boolean;
}): Promise<AntigravityManagedExecutable | null> {
  const service = await agyInstallation(input.baseDir);
  const resolved = await runCatch(
    service.resolve(undefined, undefined) as AnyEffect<AntigravityManagedExecutable>,
  ).catch(() => null);
  if (resolved) return resolved;
  if (!input.installIfMissing) return null;
  await runCatch(service.start as AnyEffect<unknown>);
  // The install forks into the service scope; poll state to a terminal phase.
  const terminal = await runCatch(
    Effect.gen(function* () {
      for (;;) {
        const state = yield* (service.state as AnyEffect<{
          phase: string;
          message?: string | null;
        }>);
        if (["succeeded", "failed", "cancelled"].includes(state.phase)) return state;
        yield* Effect.sleep("500 millis");
      }
    }).pipe(Effect.timeout("10 minutes")) as AnyEffect<{
      phase: string;
      message?: string | null;
    }>,
  );
  if (terminal.phase !== "succeeded") {
    throw new Error(terminal.message || "Antigravity installation did not complete.");
  }
  return runCatch(
    service.resolve(undefined, undefined) as AnyEffect<AntigravityManagedExecutable>,
  );
}

/** Acquire = resolve + managed-binary lease (held until release()). */
export async function antigravityAcquire(input: { readonly baseDir: string }): Promise<{
  readonly executable: AntigravityManagedExecutable;
  readonly release: () => Promise<void>;
}> {
  const service = await agyInstallation(input.baseDir);
  const scope = await run(Scope.make());
  const executable = await runCatch(
    service.acquire(undefined, undefined).pipe(
      Effect.provideService(Scope.Scope, scope),
    ) as AnyEffect<AntigravityManagedExecutable>,
  ).catch(async (error) => { await run(Scope.close(scope, Exit.void)); throw error; });
  return {
    executable,
    release: async () => {
      await runCatch(Scope.close(scope, Exit.void)).catch(() => {});
    },
  };
}

const antigravityExecutableFor = (executablePath: string) =>
  ({
    executablePath,
    harnessPath: /^agy(?:\.exe)?$/i.test(NodePath.basename(executablePath)) ? null : NodePath.join(NodePath.dirname(executablePath), antigravityHarnessName),
    source: "managed",
    version: null,
    managedVersionDirectory: NodePath.dirname(executablePath),
  }) as Parameters<typeof AntigravityAuthSupport.buildAntigravityAcpSpawnInput>[0]["installation"];

export interface AntigravityDirs {
  readonly profile: string;
  readonly runtimeTemp: string;
  readonly tokenPath: string;
}

/** ACP runtime resolveAntigravityInstanceDirectories + the profile's token path. No spawn. */
export async function antigravityInstanceDirs(
  stateDir: string,
  instanceId: string,
  profileDirectory?: string,
): Promise<AntigravityDirs> {
  const dirs = await runCatch(
    AntigravityAuthSupport.resolveAntigravityInstanceDirectories(
      stateDir,
      instanceId as never,
    ) as AnyEffect<{ profile: string; runtimeTemp: string }>,
  );
  return {
    profile: profileDirectory || dirs.profile,
    runtimeTemp: dirs.runtimeTemp,
    tokenPath: NodePath.join(profileDirectory || dirs.profile, "antigravity-acp", "acp_token.json"),
  };
}

/** The AcpSessionRuntime options ACP runtime pins for antigravity (makeAntigravityAcpRuntime). */
export function antigravitySessionOptions(input: {
  readonly authMethod?: string;
  readonly onAuthorizationUrl?: (url: string) => AnyEffect<void>;
}) {
  const authCallbacks = input.onAuthorizationUrl
    ? { onAuthorizationUrl: input.onAuthorizationUrl }
    : {};
  return {
    authMethodId: input.authMethod || "oauth-personal",
    authenticateEagerly: true,
    resumeMethod: "resume" as const,
    cancelBehavior: "wait-for-prompt" as const,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    },
    transformStdout: AntigravityAuthSupport.makeAntigravityStdoutTransform(authCallbacks),
    onStderr: AntigravityAuthSupport.makeAntigravityStderrHandler(authCallbacks),
    transformSessionUpdate: AntigravityProtocol.normalizeAntigravitySessionUpdate as never,
  };
}

export interface AntigravitySessionPlanInput {
  readonly instanceId: string;
  readonly profileDirectory?: string;
  readonly cwd: string;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly auth: AntigravityAuthConfigInput;
  readonly stateDir: string;
  readonly userHome?: string;
  readonly executablePath?: string;
}

export interface AntigravitySessionPlan {
  readonly spawn: ReturnType<typeof AntigravityAuthSupport.buildAntigravityAcpSpawnInput>;
  readonly profileDirectory: string;
  readonly runtimeTempDirectory: string;
  readonly executable: AntigravityManagedExecutable;
  readonly cleanup: () => Promise<void>;
}

/** ACP runtime AntigravityDriver makeRuntime lines 186-253, minus the session layer. */
export async function antigravitySessionPlan(
  input: AntigravitySessionPlanInput,
): Promise<AntigravitySessionPlan> {
  // installation.acquire — managed managed runtime (installs on demand).
  const executable = input.executablePath ? antigravityExecutableFor(input.executablePath) : await antigravityManagedExecutable({
    baseDir: input.stateDir,
    installIfMissing: true,
  });
  if (!executable) {
    throw new Error("Antigravity installation did not produce a runtime executable.");
  }
  const lease = input.executablePath ? { release: async () => {} } : await antigravityAcquire({ baseDir: input.stateDir });
  let runtimeTempDirectory: string | undefined;
  try {
  const dirs = await antigravityInstanceDirs(input.stateDir, input.instanceId, input.profileDirectory);
  const auth = antigravityAuthConfig(input.auth);
  const profile = await runCatch(
    AntigravityAuthSupport.prepareAntigravityProfile({
      profileDirectory: dirs.profile,
      baseEnv: input.baseEnv,
      auth,
      userHome: input.userHome,
      platform: process.platform,
      tempDirectory: dirs.runtimeTemp,
    } as never),
  );
  runtimeTempDirectory = await runCatch(
    Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
      fileSystem.makeTempDirectory({ directory: profile.tempDirectory, prefix: "run-" }),
    ),
  );
  const ownedDirectory = runtimeTempDirectory;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= (async () => {
    try {
      await runCatch(Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
        fileSystem.remove(ownedDirectory, { recursive: true, force: true })));
    } finally { await lease.release(); }
  })();
  return {
    spawn: AntigravityAuthSupport.buildAntigravityAcpSpawnInput({
      installation: executable as never,
      profile,
      cwd: input.cwd,
      baseEnv: input.baseEnv,
      auth,
      runtimeTempDirectory,
    }),
    profileDirectory: dirs.profile,
    runtimeTempDirectory,
    executable,
    cleanup,
  };
  } catch (error) {
    if (runtimeTempDirectory) await runCatch(Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(runtimeTempDirectory!, { recursive: true, force: true }))).catch(() => {});
    await lease.release();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Antigravity auth — ACP runtime makeAntigravityAuth + makeDisposableRuntime: the flow
// spawns a disposable runtime with a unique temp cwd, captures the Google
// sign-in URL from stdout, and forwards pasted redirect URLs to its loopback.
// ---------------------------------------------------------------------------

export interface CreateAntigravityAuthInput {
  readonly instanceId: string;
  readonly profileDirectory?: string;
  readonly stateDir: string;
  /** Resolves the installed server path (installs on demand) — called lazily at flow start. */
  readonly resolveExecutable: () => Promise<string>;
  readonly auth: AntigravityAuthConfigInput;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly userHome?: string;
  readonly onChanged?: (authenticated: boolean) => unknown;
  readonly stopSessions?: () => Promise<void>;
}

export interface AntigravityAuthHandle {
  readonly controller: {
    start: (owner: string, stop: AnyEffect<void>) => AnyEffect<unknown>;
    complete: (owner: string, input: { flowId: string; callbackUrl: string }) => AnyEffect<unknown>;
    cancel: (owner: string, flowId: string) => AnyEffect<unknown>;
    logout: (stop: AnyEffect<void>) => AnyEffect<unknown>;
    subscribe: (owner: string) => Stream.Stream<unknown>;
  };
  readonly owner: string;
  readonly scope: Scope.Closeable;
  readonly subscriptionFiber: Fiber.RuntimeFiber<void>;
  readonly stopSessions?: () => Promise<void>;
}

export async function createAntigravityAuth(
  input: CreateAntigravityAuthInput,
  onState?: (state: unknown) => void,
): Promise<AntigravityAuthHandle> {
  const scope = await run(Scope.make());
  const auth = antigravityAuthConfig(input.auth);
  const dirs = await antigravityInstanceDirs(input.stateDir, input.instanceId, input.profileDirectory);
  // AntigravityDriver.makeRuntime lines 186-268 + makeDisposableRuntime 270-313.
  const makeRuntime = (rtInput: {
    readonly onAuthorizationUrl?: (url: string) => AnyEffect<void>;
  }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      let sessionId: string | undefined;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "dsh-antigravity-setup-",
      });
      yield* Effect.addFinalizer(() =>
        AntigravitySessionFiles.removeAntigravitySessionFiles({
          profileDirectory: dirs.profile,
          sessionId,
          cwd,
        }),
      );
      const executablePath = yield* Effect.promise(() => input.resolveExecutable());
      const profile = yield* AntigravityAuthSupport.prepareAntigravityProfile({
        profileDirectory: dirs.profile,
        baseEnv: input.baseEnv,
        auth,
        userHome: input.userHome,
        platform: process.platform,
        tempDirectory: dirs.runtimeTemp,
      } as never);
      const runtimeTempDirectory = yield* fileSystem.makeTempDirectory({
        directory: profile.tempDirectory,
        prefix: "run-",
      });
      yield* Effect.addFinalizer(() =>
        fileSystem
          .remove(runtimeTempDirectory, { recursive: true, force: true })
          .pipe(Effect.catch(() => Effect.void)),
      );
      const context = yield* Layer.build(
        AcpSessionRuntime.layer({
          spawn: AntigravityAuthSupport.buildAntigravityAcpSpawnInput({
            installation: antigravityExecutableFor(executablePath),
            profile,
            cwd,
            baseEnv: input.baseEnv,
            auth,
            runtimeTempDirectory,
          }),
          cwd,
          clientInfo: { name: "dsh-acp-setup", version: "0.0.0" },
          mcpServers: [],
          ...antigravitySessionOptions({
            authMethod: auth.authMethod,
            ...(rtInput.onAuthorizationUrl
              ? { onAuthorizationUrl: rtInput.onAuthorizationUrl }
              : {}),
          }),
        } as never),
      );
      const service = Context.get(context, AcpSessionRuntime.AcpSessionRuntime);
      return {
        ...service,
        start: () =>
          service.start().pipe(
            Effect.tap((started) =>
              Effect.sync(() => {
                sessionId = (started as { sessionId?: string }).sessionId;
              }),
            ),
          ),
      };
    });
  const authFlow = await runCatch(
    AntigravityAuth.makeAntigravityAuth({
      instanceId: input.instanceId.replace(/^dsh:/, "dsh-") as never,
      makeRuntime: makeRuntime as never,
      onAuthenticated: () => asPromiseEffect(() => input.onChanged?.(true)),
      onSignedOut: asPromiseEffect(() => input.onChanged?.(false)),
      usesBrowser: AntigravityAuthSupport.antigravityAuthUsesBrowser(
        auth.authMethod as never,
      ),
    }).pipe(Effect.provideService(Scope.Scope, scope)) as AnyEffect<{
      controller: AntigravityAuthHandle["controller"];
    }>,
  ).catch(async (error) => { await run(Scope.close(scope, Exit.void)); throw error; });
  const owner = "dsh-webview";
  const subscriptionFiber = rt().runFork(
    Stream.runForEach(authFlow.controller.subscribe(owner), (state) =>
      Effect.sync(() => {
        try {
          onState?.(state);
        } catch {
          // Listener errors must not kill auth state propagation.
        }
      }),
    ),
  );
  return {
    controller: authFlow.controller,
    owner,
    scope,
    subscriptionFiber: subscriptionFiber as Fiber.RuntimeFiber<void>,
    stopSessions: input.stopSessions,
  };
}

/** Same surface as authFlowApi; the agy controller has no respond/method probe. */
export function antigravityAuthApi(handle: AntigravityAuthHandle) {
  const stopSessions = asPromiseEffect(() => handle.stopSessions?.());
  return {
    start: () => runCatch(handle.controller.start(handle.owner, stopSessions)),
    respond: () => Promise.resolve(false),
    complete: (input: { flowId: string; callbackUrl: string }) =>
      runCatch(handle.controller.complete(handle.owner, input)),
    cancel: (flowId: string) => runCatch(handle.controller.cancel(handle.owner, flowId)),
    logout: () => runCatch(handle.controller.logout(stopSessions)),
    refreshMethods: () =>
      Promise.resolve({
        methods: [{ id: "oauth-personal", name: "Log in with Google", type: "browser" }],
      }),
    invalidate: () => Promise.resolve(),
    isChangingCredentials: () => Promise.resolve(false),
    adoptCredentials: () => Promise.resolve(),
    dispose: async () => {
      await rt().runPromise(Fiber.interrupt(handle.subscriptionFiber));
      await runCatch(Scope.close(handle.scope, Exit.void));
    },
  };
}

// ---------------------------------------------------------------------------
// Re-exported ACP runtime helpers for the DSH glue layer
// ---------------------------------------------------------------------------

export const providers = {
  AcpSessionRuntime,
  AcpRuntimeModel,
  AcpSessionConfig,
  AcpClientPolicy,
  AcpClientTerminals,
  AcpStderr,
  AcpNativeLogging,
  AcpMcpOverAcpBridge,
  AcpRegistrySupport,
  AcpRegistryRuntimeCoordinator,
  AcpRegistryAuth,
  AcpRegistryProbe,
  ProviderAuthFlow,
  DevinAcp,
  ClaudeAcp,
  CopilotAcp,
  DroidAcp,
  AcpMcpStdioBridge,
  AntigravityAuthSupport,
  AntigravityProtocol,
  AntigravityAcpSupport,
};

export const effect = {
  Effect,
  EffectCrypto,
  NodeCrypto,
  Stream,
  Scope,
  Exit,
  Fiber,
  Deferred,
  Option,
  Cause,
  Layer,
  Context,
  run,
  runScoped,
  runCatch,
  asEffect,
  asPromiseEffect,
};

// Agent-specific session-update normalizers keyed by registry agentId —
// mirrors the transform wiring in the runtime's registry driver.
const agentSessionUpdateNormalizers: Record<
  string,
  (notification: never) => never
> = {
  devin: DevinAcp.normalizeDevinSessionUpdate as never,
};

export function sessionUpdateNormalizerFor(
  agentId: string,
): ((notification: never) => never) | undefined {
  return agentSessionUpdateNormalizers[agentId];
}
