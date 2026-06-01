/**
 * Демо-данные «ТехноСтрим» — 5 User-аккаунтов для ключевых сотрудников.
 *
 * Без User'ов нельзя создать HelpfulnessTrait / HelpfulnessSpotlight /
 * SocialContributionProfile / ContributionSnapshot (ссылаются на User.id,
 * не Person.id).
 *
 * Безопасность:
 *  - `passwordHash: null` — нельзя залогиниться паролем (admin-login.service.ts:48
 *    отказывает при null).
 *  - magic-link сценарий: пользователь должен иметь доступ к ящику
 *    `*@technostream.io` — домен внешний, доставки нет.
 *  - Идентификаторы хранятся в `Org.demoUserIds` — `resetDemoWorkspace`
 *    при сбросе чистит ровно их (не задевает реальные User'ы).
 *
 * UNIQUE-policy: `User.email` сам по себе не unique, но `(email, signupSource)`
 * — есть. Используем `signupSource = 'standalone'`, чтобы не конфликтовать
 * с реальной OAuth-регистрацией (`crossmark`).
 */
import type { SeedFn } from './types';

export const USER_DEFS = [
  { key: 'morozov',  email: 'morozov@technostream.io',  name: 'Алексей Морозов',    companyRole: 'founder' },
  { key: 'volkova',  email: 'volkova@technostream.io',  name: 'Марина Волкова',     companyRole: 'operations_director' },
  { key: 'kozlov',   email: 'kozlov@technostream.io',   name: 'Дмитрий Козлов',     companyRole: 'team_lead' },
  { key: 'sokolova', email: 'sokolova@technostream.io', name: 'Екатерина Соколова', companyRole: 'team_lead' },
  { key: 'petrova',  email: 'petrova@technostream.io',  name: 'Анна Петрова',       companyRole: 'specialist' },
] as const;

export const seedUsers: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const createdIds: string[] = [];
  for (const u of USER_DEFS) {
    // email ОБЯЗАН быть org-scoped: constraint `(email, signupSource)` уникален,
    // а демо-юзеры одинаковы для всех Org. Без суффикса tenantId вторая Org,
    // заливающая демо, падала бы на дубле email (регрессия мержа #7 —
    // глобально-фиксированные технострим-email ломали multi-org demo-seed).
    // `+`-subaddress сохраняет читаемый префикс, домен всё равно внешний.
    const [local, domain] = u.email.split('@');
    const orgScopedEmail = `${local}+${tenantId}@${domain}`;
    const user = await prisma.user.create({
      data: {
        email: orgScopedEmail,
        name: u.name,
        passwordHash: null,
        signupSource: 'standalone',
        companyRole: u.companyRole,
      },
    });
    ids.users[u.key] = user.id;
    createdIds.push(user.id);
  }

  await prisma.org.update({
    where: { id: tenantId },
    data: { demoUserIds: { set: createdIds } },
  });

  console.log(
    `[demo/users] Создано ${createdIds.length} User-аккаунтов (passwordHash=null), ` +
    `записано в Org.demoUserIds.`,
  );
};
