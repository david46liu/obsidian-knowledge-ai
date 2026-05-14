import { IDataStoreAdapter } from 'src/adapters/types';

/** Returns null if the file does not exist or content is invalid JSON.
 *  The shape of T is not validated at runtime — caller is responsible. */
export async function readJson<T>(
  adapter: IDataStoreAdapter,
  path: string
): Promise<T | null> {
  const raw = await adapter.read(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson<T>(
  adapter: IDataStoreAdapter,
  path: string,
  value: T
): Promise<void> {
  await adapter.writeAtomic(path, JSON.stringify(value, null, 2));
}
