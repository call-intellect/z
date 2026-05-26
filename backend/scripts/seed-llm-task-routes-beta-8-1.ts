/**
 * SBA β-8.1 — Seed маршрутов LLM для добивки панели операционного директора.
 *
 *   - checkin-sentiment — определение настроения чек-ина (green/yellow/red)
 *     по тексту вечернего ответа сотрудника. Дешёвый частый вызов; fallback
 *     event-driven worker (CheckinSentimentAnalyzerWorker) — мгновенная
 *     реакция на одиночный чек-ин.
 *   - checkin-sentiment-batch — batch-вариант (10 чек-инов = 1 вызов через
 *     tool `submit_batch_sentiments`). ТЗ 2026-05-25 LLM-architecture §6
 *     (эксперимент 4: точность 100% vs 96%, в 2× дешевле, на 20% быстрее).
 *     Primary `deepseek-v4-pro` (capable + thinking; max_tokens=8000 в коде).
 *     Используется основным механизмом — `CheckinSentimentBatchCron`.
 *   - operations-weekly-digest — связный текст недельного дайджеста
 *     (markdown, 5-7 коротких разделов). Один вызов в неделю на Org —
 *     не критично к скорости. ТЗ 2026-05-25 §6 — primary `deepseek-v4-pro`
 *     (цена $0.0016 на сводку).
 *
 * ТЗ 2026-05-25 LLM-architecture §6 — переключение моделей:
 *   - checkin-sentiment        primary deepseek-chat → deepseek-v4-pro
 *   - checkin-sentiment-batch  новый maршрут        primary deepseek-v4-pro
 *   - operations-weekly-digest primary deepseek-chat → deepseek-v4-pro
 *   - secondary openai-via-proxy gpt-4o-mini → gpt-5.4-mini (актуальная).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-beta-8-1.ts
 *   bun run scripts/seed-llm-task-routes-beta-8-1.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - editedByAdmin=true → НЕ перезаписываем.
 *   - Без --update-existing — пропускаем существующие записи.
 *   - С --update-existing — обновляем model/priority/isActive.
 */

import { PrismaClient, type LlmRouteTier } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
}

interface TaskRouteSeed {
  taskType: string;
  playbookSection: string;
  chain: TierEntry[];
}

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'checkin-sentiment',
    playbookSection:
      'ТЗ 2026-05-25 LLM-architecture §6 — fallback single-вариант (event-driven). Основной механизм — checkin-sentiment-batch. Primary deepseek-v4-pro (миграция с deepseek-chat для совместимости с thinking, maxTokens worker поднят до 1500).',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'checkin-sentiment-batch',
    playbookSection:
      'ТЗ 2026-05-25 LLM-architecture §6 (эксперимент 4) — основной механизм sentiment-классификации. 10 чек-инов = 1 вызов через tool `submit_batch_sentiments`. Точность 100% vs 96% single, в 2× дешевле. max_tokens=8000 в коде.',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
  {
    taskType: 'operations-weekly-digest',
    playbookSection:
      'ТЗ 2026-05-25 LLM-architecture §6 — primary deepseek-v4-pro (миграция с deepseek-chat). Цена $0.0016 на сводку. Архитектура «код агрегирует → LLM пишет» НЕ меняется — Variant Б галлюцинировал даты в эксперименте 4. 1 вызов/неделя/Org.',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
  },
];

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAudit: number;
}

async function applySeed(
  seed: TaskRouteSeed,
  updateExisting: boolean,
  stats: SeedStats,
): Promise<void> {
  for (let i = 0; i < seed.chain.length; i++) {
    const entry = seed.chain[i];
    if (!entry) continue;
    const priority = i;
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: seed.taskType,
        tenantId: null,
        tier: entry.tier,
        providerName: entry.providerName,
      },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: seed.taskType,
          tenantId: null,
          tier: entry.tier,
          providerName: entry.providerName,
          model: entry.model,
          priority,
          providers: null,
          isActive: true,
          editedByAdmin: false,
        },
      });
      stats.inserted++;
      // eslint-disable-next-line no-console
      console.log(
        `[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
      );
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(
        `[skip:edited-by-admin] ${seed.taskType}/${entry.tier}/${entry.providerName}`,
      );
      continue;
    }
    if (!updateExisting) {
      stats.skipped++;
      continue;
    }
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true
    ) {
      stats.skipped++;
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        model: entry.model,
        priority,
        isActive: true,
      },
    });
    stats.updated++;
    // eslint-disable-next-line no-console
    console.log(
      `[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
    );
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-beta-8-1 START (updateExisting=${updateExisting}) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(`TaskTypes: ${SEEDS.map((s) => s.taskType).join(', ')}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAudit: 0,
  };
  for (const seed of SEEDS) {
    await applySeed(seed, updateExisting, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_admin=${stats.protectedByAudit}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-beta-8-1 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-beta-8-1 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
