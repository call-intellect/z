import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 CLI-конфиг (db push / studio / seed).
 *
 * Connection URL вынесен сюда из schema.prisma (в v7 `url` в datasource удалён).
 * Рантайм-клиент использует driver adapter (PrismaPg) — см. PrismaService.
 *
 * DATABASE_URL подхватывается из окружения: Bun автозагружает `.env` в dev,
 * а в docker-деплое переменные приходят из compose `env_file`. Здесь читаем
 * `process.env` напрямую с фолбэком на '' — это конфиг CLI (не app-код), и
 * фолбэк нужен, чтобы `prisma generate` не падал, когда БД не требуется
 * (например, на этапе сборки Docker-образа без DATABASE_URL).
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
