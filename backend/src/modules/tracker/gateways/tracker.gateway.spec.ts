import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtService } from '../../auth/services/jwt.service';
import type { RbacService } from '../../rbac/rbac.service';

import { TrackerGateway } from './tracker.gateway';

/**
 * T8 (2026-05-24) — unit-тесты presence/typing handler'ов TrackerGateway.
 *
 * Не поднимаем реальный socket.io; используем моки socket + map контекста
 * gateway'а. Покрытие:
 *   1. issue.chat.join — 404 на чужой issue, join + broadcast user_joined.
 *   2. issue.chat.join — повторный join тем же сокетом не дублирует broadcast.
 *   3. issue.chat.leave — broadcast user_left только для последнего сокета юзера.
 *   4. issue.chat.typing — relay в room только если сокет в presence-room.
 *   5. issue.chat.presence — снимок уникален по userId.
 */

type MockSocket = {
  id: string;
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  to: ReturnType<typeof vi.fn>;
};

function makeSocket(id: string): MockSocket & { _toCalls: string[] } {
  const emit = vi.fn();
  const toCalls: string[] = [];
  const to = vi.fn((room: string) => {
    toCalls.push(room);
    return { emit };
  });
  const s = {
    id,
    join: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    to,
    _emit: emit,
    _toCalls: toCalls,
  };
  return s as unknown as MockSocket & { _toCalls: string[]; _emit: typeof emit };
}

function makeGateway(opts: {
  issueExists?: boolean;
}): {
  gw: TrackerGateway;
  setCtx: (
    socketId: string,
    userId: string,
    displayName: string,
    tenantId?: string,
  ) => void;
} {
  const prisma = {
    issue: {
      findFirst: vi.fn(async () =>
        opts.issueExists === false ? null : { id: 'i1' },
      ),
    },
  } as unknown as PrismaService;
  const jwt = {} as JwtService;
  const cfg = {} as TypedConfigService;
  // audit В12: RBAC mock — по умолчанию canRead=true (тесты T8 про
  // presence/typing, не про RBAC subscribe.*).
  const rbac = {
    canRead: vi.fn(async () => true),
  } as unknown as RbacService;
  const gw = new TrackerGateway(jwt, prisma, cfg, rbac);
  // Подсунем минимальный server (для emitToRooms он не используется в наших
  // handler'ах, broadcast идёт через client.to(...).emit).
  (gw as unknown as { server: { to: ReturnType<typeof vi.fn> } }).server = {
    to: vi.fn(),
  };

  const setCtx = (
    socketId: string,
    userId: string,
    displayName: string,
    tenantId = 'tenant-1',
  ): void => {
    // socketContext — private; через any для теста.
    (gw as any).socketContext.set(socketId, {
      userId,
      email: `${userId}@example.com`,
      tenantId,
      displayName,
      presenceIssueIds: new Set<string>(),
    });
  };

  return { gw, setCtx };
}

describe('TrackerGateway: chat presence/typing', () => {
  let socketA: ReturnType<typeof makeSocket>;
  let socketB: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    socketA = makeSocket('sock-a');
    socketB = makeSocket('sock-b');
  });

  it('issue.chat.join — 404 если issue в другом tenant\'е', async () => {
    const { gw, setCtx } = makeGateway({ issueExists: false });
    setCtx(socketA.id, 'user-1', 'Анна');
    const res = await gw.onChatJoin(socketA as never, { issueId: 'i-unknown' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('issue_not_found');
  });

  it('issue.chat.join — успешный join + broadcast user_joined', async () => {
    const { gw, setCtx } = makeGateway({ issueExists: true });
    setCtx(socketA.id, 'user-1', 'Анна');
    const res = await gw.onChatJoin(socketA as never, { issueId: 'i1' });
    expect(res.ok).toBe(true);
    expect(res.onlineUsers).toHaveLength(1);
    expect(res.onlineUsers![0]).toEqual({ userId: 'user-1', displayName: 'Анна' });
    expect(socketA.join).toHaveBeenCalledWith('presence:issue:i1');
    expect(socketA.to).toHaveBeenCalledWith('presence:issue:i1');
  });

  it('повторный join тем же сокетом не дублирует broadcast', async () => {
    const { gw, setCtx } = makeGateway({ issueExists: true });
    setCtx(socketA.id, 'user-1', 'Анна');
    await gw.onChatJoin(socketA as never, { issueId: 'i1' });
    socketA.to.mockClear();
    const res = await gw.onChatJoin(socketA as never, { issueId: 'i1' });
    expect(res.ok).toBe(true);
    // .to() не дёргается — broadcast пропущен из-за wasAlreadyIn.
    expect(socketA.to).not.toHaveBeenCalled();
  });

  it('issue.chat.leave — broadcast user_left только для последнего сокета юзера', async () => {
    const { gw, setCtx } = makeGateway({ issueExists: true });
    setCtx(socketA.id, 'user-1', 'Анна');
    setCtx(socketB.id, 'user-1', 'Анна');
    await gw.onChatJoin(socketA as never, { issueId: 'i1' });
    await gw.onChatJoin(socketB as never, { issueId: 'i1' });
    socketA.to.mockClear();
    socketB.to.mockClear();

    // Закрытие socketA: остаётся socketB — broadcast НЕ должен случиться.
    await gw.onChatLeave(socketA as never, { issueId: 'i1' });
    expect(socketA.to).not.toHaveBeenCalled();

    // Закрытие socketB: больше сокетов нет — broadcast user_left должен пойти.
    await gw.onChatLeave(socketB as never, { issueId: 'i1' });
    expect(socketB.to).toHaveBeenCalledWith('presence:issue:i1');
  });

  it('issue.chat.typing — relay только если сокет в presence-room', async () => {
    const { gw, setCtx } = makeGateway({ issueExists: true });
    setCtx(socketA.id, 'user-1', 'Анна');

    // Без join — typing должен быть отброшен.
    const denied = gw.onChatTyping(socketA as never, {
      issueId: 'i1',
      isTyping: true,
    });
    expect(denied.ok).toBe(false);
    expect(socketA.to).not.toHaveBeenCalled();

    // С join — relay срабатывает.
    await gw.onChatJoin(socketA as never, { issueId: 'i1' });
    socketA.to.mockClear();
    const ok = gw.onChatTyping(socketA as never, {
      issueId: 'i1',
      isTyping: true,
    });
    expect(ok.ok).toBe(true);
    expect(socketA.to).toHaveBeenCalledWith('presence:issue:i1');
  });

  it('issue.chat.presence — unique по userId (две вкладки одного юзера = один в списке)', async () => {
    const { gw, setCtx } = makeGateway({ issueExists: true });
    setCtx(socketA.id, 'user-1', 'Анна');
    setCtx(socketB.id, 'user-1', 'Анна');
    await gw.onChatJoin(socketA as never, { issueId: 'i1' });
    await gw.onChatJoin(socketB as never, { issueId: 'i1' });

    const res = gw.onChatPresence(socketA as never, { issueId: 'i1' });
    expect(res.ok).toBe(true);
    expect(res.onlineUsers).toHaveLength(1);
    expect(res.onlineUsers[0]).toEqual({
      userId: 'user-1',
      displayName: 'Анна',
    });
  });
});
