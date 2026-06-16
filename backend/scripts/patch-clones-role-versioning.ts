import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { tableExists } from './_lib/schema-guards';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

interface CliOptions {
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`=== patch-clones-role-versioning START (dry-run=${opts.dryRun}) ===`);

  const hasRoles = await tableExists(prisma, 'roles');
  const sql = hasRoles
    ? `
      SELECT p.id, p."tenantId", p."scopeRefId",
             r.name AS "roleName"
      FROM "executable_personas" p
      LEFT JOIN "roles" r ON r.id = p."scopeRefId"
      WHERE p.scope = 'role'
        AND p.status = 'active'
        AND p."roleVersion" IS NULL
    `
    : `
      SELECT p.id, p."tenantId", p."scopeRefId",
             NULL AS "roleName"
      FROM "executable_personas" p
      WHERE p.scope = 'role'
        AND p.status = 'active'
        AND p."roleVersion" IS NULL
    `;
  const candidates = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      tenantId: string;
      scopeRefId: string | null;
      roleName: string | null;
    }>
  >(sql);

  console.log(`Найдено кандидатов: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Нечего обновлять — skip.');
    return;
  }

  let updated = 0;
  let warnedNoRole = 0;

  for (const cand of candidates) {
    const roleName = cand.roleName?.trim();
    const publicName = roleName ? `Клон ${roleName} v1` : 'Клон роли v1';
    if (!roleName) {
      warnedNoRole++;
      console.warn(
        `[warn] persona ${cand.id} scopeRefId=${cand.scopeRefId ?? '<null>'} — Role не найдена; ставим публичное имя '${publicName}'`,
      );
    }

    if (opts.dryRun) {
      console.log(
        `[dry-run] persona=${cand.id} → roleVersion=1, publicName='${publicName}', currentBearerPersonId=null, succeedsPersonaId=null`,
      );
      continue;
    }

    await prisma.executablePersona.update({
      where: { id: cand.id },
      data: {
        roleVersion: 1,
        publicName,
        currentBearerPersonId: null,
        succeedsPersonaId: null,
      },
    });
    updated++;
  }

  console.log(
    `\nИТОГО: candidates=${candidates.length}, updated=${updated}, warnedNoRole=${warnedNoRole}`,
  );
}

main()
  .catch((err) => {
    console.error('patch-clones-role-versioning FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('=== patch-clones-role-versioning DONE ===');
  });
