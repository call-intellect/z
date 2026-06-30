import type { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { ConversationalLinkCodeService } from '../conversational/link-code.service';
import type { DisposableEmailService } from '../mail/disposable-email.service';
import type { MailService } from '../mail/mail.service';
import { OrgInvitationsService } from '../orgs/org-invitations.service';
import type { OrgsService } from '../orgs/orgs.service';
import type { RbacService } from '../rbac/rbac.service';

import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { LoginInvalidError } from './exceptions/accounts-errors';
import { PasswordService } from './password.service';
import type { SessionService } from './session.service';

const cfg = {
  auth: { publicFrontendUrl: 'https://kora.app' },
  invites: {
    botUsername: 'kora_bot',
    ttlDays: 14,
    reminderDays: 7,
    magicLinkTtlMinutes: 15,
    magicLinkRateLimitPerHour: 5,
    inactiveBindingDays: 30,
  },
  argon: { memoryKb: 8, iterations: 1, parallelism: 1 },
  demo: { referenceOrgId: null as string | null },
} as unknown as TypedConfigService;

type Row = Record<string, unknown>;

function makeInMemoryPrisma() {
  const users: Row[] = [];
  const memberships: Row[] = [];
  const invitations: Row[] = [];
  const tokens: Row[] = [];
  const orgs: Row[] = [];
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const orgName = (orgId: unknown) =>
    (orgs.find((o) => o.id === orgId)?.name as string) ?? 'Org';
  const userName = (userId: unknown) =>
    (users.find((u) => u.id === userId)?.name as string) ?? 'Руководитель';

  const prisma = {
    __state: { users, memberships, invitations, tokens, orgs },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
    user: {
      findUnique: async ({ where }: { where: Row }) => {
        if (typeof where.id === 'string') {
          return users.find((u) => u.id === where.id) ?? null;
        }
        const key = where.email_signupSource as { email: string; signupSource: string } | undefined;
        if (key) {
          return (
            users.find((u) => u.email === key.email && u.signupSource === key.signupSource) ?? null
          );
        }
        return null;
      },
      findFirst: async ({ where }: { where: Row }) =>
        users.find(
          (u) =>
            (where.email === undefined || u.email === where.email) &&
            (where.signupSource === undefined || u.signupSource === where.signupSource) &&
            (where.deletedAt === undefined || u.deletedAt === where.deletedAt),
        ) ?? null,
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const key = where.email_signupSource as { email: string; signupSource: string };
        const existing = users.find(
          (u) => u.email === key.email && u.signupSource === key.signupSource,
        );
        if (existing) {
          for (const [k, v] of Object.entries(update)) {
            if (v !== undefined) existing[k] = v;
          }
          return existing;
        }
        const row: Row = {
          id: id('u'),
          createdAt: new Date('2026-06-01'),
          deletedAt: null,
          profileCompletedAt: null,
          role: 'user',
          ...create,
        };
        users.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = users.find((u) => u.id === where.id);
        if (!row) throw new Error('user not found');
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined) row[k] = v;
        }
        return row;
      },
    },
    membership: {
      findUnique: async ({ where }: { where: Row }) => {
        const key = where.orgId_userId as { orgId: string; userId: string } | undefined;
        if (!key) return null;
        return memberships.find((m) => m.orgId === key.orgId && m.userId === key.userId) ?? null;
      },
      findFirst: async ({ where }: { where: Row }) =>
        memberships.find(
          (m) =>
            (where.userId === undefined || m.userId === where.userId) &&
            (where.orgId === undefined || m.orgId === where.orgId),
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: id('mem'), joinedAt: new Date('2026-06-15'), ...data };
        memberships.push(row);
        return row;
      },
    },
    orgInvitation: {
      findFirst: async ({ where }: { where: Row }) =>
        invitations.find(
          (i) =>
            (where.orgId === undefined || i.orgId === where.orgId) &&
            (where.email === undefined || i.email === where.email) &&
            (where.personId === undefined || i.personId === where.personId) &&
            (where.status === undefined || i.status === where.status),
        ) ?? null,
      findUnique: async ({ where }: { where: Row }) =>
        invitations.find(
          (i) =>
            (where.token !== undefined && i.token === where.token) ||
            (where.magicTokenHash !== undefined && i.magicTokenHash === where.magicTokenHash) ||
            (where.id !== undefined && i.id === where.id),
        ) ?? null,
      findMany: async ({ where }: { where: Row }) =>
        invitations.filter(
          (i) =>
            (where.email === undefined || i.email === where.email) &&
            (where.status === undefined || i.status === where.status) &&
            (where.tempPasswordHash === undefined || i.tempPasswordHash != null),
        ),
      create: async ({ data }: { data: Row }) => {
        const row: Row = {
          id: id('inv'),
          createdAt: new Date('2026-06-10'),
          acceptedAt: null,
          magicTokenUsedAt: null,
          ...data,
          org: { id: data.orgId, name: orgName(data.orgId) },
          inviter: { name: userName(data.invitedBy) },
        };
        invitations.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = invitations.find((i) => i.id === where.id);
        if (!row) throw new Error('invitation not found');
        for (const [k, v] of Object.entries(data)) row[k] = v;
        return row;
      },
    },
    userVerificationToken: {
      create: async ({ data }: { data: Row }) => {
        const row: Row = { id: id('tok'), usedAt: null, ...data };
        tokens.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Row }) =>
        tokens.find(
          (t) =>
            (where.tokenHash === undefined || t.tokenHash === where.tokenHash) &&
            (where.purpose === undefined || t.purpose === where.purpose),
        ) ?? null,
      findUnique: async ({ where }: { where: Row }) =>
        tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = tokens.find((t) => t.id === where.id);
        if (!row) throw new Error('token not found');
        for (const [k, v] of Object.entries(data)) row[k] = v;
        return row;
      },
    },
    org: {
      findFirst: async ({ where }: { where: Row }) =>
        orgs.find((o) => (where.ownerId === undefined || o.ownerId === where.ownerId)) ?? null,
      updateMany: async () => ({ count: 1 }),
    },
    person: {
      findUnique: async () => null,
      update: async () => null,
    },
    seedOrg: (orgId: string, name: string, ownerId: string | null) =>
      orgs.push({ id: orgId, name, ownerId, deletedAt: null, teamInvitedAt: null }),
    seedUser: (row: Row) => users.push(row),
  };
  return prisma;
}

