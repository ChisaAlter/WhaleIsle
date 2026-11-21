/** Independent review dispatch, finding verification and incremental rework loop for Project workstreams. */

const latest = work => work.delegations.find(item => item.ref === work.currentDelegationRef) ?? work.delegations.at(-1);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function requiredText(value, label, limit = 32000) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${label}.`);
  return value.trim();
}

function normalizeFindings(findings) {
  if (!Array.isArray(findings) || !findings.length) return [];
  const seen = new Set();
  return findings.map((item, index) => {
    const id = String(item?.id ?? `F${index + 1}`).trim();
    if (!id || seen.has(id)) throw fail('review_finding', `Duplicate or empty review finding id "${id}".`);
    seen.add(id);
    const summary = String(item?.summary ?? '').trim();
    if (!summary) throw fail('review_finding', `Review finding "${id}" requires a non-empty summary.`);
    return {
      id,
      ...(item.severity ? { severity: item.severity } : {}),
      ...(item.file ? { file: String(item.file).trim() } : {}),
      summary,
      ...(item.evidence ? { evidence: String(item.evidence).trim() } : {}),
      status: item.status ?? 'pending',
      ...(item.verificationNote ? { verificationNote: String(item.verificationNote).trim() } : {}),
      ...(item.verifiedAt ? { verifiedAt: item.verifiedAt } : {}),
      ...(item.verifiedBy ? { verifiedBy: item.verifiedBy } : {}),
    };
  });
}

function reviewerBrief(project, work, receipt, instructions) {
  const artifacts = (receipt.report.artifacts ?? []).map(item => `- ${item.path} (sha256: ${item.sha256.slice(0, 12)})`).join('\n') || '- (none)';
  const evidence = (receipt.report.evidence ?? []).map(item => `- ${item}`).join('\n') || '- (none)';
  const issues = (receipt.report.remainingIssues ?? []).map(item => `- ${item}`).join('\n') || '- (none)';
  const probeIssues = (receipt.report.probeSummary?.issues ?? []).map(item => `- ${item}`).join('\n');
  return [
    `Independent readonly review of workstream "${work.title}" (${work.id}, delegation ${receipt.ref}, report ${receipt.report.callId}).`,
    `Project directory: ${project.canonicalWorkingDirectory}`,
    'You are context-isolated from the implementer. Inspect the actual files and artifacts on disk directly; never trust the implementer summary without reading the real code/output.',
    '',
    'Original assignment brief:',
    receipt.brief,
    '',
    `Implementer reported outcome: ${receipt.report.outcome}`,
    `Implementer summary: ${receipt.report.summary}`,
    'Claimed artifacts:',
    artifacts,
    'Claimed evidence:',
    evidence,
    'Reported remaining issues:',
    issues,
    ...(probeIssues ? ['Deterministic evidence probe issues:', probeIssues] : []),
    ...(instructions ? ['', 'Additional review focus:', instructions] : []),
    '',
    'Report concrete findings (file, line/symbol, observable defect or verification evidence) via project_report. Do not modify repository files.',
  ].join('\n');
}

function locateReviewTarget(service, actor, input) {
  const project = actor.project;
  const work = service.stream(input.workstreamId, project.id);
  const receipt = latest(work);
  const worker = service.worker(work.workerSessionId);
  if (receipt.ref !== input.delegationRef || receipt.report?.callId !== input.reportId) {
    throw fail('obsolete_result', 'Review the exact current report.');
  }
  const settled = work.settlements.some(terminal => terminal.runId === receipt.runId && terminal.delegationRefs.includes(receipt.ref));
  if (worker.activeRunId || service.jobs(worker.sessionId).length || !settled) {
    throw fail('work_pending', 'Review after the actual run and jobs settle.');
  }
  return { project, work, receipt };
}

async function dispatchIndependentReviewer(service, actor, input, exec) {
  const { project, work, receipt } = locateReviewTarget(service, actor, input);
  const sourceRequestId = receipt.source?.requestId;
  const reviewTitle = input.reviewerTitle?.trim() || `Review: ${work.title}`;
  const brief = reviewerBrief(project, work, receipt, input.reason?.trim() || input.instructions?.trim());
  const delegated = await service.delegate(actor, {
    ...(sourceRequestId ? { requestId: sourceRequestId } : {}),
    title: reviewTitle,
    brief,
    scope: 'readonly',
    nativeProvider: 'spawn',
    reviewerFor: { workstreamId: work.id, delegationRef: receipt.ref, reportId: receipt.report.callId },
  }, exec);
  const review = {
    reportId: receipt.report.callId,
    decision: 'pending_verification',
    reason: input.reason?.trim() || `Dispatched context-isolated readonly reviewer (${delegated.workstreamId}).`,
    evidence: (input.evidence ?? []).filter(Boolean),
    reviewerWorkstreamId: delegated.workstreamId,
    reviewerDelegationRef: delegated.delegationRef,
    at: Date.now(),
  };
  await service.serial(() => service.write(state => {
    const target = state.workstreams.find(row => row.id === work.id)?.delegations.find(row => row.ref === receipt.ref);
    if (target) target.review = review;
  }));
  return {
    workstreamId: work.id,
    decision: review.decision,
    mode: 'dispatch_reviewer',
    review,
    reviewer: {
      workstreamId: delegated.workstreamId,
      delegationRef: delegated.delegationRef,
      workerSessionId: delegated.workerSessionId,
      scope: 'readonly',
      contextIsolated: true,
    },
  };
}

function applyFindingVerifications(baseFindings, verifications, actorId, now) {
  const byId = new Map(baseFindings.map(item => [item.id, item]));
  for (const check of verifications) {
    const finding = byId.get(check.id);
    if (!finding) throw fail('review_finding', `Unknown review finding "${check.id}".`);
    if (check.status !== 'confirmed' && check.status !== 'rejected') {
      throw fail('review_finding', `Finding "${check.id}" verification status must be confirmed or rejected.`);
    }
    const note = String(check.note ?? check.verificationNote ?? '').trim();
    if (!note) throw fail('review_finding', `Finding "${check.id}" verification requires concrete verification note/evidence.`);
    Object.assign(finding, { status: check.status, verificationNote: note, verifiedAt: now, verifiedBy: actorId });
  }
}

function decideVerifiedOutcome(pending, confirmed, inputDecision) {
  if (pending.length) return 'pending_verification';
  if (confirmed.length > 0) {
    if (inputDecision === 'accepted') {
      throw fail('review_confirmed_findings', `Cannot accept report while ${confirmed.length} finding(s) are confirmed; return for incremental fix first.`);
    }
    return 'returned';
  }
  return inputDecision === 'returned' ? 'returned' : 'accepted';
}

function defaultVerificationReason(decision, confirmedCount, rejectedCount, pendingCount) {
  if (decision === 'returned') return `Confirmed ${confirmedCount} finding(s) for incremental rework.`;
  if (decision === 'accepted') return `Verified all ${rejectedCount} finding(s) as rejected; report accepted.`;
  return `${pendingCount} finding(s) still awaiting verification.`;
}

function buildVerifiedReviewRecord({ receipt, existing, input, decision, baseFindings, confirmed, rejected, pending, verifications, now }) {
  const evidence = [...new Set([
    ...(existing?.evidence ?? []),
    ...(input.evidence ?? []),
    ...verifications.map(v => `${v.id} [${v.status}]: ${String(v.note ?? v.verificationNote ?? '').trim()}`),
  ].filter(Boolean))];
  return {
    reportId: receipt.report.callId,
    decision,
    reason: input.reason?.trim() || existing?.reason || defaultVerificationReason(decision, confirmed.length, rejected.length, pending.length),
    evidence,
    ...(existing?.reviewerWorkstreamId ? { reviewerWorkstreamId: existing.reviewerWorkstreamId } : {}),
    ...(existing?.reviewerDelegationRef ? { reviewerDelegationRef: existing.reviewerDelegationRef } : {}),
    findings: baseFindings,
    ...(!pending.length ? { verifiedAt: now } : {}),
    at: now,
  };
}

async function verifyReviewFindings(service, actor, input) {
  const { work, receipt } = locateReviewTarget(service, actor, input);
  const existing = receipt.review;
  const baseFindings = input.findings?.length ? normalizeFindings(input.findings) : (existing?.findings ? structuredClone(existing.findings) : []);
  if (!baseFindings.length) throw fail('review_finding', 'verify_findings requires existing findings or a non-empty findings list.');
  const verifications = Array.isArray(input.findingVerifications) ? input.findingVerifications : [];
  if (!verifications.length) throw fail('review_finding', 'verify_findings requires findingVerifications with confirmed or rejected status.');
  const now = Date.now();
  applyFindingVerifications(baseFindings, verifications, actor.agent.id, now);
  const pending = baseFindings.filter(item => item.status !== 'confirmed' && item.status !== 'rejected');
  const confirmed = baseFindings.filter(item => item.status === 'confirmed');
  const rejected = baseFindings.filter(item => item.status === 'rejected');
  const decision = decideVerifiedOutcome(pending, confirmed, input.decision);
  if (decision === 'accepted' && (receipt.report.outcome !== 'completed' || service.prerequisiteStatus(receipt.report, work.projectId).prerequisitesChanged)) {
    throw fail('review_incomplete', 'Resolve the failed result or changed prerequisites before acceptance.');
  }
  const review = buildVerifiedReviewRecord({ receipt, existing, input, decision, baseFindings, confirmed, rejected, pending, verifications, now });
  await service.serial(() => service.write(state => {
    const row = state.workstreams.find(item => item.id === work.id);
    const target = row?.delegations.find(item => item.ref === receipt.ref);
    if (!row || !target) return;
    target.review = review;
    if (decision === 'returned') row.status = 'open';
    row.updatedAt = now;
  }));
  service.schedule();
  return { workstreamId: work.id, decision, mode: 'verify_findings', review, confirmedFindings: confirmed, rejectedFindings: rejected, pendingFindingIds: pending.map(item => item.id), reworkReady: decision === 'returned' };
}

async function recordPendingFindings(service, work, receipt, input, findings, unverified) {
  const review = {
    reportId: receipt.report.callId,
    decision: 'pending_verification',
    reason: input.reason?.trim() || 'Findings recorded; independent verification required before returning for rework.',
    evidence: (input.evidence ?? []).filter(Boolean),
    ...(receipt.review?.reviewerWorkstreamId ? { reviewerWorkstreamId: receipt.review.reviewerWorkstreamId } : {}),
    ...(receipt.review?.reviewerDelegationRef ? { reviewerDelegationRef: receipt.review.reviewerDelegationRef } : {}),
    findings,
    at: Date.now(),
  };
  await service.serial(() => service.write(state => {
    const target = state.workstreams.find(item => item.id === work.id)?.delegations.find(item => item.ref === receipt.ref);
    if (target) target.review = review;
  }));
  return { workstreamId: work.id, decision: review.decision, review, pendingVerification: true, unverifiedFindingIds: unverified.map(item => item.id), nextStep: 'Verify each finding independently with project_review(mode: "verify_findings") before returning for incremental fix.' };
}

/**
 * Execute `project_review` across direct reviews, independent context-isolated reviewer dispatch
 * and finding verification before incremental rework.
 */
export async function handleProjectReview(service, actor, input, exec) {
  service.coordinatorOnly(actor);
  exec.signal?.throwIfAborted?.();
  const mode = input.mode ?? 'direct';
  if (mode === 'dispatch_reviewer') return dispatchIndependentReviewer(service, actor, input, exec);
  if (mode === 'verify_findings') return verifyReviewFindings(service, actor, input);
  const { work, receipt } = locateReviewTarget(service, actor, input);
  const findings = normalizeFindings(input.findings);
  const unverified = findings.filter(item => item.status !== 'confirmed' && item.status !== 'rejected');
  if (findings.length > 0 && unverified.length > 0) {
    return recordPendingFindings(service, work, receipt, input, findings, unverified);
  }
  if (!['accepted', 'returned'].includes(input.decision) || !Array.isArray(input.evidence) || !input.evidence.length) {
    throw fail('review_evidence', 'Accept or return the result with actual inspection evidence.');
  }
  if (input.decision === 'accepted' && (receipt.report.outcome !== 'completed' || service.prerequisiteStatus(receipt.report, work.projectId).prerequisitesChanged)) {
    throw fail('review_incomplete', 'Resolve the failed result or changed prerequisites before acceptance.');
  }
  const review = {
    reportId: receipt.report.callId,
    decision: input.decision,
    reason: requiredText(input.reason, 'review reason'),
    evidence: input.evidence.map(item => requiredText(item, 'review evidence')),
    ...(receipt.review?.reviewerWorkstreamId ? { reviewerWorkstreamId: receipt.review.reviewerWorkstreamId } : {}),
    ...(receipt.review?.reviewerDelegationRef ? { reviewerDelegationRef: receipt.review.reviewerDelegationRef } : {}),
    ...(findings.length ? { findings, verifiedAt: Date.now() } : {}),
    at: Date.now(),
  };
  await service.serial(() => service.write(state => {
    const row = state.workstreams.find(item => item.id === work.id);
    latest(row).review = review;
    if (input.decision === 'returned') row.status = 'open';
    row.updatedAt = Date.now();
  }));
  service.schedule();
  return { workstreamId: work.id, decision: input.decision, review };
}
