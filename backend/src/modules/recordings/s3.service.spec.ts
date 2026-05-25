import { describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();
const mockDestroy = vi.fn();
const mockGetSignedUrl = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class S3ClientMock {
    send = mockSend;
    destroy = mockDestroy;
  }
  class GetObjectCommandMock {
    __cmd = 'Get';
    input: unknown;
    constructor(args: unknown) {
      this.input = args;
    }
  }
  class DeleteObjectsCommandMock {
    __cmd = 'DeleteObjects';
    input: unknown;
    constructor(args: unknown) {
      this.input = args;
    }
  }
  return {
    S3Client: S3ClientMock,
    GetObjectCommand: GetObjectCommandMock,
    DeleteObjectsCommand: DeleteObjectsCommandMock,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockImplementation(async (...args) => mockGetSignedUrl(...args)),
}));

import type { TypedConfigService } from '../../common/config/index';

import { S3Service } from './s3.service';

function cfg(): TypedConfigService {
  return {
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

describe('S3Service', () => {
  it('presignGet: вызывает getSignedUrl с правильными параметрами', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://signed.example/url?sig=x');
    const svc = new S3Service(cfg());

    const result = await svc.presignGet('meetings/m-1/composite.mp4');

    expect(result.url).toBe('https://signed.example/url?sig=x');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [, command, opts] = mockGetSignedUrl.mock.calls[0]!;
    expect((command as { __cmd: string; input: { Bucket: string; Key: string } }).input).toEqual({
      Bucket: 'z-records',
      Key: 'meetings/m-1/composite.mp4',
    });
    expect((opts as { expiresIn: number }).expiresIn).toBe(3600);
  });

  it('delete: пропускает пустой массив', async () => {
    const svc = new S3Service(cfg());
    await svc.delete([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('delete: отправляет DeleteObjects c правильными ключами', async () => {
    mockSend.mockResolvedValueOnce({ Deleted: [{ Key: 'a' }, { Key: 'b' }] });

    const svc = new S3Service(cfg());
    await svc.delete(['a', 'b', '']);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0]![0] as {
      __cmd: string;
      input: { Bucket: string; Delete: { Objects: Array<{ Key: string }>; Quiet: boolean } };
    };
    expect(cmd.__cmd).toBe('DeleteObjects');
    expect(cmd.input.Bucket).toBe('z-records');
    expect(cmd.input.Delete.Objects).toEqual([{ Key: 'a' }, { Key: 'b' }]);
    expect(cmd.input.Delete.Quiet).toBe(true);
  });
});
