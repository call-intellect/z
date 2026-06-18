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
