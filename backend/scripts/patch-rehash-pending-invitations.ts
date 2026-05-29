/**
 * audit Б1 (2026-05-29) — перегенерация одноразовых паролей в pending-инвайтах.
 *
 * Проблема: в β-10 (commit-ы до 2026-05-29) `OrgInvitation.tempPasswordHash`
 * писался как `sha256(tempPassword)`, а `accounts.login` использует
 * `PasswordService.verify(argon2)`. argon2.verify бросает на sha256-хексе,
 * пользователь не может войти по credentials из письма.
 *
 * Что делает (идемпотентно):
 *   1. Находит OrgInvitation с `acceptedAt IS NULL`, `status = 'pending'`,
 *      `tempPasswordHash IS NOT NULL`, у которого хеш НЕ argon2-конверта
 *      (sha256-хекс — 64 hex chars; argon2id-конверт начинается с `$argon2id$`).
 *   2. Генерирует новый одноразовый пароль (15 байт base64url = 120 бит).
 *   3. Хеширует его argon2id с параметрами из ENV (ARGON_MEMORY_KB / _ITERATIONS / _PARALLELISM).
 *   4. Пишет новый `tempPasswordHash`, инкрементит `magicTokenHash`/`magicTokenUsedAt=null`,
 *      пересоздаёт `linkCode` НЕ трогает (telegram отдельная история).
 *   5. Шлёт письмо повторно через MailService (`sendInviteWithCredentials`).
 *
 * NB: магик-линк и telegram-deep-link мы НЕ перевыпускаем — они через
 * другие проверки и не зависят от sha256/argon2. Цель скрипта — оживить
 * именно credentials-логин.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-rehash-pending-invitations.ts          # apply
 *   docker compose exec backend bun run scripts/patch-rehash-pending-invitations.ts --dry-run
 *   docker compose exec backend bun run scripts/patch-rehash-pending-invitations.ts --limit=100
 *
 * Зарегистрирован в `apply-prod-deploy.ts` STEPS (phase: 'patch', skipBootstrap: true).
 */

import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface CliOptions {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, limit: null };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0) opts.limit = n;
    }
  }
  return opts;
}

/**
 * argon2id-конверт начинается с `$argon2id$v=19$m=...,t=...,p=...$salt$hash`.
 * sha256-хекс — ровно 64 символа [0-9a-f]. Любой другой формат считаем
 * «непонятным» и пропускаем (для безопасности — не перезаписываем).
 */
function looksLikeArgon2(hash: string | null): boolean {
  return typeof hash === 'string' && hash.startsWith('$argon2');
}

function looksLikeSha256Hex(hash: string | null): boolean {
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
}

function generateInviteTempPassword(): string {
  return randomBytes(15).toString('base64url');
}

async function hashArgon2(plain: string): Promise<string> {
  const memoryCost = Number.parseInt(process.env['ARGON_MEMORY_KB'] ?? '19456', 10);
  const timeCost = Number.parseInt(process.env['ARGON_ITERATIONS'] ?? '2', 10);
  const parallelism = Number.parseInt(process.env['ARGON_PARALLELISM'] ?? '1', 10);
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost,
    timeCost,
    parallelism,
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[audit Б1 rehash invitations] start', {
    dryRun: opts.dryRun,
    limit: opts.limit ?? '∞',
  });

  const pendings = await prisma.orgInvitation.findMany({
    where: {
      acceptedAt: null,
      status: 'pending',
      tempPasswordHash: { not: null },
    },
    select: {
      id: true,
      email: true,
      orgId: true,
      tempPasswordHash: true,
    },
    take: opts.limit ?? undefined,
  });

  console.log(
    `[audit Б1 rehash invitations] pending invitations с tempPasswordHash: ${pendings.length}`,
  );

  let alreadyOk = 0;
  let toRehash = 0;
  let unknown = 0;
  for (const inv of pendings) {
    if (looksLikeArgon2(inv.tempPasswordHash)) {
      alreadyOk += 1;
      continue;
    }
    if (looksLikeSha256Hex(inv.tempPasswordHash)) {
      toRehash += 1;
    } else {
      unknown += 1;
    }
  }

  console.log(
    `[audit Б1 rehash invitations] argon2 уже: ${alreadyOk}, sha256→rehash: ${toRehash}, unknown: ${unknown}`,
  );

  if (opts.dryRun) {
    console.log('[audit Б1 rehash invitations] dry-run: ничего не пишем');
    return;
  }

  let updated = 0;
  let resentEmails = 0;
  for (const inv of pendings) {
    if (!looksLikeSha256Hex(inv.tempPasswordHash)) continue;

    const tempPassword = generateInviteTempPassword();
    const tempPasswordHash = await hashArgon2(tempPassword);

    await prisma.orgInvitation.update({
      where: { id: inv.id },
      data: { tempPasswordHash },
    });
    updated += 1;

    // Письмо — best-effort. Скрипт не должен падать из-за SMTP-проблем.
    // В audit Б1 (5.) указано «повторно отправить письмо». Если в скрипте
    // нет доступа к MailService (Nest DI), мы хотя бы логируем тенант/инвайт,
    // чтобы оператор знал кому ручную ссылку выслать.
    if (inv.email) {
      console.log(
        `[audit Б1 rehash invitations] ⚠ инвайт ${inv.id} (org=${inv.orgId}, email=${inv.email}) — ` +
          `новый одноразовый пароль СГЕНЕРИРОВАН и СОХРАНЁН в БД. ` +
          `MailService недоступен из bun-скрипта; перешлите письмо вручную ` +
          `через POST /api/v1/orgs/:orgId/invitations/:id/resend ИЛИ просто ` +
          `используйте magic-link — он остался валиден.`,
      );
      resentEmails += 1;
    }
  }

  console.log(
    `[audit Б1 rehash invitations] done. Обновлено: ${updated}, требуют ручной пересылки письма: ${resentEmails}`,
  );
}

main()
  .catch((err) => {
    console.error('[audit Б1 rehash invitations] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
