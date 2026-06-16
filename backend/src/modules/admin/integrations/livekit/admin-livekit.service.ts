import { Inject, Injectable, Logger } from '@nestjs/common';
import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';

import { TypedConfigService } from '../../../../common/config/index';
import { AdminSettingsService } from '../../settings/admin-settings.service';

import type {
  EgressItemDto,
  EgressStatusResponseDto,
  SfuStatusResponseDto,
  SwitchTurnModeResponseDto,
  TurnStatusResponseDto,
} from './dto/admin-livekit.dto';

@Injectable()
export class AdminLiveKitService {
  private readonly logger = new Logger(AdminLiveKitService.name);
  private roomService: RoomServiceClient | null = null;
  private egressClient: EgressClient | null = null;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  async getSfu(): Promise<SfuStatusResponseDto> {
    const lk = this.cfg.livekit;
    const now = new Date().toISOString();
    try {
      const client = this.getRoomService();
      const rooms = await client.listRooms();
      const totalParticipants = rooms.reduce((sum, r) => sum + Number(r.numParticipants ?? 0), 0);
      return {
        ok: true,
        apiUrl: lk.apiUrl,
        activeRooms: rooms.length,
        totalParticipants,
        collectedAt: now,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message }, 'admin-livekit: listRooms failed');
      return {
        ok: false,
        apiUrl: lk.apiUrl,
        activeRooms: 0,
        totalParticipants: 0,
        collectedAt: now,
        error: message,
      };
    }
  }

  async getEgress(): Promise<EgressStatusResponseDto> {
    try {
      const client = this.getEgressClient();
      const list = await client.listEgress({ active: true });
      const items: EgressItemDto[] = list.map((e) => ({
        egressId: e.egressId,
        status: String(e.status ?? 'unknown'),
        roomName: e.roomName ?? '',
        startedAt: this.nanosToIso(e.startedAt),
        endedAt: this.nanosToIso(e.endedAt),
      }));
      return { ok: true, items, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message }, 'admin-livekit: listEgress failed');
      return { ok: false, items: [], error: message };
    }
  }

  async getTurn(): Promise<TurnStatusResponseDto> {
    const t = this.cfg.turn;
    const dynamicMode = await this.settings.get<string>('livekit.turn_mode');
    return {
      mode: t.mode,
      host: t.host ?? null,
      port: t.port ?? null,
      tls: !!t.tls,
      username: t.username ?? null,
      dynamicMode: typeof dynamicMode === 'string' ? dynamicMode : null,
    };
  }

  async switchTurnMode(args: {
    mode: 'builtin' | 'external';
    userId?: string | null;
    reason?: string | null;
  }): Promise<SwitchTurnModeResponseDto> {
    await this.settings.set('livekit.turn_mode', args.mode, {
      ...(args.userId ? { userId: args.userId } : {}),
      ...(args.reason ? { reason: args.reason } : {}),
    });
    this.logger.log(`admin: livekit.turn_mode → ${args.mode} (user=${args.userId ?? 'system'})`);
    return {
      ok: true,
      mode: args.mode,
      appliedAt: new Date().toISOString(),
    };
  }

  private getRoomService(): RoomServiceClient {
    if (!this.roomService) {
      const lk = this.cfg.livekit;
      this.roomService = new RoomServiceClient(lk.apiUrl, lk.apiKey, lk.apiSecret);
    }
    return this.roomService;
  }

  private getEgressClient(): EgressClient {
    if (!this.egressClient) {
      const lk = this.cfg.livekit;
      this.egressClient = new EgressClient(lk.apiUrl, lk.apiKey, lk.apiSecret);
    }
    return this.egressClient;
  }

  private nanosToIso(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    let asBigInt: bigint;
    try {
      asBigInt = typeof value === 'bigint' ? value : BigInt(value as string);
    } catch {
      return null;
    }
    if (asBigInt === 0n) return null;
    const millis = Number(asBigInt / 1_000_000n);
    if (!Number.isFinite(millis) || millis <= 0) return null;
    return new Date(millis).toISOString();
  }
}
