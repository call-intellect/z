import { describe, expect, it } from 'vitest';

import { DbLoggerBridge } from './db-logger.bridge';
import type { WriteLogInput } from './log.constants';
import type { LogService } from './log.service';

/** Мок LogService — захватывает аргументы write(). */
function makeBridge(): { bridge: DbLoggerBridge; writes: WriteLogInput[] } {
  const writes: WriteLogInput[] = [];
  const logs = {
    write: (input: WriteLogInput) => {
      writes.push(input);
    },
  } as unknown as LogService;
  const bridge = new DbLoggerBridge(logs);
  // Глушим stdout-вывод ConsoleLogger в тестах (печать наследуется от базы).
  bridge.setLogLevels([]);
  return { bridge, writes };
}

describe('DbLoggerBridge', () => {
  it('Nest-стиль: (message, context) → message + module', () => {
    const { bridge, writes } = makeBridge();
    bridge.log('Сервер запущен', 'Bootstrap');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ level: 'INFO', message: 'Сервер запущен', module: 'Bootstrap' });
  });

  it('pino-стиль: (obj, "human msg", context) → text=msg, details=obj', () => {
    const { bridge, writes } = makeBridge();
    bridge.debug({ meetingId: 'm1' }, 'transcribe: старт', 'TranscribeWorker');
    expect(writes).toHaveLength(1);
    // Последняя строка — context (module), предыдущая строка — текст, объект — details.
    expect(writes[0]).toMatchObject({
      level: 'DEBUG',
      message: 'transcribe: старт',
      module: 'TranscribeWorker',
      details: { meetingId: 'm1' },
    });
  });

  it('pino-стиль без явного context: module не выставляется (возьмётся из ALS)', () => {
    const { bridge, writes } = makeBridge();
    bridge.debug({ a: 1 }, 'просто сообщение');
    expect(writes[0]).toMatchObject({ message: 'просто сообщение', details: { a: 1 } });
    expect(writes[0]?.module).toBeUndefined();
  });

  it('error: вытаскивает стек и пробрасывает error', () => {
    const { bridge, writes } = makeBridge();
    bridge.error('Упало', 'Error: boom\n  at x', 'SomeService');
    expect(writes[0]).toMatchObject({ level: 'ERROR', message: 'Упало', module: 'SomeService' });
    expect(writes[0]?.error).toBeInstanceOf(Error);
  });

  it('Error-объект как message → message из .message', () => {
    const { bridge, writes } = makeBridge();
    bridge.error(new Error('сломалось'), 'CtxSvc');
    expect(writes[0]?.message).toBe('сломалось');
    expect(writes[0]?.error).toBeInstanceOf(Error);
  });

  it('фреймворковые контексты Nest не пишутся в БД', () => {
    const { bridge, writes } = makeBridge();
    bridge.log('Mapped route', 'RoutesResolver');
    bridge.log('InstanceLoader', 'InstanceLoader');
    expect(writes).toHaveLength(0);
  });

  it('внутренние логгеры LoggingModule не форвардятся (анти-рекурсия)', () => {
    const { bridge, writes } = makeBridge();
    bridge.warn('flush failed', 'LogBufferService');
    expect(writes).toHaveLength(0);
  });

  it('verbose → DEBUG, warn → WARN, fatal → FATAL', () => {
    const { bridge, writes } = makeBridge();
    bridge.verbose('v', 'C');
    bridge.warn('w', 'C');
    bridge.fatal('f', 'C');
    expect(writes.map((w) => w.level)).toEqual(['DEBUG', 'WARN', 'FATAL']);
  });
});
