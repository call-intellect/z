#!/usr/bin/env bun
import { connect } from 'node:net';

const COMPOSE_FILE = 'docker-compose.dev.yml';
const DEP_SERVICES = ['postgres', 'redis', 'minio'];

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:56381');
const redisHost = redisUrl.hostname;
const redisPort = Number(redisUrl.port || '6379');

const waitForTcp = (host: string, port: number, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`${host}:${port} не отвечает за ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 500);
        }
      });
    };
    attempt();
  });
};

const ensureDeps = async (): Promise<void> => {
  console.log('▶ Поднимаю docker-зависимости (postgres/redis/minio)…');
  const up = Bun.spawn(['docker', 'compose', '-f', COMPOSE_FILE, 'up', '-d', ...DEP_SERVICES], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await up.exited) !== 0) {
    console.error('✖ Не удалось поднять docker-зависимости. Docker-демон запущен?');
    process.exit(1);
  }
  try {
    await waitForTcp(redisHost, redisPort, 30_000);
  } catch (err) {
    console.error(`✖ Redis (${redisHost}:${redisPort}) не готов: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`✓ Зависимости готовы (Redis ${redisHost}:${redisPort})`);
};

await ensureDeps();

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
