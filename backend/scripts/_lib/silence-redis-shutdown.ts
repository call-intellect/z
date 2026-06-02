/**
 * Глушитель шума ioredis/BullMQ при завершении one-off скриптов.
 *
 * Скрипты, которые поднимают полный `AppModule`
 * (`NestFactory.createApplicationContext`), вместе с ним стартуют десятки
 * BullMQ-воркеров с блокирующими Redis-коннектами (BRPOPLPUSH). При
 * `app.close()` / выходе процесса эти соединения рвутся, и каждый pending-команд
 * реджектится `Error: Connection is closed` — в лог выката валятся сотни
 * одинаковых стек-трейсов (см. ioredis `event_handler.js:208`).
 *
 * Ошибки безобидны: мы и так завершаемся, данных не теряем (все DB-записи уже
 * за-`await`-лены до shutdown). Поэтому глушим ТОЛЬКО этот конкретный текст и
 * только в фазе завершения; любая другая ошибка по-прежнему всплывает.
 *
 * Использование — один вызов в самом верху скрипта (после импортов):
 *   import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';
 *   silenceRedisShutdownNoise();
 */

let installed = false;

function isConnectionClosed(reason: unknown): boolean {
  const msg = reason instanceof Error ? reason.message : String(reason ?? '');
  return msg.includes('Connection is closed');
}

export function silenceRedisShutdownNoise(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    if (isConnectionClosed(reason)) return; // benign ioredis teardown — глушим
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    if (isConnectionClosed(err)) return; // benign ioredis teardown — глушим
    // eslint-disable-next-line no-console
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}
