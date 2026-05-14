import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVaultObserver } from 'src/indexer/observer';
import { InMemoryVaultAdapter } from 'src/adapters/__tests__/InMemoryVaultAdapter';

describe('createVaultObserver', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('calls onDirty after debounce window for modified path under notebook source', () => {
    const vault = new InMemoryVaultAdapter();
    const onDirty = vi.fn();
    const stop = createVaultObserver({
      vault,
      notebooks: () => [{ id: 'nb1', sources: [{ id: 's', type: 'folder', path: 'notes', recursive: true }] }],
      debounceMs: 100,
      onDirty,
    });
    vault.writeFile('notes/a.md', 'x');
    expect(onDirty).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onDirty).toHaveBeenCalledWith({ notebookIds: ['nb1'], paths: ['notes/a.md'] });
    stop();
  });

  it('does not fire for paths outside any notebook source', () => {
    const vault = new InMemoryVaultAdapter();
    const onDirty = vi.fn();
    createVaultObserver({
      vault,
      notebooks: () => [{ id: 'nb1', sources: [{ id: 's', type: 'folder', path: 'notes', recursive: true }] }],
      debounceMs: 50,
      onDirty,
    });
    vault.writeFile('other/x.md', 'x');
    vi.advanceTimersByTime(100);
    expect(onDirty).not.toHaveBeenCalled();
  });

  it('repeated events on same path merge into one debounce firing', () => {
    const vault = new InMemoryVaultAdapter();
    const onDirty = vi.fn();
    createVaultObserver({
      vault,
      notebooks: () => [{ id: 'nb1', sources: [{ id: 's', type: 'folder', path: 'n', recursive: true }] }],
      debounceMs: 100,
      onDirty,
    });
    vault.writeFile('n/a.md', '1');
    vi.advanceTimersByTime(50);
    vault.writeFile('n/a.md', '2');
    vi.advanceTimersByTime(50);
    vault.writeFile('n/a.md', '3');
    vi.advanceTimersByTime(100);
    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onDirty.mock.calls[0][0].paths).toEqual(['n/a.md']);
  });

  it('rename maps both old and new paths; reports notebook affected if either is in scope', () => {
    const vault = new InMemoryVaultAdapter();
    const onDirty = vi.fn();
    createVaultObserver({
      vault,
      notebooks: () => [{ id: 'nb1', sources: [{ id: 's', type: 'folder', path: 'n', recursive: true }] }],
      debounceMs: 50,
      onDirty,
    });
    vault.writeFile('n/old.md', 'x');
    vi.advanceTimersByTime(60);
    onDirty.mockClear();
    vault.renameFile('n/old.md', 'n/new.md');
    vi.advanceTimersByTime(60);
    expect(onDirty).toHaveBeenCalled();
    const payload = onDirty.mock.calls[0][0];
    expect(payload.notebookIds).toEqual(['nb1']);
    expect(payload.paths).toContain('n/new.md');
  });

  it('stop() unsubscribes vault events', () => {
    const vault = new InMemoryVaultAdapter();
    const onDirty = vi.fn();
    const stop = createVaultObserver({
      vault,
      notebooks: () => [{ id: 'nb1', sources: [{ id: 's', type: 'folder', path: 'n', recursive: true }] }],
      debounceMs: 50,
      onDirty,
    });
    stop();
    vault.writeFile('n/a.md', 'x');
    vi.advanceTimersByTime(100);
    expect(onDirty).not.toHaveBeenCalled();
  });
});
