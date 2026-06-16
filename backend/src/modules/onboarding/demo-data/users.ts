import type { SeedFn } from './types';

export const USER_DEFS = [
  {
    key: 'morozov',
    email: 'morozov@technostream.io',
    name: 'Алексей Морозов',
    companyRole: 'founder',
  },
  {
    key: 'volkova',
    email: 'volkova@technostream.io',
    name: 'Марина Волкова',
    companyRole: 'operations_director',
  },
  {
    key: 'kozlov',
    email: 'kozlov@technostream.io',
    name: 'Дмитрий Козлов',
    companyRole: 'team_lead',
  },
  {
    key: 'sokolova',
    email: 'sokolova@technostream.io',
    name: 'Екатерина Соколова',
    companyRole: 'team_lead',
  },
  {
    key: 'petrova',
    email: 'petrova@technostream.io',
    name: 'Анна Петрова',
    companyRole: 'specialist',
  },
] as const;

export const seedUsers: SeedFn = async (ctx, ids) => {
  const { prisma, tenantId } = ctx;

  const createdIds: string[] = [];
  for (const u of USER_DEFS) {
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
