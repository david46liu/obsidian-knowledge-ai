export interface Clock {
  now(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
};

export function makeFakeClock(initial = 0): Clock & { tick(ms: number): void; set(ts: number): void } {
  let ts = initial;
  return {
    now: () => ts,
    tick: (ms: number) => { ts += ms; },
    set: (val: number) => { ts = val; },
  };
}
