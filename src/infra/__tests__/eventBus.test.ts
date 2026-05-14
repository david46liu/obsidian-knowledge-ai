import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from 'src/infra/eventBus';

type Events = {
  'index:progress': { notebookId: string; done: number; total: number };
  'index:complete': { notebookId: string };
};

describe('EventBus', () => {
  it('delivers event to subscriber', () => {
    const bus = createEventBus<Events>();
    const cb = vi.fn();
    bus.on('index:progress', cb);
    bus.emit('index:progress', { notebookId: 'n1', done: 1, total: 10 });
    expect(cb).toHaveBeenCalledWith({ notebookId: 'n1', done: 1, total: 10 });
  });

  it('off() unsubscribes', () => {
    const bus = createEventBus<Events>();
    const cb = vi.fn();
    const off = bus.on('index:progress', cb);
    off();
    bus.emit('index:progress', { notebookId: 'n1', done: 1, total: 10 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple subscribers receive event', () => {
    const bus = createEventBus<Events>();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bus.on('index:complete', cb1);
    bus.on('index:complete', cb2);
    bus.emit('index:complete', { notebookId: 'n1' });
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('does not deliver event to wrong channel', () => {
    const bus = createEventBus<Events>();
    const cb = vi.fn();
    bus.on('index:complete', cb);
    bus.emit('index:progress', { notebookId: 'n1', done: 1, total: 10 });
    expect(cb).not.toHaveBeenCalled();
  });
});
