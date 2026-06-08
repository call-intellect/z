/**
 * ТЗ-1 Ф3.D (daily-value-engine) — Seed AdminSetting для фиксов достоверности
 * агентов исполнения.
 *
 * Регистрирует пороги-«крутилки» (редактируются super_admin'ом в админке,
 * code-fallback в самих сервисах):
 *   - `goals.author_coverage_min` (0..1, default 0.6) — минимальная доля
 *     commitment с непустым `commitmentAuthorPersonId` для goal-vector. Ниже —
 *     атрибуция kept/broken откатывается на адресата (recipient).
 *   - `reliability.min_denominator` (int, default 3) — минимальный знаменатель
 *     (kept+broken+overdue), ниже которого `reliabilityPercent` помечается как
 *     «мало данных» (не показываем 1/1=100%).
 *   - `probe.reply_latency_rise.factor` (number, default 2) — во сколько раз
 *     средняя задержка ответа за 14д должна вырасти vs baseline (15-90д), чтобы
 *     сработал trigrеr `reply_latency_rise`.
 *   - `probe.workload_overload.load_percent` (int, default 120) — порог
 *     `Appointment.loadPercent` (строго >) для триггера `workload_overload`.
 *   - `probe.meeting_noshows.count` (int, default 3) — минимум неявок за 28д
 *     для триггера `meeting_noshows`.
 *
 * Запуск:
 *   bun run scripts/seed-admin-setting-execution-agents.ts
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
    key: 'goals.author_coverage_min',
    value: 0.6,
    category: 'goals',
    section: 'goal_vector',
    severity: 'medium',
    description:
      'Минимальная доля (0..1) commitment с непустым автором (commitmentAuthorPersonId) в прогоне goal-vector. При покрытии ниже порога атрибуция kept/broken на этот прогон откатывается на адресата (recipient), чтобы не выбросить молча обещания с NULL-автором. По умолчанию 0.6.',
  },
  {
    key: 'reliability.min_denominator',
    value: 3,
    category: 'operations',
    section: 'reliability',
    severity: 'low',
    description:
      'Минимальный знаменатель надёжности обещаний (kept+broken+overdue), ниже которого процент помечается как «мало данных» (не показываем 1/1=100%). По умолчанию 3.',
  },
  {
    key: 'probe.reply_latency_rise.factor',
    value: 2,
    category: 'operations',
    section: 'probe',
    severity: 'low',
    description:
      'Во сколько раз должна вырасти средняя задержка ответа сотрудника за 14 дней относительно личного baseline (15-90 дней), чтобы сработал risk-триггер «реже отвечает» (reply_latency_rise). По умолчанию 2.',
  },
  {
    key: 'probe.workload_overload.load_percent',
    value: 120,
    category: 'operations',
    section: 'probe',
    severity: 'low',
    description:
      'Порог загрузки по активным назначениям (Appointment.loadPercent, строго больше), при превышении которого срабатывает risk-триггер перегрузки (workload_overload). По умолчанию 120 (%).',
  },
  {
    key: 'probe.meeting_noshows.count',
    value: 3,
    category: 'operations',
    section: 'probe',
    severity: 'low',
    description:
      'Минимум неявок на завершённые встречи за 28 дней (приглашён, но не присоединился), при котором срабатывает risk-триггер пропуска встреч (meeting_noshows). По умолчанию 3.',
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
  console.log('=== seed-admin-setting-execution-agents START ===');

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
  console.log('=== seed-admin-setting-execution-agents DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-execution-agents FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
