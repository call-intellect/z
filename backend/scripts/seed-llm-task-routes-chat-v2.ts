/**
 * Seed LlmTaskRoute для SBA α-5 — Layer 5 Chat-v2 Omnichannel.
 *
 * Источник: plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md §12 + §13.13.
 * Reference: docs/reference/llm-models-playbook.md §2.1 (generalPurpose chain) и §2.4 (utility chain).
 *
 * TaskType'ы:
 *   - chat-v2-conversation-title — короткий title диалога (3-7 слов из первого
 *     user-сообщения). Дешёвая utility-задача — flash-tier'ом достаточно.
 *   - chat-v2-cite-select — пост-обработка для выбора лучших цитат. На α-5
 *     не используется в основном pipeline (SynthesisService обходится одним
 *     вызовом knowledge-core ChatV2Service), seed заведён про запас.
 *
 * Основной taskType `chat-v2` уже засеяен в seed-llm-task-routes-knowledge-core.ts
 * (provider'ы: deepseek/openai-via-proxy без ollama). Эту цепочку
 * мы НЕ переопределяем здесь — за обновление основной цепочки отвечает
 * `seed-llm-task-routes-knowledge-core.ts`. Если нужно — запустите
 * её с `--update-existing`.
 *
 * Цепочка из трёх tier'ов (для обоих новых taskType'ов):
 *   - primary    deepseek          deepseek-v4-flash     (дешёвый, быстрый)
 *   - secondary  openai-via-proxy  gpt-5.4-mini          (резерв)
 *   - tertiary   ollama            qwen3.5:9b            (local fallback)
 *
 * Цепочка filtered по `maxDataClass='private'` — chat должен работать с
 * любыми данными (включая sensitive/private). Через PROVIDER_CAPABILITY
 * в LlmRouterService отфильтруются: ollama пропустит private; deepseek/
 * openai-via-proxy ограничат `requiredDataClass='internal'` — для chat-title
 * это ОК, потому что title не содержит чувствительных деталей (короткий
 * заголовок). Для chat-v2-cite-select ставим тоже internal, потому что
 * цитаты — обычно internal-класса.
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - upsert по (taskType, tenantId=null, tier, providerName).
 *   - existing + editedByAdmin=true → skip;
 *   - existing + editedByAdmin=false → skip (обновление — через UI).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-chat-v2.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TASK_TYPES = [
  'chat-v2-conversation-title',
  'chat-v2-cite-select',
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
    `=== seed-llm-task-routes-chat-v2 START (taskTypes=${TASK_TYPES.join(',')}) ===`,
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
  console.log('=== seed-llm-task-routes-chat-v2 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-chat-v2 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
