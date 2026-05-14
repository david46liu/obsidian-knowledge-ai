import type { IDataStoreAdapter } from 'src/adapters/types';
import type { StoragePaths } from 'src/storage/paths';
import type { Artifact } from 'src/types/artifact';
import type { NotebookId } from 'src/types/data';
import { readJson, writeJson } from 'src/storage/json';

export interface ArtifactStoreDeps {
  dataStore: IDataStoreAdapter;
  paths: StoragePaths;
}

/**
 * 单 notebook 下多产物的持久化层。
 * 文件布局: <pluginDir>/notebooks/<notebookId>/artifacts/<artifactId>.json
 */
export class ArtifactStore {
  constructor(private readonly deps: ArtifactStoreDeps) {}

  async load(notebookId: NotebookId, artifactId: string): Promise<Artifact | null> {
    return readJson<Artifact>(
      this.deps.dataStore,
      this.deps.paths.artifactFile(notebookId, artifactId),
    );
  }

  async save(artifact: Artifact): Promise<void> {
    await this.deps.dataStore.mkdir(this.deps.paths.artifactsDir(artifact.notebookId));
    await writeJson(
      this.deps.dataStore,
      this.deps.paths.artifactFile(artifact.notebookId, artifact.id),
      artifact,
    );
  }

  async list(notebookId: NotebookId): Promise<Artifact[]> {
    const files = await this.deps.dataStore.list(this.deps.paths.artifactsDir(notebookId));
    const ids = files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    const arts: Artifact[] = [];
    for (const id of ids) {
      const a = await this.load(notebookId, id);
      if (a) arts.push(a);
    }
    return arts.sort((a, b) => b.generatedAt - a.generatedAt);
  }

  async delete(notebookId: NotebookId, artifactId: string): Promise<void> {
    await this.deps.dataStore.remove(this.deps.paths.artifactFile(notebookId, artifactId));
  }
}
