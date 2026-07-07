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
  { key: 'knowledge.chatV2GraphAlwaysExpand', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник: обход по связям блоков (IdeaBlockLink) участвует в recall «Мастера» ДАЖЕ при активном структурном фильтре. ON по умолчанию (Ship-On). Выкл → прежнее поведение (граф глушится фильтром, теряется треть ответов).' },
  { key: 'knowledge.chatV2FilterMode', value: 'boost', category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Режим структурного фильтра recall «Мастера»: boost — совпадение блока с фильтром поднимает его score, ничего не выбрасывая (пул наполняется широко семантикой+графом); hard — прежний жёсткий AND-cutoff (риск пустого пула на точных вопросах). По умолчанию boost.' },
  { key: 'knowledge.chatV2FilterBoostWeight', value: 0.3, category: 'ai', section: 'knowledge', severity: 'medium',
    description: 'Вес прибавки к score (0–1) за совпадение блока со структурным фильтром в режиме boost. Больше — сильнее поднимает совпавшее, но не выбрасывает несовпавшее. По умолчанию 0.3.' },
  { key: 'knowledge.chatV2EntityLinkHops', value: 1, category: 'ai', section: 'knowledge', severity: 'medium',
    description: 'Глубина обхода связей вещь↔вещь (EntityLink) в recall «Мастера»: 0 — выкл, 1 — связанные сущности на один шаг подмешивают свои блоки (ярлык «429» дотягивается до блоков «Битрикс»). По умолчанию 1.' },
  { key: 'knowledge.chatV2CascadeEnabled', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник каскада расширения recall «Мастера» при бедном пуле (снять фильтр → углубить граф → честное «вот близкое»). ON по умолчанию (Ship-On).' },
  { key: 'knowledge.chatV2CascadeMinPool', value: 5, category: 'ai', section: 'knowledge', severity: 'medium',
    description: 'Порог размера пула recall, ниже которого включается каскад расширения «Мастера». По умолчанию 5.' },
  { key: 'knowledge.chatV2AggregationMode', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник режима сводки для широких вопросов и списков (overview/list): не отбрасывать перефразы, собирать полный охват по темам/сущностям, не отрицать существующее. ON по умолчанию (Ship-On).' },
  { key: 'knowledge.chatV2UnderstandGrounding', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник grounding понималщика справочником названий тенанта (Entity/Theme, нечёткое совпадение по словам вопроса) — «медиа-движок» → «LiveKit». ON по умолчанию (Ship-On).' },
  { key: 'knowledge.chatV2GroundingTopK', value: 15, category: 'ai', section: 'knowledge', severity: 'low',
    description: 'Максимум кандидатов-названий (Entity+Theme), подаваемых понималщику как справочник компании. По умолчанию 15.' },
  { key: 'knowledge.chatV2AdaptiveHops', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник адаптивной глубины обхода recall: многошаговый вопрос → 2 hop, простой → 1. ON по умолчанию (Ship-On).' },
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
  console.log('=== seed-admin-setting-chat-v2-recall START ===');

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
  console.log('=== seed-admin-setting-chat-v2-recall DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-chat-v2-recall FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
