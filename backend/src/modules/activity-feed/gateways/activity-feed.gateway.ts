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
  tenantId: string;
}

@Injectable()
@WebSocketGateway({
  namespace: '/ws/feed',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class ActivityFeedGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ActivityFeedGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly socketContext = new Map<string, SocketContext>();

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const ctx = await this.authenticate(client);
      if (!ctx) {
        client.disconnect(true);
        return;
      }
      this.socketContext.set(client.id, ctx);
      const tenantRoom = this.tenantRoom(ctx.tenantId);
      const userRoom = this.userRoom(ctx.userId);
      await Promise.all([client.join(tenantRoom), client.join(userRoom)]);
      this.logger.log(
        { socketId: client.id, userId: ctx.userId, tenantId: ctx.tenantId },
        'feed WS: client connected',
      );
      client.emit('connected', {
        ok: true,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        rooms: [tenantRoom, userRoom],
      });
    } catch (e) {
      this.logger.warn(
        { socketId: client.id, err: e instanceof Error ? e.message : String(e) },
        'feed WS: handshake failed',
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const ctx = this.socketContext.get(client.id);
    this.socketContext.delete(client.id);
    this.logger.log(
      { socketId: client.id, userId: ctx?.userId, tenantId: ctx?.tenantId },
      'feed WS: client disconnected',
    );
  }

  @SubscribeMessage('subscribe.team')
  async onSubscribeTeam(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { teamId: string },
  ): Promise<{ ok: boolean; room?: string; error?: string }> {
    const ctx = this.socketContext.get(client.id);
    if (!ctx) return { ok: false, error: 'not_authenticated' };
    if (!body?.teamId || typeof body.teamId !== 'string') {
      return { ok: false, error: 'invalid_team_id' };
    }
    const room = this.teamRoom(body.teamId);
    await client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('unsubscribe.team')
  async onUnsubscribeTeam(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { teamId: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.teamId) return { ok: false };
    await client.leave(this.teamRoom(body.teamId));
    return { ok: true };
  }

  @SubscribeMessage('ping')
  onPing(): { ok: true; t: number } {
    return { ok: true, t: Date.now() };
  }

  tenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  teamRoom(teamId: string): string {
    return `team:${teamId}`;
  }

  userRoom(userId: string): string {
    return `user:${userId}`;
  }

  emitToRooms(rooms: string[], eventName: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug({ eventName, rooms }, 'feed WS server not ready, event dropped');
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
        'feed WS: origin не входит в allow-list — disconnect',
      );
      return null;
    }

    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn({ socketId: client.id }, 'feed WS: token missing');
      return null;
    }

    let session;
    try {
      session = this.jwt.verifySession(token);
    } catch (e) {
      this.logger.warn(
        { socketId: client.id, err: e instanceof Error ? e.message : String(e) },
        'feed WS: jwt invalid',
      );
      return null;
    }

    if (session.jti) {
      const us = await this.prisma.userSession.findUnique({
        where: { jti: session.jti },
      });
      const valid = us !== null && us.revokedAt === null && us.expiresAt.getTime() > Date.now();
      if (!valid) {
        this.logger.warn({ socketId: client.id, jti: session.jti }, 'feed WS: session revoked');
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
        'feed WS: no membership in tenant',
      );
      return null;
    }

    return { userId: session.sub, email: session.email, tenantId };
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
