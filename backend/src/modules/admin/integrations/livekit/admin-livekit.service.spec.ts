import { describe, expect, it, vi } from 'vitest';

import { AdminLiveKitService } from './admin-livekit.service';

function buildService(initial: {
  rooms?: Array<{ numParticipants?: number | bigint }>;
  listRoomsError?: Error;
  dynamicMode?: string;
  setMock?: ReturnType<typeof vi.fn>;
}) {
  const cfg = {
    livekit: {
      apiUrl: 'http://livekit.test',
      apiKey: 'k',
      apiSecret: 's',
    },
    turn: {
      mode: 'builtin',
      host: 'turn.example.com',
      port: 3478,
      username: 'turnuser',
      password: 'turnpass',
      tls: true,
    },
  } as unknown as ConstructorParameters<typeof AdminLiveKitService>[0];

  const setMock = initial.setMock ?? vi.fn(async () => undefined);
  const settings = {
    get: vi.fn(async (key: string) => {
      if (key === 'livekit.turn_mode') return initial.dynamicMode;
      return undefined;
    }),
    set: setMock,
  } as unknown as ConstructorParameters<typeof AdminLiveKitService>[1];

  const svc = new AdminLiveKitService(cfg, settings);

  (svc as unknown as { roomService: unknown }).roomService = {
    listRooms: async () => {
      if (initial.listRoomsError) throw initial.listRoomsError;
      return initial.rooms ?? [];
    },
  };

  return { svc, settings, setMock };
}

describe('AdminLiveKitService', () => {
  it('getSfu: считает activeRooms и totalParticipants', async () => {
    const { svc } = buildService({
      rooms: [{ numParticipants: 3 }, { numParticipants: 2n }],
    });
    const result = await svc.getSfu();
    expect(result.ok).toBe(true);
    expect(result.activeRooms).toBe(2);
    expect(result.totalParticipants).toBe(5);
    expect(result.apiUrl).toBe('http://livekit.test');
  });

  it('getSfu: при ошибке SDK возвращает ok=false', async () => {
    const { svc } = buildService({
      listRoomsError: new Error('LiveKit unreachable'),
    });
    const result = await svc.getSfu();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('LiveKit unreachable');
  });

  it('getTurn: склеивает ENV + dynamicMode из AdminSettings', async () => {
    const { svc } = buildService({ dynamicMode: 'external' });
    const result = await svc.getTurn();
    expect(result.mode).toBe('builtin');
    expect(result.host).toBe('turn.example.com');
    expect(result.username).toBe('turnuser');
    expect(result.dynamicMode).toBe('external');
  });

  it('switchTurnMode: пишет в AdminSettings с user/reason и возвращает ISO', async () => {
    const { svc, setMock } = buildService({});
    const result = await svc.switchTurnMode({
      mode: 'external',
      userId: 'u1',
      reason: 'failover',
    });
    expect(setMock).toHaveBeenCalledWith(
      'livekit.turn_mode',
      'external',
      expect.objectContaining({ userId: 'u1', reason: 'failover' }),
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('external');
    expect(typeof result.appliedAt).toBe('string');
  });
});
