/**
 * Патч нормализации LLM-цепочек к стандарту `deepseek → openai(gpt) → kie`.
 *
 * Назначение: привести все глобальные (tenantId=null) цепочки маршрутизации
 * `LlmTaskRoute` к единому виду:
 *   primary   — deepseek (pro/flash/исключения сохраняются), ollama-primary → flash;
 *   secondary — openai-via-proxy:gpt-5.4-mini по умолчанию (или deepseek-flash,
 *               если primary не deepseek); сохраняем валидный non-dup кандидат;
 *   tertiary  — всегда kie:gemini-3.1-pro (универсальный fallback, ollama убран).
 * Плюс точечный вывод устаревшей gpt-4o из gpt-4o-зависимых taskType (override
 * primary на deepseek-pro / openai gpt-5-mini — см. GPT4O_OVERRIDES).
 *
 * Гарантия: три РАЗНЫХ providerName в цепочке (primary≠secondary≠tertiary).
 *
 * Запуск (см. apply-prod-deploy: steady-state регистрируется БЕЗ --force):
 *   docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts --dry-run   # план, без записи
 *   docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts             # steady-state (уважает editedByAdmin)
 *   docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts --force     # разово при выкате (перезапись editedByAdmin)
 *
 * Идемпотентность: повторный прогон без изменений = 0 апдейтов
 *   (computeDesiredChain — чистая функция, её результат стабилен под повторным
 *   применением: f(asCurrent(f(x))) == f(x)).
 *
 * --force в агрегаторе НЕ передаётся (steady-state уважает editedByAdmin).
 * Разовый --force владелец гоняет вручную при выкате.
 */

import { createPrismaClient } from './_lib/prisma';
import { ALL_LLM_TASK_TYPES } from '../src/modules/ai/services/llm-router.service';

// ═══════════════ B.1 — ЧИСТАЯ ФУНКЦИЯ (тестируется без БД) ═══════════════

export interface TierSpec {
  providerName: string;
  model: string;
}
export interface DesiredChain {
  primary: TierSpec;
  secondary: TierSpec;
  tertiary: TierSpec;
}

