/**
 * SBA β-8.3 — Seed AdminSetting для ежедневного отчёта COO.
 *
 * Регистрирует два ключа динамической конфигурации:
 *   - `operations.daily_digest.enabled` (boolean, default true) — мастер-флаг
 *     cron'а `operations-daily-digest`. ENV-fallback `COO_DAILY_DIGEST_ENABLED`.
 *   - `operations.daily_digest.deliver_to_telegram` (boolean, default false)
 *     — рассылка через `ConversationalService.sendNotification` (event-type
 *     `operations.daily_digest`). По умолчанию false, чтобы Telegram не
 *     молотил сразу после раскатки. ENV-fallback
 *     `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-daily-digest.ts
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Если AdminSetting уже редактировался super_admin'ом (`updatedBy != null`
 *     и `updatedBy != 'system'`) — НЕ перезаписываем `value`, обновляем
 *     только метаданные (category/section/severity/description).
 *   - Системная запись — обновим value на текущий fallback.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: Severity;
  description: string;
}

const SEEDS: SettingSeed[] = [
  {
    key: 'operations.daily_digest.enabled',
    value: true,
    category: 'operations',
    section: 'daily_digest',
    severity: 'medium',
    description:
      'Включает ежедневный cron генерации отчёта операционного директора (01:00 МСК). False → cron работает в no-op (без рестарта).',
  },
  {
    key: 'operations.daily_digest.deliver_to_telegram',
    value: false,
    category: 'operations',
    section: 'daily_digest',
    severity: 'medium',
    description:
      'Если true — после генерации ежедневный дайджест отправляется через ConversationalService.sendNotification(eventType=operations.daily_digest) ролям coo и owner. По умолчанию false, чтобы Telegram не молотил сразу после раскатки.',
  },
];

interface Counters {
  created: number;
  updated: number;
  skippedAdminEdited: number;
}

async function upsertSetting(seed: SettingSeed, counters: Counters): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.created++;
     
    console.log(`[create] ${seed.key}`);
    return;
  }

  // Admin-edited — не трогаем value, обновляем только метаданные.
  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity: seed.severity,
        description: seed.description,
      },
    });
    counters.skippedAdminEdited++;
     
    console.log(`[skip:admin-edited] ${seed.key}`);
    return;
  }

  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity: seed.severity,
      description: seed.description,
    },
  });
  counters.updated++;
   
  console.log(`[update] ${seed.key}`);
}

async function main(): Promise<void> {
   
  console.log('=== seed-admin-setting-daily-digest START ===');

  const counters: Counters = {
    created: 0,
    updated: 0,
    skippedAdminEdited: 0,
  };

  for (const seed of SEEDS) {
    await upsertSetting(seed, counters);
  }

   
  console.log(
    `created=${counters.created}, updated=${counters.updated}, skipped_admin_edited=${counters.skippedAdminEdited}`,
  );
   
  console.log('=== seed-admin-setting-daily-digest DONE ===');
}

main()
  .catch((err) => {
     
    console.error('seed-admin-setting-daily-digest FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
