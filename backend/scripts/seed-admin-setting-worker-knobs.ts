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
    key: 'knowledge.axisClassifyEnabled',
    value: true,
    category: 'knowledge',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник классификатора осей блока графа. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'roleProfiles.minBlocks',
    value: 5,
    category: 'knowledge',
    section: 'role_profiles',
    severity: 'low',
    description: 'Минимум блоков для построения профиля роли. По умолчанию 5.',
  },
  {
    key: 'curation.consistencyCheckerDedupTtlSeconds',
    value: 14_400,
    category: 'knowledge',
    section: 'curation',
    severity: 'low',
    description:
      'TTL (сек) дедупа проверки согласованности знаний (не плодить одинаковые конфликты). По умолчанию 14400 (4 ч).',
  },
  {
    key: 'curation.consistencyCheckerEnabled',
    value: true,
    category: 'knowledge',
    section: 'curation',
    severity: 'high',
    description:
      'Рубильник проверки согласованности знаний (поиск противоречий). По умолчанию вкл (Ship-On).',
  },
  {
    key: 'curation.completenessScannerEnabled',
    value: true,
    category: 'knowledge',
    section: 'curation',
    severity: 'high',
    description:
      'Рубильник сканера полноты карточек знаний. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'tracker.goalAlignmentLowEnabled',
    value: true,
    category: 'tracker',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник детектора слабой связи задач с целями. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'conversational.telegramDigestHourLocal',
    value: 9,
    category: 'conversational',
    section: 'telegram',
    severity: 'medium',
    description:
      'Локальный час доставки Telegram-дайджеста (0–23). По умолчанию 9.',
  },
  {
    key: 'recording.trackWatchdogEnabled',
    value: true,
    category: 'recording',
    section: 'workers',
    severity: 'medium',
    description:
      'Рубильник watchdog застрявших аудио-дорожек: если egress-вебхук дорожки не долетел, запись зависает (allReady навсегда false → транскрипция не стартует). Watchdog деградирует застрявшую дорожку и переинициирует финализацию. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'recording.trackWatchdogTimeoutMinutes',
    value: 20,
    category: 'recording',
    section: 'workers',
    severity: 'low',
    description:
      'Сколько минут после окончания встречи ждать egress-вебхук аудио-дорожки, прежде чем считать её застрявшей и деградировать (исключить из готовности, чтобы транскрипция стартовала по готовым дорожкам). По умолчанию 20.',
  },
  {
    key: 'knowledge.rawEventRecoveryEnabled',
    value: true,
    category: 'knowledge',
    section: 'workers',
    severity: 'high',
    description:
      'Рубильник восстановления застрявших RawEvent: block-ingest не довёл событие из-за затяжного сбоя LLM (BullMQ-ретраи исчерпаны), RawEvent навсегда в processingStatus=received. Cron каждые 15 мин реэнкьюит застрявшие в block-ingest. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'knowledge.rawEventRecoveryStaleMinutes',
    value: 30,
    category: 'knowledge',
    section: 'workers',
    severity: 'low',
    description:
      'Сколько минут RawEvent должен пробыть в processingStatus=received, прежде чем считать его застрявшим и реэнкьюить в block-ingest. Меньше — реже ждём недообработанное событие, но риск гонки с активным ingest. По умолчанию 30.',
  },
  {
    key: 'knowledge.rawEventRecoveryMaxAgeHours',
    value: 24,
    category: 'knowledge',
    section: 'workers',
    severity: 'low',
    description:
      'RawEvent старше этого возраста и всё ещё в processingStatus=received не реэнкьюится (анти-бесконечность), а попадает в dead-letter алерт для оператора. По умолчанию 24 ч.',
  },
  {
    key: 'knowledge.rawEventRecoveryBatchLimit',
    value: 200,
    category: 'knowledge',
    section: 'workers',
    severity: 'low',
    description:
      'Сколько застрявших RawEvent обрабатывать за один проход cron-а восстановления. По умолчанию 200.',
  },
  {
    key: 'knowledge.specialistsCombinedRepairTimeoutMs',
    value: 60_000,
    category: 'knowledge',
    section: 'workers',
    severity: 'low',
    description:
      'Таймаут (мс) repair-retry вызова LLM в specialists-combined, когда первый ответ не распарсился. Очередь concurrency=1, поэтому таймаут ограничивает блокировку. По умолчанию 60000.',
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
  console.log('=== seed-admin-setting-worker-knobs START ===');

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
  console.log('=== seed-admin-setting-worker-knobs DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-worker-knobs FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