/** Дефолтные модели стандарта. */
const DEEPSEEK_FLASH: TierSpec = { providerName: 'deepseek', model: 'deepseek-v4-flash' };
const DEEPSEEK_PRO: TierSpec = { providerName: 'deepseek', model: 'deepseek-v4-pro' };
const OPENAI_MINI: TierSpec = { providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' };
const KIE_TERTIARY: TierSpec = { providerName: 'kie', model: 'gemini-3.1-pro' };

/**
 * gpt-4o override (вывод устаревшей модели): для этих taskType primary
 * принудительно переопределяется (см. правило 1 в computeDesiredChain).
 */
const GPT4O_DEEPSEEK_PRO = new Set<string>([
  'orchestrator-plan',
  'orchestrator-synthesize',
  'brand-voice-extract',
]);
const CONCIERGE_RESPOND_PRIMARY: TierSpec = {
  providerName: 'openai-via-proxy',
  model: 'gpt-5-mini',
};

/**
 * Вычислить желаемую цепочку для taskType по текущему состоянию в БД.
 * Чистая функция — без побочных эффектов.
 *
 * @param current — то, что сейчас в БД по tier'ам (у tier'а может не быть записи).
 */
export function computeDesiredChain(
  taskType: string,
  current: { primary?: TierSpec; secondary?: TierSpec; tertiary?: TierSpec },
): DesiredChain {
  // ── Правило 1: gpt-4o override (вывод устаревшей модели). ──
  let primary: TierSpec | undefined;
  if (GPT4O_DEEPSEEK_PRO.has(taskType)) {
    primary = { ...DEEPSEEK_PRO };
  } else if (taskType === 'concierge-respond') {
    primary = { ...CONCIERGE_RESPOND_PRIMARY };
  }

  // ── Правило 2: primary (если не переопределён п.1). ──
  if (!primary) {
    if (!current.primary) {
      primary = { ...DEEPSEEK_FLASH };
    } else if (current.primary.providerName === 'ollama') {
      primary = { ...DEEPSEEK_FLASH };
    } else {
      // Сохраняем как есть (pro/flash/openai-исключения).
      primary = { ...current.primary };
    }
  }

  // ── Правило 3: tertiary — всегда kie. ──
  const tertiary: TierSpec = { ...KIE_TERTIARY };

  // ── Правило 4: secondary. ──
  const secondary = computeSecondary(primary, current.secondary);

  // ── Правило 5: гарантия трёх разных providerName. ──
  return ensureDistinct(primary, secondary, tertiary);
}

/** Дефолтный secondary исходя из primary. */
function defaultSecondary(primary: TierSpec): TierSpec {
  if (primary.providerName !== 'deepseek') {
    return { ...DEEPSEEK_FLASH };
  }
  return { ...OPENAI_MINI };
}

/** Правило 4: выбрать secondary. */
function computeSecondary(primary: TierSpec, candidate?: TierSpec): TierSpec {
  const invalid =
    !candidate ||
    candidate.providerName === 'ollama' ||
    candidate.providerName === primary.providerName ||
    candidate.providerName === 'kie';
  if (invalid) {
    return defaultSecondary(primary);
  }
  // Кандидат валиден, не дублирует, не ollama/kie — оставить как есть.
  return { ...candidate };
}

/**
 * Правило 5: если providerName где-то совпали — пересчитать secondary дефолтом.
 * primary и tertiary (kie) уже различны по построению; коллизия возможна только
 * по secondary (с primary или, теоретически, c tertiary).
 */
function ensureDistinct(
  primary: TierSpec,
  secondary: TierSpec,
  tertiary: TierSpec,
): DesiredChain {
  let sec = secondary;
  if (
    sec.providerName === primary.providerName ||
    sec.providerName === tertiary.providerName
  ) {
    sec = defaultSecondary(primary);
  }
  // Если дефолт всё ещё конфликтует (например primary=openai → дефолт deepseek,
  // ok; primary=deepseek → дефолт openai, ok; tertiary всегда kie) — но на всякий
  // случай страхуемся: если совпал с tertiary (kie) — это невозможно для дефолта,
  // но если бы было — переключаем на противоположный дефолт.
  if (
    sec.providerName === primary.providerName ||
    sec.providerName === tertiary.providerName
  ) {
    sec =
      primary.providerName === 'deepseek' ? { ...OPENAI_MINI } : { ...DEEPSEEK_FLASH };
  }
  return { primary: { ...primary }, secondary: sec, tertiary: { ...tertiary } };
}

/** Преобразовать DesiredChain обратно в форму `current` (для idempotency-теста). */
export function asCurrent(chain: DesiredChain): {
  primary?: TierSpec;
  secondary?: TierSpec;
  tertiary?: TierSpec;
} {
  return {
    primary: chain.primary,
    secondary: chain.secondary,
    tertiary: chain.tertiary,
  };
}

// ═══════════════ B.3 — DB-обёртка (тонкая, поверх чистой функции) ═══════════════

interface RunStats {
  taskTypesProcessed: number;
  tiersUpserted: number;
  tiersUnchanged: number;
  tiersDeactivated: number;
  skippedEdited: number;
}

const TIERS = ['primary', 'secondary', 'tertiary'] as const;
type TierName = (typeof TIERS)[number];

/**
 * Обработать один taskType: собрать current → computeDesiredChain → upsert
 * по tier'ам. Учитывает @@unique(taskType,tenantId,tier,providerName):
 *   - в tier'е находим запись (если несколько — берём одну, лишние деактивируем);
 *   - если providerName меняется — обновляем providerName+model у найденной записи
 *     (а не создаём новую), чтобы не нарушить unique и не плодить мёртвые строки.
 */
async function normalizeTaskType(
  prisma: ReturnType<typeof createPrismaClient>,
  taskType: string,
  dryRun: boolean,
  force: boolean,
  stats: RunStats,
): Promise<void> {
  const routes = await prisma.llmTaskRoute.findMany({
    where: { taskType, tenantId: null },
  });

  // Собираем current по tier'ам (берём активную/первую запись каждого tier'а).
  const current: { primary?: TierSpec; secondary?: TierSpec; tertiary?: TierSpec } = {};
  const byTier: Record<TierName, typeof routes> = {
    primary: [],
    secondary: [],
    tertiary: [],
  };
  for (const r of routes) {
    if (r.tier === 'primary' || r.tier === 'secondary' || r.tier === 'tertiary') {
      byTier[r.tier].push(r);
    }
  }
  for (const tier of TIERS) {
    const list = byTier[tier];
    // Предпочитаем активную запись, иначе первую.
    const chosen = list.find((r) => r.isActive) ?? list[0];
    if (chosen && chosen.providerName) {
      current[tier] = { providerName: chosen.providerName, model: chosen.model ?? '' };
    }
  }

  const desired = computeDesiredChain(taskType, current);
  const desiredByTier: Record<TierName, TierSpec> = {
    primary: desired.primary,
    secondary: desired.secondary,
    tertiary: desired.tertiary,
  };

  stats.taskTypesProcessed++;

  for (const tier of TIERS) {
    const want = desiredByTier[tier];
    const priority = 0; // tier различает приоритет (как в default-сиде).
    const list = byTier[tier];
    const chosen = list.find((r) => r.isActive) ?? list[0];

    // editedByAdmin guard (на уровне выбранной записи tier'а).
    if (chosen && chosen.editedByAdmin && !force) {
      stats.skippedEdited++;
      // eslint-disable-next-line no-console
      console.log(
        `[skip:edited] ${taskType} ${tier} id=${chosen.id} ${chosen.providerName}:${chosen.model} (нужен --force)`,
      );
      continue;
    }

    // Деактивируем лишние записи tier'а (оставляем одну каноническую).
    const extras = list.filter((r) => r !== chosen);
    for (const ex of extras) {
      if (ex.editedByAdmin && !force) continue;
      if (!ex.isActive) continue;
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[dry:deactivate] ${taskType} ${tier} id=${ex.id} ${ex.providerName}:${ex.model}`);
      } else {
        await prisma.llmTaskRoute.update({
          where: { id: ex.id },
          data: { isActive: false },
        });
      }
      stats.tiersDeactivated++;
      if (!dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[deactivate] ${taskType} ${tier} id=${ex.id} (дубль tier'а)`);
      }
    }

    if (!chosen) {
      // Нет записи tier'а — создаём.
      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log(`[dry:create] ${taskType} ${tier} ${want.providerName}:${want.model}`);
      } else {
        // Может существовать неактивная запись с тем же (tier, providerName) —
        // защищаемся upsert-логикой через findFirst по unique-ключу.
        const sameKey = await prisma.llmTaskRoute.findFirst({
          where: { taskType, tenantId: null, tier, providerName: want.providerName },
        });
        if (sameKey) {
          await prisma.llmTaskRoute.update({
            where: { id: sameKey.id },
            data: { model: want.model, priority, isActive: true, providers: null },
          });
        } else {
          await prisma.llmTaskRoute.create({
            data: {
              taskType,
              tenantId: null,
              tier,
              providerName: want.providerName,
              model: want.model,
              priority,
              providers: null,
              isActive: true,
              editedByAdmin: false,
            },
          });
        }
        // eslint-disable-next-line no-console
        console.log(`[create] ${taskType} ${tier} ${want.providerName}:${want.model}`);
      }
      stats.tiersUpserted++;
      continue;
    }

    // Запись tier'а есть. Нужно ли менять?
    const sameProvider = chosen.providerName === want.providerName;
    const sameModel = chosen.model === want.model;
    const sameActive = chosen.isActive === true;
    const samePriority = chosen.priority === priority;
    if (sameProvider && sameModel && sameActive && samePriority && chosen.providers == null) {
      stats.tiersUnchanged++;
      continue;
    }

    // Меняется providerName? Учитываем @@unique(taskType,tenantId,tier,providerName):
    // если уже есть запись этого tier'а с целевым providerName — обновим её,
    // а текущую chosen деактивируем; иначе просто перепишем chosen.
    if (!sameProvider) {
      const targetExisting = list.find(
        (r) => r !== chosen && r.providerName === want.providerName,
      );
      if (targetExisting) {
        if (targetExisting.editedByAdmin && !force) {
          stats.skippedEdited++;
          // eslint-disable-next-line no-console
          console.log(
            `[skip:edited] ${taskType} ${tier} target id=${targetExisting.id} (нужен --force)`,
          );
          continue;
        }
        if (dryRun) {
          // eslint-disable-next-line no-console
          console.log(
            `[dry:reuse] ${taskType} ${tier} id=${targetExisting.id} ${want.providerName}:${want.model}; deactivate id=${chosen.id}`,
          );
        } else {
          await prisma.llmTaskRoute.update({
            where: { id: targetExisting.id },
            data: { model: want.model, priority, isActive: true, providers: null },
          });
          await prisma.llmTaskRoute.update({
            where: { id: chosen.id },
            data: { isActive: false },
          });
          // eslint-disable-next-line no-console
          console.log(
            `[reuse] ${taskType} ${tier} → ${want.providerName}:${want.model} (id=${targetExisting.id}), deactivate id=${chosen.id}`,
          );
        }
        stats.tiersUpserted++;
        continue;
      }
    }

    // Обновляем chosen (providerName/model/priority/isActive/providers).
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `[dry:update] ${taskType} ${tier} id=${chosen.id} ${chosen.providerName}:${chosen.model} → ${want.providerName}:${want.model}`,
      );
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: chosen.id },
        data: {
          providerName: want.providerName,
          model: want.model,
          priority,
          isActive: true,
          providers: null,
        },
      });
      // eslint-disable-next-line no-console
      console.log(
        `[update] ${taskType} ${tier} id=${chosen.id} → ${want.providerName}:${want.model}`,
      );
    }
    stats.tiersUpserted++;
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const prisma = createPrismaClient();

  // eslint-disable-next-line no-console
  console.log(
    `=== patch-normalize-llm-chains-deepseek-openai-kie START (dryRun=${dryRun}, force=${force}, taskTypes=${ALL_LLM_TASK_TYPES.length}) ===`,
  );

  const stats: RunStats = {
    taskTypesProcessed: 0,
    tiersUpserted: 0,
    tiersUnchanged: 0,
    tiersDeactivated: 0,
    skippedEdited: 0,
  };

  try {
    for (const taskType of ALL_LLM_TASK_TYPES) {
      await normalizeTaskType(prisma, taskType, dryRun, force, stats);
    }
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nИТОГО: taskTypesProcessed=${stats.taskTypesProcessed}, tiersUpserted=${stats.tiersUpserted}, ` +
      `tiersUnchanged=${stats.tiersUnchanged}, tiersDeactivated=${stats.tiersDeactivated}, ` +
      `skippedEdited=${stats.skippedEdited}${dryRun ? ' (DRY-RUN — ничего не записано)' : ''}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== patch-normalize-llm-chains-deepseek-openai-kie DONE ===');
}

// Запускаем main только если файл вызван напрямую (а не импортирован тестом).
if (import.meta.main) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-normalize-llm-chains-deepseek-openai-kie FAILED:', err);
    process.exit(1);
  });
}
