/**
 * Patch — переключает основной отвечальщик чата компании (`taskType=chat-v2`)
 * с `deepseek-v4-flash` на `deepseek-v4-pro` для primary-цепочки.
 *
 * Основание: эксперимент 2026-05-25 на 3 диалоговых фикстурах показал, что
 * качество ответа критично для UX, а Pro со скидкой 75% — лишь незначительно
 * дороже Flash. См. backend/test/eval/dialog-experiment/reports/SUMMARY-ALL.md.
 *
 * Поведение по форматам записи (см. schema.prisma:LlmTaskRoute):
 *   - Legacy (tier IS NULL): обновляет JSON `providers[]`, заменяя model у
 *     первого deepseek-провайдера.
 *   - Новый (tier='primary' + providerName='deepseek'): обновляет model на
 *     deepseek-v4-pro.
 *
 * Безопасность (skill safe-seed-rules):
 *   - editedByAdmin=true → НЕ трогаем (админ выбрал намеренно).
 *   - Нет записи — НЕ создаём (предполагается, что seed уже отработал).
 *   - Идемпотентен — повторный запуск ничего не меняет, если модель уже Pro.
 *
 * Запуск:
 *   cd backend && bun run scripts/patch-chat-v2-to-pro.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7: driver adapter обязателен. URL из env (bun грузит .env).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const TASK_TYPE = 'chat-v2';
const OLD_MODEL = 'deepseek-v4-flash';
const NEW_MODEL = 'deepseek-v4-pro';

interface LegacyProviderEntry {
  provider: string;
  model?: string;
}

async function main(): Promise<void> {
  console.log(`=== patch-chat-v2-to-pro START (${OLD_MODEL} → ${NEW_MODEL}) ===`);

  const routes = await prisma.llmTaskRoute.findMany({
    where: { taskType: TASK_TYPE, tenantId: null },
  });

  if (routes.length === 0) {
    console.log(
      `[skip] не найдено ни одной записи ${TASK_TYPE} (tenantId=null). Сначала запусти seed-llm-task-routes-knowledge-core.ts.`,
    );
    return;
  }

  let updated = 0;
  let alreadyPro = 0;
  let skippedEdited = 0;
  let skippedOtherProvider = 0;

  for (const route of routes) {
    if (route.editedByAdmin) {
      skippedEdited++;
      console.log(
        `[skip:edited] id=${route.id} tier=${route.tier ?? 'legacy'} — админ ред., не трогаем`,
      );
      continue;
    }

    // Новый формат: tier + providerName + model
    if (route.tier !== null && route.providerName === 'deepseek') {
      if (route.model === NEW_MODEL) {
        alreadyPro++;
        console.log(`[ok] id=${route.id} tier=${route.tier} уже на ${NEW_MODEL}`);
        continue;
      }
      if (route.tier === 'primary' && route.model === OLD_MODEL) {
        await prisma.llmTaskRoute.update({
          where: { id: route.id },
          data: { model: NEW_MODEL },
        });
        updated++;
        console.log(
          `[updated:tier] id=${route.id} ${OLD_MODEL} → ${NEW_MODEL}`,
        );
      } else {
        skippedOtherProvider++;
        console.log(
          `[skip:other] id=${route.id} tier=${route.tier} model=${route.model} — не primary-deepseek-flash`,
        );
      }
      continue;
    }

    // Legacy формат: JSON providers[]
    if (route.tier === null && route.providers) {
      const providers = route.providers as unknown as LegacyProviderEntry[];
      if (!Array.isArray(providers)) {
        console.log(`[skip:invalid] id=${route.id} providers не массив`);
        continue;
      }
      const idx = providers.findIndex(
        (p) => p.provider === 'deepseek' && p.model === OLD_MODEL,
      );
      const alreadyHasPro = providers.some(
        (p) => p.provider === 'deepseek' && p.model === NEW_MODEL,
      );
      if (alreadyHasPro && idx === -1) {
        alreadyPro++;
        console.log(`[ok] id=${route.id} legacy уже содержит ${NEW_MODEL}`);
        continue;
      }
      if (idx === -1) {
        skippedOtherProvider++;
        console.log(`[skip:other] id=${route.id} legacy — deepseek-flash не найден`);
        continue;
      }
      const newProviders = [...providers];
      newProviders[idx] = { ...newProviders[idx], model: NEW_MODEL };
      await prisma.llmTaskRoute.update({
        where: { id: route.id },
        data: { providers: newProviders as unknown as object },
      });
      updated++;
      console.log(`[updated:legacy] id=${route.id} ${OLD_MODEL} → ${NEW_MODEL}`);
    }
  }

  console.log(
    `\nИТОГО: updated=${updated}, alreadyPro=${alreadyPro}, skippedEdited=${skippedEdited}, skippedOther=${skippedOtherProvider}`,
  );
}

main()
  .catch((err) => {
    console.error('patch-chat-v2-to-pro FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('=== patch-chat-v2-to-pro DONE ===');
  });
