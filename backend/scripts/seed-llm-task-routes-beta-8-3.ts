/**
 * SBA β-8.3 — Seed маршрутов LLM для ежедневного отчёта операционного директора.
 *
 *   - operations-daily-digest — связный текст ежедневного дайджеста
 *     (markdown, 4-6 коротких разделов + shortSummary для Telegram).
 *     Один вызов в день на Org — не критично к скорости. Тот же
 *     провайдерский профиль, что и у weekly-digest.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-beta-8-3.ts
 *   bun run scripts/seed-llm-task-routes-beta-8-3.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - editedByAdmin=true → НЕ перезаписываем.
 *   - Без --update-existing — пропускаем существующие записи.
 *   - С --update-existing — обновляем model/priority/isActive.
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
    taskType: 'operations-daily-digest',
    playbookSection:
      '§β-8.3 §1.7 — связный markdown 4-6 разделов ежедневного дайджеста + shortSummary. 1 вызов/день/Org.',
    chain: [
      { tier: 'primary', providerName: 'deepseek', model: 'deepseek-chat' },
      { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-nano' },
      { tier: 'tertiary', providerName: 'ollama', model: 'qwen3.5:9b' },
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
       
      console.log(
        `[insert] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
      );
      continue;
    }
    if (existing.editedByAdmin) {
      stats.protectedByAudit++;
       
      console.log(
        `[skip:edited-by-admin] ${seed.taskType}/${entry.tier}/${entry.providerName}`,
      );
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
     
    console.log(
      `[update] ${seed.taskType}/${entry.tier}/${entry.providerName}:${entry.model}`,
    );
  }
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
   
  console.log(
    `=== seed-llm-task-routes-beta-8-3 START (updateExisting=${updateExisting}) ===`,
  );
   
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

   
  console.log(
    `inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, protected_by_admin=${stats.protectedByAudit}`,
  );
   
  console.log('=== seed-llm-task-routes-beta-8-3 DONE ===');
}

main()
  .catch((err) => {
     
    console.error('seed-llm-task-routes-beta-8-3 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });

export { SEEDS };
