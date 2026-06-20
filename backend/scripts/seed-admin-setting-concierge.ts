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
    key: 'concierge.history_pairs',
    value: 4,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description:
      'Глубина истории диалога помощника (пар сообщений; 1 пара = реплика пользователя + ответ помощника). По умолчанию 4 пары (8 сообщений).',
  },
  {
    key: 'concierge.clarify_min_confidence',
    value: 80,
    category: 'ai',
    section: 'concierge',
    severity: 'medium',
    description:
      'Порог самооценки понимания (0–100): ниже — помощник переспрашивает. Лучше переспросить, чем ошибиться. По умолчанию 80.',
  },
  {
    key: 'concierge.enabled',
    value: true,
    category: 'ai',
    section: 'concierge',
    severity: 'high',
    description:
      'Рубильник помощника-консьержа: при выкл помощник недоступен. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'concierge.dialogLayerEnabled',
    value: true,
    category: 'ai',
    section: 'concierge',
    severity: 'medium',
    description:
      'Слой понимания/синтеза запроса помощника (dialog-layer). По умолчанию вкл.',
  },
  {
    key: 'concierge.nativeToolsEnabled',
    value: true,
    category: 'ai',
    section: 'concierge',
    severity: 'medium',
    description:
      'Native function-calling в помощнике (инструменты уходят провайдеру вместо regex-эмуляции в тексте). По умолчанию вкл.',
  },
  {
    key: 'concierge.prmShadowEnabled',
    value: false,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description:
      'Теневой режим PRM-реранкера помощника (считает, но не влияет на ответ). По умолчанию выкл.',
  },
  {
    key: 'concierge.prmEnabled',
    value: false,
    category: 'ai',
    section: 'concierge',
    severity: 'medium',
    description:
      'Боевой PRM-реранкер кандидатов помощника. По умолчанию выкл.',
  },
  {
    key: 'concierge.prmTopK',
    value: 3,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description: 'Сколько верхних кандидатов берёт PRM-реранкер помощника. По умолчанию 3.',
  },
  {
    key: 'concierge.prmShadowSampleRate',
    value: 1.0,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description:
      'Доля запросов (0–1), на которых считается теневой PRM помощника. По умолчанию 1.0.',
  },
  {
    key: 'concierge.dailyMessagesLimit',
    value: 100,
    category: 'ai',
    section: 'concierge',
    severity: 'medium',
    description: 'Дневной лимит сообщений помощнику на пользователя. По умолчанию 100.',
  },
  {
    key: 'concierge.monthlyMessagesLimit',
    value: 3000,
    category: 'ai',
    section: 'concierge',
    severity: 'medium',
    description: 'Месячный лимит сообщений помощнику на пользователя. По умолчанию 3000.',
  },
  {
    key: 'concierge.sseHeartbeatSeconds',
    value: 15,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description: 'Интервал heartbeat SSE-потока помощника (сек). По умолчанию 15.',
  },
  {
    key: 'concierge.preRetrievalTopK',
    value: 12,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description: 'Сколько блоков подтягивается в pre-retrieval помощника. По умолчанию 12.',
  },
  {
    key: 'concierge.preRetrievalTimeoutMs',
    value: 3000,
    category: 'ai',
    section: 'concierge',
    severity: 'low',
    description: 'Таймаут pre-retrieval помощника (мс). По умолчанию 3000.',
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
  console.log('=== seed-admin-setting-concierge START ===');

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
  console.log('=== seed-admin-setting-concierge DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-concierge FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
