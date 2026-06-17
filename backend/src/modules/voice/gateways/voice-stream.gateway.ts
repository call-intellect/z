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
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtService } from '../../auth/services/jwt.service';
import { VoiceAdapterError, VoiceChannelAdapter } from '../services/voice-channel-adapter.service';

interface VoiceSession {
  userId: string;
  tenantId: string;
  chunks: Buffer[];
  totalBytes: number;
  mimeType: string;
  sampleRate: number | null;
  startedAt: number;
  ttlTimer: NodeJS.Timeout;
}

interface SocketContext {
  userId: string;
  email: string;
  tenantId: string;
}

const TTL_SECONDS = 60;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024;

@Injectable()
@WebSocketGateway({
  namespace: '/ws/voice',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 256 * 1024,
})
export class VoiceStreamGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(VoiceStreamGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly socketContext = new Map<string, SocketContext>();

  private readonly sessions = new Map<string, VoiceSession>();

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(VoiceChannelAdapter)
    private readonly adapter: VoiceChannelAdapter,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const ctx = await this.authenticate(client);
      if (!ctx) {
        client.disconnect(true);
        return;
      }
      this.socketContext.set(client.id, ctx);
      this.logger.log(
        { socketId: client.id, userId: ctx.userId, tenantId: ctx.tenantId },
        'voice WS: client connected',
      );
      client.emit('connected', { ok: true });
    } catch (e) {
      this.logger.warn(
        { socketId: client.id, err: e instanceof Error ? e.message : String(e) },
        'voice WS: handshake failed',
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const ctx = this.socketContext.get(client.id);
    const session = this.sessions.get(client.id);
    if (session) {
      this.disposeSession(client.id, 'cancelled');
    }
    this.socketContext.delete(client.id);
    this.logger.log(
      { socketId: client.id, userId: ctx?.userId, hadSession: !!session },
      'voice WS: client disconnected',
    );
  }

  @SubscribeMessage('voice:start')
  handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { sampleRate?: number; mimeType?: string } | undefined,
  ): {
    ok: boolean;
    sessionId?: string;
    ttlSec?: number;
    error?: { code: string; message: string };
  } {
    const ctx = this.socketContext.get(client.id);
    if (!ctx) {
      return {
        ok: false,
        error: { code: 'not_authenticated', message: 'Не авторизован' },
      };
    }

    for (const [otherId, otherSession] of this.sessions.entries()) {
      if (otherSession.userId === ctx.userId) {
        this.logger.debug(
          { userId: ctx.userId, otherId, newId: client.id },
          'voice WS: cancelling previous session for same user',
        );
        this.disposeSession(otherId, 'cancelled');
        const otherSocket = this.server?.sockets?.sockets?.get(otherId);
        otherSocket?.emit('voice:error', {
          code: 'superseded',
          message: 'Открыта новая сессия записи — старая отменена',
        });
      }
    }

    const mimeType =
      typeof body?.mimeType === 'string' && body.mimeType.length > 0 ? body.mimeType : 'audio/webm';
    const sampleRate =
      typeof body?.sampleRate === 'number' && Number.isFinite(body.sampleRate)
        ? body.sampleRate
        : null;

    const ttlTimer = setTimeout(() => {
      const stillThere = this.sessions.get(client.id);
      if (!stillThere) return;
      this.logger.warn(
        { socketId: client.id, userId: ctx.userId },
        'voice WS: session TTL expired — auto-cancel',
      );
      client.emit('voice:error', {
        code: 'ttl_expired',
        message: `Сессия не завершена за ${TTL_SECONDS} сек — отменено`,
      });
      this.disposeSession(client.id, 'timeout');
    }, TTL_SECONDS * 1000);
    if (typeof ttlTimer.unref === 'function') ttlTimer.unref();

    this.sessions.set(client.id, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      chunks: [],
      totalBytes: 0,
      mimeType,
      sampleRate,
      startedAt: Date.now(),
      ttlTimer,
    });

    return { ok: true, sessionId: client.id, ttlSec: TTL_SECONDS };
  }

  @SubscribeMessage('voice:chunk')
  handleChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { data: unknown } | ArrayBuffer | Buffer | undefined,
  ): { ok: boolean; error?: { code: string; message: string } } {
    const ctx = this.socketContext.get(client.id);
    if (!ctx) {
      return {
        ok: false,
        error: { code: 'not_authenticated', message: 'Не авторизован' },
      };
    }
    const session = this.sessions.get(client.id);
    if (!session) {
      return {
        ok: false,
        error: { code: 'no_session', message: 'Сессия не открыта' },
      };
    }

    const chunk = toBuffer(body);
    if (!chunk) {
      return {
        ok: false,
        error: { code: 'invalid_chunk', message: 'Неверный формат chunk' },
      };
    }
    if (chunk.byteLength === 0) {
      return { ok: true };
    }
    if (chunk.byteLength > MAX_CHUNK_BYTES) {
      client.emit('voice:error', {
        code: 'chunk_too_large',
        message: `Chunk > ${MAX_CHUNK_BYTES} байт`,
      });
      this.disposeSession(client.id, 'error');
      return {
        ok: false,
        error: { code: 'chunk_too_large', message: 'Chunk слишком большой' },
      };
    }
    if (session.totalBytes + chunk.byteLength > MAX_BUFFER_BYTES) {
      this.logger.warn(
        {
          socketId: client.id,
          userId: ctx.userId,
          total: session.totalBytes,
          incoming: chunk.byteLength,
        },
        'voice WS: buffer overflow — abort session',
      );
      client.emit('voice:error', {
        code: 'buffer_overflow',
        message: `Превышен лимит ${MAX_BUFFER_BYTES} байт на сессию`,
      });
      this.disposeSession(client.id, 'error');
      return {
        ok: false,
        error: { code: 'buffer_overflow', message: 'Буфер переполнен' },
      };
    }

    session.chunks.push(chunk);
    session.totalBytes += chunk.byteLength;
    this.metrics.incVoiceWsChunk();
    return { ok: true };
  }

  @SubscribeMessage('voice:end')
  async handleEnd(@ConnectedSocket() client: Socket): Promise<void> {
    const ctx = this.socketContext.get(client.id);
    const session = this.sessions.get(client.id);
    if (!ctx || !session) {
      client.emit('voice:error', {
        code: 'no_session',
        message: 'Сессия не открыта',
      });
      return;
    }

    clearTimeout(session.ttlTimer);

    const totalBytes = session.totalBytes;
    const mimeType = session.mimeType;
    const startedAt = session.startedAt;

    if (totalBytes === 0) {
      client.emit('voice:error', {
        code: 'audio_empty',
        message: 'Запись пустая',
      });
      this.disposeSession(client.id, 'error');
      return;
    }

    const audio = Buffer.concat(session.chunks, totalBytes);

    this.sessions.delete(client.id);

    const asrStartedAt = Date.now();
    try {
      const result = await this.adapter.transcribe({
        audio,
        tenantId: ctx.tenantId,
        mimeType,
      });
      const latencyMs = Date.now() - asrStartedAt;
      const durationMs = Math.round(result.durationSeconds * 1000);

      this.metrics.observeVoiceWsAsrLatency(latencyMs);
      this.metrics.incVoiceWsSession('completed');

      this.logger.log(
        {
          socketId: client.id,
          userId: ctx.userId,
          audioBytes: totalBytes,
          recordingMs: asrStartedAt - startedAt,
          latencyMs,
          durationMs,
          textLen: result.text.length,
        },
        'voice WS: transcribed',
      );

      client.emit('voice:transcribed', {
        text: result.text,
        durationMs,
        latencyMs,
      });
    } catch (err) {
      const latencyMs = Date.now() - asrStartedAt;
      this.metrics.observeVoiceWsAsrLatency(latencyMs);
      this.metrics.incVoiceWsSession('error');
      const code = err instanceof VoiceAdapterError ? err.code : 'asr_failed';
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { socketId: client.id, userId: ctx.userId, code, err: message },
        'voice WS: ASR failed',
      );
      client.emit('voice:error', { code, message });
    }
  }

  @SubscribeMessage('voice:cancel')
  handleCancel(@ConnectedSocket() client: Socket): { ok: true } {
    this.disposeSession(client.id, 'cancelled');
    return { ok: true };
  }

  private disposeSession(
    clientId: string,
    outcome: 'completed' | 'cancelled' | 'error' | 'timeout',
  ): void {
    const session = this.sessions.get(clientId);
    if (!session) return;
    clearTimeout(session.ttlTimer);
    this.sessions.delete(clientId);
    this.metrics.incVoiceWsSession(outcome);
  }

  private async authenticate(client: Socket): Promise<SocketContext | null> {
    const origin = (client.handshake.headers.origin ?? '').toString();
    const allowedList = this.cfg.cors.allowed;
    if (origin && !allowedList.includes(origin)) {
      this.logger.warn(
        { origin, socketId: client.id, allowed: allowedList },
        'voice WS: origin не входит в allow-list — disconnect',
      );
      return null;
    }

    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn({ socketId: client.id }, 'voice WS: token missing');
      return null;
    }

    let session;
    try {
      session = this.jwt.verifySession(token);
    } catch (e) {
      this.logger.warn(
        { socketId: client.id, err: e instanceof Error ? e.message : String(e) },
        'voice WS: jwt invalid',
      );
      return null;
    }

    if (session.jti) {
      const us = await this.prisma.userSession.findUnique({
        where: { jti: session.jti },
      });
      const valid = us !== null && us.revokedAt === null && us.expiresAt.getTime() > Date.now();
      if (!valid) {
        this.logger.warn({ socketId: client.id, jti: session.jti }, 'voice WS: session revoked');
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
        'voice WS: no membership in tenant',
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

function toBuffer(
  payload: { data: unknown } | ArrayBuffer | Buffer | Uint8Array | undefined,
): Buffer | null {
  if (!payload) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(new Uint8Array(payload));
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === 'object' && 'data' in payload) {
    const data = (payload as { data: unknown }).data;
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
    if (data instanceof Uint8Array) return Buffer.from(data);
  }
  return null;
}
