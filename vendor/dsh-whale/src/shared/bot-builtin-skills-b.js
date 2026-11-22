// Orca built-in bot skills (part B: support, planning & ops).

export const BOT_BUILTIN_SKILLS_PART_B = Object.freeze({
  "issue-triage": `---
name: issue-triage
description: Triage an issue or report, labels, duplicates and missing details, asking for what is missing in one comment.
---

# Triaging an issue

## For each new issue or report

1. **Read it all**, including screenshots and logs.
2. **Kind:** bug, feature request, question, or support. Use the labels the project already has; never invent new ones.
3. **Area:** the part of the product it is about, if the project labels areas.
4. **Duplicates:** search open and recently closed issues for the same symptom. Link the best match and say why it matches.
5. **Missing details:** for a bug, check for version, platform, steps, expected and actual result. List what is missing.

## Asking for details

Ask once, in one comment, for everything missing. Be specific ("Which version? Settings → About shows it.") and polite. Don't ask for what is already there.

## Report

One line per issue: link, proposed kind and labels, likely duplicate (if any), and what is missing. Apply labels, close duplicates or post comments only when your owner said you can.
`,
  "feedback-themes": `---
name: feedback-themes
description: Group feedback into themes with counts and short quotes, linking issues that already exist.
---

# Feedback themes

## Collect

- Read every message in the period and channels you were given. Count people, not messages: one person repeating themselves counts once.
- Skip thanks, chatter and messages you can't tie to the product.

## Group

- A theme is one problem or wish, named in the user's words ("pasting in the terminal drops lines"), not a product area ("terminal").
- Put each message in at most one theme. Leave out themes with a single person unless they are severe.

## For each theme

- How many people, and whether that grew since last time.
- One or two short quotes, as written, with a link.
- The existing issue it matches, if there is one; otherwise say there's none.

## Report

Biggest theme first. Then a short "new this time" line for themes that weren't there before. Keep it to what fits on one screen.
`,
  "status-brief": `---
name: status-brief
description: Write a short status brief, what changed, what is blocked, what needs a decision, in under ten lines.
---

# Status brief

A brief is read in under a minute. Under ten lines, always.

## Three parts

1. **Changed:** what moved since the last brief. Merged pull requests, closed issues, finished work. Group small items ("6 issues closed").
2. **Blocked:** what can't move, and on whom or what. Include how long it has been blocked.
3. **Needs a decision:** questions only a person can answer, with a link to where the question is.

## Rules

- Lead with the part that needs action, if there is one.
- Links instead of descriptions. Numbers instead of adjectives.
- Leave out anything unchanged since the last brief.
- If nothing changed, say so in one line.
`,
  "spec-format": `---
name: spec-format
description: Turn a discussion into a one-page spec, problem, decision, scope and open questions.
---

# One-page spec

## Sections

1. **Problem:** who has it, when, and what it costs them. Two or three sentences.
2. **Decision:** what was agreed, stated plainly. If nothing was agreed, say so and list the options.
3. **Scope:** what is in, and what is explicitly out.
4. **Open questions:** each one with who can answer it.

## Rules

- One page. Cut background that doesn't change the decision.
- Use the discussion's own facts; mark anything you inferred.
- Link the source thread or doc at the top.
- Ask your owner about every open question before calling the spec done.
`,
  "incident-timeline": `---
name: incident-timeline
description: Keep a timestamped incident timeline, then draft a blameless write-up when the incident is over.
---

# Incident timeline

## During the incident

- Add an entry for each event that matters: alert fired, someone joined, a cause was suspected or ruled out, a change was made, impact started or ended.
- Each entry: time (with time zone), what happened, link to the message or graph.
- Write facts, not judgements. Note who did something only when it matters for the timeline.

## When it is over

Draft the write-up:

1. **Summary:** what broke, for whom, and for how long.
2. **Timeline:** the entries above, trimmed.
3. **Cause:** what made it happen, and what let it reach users.
4. **What went well and what didn't.**
5. **Follow-ups:** each with an owner to be agreed.

Blameless: describe systems and decisions, never fault people. Post the draft here for your owner to edit.
`,
  "workspace-hygiene": `---
name: workspace-hygiene
description: When an Orca workspace is done or abandoned, and what to check before removing it.
---

# Workspace hygiene

## Done or abandoned

- **Done:** its pull request merged or closed, and nothing new since.
- **Abandoned:** no changes for two weeks or more and no open pull request.
- **Folder workspaces** have no branch or pull request: judge them by recent activity only.

## Before removing one, check

1. Uncommitted changes. List the files.
2. Commits that were never pushed.
3. A running agent or terminal in it.

Never remove a workspace with uncommitted or unpushed work unless your owner names it and says so.

## Report

A list: workspace, why it looks done or abandoned, and anything from the checks above. Remove only the ones your owner picks, with \`orca worktree rm\`.
`,
});
