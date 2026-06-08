import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { S3Service } from '../recordings/s3.service';

import { UploadCreateSchema, UPLOAD_MAX_SIZE_BYTES } from './dto/meeting-uploads.dto';
import type { MeetingUploadsQueueService } from './meeting-uploads-queue.service';
import { MeetingUploadsService } from './meeting-uploads.service';

function make(setup: {
  uploadCount?: number;
  quotaLimit?: number;
}): {
  service: MeetingUploadsService;
  prisma: any;
  s3: any;
  queue: any;
} {
  const prisma = {
    meeting: {
      create: vi.fn(async ({ data }: any) => ({ id: data.id })),
      count: vi.fn(async () => setup.uploadCount ?? 0),
      findUnique: vi.fn(),
    },
    recording: { findUnique: vi.fn() },
  } as unknown as PrismaService;

  const s3 = {
    presignPut: vi.fn(async () => 'https://s3.local/presigned-put'),
    presignGet: vi.fn(async () => ({ url: 'https://s3.local/get', expiresAt: new Date() })),
    listKeys: vi.fn(async () => []),
  } as unknown as S3Service;

  const cfg = {
    getDynamic: vi.fn(async () => setup.quotaLimit ?? 20),
    s3: { bucket: 'z-records' },
    retention: { defaultDays: 30 },
  } as unknown as TypedConfigService;

  const queue = {
    enqueueUploadIngest: vi.fn(async () => ({ jobId: 'job-1' })),
  } as unknown as MeetingUploadsQueueService;

  const service = new MeetingUploadsService(prisma, s3, cfg, queue);
  return { service, prisma, s3, queue };
}

describe('UploadCreateSchema', () => {
  it('sizeBytes > 2 ГБ не проходит zod-валидацию (первая линия)', () => {
    const r = UploadCreateSchema.safeParse({
      type: 'team',
      title: 'Тест',
      fileName: 'rec.mp4',
      contentType: 'video/mp4',
      sizeBytes: UPLOAD_MAX_SIZE_BYTES + 1,
    });
    expect(r.success).toBe(false);
  });
});

describe('MeetingUploadsService.createUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseInput = {
    tenantId: 'org-1',
    ownerId: 'user-1',
    type: 'team' as const,
    title: 'Звонок с клиентом',
    customPrompt: null,
    fileName: 'zoom-recording.mp4',
    contentType: 'video/mp4',
    sizeBytes: 100 * 1024 * 1024,
    numSpeakersHint: null,
  };

  it('валидно → создаёт Meeting(source=upload) и зовёт presignPut', async () => {
    const { service, prisma, s3 } = make({});

    const res = await service.createUpload({ ...baseInput });

    expect((prisma as any).meeting.create).toHaveBeenCalledTimes(1);
    const createArg = (prisma as any).meeting.create.mock.calls[0][0];
    expect(createArg.data.source).toBe('upload');
    expect(createArg.data.status).toBe('scheduled');
    expect((s3 as any).presignPut).toHaveBeenCalledTimes(1);
    const [keyArg, ctArg] = (s3 as any).presignPut.mock.calls[0];
    expect(keyArg).toMatch(/^meetings\/.+\/upload\/source\.mp4$/);
    expect(ctArg).toBe('video/mp4');
    expect(res.uploadUrl).toBe('https://s3.local/presigned-put');
    expect(res.uploadKey).toBe(keyArg);
    expect(res.meetingId).toBeTruthy();
  });

  it('sizeBytes > 2 ГБ → UPLOAD_FILE_TOO_LARGE, Meeting не создаётся', async () => {
    const { service, prisma } = make({});

    await expect(
      service.createUpload({ ...baseInput, sizeBytes: UPLOAD_MAX_SIZE_BYTES + 1 }),
    ).rejects.toMatchObject({
      response: { error: { code: 'UPLOAD_FILE_TOO_LARGE' } },
    });
    expect((prisma as any).meeting.create).not.toHaveBeenCalled();
  });

  it('неподдерживаемое расширение → UPLOAD_UNSUPPORTED_FORMAT', async () => {
    const { service } = make({});

    await expect(
      service.createUpload({ ...baseInput, fileName: 'report.pdf' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'UPLOAD_UNSUPPORTED_FORMAT' } },
    });
  });

  it('лимит загрузок исчерпан (count >= limit) → UPLOAD_QUOTA_EXCEEDED', async () => {
    const { service, prisma } = make({ uploadCount: 20, quotaLimit: 20 });

    await expect(service.createUpload({ ...baseInput })).rejects.toMatchObject({
      response: { error: { code: 'UPLOAD_QUOTA_EXCEEDED' } },
    });
    expect((prisma as any).meeting.create).not.toHaveBeenCalled();
  });
});

describe('MeetingUploadsService.completeUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upload + scheduled → ставит ingest-job', async () => {
    const { service, prisma, queue } = make({});
    (prisma as any).meeting.findUnique.mockResolvedValueOnce({
      id: 'm-1',
      ownerId: 'user-1',
      source: 'upload',
      status: 'scheduled',
    });

    const res = await service.completeUpload('m-1', 'user-1');

    expect((queue as any).enqueueUploadIngest).toHaveBeenCalledWith('m-1');
    expect(res.status).toBe('processing');
  });

  it('не scheduled → UPLOAD_NOT_PENDING, ingest не ставится', async () => {
    const { service, prisma, queue } = make({});
    (prisma as any).meeting.findUnique.mockResolvedValueOnce({
      id: 'm-1',
      ownerId: 'user-1',
      source: 'upload',
      status: 'recording_processing',
    });

    await expect(service.completeUpload('m-1', 'user-1')).rejects.toMatchObject({
      response: { error: { code: 'UPLOAD_NOT_PENDING' } },
    });
    expect((queue as any).enqueueUploadIngest).not.toHaveBeenCalled();
  });

  it('чужая/несуществующая встреча → MEETING_NOT_FOUND', async () => {
    const { service, prisma } = make({});
    (prisma as any).meeting.findUnique.mockResolvedValueOnce(null);

    await expect(service.completeUpload('m-x', 'user-1')).rejects.toMatchObject({
      response: { error: { code: 'MEETING_NOT_FOUND' } },
    });
  });
});
