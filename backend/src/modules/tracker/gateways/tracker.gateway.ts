import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtService } from '../../auth/services/jwt.service';

interface SocketContext {
  userId: string;
  email: string;
  /** Текущий выбранный tenantId. Per-tenant room — главная подписка. */
  tenantId: string;
}

/**
 * TrackerGateway — live-канал для UI трекера. Один tenant = одна основная
 * подписка-room `tenant:${tenantId}`. Опционально клиент подписывается на
 * более узкие rooms — `project:${id}`, `issue:${id}` (для kanban-доски
 * конкретного проекта или ленты конкретной задачи).
 *
 * Аутентификация — тот же session JWT, что REST: cookie `z_session` или
 * заголовок `Authorization: Bearer …` (для тестов). После verify юзер
 * должен иметь membership в указанном `X-Org-Id` / handshake.auth.tenantId
 * (иначе — disconnect).
 *
 * Heartbeat / ping-pong — built-in socket.io (default 25s ping interval).
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws/tracker',
  // CORS закрывается в `afterInit` через значения из TypedConfig'а (см. ниже) —
  // в декораторе нельзя обращаться к DI, поэтому ставим разрешающий шаблон,
  // а fail-fast делается в `handleConnection`.
  cors: { origin: true, credentials: true },
  // Транспорты: websocket в приоритете, fallback на polling.
  transports: ['websocket', 'polling'],
})
export class TrackerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TrackerGateway.name);

  /** Заполняется самим nest'ом после bootstrap. */
  @WebSocketServer()
  server!: Server;

  /** Set'ы коннектов на tenant для observability и быстрого emit. */
  private readonly socketContext = new Map<string, SocketContext>();

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ── lifecycle ────────────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    try {
      const ctx = await this.authenticate(client);
      if (!ctx) {
        client.disconnect(true);
        return;
      }
      this.socketContext.set(client.id, ctx);
      await client.join(this.tenantRoom(ctx.tenantId));
      this.logger.log(
        { socketId: client.id, userId: ctx.userId, tenantId: ctx.tenantId },
        'tracker WS: client connected',
      );
      client.emit('connected', {
        ok: true,
        tenantId: ctx.tenantId,
        rooms: [this.tenantRoom(ctx.tenantId)],
      });
    } catch (e) {
      this.logger.warn(
        { socketId: client.id, err: e instanceof Error ? e.message : String(e) },
        'tracker WS: handshake failed',
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const ctx = this.socketContext.get(client.id);
    this.socketContext.delete(client.id);
    this.logger.log(
      { socketId: client.id, userId: ctx?.userId, tenantId: ctx?.tenantId },
      'tracker WS: client disconnected',
    );
  }

  // ── client-side messages ─────────────────────────────────────────────

  /**
   * Подписка на дополнительный room проекта. Возвращает ack клиенту.
   * Защита от чужого projectId — проверяем, что Project принадлежит
   * tenant'у подключения.
   */
  @SubscribeMessage('subscribe.project')
  async onSubscribeProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId: string },
  ): Promise<{ ok: boolean; room?: string; error?: string }> {
    const ctx = this.socketContext.get(client.id);
    if (!ctx) return { ok: false, error: 'not_authenticated' };
    if (!body?.projectId || typeof body.projectId !== 'string') {
      return { ok: false, error: 'invalid_project_id' };
    }
    const project = await this.prisma.project.findFirst({
      where: { id: body.projectId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!project) return { ok: false, error: 'project_not_found' };
    const room = this.projectRoom(body.projectId);
    await client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('unsubscribe.project')
  async onUnsubscribeProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.projectId) return { ok: false };
    await client.leave(this.projectRoom(body.projectId));
    return { ok: true };
  }

  @SubscribeMessage('subscribe.issue')
  async onSubscribeIssue(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string },
  ): Promise<{ ok: boolean; room?: string; error?: string }> {
    const ctx = this.socketContext.get(client.id);
    if (!ctx) return { ok: false, error: 'not_authenticated' };
    if (!body?.issueId) return { ok: false, error: 'invalid_issue_id' };
    const issue = await this.prisma.issue.findFirst({
      where: { id: body.issueId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!issue) return { ok: false, error: 'issue_not_found' };
    const room = this.issueRoom(body.issueId);
    await client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('unsubscribe.issue')
  async onUnsubscribeIssue(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.issueId) return { ok: false };
    await client.leave(this.issueRoom(body.issueId));
    return { ok: true };
  }

  /** Простой ping для отладочного клиента (socket.io уже шлёт свой heartbeat). */
  @SubscribeMessage('ping')
  onPing(): { ok: true; t: number } {
    return { ok: true, t: Date.now() };
  }

  // ── server-side helpers (используются TrackerEventsService) ──────────

  /** Имя room для tenant'а. */
  tenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  projectRoom(projectId: string): string {
    return `project:${projectId}`;
  }

  issueRoom(issueId: string): string {
    return `issue:${issueId}`;
  }

  /**
   * Опубликовать событие в один или несколько rooms. Безопасный no-op если
   * `server` не инициализирован (актуально для unit-тестов, где gateway
   * мокируется без NestJS lifecycle).
   */
  emitToRooms(rooms: string[], eventName: string, payload: unknown): void {
    if (!this.server) {
      // На случай, если событие летит до bootstrap'а — лог + skip.
      this.logger.debug({ eventName, rooms }, 'WS server not ready, event dropped');
      return;
    }
    if (rooms.length === 0) return;
    this.server.to(rooms).emit(eventName, payload);
  }

  // ── internals ────────────────────────────────────────────────────────

  private async authenticate(client: Socket): Promise<SocketContext | null> {
    // Проверка allowed origin (CORS) — strict, чтобы декларация cors:{origin:true}
    // в декораторе не открывала браузерные коннекты с любого URL.
    const origin = (client.handshake.headers.origin ?? '').toString();
    const allowedList = this.cfg.cors.allowed;
    if (origin && !allowedList.includes(origin)) {
      this.logger.warn(
        { origin, socketId: client.id, allowed: allowedList },
        'tracker WS: origin не входит в allow-list — disconnect',
      );
      return null;
    }

    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn({ socketId: client.id }, 'tracker WS: token missing');
      return null;
    }

    let session;
    try {
      session = this.jwt.verifySession(token);
    } catch (e) {
      this.logger.warn(
        { socketId: client.id, err: e instanceof Error ? e.message : String(e) },
        'tracker WS: jwt invalid',
      );
      return null;
    }

    // Если в JWT есть jti — проверим, что сессия не отозвана.
    if (session.jti) {
      const us = await this.prisma.userSession.findUnique({
        where: { jti: session.jti },
      });
      const valid =
        us !== null &&
        us.revokedAt === null &&
        us.expiresAt.getTime() > Date.now();
      if (!valid) {
        this.logger.warn(
          { socketId: client.id, jti: session.jti },
          'tracker WS: session revoked',
        );
        return null;
      }
    }

    const tenantId = await this.resolveTenantId(client, session.sub);
    if (!tenantId) return null;

    // Проверим membership пользователя в tenant'е.
    const membership = await this.prisma.membership.findFirst({
      where: { userId: session.sub, orgId: tenantId },
      select: { id: true },
    });
    if (!membership) {
      this.logger.warn(
        { socketId: client.id, userId: session.sub, tenantId },
        'tracker WS: no membership in tenant',
      );
      return null;
    }

    return { userId: session.sub, email: session.email, tenantId };
  }

  /**
   * Извлекает session JWT из:
   *   1. handshake.auth.token (явная передача от клиента)
   *   2. cookie `z_session` (HTTP-only из браузера)
   *   3. заголовок Authorization: Bearer <token>
   */
  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as
      | { token?: string }
      | undefined;
    if (auth?.token && typeof auth.token === 'string') return auth.token;

    const cookieHeader = client.handshake.headers.cookie ?? '';
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx);
      if (key === 'z_session') {
        return decodeURIComponent(trimmed.slice(idx + 1));
      }
    }

    const authHeader = (client.handshake.headers.authorization ?? '').toString();
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim() || null;
    }
    return null;
  }

  /**
   * tenantId извлекается из:
   *   1. handshake.auth.tenantId (предпочтительно — client knows what он
   *      смотрит);
   *   2. handshake.query.tenantId (для отладки);
   *   3. дефолтная Org user'а — если ровно одна.
   */
  private async resolveTenantId(
    client: Socket,
    userId: string,
  ): Promise<string | null> {
    const auth = client.handshake.auth as
      | { tenantId?: string }
      | undefined;
    if (auth?.tenantId && typeof auth.tenantId === 'string') return auth.tenantId;

    const q = client.handshake.query?.tenantId;
    if (typeof q === 'string' && q.length > 0) return q;

    const memberships = await this.prisma.membership.findMany({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      take: 2,
    });
    if (memberships.length === 1 && memberships[0]) return memberships[0].orgId;
    return null;
  }
}
