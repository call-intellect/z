/**
 * Bootstrap-сид: создаёт первого админа из ADMIN_BOOTSTRAP_EMAIL,
 * если в БД нет ни одного пользователя с ролью `admin`.
 *
 * Правила:
 *  - Никаких массовых сидов (см. `.claude/skills/safe-seed-rules`).
 *  - Идемпотентно: повторный запуск не дублирует и не перезаписывает.
 *  - Пароль НЕ устанавливаем — это задача Фазы 8.4.
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7: standalone-клиент тоже требует driver adapter (URL — из env; bun грузит .env).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

async function main(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!email) {
    console.warn(
      '[seed] ADMIN_BOOTSTRAP_EMAIL не задан — пропускаем создание админа.',
    );
    return;
  }

  const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (existingAdmin) {
    console.warn(
      `[seed] Админ уже существует (id=${existingAdmin.id}, email=${existingAdmin.email}) — пропуск.`,
    );
    return;
  }

  const created = await prisma.user.create({
    data: {
      email,
      name: 'Admin',
      role: 'admin',
      externalId: null,
    },
  });

  console.warn(`[seed] Создан первый админ: id=${created.id}, email=${created.email}`);
}

main()
  .catch((err: unknown) => {
    console.error('[seed] Ошибка:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
