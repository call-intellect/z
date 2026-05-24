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
import {
  VoiceAdapterError,
  VoiceChannelAdapter,
} from '../services/voice-channel-adapter.service';

/**
 * Per-user state. In-memory достаточно: voice-сессии короткие (≤60 сек),
 * restart процесса = клиент пере-загрузит / переподключится.
 */
interface VoiceSession {
  userId: string;
  tenantId: string;
  chunks: Buffer[];
  /** Сумма chunk.byteLength, чтобы быстро проверять overflow без reduce. */
  totalBytes: number;
  mimeType: string;
  sampleRate: number | null;
  startedAt: number;
  /** TTL guard — auto-cancel если voice:end не пришёл за TTL. */
  ttlTimer: NodeJS.Timeout;
}

interface SocketContext {
  userId: string;
  email: string;
  tenantId: string;
}

/** Жёсткие пределы — защита от мусорных клиентов / атак. */
const TTL_SECONDS = 60;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB на сессию
const MAX_CHUNK_BYTES = 64 * 1024; // 64 KB на один chunk

/**
 * VoiceStreamGateway (T4 / δ-3) — WebSocket-канал для голосового **ввода**
 * в Concierge. Намеренно ТОЛЬКО ввод (ASR): Concierge отвечает только
 * текстом, голосового вывода нет (см. CLAUDE.md и feedback_concierge_*).
 *
 * Намespace: `/ws/voice`. Auth — тот же JWT-flow, что у `/ws/tracker`
 * (handshake.auth.token / cookie `z_session` / Authorization: Bearer +
 * session.jti revocation + membership в tenant).
 *
 * События (client → server):
 *   - `voice:start {sampleRate, mimeType}` — открыть сессию. Ack
 *     `{ok, sessionId, ttlSec}`. Если у юзера уже есть открытая сессия —
 *     старая cancel'ится (limit 1).
 *   - `voice:chunk {data: Buffer | ArrayBuffer}` — добавить chunk
 *     (timeslice 200ms у MediaRecorder). Если суммарно > 5MB — overflow.
 *   - `voice:end` — собрать chunks, прогнать через ASR (VoiceChannelAdapter
 *     → Vox submit+poll), emit `voice:transcribed`, закрыть сессию.
 *   - `voice:cancel` — выкинуть сессию без ASR-вызова.
 *
 * События (server → client):
 *   - `voice:transcribed {text, durationMs, latencyMs}` — финальный текст.
 *   - `voice:error {code, message}` — ошибки (auth, overflow, asr_failed,
 *     ttl_expired и т.п.). После error сессия удалена.
 *
 * Известное ограничение (TODO):
 *   Vox работает по submit + poll каждые 2 сек. p50 latency после
 *   `voice:end` будет ≥ 2 сек (минимум 1 цикл poll + сам ASR). ТЗ метит
 *   1-2 сек — это недостижимо до миграции на streaming ASR (например,
 *   OpenAI Whisper realtime API или GigaAM stream). При переходе:
 *     - заменить `VoiceChannelAdapter.transcribe(chunks → buffer)` на
 *       стримящий вариант: открывать upstream-сокет на `voice:start`,
 *       форвардить `voice:chunk` напрямую, читать partial+final transcripts;
 *     - сверить ENV/pricing — Whisper realtime ~ $0.06/мин, Vox ~ X RUB/мин;
 *     - сравнить latency: realtime ASR обычно даёт p50 200-500ms.
 *   Поле выходного payload (`durationMs`/`latencyMs`) сохранит совместимость.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws/voice',
  // CORS закрывается в `authenticate` по `cfg.cors.allowed` (нельзя дёргать
  // DI в декораторе — оставляем разрешающий шаблон + fail-fast в handshake).
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
  // Один chunk ≤ 64 KB; 200ms opus ≈ 4-8 KB. Лимит payload — с запасом 256 KB
  // на случай keyframes/jitter; meaningful overflow ловим уже в gateway.
  maxHttpBufferSize: 256 * 1024,
})
export class VoiceStreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(VoiceStreamGateway.name);

  @WebSocketServer()
  server!: Server;

  /** Контекст подключения (тот же паттерн, что в TrackerGateway). */
  private readonly socketContext = new Map<string, SocketContext>();

  /**
   * Активные сессии. Key = clientId — по умолчанию одна сессия на сокет.
   * При limit-of-1 «на пользователя» (см. handleStart) — отменяем старые
   * сокеты того же userId перед открытием новой.
   */
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

  // ── lifecycle ────────────────────────────────────────────────────────

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
      // disconnect без явного end/cancel — считаем как cancelled.
      this.disposeSession(client.id, 'cancelled');
    }
    this.socketContext.delete(client.id);
    this.logger.log(
      { socketId: client.id, userId: ctx?.userId, hadSession: !!session },
      'voice WS: client disconnected',
    );
  }

  // ── client-side messages ─────────────────────────────────────────────

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

    // Лимит «1 сессия на пользователя» — отменяем все его старые сессии.
    for (const [otherId, otherSession] of this.sessions.entries()) {
      if (otherSession.userId === ctx.userId) {
        this.logger.debug(
          { userId: ctx.userId, otherId, newId: client.id },
          'voice WS: cancelling previous session for same user',
        );
        this.disposeSession(otherId, 'cancelled');
        // Сообщим старому сокету, что его сессия отменена в пользу новой.
        // server.sockets — это Namespace (тут namespace = /ws/voice),
        // у Namespace есть Map `.sockets: Map<id, Socket>`.
        const otherSocket = this.server?.sockets?.sockets?.get(otherId);
        otherSocket?.emit('voice:error', {
          code: 'superseded',
          message: 'Открыта новая сессия записи — старая отменена',
        });
      }
    }

    const mimeType =
      typeof body?.mimeType === 'string' && body.mimeType.length > 0
        ? body.mimeType
        : 'audio/webm';
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
    // Не блокируем event loop при shutdown.
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
      // Пустой chunk — игнор, не ошибка.
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

    // Снимаем TTL — мы уже завершаем сессию.
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

    // Cleanup сессии ДО ASR — если клиент дисконнектится, не считаем как
    // cancelled (ответ просто не дойдёт, но метрика была бы corrupted).
    // Снимаем из map СЕЙЧАС, чтобы handleDisconnect не пытался cancel.
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
      const code =
        err instanceof VoiceAdapterError ? err.code : 'asr_failed';
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

  // ── internals ────────────────────────────────────────────────────────

  /**
   * Удаляет сессию + засчитывает outcome в метрики.
   *
   * Idempotent: если сессии уже нет (например, gateway вызвал её сам
   * в handleEnd до Promise resolve, а потом пришёл disconnect) —
   * метрика не двойниится.
   */
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
      const valid =
        us !== null &&
        us.revokedAt === null &&
        us.expiresAt.getTime() > Date.now();
      if (!valid) {
        this.logger.warn(
          { socketId: client.id, jti: session.jti },
          'voice WS: session revoked',
        );
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

  private async resolveTenantId(
    client: Socket,
    userId: string,
  ): Promise<string | null> {
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

/**
 * Принимает chunk от socket.io в любом из форматов:
 *   - `{data: ArrayBuffer | Buffer | Uint8Array}` — наш стандарт
 *     (фронт оборачивает Blob.arrayBuffer() в `{data}`);
 *   - голый `ArrayBuffer` / `Buffer` — socket.io по умолчанию шлёт бинарь
 *     через `socket.emit('event', buffer)` без wrapper;
 *   - `Uint8Array` (some node-runtime'ы).
 */
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
