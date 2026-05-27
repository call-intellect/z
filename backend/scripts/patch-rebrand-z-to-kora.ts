/**
 * Patch (Rebrand Z → Кора) — обновление email-шаблонов в БД.
 *
 * Что делает:
 *   1. Находит записи EmailTemplate с ключами 'register-temp-password' и
 *      'password-reset', в которых тема письма содержит старый бренд «Z».
 *   2. Если запись не редактировалась администратором (updatedBy IS NULL) —
 *      обновляет subject и body из актуальных code-констант (mail.templates.ts).
 *   3. Если updatedBy IS NOT NULL — пропускает и выводит предупреждение:
 *      нужна ручная правка в /admin/content/email-templates.
 *
 * Идемпотентен: повторный запуск находит темы «Кора» и пропускает без изменений.
 *
 * Промпты в таблице PromptTemplate обновляет seed-prompt-templates.ts:
 * у него есть механизм update'а неадминских шаблонов — его достаточно.
 *
 * Запуск:
 *   bun run scripts/patch-rebrand-z-to-kora.ts           — реальное обновление
 *   bun run scripts/patch-rebrand-z-to-kora.ts --dry-run — только проверка
 */

import { createPrismaClient } from './_lib/prisma';
import {
  REGISTER_TEMP_PASSWORD_TEMPLATE,
  PASSWORD_RESET_TEMPLATE,
} from '../src/modules/mail/mail.templates';

const DRY_RUN = process.argv.includes('--dry-run');

interface TargetTemplate {
  key: string;
  newSubject: string;
  newBody: string;
}

const TARGETS: TargetTemplate[] = [
  {
    key: 'register-temp-password',
    newSubject: 'Доступ в Кору',
    newBody: REGISTER_TEMP_PASSWORD_TEMPLATE,
  },
  {
    key: 'password-reset',
    newSubject: 'Сброс пароля Кора',
    newBody: PASSWORD_RESET_TEMPLATE,
  },
];

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  /* eslint-disable no-console */
  try {
    console.log(
      `=== patch-rebrand-z-to-kora START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`,
    );

    let updated = 0;
    let skippedAdminEdited = 0;
    let skippedAlready = 0;
    let notFound = 0;

    for (const target of TARGETS) {
      const row = await prisma.emailTemplate.findUnique({
        where: { key: target.key },
      });

      if (!row) {
        console.log(`[not-found] ${target.key} — не в БД, bootstrap подхватит новые значения из кода`);
        notFound += 1;
        continue;
      }

      // Уже обновлено — пропускаем (идемпотентность).
      if (row.subject === target.newSubject) {
        console.log(`[already-done] ${target.key} — тема уже «${row.subject}»`);
        skippedAlready += 1;
        continue;
      }

      // Если администратор редактировал вручную — не перезаписываем.
      if (row.updatedBy !== null) {
        console.warn(
          `[skip admin-edited] ${target.key} — updatedBy=${row.updatedBy}. ` +
          `Смените тему вручную на «${target.newSubject}» в /admin/content/email-templates`,
        );
        skippedAdminEdited += 1;
        continue;
      }

      console.log(
        `[update] ${target.key}: «${row.subject}» → «${target.newSubject}»`,
      );

      if (!DRY_RUN) {
        await prisma.emailTemplate.update({
          where: { key: target.key },
          data: {
            subject: target.newSubject,
            body: target.newBody,
          },
        });
      }

      updated += 1;
    }

    console.log(
      `Итог: обновлено=${updated}, уже-готово=${skippedAlready}, ` +
      `admin-edited(пропущено)=${skippedAdminEdited}, не-в-БД=${notFound}`,
    );
    if (DRY_RUN) console.log('DRY-RUN: изменения НЕ записаны.');
    console.log('=== patch-rebrand-z-to-kora DONE ===');
  } finally {
    await prisma.$disconnect();
  }
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-rebrand-z-to-kora FAILED:', err);
  process.exit(1);
});
