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
    key: 'knowledge.segment_max_tokens',
    value: 600,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Размер под-чанка нарезки транскрипта перед извлечением блоков (в токенах, 200–2000). Эффективный размер сегмента; верхняя граница остаётся blockIngestMaxTokensPerSegment. По умолчанию 600.',
  },
  {
    key: 'knowledge.segment_overlap_ratio',
    value: 0.2,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Доля перекрытия (0–1) между соседними под-чанками: хвост предыдущего сегмента повторяется в начале следующего, чтобы не терять контекст на границе. По умолчанию 0.2.',
  },
  {
    key: 'knowledge.contextual_header_enabled',
    value: true,
    category: 'ai',
    section: 'knowledge',
    severity: 'high',
    description:
      'Рубильник LLM-обогащения контекст-заголовка перед эмбеддингом блока (Contextual Retrieval): к блоку добавляется одно предложение про встречу. При выкл — только детерминированная метастрока. По умолчанию вкл (Ship-On).',
  },
  {
    key: 'knowledge.entity_name_resolve_threshold',
    value: 0.9,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Порог cosine-сходства (0–1) для эмбеддинг-склейки упомянутого имени с реальным сотрудником при резолве «кто это» (например «Настя» → аккаунт). Кандидат принимается только при единственном совпадении ≥ порога; при двух и более — неоднозначность, склейка не выполняется (fail-closed). По умолчанию 0.9.',
  },
  {
    key: 'knowledge.edge_confidence_high',
    value: 0.85,
    category: 'ai',
    section: 'knowledge',
    severity: 'high',
    description:
      'Высокий порог уверенности (0–1) для рискованных связей графа (противоречие/замещение/причинность): такие связи прячут или меняют версии фактов. Создаются только при уверенности ≥ порога И подтверждении судьёй-скептиком. По умолчанию 0.85.',
  },
  {
    key: 'knowledge.edge_confidence_low',
    value: 0.6,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Базовый порог уверенности (0–1) для обычных смысловых связей графа (развивает/следствие/отвечает/закрывает). По умолчанию 0.6.',
  },
  {
    key: 'knowledge.linker_min_canonical',
    value: 2,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Минимум канонических блоков в Org, при котором смысловой линкер начинает строить связи (убирает гейт-лаг при малом графе). По умолчанию 2.',
  },
  {
    key: 'knowledge.linker_candidate_topk',
    value: 12,
    category: 'ai',
    section: 'knowledge',
    severity: 'low',
    description:
      'Сколько ближайших по вектору блоков-кандидатов рассматривает смысловой линкер для одного нового блока. По умолчанию 12.',
  },
  {
    key: 'knowledge.structural_shares_entity_topk',
    value: 10,
    category: 'ai',
    section: 'knowledge',
    severity: 'low',
    description:
      'Максимум структурных рёбер shares_entity (общая сущность), которые детерминированно создаются для одного блока при ingest (без LLM). По умолчанию 10.',
  },
  {
    key: 'knowledge.theme_summary_enabled',
    value: true,
    category: 'ai',
    section: 'knowledge',
    severity: 'high',
    description:
      'Рубильник воркера theme-summarize (инкрементальная суть темы/кластера). ON по умолчанию (Ship-On).',
  },
  {
    key: 'knowledge.search_expand_hops',
    value: 1,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Глубина обхода связей графа в основном поиске (число «прыжков» по рёбрам от найденных блоков). 0 — обход выключен, 1 — соседи на один шаг. По умолчанию 1.',
  },
  {
    key: 'knowledge.search_rrf_k',
    value: 60,
    category: 'ai',
    section: 'knowledge',
    severity: 'low',
    description:
      'Параметр k для слияния рангов RRF в поиске (стандартно 60): сглаживает вклад позиции при объединении гибридного списка и связей графа. По умолчанию 60.',
  },
  {
    key: 'knowledge.hnsw_ef_search',
    value: 100,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Параметр hnsw.ef_search для векторного поиска по HNSW-индексам (IdeaBlock/Entity/Theme): размер списка кандидатов при обходе графа. Выше — точнее recall, но медленнее. Применяется через SET LOCAL в рамках запроса (1–1000). По умолчанию 100.',
  },
  {
    key: 'knowledge.router_confidence_threshold',
    value: 0.6,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Порог уверенности роутера класса запроса (0–1, слой источника Ф3). Если уверенность в классе ниже порога ИЛИ класс ∈ {список, итог за период, обзор} — retrieval запускает структурный И семантический маршруты параллельно и сливает RRF (both-ways, никогда не пусто). Уверенный topic/fact — только семантика. По умолчанию 0.6.',
  },
  {
    key: 'knowledge.router_v2_enabled',
    value: true,
    category: 'ai',
    section: 'knowledge',
    severity: 'high',
    description:
      'Аварийный рубильник роутера 5 классов + confidence-gated both-ways (слой источника Ф3). ON по умолчанию (Ship-On). Выкл → откат на прежний single-route retrieval (семантический путь без структурной подстраховки и без гейта фан-аута по классу).',
  },
  {
    key: 'knowledge.overview_top_themes',
    value: 5,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Сколько верхних тем (по близости Theme.embedding к вопросу) брать для обзорного класса (К4, слой источника Ф6). Карта строится lazy на лету из Theme.summary выбранных тем; затем — погружение в блоки этих тем. Привязка к близости embedding, ветка темы лишь сужает. По умолчанию 5.',
  },
  {
    key: 'knowledge.list_episodes_limit',
    value: 30,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Сколько эпизодов-источников (SourceEpisode: встречи/документы/чаты по occurredAt DESC) брать для класса-списка (К1, слой источника Ф10). Ответ — перечисление источников со ссылками, а не абзац-синтез из блоков. По умолчанию 30.',
  },
  {
    key: 'knowledge.person_resolve_trgm_threshold',
    value: 0.3,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Минимальное триграммное сходство (0–1, pg_trgm) для нечёткого резолва имени человека/компании в К1-маршруте (список встреч/источников по человеку). Устойчивость к опечаткам и ошибкам транскрибации: «Алексан» → «Александр». Точное равенство строки в резолве не используется. По умолчанию 0.3.',
  },
  {
    key: 'knowledge.person_resolve_ambiguity_delta',
    value: 0.1,
    category: 'ai',
    section: 'knowledge',
    severity: 'medium',
    description:
      'Порог дельты уверенности (0–1) между двумя верхними кандидатами при резолве имени в К1. Если разрыв меньше порога И контекст-сущность не сузила выбор — помощник задаёт уточняющий вопрос вместо слепой подстановки. По умолчанию 0.1.',
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
  console.log('=== seed-admin-setting-knowledge-graph START ===');

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
  console.log('=== seed-admin-setting-knowledge-graph DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-admin-setting-knowledge-graph FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
