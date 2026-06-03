/**
 * Goals OKR v2 (Фаза 4) — Seed AdminSetting для еженедельного пульса целей.
 *
 * Регистрирует два ключа динамической конфигурации:
 *   - `goals.pulse.enabled` (boolean, default true) — мастер-флаг cron'а
 *     `goals-pulse` (@Cron('0 6 * * 1') = пн 09:00 МСК). ENV-fallback
 *     `GOALS_PULSE_ENABLED`.
 *   - `goals.pulse.deliver_to_telegram` (boolean, default false) — рассылка
 *     пульса через `ConversationalService.sendNotification` (event-type
 *     `goals.pulse`) ролям owner/coo. По умолчанию false, чтобы Telegram не
 *     молотил сразу после раскатки. ENV-fallback `GOALS_PULSE_DELIVER_TO_TELEGRAM`.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-goals-pulse.ts
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Если AdminSetting уже редактировался super_admin'ом (`updatedBy != null`
 *     и `updatedBy != 'system'`) — НЕ перезаписываем `value`, обновляем только
 *     метаданные (category/section/severity/description).
 *   - Системная запись — обновим value на текущий fallback.
 */

import { type Prisma } from '@prisma/client';
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
    key: 'goals.pulse.enabled',
    value: true,
    category: 'goals',
    section: 'pulse',
    severity: 'medium',
    description:
      'Включает еженедельный cron пульса целей (пн 09:00 МСК). False → cron работает в no-op (без рестарта).',
  },
  {
    key: 'goals.pulse.deliver_to_telegram',
    value: false,
    category: 'goals',
    section: 'pulse',
    severity: 'medium',
    description:
      'Если true — после генерации пульс целей отправляется через ConversationalService.sendNotification(eventType=goals.pulse) ролям owner и coo. По умолчанию false, чтобы Telegram не молотил сразу после раскатки.',
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

  console.log('=== seed-admin-setting-goals-pulse START ===');

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

  console.log('=== seed-admin-setting-goals-pulse DONE ===');
}

main()
  .catch((err) => {

    console.error('seed-admin-setting-goals-pulse FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
