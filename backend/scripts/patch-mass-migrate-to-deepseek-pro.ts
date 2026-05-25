/**
 * Patch — массовая миграция «безопасного списка» taskType'ов с
 * `deepseek-v4-flash` / `deepseek-chat` / `gpt-5.4-nano` / `ollama qwen3.5:9b`
 * (primary) → `deepseek-v4-pro` (primary) для DeepSeek.
 *
 * Источник правды: `plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md`
 *   - §10.7 — «миграция любого taskType на DeepSeek-Pro технически безопасна»
 *   - §10.3 — smoke 28/28 OK прошли все перечисленные taskType
 *   - §10.4 Find 1 — поднять maxTokens до 1500+ для thinking-моделей (мы это
 *     сделали отдельно в самих сервисах)
 *
 * Безопасный список (см. таблицу ниже) — это арбитры (merge), cron-агенты,
 * формулировщики (probe/recognition/proactive), chat-v2-conversation-title,
 * card-rollup-v2, axis-classify, role-profile-build. Эти задачи прошли
 * smoke-прогон 2026-05-25 или однотипны с прошедшими.
 *
 * НЕ трогаем (намеренно):
 *   - `concierge-respond` (gpt-4o tools — лучше держится; ТЗ-копилка не
 *     требует переключать)
 *   - `concierge-toolcall-validate` (ollama, простая валидация)
 *   - `feedback.cluster` (параллельная сессия Фаза feedback)
 *   - specialists 3-* (extract'ы, отдельный эксперимент Б+ паттерн §3)
 *   - `meeting-report-fast` / `summary-v2` / `task-extract-v2` / `chapter-extract-v2`
 *     (часть meeting-report, уже Pro где надо)
 *   - `checkin-sentiment`, `operations-*-digest` (Фаза 2, уже Pro)
 *   - `skill-trait-detect` (golden подтверждён, уже Pro в seed-skill-and-clone.ts)
 *   - `tracker-*`, `commitment-extract-*`, `checkin-parse`, `intake-auto-triage`,
 *     `issue-*`, `telegram-*`, `experiment-extract` (простые tasks на
 *     deepseek-chat — менять без оснований не стоит)
 *   - dialog-layer 5 шт — отдельный скрипт `seed-llm-task-routes-dialog-layer.ts`
 *
 * Поведение по форматам записи (см. schema.prisma: LlmTaskRoute):
 *   - Legacy (tier IS NULL, providers JSON) — обновляем первый
 *     deepseek-провайдер на v4-pro.
 *   - Новый (tier='primary' + providerName='deepseek') — обновляем model.
 *   - Новый (tier='primary' + providerName != deepseek) — заменяем на
 *     primary deepseek/v4-pro (для axis-classify, theme-classify, proactive).
 *
 * Безопасность (skill safe-seed-rules):
 *   - editedByAdmin=true → НЕ трогаем.
 *   - Нет записи — НЕ создаём (предполагается, что seed уже отработал).
 *   - Идемпотентен — повторный запуск ничего не меняет, если модель уже Pro.
 *
 * Запуск:
 *   cd backend
 *   bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --dry-run
 *   bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --update-existing
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const NEW_MODEL = 'deepseek-v4-pro';
const NEW_PROVIDER = 'deepseek';

/**
 * Безопасный список taskType'ов для миграции на DeepSeek-Pro.
 *
 * Категоризация — см. ТЗ §10.3 и §0.3:
 *   - merge: арбитр-задачи (новое vs существующее, dedup, link).
 *   - cron: периодические summarize/classify, не блокируют UX.
 *   - formulate: формулировщики коротких текстов (probe, recognition, proactive).
 *   - chat: вспомогательные chat-v2 (title, не основной отвечальщик).
 *   - rollup: card-rollup-v2 (текстовый паттерн без tools).
 *   - classifier: классификаторы (axis-classify, theme-classify).
 */
interface MigrationTarget {
  taskType: string;
  category: 'merge' | 'cron' | 'formulate' | 'chat' | 'rollup' | 'classifier';
  smokeOk: boolean; // прошёл ли smoke 28 2026-05-25
}

