/**
 * Seed дефолтных LlmTaskRoute (Фаза 0–2 knowledge-core, политика 2026-05).
 *
 * Создаёт глобальные (tenantId=NULL) маршруты:
 *   - legacy taskType (summary/chapters/tasks/chat/regenerate-section/
 *     custom-prompt/follow-up/clip-title/card-rollup/card-chat) — все
 *     переведены на deepseek primary с fallback на gpt-5.4-mini → ollama.
 *   - новые knowledge-core taskType (block-ingest, block-distill, …) —
 *     заранее задаём дефолты под будущие воркеры.
 *
 * Идемпотентность: upsert по (taskType, tenantId=null). Без --update-existing
 * ничего не меняем у уже-существующих записей. С флагом — обновляем providers.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-knowledge-core.ts
 *   bun run scripts/seed-llm-task-routes-knowledge-core.ts --update-existing
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model?: string;
}

interface RouteSeed {
  taskType: string;
  providers: ProviderEntry[];
  isActive: boolean;
}

const COMMON_LEGACY: ProviderEntry[] = [
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
  { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
];

const ROUTES: RouteSeed[] = [
  // Legacy taskType — продолжают работать до Фаз 5/6.
  { taskType: 'summary', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'chapters', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'tasks', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'chat', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'regenerate-section', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'custom-prompt', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'follow-up', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'clip-title', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'card-rollup', providers: COMMON_LEGACY, isActive: true },
  { taskType: 'card-chat', providers: COMMON_LEGACY, isActive: true },

  // Knowledge-core (Фаза 2+) — дефолты под будущие воркеры.
  //
  // SBA α-2 — block-ingest промпт расширен: добавлены signalType
  // reasoning / rationale / decision_basis / regulation / process_step
  // (см. backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts).
  // Цепочка provider'ов осталась прежней — все три держат JSON Schema strict
  // на новом enum'е (verified-карта: docs/reference/llm-models-playbook.md,
  // smoke-test 2026-05-21 — second-brain/01_projects/llm-providers-verified.md).
  // primary: deepseek-v4-flash — лучшее качество/цена на структурированном выводе.
  // secondary: gpt-5.4-mini — fallback при ошибке/timeout primary.
  // tertiary: ollama qwen3:30b — local fallback при недоступности всех внешних.
  {
    taskType: 'block-ingest',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
    ],
    isActive: true,
  },
  {
    taskType: 'block-distill',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
    ],
    isActive: true,
  },
  {
    taskType: 'block-linker',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
    ],
    isActive: true,
  },
  {
    taskType: 'entity-resolver',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
    ],
    isActive: true,
  },
  {
    taskType: 'entity-merge-arbiter',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'entity-graph-builder',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'theme-classify',
    providers: [
      { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
    ],
    isActive: true,
  },
  {
    taskType: 'reframing',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  // SBA α-6 — Specialist 3.4 (эталонный референс контракта §5 зонтичного).
  // Три уровня provider'ов согласно §5.11 контракта: primary (рабочий) +
  // secondary (внешний fallback) + tertiary (local, гарантия работы при
  // полном отказе внешних). Verified-карта моделей:
  // second-brain/01_projects/llm-providers-verified.md (smoke-test 2026-05-21).
  // primary: deepseek-v4-flash — лучшее качество/цена для card-rollup'а.
  // secondary: gpt-5.4-mini — fallback при ошибке/timeout primary.
  // tertiary: ollama qwen3:30b — local fallback при недоступности всех внешних.
  // Все три держат dataClass=internal (Card.summaryCache не отдаёт PII).
  {
    taskType: 'card-rollup-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
    ],
    isActive: true,
  },
  {
    taskType: 'task-extract-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'chapter-extract-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  {
    taskType: 'summary-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.5' },
      { provider: 'minimax', model: 'MiniMax-M2.7' },
    ],
    isActive: true,
  },
  {
    taskType: 'chat-v2',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4' },
    ],
    isActive: true,
  },
  {
    taskType: 'goal-alignment',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.5' },
    ],
    isActive: true,
  },
  {
    taskType: 'dashboard-summary',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-flash' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    ],
    isActive: true,
  },
  // ТЗ 2026-05-25 (meeting-report-split-from-block-ingest) — Фаза 4.6.
  // ОДИН LLM-вызов по СЫРОМУ транскрипту → chapters + tasks + summary +
  // quality_score через tool_use `submit_meeting_analysis`.
  // - primary: deepseek-v4-pro — большой output, thinking, доказано в
  //   эксперименте Variant Б (см. SUMMARY-ALL.md). Capable, держит strict
  //   tools+tool_choice='auto'.
  // - secondary: gpt-5.4-mini через OpenAI proxy — fallback, поддерживает
  //   tool_use, дешевле.
  // - tertiary: ollama qwen3.5:9b — locally-hosted fallback при недоступности
  //   внешних. Может не справиться с большим выходом (32k tokens), но
  //   гарантирует, что отчёт всё-таки сгенерится.
  {
    taskType: 'meeting-report-fast',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { provider: 'ollama', model: 'qwen3.5:9b' },
    ],
    isActive: true,
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-knowledge-core START (updateExisting=${updateExisting}) ===`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const route of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: { taskType: route.taskType, tenantId: null },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: route.taskType,
          tenantId: null,
          providers: route.providers as unknown as object,
          isActive: route.isActive,
        },
      });
      inserted++;
      // eslint-disable-next-line no-console
      console.log(`[created] ${route.taskType}`);
    } else if (updateExisting) {
      await prisma.llmTaskRoute.update({
        where: { id: existing.id },
        data: {
          providers: route.providers as unknown as object,
          isActive: route.isActive,
        },
      });
      updated++;
      // eslint-disable-next-line no-console
      console.log(`[updated] ${route.taskType}`);
    } else {
      skipped++;
      // eslint-disable-next-line no-console
      console.log(`[skipped] ${route.taskType}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-knowledge-core DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-knowledge-core FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
