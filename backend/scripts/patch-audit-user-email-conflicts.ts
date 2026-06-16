import { createPrismaClient } from './_lib/prisma';

interface DuplicateEmailRow {
  email: string;
  userIds: string[];
}

interface RoleHashMismatchRow {
  userId: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  hashKind: 'argon2id' | 'bcrypt' | 'unknown' | 'empty';
  expectedKindForRole: 'argon2id' | 'bcrypt';
}

interface SuperAdminWithUserRoleRow {
  userId: string;
  email: string;
  role: string;
}

function classifyHash(hash: string | null): 'argon2id' | 'bcrypt' | 'unknown' | 'empty' {
  if (!hash) return 'empty';
  if (hash.startsWith('$argon2')) return 'argon2id';
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    return 'bcrypt';
  }
  return 'unknown';
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  /* eslint-disable no-console */
  try {
    console.log('=== patch-audit-user-email-conflicts START (dry-run-only) ===');

    const allUsers = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        isSuperAdmin: true,
        passwordHash: true,
      },
    });
    console.log(`Всего активных User: ${allUsers.length}`);

    const byEmail = new Map<string, string[]>();
    for (const u of allUsers) {
      const key = u.email.trim().toLowerCase();
      const arr = byEmail.get(key) ?? [];
      arr.push(u.id);
      byEmail.set(key, arr);
    }
    const dupEmails: DuplicateEmailRow[] = [];
    for (const [email, userIds] of byEmail.entries()) {
      if (userIds.length > 1) dupEmails.push({ email, userIds });
    }

    if (dupEmails.length === 0) {
      console.log('✔ A. Дубли email: нет');
    } else {
      console.log(`⚠ A. Дубли email: ${dupEmails.length}`);
      for (const d of dupEmails) {
        console.log(`   ${d.email} → userIds: ${d.userIds.join(', ')}`);
      }
    }

    const mismatches: RoleHashMismatchRow[] = [];
    for (const u of allUsers) {
      const hk = classifyHash(u.passwordHash);
      if (hk === 'empty' || hk === 'unknown') continue;
      const expected = u.role === 'admin' ? 'bcrypt' : 'argon2id';
      if (hk !== expected) {
        mismatches.push({
          userId: u.id,
          email: u.email,
          role: u.role,
          isSuperAdmin: u.isSuperAdmin,
          hashKind: hk,
          expectedKindForRole: expected,
        });
      }
    }
    if (mismatches.length === 0) {
      console.log('✔ B/C. role ↔ hash format mismatches: нет');
    } else {
      console.log(`⚠ B/C. role ↔ hash format mismatches: ${mismatches.length}`);
      for (const m of mismatches) {
        console.log(
          `   userId=${m.userId} email=${m.email} role=${m.role} isSuperAdmin=${m.isSuperAdmin} hashKind=${m.hashKind} (ожидался ${m.expectedKindForRole})`,
        );
      }
    }

    const suWithUserRole: SuperAdminWithUserRoleRow[] = allUsers
      .filter((u) => u.isSuperAdmin && u.role !== 'admin')
      .map((u) => ({ userId: u.id, email: u.email, role: u.role }));
    if (suWithUserRole.length === 0) {
      console.log('✔ D. SuperAdmin с role!=admin: нет');
    } else {
      console.log(`⚠ D. SuperAdmin с role!=admin: ${suWithUserRole.length}`);
      for (const s of suWithUserRole) {
        console.log(`   userId=${s.userId} email=${s.email} role=${s.role}`);
      }
    }

    const total = dupEmails.length + mismatches.length + suWithUserRole.length;
    if (total === 0) {
      console.log('\n=== ИТОГ: проблем не обнаружено ===');
    } else {
      console.log(`\n=== ИТОГ: ${total} проблем(ы) — manual decision требуется ===`);
      console.log('Как чинить (вручную, после консультации с владельцем):');
      console.log('  A. Дубли email — переименовать одну из записей либо удалить менее ценную:');
      console.log(
        "     UPDATE \"User\" SET \"email\"=CONCAT('archived-',id,'-',email) WHERE id='<userId>';",
      );
      console.log('  B. admin с argon2id-хешем — нужен ре-set пароля через скрипт');
      console.log('     scripts/set-admin-password.ts (выпустит bcrypt-хеш).');
      console.log(
        '  C. user с bcrypt-хешем — попросить пользователя пройти восстановление пароля.',
      );
      console.log(
        '  D. SuperAdmin с role!=admin — обычно UPDATE "User" SET "role"=\'admin\' WHERE id=\'<userId>\';',
      );
      console.log('\nЭтот скрипт НЕ применяет --fix автоматически (безопасный dry-run-only).');
    }
  } finally {
    await prisma.$disconnect();
  }
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-audit-user-email-conflicts FAILED:', err);
  process.exit(1);
});