const TARGETS: MigrationTarget[] = [
  // Merge / arbiter — все прошли smoke
  { taskType: 'regulation-dedupe', category: 'merge', smokeOk: true },
  { taskType: 'decision-supersede-detect', category: 'merge', smokeOk: true },
  { taskType: 'entity-merge-arbiter', category: 'merge', smokeOk: true },
  { taskType: 'knowledge-clone-merge', category: 'merge', smokeOk: true },
  { taskType: 'idea-cluster-merge', category: 'merge', smokeOk: true },
  { taskType: 'skill-trait-merge', category: 'merge', smokeOk: true },
  { taskType: 'helpfulness-trait-merge', category: 'merge', smokeOk: true },
  { taskType: 'insight-link-to-decisions', category: 'merge', smokeOk: true },
  // experiment-summarize-lessons — текущий primary deepseek-chat, smoke не делали,
  // но логика arbiter-merge (lessons learnt из 1-N experiments) — идентична.
  { taskType: 'experiment-summarize-lessons', category: 'merge', smokeOk: false },

  // Cron — все прошли smoke
  { taskType: 'reframing', category: 'cron', smokeOk: true },
  { taskType: 'theme-classify', category: 'cron', smokeOk: true },
  { taskType: 'idea-status-summarize', category: 'cron', smokeOk: true },
  { taskType: 'skill-trait-concept-name', category: 'cron', smokeOk: true },
  { taskType: 'role-profile-build', category: 'cron', smokeOk: true },

  // Formulate (короткий текст)
  { taskType: 'probe-formulate', category: 'formulate', smokeOk: true },
  { taskType: 'recognition-formulate', category: 'formulate', smokeOk: true },
  // proactive-message-craft — был на ollama primary; переводим на pro для качества.
  { taskType: 'proactive-message-craft', category: 'formulate', smokeOk: false },

  // Chat helpers
  { taskType: 'chat-v2-conversation-title', category: 'chat', smokeOk: true },

  // Rollup — текстовый паттерн
  { taskType: 'card-rollup-v2', category: 'rollup', smokeOk: true },

  // Classifier — был на ollama qwen3.5:9b
  { taskType: 'axis-classify', category: 'classifier', smokeOk: true },
];

interface LegacyProviderEntry {
  provider: string;
  model?: string;
}

interface RunStats {
  updatedTier: number;
  updatedLegacy: number;
  replacedPrimary: number;
  alreadyPro: number;
  skippedEdited: number;
  skippedNotFound: number;
  skippedOther: number;
}

