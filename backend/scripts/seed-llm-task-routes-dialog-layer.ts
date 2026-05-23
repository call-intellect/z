/**
 * Seed LlmTaskRoute для SBA α-5 dialog-layer.
 *
 * Источник: plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md §9.
 * Reference: docs/reference/llm-models-playbook.md §2.4 (utility chain).
 *
 * TaskType'ы (5 шт.):
 *   - dialog-contextualize — standalone-question recovery, частый, дешёвый.
 *   - dialog-confidence    — бинарная оценка confidence, очень дёшево.
 *   - dialog-classify      — intent detection (LLM fallback после эвристики).
 *   - dialog-multi-query   — 3 переформулировки exploratory/analytical-запросов.
 *   - dialog-summarize     — сжатие старой части диалога (>12 сообщений) в summary.
 *
 * Цепочки. ВАЖНО: используем актуальные модели согласно
 * second-brain/01_projects/llm-providers-verified.md (2026-05-21):
 *   - deepseek `deepseek-v4-flash` (primary cheap), `deepseek-v4-pro` (premium).
 *   - openai-via-proxy `gpt-5.4-mini` (secondary cheap).
 *   - ollama `qwen3.5:9b` (tertiary local).
 *
 *   - dialog-contextualize / dialog-confidence / dialog-classify
 *       primary    deepseek          deepseek-v4-flash    (cheap)
 *       secondary  openai-via-proxy  gpt-5.4-mini         (reserve)
 *       tertiary   ollama            qwen3.5:9b           (local fallback)
 *   - dialog-multi-query / dialog-summarize
 *       primary    deepseek          deepseek-v4-flash    (по-прежнему дёшево хватает)
 *       secondary  openai-via-proxy  gpt-5.4-mini         (резерв)
 *       tertiary   ollama            qwen3.5:9b           (fallback)
 *
 * Anthropic НЕ используем (нет ключа). См. project_z_infra_and_ai.
 *
 * requiredDataClass = 'internal' для всех 5 — диалог может содержать
 * internal-факты, sensitive/private — редкость на dialog-layer'е
 * (тяжёлые ответы синтезирует knowledge-core ChatV2, который сам
 * выставляет maxDataClass).
 *
 * Идемпотентность:
 *   - upsert по (taskType, tenantId=null, tier, providerName).
 *   - existing + editedByAdmin=true → skip;
 *   - existing + editedByAdmin=false → skip (обновление — через UI).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-dialog-layer.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TASK_TYPES = [
  'dialog-contextualize',
  'dialog-confidence',
  'dialog-classify',
  'dialog-multi-query',
  'dialog-summarize',
] as const;

interface RouteSeed {
  tier: 'primary' | 'secondary' | 'tertiary';
  provider: string;
  model: string;
  priority: number;
  maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
}

const ROUTES: RouteSeed[] = [
  {
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'secondary',
    provider: 'openai-via-proxy',
    model: 'gpt-5.4-mini',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'tertiary',
    provider: 'ollama',
    model: 'qwen3.5:9b',
    priority: 0,
    maxDataClass: 'private',
  },
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-dialog-layer START (taskTypes=${TASK_TYPES.join(',')}) ===`,
  );

  let inserted = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const taskType of TASK_TYPES) {
    for (const r of ROUTES) {
      const existing = await prisma.llmTaskRoute.findFirst({
        where: {
          taskType,
          tenantId: null,
          tier: r.tier,
          providerName: r.provider,
        },
      });
      if (existing) {
        if (existing.editedByAdmin) {
          skippedEdited++;
          // eslint-disable-next-line no-console
          console.log(
            `[skipped:edited] ${taskType} ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
          );
        } else {
          skipped++;
          // eslint-disable-next-line no-console
          console.log(
            `[skipped:exists] ${taskType} ${r.tier} ${r.provider}:${r.model}`,
          );
        }
        continue;
      }
      await prisma.llmTaskRoute.create({
        data: {
          taskType,
          tenantId: null,
          tier: r.tier,
          providerName: r.provider,
          model: r.model,
          priority: r.priority,
          isActive: true,
          editedByAdmin: false,
          requiredDataClass: r.maxDataClass,
        },
      });
      inserted++;
      // eslint-disable-next-line no-console
      console.log(`[created] ${taskType} ${r.tier} ${r.provider}:${r.model}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted: ${inserted}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-dialog-layer DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-dialog-layer FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
