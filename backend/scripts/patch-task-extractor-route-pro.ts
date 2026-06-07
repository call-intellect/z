/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ОПЦИОНАЛЬНО / OWNER-GATED — переключает task-экстракторы на capable pro.   ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ Что делает: переводит primary-маршрут task-экстракторов `tasks` и         ║
 * ║ `meeting-extract-actions` с дефолтной flash-модели на capable             ║
 * ║ `deepseek/deepseek-v4-pro` (точнее извлечение структурированных задач,     ║
 * ║ но ДОРОЖЕ за токен).                                                       ║
 * ║                                                                           ║
 * ║ Это БЮДЖЕТНОЕ решение владельца: скрипт — только МЕХАНИЗМ. Он НАМЕРЕННО    ║
 * ║ НЕ зарегистрирован в `backend/scripts/apply-prod-deploy.ts` (массив       ║
 * ║ STEPS), поэтому НЕ запускается автоматически на `docker compose ...        ║
 * ║ apply-prod-deploy`. Запуск — ТОЛЬКО вручную, осознанно владельцем:        ║
 * ║   docker compose exec backend bun run scripts/patch-task-extractor-route-pro.ts ║
 * ║                                                                           ║
 * ║ Идемпотентность (skill `safe-seed-rules`):                                ║
 * ║   - editedByAdmin=true → НЕ трогаем (админ владеет маршрутом руками);      ║
 * ║   - primary уже на deepseek-v4-pro → no-op (лог «already pro»);           ║
 * ║   - повторный прогон = no-op.                                             ║
 * ║                                                                           ║
 * ║ Откат: вернуть прежнюю модель (`deepseek-v4-flash`) через админку         ║
 * ║ `/admin/ai-models/[taskType]` или обратным патчем.                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

/** Task-экстракторы, которые переключаем на capable pro-модель. */
const TASK_TYPES = ['tasks', 'meeting-extract-actions'] as const;

/** Точные значения из реестра провайдеров/моделей (см. seed-llm-task-routes-default.ts). */
const TARGET_PROVIDER = 'deepseek';
const TARGET_MODEL = 'deepseek-v4-pro';

interface PatchStats {
  switched: number;
  alreadyPro: number;
  protectedByAdmin: number;
  noPrimaryFound: number;
}

async function applyForTaskType(taskType: string, stats: PatchStats): Promise<void> {
  // Берём primary-маршрут (наивысший приоритет — priority=0 первым).
  const primary = await prisma.llmTaskRoute.findFirst({
    where: { taskType, tenantId: null, tier: 'primary' },
    orderBy: { priority: 'asc' },
  });

  if (!primary) {
    stats.noPrimaryFound++;
     
    console.log(
      `[skip:no-primary] ${taskType} — нет нормализованного primary-маршрута (tier=primary). ` +
        `Сначала прогоните дефолтный seed (seed-llm-task-routes-default.ts).`,
    );
    return;
  }

  if (primary.editedByAdmin) {
    stats.protectedByAdmin++;
     
    console.log(
      `[skip:edited-by-admin] ${taskType}/primary — админ владеет маршрутом ` +
        `(${primary.providerName}:${primary.model}); не трогаем.`,
    );
    return;
  }

  if (
    primary.providerName === TARGET_PROVIDER &&
    primary.model === TARGET_MODEL &&
    primary.isActive === true
  ) {
    stats.alreadyPro++;
     
    console.log(`[skip:already-pro] ${taskType}/primary уже ${TARGET_PROVIDER}:${TARGET_MODEL}`);
    return;
  }

  await prisma.llmTaskRoute.update({
    where: { id: primary.id },
    data: { providerName: TARGET_PROVIDER, model: TARGET_MODEL, isActive: true },
  });
  stats.switched++;
   
  console.log(
    `[switch] ${taskType}/primary ${primary.providerName}:${primary.model} → ` +
      `${TARGET_PROVIDER}:${TARGET_MODEL}`,
  );
}

async function main(): Promise<void> {
   
  console.log('=== patch-task-extractor-route-pro START (OWNER-GATED, не авто-выкат) ===');

  const stats: PatchStats = {
    switched: 0,
    alreadyPro: 0,
    protectedByAdmin: 0,
    noPrimaryFound: 0,
  };

  for (const taskType of TASK_TYPES) {
    await applyForTaskType(taskType, stats);
  }

   
  console.log('');
   
  console.log(
    `switched=${stats.switched}, already_pro=${stats.alreadyPro}, ` +
      `protected_by_admin=${stats.protectedByAdmin}, no_primary_found=${stats.noPrimaryFound}`,
  );
}

main()
  .catch((err) => {
     
    console.error('patch-task-extractor-route-pro FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
     
    console.log('=== patch-task-extractor-route-pro DONE ===');
  });
