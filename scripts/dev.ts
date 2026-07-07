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

// detached:true → setsid(), каждый сервис становится лидером своей группы
// процессов. Это даёт возможность убить его ВМЕСТЕ со всеми потомками
// (напр. `bun run dev` во frontend/ порождает `next dev`, который порождает
// `next-server`+postcss-воркеры) через process.kill(-pid, sig) — обычный
// proc.kill() убивает только прямого потомка, внуки остаются сиротами и
// продолжают писать в консоль после Ctrl+C.
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
    detached: true,
  }),
}));

const backendPort = process.env.PORT ?? '3000';
const frontendPort = process.env.FRONTEND_PORT ?? '3001';
console.log('\n▶ dev-стек поднят:');
console.log(
  `   backend   → http://localhost:${backendPort}   (Swagger /api/docs, health /health)`,
);
console.log(`   frontend  → http://localhost:${frontendPort}`);
console.log('   Ctrl+C — остановит оба сервиса (вместе со всеми их потомками)\n');

// killGroup убивает всю группу процессов (сервис + все его потомки), а не
// только прямого child. Отсутствие группы (ESRCH — процесс уже мёртв) —
// штатный случай при повторном вызове, не ошибка.
const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    /* группа уже мертва — ок */
  }
};

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n⏹ Останавливаю backend+frontend (вместе с потомками)…');
  for (const { proc } of services) killGroup(proc.pid, 'SIGTERM');
  await Promise.race([
    Promise.all(services.map((s) => s.proc.exited)),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  for (const { proc } of services) killGroup(proc.pid, 'SIGKILL');
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// Страховка от «осиротевшего стека»: если dev.ts упадёт по необработанному
// исключению до чистого SIGINT/SIGTERM-пути, дочерние процессы иначе
// продолжат жить бесконечно (их родитель — init, сигнал терминала до них
// не долетает — ровно так ловился этот баг).
process.on('uncaughtException', (err) => {
  console.error('✖ dev.ts упал по необработанному исключению:', err);
  void shutdown();
});
process.on('unhandledRejection', (err) => {
  console.error('✖ dev.ts: необработанный rejection:', err);
  void shutdown();
});
// Синхронный последний рубеж: если процесс всё же завершается мимо
// shutdown() (напр. process.exit() вызван откуда-то ещё), SIGKILL группам
// уходит здесь — 'exit' не умеет ждать async, но kill(9) и не нужно ждать.
process.on('exit', () => {
  if (shuttingDown) return;
  for (const { proc } of services) killGroup(proc.pid, 'SIGKILL');
});

await Promise.race(services.map((s) => s.proc.exited));
console.error('✖ Один из сервисов завершился — останавливаю стек.');
void shutdown();
