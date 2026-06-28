#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';

const BACKEND_ENV = 'backend/.env';

if (!existsSync(BACKEND_ENV)) {
  console.error('✖ Нет backend/.env. Создай локальный конфиг: bun scripts/make-local-env.ts');
  process.exit(1);
}

function parseEnvFile(path: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return map;
}

function childEnvWithout(envFilePath: string, extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (existsSync(envFilePath)) {
    for (const key of Object.keys(parseEnvFile(envFilePath))) delete env[key];
  }
  return { ...env, ...extra };
}

const services = [
  {
    name: 'backend',
    cmd: ['bun', 'src/main.ts'],
    cwd: 'backend',
    env: childEnvWithout(BACKEND_ENV),
  },
  {
    name: 'frontend',
    cmd: ['bun', 'run', 'dev'],
    cwd: 'frontend',
    env: childEnvWithout('frontend/.env.local', { NODE_ENV: 'development' }),
  },
].map((s) => ({
  name: s.name,
  proc: Bun.spawn(s.cmd, {
    cwd: s.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
    env: s.env,
  }),
}));

console.log('\n▶ ЛОКАЛЬНЫЙ dev-стек (backend/.env поверх process.env, НЕ прод):');
console.log('   backend   → http://localhost:3000   (Swagger /api/docs, health /health)');
console.log('   frontend  → http://localhost:3001');
console.log('   Ctrl+C — остановит оба сервиса\n');

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n⏹ Останавливаю backend+frontend…');
  for (const { proc } of services) {
    try {
      proc.kill();
    } catch {
      /* noop */
    }
  }
  await Promise.race([
    Promise.all(services.map((s) => s.proc.exited)),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
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

await Promise.race(services.map((s) => s.proc.exited));
console.error('✖ Один из сервисов завершился — останавливаю стек.');
void shutdown();
