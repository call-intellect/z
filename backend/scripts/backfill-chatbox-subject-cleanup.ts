/**
 * Backfill-очистка ложных subject-связей от chatbox (cross-attribution).
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-08-enable-shipped-features-by-default.md` Часть B,
 *   Фаза B3. Исторически ВСЕ блоки из chatbox-сессии получали
 *   `IdeaBlockEntity{role='subject', entity=менеджер}` (session-level
 *   ответственный), включая блоки, извлечённые из реплик КЛИЕНТА. Это
 *   отравляло knowledge-клон менеджера приписанными чужими фактами.
 *   Новый код (per-message сегменты с authorPersonId — chatbox-ingest.service)
 *   атрибутирует subject по говорящему сегмента, поэтому НОВЫЕ чаты
 *   атрибутируются корректно сразу. Этот backfill снимает уже отравленные
 *   исторические связи.
 *
 * Что снимаем (консервативно):
 *   ВСЕ `IdeaBlockEntity{role='subject'}` у блоков, имеющих хотя бы одно
 *   evidence с `sourceType='chatbox'`. Историческое происхождение реплики
 *   (менеджер/клиент) на уровне блока неразличимо → снимаем все chatbox
 *   subject-связи; корректную атрибуцию даёт переизвлечение новым кодом.
 *   `role='mentioned'` НЕ трогаем; не-chatbox subject НЕ трогаем.
 *
 * Идемпотентность: повторный `--apply` → 0 удалений (связи уже сняты).
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-chatbox-subject-cleanup.ts            # dry-run
 *   docker compose exec backend bun run scripts/backfill-chatbox-subject-cleanup.ts --apply    # удаление
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill',
 *   args: ['--apply'], skipBootstrap). Агрегатор на проде запускает с --apply.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

/**
 * Where-фильтр ложных subject-связей: role='subject' И блок имеет evidence
 * с sourceType='chatbox'. Чистая функция — для unit-теста.
 */
export function buildWhere(): Prisma.IdeaBlockEntityWhereInput {
  return {
    role: 'subject',
    block: {
      evidence: {
        some: { sourceType: 'chatbox' },
      },
    },
  };
}

export interface Stats {
  found: number;
  deleted: number;
}

export async function backfillChatboxSubjectCleanup(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<Stats> {
  const stats: Stats = { found: 0, deleted: 0 };
  const where = buildWhere();

  console.log(
    `=== backfill-chatbox-subject-cleanup START (apply=${opts.apply}) ===`,
  );

  if (!opts.apply) {
    const count = await prisma.ideaBlockEntity.count({ where });
    stats.found = count;
    console.log(
      `НАЙДЕНО ${count} ложных chatbox subject-связей (dry-run, не удаляю)`,
    );
  } else {
    const res = await prisma.ideaBlockEntity.deleteMany({ where });
    stats.found = res.count;
    stats.deleted = res.count;
    console.log(`УДАЛЕНО ${res.count} ложных chatbox subject-связей`);
  }

  console.log('=== Итоги backfill-chatbox-subject-cleanup ===');
  console.log(`  found   : ${stats.found}`);
  console.log(`  deleted : ${stats.deleted}`);
  console.log(`  mode    : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);

  return stats;
}

// CLI-враппер.
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  backfillChatboxSubjectCleanup(prisma, { apply })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('backfill-chatbox-subject-cleanup FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
