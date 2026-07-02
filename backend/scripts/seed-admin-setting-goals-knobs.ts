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
    key: 'goals.krTrendWindowDays',
    value: 14,
    category: 'goals',
    section: 'kr',
    severity: 'low',
    description:
      'Окно тренда KR в днях для пересчёта статуса прогресса цели (baseline-чекпоинт). По умолчанию 14.',
  },
  {
    key: 'goals.krAtRiskMargin',
    value: 25,
    category: 'goals',
    section: 'kr',
    severity: 'low',
    description:
      'Допустимое отставание avgProgress от ожидаемого темпа (в п.п.), ниже которого цель помечается at_risk. По умолчанию 25.',
  },
  {
    key: 'goals.issueSnapshotCacheTtlSec',
    value: 26 * 60 * 60,
    category: 'goals',
    section: 'snapshot',
    severity: 'low',
    description:
      'TTL кэша снапшота прогресса цели по задачам (сек). По умолчанию 93600 (26 ч).',
  },
  {
    key: 'goals.recentActivityWindowDays',
    value: 7,
    category: 'goals',
    section: 'snapshot',
    severity: 'low',
    description:
      'Окно «свежей активности» по задачам цели в днях для recency-части alignment-score. По умолчанию 7.',
  },
  {
    key: 'goals.misalignmentWindowDays',
    value: 30,
    category: 'goals',
    section: 'alignment',
    severity: 'low',
    description:
      'Окно (дней) для поиска пользователей с задачами без цели. По умолчанию 30.',
  },
  {
    key: 'goals.misalignmentMinIssues',
    value: 5,
    category: 'goals',
    section: 'alignment',
    severity: 'low',
    description:
      'Мин. число задач пользователя за окно, чтобы учитывать его в misalignment-анализе. По умолчанию 5.',
  },
  {
    key: 'goals.misalignmentRatioThreshold',
    value: 0.8,
    category: 'goals',
    section: 'alignment',
    severity: 'low',
    description:
      'Доля задач без цели, при которой пользователь считается misaligned. Диапазон 0..1, по умолчанию 0.8.',
  },
  {
    key: 'goals.knnTopK',
    value: 5,
    category: 'goals',
    section: 'knn',
    severity: 'low',
    description:
      'Top-K KNN-кандидатов целей для дедупа/иерархии (специалист 3-14). По умолчанию 5.',
  },
  {
    key: 'goals.alignmentMaxBlocks',
    value: 200,
    category: 'goals',
    section: 'alignment',
    severity: 'low',
    description:
      'Макс. число блоков, подаваемых в LLM strategic-alignment воркера. По умолчанию 200.',
  },
  {
    key: 'goals.alignmentAlertDelta',
    value: -15,
    category: 'goals',
    section: 'alignment',
    severity: 'low',
    description:
      'Порог падения alignment-score (delta), ниже которого взводится алерт. По умолчанию -15.',
  },
  {
    key: 'goals.alignmentAlertScore',
    value: 60,
    category: 'goals',
    section: 'alignment',
    severity: 'low',
    description:
      'Порог абсолютного alignment-score, ниже которого взводится алерт (совместно с delta). По умолчанию 60.',
  },
  {
    key: 'goals.vectorMaxOrgsPerRun',
    value: 5000,
    category: 'goals',
    section: 'vector',
    severity: 'low',
    description:
      'Макс. число Org за один проход goal-vector-tracker cron. По умолчанию 5000.',
  },
  {
    key: 'goals.vectorMaxArtefactsPerGoal',
    value: 100,
    category: 'goals',
    section: 'vector',
    severity: 'low',
    description:
      'Макс. число артефактов (идей/задач) на цель в goal-vector-tracker. По умолчанию 100.',
  },
  {
    key: 'goals.linkerPerOrgLimit',
    value: 50,
    category: 'goals',
    section: 'linker',
    severity: 'low',
    description:
      'Макс. целей на Org за проход cron-линкеров goal↔theme и goal↔task. По умолчанию 50.',
  },
  {
    key: 'goals.taskLinkerLookbackDays',
    value: 7,
    category: 'goals',
    section: 'linker',
    severity: 'low',
    description:
      'Окно (дней) выборки свежих AI-целей для догоночной привязки задач. По умолчанию 7.',
  },
  {
    key: 'goals.themeAutolinkKnnMaxDistance',
    value: 0.45,
    category: 'goals',
    section: 'autolink',
    severity: 'low',
    description:
      'Макс. косинусная дистанция KNN при детерминированной привязке цели к темам. Диапазон 0..1, по умолчанию 0.45.',
  },
  {
    key: 'goals.themeAutolinkKnnTopK',
    value: 5,
    category: 'goals',
    section: 'autolink',
    severity: 'low',
    description:
      'Top-K тем-кандидатов KNN при детерминированной привязке цели к темам. По умолчанию 5.',
  },
  {
    key: 'tracker.goalAlignmentLowPeriodDays',
    value: 14,
    category: 'tracker',
    section: 'alignment_low',
    severity: 'low',
    description:
      'Окно (дней) для подсчёта задач без цели в probe goal_alignment_low. По умолчанию 14.',
  },
  {
    key: 'tracker.goalAlignmentLowMinIssues',
    value: 5,
    category: 'tracker',
    section: 'alignment_low',
    severity: 'low',
    description:
      'Мин. число завершённых задач пользователя за окно, чтобы рассматривать его в goal_alignment_low. По умолчанию 5.',
  },
  {
    key: 'tracker.goalAlignmentLowLowRatio',
    value: 0.8,
    category: 'tracker',
    section: 'alignment_low',
    severity: 'low',
    description:
      'Доля задач без цели, при которой эмитится probe goal_alignment_low. Диапазон 0..1, по умолчанию 0.8.',
  },
  {
    key: 'tracker.goalAlignmentLowDedupTtlSec',
    value: 86400,
    category: 'tracker',
    section: 'alignment_low',
    severity: 'low',
    description:
      'TTL дедуп-ключа Redis (сек), чтобы не слать повторный probe goal_alignment_low в одни сутки. По умолчанию 86400.',
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
  console.log('=== seed-admin-setting-goals-knobs START ===');

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

  console.log('=== seed-admin-setting-goals-knobs DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-goals-knobs FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
