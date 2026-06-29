import argon2 from 'argon2';
import { createPrismaClient } from './_lib/prisma';

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: Number.parseInt(process.env['ARGON_MEMORY_KB'] ?? '19456', 10),
  timeCost: Number.parseInt(process.env['ARGON_ITERATIONS'] ?? '2', 10),
  parallelism: Number.parseInt(process.env['ARGON_PARALLELISM'] ?? '1', 10),
} as const;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const isSuper = argv.includes('--super');
  const [rawEmail, password] = argv.filter((a) => !a.startsWith('--'));
  if (!rawEmail || !password) {
     
    console.error('usage: bun run scripts/set-admin-password.ts <email> <password> [--super]');
    process.exit(1);
    return;
  }

  const email = rawEmail.trim().toLowerCase();
  if (password.length < 8) {
     
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

    const passwordHash = await argon2.hash(password, ARGON_OPTS);

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
       
      console.log(
        `[set-admin-password] Создан ${isSuper ? 'SUPER-' : ''}admin id=${created.id}, email=${email}.`,
      );
      return;
    }

    if (existing.role !== 'admin') {
       
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
     
    console.log(
      `[set-admin-password] Обновлён passwordHash${isSuper ? ' + isSuperAdmin=true' : ''} для admin id=${existing.id}, email=${email}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
   
  console.error('[set-admin-password] FATAL:', err);
  process.exit(1);
});
