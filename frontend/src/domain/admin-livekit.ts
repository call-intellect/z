/**
 * Доменная модель для `/admin/integrations/livekit` — обзор медиа-стека LiveKit
 * (SFU / Egress / TURN). Фаза 6 редизайна Z-Admin.
 *
 * Контракт backend: `AdminLivekitController` под префиксом
 * `/api/v1/admin/integrations/livekit` (планируется). На момент сборки фронта
 * эндпоинты могут отсутствовать — UI ловит 404 и показывает `AdminEmpty`.
 */

// ────────────────────────── ApiDto ──────────────────────────

export type LivekitSfuHealthApiDto = {
  reachable: boolean;
  activeRooms: number;
  totalParticipants: number;
  /** 0..1 либо null — если SFU не отдаёт. */
  serverLoad: number | null;
  /** Версия LiveKit Server, если известна. */
  version: string | null;
  checkedAt: string;
};

export type LivekitEgressJobApiDto = {
  id: string;
  /** record (общий микс) / track (отдельные дорожки) / rtmp. */
  type: string;
  status: string;
  roomName: string | null;
  startedAt: string | null;
  destination: string | null;
};

export type LivekitEgressOverviewApiDto = {
  reachable: boolean;
  activeJobs: LivekitEgressJobApiDto[];
  checkedAt: string;
};

export type LivekitTurnModeApi = 'builtin' | 'external';

export type LivekitTurnHealthApiDto = {
  mode: LivekitTurnModeApi;
  host: string | null;
  /** Время ответа от TURN в мс, либо null если не достижим. */
  pingMs: number | null;
  reachable: boolean;
  checkedAt: string;
};

export type LivekitOverviewApiDto = {
  sfu: LivekitSfuHealthApiDto | null;
  egress: LivekitEgressOverviewApiDto | null;
  turn: LivekitTurnHealthApiDto | null;
};

// ────────────────────────── DomainModel ──────────────────────────

export type LivekitSfuHealthDomain = {
  reachable: boolean;
  activeRooms: number;
  totalParticipants: number;
  serverLoad: number | null;
  version: string | null;
  checkedAt: Date;
};

export type LivekitEgressJobDomain = {
  id: string;
  type: string;
  status: string;
  roomName: string | null;
  startedAt: Date | null;
  destination: string | null;
};

export type LivekitEgressOverviewDomain = {
  reachable: boolean;
  activeJobs: LivekitEgressJobDomain[];
  checkedAt: Date;
};

export type LivekitTurnHealthDomain = {
  mode: LivekitTurnModeApi;
  /** Локализованная подпись режима. */
  modeLabel: string;
  host: string | null;
  pingMs: number | null;
  reachable: boolean;
  checkedAt: Date;
};

export type LivekitOverviewDomain = {
  sfu: LivekitSfuHealthDomain | null;
  egress: LivekitEgressOverviewDomain | null;
  turn: LivekitTurnHealthDomain | null;
};

export const LIVEKIT_TURN_MODE_LABELS: Record<LivekitTurnModeApi, string> = {
  builtin: 'Встроенный (LiveKit)',
  external: 'Внешний (coturn / отдельный сервер)',
};

// ────────────────────────── Mappers ──────────────────────────

export function livekitSfuFromApi(
  api: LivekitSfuHealthApiDto,
): LivekitSfuHealthDomain {
  return {
    reachable: api.reachable,
    activeRooms: api.activeRooms,
    totalParticipants: api.totalParticipants,
    serverLoad: api.serverLoad,
    version: api.version,
    checkedAt: new Date(api.checkedAt),
  };
}

export function livekitEgressJobFromApi(
  api: LivekitEgressJobApiDto,
): LivekitEgressJobDomain {
  return {
    id: api.id,
    type: api.type,
    status: api.status,
    roomName: api.roomName,
    startedAt: api.startedAt ? new Date(api.startedAt) : null,
    destination: api.destination,
  };
}

export function livekitEgressFromApi(
  api: LivekitEgressOverviewApiDto,
): LivekitEgressOverviewDomain {
  return {
    reachable: api.reachable,
    activeJobs: api.activeJobs.map(livekitEgressJobFromApi),
    checkedAt: new Date(api.checkedAt),
  };
}

export function livekitTurnFromApi(
  api: LivekitTurnHealthApiDto,
): LivekitTurnHealthDomain {
  return {
    mode: api.mode,
    modeLabel: LIVEKIT_TURN_MODE_LABELS[api.mode] ?? api.mode,
    host: api.host,
    pingMs: api.pingMs,
    reachable: api.reachable,
    checkedAt: new Date(api.checkedAt),
  };
}

export function livekitOverviewFromApi(
  api: LivekitOverviewApiDto,
): LivekitOverviewDomain {
  return {
    sfu: api.sfu ? livekitSfuFromApi(api.sfu) : null,
    egress: api.egress ? livekitEgressFromApi(api.egress) : null,
    turn: api.turn ? livekitTurnFromApi(api.turn) : null,
  };
}
