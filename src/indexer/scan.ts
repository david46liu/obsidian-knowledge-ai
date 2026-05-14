import type { PathMapStore } from 'src/indexer/pathMap';
import type { DiffEntry, HashContentFn, ScanResult } from 'src/indexer/types';

export interface ScannedFile {
  path: string;
  sourceMtime: number;
  fileSize: number;
  contentBytes: Uint8Array;
}

export interface ScanDiffOptions {
  /** 从 HashCache 反查 size;mtime 相等但 size 不等时强制 hash 重算。 */
  fileSizeByHash?: (hash: string) => number | undefined;
  /**
   * 谓词:hash 对应的 cache entry 与当前期望 parserVersion 是否一致。
   * 缺省视为一致(UNCHANGED 不升级)。仅对 UNCHANGED 路径生效。
   */
  isFileCacheCurrent?: (path: string, hash: string) => boolean;
}

/**
 * 规范式 diff 仲裁(spec §3.1.3),按 notebook 作用域过滤 + size 保护。
 */
export async function scanDiff(
  scanned: ScannedFile[],
  pathMap: PathMapStore,
  pathInScope: (path: string) => boolean,
  hashFn: HashContentFn,
  opts: ScanDiffOptions = {}
): Promise<ScanResult> {
  const scannedByPath = new Map(scanned.map(f => [f.path, f]));
  const entries: DiffEntry[] = [];

  const sizeByHash = opts.fileSizeByHash ?? (() => undefined);

  const P = new Set([...pathMap.allAlivePaths()].filter(pathInScope));
  const S = new Set(scanned.map(f => f.path));

  const outgoingPaths = [...P].filter(p => !S.has(p)).sort();
  const incomingPaths = [...S].filter(p => !P.has(p)).sort();

  const incomingByHash = new Map<string, string[]>();
  const incomingNewHash = new Map<string, string>();
  for (const p of incomingPaths) {
    const file = scannedByPath.get(p)!;
    const newHash = await hashFn(file.contentBytes);
    incomingNewHash.set(p, newHash);
    if (!incomingByHash.has(newHash)) incomingByHash.set(newHash, []);
    incomingByHash.get(newHash)!.push(p);
  }

  const pairedOut = new Set<string>();
  const pairedIn = new Set<string>();

  // Rename 字典序贪心(同 hash 才配对)
  for (const oldPath of outgoingPaths) {
    if (pairedOut.has(oldPath)) continue;
    const hash = pathMap.get(oldPath)?.fileHash;
    if (!hash) continue;
    const candidateInPaths = (incomingByHash.get(hash) ?? []).filter(p => !pairedIn.has(p)).sort();
    if (candidateInPaths.length === 0) continue;
    const newPath = candidateInPaths[0];
    pairedOut.add(oldPath);
    pairedIn.add(newPath);
    const scannedFile = scannedByPath.get(newPath)!;
    entries.push({
      classification: 'RENAMED',
      oldPath, newPath,
      oldHash: hash, newHash: hash,
      sourceMtime: scannedFile.sourceMtime,
      fileSize: scannedFile.fileSize,
    });
  }

  for (const p of outgoingPaths) {
    if (pairedOut.has(p)) continue;
    entries.push({
      classification: 'DELETED',
      filePath: p,
      oldHash: pathMap.get(p)?.fileHash,
    });
  }

  for (const p of incomingPaths) {
    if (pairedIn.has(p)) continue;
    const file = scannedByPath.get(p)!;
    entries.push({
      classification: 'NEW_PATH',
      filePath: p,
      newHash: incomingNewHash.get(p),
      sourceMtime: file.sourceMtime,
      fileSize: file.fileSize,
    });
  }

  // S ∩ P: mtime + size 双重判定 UNCHANGED
  for (const p of scanned) {
    if (!P.has(p.path)) continue;
    const old = pathMap.get(p.path);
    if (!old) continue;

    const oldSize = sizeByHash(old.fileHash);
    const mtimeSame = p.sourceMtime === old.sourceMtime;
    const sizeSame = oldSize === undefined ? true : oldSize === p.fileSize;

    if (mtimeSame && sizeSame) {
      const cacheCurrent = (opts.isFileCacheCurrent ?? (() => true))(p.path, old.fileHash);
      entries.push({
        classification: cacheCurrent ? 'UNCHANGED' : 'STALE_PARSER',
        filePath: p.path,
        oldHash: old.fileHash,
        sourceMtime: p.sourceMtime,
        fileSize: p.fileSize,
      });
      continue;
    }

    const newHash = await hashFn(p.contentBytes);
    if (newHash === old.fileHash) {
      entries.push({
        classification: 'MTIME_ONLY',
        filePath: p.path,
        oldHash: old.fileHash,
        sourceMtime: p.sourceMtime,
        fileSize: p.fileSize,
      });
    } else {
      entries.push({
        classification: 'CONTENT_CHANGED',
        filePath: p.path,
        oldHash: old.fileHash,
        newHash,
        sourceMtime: p.sourceMtime,
        fileSize: p.fileSize,
      });
    }
  }

  return { entries, scannedFileCount: scanned.length };
}
