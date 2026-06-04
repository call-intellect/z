import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';

import type { SystemLogEntry } from './log-buffer.service';

/**
 * LogStreamGateway — live-стрим технических логов по WebSocket (Socket.IO).
 *
 * Namespace `/ws/platform-logs`. Заменяет поллинг в `/admin/logs`: новые записи
 * пушатся в room `platform-logs` сразу после flush'а буфера в БД.
 *
 * Доступ — **только super_admin** (`User.isSuperAdmin`, как у REST-эндпоинтов).
 * Handshake: тот же session JWT (cookie `z_session` / `auth.token` / Bearer),
 * затем проверка сессии (revocation) + `isSuperAdmin`. Паттерн копирует
 * `ActivityFeedGateway`. См. plans/tz/2026-06-03-logging-pipelines-coverage.md §Ф7.
 */

const LOGS_ROOM = 'platform-logs';

@Injectable()
@WebSocketGateway({
  namespace: '/ws/platform-logs',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class LogStreamGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LogStreamGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const ok = await this.authenticateSuperAdmin(client);
      if (!ok) {
        client.disconnect(true);
        return;
      }
      await client.join(LOGS_ROOM);
      client.emit('connected', { ok: true, room: LOGS_ROOM });
    } catch (e) {
      this.logger.warn(
        { socketId: client.id, err: e instanceof Error ? e.message : String(e) },
        'platform-logs WS: handshake failed',
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket): void {
    // no-op: room-membership чистится socket.io автоматически.
  }

  @SubscribeMessage('ping')
  onPing(): { ok: true; t: number } {
    return { ok: true, t: Date.now() };
  }

  /**
   * Рассылает пачку только что записанных логов всем подписчикам.
   * Вызывается `LogBufferService` после успешного `createMany`. Безопасный
   * no-op, если сервер ещё не поднят (юнит-тесты) или нет слушателей.
   */
  broadcast(entries: SystemLogEntry[]): void {
    if (!this.server || entries.length === 0) return;
    // Не сериализуем, если в room никого нет (дёшево пропускаем горячий путь).
    const room = this.server.sockets?.adapter?.rooms?.get(LOGS_ROOM);
    if (!room || room.size === 0) return;
    this.server.to(LOGS_ROOM).emit('logs', entries.map(toDto));
  }

  // ── auth ────────────────────────────────────────────────────────────────

  private async authenticateSuperAdmin(client: Socket): Promise<boolean> {
    const origin = (client.handshake.headers.origin ?? '').toString();
    const allowed = this.cfg.cors.allowed;
    if (origin && !allowed.includes(origin)) {
      this.logger.warn({ origin, socketId: client.id }, 'platform-logs WS: origin не в allow-list');
      return false;
    }

    const token = this.extractToken(client);
    if (!token) return false;

    let session;
    try {
      session = this.jwt.verifySession(token);
    } catch {
      return false;
    }

    if (session.jti) {
      const us = await this.prisma.userSession.findUnique({ where: { jti: session.jti } });
      const valid = us !== null && us.revokedAt === null && us.expiresAt.getTime() > Date.now();
      if (!valid) return false;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      select: { isSuperAdmin: true },
    });
    if (!user || !user.isSuperAdmin) {
      this.logger.warn({ socketId: client.id, userId: session.sub }, 'platform-logs WS: not super_admin');
      return false;
    }
    return true;
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token && typeof auth.token === 'string') return auth.token;

    const cookieHeader = client.handshake.headers.cookie ?? '';
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      if (trimmed.slice(0, idx) === 'z_session') {
        return decodeURIComponent(trimmed.slice(idx + 1));
      }
    }

    const authHeader = (client.handshake.headers.authorization ?? '').toString();
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim() || null;
    }
    return null;
  }
}

/** Проекция записи буфера в DTO для фронта (createdAt → ISO-строка). */
function toDto(e: SystemLogEntry): Record<string, unknown> {
  const createdAt =
    e.createdAt instanceof Date ? e.createdAt.toISOString() : new Date().toISOString();
  return { ...e, createdAt };
}
