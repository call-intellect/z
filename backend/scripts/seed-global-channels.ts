/**
 * β-9 (2026-05-25) — Idempotent seed для ГЛОБАЛЬНЫХ Channel'ов
 * (`tenantId IS NULL`).
 *
 * Сейчас единственный глобальный канал — `telegram_bot` (`@kora_bot`).
 * Скрипт создаёт «пустую» запись (`config={}`, `status='active'`) ровно
 * один раз, если её ещё нет. Токен в неё проложит главный администратор
 * Z через `bun run setup:telegram-bot --token <X> --public-host-url <Y>`
 * (или через будущую страницу `/admin/system/telegram-bot`).
 *
 * Правила `safe-seed-rules`:
 *   - **никаких** UPDATE'ов существующих записей: если канал уже есть —
 *     выходим без изменений (admin мог поменять токен / выключить /
 *     поднять `maxDataClass` — не трогаем).
 *   - запускается из `apply-postgres-init` / при первом деплое; повторный
 *     запуск — no-op.
 *
 * Запуск (из backend/):
 *   bun run scripts/seed-global-channels.ts
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

const GLOBAL_KINDS = ['telegram_bot'] as const;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);

    console.log('[seed-global-channels] START');

    let created = 0;
    let skipped = 0;
    for (const kind of GLOBAL_KINDS) {
      const existing = await prisma.channel.findFirst({
        where: { tenantId: null, kind },
      });
      if (existing) {
        console.log(
          `[seed-global-channels] kind=${kind} уже есть (id=${existing.id}, status=${existing.status}) — пропуск`,
        );
        skipped++;
        continue;
      }
      // Пустой config — токен админ проложит отдельно.
      const ch = await prisma.channel.create({
        data: {
          tenantId: null,
          kind,
          direction: 'bidirectional',
          maxDataClass: 'internal',
          status: 'active',
          config: {},
        },
      });
      console.log(
        `[seed-global-channels] kind=${kind} создан (id=${ch.id}, config пустой — настройте через setup:telegram-bot)`,
      );
      created++;
    }
    console.log(
      `[seed-global-channels] DONE: created=${created} skipped=${skipped}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[seed-global-channels] FATAL:', err);
  process.exit(1);
});