describe('Сценарии авторизации (end-to-end через реальные сервисы)', () => {
  let prisma: ReturnType<typeof makeInMemoryPrisma>;
  let passwords: PasswordService;
  let repo: AccountsRepository;
  let accounts: AccountsService;
  let invitations: OrgInvitationsService;
  let mail: {
    sendTempPassword: ReturnType<typeof vi.fn>;
    sendPasswordReset: ReturnType<typeof vi.fn>;
    sendInviteWithCredentials: ReturnType<typeof vi.fn>;
    sendInviteNotification: ReturnType<typeof vi.fn>;
  };

  function lastArg(fn: ReturnType<typeof vi.fn>): Row {
    return fn.mock.calls.at(-1)?.[0] as Row;
  }

  beforeEach(() => {
    prisma = makeInMemoryPrisma();
    passwords = new PasswordService(cfg);
    repo = new AccountsRepository(prisma as unknown as PrismaService);

    mail = {
      sendTempPassword: vi.fn(async () => ({ ok: true })),
      sendPasswordReset: vi.fn(async () => ({ ok: true })),
      sendInviteWithCredentials: vi.fn(async () => ({ ok: true })),
      sendInviteNotification: vi.fn(async () => ({ ok: true })),
    };
    const sessions = {
      issue: vi.fn(async () => ({ session: { id: 's', jti: 'jti' }, token: 'session-token' })),
      revokeAll: vi.fn(async () => 0),
      revokeAllExcept: vi.fn(async () => 0),
      revokeByJti: vi.fn(),
    };
    const metrics = {
      incInviteCreated: vi.fn(),
      incInviteAccepted: vi.fn(),
      incInviteExpired: vi.fn(),
      incMagicLinkRequest: vi.fn(),
      incMagicLinkConsume: vi.fn(),
      incBotLoginCommand: vi.fn(),
    };
    const orgs = {
      createForOwner: vi.fn(async (input: { name: string; ownerId: string }) => {
        const orgId = `org-own-${input.ownerId}`;
        prisma.seedOrg(orgId, input.name, input.ownerId);
        prisma.__state.memberships.push({
          id: `mem-own-${input.ownerId}`,
          orgId,
          userId: input.ownerId,
          role: 'owner',
          joinedAt: new Date('2026-06-01'),
        });
        return { id: orgId, name: input.name };
      }),
    };

    invitations = new OrgInvitationsService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      { loadContext: vi.fn(async () => ({ role: 'owner', isSuperAdmin: false })), invalidate: vi.fn() } as unknown as RbacService,
      cfg,
      { generateInviteCode: vi.fn(async () => ({ code: 'codecodecodecode', ttlSec: 1 })) } as unknown as ConversationalLinkCodeService,
      metrics as unknown as BusinessMetricsService,
      { emit: vi.fn() } as unknown as EventEmitter2,
      passwords,
    );

    accounts = new AccountsService(
      prisma as unknown as PrismaService,
      repo,
      passwords,
      sessions as unknown as SessionService,
      mail as unknown as MailService,
      { isDisposable: () => false } as unknown as DisposableEmailService,
      cfg,
      orgs as unknown as OrgsService,
      { client: { incr: vi.fn(async () => 1), expire: vi.fn(async () => 1) } } as unknown as RedisService,
      metrics as unknown as BusinessMetricsService,
      invitations,
    );
  });

  it('1) Регистрация: temp-пароль → смена на постоянный → вход новым паролем', async () => {
    await accounts.register({
      email: 'Founder@Example.com',
      name: 'Основатель',
      consentDataProcessing: true,
    });

    const tempPassword = (lastArg(mail.sendTempPassword).tempPassword as string) ?? '';
    expect(tempPassword.length).toBeGreaterThanOrEqual(10);

    const afterRegister = await accounts.login({
      email: 'founder@example.com',
      password: tempPassword,
    });
    expect(afterRegister.token).toBe('session-token');
    expect(afterRegister.mustChangePassword).toBe(true);

    await accounts.setInitialPassword({
      userId: afterRegister.user.id,
      newPassword: 'PermanentPass1',
      currentJti: null,
    });

    const afterChange = await accounts.login({
      email: 'founder@example.com',
      password: 'PermanentPass1',
    });
    expect(afterChange.mustChangePassword).toBe(false);

    await expect(
      accounts.login({ email: 'founder@example.com', password: tempPassword }),
    ).rejects.toBeInstanceOf(LoginInvalidError);
  });

  it('2) Восстановление пароля: forgot → reset → вход новым паролем', async () => {
    await accounts.register({
      email: 'lost@example.com',
      name: 'Забывчивый',
      consentDataProcessing: true,
    });
    const tempPassword = lastArg(mail.sendTempPassword).tempPassword as string;

    await accounts.forgotPassword('lost@example.com');
    const resetUrl = lastArg(mail.sendPasswordReset).resetUrl as string;
    const resetToken = resetUrl.split('token=')[1] ?? '';
    expect(resetToken.length).toBeGreaterThan(10);

    await accounts.resetPassword({ token: resetToken, newPassword: 'RecoveredPass1' });

    const loggedIn = await accounts.login({
      email: 'lost@example.com',
      password: 'RecoveredPass1',
    });
    expect(loggedIn.token).toBe('session-token');

    await expect(
      accounts.login({ email: 'lost@example.com', password: tempPassword }),
    ).rejects.toBeInstanceOf(LoginInvalidError);
  });

  it('3) Приглашение НЕзарегистрированного: temp-пароль из письма работает на /login + членство', async () => {
    prisma.seedOrg('org-b', 'ООО Бета', 'director-b');
    prisma.seedUser({
      id: 'director-b',
      email: 'director@beta.com',
      name: 'Директор Бета',
      signupSource: 'standalone',
      passwordHash: await passwords.hash('dirpass'),
      mustChangePassword: false,
      role: 'user',
      deletedAt: null,
      createdAt: new Date('2026-06-01'),
      profileCompletedAt: null,
    });

    await invitations.createInvitation({
      orgId: 'org-b',
      actorUserId: 'director-b',
      email: 'Newbie@Example.com',
      role: 'manager',
    });

    expect(mail.sendInviteWithCredentials).toHaveBeenCalledTimes(1);
    expect(mail.sendInviteNotification).not.toHaveBeenCalled();
    const tempPassword = lastArg(mail.sendInviteWithCredentials).tempPassword as string;
    expect(tempPassword.length).toBeGreaterThanOrEqual(20);

    expect(
      prisma.__state.users.find((u) => u.email === 'newbie@example.com'),
    ).toBeUndefined();

    const loggedIn = await accounts.login({
      email: 'newbie@example.com',
      password: tempPassword,
    });
    expect(loggedIn.token).toBe('session-token');
    expect(loggedIn.mustChangePassword).toBe(true);

    const newUser = prisma.__state.users.find((u) => u.email === 'newbie@example.com');
    expect(newUser).toBeDefined();
    expect(
      prisma.__state.memberships.some(
        (m) => m.userId === newUser?.id && m.orgId === 'org-b',
      ),
    ).toBe(true);
    expect(prisma.__state.invitations[0]?.status).toBe('accepted');

    await accounts.setInitialPassword({
      userId: newUser?.id as string,
      newPassword: 'MyOwnPass1',
      currentJti: null,
    });
    const afterChange = await accounts.login({
      email: 'newbie@example.com',
      password: 'MyOwnPass1',
    });
    expect(afterChange.mustChangePassword).toBe(false);
  });

  it('4) Приглашение ЗАрегистрированного в другую компанию: пароль НЕ меняется, вступает в обе', async () => {
    await accounts.register({
      email: 'multi@example.com',
      name: 'Мультиюзер',
      consentDataProcessing: true,
    });
    const existing = prisma.__state.users.find((u) => u.email === 'multi@example.com');
    await accounts.setInitialPassword({
      userId: existing?.id as string,
      newPassword: 'KeepThisPass1',
      currentJti: null,
    });
    const ownOrgId = `org-own-${existing?.id}`;
    const passwordHashBefore = existing?.passwordHash;

    prisma.seedOrg('org-b', 'ООО Бета', 'director-b');
    prisma.seedUser({
      id: 'director-b',
      email: 'director@beta.com',
      name: 'Директор Бета',
      signupSource: 'standalone',
      passwordHash: await passwords.hash('dirpass'),
      mustChangePassword: false,
      role: 'user',
      deletedAt: null,
      createdAt: new Date('2026-06-01'),
      profileCompletedAt: null,
    });

    const invite = await invitations.createInvitation({
      orgId: 'org-b',
      actorUserId: 'director-b',
      email: 'multi@example.com',
      role: 'manager',
    });

    expect(mail.sendInviteNotification).toHaveBeenCalledTimes(1);
    expect(mail.sendInviteWithCredentials).not.toHaveBeenCalled();
    const storedInvite = prisma.__state.invitations.find((i) => i.email === 'multi@example.com');
    expect(storedInvite?.tempPasswordHash).toBeNull();

    const magicToken = invite.magicLinkUrl.split('/invite/')[1] ?? '';
    await accounts.acceptInvitationMagicLink({ magicToken });

    const after = prisma.__state.users.find((u) => u.email === 'multi@example.com');
    expect(after?.passwordHash).toBe(passwordHashBefore);

    const orgIds = prisma.__state.memberships
      .filter((m) => m.userId === existing?.id)
      .map((m) => m.orgId);
    expect(orgIds).toContain(ownOrgId);
    expect(orgIds).toContain('org-b');

    const loggedIn = await accounts.login({
      email: 'multi@example.com',
      password: 'KeepThisPass1',
    });
    expect(loggedIn.token).toBe('session-token');
  });
});
