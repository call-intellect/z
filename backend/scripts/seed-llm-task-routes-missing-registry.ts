/**
 * Сид «потерянных» taskType — цепочки для 5 taskType, у которых в проде НЕТ
 * ни одного маршрута `LlmTaskRoute` (зарегистрированы в `ALL_LLM_TASK_TYPES`,
 * но ни один seed их не покрыл → роутер падает на code-fallback / 0 маршрутов).
 *
 * Стандарт цепочки (2026-06-05): `deepseek → openai(gpt) → kie:gemini-3.1-pro`.
 *
 * Покрытые taskType:
 *   - knowledge-specialists-combined  (heavyReasoning: deepseek-v4-pro)
 *   - dialog-multi-query-clone        (deepseek-v4-pro)
 *   - checkin-sentiment-batch         (deepseek-v4-pro)
 *   - experiment-extract              (deepseek-v4-flash)
 *   - experiment-summarize-lessons    (deepseek-v4-flash)
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с `editedByAdmin=true` НЕ перезаписываются (нужен `--force`).
 *   - Если для taskType уже есть запись в `LlmTaskRouteChange` (tenantId=null) —
 *     админ менял маршрут вручную: пропускаем весь taskType (нужен `--force`).
 *   - Существующая tier-запись с теми же значениями (model/priority/isActive) — skip.
 *   - Флаг `--force` — переписываем ВСЁ (для CI / ручной починки).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/seed-llm-task-routes-missing-registry.ts
 *   docker compose exec backend bun run scripts/seed-llm-task-routes-missing-registry.ts --force
 *
 * Совместимость: одна нормализованная запись = ОДИН провайдер + tier + priority,
 * legacy-поле `providers` остаётся `null`. priority: primary=0, secondary=0,
 * tertiary=0 (по образцу seed-llm-task-routes-default.ts: tier различает уровни).
 */

import { type LlmRouteTier } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

/** Один уровень цепочки. */
interface TierEntry {
  tier: LlmRouteTier;
  providerName: string;
  model: string;
  priority?: number;
}

/** Цепочка для одного taskType. */
interface TaskRouteSeed {
  taskType: string;
  chain: TierEntry[];
}

// Стандарт deepseek → openai(gpt) → kie. priority всех уровней = 0 (tier
// различает приоритет, как в seed-llm-task-routes-default.ts).
const ROUTES: TaskRouteSeed[] = [
  {
    taskType: 'knowledge-specialists-combined',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'dialog-multi-query-clone',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'checkin-sentiment-batch',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'experiment-extract',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
  {
    taskType: 'experiment-summarize-lessons',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
      { tier: 'tertiary', providerName: 'kie', model: 'gemini-3.1-pro' },
    ],
  },
];

interface SeedStats {
  inserted: number;
  updated: number;
  skipped: number;
  protectedByAudit: number;
}

async function applySeedForTask(
  seed: TaskRouteSeed,
  force: boolean,
  stats: SeedStats,
): Promise<void> {
  // Защита: если есть LlmTaskRouteChange для taskType — админ менял цепочку.
  // Без --force ничего не делаем.
  if (!force) {
    const auditCount = await prisma.llmTaskRouteChange.count({
      where: { taskType: seed.taskType, tenantId: null },
    });
    if (auditCount > 0) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skipped:audit] ${seed.taskType} (audit log has ${auditCount} entries)`);
      return;
    }
  }

  for (let i = 0; i < seed.chain.length; i++) {
    const entry = seed.chain[i];
    if (!entry) continue;
    const priority = entry.priority ?? 0;
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
      console.log(`[inserted] ${seed.taskType} ${entry.tier} ${entry.providerName}:${entry.model}`);
      continue;
    }
    if (existing.editedByAdmin && !force) {
      stats.protectedByAudit++;
      // eslint-disable-next-line no-console
      console.log(`[skipped:edited] ${seed.taskType} ${entry.tier} (editedByAdmin, нужен --force)`);
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
    console.log(`[updated] ${seed.taskType} ${entry.tier} → ${entry.providerName}:${entry.model}`);
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-missing-registry START (force=${force}) ===`);
  // eslint-disable-next-line no-console
  console.log(`Routes to apply: ${ROUTES.length}`);

  const stats: SeedStats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    protectedByAudit: 0,
  };

  for (const seed of ROUTES) {
    await applySeedForTask(seed, force, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_audit_or_edit=${stats.protectedByAudit}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-missing-registry DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-missing-registry FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Экспортируем массив для тестов (unit-test проверяет, что 5 taskType'ов
// и у каждого 3 tier'а вида deepseek → openai → kie).
export { ROUTES };
