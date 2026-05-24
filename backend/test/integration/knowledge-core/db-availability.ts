/**
 * Проверка доступности dev-стека (Postgres + pgvector) перед запуском
 * integration-тестов knowledge-core/api (Phase F.2).
 *
 * Возвращает функцию, которую можно вызвать в `beforeAll`. Если БД
 * недоступна — тесты skip'нутся (через `ctx.skip()` в caller'е).
 */

import './setup-knowledge-core-env';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

let cachedClient: PrismaClient | null = null;
let cachedAvailability: boolean | null = null;
let cachedPgvector: boolean | null = null;

export async function checkDbAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    const client = await getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    cachedAvailability = true;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

export async function checkPgvectorAvailable(): Promise<boolean> {
  if (cachedPgvector !== null) return cachedPgvector;
  try {
    const client = await getPrismaClient();
    const rows = await client.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    cachedPgvector = rows.length > 0;
  } catch {
    cachedPgvector = false;
  }
  return cachedPgvector;
}

export async function getPrismaClient(): Promise<PrismaClient> {
  if (cachedClient) return cachedClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не выставлен');
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  await client.$connect();
  cachedClient = client;
  return client;
}

export async function closePrismaClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect();
    cachedClient = null;
  }
}
