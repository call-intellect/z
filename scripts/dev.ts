#!/usr/bin/env bun
/**
 * Полный локальный dev-стек одной командой: `bun run dev` (из корня репозитория).
 *
 * Поднимает:
 *   1. LiveKit (Docker, single-node) — через infra/livekit/livekit-dev.sh.
 *      При первом запуске образ скачивается автоматически.
 *   2. backend  — HTTP API :3000 + воркеры BullMQ in-process.
 *   3. frontend — :3001.
 *
 * Предполагается, что Postgres(+pgvector) и Redis уже подняты локально, а
 * backend/.env и frontend/.env.local заполнены (см. docs/dev/onboarding.md).
 *
 * Ctrl+C останавливает backend+frontend. LiveKit остаётся жить как сервис —
 * останови отдельно: `bun run livekit:down`.
 */
import { spawnSync } from 'node:child_process';

// ── 1. LiveKit ─────────────────────────────────────────────────────────────
console.log('▶ LiveKit: поднимаю (первый запуск — скачает образ)…');
const lk = spawnSync('infra/livekit/livekit-dev.sh', ['up'], { stdio: 'inherit' });
if (lk.status !== 0) {
  console.warn('⚠ LiveKit не поднялся (Docker недоступен?). Backend/frontend всё равно запущу — видео работать не будет.');
}

// ── 2. backend + frontend ──────────────────────────────────────────────────
const services = [
  { name: 'backend', cwd: 'backend' },
  { name: 'frontend', cwd: 'frontend' },
].map((s) => ({
  name: s.name,
  proc: Bun.spawn(['bun', 'run', 'dev'], {
    cwd: s.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  }),
}));

console.log('\n▶ Стек поднят:');
console.log('   backend   → http://localhost:3000   (Swagger /api/docs)');
console.log('   frontend  → http://localhost:3001');
console.log('   livekit   → ws://localhost:7880');
console.log('   Ctrl+C — остановит backend+frontend (LiveKit: bun run livekit:down)\n');

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { proc } of services) {
    try {
      proc.kill();
    } catch {
      /* noop */
    }
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Если любой из сервисов упал — гасим остальные.
await Promise.race(services.map((s) => s.proc.exited));
console.error('✖ Один из сервисов завершился — останавливаю стек.');
shutdown();
