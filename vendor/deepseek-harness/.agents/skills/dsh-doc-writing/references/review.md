# Review criteria

## Summary

Review documentation by whether a reader completes an outcome, not by whether every template heading exists. Verify prose against code and tests, preserve exact contracts, and keep package READMEs useful to consumers while exposing enough implementation detail for maintainers. Run current repository gates; the `session-persistence-jsonl` README pair is the reference example of the format.

## Table of Contents

- [Newcomer test](#newcomer-test)
- [Evidence review](#evidence-review)
- [Package README review](#package-readme-review)
- [Reference example](#reference-example)
- [Verification](#verification)
- [Dev Note](#dev-note)

## Newcomer test

A professional engineer with no repository context should answer the following after three to five linked pages: what the product or feature does, how to run or use it safely, where its state lives, which component owns it, how it fails, and where to change it. If the reader must inspect source merely to discover the public flow, restore the missing explanation. If the reader must absorb unrelated internals, move those details deeper.

## Evidence review

Check each material statement against its strongest owner. Use package metadata for names and entry points, public types and JSDoc for API contracts, runtime code for behavior, tests for exercised failure paths, generated catalogs for exhaustive inventories, and active Agent Notes for rationale. Never treat a prior README, discussion, or report as stronger than current code and tests.

Ground documented contracts in their current source. Claims of successful execution require actual observations of the necessary changed paths after implementation. State missing keys or network prerequisites as verification gaps. Use the current checkout and confirmed pairing record; unrelated upstream fetches and execution of unchanged examples are not routine prerequisites.

Classify the package before reviewing its install guidance: `dsh.bundle.patch` in `package.json` makes it a bundle (installable via `dsh plugin --profile <name> add <package>`, the only shape that command activates as a layer); an `apply` export or default service export makes it a plugin (mounted as a `cordis.yml` row); a plain module API makes it a library (a dependency with no install path). Reject install guidance written for another shape.

Retain a statement only when it helps the target reader act, reason, or avoid misuse. Move rationale, history, test walkthroughs, duplicate catalogs, and unrelated package detail to their owners.

## Package README review

Require the following without forcing one universal internal heading set:

- searchable YAML metadata with a precise `description` and the mechanically derived `kind` (`package-group`, `package-reference`, `package-library`, or `package-bundle`);
- a three-to-five-sentence English Summary of at most 100 `wc -w`-style words that says what the subject DOES for its user or agent reader, with a linked Table of Contents;
- controlled English with explicit actors, stable terms, direct verbs, separated instructions and conditions, and unchanged modality;
- when to choose or avoid the package;
- a smallest safe configuration or usage path when one exists — for a bundle, the verified `dsh plugin` install path; for a library, the consumer entry point; never profile-install guidance for a shape that does not take it;
- observable behavior, failures, durability, security, and performance limits relevant to consumers;
- developer-facing ownership and data/lifecycle design at concept level — overall design, architecture, hand-waving dataflow — that cannot be recovered cheaply from public types, with code links for exact detail;
- canonical Model Experience and Known Limitations sections required by package policy;
- newcomer-facing Further Exploration where adjacent docs materially help;
- a final non-authoritative Dev Note as the only home for partial ideas, scratches, and undecided directions.

Do not restate JSDoc or generated catalogs. Link the owner and explain only the decision or relationship needed locally. A package Summary describes reader-visible capability rather than Cordis roles, registrations, or internal components, and it omits source identifiers unless readers directly use them in configuration, commands, or a public API. Reject any user-facing section that narrates internals (function subjects, event streams, data flow) and any fold that enumerates APIs instead of explaining the concept.

## Reference example

The `session-persistence-jsonl` README pair ([English](../../../../packages/session/session-persistence-jsonl/README.md), [Chinese](../../../../packages/session/session-persistence-jsonl/README.zh.md)) demonstrates the format in production: searchable YAML whose `kind` selects this package-reference standard, a four-sentence Summary, a linked Table of Contents, a user-facing use section covering selection, configuration, layout, durability, and reading, a GitHub-native `<details>` fold for developer-facing design and storage details, Further Exploration, canonical Model Experience and Known Limitations sections, and a final Dev Note. Use its structure, evidence standards, and bilingual alignment as the model for package READMEs and cross-package pages; ground every claim in its owning source and evidence.

## Verification

After implementation, select necessary checks under [WhaleIsle policy](../../../../../../docs/maintenance/README.md). The following are available tools, not a mandatory chain:

```sh
pnpm run test:docs
pnpm run verify-translation-pairing --write <pair>
pnpm run doc-sync
pnpm run lint
git diff --check
```

Choose a skill metadata check only when its metadata changes. Review changed bilingual structure and factual meaning before recording a pair; review the final changed scope for completeness and navigation.

## Dev Note

None.
