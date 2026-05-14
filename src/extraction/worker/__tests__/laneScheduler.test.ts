import { describe, it, expect } from 'vitest';
import { LaneScheduler } from '../laneScheduler';

describe('LaneScheduler', () => {
  it('fast lane 允许多个并发任务同时执行', async () => {
    const sched = new LaneScheduler({ fastConcurrency: 4, slowConcurrency: 1, softLimits: { docx: 100 } });
    let live = 0;
    let max = 0;
    const tasks = Array.from({ length: 8 }, () => sched.run(10, 'docx', async () => {
      live++; max = Math.max(max, live);
      await new Promise(r => setTimeout(r, 30));
      live--;
    }));
    await Promise.all(tasks);
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThanOrEqual(2);  // 至少看到并发
  });

  it('size 超 softLimit 走 slow lane,串行', async () => {
    const sched = new LaneScheduler({ fastConcurrency: 4, slowConcurrency: 1, softLimits: { pptx: 100 } });
    let live = 0;
    let max = 0;
    const tasks = Array.from({ length: 4 }, () => sched.run(200, 'pptx', async () => {
      live++; max = Math.max(max, live);
      await new Promise(r => setTimeout(r, 20));
      live--;
    }));
    await Promise.all(tasks);
    expect(max).toBe(1);
  });

  it('未配置的 ext 走 fast lane', async () => {
    const sched = new LaneScheduler({ fastConcurrency: 2, slowConcurrency: 1, softLimits: {} });
    let live = 0, max = 0;
    await Promise.all(Array.from({ length: 4 }, () => sched.run(999_999, 'unknown', async () => {
      live++; max = Math.max(max, live);
      await new Promise(r => setTimeout(r, 10));
      live--;
    })));
    expect(max).toBeGreaterThanOrEqual(2);
  });

  it('任务抛错释放槽位,后续任务能继续', async () => {
    const sched = new LaneScheduler({ fastConcurrency: 1, slowConcurrency: 1, softLimits: {} });
    await expect(sched.run(10, 'md', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await sched.run(10, 'md', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('多次 release 后 current 不会越过 capacity', async () => {
    const sched = new LaneScheduler({ fastConcurrency: 1, slowConcurrency: 1, softLimits: {} });
    // 先把 slot 占用
    let release1!: () => void;
    const inFlight1 = sched.run(10, 'md', () => new Promise<void>(r => { release1 = r; }));
    await Promise.resolve(); // 让任务进入 running 状态

    // 排队第二个 + 第三个(此时 slot 被占,两者都在 waiters 队列中)
    let release2!: () => void;
    const inFlight2 = sched.run(10, 'md', () => new Promise<void>(r => { release2 = r; }));
    let p3Done = false;
    const inFlight3 = sched.run(10, 'md', async () => { p3Done = true; });

    // 释放第一个 → 第二个通过 direct-handoff 抓住 slot,并执行其 fn → release2 被赋值
    release1();
    await Promise.resolve(); // 让 direct-handoff resolver 运行
    await Promise.resolve(); // 让 inFlight2 的 fn 开始执行,设置 release2
    await Promise.resolve(); // 确保 release2 已被赋值

    expect(typeof release2).toBe('function'); // release2 已就绪
    expect(p3Done).toBe(false);              // 第三个还在等

    // 同时释放第二个并马上发起第四个 —— 测竞态
    release2();
    const inFlight4 = sched.run(10, 'md', async () => 'fourth');

    await Promise.all([inFlight1, inFlight2, inFlight3, inFlight4]);
    expect(p3Done).toBe(true);
  });
});
