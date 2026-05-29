/**
 * Установка/обновление пароля администратора.
 *
 * Usage:
 *   bun run scripts/set-admin-password.ts <email> <password> [--super]
 *
 * Флаг --super дополнительно выставляет isSuperAdmin=true (доступ к Z-Admin).
 *
 * Эффект:
 *   - Найти `User` с указанным email.
 *   - Если пользователь существует и role='admin' — обновить passwordHash
 *     (и isSuperAdmin=true при --super).
 *   - Если пользователь существует, но role!='admin' — отказ (ошибка).
 *   - Если пользователя нет — создать с role='admin', name=email,
 *     passwordHash=bcrypt(password, 12) (и isSuperAdmin=true при --super).
 *
 * Используется один раз при онбординге админа на проде. См. CLAUDE.md
 * раздел «5. Напомни про prod-операции» — этот скрипт показывается
 * программисту в инструкции по применению на прод.
 */

import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const BCRYPT_ROUNDS = 12;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const isSuper = argv.includes('--super');
  const [rawEmail, password] = argv.filter((a) => !a.startsWith('--'));
  if (!rawEmail || !password) {
    // eslint-disable-next-line no-console
    console.error('usage: bun run scripts/set-admin-password.ts <email> <password> [--super]');
    process.exit(1);
    return;
  }

  const email = rawEmail.trim().toLowerCase();
  if (password.length < 8) {
    // eslint-disable-next-line no-console
    console.error('Пароль должен быть не короче 8 символов.');
    process.exit(1);
    return;
  }

  const prisma = createPrismaClient();
  try {
    const existing = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
      },
    });

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    if (!existing) {
      const created = await prisma.user.create({
        data: {
          email,
          name: email,
          role: 'admin',
          isSuperAdmin: isSuper,
          passwordHash,
        },
      });
      // eslint-disable-next-line no-console
      console.log(
        `[set-admin-password] Создан ${isSuper ? 'SUPER-' : ''}admin id=${created.id}, email=${email}.`,
      );
      return;
    }

    if (existing.role !== 'admin') {
      // eslint-disable-next-line no-console
      console.error(
        `[set-admin-password] Пользователь email=${email} существует, но role=${existing.role}. Отказ.`,
      );
      process.exit(1);
      return;
    }

    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, ...(isSuper ? { isSuperAdmin: true } : {}) },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[set-admin-password] Обновлён passwordHash${isSuper ? ' + isSuperAdmin=true' : ''} для admin id=${existing.id}, email=${email}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[set-admin-password] FATAL:', err);
  process.exit(1);
});
