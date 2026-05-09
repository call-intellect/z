import { createHash, createHmac } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';
import { TypedConfigService } from '../../src/common/config/index';
import { GlobalZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { HmacService } from '../../src/modules/auth/services/hmac.service';
import { LivekitService } from '../../src/modules/livekit/livekit.service';
import { LivekitEgressClient } from '../../src/modules/recordings/livekit-egress.client';
import { S3Service } from '../../src/modules/recordings/s3.service';

/**
 * E2E `recording-flow`:
 *   1. Создать встречу через Crossmark API.
 *   2. Хост обменивает deep-link на cookie.
 *   3. Webhook room_started → meeting.active.
 *   4. POST /recording/start → recording.status=requested.
 *   5. Webhook egress_started (composite) → status=recording.
 *   6. Webhook track_published (audio) → AudioTrack создан + ensureTrackEgress.
 *   7. Webhook egress_ended (composite + track) → recording.status=ready,
 *      meeting.status=recording_ready.
 *   8. GET /recording/download → presigned URL.
 *   9. DELETE /recording → recording.status=deleted, S3 keys удалены.
 *
 * `LivekitService`, `LivekitEgressClient`, `S3Service` — мокаем через
 * `Object.assign` (overrideProvider ломает DI у guards/interceptors).
 */
describe('Recording Flow E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hmacService: HmacService;
  let cfg: TypedConfigService;
  let plainKey: string;
  let s3Calls: { type: string; arg: unknown }[];
  let egressCalls: { type: string; args: unknown[] }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Подменяем LivekitService
    const livekit = moduleRef.get(LivekitService, { strict: false });
    Object.assign(livekit, {
      ensureRoom: async () => null,
      deleteRoom: async () => undefined,
      listParticipants: async () => [],
      generateHostToken: async () => 'mock-host-token',
      generateGuestToken: async () => 'mock-guest-token',
      muteParticipant: async () => undefined,
      removeParticipant: async () => undefined,
      updateParticipantAttributes: async () => undefined,
    });

    // Подменяем LivekitEgressClient
    egressCalls = [];
    const egress = moduleRef.get(LivekitEgressClient, { strict: false });
    Object.assign(egress, {
      startRoomCompositeEgress: async (...args: unknown[]) => {
        egressCalls.push({ type: 'composite', args });
        return { egressId: 'EG_C1' };
      },
      startTrackEgress: async (...args: unknown[]) => {
        egressCalls.push({ type: 'track', args });
        return { egressId: 'EG_T1' };
      },
      stopEgress: async (...args: unknown[]) => {
        egressCalls.push({ type: 'stop', args });
      },
    });

    // Подменяем S3Service
    s3Calls = [];
    const s3 = moduleRef.get(S3Service, { strict: false });
    Object.assign(s3, {
      presignGet: async (key: string) => {
        s3Calls.push({ type: 'presign', arg: key });
        return {
          url: `https://signed.local/${key}?sig=fake`,
          expiresAt: new Date(Date.now() + 3600_000),
        };
      },
      delete: async (keys: string[]) => {
        s3Calls.push({ type: 'delete', arg: keys });
      },
    });

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(
      express.json({
        limit: '1mb',
        verify: (req, _res, buf) => {
          (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        },
      }),
    );
    app.use(cookieParser());
    app.useGlobalPipes(new GlobalZodValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    hmacService = app.get(HmacService);
    cfg = app.get(TypedConfigService);

    plainKey = hmacService.generateKey();
    await prisma.integrationKey.create({
      data: {
        partnerName: 'recording-flow-e2e',
        keyHash: hmacService.hashKey(plainKey),
      },
    });
  });

  afterEach(async () => {
    await prisma.$transaction([
      prisma.crossmarkIdempotency.deleteMany(),
      prisma.webhookSeenEvent.deleteMany(),
      prisma.recordingAction.deleteMany(),
      prisma.audioTrack.deleteMany(),
      prisma.recording.deleteMany(),
      prisma.meetingEvent.deleteMany(),
      prisma.participant.deleteMany(),
      prisma.meeting.deleteMany(),
      prisma.user.deleteMany(),
    ]);
    s3Calls.length = 0;
    egressCalls.length = 0;
  });

  afterAll(async () => {
    await prisma.integrationKey.deleteMany({
      where: { partnerName: 'recording-flow-e2e' },
    });
    await prisma.webhookSeenEvent.deleteMany();
    await app.close();
  });

  // ────────────────────────── helpers ────────────────────────────

  function signCrossmark(body: string, ts: number): string {
    return createHmac('sha256', plainKey).update(`${ts}.${body}`).digest('hex');
  }

  function crossmarkAuth(body: string): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000);
    return {
      Authorization: `Bearer ${plainKey}`,
      'X-Crossmark-Signature': signCrossmark(body, ts),
      'X-Crossmark-Timestamp': String(ts),
    };
  }

  function signLivekitWebhook(body: string): string {
    const sha256 = createHash('sha256').update(body).digest('base64');
    return jwt.sign({ sha256 }, cfg.livekit.webhookApiSecret, {
      algorithm: 'HS256',
      expiresIn: 60,
    });
  }

  const canonicalize = (obj: unknown): string =>
    JSON.stringify(JSON.parse(JSON.stringify(obj)));

  async function postWebhook(payload: unknown): Promise<void> {
    const str = canonicalize(payload);
    const auth = signLivekitWebhook(str);
    const res = await request(app.getHttpServer())
      .post('/webhooks/livekit')
      .set('Content-Type', 'application/json')
      .set('Authorization', auth)
      .send(str);
    expect(res.status).toBe(200);
  }

  async function createMeetingAndCookie(): Promise<{
    meetingId: string;
    cookie: string;
  }> {
    const createBody = JSON.stringify({
      host: { external_id: 'u-rec', email: 'rec@x.com', name: 'Rec Host' },
      type: 'sales',
      title: 'Recording Flow E2E',
    });
    const createRes = await request(app.getHttpServer())
      .post('/integrations/crossmark/v1/meetings')
      .set(crossmarkAuth(createBody))
      .set('Content-Type', 'application/json')
      .send(createBody);
    expect(createRes.status).toBe(201);
    const meetingId = createRes.body.meeting_id as string;
    const deepLinkUrl = createRes.body.deep_link as string;
    const tokenMatch = /\?t=([^&]+)/.exec(deepLinkUrl);
    const deepLinkToken = decodeURIComponent(tokenMatch?.[1] ?? '');

    const exchangeRes = await request(app.getHttpServer())
      .get('/api/v1/auth/exchange')
      .query({ token: deepLinkToken, meeting_id: meetingId });
    expect(exchangeRes.status).toBe(200);
    const setCookie = exchangeRes.headers['set-cookie'] as unknown as
      | string[]
      | string;
    const fullCookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).find(
      (c: string) => c.startsWith('z_session='),
    );
    const cookie = (fullCookie ?? '').split(';')[0] ?? '';
    return { meetingId, cookie };
  }

  // ────────────────────────── сценарий ────────────────────────────

  it('полный recording-flow: start → ready → download → delete', async () => {
    const { meetingId, cookie } = await createMeetingAndCookie();

    // 1. Запускаем встречу через webhook.
    await postWebhook({
      event: 'room_started',
      id: 'EV_started_rec',
      room: { name: meetingId },
    });
    let meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(meeting?.status).toBe('active');

    // 2. POST /recording/start.
    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/meetings/${meetingId}/recording/start`)
      .set('Cookie', cookie)
      .send({});
    expect(startRes.status).toBe(200);
    expect(startRes.body).toEqual({ ok: true });

    let rec = await prisma.recording.findUnique({ where: { meetingId } });
    expect(rec?.status).toBe('requested');
    expect(rec?.compositeEgressId).toBe('EG_C1');
    expect(rec?.retentionDays).toBe(cfg.retention.defaultDays);
    expect(egressCalls.find((c) => c.type === 'composite')).toBeTruthy();

    // 3. Webhook egress_started для composite.
    await postWebhook({
      event: 'egress_started',
      id: 'EV_eg_started',
      room: { name: meetingId },
      egressInfo: {
        egressId: 'EG_C1',
        requestType: 'roomComposite',
      },
    });
    rec = await prisma.recording.findUnique({ where: { meetingId } });
    expect(rec?.status).toBe('recording');

    // 4. Webhook track_published (audio) → ensureTrackEgress + AudioTrack.
    await postWebhook({
      event: 'track_published',
      id: 'EV_tp',
      room: { name: meetingId },
      participant: { identity: `host:${meeting!.ownerId}`, name: 'Rec Host' },
      track: { sid: 'TR_audio_1', type: 'AUDIO' },
    });
    const audioTracks = await prisma.audioTrack.findMany({
      where: { recordingId: rec!.id },
    });
    expect(audioTracks.length).toBe(1);
    expect(audioTracks[0]!.trackEgressId).toBe('EG_T1');
    expect(egressCalls.find((c) => c.type === 'track')).toBeTruthy();

    // 5. Webhook room_finished — переводим встречу в completed.
    await postWebhook({
      event: 'room_finished',
      id: 'EV_room_finished',
      room: { name: meetingId },
    });
    meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(meeting?.status).toBe('completed');

    // 6. Webhook egress_ended для track.
    await postWebhook({
      event: 'egress_ended',
      id: 'EV_eg_ended_track',
      room: { name: meetingId },
      egressInfo: {
        egressId: 'EG_T1',
        requestType: 'track',
        fileResults: [
          {
            location: `https://s3.local/${cfg.s3.bucket}/meetings/${meetingId}/audio/host:${meeting!.ownerId}.ogg`,
            size: 12345,
            duration: 60_000_000_000, // 60 сек в ns
            filename: 'audio.ogg',
          },
        ],
      },
    });

    // 7. Webhook egress_ended для composite — должен довести до ready.
    await postWebhook({
      event: 'egress_ended',
      id: 'EV_eg_ended_comp',
      room: { name: meetingId },
      egressInfo: {
        egressId: 'EG_C1',
        requestType: 'roomComposite',
        fileResults: [
          {
            location: `https://s3.local/${cfg.s3.bucket}/meetings/${meetingId}/composite.mp4`,
            size: 999999,
            duration: 120_000_000_000,
            filename: 'composite.mp4',
          },
        ],
      },
    });

    rec = await prisma.recording.findUnique({ where: { meetingId } });
    expect(rec?.status).toBe('ready');
    expect(rec?.mainVideoUrl).toContain('composite.mp4');
    expect(rec?.bytesTotal).toBe(BigInt(999999));

    meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    expect(meeting?.status).toBe('recording_ready');

    // 8. GET /recording/download.
    const dlRes = await request(app.getHttpServer())
      .get(`/api/v1/meetings/${meetingId}/recording/download`)
      .set('Cookie', cookie);
    expect(dlRes.status).toBe(200);
    expect(dlRes.body.url).toContain('signed.local');
    expect(dlRes.body.expires_at).toBeTruthy();
    expect(s3Calls.find((c) => c.type === 'presign')).toBeTruthy();

    // 9. Crossmark recording-url.
    const crossmarkUrlPath = `/integrations/crossmark/v1/meetings/${meetingId}/recording-url`;
    const tsCm = Math.floor(Date.now() / 1000);
    // GET — body пустое, но HMAC-подпись считается от пустой строки.
    const cmSig = createHmac('sha256', plainKey)
      .update(`${tsCm}.`)
      .digest('hex');
    const cmRes = await request(app.getHttpServer())
      .get(crossmarkUrlPath)
      .set('Authorization', `Bearer ${plainKey}`)
      .set('X-Crossmark-Signature', cmSig)
      .set('X-Crossmark-Timestamp', String(tsCm));
    expect(cmRes.status).toBe(200);
    expect(cmRes.body.url).toContain('signed.local');

    // 10. POST extend-retention.
    const extendBodyObj = { add_days: 7 };
    const extendBody = JSON.stringify(extendBodyObj);
    const extendRes = await request(app.getHttpServer())
      .post(`/integrations/crossmark/v1/meetings/${meetingId}/extend-retention`)
      .set(crossmarkAuth(extendBody))
      .set('Content-Type', 'application/json')
      .send(extendBody);
    expect(extendRes.status).toBe(200);
    expect(extendRes.body).toMatchObject({ ok: true });

    rec = await prisma.recording.findUnique({ where: { meetingId } });
    expect(rec?.retentionDays).toBe(cfg.retention.defaultDays + 7);

    // 11. DELETE /recording — досрочное удаление.
    const delRes = await request(app.getHttpServer())
      .delete(`/api/v1/meetings/${meetingId}/recording`)
      .set('Cookie', cookie);
    expect(delRes.status).toBe(200);

    rec = await prisma.recording.findUnique({ where: { meetingId } });
    expect(rec?.status).toBe('deleted');
    expect(rec?.deletedAt).toBeTruthy();
    const deleteCall = s3Calls.find((c) => c.type === 'delete');
    expect(deleteCall).toBeTruthy();
    expect((deleteCall!.arg as string[]).length).toBeGreaterThanOrEqual(1);
  });
});
