# Stateful-agent context ownership on DSH 0.2.2-rc.2

ACP sessions retain their own conversation and perform their own context management. A host-generated summary cannot replace that native session. The ACP adapter therefore resolves each model with `contextManagement: 'provider'`. Reported `context` capacity remains factual metadata, not a guessed value.

DSH 0.2.2-rc.2 drops this field during model normalization and requires a known context capacity when switching models with history. The accompanying server compatibility update:

- validates and preserves the optional ownership field in `LlmRuntime.normalizeModelInfo`;
- skips automatic pressure and overflow compaction only for provider-managed routes;
- rejects manual host summarization for those routes before a summary can replace history;
- preserves ordinary LLM capacity checks, compaction, errors, and cancellation.

The corresponding host source contract is one optional field on `LlmResolvedModelInfo`:

```ts
/** Stateful agent adapters own context reduction instead of the harness. */
contextManagement?: 'provider'
```

`context-owner.mjs` prepares the two published server modules for a stopped-host update. It does not edit installed modules or run during plugin activation. It accepts only version `0.2.2-rc.2` and exact, unique code anchors; unsupported builds fail without changing the host. Each output directory is write-once and retains the originals for recovery.

```powershell
node tools/host-compat/context-owner.mjs C:/path/to/dsh/package.json C:/path/to/new-context-update
```

The output manifest identifies the actual two module targets. The host's updater must back up those targets, compare them with the prepared originals, and apply the candidates while the host is stopped. Browser assets are unchanged. Revert by restoring the original module files with the host stopped. Plugin-only installation repairs settings navigation and reasoning choices, but does not repair model switching with history on an unmodified 0.2.2-rc.2 host. New host versions require inspecting their context contract before using this compatibility update.

Run `npm run test:host-compat` with `DSH_COMPAT_HOST_PACKAGE` set to that host's CLI `package.json` to exercise the actual server module transformations, ordinary capacity guards, unsupported builds and preparation cleanup. These tests send no model requests and do not write to the installed host.
