/**
 * Откатной патч-скрипт миграции LLM на DeepSeek-V4-Pro (Фаза 4).
 *
 * Возвращает все указанные taskType с `deepseek-v4-pro` на `deepseek-v4-flash`
 * (старая безопасная primary-модель из llm-providers-verified.md).
 *
 * Когда запускать (см. ТЗ §5.5):
 *   - Хирургически (1-2 пострадавших агента) — НЕ нужен скрипт, точечный
 *     SQL UPDATE или Prisma Studio хватит.
 *   - Массово (3+ пострадавших, тот же тип ошибки) — `--update-existing`.
 *   - Полный откат (10+ пострадавших или Pro-endpoint лёг) — без обсуждений.
 *
 * Запуск:
 *   cd backend
 *   bun run scripts/patch-rollback-to-deepseek-flash.ts --dry-run                # только показать
 *   bun run scripts/patch-rollback-to-deepseek-flash.ts --update-existing        # массовый откат
 *   bun run scripts/patch-rollback-to-deepseek-flash.ts --task chat-v2 --update-existing
 *                                                                                 # один taskType
 *
 * Идемпотентен — можно запускать несколько раз без побочных эффектов:
 *   - Если запись уже на deepseek-v4-flash → `[ok] уже на flash`.
 *   - Если editedByAdmin=true → `[skip:edited]` (админ вручную выбрал).
 *   - Если записи не существует → `[skip:not-found]`, ничего не создаём.
 *
 * Список ROLLBACK_TARGETS — один-в-один с `patch-mass-migrate-to-deepseek-pro.ts`
 * TARGETS[] (зеркальная операция). EXTRA_TARGETS — chat-v2 + dialog-layer (5 шт.),
 * которые тоже были переведены на Pro отдельным seed/patch'ем в Фазе 4.
 *
 * НЕ откатываем (намеренно):
 *   - clone-respond-v2 / knowledge-specialists-combined — под флагами,
 *     закомментированы в EXTRA_TARGETS; включай если флаги были on при инциденте.
 *   - skill-trait-detect, meeting-report-fast, checkin-sentiment,
 *     operations-*-digest — переведены на Pro в более ранних seed'ах с
 *     отдельными golden-наборами; откат точечно через --task <name>.
 *
 * Поведение по форматам записи (см. schema.prisma: LlmTaskRoute):
 *   - Новый (tier='primary' + providerName='deepseek' + model='deepseek-v4-pro')
 *     → update model → 'deepseek-v4-flash'.
 *   - Legacy (tier IS NULL, providers JSON) → обновляем первый deepseek-
 *     провайдера в массиве, заменяя model deepseek-v4-pro → deepseek-v4-flash.
 *   - Новый primary с providerName != 'deepseek' (после миграции такого быть
 *     не должно — patch-mass-migrate перетягивал всех на deepseek) →
 *     `[skip:other-provider]`, в rollback не лезем.
 *
 * Безопасность (skill safe-seed-rules):
 *   - editedByAdmin=true → НЕ трогаем (если админ откатил/выбрал что-то сам).
 *   - Нет записи → НЕ создаём (откат предполагает существующую seed-инфраструктуру).
 *   - Без --update-existing — только dry-run-подобное поведение для записей
 *     не на flash (печатаем «нужен флаг», ничего не меняем).
 *
 * ТЗ: plans/tz/2026-05-26-llm-migration-smoke-checklist.md §5
 * Зеркало: backend/scripts/patch-mass-migrate-to-deepseek-pro.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7: driver adapter обязателен. URL из env (bun грузит .env).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const OLD_MODEL = 'deepseek-v4-pro'; // от чего откатываем
const NEW_MODEL = 'deepseek-v4-flash'; // куда откатываем
const PROVIDER = 'deepseek';

/**
 * Зеркало TARGETS[] из patch-mass-migrate-to-deepseek-pro.ts.
 * Категории сохранены для логирования и upgrade-консистентности.
 */
interface RollbackTarget {
  taskType: string;
  category: 'merge' | 'cron' | 'formulate' | 'chat' | 'rollup' | 'classifier';
}

const ROLLBACK_TARGETS: RollbackTarget[] = [
  // Merge / arbiter
  { taskType: 'regulation-dedupe', category: 'merge' },
  { taskType: 'decision-supersede-detect', category: 'merge' },
  { taskType: 'entity-merge-arbiter', category: 'merge' },
  { taskType: 'knowledge-clone-merge', category: 'merge' },
  { taskType: 'idea-cluster-merge', category: 'merge' },
  { taskType: 'skill-trait-merge', category: 'merge' },
  { taskType: 'helpfulness-trait-merge', category: 'merge' },
  { taskType: 'insight-link-to-decisions', category: 'merge' },
  { taskType: 'experiment-summarize-lessons', category: 'merge' },

  // Cron
  { taskType: 'reframing', category: 'cron' },
  { taskType: 'theme-classify', category: 'cron' },
  { taskType: 'idea-status-summarize', category: 'cron' },
  { taskType: 'skill-trait-concept-name', category: 'cron' },
  { taskType: 'role-profile-build', category: 'cron' },

  // Formulate
  { taskType: 'probe-formulate', category: 'formulate' },
  { taskType: 'recognition-formulate', category: 'formulate' },
  { taskType: 'proactive-message-craft', category: 'formulate' },

  // Chat helpers
  { taskType: 'chat-v2-conversation-title', category: 'chat' },

  // Rollup
  { taskType: 'card-rollup-v2', category: 'rollup' },

  // Classifier
  { taskType: 'axis-classify', category: 'classifier' },
];

