---
name: dsh-doc
description: Create, restructure, review, audit, or migrate DeepSeek Harness Markdown documentation, package READMEs, and the documentation website using audience-first hierarchy, kind-mapped YAML metadata, bilingual line alignment, summary/contents navigation, progressive user-to-developer detail, executed-operation fact-checking, and repository validation. Use for new or revised DSH docs, docs-tree organization, documentation review, website page publishing, and bilingual documentation structure changes.
---

# DeepSeek Harness documentation

Maintenance execution follows only [WhaleIsle policy](../../../../../docs/maintenance/README.md). This skill supplies optional writing mechanics; it adds no gates, approvals, test preparation order or numeric targets.

## Summary

Use this skill for documentation placement, metadata, bilingual structure and website projection. WhaleIsle maintenance policy selects the scope, development order and verification. Preserve one owner per fact and link it from derivative pages. The `session-persistence-jsonl` README pair is a format example.

## Table of Contents

- [Workflow](#workflow)
- [Fact-check procedure: test, do not assume](#fact-check-procedure-test-do-not-assume)
- [Kind system and templates](#kind-system-and-templates)
- [Voice rules](#voice-rules)
- [Quality criteria](#quality-criteria)
- [Audit the corpus](#audit-the-corpus)
- [Website publication](#website-publication)
- [Detailed references](#detailed-references)
- [Validation](#validation)
- [Dev Note](#dev-note)

## Workflow

Follow this sequence for each requested scope. Keep the common reader path brief, but do not delete failures, ownership, limitations, or other required contracts merely to reduce words.

1. Read root and more-specific `AGENTS.md`, [the documentation standard](../../../docs/AGENTS.md), the target page, its source/tests, navigation owner, and bilingual record.
2. Classify the page by one primary job and reader: product quick start, user task guide, contributor tutorial, architecture overview, package/subsystem reference, generated reference, agent instruction, decision record, or scratch.
3. Place the page at its nearest owner. Keep package contracts beside package code; use `docs/` for cross-package learning, user, developer, architecture, discussion, and expiring scratch material.
4. Define the reader's starting state, observable outcome, likely failure, recovery path, and next useful depth before writing details.
5. Add or revise YAML metadata — assign the `kind` that maps to the template for this document's job — then write `Summary`, `Table of Contents`, user-facing content, developer-facing content, optional `Further Exploration`, and final `Dev Note` in that order where the document type permits.
6. Update the bilingual counterpart in the same pass. Keep headings, lists, tables, code, links, frontmatter layout, and physical line count aligned.
7. Ground changed claims in their current owner. Update the owner before a derivative artifact; distinguish source-derived facts from directly observed results.
8. After implementation, select necessary checks under WhaleIsle policy; do not automatically run a full documentation, lint or test chain. Review the changed scope for factual accuracy and navigation.

## Fact-check procedure: test, do not assume

Use source evidence for documented contracts and actual operations for claims of successful behavior. This guidance does not add a separate verification matrix; missing observations must not be presented as successful execution.

1. **Classify the subject before writing install guidance.** Read the facts, never the folder name: `package.json` for a `dsh.bundle.patch` declaration, and the entry file for the plugin shape (`apply` export or a default service export is a plugin; a plain module API is a library). A bundle installs with `dsh plugin --profile <name> add <package>` and is the only package shape for which that command activates a profile layer; a plugin mounts as a `cordis.yml` row; a library is a dependency with no install path of its own. Packages with special status (libraries, bundles) get their own README template — never a plugin README with install guidance that does not apply.
2. **Observe necessary operations after implementation.** Select changed user paths under the host policy. If keys or networks are missing, report the verification gap; do not claim success or run unrelated examples.
3. **Correct unsupported claims.** Ground fields, defaults and commands in current owners. An unexecuted documented contract is distinct from a verified successful operation; do not delete required behavior to remove a failed check.
4. **Use the current checkout.** Compare changed claims with their owning code and confirmed pairing record; do not fetch a different upstream branch as a routine prerequisite.
5. **Confirm the completed pair.** Review both changed languages, then use the selected pairing write operation once for the stable content.

## Kind system and templates

The `kind` frontmatter field selects exactly one README template. Every kind in [the metadata reference](references/metadata-links-i18n.md#the-kind-system) maps to one template file in [`templates/`](templates/), and every template backs exactly one kind; the documentation check derives the expected kind from the same mechanical facts.

- `package-group` → [templates/package-group.md](templates/package-group.md): group maps (`packages/README.md`, `packages/<group>/README.md`) — orient the family, map its direct packages, link package-owned details.
- `package-reference` → [templates/package-reference.md](templates/package-reference.md): a Cordis plugin or service package — mount configuration, the config table, folded implementation, Model Experience and Known Limitations in the gate-owned forms.
- `package-library` → [templates/package-library.md](templates/package-library.md): a package with no plugin surface — consumer entry points, no profile-install path, no mount configuration.
- `package-bundle` → [templates/package-bundle.md](templates/package-bundle.md): a package declaring `dsh.bundle.patch` — the verified `dsh plugin` install path, layer semantics, patch document.
- `persistence-change` → [templates/persistence-change.md](templates/persistence-change.md): a dated record in `docs/persistence-changes/` — acknowledge a detected type transition with per-root predecessors and generated after schemas.
- `persistence-release` → [templates/persistence-release.md](templates/persistence-release.md): a pinned tag in `docs/persistence-changes/releases/` — compare reconstructed historical types without claiming compatibility acknowledgement.
- `persistence-format` → [templates/persistence-format.md](templates/persistence-format.md): a historical Session format checkpoint in `docs/persistence-changes/historical-formats/`, with complete schemas; the current writer uses the existing catalog.
- `upgrade-guide` → [templates/upgrade-guide.md](templates/upgrade-guide.md): `docs/upgrade-guide/v<version>/<item>/guide.md` and its Chinese sibling — migration steps for one externally perceptible break, owned by [dsh-create-upgrade-guide](../dsh-create-upgrade-guide/SKILL.md).

Open the template before writing and follow its skeleton and rules; it states what the kind is, how the page is structured, and the fact checks each section owes. Add a new kind only together with a distinct template file, a documented repository position or declared owner, and a focused check that maps documents to it.

## Voice rules

These rules decide what a section may say. They apply to every authored human-facing page, and to package READMEs with particular force.

- **Summary says what the subject does.** The opening `Summary` and the user-facing sections describe what a user or agent can DO with the subject — outcomes, benefits, when to choose it, main cost — never its role, type, or internal identity. In a package Summary, “what it is” means only its reader-visible capability, not its Cordis role, registrations, or internal components. Omit source identifiers unless the reader directly uses them in configuration, a command, or a public API. "The seam registers `ctx.x` and appends `x/event` records" is identity narration; "you can save a note per message and it survives restarts" is what it does.
- **Developer sections explain, never enumerate.** Folded implementation content covers the overall design concept, architecture, and hand-waving dataflow — enough to understand how the package works — and links code for exact detail. No full API catalogs, exhaustive column lists, event-payload enumerations, or JSDoc restatement inside the folds.
- **Dev Note is the only slop zone.** Partial ideas, scratches, undecided directions, measured artifacts, and working hypotheses live only in the final Dev Note, marked explicitly non-authoritative. Every other section is polished, current-state prose.
- **Current state only.** Ordinary documentation describes the current codebase. Dedicated `persistence-change`, `persistence-release`, and `persistence-format` records retain historical type evidence; release comparisons and format checkpoints describe observed history without asserting compatibility. An `upgrade-guide` describes the change from its version directory's release to the next one. Agent Notes and postmortems retain their own historical scope.
- **Use controlled technical English.** Give each sentence an explicit actor and one main action when ambiguity can change behavior. Reuse one term per concept, prefer direct verbs, split stacked instructions and conditions, and preserve modality and exceptions. Apply the non-certified, ASD-STE100-inspired discipline in [the page-style reference](references/style.md#controlled-technical-english). Do not force a shorter sentence when precision would fall.

## Quality criteria

Use these definitions in review. Each section opens with a short orienting paragraph before subsections or exhaustive detail.

- **Brief:** the common path contains only facts needed for its outcome; exhaustive truth remains one direct link or detail layer away.
- **Intuitive:** prerequisites precede dependent concepts, one next action is obvious, and headings use terms readers search for.
- **Friendly:** readers can recognize success, understand risk before acting, recover from likely failure, and choose whether to continue deeper.
- **Accurate:** each durable claim has one owner and a verification path proportionate to its risk.
- **Agent-readable:** metadata, stable headings, anchors, terminology, ownership, and current/proposed status support targeted retrieval without loading the corpus.
- **Newcomer-complete:** a professional engineer with no repository context can reconstruct the relevant architecture or feature through three to five linked pages.

Do not apply a universal word limit to exhaustive references. Measure entry-path length, unrelated material scanned for one lookup, largest section, heading count, and page size; split by an existing domain owner when retrieval cost is high.

## Audit the corpus

Read, do not re-summarize, the owning contracts: [docs/AGENTS.md](../../../docs/AGENTS.md) for hierarchy, tutorial/reference forms, taxonomy and the slop checklist; [.agents/notes/README.md](../../notes/README.md) for Agent Note lifecycle; [docs/i18n/README.md](../../../docs/i18n/README.md) for the bilingual pairing rules; and [root AGENTS.md](../../../AGENTS.md) for standing orders. Exclude `.agents/notes/archived/` from audits and edits — archived notes are frozen history.

Apply the standard's authoring order to every human-facing document in scope (not to Agent Notes): locate the document and state its own subject; set the permitted detail level and move deeper explanations to owning descendants with links; classify tutorial or reference from intended use, not path; for a tutorial, order concepts by prerequisite and difficulty; split substantial mixed forms. Then check placement constraints: paired docs cost a counterpart update and a `--write` re-record on every edit; generated catalogs are never hand-edited; a move is atomic with every inbound link repaired in the same change.

After the structural pass, hunt the slop checklist with the cheapest probes first. Use [dsh-trim-cot-leakage](../dsh-trim-cot-leakage/SKILL.md) for reasoning-transcript leakage, grep distinctive phrases to find duplicated rules, replace hand-written catalogs and status inventories with their authoritative owners, and remove migration plans and future-tense spec language from implemented Agent Notes. Review unclear or duplicated content without word-count targets; if removing prose changes a promised behavior rather than its explanation, propose the behavior change first (follow [dsh-find-simplifications](../dsh-find-simplifications/SKILL.md)). Keep every load-bearing rule, preferably as one to three lines plus a link to its rationale; do not create a new explanation merely to relocate disposable reasoning.

## Website publication

The website is a tested projection, never a second copy: [website/docs.ts](../../../website/docs.ts) is the explicit public allowlist mapping canonical `docs/` sources into route trees, [scripts/project-doc-site.ts](../../../scripts/project-doc-site.ts) rewrites them into the disposable `website/.generated/` tree, and VitePress builds that tree. Repository Markdown stays the only editable content source; translations stay sibling pairs (`foo.md`, `foo.zh.md`, `foo.i18n.yaml`), never locale directories. Edit an already published page in its canonical source only; add one manifest entry for a new page; update source, manifest entry, and inbound links atomically for a move or removal; never edit `website/.generated/`, `website/.cache/`, or `website/.dist/`. Set every `DocsPage` field deliberately and honor the projector's link rules; see [references/website-sync.md](references/website-sync.md) for the fields, sidebar collections, and preview commands. Synchronizing content into the build does not publish it: deployment stays a separate, explicitly requested step.

## Detailed references

Load only the reference needed for the task. Each reference links directly from this file so the skill has no deep reference chain.

- [Metadata, links, and bilingual pairs](references/metadata-links-i18n.md): README frontmatter, the kind system and its derivation, description semantics, repository paths, line alignment, and the sidecar record.
- [Page structure and hierarchy](references/structure-hierarchy.md): mandatory section order, section summaries, user-to-developer progression, docs tree placement, small rule files, Further Exploration, and Dev Note ownership.
- [Page style](references/style.md): short Summary, `-----` section separators, foldable content sections, and emphasis discipline.
- [Review criteria](references/review.md): newcomer test, evidence checks, package README review, the reference example, and verification commands.
- [Website publication](references/website-sync.md): manifest fields, projector link rules, preview and validation, and deployment separation.

The templates in [`templates/`](templates/) provide one working skeleton per `kind`; open the one your document's kind names before writing.

Use [dsh-prose-standard](../dsh-prose-standard/SKILL.md) for sentence-level contract coverage and editorial judgment. The `session-persistence-jsonl` README pair ([English](../../../packages/session/session-persistence-jsonl/README.md), [Chinese](../../../packages/session/session-persistence-jsonl/README.zh.md)) is the reference example: searchable YAML, Summary and Table of Contents, user-to-developer progression with a folded developer section, Further Exploration, canonical Model Experience and Known Limitations sections, and a final Dev Note.

## Validation

Validate the affected format, not merely Markdown syntax. A strong promise needs a focused valid fixture and an invalid fixture that proves the top-level gate can fail.

- README metadata: parse YAML, map `kind` to its template and document standard, reject `name`, `audience`, ungoverned `tags`, and README-local `i18n` metadata, and reject missing or advertisement-style descriptions.
- Bilingual pages: verify structure, exact line count, terminology, link parity, and the sidecar record.
- Tutorials: exercise the documented entry path or name an explicit manual verification owner.
- Generated references: run the deterministic freshness check and report retrieval-size measures.
- Package READMEs: run the Summary gate, which limits each English Summary to 100 `wc -w`-style words and directs failures back to this skill and the kind template; run model-experience and limitation checks, then package-focused tests when behavior claims changed; re-run every command the README instructs before merging a claim about it.
- Skills: run the repository's skill-invocation metadata check.

Select only checks relevant to the changed documentation under host maintenance policy; do not chain comprehensive documentation suites.

## Dev Note

None.
