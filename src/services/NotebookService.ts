import type { IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { Clock } from 'src/infra/clock';
import type { Logger } from 'src/infra/logger';
import type {
  Provider,
  PluginData,
  Notebook,
  NotebookId,
  Source,
  TaskName,
  TaskAssignment,
  ProviderId,
} from 'src/types/data';
import type { NotebookStatePort } from 'src/services/IndexService';
import { readJson, writeJson } from 'src/storage/json';

export interface NotebookServiceDeps {
  dataStore: IDataStoreAdapter;
  paths: StoragePaths;
  clock: Clock;
  logger?: Logger;
}

const DEFAULT_PLUGIN_DATA: PluginData = {
  schemaVersion: 1,
  providers: [],
  taskAssignments: {},
};

export class NotebookService implements NotebookStatePort {
  private pluginData: PluginData = { ...DEFAULT_PLUGIN_DATA };
  private notebooks = new Map<NotebookId, Notebook>();

  constructor(private readonly deps: NotebookServiceDeps) {}

  // ── Startup ────────────────────────────────────────────────
  /** Load PluginData + all Notebooks from disk. Caller awaits in onload(). */
  async loadAll(): Promise<void> {
    this.pluginData = await this.readPluginData();

    // Migrate: fill supportsEmbeddings / supportsVision for providers created before these fields existed
    let migrated = false;
    for (const p of this.pluginData.providers) {
      if (p.capabilities.supportsEmbeddings === undefined) {
        p.capabilities = {
          ...p.capabilities,
          supportsEmbeddings: p.kind === 'openai' || p.kind === 'glm',
        };
        migrated = true;
      }
      if (p.capabilities.supportsVision === undefined) {
        p.capabilities = {
          ...p.capabilities,
          supportsVision: p.kind === 'openai' || p.kind === 'glm',
        };
        migrated = true;
      }
    }
    if (!this.pluginData.embeddingConfig) {
      this.pluginData.embeddingConfig = { enabled: false, source: 'local', localModelId: 'Xenova/multilingual-e5-small' };
      migrated = true;
    }
    if (!this.pluginData.imageConfig) {
      this.pluginData.imageConfig = {
        ocrEnabled: true,
        ocrLangs: ['chi_sim', 'eng'],
        visionEnabled: true,
        maxImageBytes: 5_000_000,
      };
      migrated = true;
    }
    if (migrated) {
      await writeJson(this.deps.dataStore, this.deps.paths.pluginDataFile, this.pluginData);
    }

    const ids = await this.listNotebookIds();
    for (const id of ids) {
      const nb = await this.readNotebook(id);
      if (nb) this.notebooks.set(id, nb);
    }
  }

  // ── PluginData ─────────────────────────────────────────────
  getPluginData(): PluginData { return this.pluginData; }

  async savePluginData(data: PluginData): Promise<void> {
    this.pluginData = data;
    await writeJson(this.deps.dataStore, this.deps.paths.pluginDataFile, data);
  }

  // ── Notebook CRUD ──────────────────────────────────────────
  listNotebooks(): Notebook[] { return [...this.notebooks.values()]; }

  async getNotebook(id: NotebookId): Promise<Notebook | null> {
    return this.notebooks.get(id) ?? null;
  }

  async createNotebook(name: string, source: Source): Promise<Notebook> {
    const id = crypto.randomUUID();
    const now = this.deps.clock.now();
    const nb: Notebook = {
      id, name,
      sources: [{ ...source, id: crypto.randomUUID() }],
      status: 'idle',
      createdAt: now, updatedAt: now,
    };
    this.notebooks.set(id, nb);
    await writeJson(this.deps.dataStore, this.deps.paths.notebookFile(id), nb);
    return nb;
  }

  async updateNotebook(id: NotebookId, patch: Partial<Notebook>): Promise<Notebook> {
    const nb = this.notebooks.get(id);
    if (!nb) throw new Error(`notebook not found: ${id}`);
    const updated: Notebook = { ...nb, ...patch, id, updatedAt: this.deps.clock.now() };
    this.notebooks.set(id, updated);
    await writeJson(this.deps.dataStore, this.deps.paths.notebookFile(id), updated);
    return updated;
  }

  async deleteNotebook(id: NotebookId): Promise<void> {
    this.notebooks.delete(id);
    await this.deps.dataStore.remove(this.deps.paths.notebookFile(id));
  }

  // ── NotebookStatePort ──────────────────────────────────────
  async persistState(id: NotebookId, patch: Partial<Notebook>): Promise<void> {
    const nb = this.notebooks.get(id);
    if (!nb) return; // silently skip unknown ids
    const updated: Notebook = { ...nb, ...patch, id, updatedAt: this.deps.clock.now() };
    this.notebooks.set(id, updated);
    await writeJson(this.deps.dataStore, this.deps.paths.notebookFile(id), updated);
  }

  // ── Provider helpers ───────────────────────────────────────
  async addProvider(draft: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider> {
    const now = this.deps.clock.now();
    const p: Provider = { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await this.savePluginData({ ...this.pluginData, providers: [...this.pluginData.providers, p] });
    return p;
  }

  async updateProvider(p: Provider): Promise<void> {
    const idx = this.pluginData.providers.findIndex(x => x.id === p.id);
    if (idx === -1) throw new Error(`provider not found: ${p.id}`);
    const providers = [...this.pluginData.providers];
    providers[idx] = { ...p, updatedAt: this.deps.clock.now() };
    await this.savePluginData({ ...this.pluginData, providers });
  }

  async deleteProvider(id: ProviderId): Promise<void> {
    const providers = this.pluginData.providers.filter(p => p.id !== id);
    await this.savePluginData({ ...this.pluginData, providers });
  }

  async setTaskAssignment(task: TaskName, assignment: TaskAssignment | null): Promise<void> {
    const taskAssignments = { ...this.pluginData.taskAssignments };
    if (assignment === null) delete taskAssignments[task];
    else taskAssignments[task] = assignment;
    await this.savePluginData({ ...this.pluginData, taskAssignments });
  }

  // ── Private helpers ────────────────────────────────────────
  private async readPluginData(): Promise<PluginData> {
    const raw = await this.deps.dataStore.read(this.deps.paths.pluginDataFile);
    if (!raw) return { ...DEFAULT_PLUGIN_DATA };
    try {
      const parsed = JSON.parse(raw) as PluginData;
      return { ...DEFAULT_PLUGIN_DATA, ...parsed };
    } catch {
      this.deps.logger?.warn('data.json parse failed, using defaults');
      return { ...DEFAULT_PLUGIN_DATA };
    }
  }

  private async readNotebook(id: NotebookId): Promise<Notebook | null> {
    return readJson<Notebook>(this.deps.dataStore, this.deps.paths.notebookFile(id));
  }

  private async listNotebookIds(): Promise<NotebookId[]> {
    const files = await this.deps.dataStore.list(this.deps.paths.notebooksDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  }
}
