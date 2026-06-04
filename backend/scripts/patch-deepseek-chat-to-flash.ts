/**
 * Патч-скрипт: миграция всех LLM-маршрутов с легаси-модели `deepseek-chat`
 * на `deepseek-v4-flash` (единая дешёвая модель семейства DeepSeek-V4).
 *
 * Зачем (2026-06-03):
 *   На проде у части маршрутов primary/secondary всё ещё `deepseek/deepseek-chat`
 *   (старая модель из сидов β-8 / tracker / orchestrator / role-map / concierge
 *   и т.п.). Решение: дешёвые задачи DeepSeek используют ТОЛЬКО `deepseek-v4-flash`.
 *   `deepseek-chat` выводим из эксплуатации.
 *
 *   Свип покрывает и причину сбоя из лога 2026-06-03: `meeting-extract-actions`
 *   падал на `deepseek-chat` (response_format). После фикса deepseek.service.ts
 *   формат уже не блокер, но модель всё равно унифицируем на flash.
 *
 * Что НЕ трогаем:
 *   - editedByAdmin=true → админ выбрал модель вручную (skill safe-seed-rules).
 *   - Маршруты уже на deepseek-v4-pro (beta-8-1 / beta-8-3 — намеренная capable-
 *     миграция) — их deepseek-chat не содержат, свип их не заденет.
 *   - Любые модели != deepseek-chat — не наша забота.
 *
 * Форматы записи LlmTaskRoute (см. schema.prisma):
 *   - Новый: отдельная строка на tier (tier + providerName + model). Меняем
 *     `model` deepseek-chat → deepseek-v4-flash на строках с providerName='deepseek'.
 *   - Legacy: tier IS NULL, providers JSON-массив [{provider, model}]. Меняем
 *     каждый элемент {provider:'deepseek', model:'deepseek-chat'} → flash.
 *
 * Запуск (PrismaClient через _lib/prisma — Prisma 7 требует driver adapter):
 *   cd backend
 *   bun run scripts/patch-deepseek-chat-to-flash.ts            # dry-run (по умолчанию)
 *   bun run scripts/patch-deepseek-chat-to-flash.ts --apply    # реальная запись
 *
 * Идемпотентен — повторный прогон находит 0 кандидатов.
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const OLD_MODEL = 'deepseek-chat';
const NEW_MODEL = 'deepseek-v4-flash';
const PROVIDER = 'deepseek';

interface LegacyProviderEntry {
  provider: string;
  model?: string;
}

interface RunStats {
  updatedTierRows: number;
  updatedLegacyRows: number;
  skippedEdited: number;
  scanned: number;
}

function describeRoute(r: {
  taskType: string;
  tenantId: string | null;
  tier: string | null;
}): string {
  const scope = r.tenantId ? `tenant=${r.tenantId}` : 'global';
  return `${r.taskType} [${scope}/${r.tier ?? 'legacy'}]`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');


  console.log(
    `=== patch-deepseek-chat-to-flash START (${OLD_MODEL} → ${NEW_MODEL}, mode=${apply ? 'APPLY' : 'dry-run'}) ===`,
  );

  const routes = await prisma.llmTaskRoute.findMany();
  const stats: RunStats = {
    updatedTierRows: 0,
    updatedLegacyRows: 0,
    skippedEdited: 0,
    scanned: routes.length,
  };

  for (const r of routes) {
    // Новый формат: строка tier с model=deepseek-chat (providerName=deepseek).
    const isTierMatch =
      r.providerName === PROVIDER && r.model === OLD_MODEL;

    // Legacy: providers JSON-массив содержит deepseek/deepseek-chat.
    let legacyProviders: LegacyProviderEntry[] | null = null;
    if (r.tier === null && r.providers != null) {
      const arr = r.providers as unknown;
      if (Array.isArray(arr)) {
        legacyProviders = arr as LegacyProviderEntry[];
      }
    }
    const legacyMatchIdxs =
      legacyProviders
        ?.map((p, i) => (p.provider === PROVIDER && p.model === OLD_MODEL ? i : -1))
        .filter((i) => i >= 0) ?? [];

    if (!isTierMatch && legacyMatchIdxs.length === 0) continue;

    const tag = describeRoute(r);

    if (r.editedByAdmin) {
      stats.skippedEdited++;

      console.log(`${tag} [skip:edited] оставляем выбор админа`);
      continue;
    }

    if (isTierMatch) {
      if (apply) {
        await prisma.llmTaskRoute.update({
          where: { id: r.id },
          data: { model: NEW_MODEL },
        });
      }
      stats.updatedTierRows++;

      console.log(`${tag} [${apply ? 'updated' : 'dry'}:tier] model ${OLD_MODEL} → ${NEW_MODEL}`);
    }

    if (legacyProviders && legacyMatchIdxs.length > 0) {
      const next = legacyProviders.map((p) =>
        p.provider === PROVIDER && p.model === OLD_MODEL
          ? { ...p, model: NEW_MODEL }
          : p,
      );
      if (apply) {
        await prisma.llmTaskRoute.update({
          where: { id: r.id },
          data: { providers: next as unknown as object },
        });
      }
      stats.updatedLegacyRows++;

      console.log(
        `${tag} [${apply ? 'updated' : 'dry'}:legacy] ${legacyMatchIdxs.length} провайдер(ов) ${OLD_MODEL} → ${NEW_MODEL}`,
      );
    }
  }


  console.log(
    `\nИТОГО: scanned=${stats.scanned}, updatedTier=${stats.updatedTierRows}, updatedLegacy=${stats.updatedLegacyRows}, skippedEdited=${stats.skippedEdited}`,
  );
  if (!apply && stats.updatedTierRows + stats.updatedLegacyRows > 0) {

    console.log('Это был dry-run. Для записи повтори с --apply.');
  }
}

main()
  .catch((err) => {

    console.error('patch-deepseek-chat-to-flash FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();

    console.log('=== patch-deepseek-chat-to-flash DONE ===');
  });