/**
 * Дополнительные таргеты Фазы 4: chat-v2 (отдельный patch-chat-v2-to-pro.ts)
 * и dialog-layer (5 шт. из seed-llm-task-routes-dialog-layer.ts).
 *
 * clone-respond-v2 / knowledge-specialists-combined — закомментированы,
 * раскомментируй вручную если на момент инцидента флаги
 * CLONE_V2_ENABLED / SPECIALISTS_COMBINED_ENABLED были on и пилот
 * затронут массовым 400/500.
 */
const EXTRA_TARGETS: RollbackTarget[] = [
  { taskType: 'chat-v2', category: 'chat' },
  { taskType: 'dialog-contextualize', category: 'chat' },
  { taskType: 'dialog-confidence', category: 'chat' },
  { taskType: 'dialog-classify', category: 'chat' },
  { taskType: 'dialog-multi-query', category: 'chat' },
  { taskType: 'dialog-summarize', category: 'chat' },
  // { taskType: 'clone-respond-v2', category: 'chat' },
  // { taskType: 'knowledge-specialists-combined', category: 'merge' },
];

interface LegacyProviderEntry {
  provider: string;
  model?: string;
}

interface RunStats {
  updatedTier: number;
  updatedLegacy: number;
  alreadyFlash: number;
  skippedEdited: number;
  skippedNotFound: number;
  skippedNoFlag: number;
  skippedOther: number;
}

async function rollbackTaskType(
  target: RollbackTarget,
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
     
    console.log(`${tag} [skip:not-found] нет записей (tenantId=null)`);
    return;
  }

  // Определяем primary-tier (новый формат) или legacy-запись.
  const primaryTier = routes.find(
    (r) => r.tier === 'primary' && r.providerName !== null,
  );
  const legacyRecord = routes.find((r) => r.tier === null && r.providers != null);

  // 1) Новый формат: primary запись существует.
  if (primaryTier) {
    if (primaryTier.editedByAdmin) {
      stats.skippedEdited++;
       
      console.log(
        `${tag} [skip:edited] primary id=${primaryTier.id} provider=${primaryTier.providerName}:${primaryTier.model}`,
      );
      return;
    }
    // Уже на flash — идемпотентный exit.
    if (
      primaryTier.providerName === PROVIDER &&
      primaryTier.model === NEW_MODEL
    ) {
      stats.alreadyFlash++;
       
      console.log(`${tag} [ok] primary уже ${PROVIDER}:${NEW_MODEL}`);
      return;
    }
    // Не deepseek primary — откат не для нашего скрипта (см. шапку).
    if (primaryTier.providerName !== PROVIDER) {
      stats.skippedOther++;
       
      console.log(
        `${tag} [skip:other-provider] primary id=${primaryTier.id} ${primaryTier.providerName}:${primaryTier.model} — не deepseek, откат не применим`,
      );
      return;
    }
    // deepseek primary, но не на pro и не на flash — странная промежуточная модель,
    // например 'deepseek-chat'. Пишем предупреждение и просим явный --update-existing.
    if (primaryTier.model !== OLD_MODEL) {
      if (!updateExisting) {
        stats.skippedNoFlag++;
         
        console.log(
          `${tag} [skip:no-flag] primary id=${primaryTier.id} model=${primaryTier.model} (не pro и не flash; нужно --update-existing для принудительного отката)`,
        );
        return;
      }
      // Форсированный откат.
      if (dryRun) {
         
        console.log(
          `${tag} [dry:updateTier:forced] id=${primaryTier.id} ${primaryTier.model} → ${NEW_MODEL}`,
        );
      } else {
        await prisma.llmTaskRoute.update({
          where: { id: primaryTier.id },
          data: { model: NEW_MODEL },
        });
      }
      stats.updatedTier++;
       
      console.log(
        `${tag} [updated:tier:forced] id=${primaryTier.id} model: ${primaryTier.model} → ${NEW_MODEL}`,
      );
      return;
    }
    // primary на pro — стандартный откат на flash.
    if (!updateExisting) {
      stats.skippedNoFlag++;
       
      console.log(
        `${tag} [skip:no-flag] primary id=${primaryTier.id} ${OLD_MODEL} (нужно --update-existing для отката на ${NEW_MODEL})`,
      );
      return;
    }
    if (dryRun) {
       
      console.log(
        `${tag} [dry:updateTier] id=${primaryTier.id} ${OLD_MODEL} → ${NEW_MODEL}`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: primaryTier.id },
        data: { model: NEW_MODEL },
      });
    }
    stats.updatedTier++;
     
    console.log(
      `${tag} [updated:tier] id=${primaryTier.id} ${OLD_MODEL} → ${NEW_MODEL}`,
    );
    return;
  }

  // 2) Legacy формат.
  if (legacyRecord) {
    if (legacyRecord.editedByAdmin) {
      stats.skippedEdited++;
       
      console.log(`${tag} [skip:edited] legacy id=${legacyRecord.id}`);
      return;
    }
    const providers = legacyRecord.providers as unknown as LegacyProviderEntry[];
    if (!Array.isArray(providers)) {
      stats.skippedOther++;
       
      console.log(`${tag} [skip:invalid] legacy providers не массив`);
      return;
    }
    const proIdx = providers.findIndex(
      (p) => p.provider === PROVIDER && p.model === OLD_MODEL,
    );
    const alreadyFlash = providers.some(
      (p) => p.provider === PROVIDER && p.model === NEW_MODEL,
    );
    if (alreadyFlash && proIdx === -1) {
      stats.alreadyFlash++;
       
      console.log(`${tag} [ok] legacy уже содержит ${PROVIDER}:${NEW_MODEL}`);
      return;
    }
    if (proIdx === -1) {
      stats.skippedOther++;
       
      console.log(
        `${tag} [skip:other] legacy id=${legacyRecord.id} — deepseek:${OLD_MODEL} не найден`,
      );
      return;
    }
    if (!updateExisting) {
      stats.skippedNoFlag++;
       
      console.log(
        `${tag} [skip:no-flag] legacy id=${legacyRecord.id} (нужно --update-existing)`,
      );
      return;
    }
    const newProviders = [...providers];
    newProviders[proIdx] = {
      ...newProviders[proIdx],
      provider: PROVIDER,
      model: NEW_MODEL,
    };
    if (dryRun) {
       
      console.log(
        `${tag} [dry:legacy] id=${legacyRecord.id} ${OLD_MODEL} → ${NEW_MODEL} (idx=${proIdx})`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: legacyRecord.id },
        data: { providers: newProviders as unknown as object },
      });
    }
    stats.updatedLegacy++;
     
    console.log(
      `${tag} [updated:legacy] id=${legacyRecord.id} ${OLD_MODEL} → ${NEW_MODEL}`,
    );
    return;
  }

  // Ни primary, ни legacy — странная конфигурация.
  stats.skippedOther++;
   
  console.log(
    `${tag} [skip:no-primary] есть ${routes.length} записей, но нет primary/legacy`,
  );
}

