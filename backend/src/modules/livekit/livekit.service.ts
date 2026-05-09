import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AccessToken,
  type ParticipantInfo,
  type Room,
  RoomServiceClient,
} from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';

/**
 * Обёртка над LiveKit Server SDK.
 *
 * Главные обязанности:
 *   1. Генерация JWT-токенов для host/guest (`generateHostToken` / `generateGuestToken`).
 *   2. Idempotent создание room (`ensureRoom`) — встреча привязана к LiveKit-room
 *      по `meeting.id` (он же `roomName`).
 *   3. Управление участниками: `mute`, `remove`, `updateAttributes`.
 *
 * Внутри — единственный `RoomServiceClient`, инициализированный из
 * `cfg.livekit.{apiUrl,apiKey,apiSecret}`. Сам SDK в `livekit-server-sdk` v2
 * возвращает `Promise<string>` из `AccessToken.toJwt()` — учитываем это.
 */
@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private readonly roomService: RoomServiceClient;

  /** TTL по умолчанию (4 часа) — если у встречи нет `endedAt`. */
  private static readonly DEFAULT_TTL_SECONDS = 4 * 60 * 60;
  /** Жёсткий потолок TTL (8 часов) — выше выдавать опасно. */
  private static readonly MAX_TTL_SECONDS = 8 * 60 * 60;
  /** Грация после `endedAt` — даём 5 минут чтобы корректно отключиться. */
  private static readonly POST_END_GRACE_SECONDS = 5 * 60;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.roomService = new RoomServiceClient(
      this.cfg.livekit.apiUrl,
      this.cfg.livekit.apiKey,
      this.cfg.livekit.apiSecret,
    );
  }

  // ─────────────────────────────── токены ─────────────────────────────────

  async generateHostToken(
    meeting: { id: string; endedAt?: Date | null },
    identity: string,
    name: string,
  ): Promise<string> {
    return this.generateToken(meeting, identity, name, /* host */ true);
  }

  async generateGuestToken(
    meeting: { id: string; endedAt?: Date | null },
    identity: string,
    name: string,
  ): Promise<string> {
    return this.generateToken(meeting, identity, name, /* host */ false);
  }

  private async generateToken(
    meeting: { id: string; endedAt?: Date | null },
    identity: string,
    name: string,
    isHost: boolean,
  ): Promise<string> {
    const ttlSeconds = this.computeTtlSeconds(meeting.endedAt ?? null);
    const at = new AccessToken(this.cfg.livekit.apiKey, this.cfg.livekit.apiSecret, {
      identity,
      name,
      ttl: ttlSeconds,
    });
    at.addGrant({
      roomJoin: true,
      room: meeting.id,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: isHost,
    });
    return at.toJwt();
  }

  /**
   * TTL = меньшее из (до `endedAt + 5 минут`) и `MAX_TTL_SECONDS` (8 часов).
   * Если `endedAt` не задан — `DEFAULT_TTL_SECONDS` (4 часа).
   * Минимум — 60 секунд (даже если встреча уже закончилась — даём гостю шанс
   * отключиться корректно).
   */
  private computeTtlSeconds(endedAt: Date | null): number {
    if (!endedAt) {
      return Math.min(LivekitService.DEFAULT_TTL_SECONDS, LivekitService.MAX_TTL_SECONDS);
    }
    const nowMs = Date.now();
    const deadlineMs = endedAt.getTime() + LivekitService.POST_END_GRACE_SECONDS * 1000;
    const remainingSec = Math.floor((deadlineMs - nowMs) / 1000);
    if (remainingSec <= 0) {
      // Если уже мимо — выдаём минимум, чтобы клиент мог корректно завершить.
      return 60;
    }
    return Math.min(remainingSec, LivekitService.MAX_TTL_SECONDS);
  }

  // ─────────────────────────────── комнаты ────────────────────────────────

  /**
   * Idempotent создание room. Если уже существует — игнорируем ошибку
   * "room already exists" и возвращаем `null`. На прочие ошибки бросаем.
   */
  async ensureRoom(meeting: { id: string }): Promise<Room | null> {
    try {
      const room = await this.roomService.createRoom({ name: meeting.id });
      this.logger.log(`LiveKit room создана: ${meeting.id}`);
      return room;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // LiveKit отвечает "room already exists" — это норма для idempotent ensure.
      if (message.toLowerCase().includes('already exists')) {
        return null;
      }
      this.logger.error(`Не удалось создать room ${meeting.id}: ${message}`);
      throw err;
    }
  }

  async deleteRoom(meeting: { id: string }): Promise<void> {
    try {
      await this.roomService.deleteRoom(meeting.id);
      this.logger.log(`LiveKit room удалена: ${meeting.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // "room does not exist" — тоже допустимо в idle/finish сценариях.
      if (message.toLowerCase().includes('does not exist')) {
        return;
      }
      this.logger.error(`Не удалось удалить room ${meeting.id}: ${message}`);
      throw err;
    }
  }

  listParticipants(meeting: { id: string }): Promise<ParticipantInfo[]> {
    return this.roomService.listParticipants(meeting.id);
  }

  // ─────────────────────────────── управление ─────────────────────────────

  /**
   * Мьют/анмьют всех опубликованных треков участника. SDK не имеет
   * "mute participant" единым вызовом — нужно дёрнуть `mutePublishedTrack`
   * для каждого track sid. Если у участника треков нет — no-op.
   */
  async muteParticipant(
    meeting: { id: string },
    identity: string,
    mute: boolean,
  ): Promise<void> {
    const participant = await this.roomService.getParticipant(meeting.id, identity);
    const tracks = participant.tracks ?? [];
    for (const track of tracks) {
      try {
        await this.roomService.mutePublishedTrack(meeting.id, identity, track.sid, mute);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `mutePublishedTrack ${meeting.id}/${identity}/${track.sid} → ${message}`,
        );
      }
    }
  }

  async removeParticipant(meeting: { id: string }, identity: string): Promise<void> {
    await this.roomService.removeParticipant(meeting.id, identity);
  }

  async updateParticipantAttributes(
    meeting: { id: string },
    identity: string,
    attributes: Record<string, string>,
  ): Promise<void> {
    await this.roomService.updateParticipant(meeting.id, identity, { attributes });
  }
}
