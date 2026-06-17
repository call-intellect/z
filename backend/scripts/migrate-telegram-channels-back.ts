import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

interface RunArgs {
  dryRun: boolean;
}

const KIND = 'telegram_bot' as const;
const BROKEN_REASON = 'migrated-to-global';

async function main(args: RunArgs): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);

    log(`=== migrate-telegram-channels-back START (dryRun=${args.dryRun}) ===`);

    const global = await prisma.channel.findFirst({
      where: { kind: KIND, tenantId: null },
    });

    if (!global) {
      log('Глобальный telegram_bot канал не найден — нечего откатывать.');
      return;
    }

    const cfg = (global.config as Record<string, unknown>) ?? {};
    const legacyTenantId = cfg['legacyTenantId'] as string | undefined;

    log(`найден глобальный channelId=${global.id}, legacyTenantId=${legacyTenantId ?? 'none'}`);

    if (!legacyTenantId) {
      log('legacyTenantId отсутствует — канал создан с нуля (case A в forward).');
      log(
        'Удаляем глобальный канал. Бот после rollback работать перестанет — задеплойте старый код или восстановите per-tenant.',
      );
      if (!args.dryRun) {
        await prisma.$transaction([prisma.channel.delete({ where: { id: global.id } })]);
      }
    } else {
      log(`Восстанавливаем tenantId=${legacyTenantId} на глобальном канале.`);
      const clean = { ...cfg };
      delete clean['legacyTenantId'];
      delete clean['legacyTokens'];
      delete clean['migratedAt'];
      if (!args.dryRun) {
        await prisma.channel.update({
          where: { id: global.id },
          data: {
            tenantId: legacyTenantId,
            config: clean,
          },
        });
      }
    }

    const broken = await prisma.channel.findMany({
      where: { kind: KIND, brokenReason: BROKEN_REASON },
    });
    log(`Найдено broken-каналов для восстановления: ${broken.length}`);
    for (const b of broken) {
      log(`  channelId=${b.id} tenantId=${b.tenantId} → восстанавливаем status='active'`);
    }
    if (!args.dryRun && broken.length > 0) {
      await prisma.channel.updateMany({
        where: { kind: KIND, brokenReason: BROKEN_REASON },
        data: {
          status: 'active',
          brokenReason: null,
        },
      });
    }

    log('=== DONE ===');
    if (args.dryRun) {
      log('DRY-RUN: ничего не записано.');
    } else {
      log('Rollback применён. Перепроверьте состояние таблицы channels вручную.');
    }
  } finally {
    await app.close();
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
    console.error('migrate-telegram-channels-back FAILED:', err);
    process.exit(1);
  });
