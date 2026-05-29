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
import { RbacService } from '../../rbac/rbac.service';

interface SocketContext {
  userId: string;
  email: string;
  /** Текущий выбранный tenantId. Per-tenant room — главная подписка. */
  tenantId: string;
  /**
   * T8 (2026-05-24). Для отображения «N онлайн» в чате задачи нужно
   * человекочитаемое имя. Сохраняем при handshake, чтобы не дёргать БД на
   * каждый presence-event.
   */
  displayName: string;
  /**
   * T8. Set issueId'ов, в чьи presence-rooms сокет вступил.
   * Нужен для авточистки на disconnect и для presence query.
   */
  presenceIssueIds: Set<string>;
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
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ── lifecycle ────────────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    try {
      const ctx = await this.authenticate(client);
      if (!ctx) {
        client.disconnect(true);
        return;
      }
      // Гарантируем валидный presenceIssueIds (если authenticate не задал —
      // подстраховка от рассинхрона типов).
      if (!ctx.presenceIssueIds) ctx.presenceIssueIds = new Set();
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
    // T8: при дисконнекте — broadcast presence:user_left во все presence rooms,
    // в которых сокет состоял. socket.io сам уберёт сокет из rooms, но другие
    // клиенты должны узнать, что человек ушёл.
    if (ctx) {
      for (const issueId of ctx.presenceIssueIds) {
        this.broadcastPresenceLeave(client, issueId, ctx);
      }
    }
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
      select: { id: true, ownerId: true },
    });
    if (!project) return { ok: false, error: 'project_not_found' };
    // audit В12 (2026-05-29): RBAC-чек на read project. Без него любой
    // авторизованный member тенанта мог join'нуть room и читать live-events
    // чужого проекта. canRead резолвит роль из membership + visibility-mode
    // policy.csv (manager strict — self-only по ownerId).
    const allowed = await this.rbac.canRead(
      ctx.userId,
      ctx.tenantId,
      'project',
      project.ownerId ?? null,
    );
    if (!allowed) return { ok: false, error: 'forbidden' };
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
      select: { id: true, createdById: true },
    });
    if (!issue) return { ok: false, error: 'issue_not_found' };
    // audit В12 (2026-05-29): RBAC-чек на read issue. См. subscribe.project
    // — тот же риск утечки live-events чужой задачи member'у тенанта.
    const allowed = await this.rbac.canRead(
      ctx.userId,
      ctx.tenantId,
      'issue',
      issue.createdById ?? null,
    );
    if (!allowed) return { ok: false, error: 'forbidden' };
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

  // ── T8: presence/typing для multi-user чата задачи ───────────────────

  /**
   * Подписаться на presence-room задачи. Возвращает текущий список online
   * пользователей в room (включая запрашивающего, без дублей по userId).
   *
   * Отличается от `subscribe.issue` тем, что:
   *   - room другой (`presence:issue:${issueId}`) — узкая шина только для
   *     присутствия/typing, не зашумляет основной канал событиями;
   *   - после join'а — broadcast другим членам room'а `presence:user_joined`;
   *   - отслеживается в SocketContext.presenceIssueIds для авточистки.
   */
  @SubscribeMessage('issue.chat.join')
  async onChatJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string },
  ): Promise<{
    ok: boolean;
    error?: string;
    onlineUsers?: Array<{ userId: string; displayName: string }>;
  }> {
    const ctx = this.socketContext.get(client.id);
    if (!ctx) return { ok: false, error: 'not_authenticated' };
    if (!body?.issueId || typeof body.issueId !== 'string') {
      return { ok: false, error: 'invalid_issue_id' };
    }
    const issue = await this.prisma.issue.findFirst({
      where: { id: body.issueId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!issue) return { ok: false, error: 'issue_not_found' };

    const room = this.presenceRoom(body.issueId);
    const wasAlreadyIn = ctx.presenceIssueIds.has(body.issueId);
    await client.join(room);
    ctx.presenceIssueIds.add(body.issueId);

    // Broadcast только если действительно зашли впервые (защита от
    // повторных join'ов с того же сокета).
    if (!wasAlreadyIn) {
      client.to(room).emit('presence:user_joined', {
        issueId: body.issueId,
        userId: ctx.userId,
        displayName: ctx.displayName,
      });
    }

    const onlineUsers = this.collectPresence(body.issueId);
    return { ok: true, onlineUsers };
  }

  @SubscribeMessage('issue.chat.leave')
  async onChatLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string },
  ): Promise<{ ok: boolean }> {
    const ctx = this.socketContext.get(client.id);
    if (!ctx || !body?.issueId) return { ok: false };
    if (!ctx.presenceIssueIds.has(body.issueId)) return { ok: true };
    this.broadcastPresenceLeave(client, body.issueId, ctx);
    await client.leave(this.presenceRoom(body.issueId));
    ctx.presenceIssueIds.delete(body.issueId);
    return { ok: true };
  }

  /**
   * Typing-indicator. Server — простой relay, дебаунс — на клиенте. Не пишем
   * в БД, не валидируем повторение: «потерянное» событие безболезненно.
   */
  @SubscribeMessage('issue.chat.typing')
  onChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string; isTyping: boolean },
  ): { ok: boolean } {
    const ctx = this.socketContext.get(client.id);
    if (!ctx || !body?.issueId) return { ok: false };
    if (!ctx.presenceIssueIds.has(body.issueId)) {
      // Не подписан на presence-room — игнорируем, чтобы не было утечки
      // typing-сигналов между задачами.
      return { ok: false };
    }
    const room = this.presenceRoom(body.issueId);
    client.to(room).emit('presence:user_typing', {
      issueId: body.issueId,
      userId: ctx.userId,
      displayName: ctx.displayName,
      isTyping: Boolean(body.isTyping),
    });
    return { ok: true };
  }

  /** Снимок текущего онлайн-состава presence-room (для UI после переподключения). */
  @SubscribeMessage('issue.chat.presence')
  onChatPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string },
  ): { ok: boolean; onlineUsers: Array<{ userId: string; displayName: string }> } {
    const ctx = this.socketContext.get(client.id);
    if (!ctx || !body?.issueId) return { ok: false, onlineUsers: [] };
    return { ok: true, onlineUsers: this.collectPresence(body.issueId) };
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

  /** T8: room для presence/typing в чате задачи. Не пересекается с issueRoom. */
  presenceRoom(issueId: string): string {
    return `presence:issue:${issueId}`;
  }

  /**
   * Собрать unique online-юзеров (по userId), которые сейчас в presence-room
   * указанной задачи. Источник истины — наш socketContext, а не socket.io
   * adapter.rooms (тот не различает userId, только socketId).
   */
  private collectPresence(
    issueId: string,
  ): Array<{ userId: string; displayName: string }> {
    const seen = new Map<string, string>();
    for (const ctx of this.socketContext.values()) {
      if (ctx.presenceIssueIds.has(issueId)) {
        if (!seen.has(ctx.userId)) seen.set(ctx.userId, ctx.displayName);
      }
    }
    return [...seen.entries()].map(([userId, displayName]) => ({
      userId,
      displayName,
    }));
  }

  /**
   * Broadcast `presence:user_left` в presence-room. Эмитим только если это
   * был ПОСЛЕДНИЙ сокет этого юзера в room'е (у юзера могло быть открыто
   * несколько вкладок — он не «ушёл», пока остаётся хоть один коннект).
   */
  private broadcastPresenceLeave(
    client: Socket,
    issueId: string,
    ctx: SocketContext,
  ): void {
    let remaining = 0;
    for (const [socketId, c] of this.socketContext.entries()) {
      if (socketId === client.id) continue;
      if (c.userId === ctx.userId && c.presenceIssueIds.has(issueId)) {
        remaining += 1;
        break;
      }
    }
    if (remaining > 0) return;
    client.to(this.presenceRoom(issueId)).emit('presence:user_left', {
      issueId,
      userId: ctx.userId,
      displayName: ctx.displayName,
    });
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

    // T8 (2026-05-24): подтянем displayName для presence/typing. Берём User.name,
    // fallback — email (или хвост userId, если ничего нет).
    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      select: { name: true, email: true },
    });
    const displayName =
      user?.name?.trim() ||
      user?.email?.trim() ||
      session.email ||
      session.sub.slice(0, 8);

    return {
      userId: session.sub,
      email: session.email,
      tenantId,
      displayName,
      presenceIssueIds: new Set<string>(),
    };
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
