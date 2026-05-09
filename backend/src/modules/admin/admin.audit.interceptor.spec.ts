import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { AdminAuditInterceptor } from './admin.audit.interceptor';

function makeContext(opts: {
  method: string;
  originalUrl: string;
  user?: { id: string; email: string; role: 'user' | 'admin' };
  body?: unknown;
  params?: Record<string, string>;
}): ExecutionContext {
  const req = {
    method: opts.method,
    originalUrl: opts.originalUrl,
    user: opts.user,
    body: opts.body,
    params: opts.params ?? {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function makeNext(responseBody: unknown): CallHandler {
  return { handle: () => of(responseBody) };
}

function makePrismaWithCreate(): {
  prisma: PrismaService;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => ({}));
  const prisma = {
    adminAuditLog: { create },
  } as unknown as PrismaService;
  return { prisma, create };
}

describe('AdminAuditInterceptor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET — не пишет в аудит', async () => {
    const { prisma, create } = makePrismaWithCreate();
    const interceptor = new AdminAuditInterceptor(prisma);

    const ctx = makeContext({
      method: 'GET',
      originalUrl: '/admin/api/v1/integration-keys',
      user: { id: 'admin-1', email: 'a@z.app', role: 'admin' },
    });
    await firstValueFrom(interceptor.intercept(ctx, makeNext({ items: [] })));
    // Дать time для async fire-and-forget — ничего не должно произойти.
    await new Promise((r) => setTimeout(r, 10));

    expect(create).not.toHaveBeenCalled();
  });

  it('POST /integration-keys — пишет create_integration_key с маскированием key', async () => {
    const { prisma, create } = makePrismaWithCreate();
    const interceptor = new AdminAuditInterceptor(prisma);

    const ctx = makeContext({
      method: 'POST',
      originalUrl: '/admin/api/v1/integration-keys',
      user: { id: 'admin-1', email: 'a@z.app', role: 'admin' },
      body: { partner_name: 'acme' },
    });
    await firstValueFrom(
      interceptor.intercept(ctx, makeNext({ id: 'ik-123', key: 'plain-secret-xxxxxxxx' })),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as {
      data: { actorId: string; action: string; targetType: string; targetId: string; payload: unknown };
    };
    expect(arg.data.actorId).toBe('admin-1');
    expect(arg.data.action).toBe('create_integration_key');
    expect(arg.data.targetType).toBe('IntegrationKey');
    // targetId должен взяться из ответа (id), потому что в params его нет.
    expect(arg.data.targetId).toBe('ik-123');
    expect(arg.data.payload).toEqual({ partner_name: 'acme' });
  });

  it('DELETE /integration-keys/:id — пишет revoke_integration_key', async () => {
    const { prisma, create } = makePrismaWithCreate();
    const interceptor = new AdminAuditInterceptor(prisma);

    const ctx = makeContext({
      method: 'DELETE',
      originalUrl: '/admin/api/v1/integration-keys/ik-77',
      user: { id: 'admin-2', email: 'a@z.app', role: 'admin' },
      params: { id: 'ik-77' },
    });
    await firstValueFrom(interceptor.intercept(ctx, makeNext({ ok: true })));
    await new Promise((r) => setTimeout(r, 10));

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as {
      data: { action: string; targetType: string; targetId: string };
    };
    expect(arg.data.action).toBe('revoke_integration_key');
    expect(arg.data.targetType).toBe('IntegrationKey');
    expect(arg.data.targetId).toBe('ik-77');
  });

  it('POST /meetings/:id/force-finish — пишет force_finish_meeting', async () => {
    const { prisma, create } = makePrismaWithCreate();
    const interceptor = new AdminAuditInterceptor(prisma);

    const ctx = makeContext({
      method: 'POST',
      originalUrl: '/admin/api/v1/meetings/m-7/force-finish',
      user: { id: 'admin-1', email: 'a@z.app', role: 'admin' },
      params: { id: 'm-7' },
    });
    await firstValueFrom(interceptor.intercept(ctx, makeNext({ ok: true })));
    await new Promise((r) => setTimeout(r, 10));

    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0] as {
      data: { action: string; targetType: string; targetId: string };
    };
    expect(arg.data.action).toBe('force_finish_meeting');
    expect(arg.data.targetType).toBe('Meeting');
    expect(arg.data.targetId).toBe('m-7');
  });

  it('маскирует password/passwordHash в payload', async () => {
    const { prisma, create } = makePrismaWithCreate();
    const interceptor = new AdminAuditInterceptor(prisma);

    const ctx = makeContext({
      method: 'POST',
      originalUrl: '/admin/api/v1/integration-keys',
      user: { id: 'admin-1', email: 'a@z.app', role: 'admin' },
      body: { partner_name: 'acme', password: 'super-secret', nested: { key: 'should-be-masked' } },
    });
    await firstValueFrom(
      interceptor.intercept(ctx, makeNext({ id: 'ik-1', key: 'plain' })),
    );
    await new Promise((r) => setTimeout(r, 10));

    const arg = create.mock.calls[0]![0] as { data: { payload: unknown } };
    expect(arg.data.payload).toEqual({
      partner_name: 'acme',
      password: '***',
      nested: { key: '***' },
    });
  });

  it('без user.id — не пишет в аудит', async () => {
    const { prisma, create } = makePrismaWithCreate();
    const interceptor = new AdminAuditInterceptor(prisma);

    const ctx = makeContext({
      method: 'POST',
      originalUrl: '/admin/api/v1/integration-keys',
      body: { partner_name: 'acme' },
    });
    await firstValueFrom(
      interceptor.intercept(ctx, makeNext({ id: 'ik-1', key: 'plain' })),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(create).not.toHaveBeenCalled();
  });

  it('неклассифицируемый маршрут — не пишет', async () => {
    const { prisma, create } = makePrismaWithCreate();
    const interceptor = new AdminAuditInterceptor(prisma);

    const ctx = makeContext({
      method: 'POST',
      originalUrl: '/admin/api/v1/something-else',
      user: { id: 'admin-1', email: 'a@z.app', role: 'admin' },
    });
    await firstValueFrom(interceptor.intercept(ctx, makeNext({ ok: true })));
    await new Promise((r) => setTimeout(r, 10));

    expect(create).not.toHaveBeenCalled();
  });
});
