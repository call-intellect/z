export type LivekitSfuHealthApiDto = {
  reachable: boolean;
  activeRooms: number;
  totalParticipants: number;
  serverLoad: number | null;
  version: string | null;
  checkedAt: string;
};

export type LivekitEgressJobApiDto = {
  id: string;
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

export type LivekitTurnModeApi = "builtin" | "external";

export type LivekitTurnHealthApiDto = {
  mode: LivekitTurnModeApi;
  host: string | null;
  pingMs: number | null;
  reachable: boolean;
  checkedAt: string;
};

export type LivekitOverviewApiDto = {
  sfu: LivekitSfuHealthApiDto | null;
  egress: LivekitEgressOverviewApiDto | null;
  turn: LivekitTurnHealthApiDto | null;
};

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
  builtin: "Встроенный (LiveKit)",
  external: "Внешний (coturn / отдельный сервер)",
};

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
