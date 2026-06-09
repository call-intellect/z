#!/usr/bin/env bun
/**
 * Локальный dev-стек одной командой из корня: `bun run dev`.
 *
 * Поднимает СРАЗУ backend + frontend (нативно через Bun, без контейнеров):
 *   - backend  → http://localhost:3000  (API + воркеры BullMQ in-process)
 *   - frontend → http://localhost:3001  (Next.js dev)
 *
 * Модель локальной разработки (без отдельного docker-compose.dev.yml):
 *   - Единый источник правды по compose — корневой `docker-compose.yml` (он же
 *     прод). Локально из него нужен только Postgres: `docker compose up -d postgres`.
 *     Redis — хостовый. Back/front — нативно, НЕ контейнерами.
 *   - ENV — единый корневой `.env` (без `.env.local`). Бэку подаём явно через
 *     `--env-file=../.env`, т.к. Bun сам грузит `.env` только из cwd (backend/).
 *     Frontend env-файла не требует — клиент по умолчанию ходит на :3000.
 *
 * Backend запускается БЕЗ `--watch`: на arm64/WSL bun --watch ломает трансляцию
 * TS (`as const`), поэтому hot-reload бэка недоступен — после правок кода бэка
 * перезапусти `bun run dev`. Frontend (next dev) свой hot-reload сохраняет.
 *
 * LiveKit (видеовстречи, для chatbox не нужен) — отдельно: `bun run livekit`.
 * Ctrl+C останавливает backend+frontend.
 *
 * Предполагается, что Postgres(+pgvector) поднят и `.env` (DATABASE_URL,
 * REDIS_URL) заполнен.
 */

const services = [
  { name: 'backend', cmd: ['bun', '--env-file=../.env', 'src/main.ts'], cwd: 'backend' },
  { name: 'frontend', cmd: ['bun', 'run', 'dev'], cwd: 'frontend' },
].map((s) => ({
  name: s.name,
  proc: Bun.spawn(s.cmd, {
    cwd: s.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  }),
}));

const backendPort = process.env.PORT ?? '3000';
const frontendPort = process.env.FRONTEND_PORT ?? '3001';
console.log('\n▶ dev-стек поднят:');
console.log(
  `   backend   → http://localhost:${backendPort}   (Swagger /api/docs, health /health)`,
);
console.log(`   frontend  → http://localhost:${frontendPort}`);
console.log('   Ctrl+C — остановит оба сервиса\n');

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n⏹ Останавливаю backend+frontend…');
  // 1) мягко (SIGTERM)
  for (const { proc } of services) {
    try {
      proc.kill();
    } catch {
      /* noop */
    }
  }
  // 2) ждём до 2.5с — иначе backend с BullMQ-воркерами тормозит graceful-shutdown
  await Promise.race([
    Promise.all(services.map((s) => s.proc.exited)),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  // 3) добиваем SIGKILL, чтобы не осталось осиротевших процессов «фоном»
  for (const { proc } of services) {
    try {
      proc.kill(9);
    } catch {
      /* noop */
    }
  }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// Если любой из сервисов упал — гасим остальные.
await Promise.race(services.map((s) => s.proc.exited));
console.error('✖ Один из сервисов завершился — останавливаю стек.');
void shutdown();
