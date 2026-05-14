import { IDataStoreAdapter } from 'src/adapters/types';

export async function appendJsonl<T>(
  adapter: IDataStoreAdapter,
  path: string,
  entry: T
): Promise<void> {
  await adapter.append(path, JSON.stringify(entry) + '\n');
}

export async function readJsonl<T>(
  adapter: IDataStoreAdapter,
  path: string
): Promise<T[]> {
  const raw = await adapter.read(path);
  if (raw === null) return [];

  const results: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed) as T);
    } catch {
      // 截断或损坏行:跳过
    }
  }
  return results;
}
