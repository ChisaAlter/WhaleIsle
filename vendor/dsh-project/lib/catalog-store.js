/** Per-projectId catalog storage splitting hot runtime state from archived history and historical reports. */
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { catalogSchema, initialState, projectDomain } from './domain.js';
import { migrateCatalog } from './catalog-migration.js';

const META_KEY = 'catalog';

function clone(value) {
  return structuredClone(value);
}

function splitProjectRecords(catalog, projectId) {
  const workers = (catalog.workers ?? []).filter(row => row.projectId === projectId);
  const requests = (catalog.requests ?? []).filter(row => row.projectId === projectId);
  const deliveries = (catalog.deliveries ?? []).filter(row => row.projectId === projectId);
  const workstreams = (catalog.workstreams ?? []).filter(row => row.projectId === projectId);

  const archivedRequestIds = new Set(requests.filter(row => Boolean(row.archivedAt)).map(row => row.id));
  const hotRequests = requests.filter(row => !row.archivedAt);
  const historyRequests = requests.filter(row => Boolean(row.archivedAt));

  const isHistoryDelivery = row => archivedRequestIds.has(row.requestId)
    || row.status === 'historical' || row.status === 'obsolete';
  const hotDeliveries = deliveries.filter(row => !isHistoryDelivery(row));
  const historyDeliveries = deliveries.filter(isHistoryDelivery);

  const hotWorkstreams = [];
  const historyWorkstreams = [];
  const historyReports = [];

  for (const work of workstreams) {
    if (work.archived) {
      historyWorkstreams.push(work);
      continue;
    }
    const copy = clone(work);
    copy.delegations = copy.delegations.map(receipt => {
      if (receipt.ref !== copy.currentDelegationRef && receipt.report) {
        historyReports.push({ workstreamId: copy.id, delegationRef: receipt.ref, report: receipt.report });
        const { report: _detached, ...slim } = receipt;
        return { ...slim, reportStoredInHistory: true };
      }
      return receipt;
    });
    hotWorkstreams.push(copy);
  }

  return {
    hot: { workstreams: hotWorkstreams, workers, requests: hotRequests, deliveries: hotDeliveries },
    history: { workstreams: historyWorkstreams, requests: historyRequests, deliveries: historyDeliveries, reports: historyReports },
  };
}

function mergeById(primary, secondary) {
  const seen = new Set(primary.map(row => row.id));
  return [...primary, ...secondary.filter(row => !seen.has(row.id))];
}

function assembleProjectRecords(hot, history) {
  const reportMap = new Map(
    (history?.reports ?? []).map(entry => [`${entry.workstreamId}:${entry.delegationRef}`, entry.report]),
  );
  const hydratedHotWorkstreams = (hot?.workstreams ?? []).map(work => {
    const copy = clone(work);
    copy.delegations = copy.delegations.map(receipt => {
      const saved = reportMap.get(`${copy.id}:${receipt.ref}`);
      if (!saved) return receipt;
      const { reportStoredInHistory: _flag, ...rest } = receipt;
      return { ...rest, report: clone(saved) };
    });
    return copy;
  });
  return {
    workers: clone(hot?.workers ?? []),
    workstreams: mergeById(hydratedHotWorkstreams, clone(history?.workstreams ?? [])).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    requests: mergeById(clone(hot?.requests ?? []), clone(history?.requests ?? [])).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    deliveries: mergeById(clone(hot?.deliveries ?? []), clone(history?.deliveries ?? [])).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
  };
}

function loadFromDomain(domain) {
  const meta = domain.table('meta').get(META_KEY);
  const projects = [...domain.table('projects').entries()].map(([, value]) => clone(value));
  const hotTable = domain.table('hot');
  const historyTable = domain.table('history');
  const workstreams = [];
  const workers = [];
  const requests = [];
  const deliveries = [];
  for (const project of projects) {
    const assembled = assembleProjectRecords(hotTable.get(project.id), historyTable.get(project.id));
    workstreams.push(...assembled.workstreams);
    workers.push(...assembled.workers);
    requests.push(...assembled.requests);
    deliveries.push(...assembled.deliveries);
  }
  return {
    version: 2,
    revision: meta?.revision ?? 0,
    projects,
    workstreams,
    workers,
    requests,
    deliveries,
  };
}

