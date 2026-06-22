import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RbacService } from '../../rbac/rbac.service';

import type { ServiceMapGeneratorService, ToolSchema } from './service-map-generator.service';
import { ToolRouterService } from './tool-router.service';

const TEST_SECRET = 'test-session-secret';
const LOOPBACK_BASE_URL = 'http://127.0.0.1:3000';

const TOOL: ToolSchema = {
  name: 'search_meetings',
  description: 'Поиск встреч',
  method: 'GET',
  path: '/api/v1/meetings/search',
  parameters: { type: 'object', properties: {}, required: [] },
  rbacResource: 'meetings',
  rbacAction: 'read',
};

interface BuildOverrides {
  rbacAllowed?: boolean;
  user?: { email: string; role: 'user' | 'admin'; deletedAt: Date | null } | null;
  fetchResponse?: { status: number; body: unknown };
}

function buildService(overrides: BuildOverrides = {}) {
  const serviceMap = { findTool: vi.fn().mockReturnValue(TOOL) };
  const rbac = {
    check: vi.fn().mockResolvedValue(overrides.rbacAllowed ?? true),
  };
  const prisma = {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          overrides.user === undefined
            ? { email: 'user@example.com', role: 'user', deletedAt: null }
            : overrides.user,
        ),
    },
  };
  const metrics = { incConciergeToolCall: vi.fn() };
  const cfg = {
    auth: { sessionSecret: TEST_SECRET },
    concierge: { loopbackBaseUrl: LOOPBACK_BASE_URL },
  };

  const fetchResponse = overrides.fetchResponse ?? {
    status: 200,
    body: { items: [{ id: 'm1' }] },
  };
  const fetchMock = vi.fn().mockResolvedValue({
    status: fetchResponse.status,
    text: () => Promise.resolve(JSON.stringify(fetchResponse.body)),
  });
  vi.stubGlobal('fetch', fetchMock);

  const svc = new ToolRouterService(
    serviceMap as unknown as ServiceMapGeneratorService,
    rbac as unknown as RbacService,
    prisma as unknown as PrismaService,
    metrics as unknown as BusinessMetricsService,
    cfg as unknown as TypedConfigService,
  );

  return { svc, serviceMap, rbac, prisma, metrics, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ToolRouterService — service-режим (Ф4)', () => {
  it('happy-path: RBAC от userId, Cookie = self-signed z_session (sub/email/role, без jti, TTL 60с), baseUrl из конфига', async () => {
    const { svc, rbac, fetchMock } = buildService();

    const out = await svc.execute({
      toolName: 'search_meetings',
      args: {},
      userId: 'user-1',
      tenantId: 'org-1',
      authMode: 'service',
    });

    expect(rbac.check).toHaveBeenCalledTimes(1);
    expect(rbac.check).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'org-1',
      obj: 'meetings',
      act: 'read',
      resourceOwnerId: 'user-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url.startsWith(`${LOOPBACK_BASE_URL}/api/v1/meetings/search`)).toBe(true);
    expect(init.headers['X-Org-Id']).toBe('org-1');
    expect(init.headers['X-Concierge-Origin']).toBe('true');

    const cookie = init.headers.Cookie ?? '';
    expect(cookie.startsWith('z_session=')).toBe(true);
    const token = cookie.slice('z_session='.length);
    const payload = jwt.verify(token, TEST_SECRET, {
      algorithms: ['HS256'],
      issuer: 'z',
      audience: 'z',
    }) as jwt.JwtPayload;
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('user@example.com');
    expect(payload.role).toBe('user');
    expect(payload.jti).toBeUndefined();
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);

    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.result).toEqual({ items: [{ id: 'm1' }] });
  });

  it('rbac.check=false → {ok:false, status:403}, fetch НЕ вызван, минт НЕ выполнялся', async () => {
    const { svc, prisma, fetchMock } = buildService({ rbacAllowed: false });

    const out = await svc.execute({
      toolName: 'search_meetings',
      args: {},
      userId: 'user-1',
      tenantId: 'org-1',
      authMode: 'service',
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('user не найден / soft-deleted → {ok:false, status:403}, fetch НЕ вызван', async () => {
    const { svc, fetchMock } = buildService({ user: null });

    const out = await svc.execute({
      toolName: 'search_meetings',
      args: {},
      userId: 'ghost-user',
      tenantId: 'org-1',
      authMode: 'service',
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.errorMessage).toContain('не найден');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ToolRouterService — новые инструменты помощника (ТЗ 2026-06-14)', () => {
  const POST_TASK: ToolSchema = {
    name: 'create_task',
    description: 'Поставить задачу себе',
    method: 'POST',
    path: '/api/v1/me/tasks',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        dueDate: { type: 'string' },
      },
      required: ['title'],
    },
    rbacResource: 'issue',
    rbacAction: 'write',
  };

  const FREE_NOTE: ToolSchema = {
    name: 'ingest_note',
    description: 'Занести заметку в память',
    method: 'POST',
    path: '/api/v1/me/notifications/free-note',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    readOnly: true,
  };

  function buildWith(tool: ToolSchema, overrides: BuildOverrides = {}) {
    const serviceMap = { findTool: vi.fn().mockReturnValue(tool) };
    const rbac = {
      check: vi.fn().mockResolvedValue(overrides.rbacAllowed ?? true),
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'u@e.com', role: 'user', deletedAt: null }),
      },
    };
    const metrics = { incConciergeToolCall: vi.fn() };
    const cfg = {
      auth: { sessionSecret: TEST_SECRET },
      concierge: { loopbackBaseUrl: LOOPBACK_BASE_URL },
    };
    const fetchResponse = overrides.fetchResponse ?? {
      status: 201,
      body: { id: 'task-1' },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: fetchResponse.status,
      text: () => Promise.resolve(JSON.stringify(fetchResponse.body)),
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ToolRouterService(
      serviceMap as unknown as ServiceMapGeneratorService,
      rbac as unknown as RbacService,
      prisma as unknown as PrismaService,
      metrics as unknown as BusinessMetricsService,
      cfg as unknown as TypedConfigService,
    );
    return { svc, rbac, fetchMock };
  }

  it('create_task: POST /me/tasks, RBAC issue/write, body несёт title', async () => {
    const { svc, rbac, fetchMock } = buildWith(POST_TASK);
    const out = await svc.execute({
      toolName: 'create_task',
      args: { title: 'Подготовить отчёт' },
      userId: 'u-1',
      tenantId: 'org-1',
      authCookie: 'z_session=c',
      baseUrl: 'http://localhost:3000',
    });
    expect(rbac.check).toHaveBeenCalledWith({
      userId: 'u-1',
      tenantId: 'org-1',
      obj: 'issue',
      act: 'write',
      resourceOwnerId: 'u-1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body?: string }];
    expect(url).toBe('http://localhost:3000/api/v1/me/tasks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body ?? '{}')).toEqual({ title: 'Подготовить отчёт' });
    expect(out.ok).toBe(true);
  });

  it('create_task: без title → 400 ДО RBAC/fetch (валидация required)', async () => {
    const { svc, rbac, fetchMock } = buildWith(POST_TASK);
    const out = await svc.execute({
      toolName: 'create_task',
      args: {},
      userId: 'u-1',
      tenantId: 'org-1',
      authCookie: 'z_session=c',
      baseUrl: 'http://localhost:3000',
    });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(rbac.check).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ingest_note: без rbacResource → RBAC.check НЕ вызывается, fetch на free-note', async () => {
    const { svc, rbac, fetchMock } = buildWith(FREE_NOTE, {
      fetchResponse: { status: 201, body: { rawEventId: 're-1' } },
    });
    const out = await svc.execute({
      toolName: 'ingest_note',
      args: { text: 'Идея про поддержку' },
      userId: 'u-1',
      tenantId: 'org-1',
      authCookie: 'z_session=c',
      baseUrl: 'http://localhost:3000',
    });
    expect(rbac.check).not.toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3000/api/v1/me/notifications/free-note');
    expect(out.ok).toBe(true);
  });
});

describe('ToolRouterService — self-scope RBAC (QA-fix Ф1: ask_chat_v2 не 403)', () => {
  const ASK_CHAT_V2: ToolSchema = {
    name: 'ask_chat_v2',
    description: 'Спросить AI-чат компании',
    method: 'POST',
    path: '/api/v1/chat-v2/messages',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
    rbacResource: 'chat_v2_conversation',
    rbacAction: 'write',
  };

  function buildSelfScoped() {
    const serviceMap = { findTool: vi.fn().mockReturnValue(ASK_CHAT_V2) };
    const rbac = {
      check: vi.fn(
        (args: { userId: string; resourceOwnerId?: string }) =>
          Promise.resolve(args.resourceOwnerId === args.userId),
      ),
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'u@e.com', role: 'owner', deletedAt: null }),
      },
    };
    const metrics = { incConciergeToolCall: vi.fn() };
    const cfg = {
      auth: { sessionSecret: TEST_SECRET },
      concierge: { loopbackBaseUrl: LOOPBACK_BASE_URL },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ text: 'ответ', citations: [] })),
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ToolRouterService(
      serviceMap as unknown as ServiceMapGeneratorService,
      rbac as unknown as RbacService,
      prisma as unknown as PrismaService,
      metrics as unknown as BusinessMetricsService,
      cfg as unknown as TypedConfigService,
    );
    return { svc, rbac, fetchMock };
  }

  it('rbac.check пропускает только при resourceOwnerId===userId → 200, доходит до loopback (без правки был бы 403)', async () => {
    const { svc, rbac, fetchMock } = buildSelfScoped();
    const out = await svc.execute({
      toolName: 'ask_chat_v2',
      args: { question: 'Какие задачи висят?' },
      userId: 'owner-1',
      tenantId: 'org-1',
      authCookie: 'z_session=c',
      baseUrl: 'http://localhost:3000',
    });
    expect(rbac.check).toHaveBeenCalledWith(
      expect.objectContaining({ resourceOwnerId: 'owner-1', userId: 'owner-1' }),
    );
    expect(out.status).not.toBe(403);
    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ToolRouterService — cookie-режим (поведение до Ф4 не изменилось)', () => {
  it('без authMode: Cookie = input.authCookie бит-в-бит, jwt-подпись НЕ вызвана', async () => {
    const { svc, prisma, fetchMock } = buildService();
    const signSpy = vi.spyOn(jwt, 'sign');

    const out = await svc.execute({
      toolName: 'search_meetings',
      args: {},
      userId: 'user-1',
      tenantId: 'org-1',
      authCookie: 'z_session=original-web-cookie',
      baseUrl: 'http://localhost:3000',
    });

    expect(out.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Cookie).toBe('z_session=original-web-cookie');
    expect(url.startsWith('http://localhost:3000/')).toBe(true);
    expect(signSpy).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("явный authMode:'cookie' — то же прежнее поведение", async () => {
    const { svc, prisma, fetchMock } = buildService();

    await svc.execute({
      toolName: 'search_meetings',
      args: {},
      userId: 'user-1',
      tenantId: 'org-1',
      authMode: 'cookie',
      authCookie: 'z_session=abc',
      baseUrl: 'http://localhost:3000',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Cookie).toBe('z_session=abc');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