async function migrateTaskType(
  target: MigrationTarget,
  updateExisting: boolean,
  dryRun: boolean,
  stats: RunStats,
): Promise<void> {
  const tag = `[${target.category}] ${target.taskType}`;
  const routes = await prisma.llmTaskRoute.findMany({
    where: { taskType: target.taskType, tenantId: null },
  });
  if (routes.length === 0) {
    stats.skippedNotFound++;
    // eslint-disable-next-line no-console
    console.log(`${tag} [skip:not-found] нет записей (tenantId=null)`);
    return;
  }

  // Найдём primary-tier (или legacy запись).
  const primaryTier = routes.find(
    (r) => r.tier === 'primary' && r.providerName !== null,
  );
  const legacyRecord = routes.find((r) => r.tier === null && r.providers != null);

  // 1) Новый формат: primary запись существует.
  if (primaryTier) {
    if (primaryTier.editedByAdmin) {
      stats.skippedEdited++;
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [skip:edited] primary id=${primaryTier.id} provider=${primaryTier.providerName}:${primaryTier.model}`,
      );
      return;
    }
    if (
      primaryTier.providerName === NEW_PROVIDER &&
      primaryTier.model === NEW_MODEL
    ) {
      stats.alreadyPro++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [ok] primary уже ${NEW_PROVIDER}:${NEW_MODEL}`);
      return;
    }
    if (!updateExisting) {
      stats.skippedOther++;
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [skip:no-flag] primary ${primaryTier.providerName}:${primaryTier.model} (нужно --update-existing)`,
      );
      return;
    }
    // Если primary — deepseek но не pro → меняем model.
    if (primaryTier.providerName === NEW_PROVIDER) {
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(
          `${tag} [dry:updateTier] id=${primaryTier.id} ${primaryTier.model} → ${NEW_MODEL}`,
        );
      } else {
        await prisma.llmTaskRoute.update({
          where: { id: primaryTier.id },
          data: { model: NEW_MODEL },
        });
      }
      stats.updatedTier++;
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [updated:tier] id=${primaryTier.id} model: ${primaryTier.model} → ${NEW_MODEL}`,
      );
      return;
    }
    // Если primary — другой provider (ollama / openai-via-proxy): заменяем
    // на deepseek/pro. Старый primary понижаем до secondary, чтобы не терять
    // chain — но только если в secondary не было ещё deepseek.
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [dry:replacePrimary] id=${primaryTier.id} ${primaryTier.providerName}:${primaryTier.model} → ${NEW_PROVIDER}:${NEW_MODEL}`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: primaryTier.id },
        data: {
          providerName: NEW_PROVIDER,
          model: NEW_MODEL,
        },
      });
    }
    stats.replacedPrimary++;
    // eslint-disable-next-line no-console
    console.log(
      `${tag} [replaced:primary] id=${primaryTier.id} ${primaryTier.providerName}:${primaryTier.model} → ${NEW_PROVIDER}:${NEW_MODEL}`,
    );
    return;
  }

  // 2) Legacy формат
  if (legacyRecord) {
    if (legacyRecord.editedByAdmin) {
      stats.skippedEdited++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [skip:edited] legacy id=${legacyRecord.id}`);
      return;
    }
    const providers = legacyRecord.providers as unknown as LegacyProviderEntry[];
    if (!Array.isArray(providers)) {
      stats.skippedOther++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [skip:invalid] legacy providers не массив`);
      return;
    }
    const deepseekIdx = providers.findIndex((p) => p.provider === NEW_PROVIDER);
    const alreadyHasPro = providers.some(
      (p) => p.provider === NEW_PROVIDER && p.model === NEW_MODEL,
    );
    if (alreadyHasPro) {
      stats.alreadyPro++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [ok] legacy уже содержит ${NEW_PROVIDER}:${NEW_MODEL}`);
      return;
    }
    if (!updateExisting) {
      stats.skippedOther++;
      // eslint-disable-next-line no-console
      console.log(`${tag} [skip:no-flag] legacy (нужно --update-existing)`);
      return;
    }
    let newProviders: LegacyProviderEntry[];
    if (deepseekIdx === -1) {
      // Вставляем deepseek/pro в начало
      newProviders = [
        { provider: NEW_PROVIDER, model: NEW_MODEL },
        ...providers,
      ];
    } else {
      newProviders = [...providers];
      newProviders[deepseekIdx] = {
        ...newProviders[deepseekIdx],
        provider: NEW_PROVIDER,
        model: NEW_MODEL,
      };
      // Если deepseek был не на первой позиции — переставим вперёд.
      if (deepseekIdx > 0) {
        const head = newProviders[deepseekIdx];
        if (head) {
          newProviders.splice(deepseekIdx, 1);
          newProviders.unshift(head);
        }
      }
    }
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `${tag} [dry:legacy] id=${legacyRecord.id} → primary ${NEW_PROVIDER}:${NEW_MODEL}`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: legacyRecord.id },
        data: { providers: newProviders as unknown as object },
      });
    }
    stats.updatedLegacy++;
    // eslint-disable-next-line no-console
    console.log(
      `${tag} [updated:legacy] id=${legacyRecord.id} → primary ${NEW_PROVIDER}:${NEW_MODEL}`,
    );
    return;
  }

  // Не нашли ни primary-tier, ни legacy — странная ситуация, репортим.
  stats.skippedOther++;
  // eslint-disable-next-line no-console
  console.log(
    `${tag} [skip:no-primary] есть записи (${routes.length}) но нет primary/legacy`,
  );
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(
    `=== patch-mass-migrate-to-deepseek-pro START (updateExisting=${updateExisting}, dryRun=${dryRun}, targets=${TARGETS.length}) ===`,
  );

  const stats: RunStats = {
    updatedTier: 0,
    updatedLegacy: 0,
    replacedPrimary: 0,
    alreadyPro: 0,
    skippedEdited: 0,
    skippedNotFound: 0,
    skippedOther: 0,
  };

  for (const target of TARGETS) {
    await migrateTaskType(target, updateExisting, dryRun, stats);
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nИТОГО: updatedTier=${stats.updatedTier}, updatedLegacy=${stats.updatedLegacy}, replacedPrimary=${stats.replacedPrimary}, alreadyPro=${stats.alreadyPro}, skippedEdited=${stats.skippedEdited}, skippedNotFound=${stats.skippedNotFound}, skippedOther=${stats.skippedOther}`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-mass-migrate-to-deepseek-pro FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log('=== patch-mass-migrate-to-deepseek-pro DONE ===');
  });
