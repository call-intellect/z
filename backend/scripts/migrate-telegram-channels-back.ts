/**
 * β-9 (2026-05-25) — Откат миграции Telegram-каналов из глобального в per-tenant.
 *
 * Парный rollback-скрипт к `migrate-telegram-channels-to-global.ts`. Использовать
 * если после deploy β-9 что-то пошло не так и надо вернуть прежнее поведение
 * «один бот на одну Org».
 *
 * Логика:
 *   1. Найти глобальный telegram_bot канал (tenantId IS NULL).
 *   2. Прочитать config.legacyTenantId — это исходный tenantId, который был у этого
 *      Channel'а до forward-миграции.
 *   3. Если legacyTenantId отсутствует — глобальный канал создан с нуля
 *      (case A в forward), откатывать нечего: просто удалить запись.
 *   4. Если legacyTenantId есть — UPDATE channels SET tenantId=<legacyTenantId>,
 *      очистить временные поля в config.
 *   5. Найти каналы с brokenReason='migrated-to-global' и вернуть им
 *      status='active'. ChannelBinding'и, которые forward-скрипт перенёс на
 *      глобальный, оставить как есть — в обратную сторону мы их не различим
 *      (нет map'а). На практике после rollback при следующем forward'е они
 *      снова попадут на глобальный.
 *
 * Внимание. Скрипт НЕ восстанавливает идеальное состояние «как было». Он
 * возвращает структуру каналов, но привязки сотрудников остаются прицепленными
 * к одному «победившему» каналу. Это сознательный выбор — точечный rollback
 * для аварийной ситуации, не полный backup.
 *
 * Запуск (из backend/):
 *   bun run scripts/migrate-telegram-channels-back.ts --dry-run
 *   bun run scripts/migrate-telegram-channels-back.ts
 */

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
      log('Удаляем глобальный канал. Бот после rollback работать перестанет — задеплойте старый код или восстановите per-tenant.');
      if (!args.dryRun) {
        await prisma.$transaction([
          // Привязки удалятся каскадом по `onDelete: Cascade` от Channel.
          prisma.channel.delete({ where: { id: global.id } }),
        ]);
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
            // status оставляем как есть — если был global_disabled, переключим на active вручную.
          },
        });
      }
    }

    // Восстановить broken-каналы.
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
