/**
 * audit С31 (2026-05-29) — verify-скрипт.
 *
 * После UnifiedLoginController (свежий 93f2e04) `/login` пробует
 * по очереди два пути:
 *   1) standalone-аккаунт (argon2id, AccountsService);
 *   2) admin-аккаунт (bcrypt, AdminLoginService) — `User` с `role='admin'`.
 *
 * В Z НЕТ отдельной таблицы AdminUser — admin это `User` с `role='admin'`
 * (см. backend/src/modules/auth/services/admin-login.service.ts). Возможные
 * конфликты, которые приводят к путанице ролей при логине:
 *
 *  A. Один email встречается у двух `User` записей (PK разный, email одинаковый
 *     case-insensitive). Должен быть невозможен из-за `@unique` в схеме,
 *     но проверяем — для устаревших данных / коллизий ILIKE.
 *  B. У `User.role='admin'` стоит argon2id-хеш (`$argon2id$...`) — admin-login
 *     по bcrypt всегда будет падать; пользователь сможет логиниться только
 *     через standalone-путь. Технически работает, но путает routing.
 *  C. У `User.role='user'` стоит bcrypt-хеш (`$2a/$2b$...`) — standalone-логин
 *     (argon2) упадёт на verify; админ-путь тоже не возьмёт (role != 'admin').
 *     Пользователь не сможет залогиниться.
 *  D. У `User.isSuperAdmin=true` стоит `role='user'` (а не 'admin') —
 *     SuperAdminGuard пропустит (isSuperAdmin=true), но Z-Admin routing
 *     может считать его «обычным» в зависимости от пути.
 *
 * Скрипт ТОЛЬКО для чтения (dry-run-only — без --fix). Решение «dry-run-only»
 * принято потому, что любой авто-fix несёт риск:
 *   - удалить случайно живого пользователя,
 *   - сбросить isSuperAdmin у владельца Z,
 *   - переписать pwd-хеш без согласия владельца.
 *
 * Запуск:
 *   bun run scripts/patch-audit-user-email-conflicts.ts
 *
 * Идемпотентный, читающий — можно запускать сколько угодно раз.
 */

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

function classifyHash(
  hash: string | null,
): 'argon2id' | 'bcrypt' | 'unknown' | 'empty' {
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

    // ── A. Дубли email (case-insensitive). ─────────────────────────────
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

    // ── B/C. role ↔ hashKind mismatch. ─────────────────────────────────
    const mismatches: RoleHashMismatchRow[] = [];
    for (const u of allUsers) {
      const hk = classifyHash(u.passwordHash);
      if (hk === 'empty' || hk === 'unknown') continue; // отдельная история
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

    // ── D. isSuperAdmin=true с role='user'. ─────────────────────────────
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

    const total =
      dupEmails.length + mismatches.length + suWithUserRole.length;
    if (total === 0) {
      console.log('\n=== ИТОГ: проблем не обнаружено ===');
    } else {
      console.log(`\n=== ИТОГ: ${total} проблем(ы) — manual decision требуется ===`);
      console.log('Как чинить (вручную, после консультации с владельцем):');
      console.log('  A. Дубли email — переименовать одну из записей либо удалить менее ценную:');
      console.log('     UPDATE "User" SET "email"=CONCAT(\'archived-\',id,\'-\',email) WHERE id=\'<userId>\';');
      console.log('  B. admin с argon2id-хешем — нужен ре-set пароля через скрипт');
      console.log('     scripts/set-admin-password.ts (выпустит bcrypt-хеш).');
      console.log('  C. user с bcrypt-хешем — попросить пользователя пройти восстановление пароля.');
      console.log('  D. SuperAdmin с role!=admin — обычно UPDATE "User" SET "role"=\'admin\' WHERE id=\'<userId>\';');
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
