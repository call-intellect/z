// dotenv/config — Prisma CLI читает prisma.config.ts своим загрузчиком, куда
// bun-автозагрузка .env не долетает; dotenv явно подхватывает .env (а в Docker,
// где .env нет, остаётся no-op и используются реальные env-переменные из compose).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 CLI-конфиг (db push / studio / seed).
 *
 * Connection URL вынесен сюда из schema.prisma (в v7 `url` в datasource удалён).
 * Рантайм-клиент использует driver adapter (PrismaPg) — см. PrismaService.
 *
 * `process.env['DATABASE_URL'] ?? ''` — фолбэк нужен, чтобы `prisma generate`
 * не падал, когда БД не требуется (например, на этапе сборки Docker-образа без DATABASE_URL).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'bun prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
