import { createPrismaClient } from './_lib/prisma';

interface RunArgs {
  dryRun: boolean;
}

interface Stats {
  caseDetected: string;
  channelsBeforeGlobal: number;
  channelsBeforePerTenant: number;
  channelsAfterGlobal: number;
  channelsMarkedBroken: number;
  bindingsMoved: number;
}

const KIND = 'telegram_bot' as const;
const BROKEN_REASON = 'migrated-to-global';

async function main(args: RunArgs): Promise<void> {
  const prisma = createPrismaClient();
  try {
    log(`=== migrate-telegram-channels-to-global START (dryRun=${args.dryRun}) ===`);

    const all = await prisma.channel.findMany({
      where: { kind: KIND },
      orderBy: { updatedAt: 'desc' },
    });

    const global = all.find((c) => c.tenantId === null);
    const perTenant = all.filter((c) => c.tenantId !== null);
    const stats: Stats = {
      caseDetected: 'unknown',
      channelsBeforeGlobal: global ? 1 : 0,
      channelsBeforePerTenant: perTenant.length,
      channelsAfterGlobal: 0,
      channelsMarkedBroken: 0,
      bindingsMoved: 0,
    };

    log(`before: global=${stats.channelsBeforeGlobal}, perTenant=${stats.channelsBeforePerTenant}`);

    if (!global && perTenant.length === 0) {
      stats.caseDetected = 'A:fresh';
      log('case A: fresh DB — создаём пустой глобальный канал');
      if (!args.dryRun) {
        const created = await prisma.channel.create({
          data: {
            tenantId: null,
            kind: KIND,
            direction: 'bidirectional',
            config: {},
            status: 'active',
            maxDataClass: 'internal',
          },
        });
        log(`  created channelId=${created.id}`);
        stats.channelsAfterGlobal = 1;
      } else {
        stats.channelsAfterGlobal = 1;
      }
    } else if (global && perTenant.length === 0) {
      stats.caseDetected = 'B:already-migrated';
      log('case B: уже мигрировано — ничего не делаем');
      stats.channelsAfterGlobal = 1;
    } else if (!global && perTenant.length === 1) {
      stats.caseDetected = 'C:single-per-tenant';
      const only = perTenant[0]!;
      log(
        `case C: единственный per-tenant channelId=${only.id} (tenantId=${only.tenantId}) → конвертируем в глобальный`,
      );
      if (!args.dryRun) {
        const cfg = (only.config as Record<string, unknown>) ?? {};
        await prisma.channel.update({
          where: { id: only.id },
          data: {
            tenantId: null,
            config: {
              ...cfg,
              legacyTenantId: only.tenantId,
              migratedAt: new Date().toISOString(),
            },
          },
        });
      }
      stats.channelsAfterGlobal = 1;
    } else if (!global && perTenant.length > 1) {
      stats.caseDetected = 'D:multi-per-tenant';
      const chosen = perTenant[0]!;
      const rest = perTenant.slice(1);
      log(
        `case D: выбран самый свежий channelId=${chosen.id} (tenantId=${chosen.tenantId}), остальных ${rest.length}`,
      );
      for (const r of rest) {
        log(`  будем пометить broken: channelId=${r.id} (tenantId=${r.tenantId})`);
      }

      const legacyTokens = rest.map((r) => ({
        legacyChannelId: r.id,
        legacyTenantId: r.tenantId,
        config: r.config,
      }));
      const chosenCfg = (chosen.config as Record<string, unknown>) ?? {};
      const restIds = rest.map((r) => r.id);

      if (!args.dryRun) {
        await prisma.$transaction([
          prisma.channel.update({
            where: { id: chosen.id },
            data: {
              tenantId: null,
              config: {
                ...chosenCfg,
                legacyTenantId: chosen.tenantId,
                legacyTokens,
                migratedAt: new Date().toISOString(),
              },
            },
          }),
          prisma.channel.updateMany({
            where: { id: { in: restIds } },
            data: {
              status: 'broken',
              brokenReason: BROKEN_REASON,
            },
          }),
        ]);
        const moved = await prisma.channelBinding.updateMany({
          where: { channelId: { in: restIds } },
          data: { channelId: chosen.id },
        });
        stats.bindingsMoved = moved.count;
      } else {
        const wouldMove = await prisma.channelBinding.count({
          where: { channelId: { in: restIds } },
        });
        stats.bindingsMoved = wouldMove;
      }
      stats.channelsAfterGlobal = 1;
      stats.channelsMarkedBroken = rest.length;
    } else if (global && perTenant.length > 0) {
      stats.caseDetected = 'E:global-plus-per-tenant';
      log(
        `case E: глобальный уже есть (channelId=${global.id}), плюс ${perTenant.length} per-tenant → переносим bindings, помечаем broken`,
      );
      const perTenantIds = perTenant.map((c) => c.id);
      const legacyTokens = perTenant.map((r) => ({
        legacyChannelId: r.id,
        legacyTenantId: r.tenantId,
        config: r.config,
      }));
      const globalCfg = (global.config as Record<string, unknown>) ?? {};

      if (!args.dryRun) {
        await prisma.$transaction([
          prisma.channel.update({
            where: { id: global.id },
            data: {
              config: {
                ...globalCfg,
                legacyTokens: [
                  ...((globalCfg['legacyTokens'] as unknown[]) ?? []),
                  ...legacyTokens,
                ],
                migratedAt: new Date().toISOString(),
              },
            },
          }),
          prisma.channel.updateMany({
            where: { id: { in: perTenantIds } },
            data: {
              status: 'broken',
              brokenReason: BROKEN_REASON,
            },
          }),
        ]);
        const moved = await prisma.channelBinding.updateMany({
          where: { channelId: { in: perTenantIds } },
          data: { channelId: global.id },
        });
        stats.bindingsMoved = moved.count;
      } else {
        const wouldMove = await prisma.channelBinding.count({
          where: { channelId: { in: perTenantIds } },
        });
        stats.bindingsMoved = wouldMove;
      }
      stats.channelsAfterGlobal = 1;
      stats.channelsMarkedBroken = perTenant.length;
    }

    log('=== DONE ===');
    log(`case: ${stats.caseDetected}`);
    log(
      `result: globalAfter=${stats.channelsAfterGlobal}, brokenMarked=${stats.channelsMarkedBroken}, bindingsMoved=${stats.bindingsMoved}`,
    );
    if (args.dryRun) {
      log('DRY-RUN: ничего не записано. Запустите без --dry-run чтобы применить.');
    } else {
      log(
        'Изменения применены. Если что-то не так — `bun run scripts/migrate-telegram-channels-back.ts`.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

const dryRun = process.argv.includes('--dry-run');
main({ dryRun })
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('migrate-telegram-channels-to-global FAILED:', err);
    process.exit(1);
  });
