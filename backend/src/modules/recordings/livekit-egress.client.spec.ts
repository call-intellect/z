import { beforeEach, describe, expect, it, vi } from 'vitest';

// Перехватываем конструктор EgressClient до импорта тестируемого файла:
// SDK инициализирует rpc → tries to call live API. Нам нужен полный мок.
const mockStartRoomCompositeEgress = vi.fn();
const mockStartTrackEgress = vi.fn();
const mockStopEgress = vi.fn();

vi.mock('livekit-server-sdk', async () => {
  const actual = await vi.importActual<typeof import('livekit-server-sdk')>(
    'livekit-server-sdk',
  );
  return {
    ...actual,
    EgressClient: vi.fn().mockImplementation(() => ({
      startRoomCompositeEgress: mockStartRoomCompositeEgress,
      startTrackEgress: mockStartTrackEgress,
      stopEgress: mockStopEgress,
    })),
  };
});

// Импортируем после mock'а.
import type { TypedConfigService } from '../../common/config/index';

import { LivekitEgressClient } from './livekit-egress.client';

function makeCfg(): TypedConfigService {
  return {
    livekit: {
      apiUrl: 'https://livekit.local',
      apiKey: 'apikey',
      apiSecret: 'apisecret',
    },
    s3: {
      endpointUrl: 'https://s3.local',
      region: 'ru-1',
      bucket: 'z-records',
      accessKey: 'AKIA',
      secretKey: 'SECRET',
      presignedTtlSeconds: 3600,
    },
  } as unknown as TypedConfigService;
}

describe('LivekitEgressClient', () => {
  beforeEach(() => {
    mockStartRoomCompositeEgress.mockReset();
    mockStartTrackEgress.mockReset();
    mockStopEgress.mockReset();
  });

  it('startRoomCompositeEgress: передаёт корректный S3-выход и filepath', async () => {
    mockStartRoomCompositeEgress.mockResolvedValueOnce({ egressId: 'EG_1' });

    const client = new LivekitEgressClient(makeCfg());
    const out = await client.startRoomCompositeEgress(
      { id: 'm-1' },
      { bucket: 'z-records', key: 'meetings/m-1/composite.mp4' },
    );

    expect(out).toEqual({ egressId: 'EG_1' });
    expect(mockStartRoomCompositeEgress).toHaveBeenCalledTimes(1);
    const [room, opts] = mockStartRoomCompositeEgress.mock.calls[0]!;
    expect(room).toBe('m-1');
    // file output → S3, с правильным bucket / accessKey / forcePathStyle.
    const file = (opts as { file: { filepath: string; output: { value: { bucket: string; accessKey: string; forcePathStyle: boolean }; case: string } } }).file;
    expect(file.filepath).toBe('meetings/m-1/composite.mp4');
    expect(file.output.case).toBe('s3');
    expect(file.output.value.bucket).toBe('z-records');
    expect(file.output.value.accessKey).toBe('AKIA');
    expect(file.output.value.forcePathStyle).toBe(true);
  });

  it('startTrackEgress: filepath, trackId, S3 как DirectFileOutput', async () => {
    mockStartTrackEgress.mockResolvedValueOnce({ egressId: 'EG_T1' });

    const client = new LivekitEgressClient(makeCfg());
    const out = await client.startTrackEgress(
      { id: 'm-1' },
      'TR_sid',
      { bucket: 'z-records', key: 'meetings/m-1/audio/guest:1.ogg' },
    );

    expect(out).toEqual({ egressId: 'EG_T1' });
    const [room, file, trackId] = mockStartTrackEgress.mock.calls[0]!;
    expect(room).toBe('m-1');
    expect(trackId).toBe('TR_sid');
    expect((file as { filepath: string }).filepath).toBe(
      'meetings/m-1/audio/guest:1.ogg',
    );
  });

  it('stopEgress: глотает «not found» и не бросает', async () => {
    mockStopEgress.mockRejectedValueOnce(new Error('egress not found'));

    const client = new LivekitEgressClient(makeCfg());
    await expect(client.stopEgress('EG_x')).resolves.toBeUndefined();
  });

  it('stopEgress: на других ошибках бросает', async () => {
    mockStopEgress.mockRejectedValueOnce(new Error('connection refused'));

    const client = new LivekitEgressClient(makeCfg());
    await expect(client.stopEgress('EG_x')).rejects.toThrow('connection refused');
  });
});
