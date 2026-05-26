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
 *   ВСЕ 5 dialog-layer task'ов (2026-05-25, ТЗ §2 «chat-v2 — НЕ менять
 *   архитектуру»): переключены на deepseek-v4-pro. Эксперимент 2 показал,
 *   что архитектура из 5 шагов оптимальна; Pro даёт качество, Flash —
 *   деградирует на standalone-question / confidence для длинных диалогов.
 *
 *   - dialog-contextualize / dialog-confidence / dialog-classify /
 *     dialog-multi-query / dialog-summarize
 *       primary    deepseek          deepseek-v4-pro      (capable, thinking)
 *       secondary  openai-via-proxy  gpt-5.4-mini         (reserve)
 *       tertiary   ollama            qwen3.5:9b           (local fallback)
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
 *   - existing + editedByAdmin=true → skip ВСЕГДА;
 *   - existing + editedByAdmin=false → skip без флага; обновить с
 *     `--update-existing` (для миграции flash → pro 2026-05-25).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-dialog-layer.ts
 *   bun run scripts/seed-llm-task-routes-dialog-layer.ts --update-existing
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

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
    model: 'deepseek-v4-pro',
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
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-dialog-layer START (taskTypes=${TASK_TYPES.join(',')}, updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
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
          continue;
        }
        if (!updateExisting) {
          skipped++;
          // eslint-disable-next-line no-console
          console.log(
            `[skipped:exists] ${taskType} ${r.tier} ${r.provider}:${r.model}`,
          );
          continue;
        }
        if (
          existing.model === r.model &&
          existing.priority === r.priority &&
          existing.isActive === true &&
          existing.requiredDataClass === r.maxDataClass
        ) {
          skipped++;
          continue;
        }
        await prisma.llmTaskRoute.update({
          where: { id: existing.id },
          data: {
            model: r.model,
            priority: r.priority,
            isActive: true,
            requiredDataClass: r.maxDataClass,
          },
        });
        updated++;
        // eslint-disable-next-line no-console
        console.log(
          `[updated] ${taskType} ${r.tier} ${r.provider}:${r.model}`,
        );
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
    `inserted: ${inserted}, updated: ${updated}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
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
