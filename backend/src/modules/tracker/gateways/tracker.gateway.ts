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
  tenantId: string;
  displayName: string;
  presenceIssueIds: Set<string>;
}

@Injectable()
@WebSocketGateway({
  namespace: '/ws/tracker',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class TrackerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TrackerGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly socketContext = new Map<string, SocketContext>();

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const ctx = await this.authenticate(client);
      if (!ctx) {
        client.disconnect(true);
        return;
      }
      if (!ctx.presenceIssueIds) ctx.presenceIssueIds = new Set();
      this.socketContext.set(client.id, ctx);
      await client.join(this.tenantRoom(ctx.tenantId));
      this.logger.debug(
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
    if (ctx) {
      for (const issueId of ctx.presenceIssueIds) {
        this.broadcastPresenceLeave(client, issueId, ctx);
      }
    }
    this.socketContext.delete(client.id);
    this.logger.debug(
      { socketId: client.id, userId: ctx?.userId, tenantId: ctx?.tenantId },
      'tracker WS: client disconnected',
    );
  }

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

  @SubscribeMessage('ping')
  onPing(): { ok: true; t: number } {
    return { ok: true, t: Date.now() };
  }

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

  @SubscribeMessage('issue.chat.typing')
  onChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string; isTyping: boolean },
  ): { ok: boolean } {
    const ctx = this.socketContext.get(client.id);
    if (!ctx || !body?.issueId) return { ok: false };
    if (!ctx.presenceIssueIds.has(body.issueId)) {
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

  @SubscribeMessage('issue.chat.presence')
  onChatPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { issueId: string },
  ): { ok: boolean; onlineUsers: Array<{ userId: string; displayName: string }> } {
    const ctx = this.socketContext.get(client.id);
    if (!ctx || !body?.issueId) return { ok: false, onlineUsers: [] };
    return { ok: true, onlineUsers: this.collectPresence(body.issueId) };
  }

  tenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  projectRoom(projectId: string): string {
    return `project:${projectId}`;
  }

  issueRoom(issueId: string): string {
    return `issue:${issueId}`;
  }

  presenceRoom(issueId: string): string {
    return `presence:issue:${issueId}`;
  }

  private collectPresence(issueId: string): Array<{ userId: string; displayName: string }> {
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

  private broadcastPresenceLeave(client: Socket, issueId: string, ctx: SocketContext): void {
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

  emitToRooms(rooms: string[], eventName: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug({ eventName, rooms }, 'WS server not ready, event dropped');
      return;
    }
    if (rooms.length === 0) return;
    this.server.to(rooms).emit(eventName, payload);
  }

  private async authenticate(client: Socket): Promise<SocketContext | null> {
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

    if (session.jti) {
      const us = await this.prisma.userSession.findUnique({
        where: { jti: session.jti },
      });
      const valid = us !== null && us.revokedAt === null && us.expiresAt.getTime() > Date.now();
      if (!valid) {
        this.logger.warn({ socketId: client.id, jti: session.jti }, 'tracker WS: session revoked');
        return null;
      }
    }

    const tenantId = await this.resolveTenantId(client, session.sub);
    if (!tenantId) return null;

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

    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      select: { name: true, email: true },
    });
    const displayName =
      user?.name?.trim() || user?.email?.trim() || session.email || session.sub.slice(0, 8);

    return {
      userId: session.sub,
      email: session.email,
      tenantId,
      displayName,
      presenceIssueIds: new Set<string>(),
    };
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
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

  private async resolveTenantId(client: Socket, userId: string): Promise<string | null> {
    const auth = client.handshake.auth as { tenantId?: string } | undefined;
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
