/**
 * ТЗ 2026-05-25 §9 (clone-respond эволюция, Фаза 7) — seed маршрутов LLM
 * для двух новых/обновлённых taskType'ов:
 *
 *   - `dialog-multi-query-clone` (новый) — multi-query расширение запросов
 *     к клону по аналогии (3 формулировки: точная / ситуационный аналог /
 *     общий принцип). Используется только если `CLONE_V2_ENABLED=true`.
 *     Primary — deepseek-v4-pro (capable thinking), fallback — gpt-5.4-mini
 *     и ollama qwen3.5:9b.
 *
 *   - `clone-respond` (обновление) — primary переключаем с deepseek-v4-flash
 *     на deepseek-v4-pro (ТЗ §9.3 решение 9 + smoke §10.3 #17). Запускается
 *     ОНЛИ с `--update-existing`, иначе пропускается.
 *
 * Эти маршруты не блокируют включение V2: legacy `clone-respond` остаётся
 * рабочим даже без seed-обновления (просто будет использоваться prev primary).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-clone-v2.ts
 *   bun run scripts/seed-llm-task-routes-clone-v2.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - Записи с editedByAdmin=true НЕ перезаписываются (admin edit > seed).
 *   - Без `--update-existing` — пропускаем существующие.
 *   - С `--update-existing` — обновляем model/priority/isActive.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RouteSeed {
  taskType: string;
  tier: 'primary' | 'secondary' | 'tertiary';
  provider: string;
  model: string;
  priority: number;
  maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
}

const ROUTES: RouteSeed[] = [
  // ── dialog-multi-query-clone — новый route ─────────────────────────
  {
    taskType: 'dialog-multi-query-clone',
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    taskType: 'dialog-multi-query-clone',
    tier: 'secondary',
    provider: 'openai-via-proxy',
    model: 'gpt-5.4-mini',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    taskType: 'dialog-multi-query-clone',
    tier: 'tertiary',
    provider: 'ollama',
    model: 'qwen3.5:9b',
    priority: 0,
    maxDataClass: 'private',
  },
  // ── clone-respond — обновление primary до deepseek-v4-pro ──────────
  {
    taskType: 'clone-respond',
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    priority: 0,
    maxDataClass: 'internal',
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-clone-v2 START (updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const r of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: r.taskType,
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
          `[skipped:edited] ${r.taskType} ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
        );
        continue;
      }
      if (!updateExisting) {
        skipped++;
        // eslint-disable-next-line no-console
        console.log(
          `[skipped:exists] ${r.taskType} ${r.tier} ${r.provider}:${r.model}`,
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
        `[updated] ${r.taskType} ${r.tier} ${r.provider}:${r.model}`,
      );
      continue;
    }
    await prisma.llmTaskRoute.create({
      data: {
        taskType: r.taskType,
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
    console.log(`[created] ${r.taskType} ${r.tier} ${r.provider}:${r.model}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted: ${inserted}, updated: ${updated}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-clone-v2 DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-clone-v2 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
