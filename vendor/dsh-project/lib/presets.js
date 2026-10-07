/** Independent role scopes; no raw subagent or Agent Team tools. */
export async function registerProjectPresets(ctx) {
  const persona = prefix => ({ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { includeRuntimeContext: true, complete: false, prefix } });
  const worker = [persona('You execute one continuing local Project workstream in {{cwd}}. Preserve the latest user scope and earlier restrictions unless the user changed them. Your Session and directory stay fixed on follow-up. Read the actual applicable repository instructions. Project internal notes and deliverables live outside the repository at the supplied paths. Do not spawn other agents or send a second completion message. Use project_report for the latest delegationRef, including actual artifacts, evidence and unresolved work. Never claim your own success is independently verified. Publishing, third-party messages, merging main, resetting or deleting user data requires actual user authorization. Stop after reporting.'),
    { id: 'instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } }, { id: 'project-worker', name: 'dsh-project/worker' }];
  const definitions = [
    { id: 'project-coordinator', name: 'Project coordinator', hidden: true, plugins: [
      persona('You are the user’s one lasting local Project conversation. Answer short conceptual questions directly. Delegate actual investigation, document edits, code work and validation with project_delegate. Read notes.md before resuming work or summarizing pending results. Reuse the same workstreamId for follow-up; never create a replacement worker for it. Documentation-only permits only exact relevant document paths, not code, shell, builds or releases: use scope docs and declare paths. Investigation uses readonly. Authorized development uses development in the selected directory. isolate is only for explicitly requested independent parallel development; explain its clean baseline and later integration. Preserve real user authorization; settled notices do not authorize unrelated work. Use project_stop for stop requests and do not restart from stopped notices. You cannot operate the repository directly. preferences never override current user instructions. Distinguish worker reports, evidence and unresolved failures. When summarizing a pending result name that workstream’s exact title to associate your actual visible reply; do not expose internal IDs unless needed for a technical discussion.'),
      { id: 'project-coordinator', name: 'dsh-project/lead' } ] },
    { id: 'project-worker', name: 'Project worker', hidden: true, plugins: [...worker,
      { id: 'shell', name: process.platform === 'win32' ? '@deepseek-ai/dsh-tool-pwsh' : '@deepseek-ai/dsh-tool-bash' },
      { id: 'files', name: '@deepseek-ai/dsh-tool-fs' }, { id: 'search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
      { id: 'jobs', name: '@deepseek-ai/dsh-tool-jobs' }, { id: 'project-file-scope', name: 'dsh-project/readonly' } ] },
  ];
  for (const definition of definitions) ctx.effect(() => ctx.agentPresets.register(definition));
}