function parseTaskFlag(): string | null {
  const idx = process.argv.indexOf('--task');
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--task требует имя taskType, например `--task chat-v2`');
  }
  return value;
}

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  const dryRun = process.argv.includes('--dry-run');
  const onlyTask = parseTaskFlag();

  const allTargets = [...ROLLBACK_TARGETS, ...EXTRA_TARGETS];
  const targets = onlyTask
    ? allTargets.filter((t) => t.taskType === onlyTask)
    : allTargets;

  if (onlyTask && targets.length === 0) {
     
    console.error(
      `Неизвестный --task ${onlyTask}. Доступные: ${allTargets
        .map((t) => t.taskType)
        .join(', ')}`,
    );
    process.exit(2);
  }

   
  console.log(
    `=== patch-rollback-to-deepseek-flash START (${OLD_MODEL} → ${NEW_MODEL}, updateExisting=${updateExisting}, dryRun=${dryRun}, targets=${targets.length}${onlyTask ? `, --task ${onlyTask}` : ''}) ===`,
  );

  const stats: RunStats = {
    updatedTier: 0,
    updatedLegacy: 0,
    alreadyFlash: 0,
    skippedEdited: 0,
    skippedNotFound: 0,
    skippedNoFlag: 0,
    skippedOther: 0,
  };

  for (const target of targets) {
    await rollbackTaskType(target, updateExisting, dryRun, stats);
  }

   
  console.log(
    `\nИТОГО: updatedTier=${stats.updatedTier}, updatedLegacy=${stats.updatedLegacy}, alreadyFlash=${stats.alreadyFlash}, skippedEdited=${stats.skippedEdited}, skippedNotFound=${stats.skippedNotFound}, skippedNoFlag=${stats.skippedNoFlag}, skippedOther=${stats.skippedOther}`,
  );

  if (dryRun) {
     
    console.log(
      'Это был --dry-run. Для реального отката повтори без --dry-run (с --update-existing).',
    );
  } else if (!updateExisting && stats.updatedTier + stats.updatedLegacy === 0) {
     
    console.log(
      'Изменений не сделано — повтори с --update-existing для применения отката.',
    );
  }
}

main()
  .catch((err) => {
     
    console.error('patch-rollback-to-deepseek-flash FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
     
    console.log('=== patch-rollback-to-deepseek-flash DONE ===');
  });
