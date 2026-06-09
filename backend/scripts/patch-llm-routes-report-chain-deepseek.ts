/**
 * Ф6 agent-chain-overhaul (2026-06-07) — вернуть цепочку отчёта на DeepSeek (кэш).
 *
 * Корень (доказано эмпирикой, plans/analysis/2026-06-07-llm-cache-chain-verification.md §4 К1):
 * на проде taskType `summary` / `report-by-type` / legacy `tasks` ушли на MiniMax
 * (`MiniMax-M2.5`) — кэш 0% (MiniMax требует ручной `cache_control:'ephemeral'`
 * и имеет более высокий порог), хотя план изначально «везде DeepSeek».
 * DeepSeek кэширует 81–99% БЕЗ ручного cache_control.
 *
 * Этот patch ПРИНУДИТЕЛЬНО (всегда update, не skip) выставляет глобальные
 * (tenantId=null) маршруты этих trёх taskType на DeepSeek с диверсными
 * fallback'ами. Идемпотентно: повторный прогон = тот же результат.
 *
 *   summary        → deepseek-v4-flash (дешёвая сводка)
 *   report-by-type → deepseek-v4-pro   (структурный отчёт, capable — как meeting-report-fast)
 *   tasks          → deepseek-v4-flash (legacy извлечение задач)
 *
 * НЕ трогает per-tenant маршруты (только tenantId=null глобальные).
 * НЕ трогает summary-v2 (он остаётся как есть — Ф5 консолидирует summary отдельно).
 *
 * Запуск (прод): docker compose exec backend bun run scripts/patch-llm-routes-report-chain-deepseek.ts
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model: string;
}

interface RoutePatch {
  taskType: string;
  providers: ProviderEntry[];
}

const FALLBACKS: ProviderEntry[] = [
  { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { provider: 'ollama', model: 'qwen3:30b-a3b-instruct-2507' },
];

const PATCHES: RoutePatch[] = [
  {
    taskType: 'summary',
    providers: [{ provider: 'deepseek', model: 'deepseek-v4-flash' }, ...FALLBACKS],
  },
  {
    taskType: 'report-by-type',
    providers: [{ provider: 'deepseek', model: 'deepseek-v4-pro' }, ...FALLBACKS],
  },
  {
    taskType: 'tasks',
    providers: [{ provider: 'deepseek', model: 'deepseek-v4-flash' }, ...FALLBACKS],
  },
];

async function main(): Promise<void> {
   
  console.log('=== patch-llm-routes-report-chain-deepseek START ===');
  let created = 0;
  let updated = 0;

  for (const patch of PATCHES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: { taskType: patch.taskType, tenantId: null },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: patch.taskType,
          tenantId: null,
          providers: patch.providers as unknown as object,
          isActive: true,
        },
      });
      created++;
       
      console.log(`[created] ${patch.taskType} → ${patch.providers[0]?.model}`);
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: existing.id },
        data: {
          providers: patch.providers as unknown as object,
          isActive: true,
        },
      });
      updated++;
       
      console.log(`[updated] ${patch.taskType} → ${patch.providers[0]?.model} (был ${JSON.stringify(existing.providers)})`);
    }
  }

   
  console.log(`created: ${created}, updated: ${updated}`);
   
  console.log('=== patch-llm-routes-report-chain-deepseek DONE ===');
}

main()
  .catch((err) => {
     
    console.error('patch-llm-routes-report-chain-deepseek FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
