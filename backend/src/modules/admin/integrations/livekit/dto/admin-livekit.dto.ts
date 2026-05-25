/**
 * Admin-redesign Фаза 6 — DTO для `AdminLiveKitController`.
 *
 * Состояние LiveKit-инфраструктуры: SFU rooms, egress jobs, TURN. Все
 * объекты — минимальные read-only DTO; никаких секретов наружу.
 */

import { z } from 'zod';

// ──────────────────────────── set turn mode ──────────────────────────────

export const SwitchTurnModeSchema = z.object({
  /** 'builtin' — LiveKit-builtin TURN; 'external' — отдельный TURN-сервер. */
  mode: z.enum(['builtin', 'external']),
  /** Причина переключения (для severity=high audit). */
  reason: z.string().trim().min(1).max(500).optional(),
});
export type SwitchTurnModeDto = z.infer<typeof SwitchTurnModeSchema>;

// ──────────────────────────── responses ──────────────────────────────────

export interface SfuStatusResponseDto {
  ok: boolean;
  /** Адрес LiveKit-сервера (API URL). */
  apiUrl: string;
  /** Кол-во активных комнат (`listRooms()`). */
  activeRooms: number;
  /** Сумма участников по всем комнатам. */
  totalParticipants: number;
  /** ISO. */
  collectedAt: string;
  /** Сообщение об ошибке, если ok=false. */
  error: string | null;
}

export interface EgressItemDto {
  egressId: string;
  status: string;
  roomName: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface EgressStatusResponseDto {
  ok: boolean;
  items: EgressItemDto[];
  /** Сообщение об ошибке, если ok=false / TODO. */
  error: string | null;
}

export interface TurnStatusResponseDto {
  /** 'builtin' / 'external' — текущая ENV-настройка. */
  mode: string;
  /** Хост TURN, если задан. */
  host: string | null;
  /** Порт. */
  port: number | null;
  /** Активна ли TLS. */
  tls: boolean;
  /** Имя пользователя для STUN/TURN (без пароля). */
  username: string | null;
  /** Динамический override из `AdminSetting livekit.turn_mode`, если задан. */
  dynamicMode: string | null;
}

export interface SwitchTurnModeResponseDto {
  ok: true;
  mode: string;
  appliedAt: string;
}
