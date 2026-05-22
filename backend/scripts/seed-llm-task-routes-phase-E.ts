/**
 * Seed LlmTaskRoute для taskType='custom-report' (Фаза E).
 *
 * Источник: plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md §5.5.
 * Reference: docs/reference/llm-models-playbook.md §2.1 (generalPurpose chain).
 *
 * `custom-report` — общий taskType для ВСЕХ дополнительных AI-отчётов,
 * которые пользователь генерирует по выбранному шаблону. Per-template цепочки
 * (через UI /admin/ai-models) — это override-записи, которые резолвятся
 * раньше общей. Здесь мы заводим только дефолтную цепочку для taskType.
 *
 * Цепочка из трёх tier'ов:
 *   - primary    deepseek          deepseek-v4-flash   (хорошее соотношение цена/качество)
 *   - secondary  openai-via-proxy  gpt-5.4-mini        (резерв на длинных промптах со многими секциями)
 *   - tertiary   ollama            qwen3.5:9b          (local fallback; degraded mode флаг в output.warnings)
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - upsert по (taskType, tenantId=null, tier, providerName).
 *   - если запись существует и `editedByAdmin=true` → пропуск (ручные правки super_admin'а сохраняются).
 *   - если запись существует и `editedByAdmin=false` → пропуск (обновление — через UI, не через seed).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-phase-E.ts
 *
 * Этот seed выполняется однократно при rollout Фазы E на проде. См.
 * `docs/reference/llm-models-playbook.md §2.1` для актуальных моделей.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TASK_TYPE = 'custom-report' as const;

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
  console.log(`=== seed-llm-task-routes-phase-E START (taskType=${TASK_TYPE}) ===`);

  let inserted = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const r of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: TASK_TYPE,
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
          `[skipped:edited] ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
        );
      } else {
        skipped++;
        // eslint-disable-next-line no-console
        console.log(`[skipped:exists] ${r.tier} ${r.provider}:${r.model}`);
      }
      continue;
    }
    await prisma.llmTaskRoute.create({
      data: {
        taskType: TASK_TYPE,
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
    console.log(`[created] ${r.tier} ${r.provider}:${r.model}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted: ${inserted}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-phase-E DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-phase-E FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
