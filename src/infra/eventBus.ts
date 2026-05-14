type EventMap = Record<string, unknown>;
type Listener<T> = (payload: T) => void;

export interface EventBus<M extends EventMap> {
  on<K extends keyof M>(event: K, listener: Listener<M[K]>): () => void;
  emit<K extends keyof M>(event: K, payload: M[K]): void;
}

export function createEventBus<M extends EventMap>(): EventBus<M> {
  const listeners = new Map<keyof M, Set<Listener<unknown>>>();

  function getSet(event: keyof M): Set<Listener<unknown>> {
    if (!listeners.has(event)) listeners.set(event, new Set());
    return listeners.get(event)!;
  }

  return {
    on(event, listener) {
      const set = getSet(event);
      // Type safety is enforced at the public interface via K-parameterised
      // on()/emit() signatures; the internal store uses Listener<unknown>.
      set.add(listener as Listener<unknown>);
      return () => set.delete(listener as Listener<unknown>);
    },
    emit(event, payload) {
      listeners.get(event)?.forEach(fn => fn(payload));
    },
  };
}
