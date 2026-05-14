import { describe, it, expect, vi } from 'vitest';
import { createLogger, LogLevel } from 'src/infra/logger';

describe('Logger', () => {
  it('emits debug when level is debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('TestTag', LogLevel.debug);
    log.debug('msg');
    expect(spy).toHaveBeenCalledWith('[TestTag]', 'msg');
    spy.mockRestore();
  });

  it('suppresses debug when level is info', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('TestTag', LogLevel.info);
    log.debug('msg');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('always emits error regardless of level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('TestTag', LogLevel.warn);
    log.error('oops');
    expect(spy).toHaveBeenCalledWith('[TestTag]', 'oops');
    spy.mockRestore();
  });

  it('setLevel changes behaviour at runtime', () => {
    const spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('T', LogLevel.info);
    log.debug('before');
    expect(spyDebug).not.toHaveBeenCalled();
    log.setLevel(LogLevel.debug);
    log.debug('after');
    expect(spyDebug).toHaveBeenCalledWith('[T]', 'after');
    spyDebug.mockRestore();
  });
});
