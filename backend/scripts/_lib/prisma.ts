/**
 * Helper для prod/dev-скриптов: создаёт `PrismaClient` с driver adapter
 * (`@prisma/adapter-pg`), как требует Prisma 7. Без adapter голый
 * `new PrismaClient()` падает с `PrismaClientInitializationError:
 * needs to be constructed with non-empty PrismaClientOptions`.
 *
 * Использовать вместо `new PrismaClient()`:
 *   import { createPrismaClient } from './_lib/prisma';
 *   const prisma = createPrismaClient();
 *
 * `DATABASE_URL` берётся из env. В контейнере backend он уже выставлен
 * через `env_file: [.env]` (см. `docker-compose.yml`).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export function createPrismaClient(): PrismaClient {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      '[_lib/prisma] DATABASE_URL не задан в env. ' +
        'В compose это идёт через env_file: [.env].',
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
}
