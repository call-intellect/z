import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(import.meta.dir, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
}

const DATABASE_URL = process.env.DATABASE_URL!;
const REDIS_URL = process.env.REDIS_URL!;
const S3_BUCKET = process.env.S3_BUCKET!;
const S3_ENDPOINT_URL = process.env.S3_ENDPOINT_URL!;
const S3_REGION = process.env.S3_REGION ?? 'ru-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY!;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY!;

if (!DATABASE_URL || !REDIS_URL || !S3_BUCKET) {
  console.error('❌ Не хватает ENV: DATABASE_URL, REDIS_URL, S3_BUCKET');
  process.exit(1);
}

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT_URL,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  forcePathStyle: true,
});

function makeId(): string {
  return (
    Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\n=== smoke-transcribe: начинаем ===\n');

  const audioFile = '/tmp/test-audio.ogg';
  if (!fs.existsSync(audioFile)) {
    console.error('❌ Нет /tmp/test-audio.ogg. Создайте через:');
    console.error(
      '   ffmpeg -f lavfi -i "sine=frequency=440:duration=10" -c:a libopus -ar 48000 /tmp/test-audio.ogg -y',
    );
    process.exit(1);
  }
  const audioBuffer = fs.readFileSync(audioFile);
  console.log(`✓ Тестовый аудио файл: ${audioFile} (${audioBuffer.byteLength} bytes)`);

  const meetingId = '01SMKTR' + makeId();
  const recordingId = 'rec_smk_' + Date.now();
  const trackId = 'trk_smk_' + Date.now();
  const audioKey = `meetings/${meetingId}/tracks/test-track.ogg`;
  const fakeUrl = `${S3_ENDPOINT_URL}/${S3_BUCKET}/${audioKey}`;
  console.log(`✓ Meeting ID: ${meetingId}`);

  console.log(`\n→ Загружаем аудио в S3: ${audioKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: audioKey,
      Body: audioBuffer,
      ContentType: 'audio/ogg',
    }),
  );
  console.log(`✓ Аудио загружено в S3`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  try {
    console.log('\n→ Создаём записи в БД...');

    const owner = await prisma.user.findFirst();
    if (!owner) {
      console.error('❌ Нет пользователей в БД. Сначала зарегистрируйтесь через API.');
      process.exit(1);
    }
    console.log(`✓ Владелец встречи: ${owner.email}`);

    const now = new Date();
    const endedAt = new Date(now.getTime() + 10000);

    await prisma.meeting.create({
      data: {
        id: meetingId,
        title: 'Smoke Transcribe Test',
        type: 'standup',
        ownerId: owner.id,
        roomName: meetingId,
        status: 'recording_ready',
        startedAt: now,
        endedAt: endedAt,
      },
    });
    console.log(`✓ Meeting создан: ${meetingId}`);

    const expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    await prisma.recording.create({
      data: {
        id: recordingId,
        meetingId,
        status: 'ready',
        retentionDays: 30,
        expiresAt,
        bytesTotal: BigInt(audioBuffer.byteLength),
        durationSeconds: 10,
      },
    });
    console.log(`✓ Recording создан: ${recordingId}`);

    await prisma.audioTrack.create({
      data: {
        id: trackId,
        recordingId,
        participantName: 'Test Speaker',
        livekitIdentity: 'test-speaker-001',
        trackId: 'TR_smoke_test',
        audioUrl: fakeUrl,
        startedAt: now,
        endedAt: endedAt,
        durationSeconds: 10,
        bytes: BigInt(audioBuffer.byteLength),
      },
    });
    console.log(`✓ AudioTrack создан с URL: ${fakeUrl}`);
  } finally {
    await prisma.$disconnect();
  }

  const redisUrl = new URL(REDIS_URL);
  const redisOpts = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
    password: redisUrl.password || undefined,
    db: redisUrl.pathname ? parseInt(redisUrl.pathname.slice(1) || '0') : 0,
  };

  const queue = new Queue('ai.transcribe', { connection: redisOpts });
  const job = await queue.add(
    'transcribe',
    { meetingId },
    { attempts: 1, removeOnComplete: false, removeOnFail: false },
  );
  await queue.close();
  console.log(`\n✓ Задача поставлена в ai.transcribe: jobId=${job.id}`);

  console.log('\n⏳ Ждём результата транскрипции (до 3 минут)...');
  const indexKey = `transcripts/${meetingId}/index.json`;
  const maxWaitMs = 3 * 60 * 1000;
  const checkIntervalMs = 5000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(checkIntervalMs);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    const prisma2 = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
    try {
      const meeting = await prisma2.meeting.findUnique({
        where: { id: meetingId },
        include: { transcript: true },
      });

      console.log(
        `  [${elapsed}s] Meeting status: ${meeting?.status ?? '??'} | transcript: ${meeting?.transcript ? 'есть' : 'нет'}`,
      );

      if (meeting?.transcript?.rawIndexS3Url) {
        console.log(`\n✓ Транскрипция готова! rawIndexS3Url = ${meeting.transcript.rawIndexS3Url}`);
        try {
          const response = await s3.send(
            new GetObjectCommand({
              Bucket: S3_BUCKET,
              Key: meeting.transcript.rawIndexS3Url,
            }),
          );
          const body = response.Body as unknown as {
            transformToByteArray: () => Promise<Uint8Array>;
          };
          const bytes = await body.transformToByteArray();
          const indexJson = JSON.parse(Buffer.from(bytes).toString('utf8'));
          console.log('\n=== index.json ===');
          console.log(JSON.stringify(indexJson, null, 2).slice(0, 2000));

          if (indexJson.tracks?.[0]?.s3Key) {
            const trackResponse = await s3.send(
              new GetObjectCommand({
                Bucket: S3_BUCKET,
                Key: indexJson.tracks[0].s3Key,
              }),
            );
            const trackBody = trackResponse.Body as unknown as {
              transformToByteArray: () => Promise<Uint8Array>;
            };
            const trackBytes = await trackBody.transformToByteArray();
            const trackJson = JSON.parse(Buffer.from(trackBytes).toString('utf8'));
            console.log('\n=== track-*.json (первые 500 chars transcript) ===');
            console.log(
              JSON.stringify(
                {
                  speakerName: trackJson.speakerName,
                  durationSeconds: trackJson.durationSeconds,
                  transcriptText: trackJson.transcriptText?.slice(0, 500),
                  wordsCount: trackJson.words?.length,
                },
                null,
                2,
              ),
            );
          }
        } catch (e) {
          console.log('  (S3 download error:', e instanceof Error ? e.message : String(e), ')');
        }
        console.log('\n✅ SMOKE ТЕСТ ПРОЙДЕН!');
        await queue.close().catch(() => {});
        break;
      }

      if (meeting?.status === 'failed') {
        console.log(`\n❌ Meeting перешёл в failed. failureReason: ${meeting.failureReason}`);
        break;
      }
    } finally {
      await prisma2.$disconnect();
    }
  }

  if (Date.now() - startedAt >= maxWaitMs) {
    console.log('\n⏰ Timeout — транскрипция не завершилась за 3 минуты.');
  }

  console.log('\n=== smoke-transcribe: завершено ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('smoke-transcribe FATAL:', err);
  process.exit(1);
});
