/**
 * Волна 6 Стадия C, A7 (2026-06-10) — structured-document-compiler.
 *
 * Seed маршрута LLM для нового taskType `compile-org-document`: агент-компилятор
 * `contentMd` орг-документа (regulation/process/policy/instruction) через tool
 * `compile_org_document`. Вызывается специалистом 3.1 на verdict merge/extension
 * от regulation-dedupe.
 *
 * Цепочка (capable + tool-use, как у knowledge-specialists-combined):
 *   primary   — deepseek deepseek-v4-pro (capable + thinking + tools 'auto')
 *   secondary — openai-via-proxy gpt-5.4 (capable, тот же шаблон tool_use)
 *   tertiary  — ollama qwen3.5:9b        (локальный fallback)
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-compile-org-document.ts
 *   bun run scripts/seed-llm-task-routes-compile-org-document.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - запись с `editedByAdmin=true` НЕ перезаписывается.
 *   - без флага `--update-existing` существующая запись пропускается.
 *   - с флагом — обновляются providers JSON + isActive (но НЕ editedByAdmin).
 *
 * NB: без этого seed taskType поедет по аварийному DEFAULT_FALLBACK_CHAIN
 * (deepseek primary → openai-via-proxy → kie gemini) — он работоспособен
 * (deepseek capable), но явный маршрут фиксирует deepseek-v4-pro как primary.
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model: string;
}

interface TaskRoute {
  taskType: string;
  providers: ProviderEntry[];
  isActive: boolean;
}

const ROUTES: TaskRoute[] = [
  {
    taskType: 'compile-org-document',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { provider: 'ollama', model: 'qwen3.5:9b' },
    ],
    isActive: true,
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
   
  console.log(
    `=== seed-llm-task-routes-compile-org-document START (updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let protectedByAdmin = 0;

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
       
      console.log(`[created] ${route.taskType}`);
      continue;
    }
    if (existing.editedByAdmin) {
      protectedByAdmin++;
       
      console.log(`[skip:edited-by-admin] ${route.taskType}`);
      continue;
    }
    if (!updateExisting) {
      skipped++;
       
      console.log(`[skip] ${route.taskType}`);
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: route.providers as unknown as object,
        isActive: route.isActive,
      },
    });
    updated++;
     
    console.log(`[updated] ${route.taskType}`);
  }

   
  console.log(
    `inserted=${inserted}, updated=${updated}, skipped=${skipped}, protected_by_admin=${protectedByAdmin}`,
  );
   
  console.log('=== seed-llm-task-routes-compile-org-document DONE ===');
}

main()
  .catch((err) => {
     
    console.error('seed-llm-task-routes-compile-org-document FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { ROUTES };
