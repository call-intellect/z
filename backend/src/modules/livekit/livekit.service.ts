import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AccessToken,
  type ParticipantInfo,
  type Room,
  RoomServiceClient,
} from 'livekit-server-sdk';

import { TypedConfigService } from '../../common/config/index';

@Injectable()
export class LivekitService {
  private readonly logger = new Logger(LivekitService.name);
  private readonly roomService: RoomServiceClient;

  private static readonly DEFAULT_TTL_SECONDS = 4 * 60 * 60;
  private static readonly MAX_TTL_SECONDS = 8 * 60 * 60;
  private static readonly POST_END_GRACE_SECONDS = 5 * 60;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.roomService = new RoomServiceClient(
      this.cfg.livekit.apiUrl,
      this.cfg.livekit.apiKey,
      this.cfg.livekit.apiSecret,
    );
  }

  async generateHostToken(
    meeting: { id: string; endedAt?: Date | null },
    identity: string,
    name: string,
  ): Promise<string> {
    return this.generateToken(meeting, identity, name, true);
  }

  async generateGuestToken(
    meeting: { id: string; endedAt?: Date | null },
    identity: string,
    name: string,
  ): Promise<string> {
    return this.generateToken(meeting, identity, name, false);
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
      canUpdateOwnMetadata: true,
      roomAdmin: isHost,
    });
    return at.toJwt();
  }

  private computeTtlSeconds(endedAt: Date | null): number {
    if (!endedAt) {
      return Math.min(LivekitService.DEFAULT_TTL_SECONDS, LivekitService.MAX_TTL_SECONDS);
    }
    const nowMs = Date.now();
    const deadlineMs = endedAt.getTime() + LivekitService.POST_END_GRACE_SECONDS * 1000;
    const remainingSec = Math.floor((deadlineMs - nowMs) / 1000);
    if (remainingSec <= 0) {
      return 60;
    }
    return Math.min(remainingSec, LivekitService.MAX_TTL_SECONDS);
  }

  async ensureRoom(meeting: { id: string }): Promise<Room | null> {
    try {
      const room = await this.roomService.createRoom({ name: meeting.id });
      this.logger.log(`LiveKit room создана: ${meeting.id}`);
      return room;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('already exists')) {
        return null;
      }
      const isNetworkError =
        message.toLowerCase().includes('fetch failed') ||
        message.toLowerCase().includes('econnrefused') ||
        message.toLowerCase().includes('timeout') ||
        message.toLowerCase().includes('enotfound');
      if (isNetworkError) {
        this.logger.warn(
          `LiveKit недоступен при ensureRoom(${meeting.id}): ${message}. ` +
            `Полагаемся на auto-create при подключении клиента.`,
        );
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

  async muteParticipant(meeting: { id: string }, identity: string, mute: boolean): Promise<void> {
    const participant = await this.roomService.getParticipant(meeting.id, identity);
    const tracks = participant.tracks ?? [];
    for (const track of tracks) {
      try {
        await this.roomService.mutePublishedTrack(meeting.id, identity, track.sid, mute);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`mutePublishedTrack ${meeting.id}/${identity}/${track.sid} → ${message}`);
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
