/**
 * Autonomy W1 (2026-06-12) — Seed маршрутов LLM для taskType'ов семейства
 * `conflict-arbiter` (ночной LLM-арбитр конфликтов знаний: ConflictItem(open)
 * → авто-резолв keep_old | accept_new | merge при уверенном консенсусе дебата;
 * evolving / escalate остаются open).
 *
 * 4 taskType:
 *   - debate-conflict-arbiter           — зонтичный (агрегатная аналитика/smoke).
 *   - debate-conflict-arbiter-critic    — stance "strict-critic".
 *   - debate-conflict-arbiter-supporter — stance "empathetic-supporter".
 *   - debate-conflict-arbiter-neutral   — stance "neutral-judge".
 *
 * Цепочка — дешёвая (cheap), как у `debate-curation-verify`:
 *   primary   = deepseek/deepseek-v4-flash
 *   secondary = openai-via-proxy/gpt-5.4-mini  (diverse провайдер)
 *   tertiary  = ollama/qwen3.5:9b              (safety-net)
 * Supporter — primary gpt-5.4-mini (diversity голосов). НИКАКОГО anthropic.
 *
 * Источник цепочек: docs/reference/llm-models-playbook.md §2.1 + verified-
 * карта second-brain/01_projects/llm-providers-verified.md + правило
 * feedback `Ollama qwen3.5:9b — только tertiary fallback`.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-conflict-arbiter.ts
 *   bun run scripts/seed-llm-task-routes-conflict-arbiter.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - editedByAdmin=true — не перезаписываем.
 *   - Без флага — пропускаем existing.
 *   - С `--update-existing` — обновляем model/priority/isActive (но НЕ editedByAdmin).
 */

import { type LlmRouteTier } from '@prisma/client';
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
  pinnedVersionNote?: string;
}

/** Общая cheap-цепочка для conflict-arbiter taskType (зонтичный/critic/neutral). */
const CHEAP_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
];

const PIN = 'Закреплено 2026-06-12 для Autonomy W1 (conflict-arbiter)';

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'debate-conflict-arbiter',
    playbookSection:
      '§2.1 короткий JSON-вердикт. Зонтичный route для агрегатной аналитики стоимости debate-сессии conflict-arbiter. Реальные вызовы — через 3 stance-taskType ниже. Cheap-цепочка.',
    chain: CHEAP_CHAIN,
    pinnedVersionNote: PIN,
  },
  {
    taskType: 'debate-conflict-arbiter-critic',
    playbookSection:
      'Conflict-Arbiter stance "strict-critic". Вердикт keep_old|accept_new|merge|evolving|escalate по payload\'ам двух конфликтующих карточек. Cheap: primary = deepseek-v4-flash.',
    chain: CHEAP_CHAIN,
    pinnedVersionNote: PIN,
  },
  {
    taskType: 'debate-conflict-arbiter-supporter',
    playbookSection:
      'Conflict-Arbiter stance "empathetic-supporter". Primary = openai-via-proxy/gpt-5.4-mini (diverse провайдер для diversity голосов).',
    chain: [
      { tier: 'primary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'secondary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
    ],
    pinnedVersionNote: PIN,
  },
  {
    taskType: 'debate-conflict-arbiter-neutral',
    playbookSection:
      'Conflict-Arbiter stance "neutral-judge". Cheap арбитр: primary = deepseek-v4-flash.',
    chain: CHEAP_CHAIN,
    pinnedVersionNote: PIN,
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
          pinnedVersionNote: seed.pinnedVersionNote ?? null,
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
    const seedPin = seed.pinnedVersionNote ?? null;
    if (
      existing.model === entry.model &&
      existing.priority === priority &&
      existing.isActive === true &&
      existing.pinnedVersionNote === seedPin
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
        pinnedVersionNote: seedPin,
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
    `=== seed-llm-task-routes-conflict-arbiter START (updateExisting=${updateExisting}) ===`,
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
  console.log('=== seed-llm-task-routes-conflict-arbiter DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-conflict-arbiter FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
