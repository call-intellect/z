import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import { JwtService } from '../../auth/services/jwt.service';

import { ExternalGuestGuard } from './external-guest.guard';

function makeJwt(): JwtService {
  const cfg = {
    auth: { sessionSecret: 'test-secret-test-secret-test-secret' },
  } as unknown as TypedConfigService;
  return new JwtService(cfg);
}

function ctxFor(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtService external-guest session', () => {
  it('sign/verify сохраняет scope (userId/conversationId/accessLinkId)', () => {
    const jwt = makeJwt();
    const token = jwt.signExternalGuestSession({
      userId: 'u1',
      conversationId: 'conv-1',
      accessLinkId: 'link-1',
    });
    const payload = jwt.verifyExternalGuestSession(token);
    expect(payload.userId).toBe('u1');
    expect(payload.conversationId).toBe('conv-1');
    expect(payload.accessLinkId).toBe('link-1');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('ExternalGuestGuard', () => {
  it('Bearer-токен своего conversationId → allow + request.externalGuest', () => {
    const jwt = makeJwt();
    const token = jwt.signExternalGuestSession({
      userId: 'u1',
      conversationId: 'conv-1',
      accessLinkId: 'link-1',
    });
    const guard = new ExternalGuestGuard(jwt);
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      params: { id: 'conv-1' },
    };
    expect(guard.canActivate(ctxFor(request))).toBe(true);
    expect(request['externalGuest']).toMatchObject({ userId: 'u1', conversationId: 'conv-1' });
  });

  it('токен ЧУЖОГО conversationId → 403 NOT_MEMBER', () => {
    const jwt = makeJwt();
    const token = jwt.signExternalGuestSession({
      userId: 'u1',
      conversationId: 'conv-OTHER',
      accessLinkId: 'link-1',
    });
    const guard = new ExternalGuestGuard(jwt);
    const request = {
      headers: { authorization: `Bearer ${token}` },
      params: { id: 'conv-1' },
    };
    expect(() => guard.canActivate(ctxFor(request))).toThrow(ForbiddenException);
  });

  it('без токена → 403 NOT_MEMBER', () => {
    const guard = new ExternalGuestGuard(makeJwt());
    const request = { headers: {}, params: { id: 'conv-1' } };
    expect(() => guard.canActivate(ctxFor(request))).toThrow(ForbiddenException);
  });
});
