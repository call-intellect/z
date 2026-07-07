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
  { key: 'knowledge.chatV2AssertiveSynthesis', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник ассертивного синтеза «Мастера»: отвечать уверенно и называть найденное при любом основании в контексте, молчать только на реально пустом. Дефолт true (Ship-On). Выкл → прежний осторожный текст правила 4 («Честно про пустоту»). (recall-to-99 Ф1)' },
  { key: 'knowledge.chatV2GroundednessMode', value: 'lenient', category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Режим гейта заземления chat-v2: off|shadow|lenient|on. Дефолт lenient — абстин только при реальной выдумке (fabricated), не при неполноте. on = строгий откат. (recall-to-99 Ф1)' },
  { key: 'knowledge.chatV2GroundingEmbedding', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник эмбеддинг-grounding резолва сущностей понималщика (KNN по Entity.embedding поверх лексики). Дефолт true (Ship-On). Выкл → только лексический резолв. (recall-to-99 Ф2)' },
  { key: 'knowledge.chatV2GroundingEmbeddingTopK', value: 10, category: 'ai', section: 'knowledge', severity: 'medium',
    description: 'Максимум кандидатов эмбеддинг-KNN резолва сущностей понималщика. Дефолт 10. Гейтится kill-switch knowledge.chatV2GroundingEmbedding. (recall-to-99 Ф2)' },
  { key: 'knowledge.chatV2GroundingEmbeddingMinSim', value: 0.35, category: 'ai', section: 'knowledge', severity: 'medium',
    description: 'Минимальная косинус-близость (0–1) для приёма кандидата эмбеддинг-KNN резолва сущностей понималщика. Дефолт 0.35. Гейтится kill-switch knowledge.chatV2GroundingEmbedding. (recall-to-99 Ф2)' },
  { key: 'knowledge.chatV2DeterministicPeriod', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник детерминированного override периода понималщика (регэкспы «за неделю/вчера/за N дней» поверх LLM). Дефолт true (Ship-On). Выкл → период только от LLM. (recall-to-99 Ф3)' },
  { key: 'knowledge.chatV2GraphCypherRecall', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник deep-hop обхода графа AGE (Cypher по z_graph) в recall «Мастера» на многошаговых вопросах. Дефолт true (Ship-On), fail-open к реляционному обходу. Выкл → только реляционный обход. (recall-to-99 Ф5)' },
  { key: 'knowledge.chatV2GraphCypherMaxDepth', value: 3, category: 'ai', section: 'knowledge', severity: 'medium',
    description: 'Максимальная глубина Cypher-обхода графа AGE в recall «Мастера». Дефолт 3. Гейтится kill-switch knowledge.chatV2GraphCypherRecall. (recall-to-99 Ф5)' },
  { key: 'knowledge.graphReconcileEnabled', value: true, category: 'ai', section: 'knowledge', severity: 'high',
    description: 'Аварийный рубильник фоновой реконсиляции граф↔реляционка (идемпотентный MERGE вершин/рёбер в z_graph, DETACH DELETE архивных). Дефолт true (Ship-On). Выкл → реконсиляция не запускается, граф может дрейфовать. (recall-to-99 Ф4)' },
  { key: 'knowledge.graphReconcileBatchSize', value: 500, category: 'ai', section: 'knowledge', severity: 'medium',
    description: 'Размер батча инкрементальной реконсиляции граф↔реляционка. Дефолт 500. Гейтится kill-switch knowledge.graphReconcileEnabled. (recall-to-99 Ф4)' },
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

async function run(): Promise<void> {
  console.log('=== seed-admin-setting-recall-to-99 START ===');

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
  console.log('=== seed-admin-setting-recall-to-99 DONE ===');
}

if (require.main === module) {
  run()
    .catch((err) => {
      console.error('seed-admin-setting-recall-to-99 FAILED:', err);
      process.exit(1);
    })
    .finally(async () => {
      void prisma.$disconnect();
    });
}

export { run, SEEDS };
