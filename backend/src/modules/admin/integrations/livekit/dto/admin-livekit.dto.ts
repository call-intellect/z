import { z } from 'zod';

export const SwitchTurnModeSchema = z.object({
  mode: z.enum(['builtin', 'external']),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type SwitchTurnModeDto = z.infer<typeof SwitchTurnModeSchema>;

export interface SfuStatusResponseDto {
  ok: boolean;
  apiUrl: string;
  activeRooms: number;
  totalParticipants: number;
  collectedAt: string;
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
  error: string | null;
}

export interface TurnStatusResponseDto {
  mode: string;
  host: string | null;
  port: number | null;
  tls: boolean;
  username: string | null;
  dynamicMode: string | null;
}

export interface SwitchTurnModeResponseDto {
  ok: true;
  mode: string;
  appliedAt: string;
}
