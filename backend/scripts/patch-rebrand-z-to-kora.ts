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
    console.log(`=== patch-rebrand-z-to-kora START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`);

    let updated = 0;
    let skippedAdminEdited = 0;
    let skippedAlready = 0;
    let notFound = 0;

    for (const target of TARGETS) {
      const row = await prisma.emailTemplate.findUnique({
        where: { key: target.key },
      });

      if (!row) {
        console.log(
          `[not-found] ${target.key} — не в БД, bootstrap подхватит новые значения из кода`,
        );
        notFound += 1;
        continue;
      }

      const subjectMatches = row.subject === target.newSubject;
      const bodyMatches = row.body === target.newBody;
      if (subjectMatches && bodyMatches) {
        console.log(`[already-done] ${target.key} — тема и тело уже совпадают с code-константой`);
        skippedAlready += 1;
        continue;
      }

      if (row.updatedBy !== null) {
        console.warn(
          `[skip admin-edited] ${target.key} — updatedBy=${row.updatedBy}. ` +
            `Смените тему вручную на «${target.newSubject}» в /admin/content/email-templates`,
        );
        skippedAdminEdited += 1;
        continue;
      }

      const updates: string[] = [];
      if (!subjectMatches) updates.push(`subject «${row.subject}» → «${target.newSubject}»`);
      if (!bodyMatches) updates.push('body (mail.templates.ts)');
      console.log(`[update] ${target.key}: ${updates.join(', ')}`);

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
