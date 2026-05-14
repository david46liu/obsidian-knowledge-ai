type AnyFn = (...args: unknown[]) => void;

export interface Debounced<T extends AnyFn> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

export function debounce<T extends AnyFn>(fn: T, delayMs: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const debounced = (...args: Parameters<T>): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return debounced;
}
