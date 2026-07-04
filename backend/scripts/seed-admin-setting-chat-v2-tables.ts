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
    key: 'chat_v2.table_context_enabled',
    value: true,
    category: 'ai',
    section: 'chat_v2',
    severity: 'medium',
    description:
      'Рубильник (kill-switch) табличной ветки AI-чата: false — таблицы вообще не подмешиваются в ответ (граф отвечает как раньше). По умолчанию true.',
  },
  {
    key: 'chat_v2.table_context_max_rows',
    value: 8,
    category: 'ai',
    section: 'chat_v2',
    severity: 'low',
    description:
      'Сколько строк умных таблиц максимум подмешивается в контекст AI-чата (параллельная ветка таблиц). По умолчанию 8 (минимально достаточно — лишние строки вредят ответу). На счётный вопрос («сколько…») cap поднимается ×2 в коде.',
  },
  {
    key: 'chat_v2.table_context_max_tables',
    value: 2,
    category: 'ai',
    section: 'chat_v2',
    severity: 'low',
    description:
      'Сколько релевантных умных таблиц максимум выбирает topic-ветка chat_v2 (скоринг по name+description, без generic-имён колонок). По умолчанию 2.',
  },
  {
    key: 'chat_v2.table_context_max_rows_per_entity_table',
    value: 3,
    category: 'ai',
    section: 'chat_v2',
    severity: 'low',
    description:
      'Сколько строк максимум из одной пары (сущность, таблица) идёт в контекст entity-bridge. По умолчанию 3 — чтобы один клиент в 10 рисках не заспамил ответ.',
  },
  {
    key: 'chat_v2.table_structural_query_classes',
    value: ['list', 'overview', 'temporal'],
    category: 'ai',
    section: 'chat_v2',
    severity: 'medium',
    description:
      'Классы вопроса, при которых разрешена topic-ветка таблиц (fail-closed gating). Для остальных классов (fact/prose) таблицы подаются только точным entity-bridge. По умолчанию list/overview/temporal.',
  },
  {
    key: 'chat_v2.table_generic_stopwords',
    value: [
      'что',
      'кто',
      'где',
      'как',
      'какой',
      'какая',
      'какие',
      'какое',
      'сколько',
      'когда',
      'почему',
      'зачем',
      'чей',
      'срок',
      'сроки',
      'статус',
      'описание',
      'дата',
      'даты',
      'владелец',
      'ответственный',
      'тип',
      'имя',
      'название',
      'формулировка',
      'источник',
      'приоритет',
      'значение',
      'комментарий',
      'компания',
      'компании',
      'вопрос',
      'вопросы',
      'данные',
      'информация',
      'задача',
      'задачи',
    ],
    category: 'ai',
    section: 'chat_v2',
    severity: 'low',
    description:
      'Стоп-слова (вопросительные слова, generic-имена колонок, филлер), исключаемые из скоринга выбора таблицы — чтобы generic-колонка «Что» не перехватывала вопрос «Что горит?».',
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
  console.log('=== seed-admin-setting-chat-v2-tables START ===');

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
  console.log('=== seed-admin-setting-chat-v2-tables DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-chat-v2-tables FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
