/**
 * Seed LLM-task-route для Фазы D (sub-TZ §6.4) — taskType `transcript-clean-refine`.
 *
 * Источник цепочки моделей: docs/reference/llm-models-playbook.md §11 «Fallback chain»,
 * категория `classifier` (короткий батч-классификатор фрагментов сегментов).
 *
 * Цепочка трёх уровней:
 *   primary    = openai-via-proxy / gpt-5.4-nano   — дёшево, быстро, JSON-стабильно (playbook §2 «Классификаторы»).
 *   secondary  = deepseek / deepseek-v4-flash      — резерв при отказе OpenAI proxy (playbook §2 общий поток).
 *   tertiary   = ollama / qwen3.5:9b               — local fallback; для filler/false-start
 *                                                    qwen3.5 справляется. Если не вытягивает —
 *                                                    воркер корректно работает на одном уровне 1
 *                                                    (детерминистский), llmRefineSkipped=true в stats.
 *
 * Особенность фазы D vs B/C: при ПОЛНОМ отказе LLM воркер успешно завершает работу
 * через уровень 1 — это закладывается в `TranscriptCleanLlmRefineService` (никаких
 * throw из refine, при ошибке возвращается уровень 1 без изменений).
 *
 * Идемпотентность (safe-seed-rules): upsert по (taskType, tenantId=null). Без
 * `--update-existing` НИЧЕГО не меняем у уже-существующих route'ов — это защищает
 * от перезаписи цепочки, которую super_admin уже подредактировал через UI.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-phase-D.ts
 *   bun run scripts/seed-llm-task-routes-phase-D.ts --update-existing
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProviderEntry {
  provider: string;
  model: string;
  tier: 'primary' | 'secondary' | 'tertiary';
}

const TRANSCRIPT_CLEAN_REFINE_PROVIDERS: ProviderEntry[] = [
  { provider: 'openai-via-proxy', model: 'gpt-5.4-nano', tier: 'primary' },
  { provider: 'deepseek', model: 'deepseek-v4-flash', tier: 'secondary' },
  { provider: 'ollama', model: 'qwen3.5:9b', tier: 'tertiary' },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-phase-D START (updateExisting=${updateExisting}) ===`,
  );

  const taskType = 'transcript-clean-refine';
  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType, tenantId: null },
  });

  if (!existing) {
    await prisma.llmTaskRoute.create({
      data: {
        taskType,
        tenantId: null,
        providers: TRANSCRIPT_CLEAN_REFINE_PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[created] ${taskType}`);
  } else if (updateExisting) {
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: TRANSCRIPT_CLEAN_REFINE_PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[updated] ${taskType}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[skipped] ${taskType} (admin-edited; pass --update-existing to override)`);
  }

  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-phase-D DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-phase-D FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
