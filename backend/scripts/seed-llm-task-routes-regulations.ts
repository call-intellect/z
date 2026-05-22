/**
 * SBA α-7 — Seed маршрутов LLM для 3 новых taskType'ов Specialist 3.1
 * (Regulations / Processes / Policies):
 *   - regulation-extract  — извлечение черновика Regulation/Process/Policy
 *     из блока. Сложная задача (понимание контекста + JSON Schema strict).
 *   - regulation-dedupe   — арбитр merge/new/extension/contradicts. Дешевле
 *     extract, но точнее (требует уверенности).
 *   - process-steps-extract — структурированное извлечение шагов процесса.
 *     Похоже по сложности на extract.
 *
 * Все три фильтруются по `maxDataClass >= confidential` (на стороне роутера
 * через provider capability — regulation может содержать чувствительные
 * внутренние правила, public-only провайдеры не должны её видеть).
 *
 * Источник цепочек: `docs/reference/llm-models-playbook.md` §2.1 + verified-
 * карта `second-brain/01_projects/llm-providers-verified.md` (smoke 2026-05-21).
 *
 * Дефолтная тройная цепочка (соответствует Phase 0b пайплайну block-distill):
 *   primary   — deepseek-v4-flash         (быстрый, дешёвый, JSON Schema strict)
 *   secondary — openai-via-proxy gpt-5.4-mini (резерв при недоступности DeepSeek)
 *   tertiary  — ollama qwen3:30b           (локальный fallback, internal-only)
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-regulations.ts
 *   bun run scripts/seed-llm-task-routes-regulations.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с `editedByAdmin=true` НЕ перезаписываются (даже с
 *     `--update-existing`).
 *   - Без флага — пропускаем все существующие записи (insert only).
 *   - С `--update-existing` — обновляем model/priority/isActive (но НЕ
 *     editedByAdmin).
 */

import { PrismaClient, type LlmRouteTier } from '@prisma/client';

const prisma = new PrismaClient();

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
    taskType: 'regulation-extract',
    playbookSection: '§2.1 block-distill (similar complexity) + α-7 sub-TZ §11',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'regulation-dedupe',
    playbookSection: '§11 classifier (low-volume arbiter) + α-7 sub-TZ §11',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
    ],
  },
  {
    taskType: 'process-steps-extract',
    playbookSection: '§2.1 block-distill (structured extraction) + α-7 sub-TZ §11',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
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
      console.log(`[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`);
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skip:edited-by-admin] ${seed.taskType}/${entry.tier}/${entry.providerName}`);
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
    console.log(`[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`);
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-regulations START (updateExisting=${updateExisting}) ===`);
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
  console.log('=== seed-llm-task-routes-regulations DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-regulations FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { SEEDS };
