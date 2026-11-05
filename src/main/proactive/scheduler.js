'use strict';

const { randomUUID } = require('node:crypto');

class TaskScheduler {
  constructor({ store, now = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
    if (!store || typeof store.read !== 'function' || typeof store.append !== 'function') throw new TypeError('TaskScheduler needs an event store');
    this.store = store; this.now = now; this.idFactory = idFactory; this.events = store.read(); this.jobs = new Map();
    for (const event of this.events) this.#apply(event);
  }

  schedule(taskId, { at, intervalMs = null, id = this.idFactory(), metadata = null } = {}) {
    const dueAt = new Date(at).getTime();
    if (!Number.isFinite(dueAt)) throw new TypeError('at must be an ISO date or timestamp');
    if (intervalMs !== null && (!Number.isInteger(intervalMs) || intervalMs <= 0)) throw new RangeError('intervalMs must be a positive integer');
    const job = { id, taskId, at: new Date(dueAt).toISOString(), intervalMs, metadata, status: 'scheduled' };
    this.#emit({ type: 'schedule.created', job });
    return { ...job };
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'scheduled') return job ? { ...job } : null;
    this.#emit({ type: 'schedule.cancelled', jobId });
    return { ...this.jobs.get(jobId) };
  }

  poll(at = this.now()) {
    const now = new Date(at).getTime();
    if (!Number.isFinite(now)) throw new TypeError('poll time must be an ISO date or timestamp');
    const due = [];
    for (const job of this.jobs.values()) {
      if (job.status !== 'scheduled' || new Date(job.at).getTime() > now) continue;
      due.push({ ...job });
      if (job.intervalMs) this.#emit({ type: 'schedule.rescheduled', jobId: job.id, at: new Date(new Date(job.at).getTime() + job.intervalMs).toISOString() });
      else this.#emit({ type: 'schedule.fired', jobId: job.id, at: this.now() });
    }
    return due;
  }

  list() { return [...this.jobs.values()].map(job => ({ ...job })); }

  #emit(event) {
    const enriched = { ...event, eventId: this.idFactory(), at: this.now(), sequence: this.events.length + 1 };
    this.store.append(enriched); this.events.push(enriched); this.#apply(enriched);
  }

  #apply(event) {
    if (event.type === 'schedule.created') this.jobs.set(event.job.id, { ...event.job });
    if (event.type === 'schedule.cancelled' && this.jobs.has(event.jobId)) this.jobs.get(event.jobId).status = 'cancelled';
    if (event.type === 'schedule.rescheduled' && this.jobs.has(event.jobId)) this.jobs.get(event.jobId).at = event.at;
    if (event.type === 'schedule.fired' && this.jobs.has(event.jobId)) this.jobs.get(event.jobId).status = 'fired';
  }
}

module.exports = { TaskScheduler };
