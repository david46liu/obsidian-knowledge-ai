import type { IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { Clock } from 'src/infra/clock';
import type { ChatSession, ChatTurn } from 'src/types/chat';
import type { NotebookId } from 'src/types/data';
import { readJson, writeJson } from 'src/storage/json';

export interface SessionStoreDeps {
  dataStore: IDataStoreAdapter;
  paths: StoragePaths;
  clock: Clock;
}

/**
 * 单 notebook 下多会话的持久化层。
 * 文件布局: <pluginDir>/notebooks/<notebookId>/conversations/<sessionId>.json
 */
export class SessionStore {
  constructor(private readonly deps: SessionStoreDeps) {}

  async load(notebookId: NotebookId, sessionId: string): Promise<ChatSession | null> {
    return readJson<ChatSession>(
      this.deps.dataStore,
      this.deps.paths.sessionFile(notebookId, sessionId),
    );
  }

  async save(session: ChatSession): Promise<void> {
    const updated: ChatSession = { ...session, updatedAt: this.deps.clock.now() };
    await this.deps.dataStore.mkdir(this.deps.paths.sessionsDir(session.notebookId));
    await writeJson(
      this.deps.dataStore,
      this.deps.paths.sessionFile(session.notebookId, session.id),
      updated,
    );
  }

  async list(notebookId: NotebookId): Promise<string[]> {
    const files = await this.deps.dataStore.list(this.deps.paths.sessionsDir(notebookId));
    return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  }

  async create(notebookId: NotebookId): Promise<ChatSession> {
    const now = this.deps.clock.now();
    const session: ChatSession = {
      id: crypto.randomUUID(),
      notebookId,
      turns: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.save(session);
    return session;
  }

  async appendTurn(
    notebookId: NotebookId,
    sessionId: string,
    turn: ChatTurn,
  ): Promise<ChatSession> {
    const existing = await this.load(notebookId, sessionId);
    if (!existing) throw new Error(`session not found: ${sessionId}`);
    const updated: ChatSession = { ...existing, turns: [...existing.turns, turn] };
    await this.save(updated);
    return updated;
  }

  async delete(notebookId: NotebookId, sessionId: string): Promise<void> {
    await this.deps.dataStore.remove(this.deps.paths.sessionFile(notebookId, sessionId));
  }
}