async function readLegacySingleFile(home) {
  if (!home) return null;
  const legacyPath = join(home, 'storages', `${projectDomain.name}.json`);
  let raw;
  try { raw = await fs.readFile(legacyPath, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  let document;
  try { document = JSON.parse(raw); }
  catch (error) { throw new Error(`Legacy Project catalog is not valid JSON: ${error.message}`); }
  if (!document || typeof document !== 'object' || document.unit?.name !== projectDomain.name) {
    throw new Error('Legacy Project catalog header does not match whale_project_local.');
  }
  if (!document.tables?.state || !Object.hasOwn(document.tables.state, 'catalog')) {
    return null;
  }
  return catalogSchema.parse(document.tables.state.catalog);
}

/**
 * Per-projectId persistent store with separate hot and history records.
 * Presents the same synchronous `get('catalog')` and serialized `update('catalog', fn)`
 * interface expected by ProjectService while writing only dirty per-projectId files.
 */
export class CatalogStore {
  constructor(domain, initialCatalog, migratedFromLegacyAt) {
    this.domain = domain;
    this.catalog = initialCatalog;
    this.migratedFromLegacyAt = migratedFromLegacyAt;
    this.chain = Promise.resolve();
    this.snapshots = { projects: new Map(), hot: new Map(), history: new Map() };
    this.indexSnapshots(initialCatalog);
  }

  static async open(ctx, home, persistence) {
    const domain = await ctx.storageDomain.open(projectDomain);
    try {
      const metaTable = domain.table('meta');
      const projectsTable = domain.table('projects');
      const hasNewData = Boolean(metaTable.get(META_KEY)) || projectsTable.size > 0;
      if (hasNewData) {
        return new CatalogStore(domain, loadFromDomain(domain), metaTable.get(META_KEY)?.migratedFromLegacyAt);
      }
      const legacy = await readLegacySingleFile(home);
      if (!legacy) {
        return new CatalogStore(domain, clone(initialState), undefined);
      }
      const migrated = await migrateCatalog(legacy, persistence);
      const migratedAt = Date.now();
      const store = new CatalogStore(domain, clone(initialState), migratedAt);
      await store.persistDiff(migrated, true);
      store.catalog = migrated;
      store.indexSnapshots(migrated);
      return store;
    } catch (error) {
      await domain.close().catch(() => { /* Preserve original open/migration error during cleanup close. */ });
      throw error;
    }
  }

  indexSnapshots(catalog) {
    this.snapshots.projects.clear();
    this.snapshots.hot.clear();
    this.snapshots.history.clear();
    for (const project of catalog.projects) {
      const { hot, history } = splitProjectRecords(catalog, project.id);
      this.snapshots.projects.set(project.id, JSON.stringify(project));
      this.snapshots.hot.set(project.id, JSON.stringify(hot));
      this.snapshots.history.set(project.id, JSON.stringify(history));
    }
  }

  get(key = META_KEY) {
    if (key !== META_KEY) return undefined;
    return this.catalog;
  }

  async persistDiff(next, forceMeta = false) {
    const projectsTable = this.domain.table('projects');
    const hotTable = this.domain.table('hot');
    const historyTable = this.domain.table('history');
    const metaTable = this.domain.table('meta');
    const nextIds = new Set(next.projects.map(project => project.id));
    const removedIds = [...this.snapshots.projects.keys()].filter(projectId => !nextIds.has(projectId));
    for (const project of next.projects) {
      const { hot, history } = splitProjectRecords(next, project.id);
      const projectJson = JSON.stringify(project);
      const hotJson = JSON.stringify(hot);
      const historyJson = JSON.stringify(history);
      if (this.snapshots.projects.get(project.id) !== projectJson) {
        await projectsTable.put(project.id, clone(project));
      }
      if (this.snapshots.hot.get(project.id) !== hotJson) {
        await hotTable.put(project.id, hot);
      }
      if (this.snapshots.history.get(project.id) !== historyJson) {
        await historyTable.put(project.id, history);
      }
    }
    if (removedIds.length) {
      await projectsTable.deleteMany(removedIds);
      await hotTable.deleteMany(removedIds);
      await historyTable.deleteMany(removedIds);
    }
    const meta = {
      version: 2,
      revision: next.revision,
      ...(this.migratedFromLegacyAt !== undefined ? { migratedFromLegacyAt: this.migratedFromLegacyAt } : {}),
    };
    const prevMeta = metaTable.get(META_KEY);
    if (forceMeta || !prevMeta || prevMeta.revision !== meta.revision) {
      await metaTable.put(META_KEY, meta);
    }
  }

  update(key, mutator) {
    const fn = typeof key === 'function' ? key : mutator;
    const run = async () => {
      const next = fn(clone(this.catalog));
      if (!next || next === this.catalog) return this.catalog;
      try {
        await this.persistDiff(next);
        this.catalog = next;
        this.indexSnapshots(next);
        return this.catalog;
      } catch (error) {
        this.catalog = loadFromDomain(this.domain);
        this.indexSnapshots(this.catalog);
        throw error;
      }
    };
    const pending = this.chain.then(run, run);
    this.chain = pending.catch(() => { /* Caller receives the rejection; keep the write chain alive. */ });
    return pending;
  }

  async close() {
    await this.chain.catch(() => { /* Pending write errors are already surfaced to their callers. */ });
    await this.domain.close();
  }
}

/** Adapt unit-test single-table mocks `{ get, update }` to the CatalogStore surface. */
export function wrapCatalogTable(table) {
  if (table instanceof CatalogStore) return table;
  return {
    get: (key = META_KEY) => table.get(key),
    update: (key, fn) => typeof key === 'function' ? table.update(META_KEY, key) : table.update(key, fn),
    close: () => Promise.resolve(),
  };
}
