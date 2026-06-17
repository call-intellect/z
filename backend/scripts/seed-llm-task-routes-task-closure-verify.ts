/**
 * TZ task-dedup (2026-06-16, Ф2) — Seed маршрута LLM для `task-closure-verify`
 * (верификатор «правда ли задача выполнена» по сигналу из разговора).
 *
 *   - task-closure-verify — петля Э2: реплика «сделал X» из разговора + текст
 *     открытой задачи-кандидата → { done, confidence, rationale,
 *     positiveSignals, negativeSignals }. Только обратимый КАНДИДАТ на закрытие —
 *     авто-закрытие запрещено (R13). Дешёвый верификатор, JSON Schema strict.
 *     Маршрут должен существовать, иначе вызов поедет по аварийному
 *     DEFAULT_FALLBACK_CHAIN.
 *
 * Цепочка (НЕ anthropic — memory `project_z_infra_and_ai`):
 *   task-closure-verify: deepseek/deepseek-v4-flash → openai-via-proxy/gpt-5.4-mini → ollama/qwen3.5:9b
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-task-closure-verify.ts
 *   bun run scripts/seed-llm-task-routes-task-closure-verify.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с `editedByAdmin=true` НЕ перезаписываются.
 *   - Без флага — пропускаем существующие записи (insert only).
 *   - С `--update-existing` — обновляем model/priority/isActive (НЕ editedByAdmin).
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
  chain: TierEntry[];
}

const CHEAP_CHAIN: TierEntry[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
];

const SEEDS: TaskRouteSeed[] = [
  {
    taskType: 'task-closure-verify',
    chain: CHEAP_CHAIN,
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

      console.log(
        `[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
      );
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;

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

    console.log(
      `[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
    );
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');

  console.log(
    `=== seed-llm-task-routes-task-closure-verify START (updateExisting=${updateExisting}) ===`,
  );

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

  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_admin=${stats.protectedByAudit}`,
  );

  console.log('=== seed-llm-task-routes-task-closure-verify DONE ===');
}

main()
  .catch((err) => {
    console.error('seed-llm-task-routes-task-closure-verify FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
