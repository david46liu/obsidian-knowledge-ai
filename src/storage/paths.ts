import { join } from 'path';

export class StoragePaths {
  constructor(private readonly pluginDir: string) {}

  get pluginDataFile() { return join(this.pluginDir, 'data.json'); }
  get notebooksDir()   { return join(this.pluginDir, 'notebooks'); }
  get indexesDir()     { return join(this.pluginDir, 'indexes'); }
  get cacheDir()       { return join(this.pluginDir, 'cache'); }
  get hashesJsonl()    { return join(this.pluginDir, 'cache', 'hashes.jsonl'); }
  get pathsJsonl()     { return join(this.pluginDir, 'cache', 'paths.jsonl'); }
  get compactLock()    { return join(this.pluginDir, 'cache', '.compact.lock'); }
  get compactMeta()    { return join(this.pluginDir, 'cache', '.compact-meta.json'); }

  notebookFile(id: string) { return join(this.notebooksDir, `${id}.json`); }
  indexFile(id: string)    { return join(this.indexesDir, `${id}.msearch.json`); }
  tmpFile(filePath: string) { return filePath + '.tmp'; }

  sessionsDir(notebookId: string): string {
    return join(this.notebooksDir, notebookId, 'conversations');
  }
  sessionFile(notebookId: string, sessionId: string): string {
    return join(this.sessionsDir(notebookId), `${sessionId}.json`);
  }

  artifactsDir(notebookId: string): string {
    return join(this.notebooksDir, notebookId, 'artifacts');
  }
  artifactFile(notebookId: string, artifactId: string): string {
    return join(this.artifactsDir(notebookId), `${artifactId}.json`);
  }
}
