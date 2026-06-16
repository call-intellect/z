import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { RbacService } from '../../rbac/rbac.service';

import { ChatV2ConversationsService } from './conversations.service';

interface FakeConv {
  id: string;
  tenantId: string;
  userId: string;
  scope: string;
  scopeRefId: string | null;
  status: string;
  pinnedAt: Date | null;
  channelKindOrigin: string | null;
  title: string | null;
  summary: string | null;
  summaryUpdatedAt: Date | null;
  externalSource: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    role: string;
    mode: string | null;
    text: string;
    createdAt: Date;
  }>;
}

function makeService(opts: {
  conv: FakeConv | null;
  cloneV2Enabled?: boolean;
  personAllowed?: boolean;
  roleAllowed?: boolean;
  noRbac?: boolean;
}): {
  svc: ChatV2ConversationsService;
  personCalls: number;
  roleCalls: number;
} {
  const prisma = {
    chatV2Conversation: {
      findUnique: vi.fn(async () => opts.conv),
    },
  } as unknown as PrismaService;
  const llm = {} as unknown as LlmRouterService;
  const cfg = {
    cloneV2: { enabled: opts.cloneV2Enabled ?? false },
  } as unknown as TypedConfigService;
  const metrics = {} as unknown as BusinessMetricsService;

  let personCalls = 0;
  let roleCalls = 0;
  const rbac = opts.noRbac
    ? undefined
    : ({
        canAccessPersonClone: vi.fn(async () => {
          personCalls++;
          return {
            allowed: opts.personAllowed ?? false,
            relation: opts.personAllowed ? 'grant' : 'none',
          };
        }),
        canAccessRoleClone: vi.fn(async () => {
          roleCalls++;
          return {
            allowed: opts.roleAllowed ?? false,
            relation: opts.roleAllowed ? 'grant' : 'none',
          };
        }),
      } as unknown as RbacService);

  const svc = new ChatV2ConversationsService(prisma, llm, cfg, metrics, rbac);
  return {
    svc,
    get personCalls() {
      return personCalls;
    },
    get roleCalls() {
      return roleCalls;
    },
  } as unknown as {
    svc: ChatV2ConversationsService;
    personCalls: number;
    roleCalls: number;
  };
}

function makeConv(over: Partial<FakeConv> = {}): FakeConv {
  return {
    id: 'conv-1',
    tenantId: 't-1',
    userId: 'u-1',
    scope: 'card',
    scopeRefId: 'person-1',
    status: 'active',
    pinnedAt: null,
    channelKindOrigin: null,
    title: null,
    summary: null,
    summaryUpdatedAt: null,
    externalSource: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [
      {
        id: 'm-1',
        role: 'user',
        mode: null,
        text: '?',
        createdAt: new Date(),
      },
      {
        id: 'm-2',
        role: 'assistant',
        mode: 'clone_style',
        text: '!',
        createdAt: new Date(),
      },
    ],
    ...over,
  };
}

describe('ChatV2ConversationsService.getById — Б13 clone-access re-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clone-conversation + grant active → возвращает диалог', async () => {
    const { svc } = makeService({
      conv: makeConv(),
      cloneV2Enabled: true,
      personAllowed: true,
    });
    const conv = await svc.getById({
      tenantId: 't-1',
      userId: 'u-1',
      conversationId: 'conv-1',
    });
    expect(conv.id).toBe('conv-1');
  });

  it('clone-conversation + grant revoked (person+role оба false) → 404', async () => {
    const { svc } = makeService({
      conv: makeConv(),
      cloneV2Enabled: true,
      personAllowed: false,
      roleAllowed: false,
    });
    await expect(
      svc.getById({
        tenantId: 't-1',
        userId: 'u-1',
        conversationId: 'conv-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clone-conversation + person revoked, role active → возвращает диалог (defense-in-depth для role-clone)', async () => {
    const { svc } = makeService({
      conv: makeConv(),
      cloneV2Enabled: true,
      personAllowed: false,
      roleAllowed: true,
    });
    const conv = await svc.getById({
      tenantId: 't-1',
      userId: 'u-1',
      conversationId: 'conv-1',
    });
    expect(conv.id).toBe('conv-1');
  });

  it('обычный card-чат БЕЗ clone_style сообщений → re-check не запускается', async () => {
    const conv = makeConv({
      messages: [
        {
          id: 'm-1',
          role: 'user',
          mode: null,
          text: '?',
          createdAt: new Date(),
        },
        {
          id: 'm-2',
          role: 'assistant',
          mode: 'factual',
          text: '!',
          createdAt: new Date(),
        },
      ],
    });
    const { svc } = makeService({
      conv,
      cloneV2Enabled: true,
      personAllowed: false,
      roleAllowed: false,
    });
    const result = await svc.getById({
      tenantId: 't-1',
      userId: 'u-1',
      conversationId: 'conv-1',
    });
    expect(result.id).toBe('conv-1');
  });

  it('scope=org → re-check не запускается', async () => {
    const conv = makeConv({ scope: 'org', scopeRefId: null });
    const { svc } = makeService({
      conv,
      cloneV2Enabled: true,
      personAllowed: false,
      roleAllowed: false,
    });
    const result = await svc.getById({
      tenantId: 't-1',
      userId: 'u-1',
      conversationId: 'conv-1',
    });
    expect(result.id).toBe('conv-1');
  });

  it('rbac не инжектирован (unit-тест без RbacModule) → re-check skipped, conversation возвращается', async () => {
    const { svc } = makeService({
      conv: makeConv(),
      cloneV2Enabled: true,
      noRbac: true,
    });
    const conv = await svc.getById({
      tenantId: 't-1',
      userId: 'u-1',
      conversationId: 'conv-1',
    });
    expect(conv.id).toBe('conv-1');
  });

  it('conversation чужого юзера → 404 (как было раньше)', async () => {
    const { svc } = makeService({
      conv: makeConv({ userId: 'u-other' }),
      cloneV2Enabled: true,
      personAllowed: true,
    });
    await expect(
      svc.getById({
        tenantId: 't-1',
        userId: 'u-1',
        conversationId: 'conv-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('conversation не найден → 404', async () => {
    const { svc } = makeService({ conv: null });
    await expect(
      svc.getById({
        tenantId: 't-1',
        userId: 'u-1',
        conversationId: 'conv-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
