/**
 * Разовый smoke-зонд Vox-диаризации (ТЗ 2026-06-08 meeting-upload, Фаза 0).
 *
 * НЕ часть приложения. Цель — увидеть РЕАЛЬНЫЙ ответ Vox в режиме диаризации
 * (разделение одного аудиопотока по говорящим) до написания парсера:
 *   - под каким ключом приходят сегменты со спикерами;
 *   - формат метки `speaker`;
 *   - единицы таймингов `start`/`end` (секунды или миллисекунды);
 *   - поведение numSpeakers / speakerMode.
 *
 * Запуск (токен и URL берутся из корневого .env, как у diag.ts):
 *   bun run --env-file=c:/work/z/.env c:/work/z/backend/scripts/smoke-vox-diarization.ts <audioPath> [numSpeakers]
 *
 * Пример:
 *   bun run --env-file=c:/work/z/.env c:/work/z/backend/scripts/smoke-vox-diarization.ts c:/work/z/5c3c05f254337db7bd13efc9359817e7.mp3
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const filePath = process.argv[2];
const numSpeakers = process.argv[3] ? Number(process.argv[3]) : undefined;
if (!filePath) {
  console.error('Usage: smoke-vox-diarization.ts <audioPath> [numSpeakers]');
  process.exit(1);
}

const VOX_API_URL = process.env.VOX_API_URL ?? 'https://vox.agent-lia.ru';
const VOX_API_TOKEN = process.env.VOX_API_TOKEN;
const VOX_MODEL = process.env.VOX_MODEL ?? 'v3_e2e_rnnt';
const VOX_PUNCT = process.env.VOX_PUNCTUATION_MODE ?? 'pro';
if (!VOX_API_TOKEN) {
  console.error('VOX_API_TOKEN не задан в .env');
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.amr': 'audio/amr',
};
const ext = extname(filePath).toLowerCase();
const contentType = MIME[ext] ?? 'application/octet-stream';

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      const p = JSON.parse(v);
      return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const buf = readFileSync(filePath);
  const sizeMb = (statSync(filePath).size / 1024 / 1024).toFixed(2);
  console.log(
    `Файл: ${basename(filePath)} (${sizeMb} МБ, ${contentType}) · модель=${VOX_MODEL} · punct=${VOX_PUNCT} · numSpeakers=${numSpeakers ?? 'auto'} · diarizationEnabled=true`,
  );

  // ── submit ──
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type: contentType }), basename(filePath));
  form.append('model', VOX_MODEL);
  form.append('punctuationMode', VOX_PUNCT);
  form.append('diarizationEnabled', 'true');
  if (numSpeakers && Number.isFinite(numSpeakers)) form.append('numSpeakers', String(numSpeakers));

  const subRes = await fetch(`${VOX_API_URL}/api/v1/transcription/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VOX_API_TOKEN}` },
    body: form,
  });
  const subText = await subRes.text();
  if (!subRes.ok) {
    console.error(`submit ${subRes.status}: ${subText}`);
    process.exit(1);
  }
  const taskId = (JSON.parse(subText) as { taskId?: string }).taskId;
  if (!taskId) {
    console.error(`submit OK, но нет taskId: ${subText}`);
    process.exit(1);
  }
  console.log(`taskId=${taskId} — ждём результат…`);

  // ── poll ──
  let raw: Record<string, unknown> | undefined;
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const r = await fetch(`${VOX_API_URL}/api/v1/transcription/task/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${VOX_API_TOKEN}` },
    });
    if (!r.ok) {
      process.stdout.write(`\r poll ${r.status} (попытка ${i + 1})        `);
      continue;
    }
    raw = (await r.json()) as Record<string, unknown>;
    const st = String(raw.status ?? '').toUpperCase();
    process.stdout.write(`\r статус=${st} (попытка ${i + 1})        `);
    if (st === 'COMPLETED' || st === 'FAILED') break;
  }
  console.log('');

  if (!raw) {
    console.error('Нет ответа от Vox (таймаут).');
    process.exit(1);
  }
  if (String(raw.status).toUpperCase() === 'FAILED') {
    console.error(`Vox FAILED: ${JSON.stringify(raw)}`);
    process.exit(1);
  }

  // ── разбор ──
  console.log('\n──────── ВЕРХНИЙ УРОВЕНЬ ────────');
  console.log('ключи:', Object.keys(raw));
  console.log('durationSeconds:', raw.durationSeconds ?? raw.duration_seconds ?? '?');
  console.log('transcriptText (первые 160):', String(raw.transcriptText ?? raw.text ?? '').slice(0, 160));

  const er = asRecord(raw.extendedResult);
  console.log('\n──────── extendedResult ────────');
  console.log('тип:', Array.isArray(raw.extendedResult) ? 'array' : typeof raw.extendedResult);
  console.log('ключи:', er ? Object.keys(er) : '(нет)');

  const segsRaw = (er?.segments ?? (raw as Record<string, unknown>).segments ?? []) as unknown[];
  console.log(`\nсегментов: ${Array.isArray(segsRaw) ? segsRaw.length : 0}`);

  if (Array.isArray(segsRaw) && segsRaw.length > 0) {
    console.log('первый сегмент (сырой):', JSON.stringify(segsRaw[0]));
    const speakers = [...new Set(segsRaw.map((s) => (s as Record<string, unknown>).speaker))];
    console.log('различных спикеров:', JSON.stringify(speakers));
    const maxEnd = Math.max(
      ...segsRaw.map((s) => Number((s as Record<string, unknown>).end) || 0),
    );
    const dur = Number(raw.durationSeconds ?? er?.durationSeconds ?? 0);
    console.log(
      `макс end=${maxEnd} · durationSeconds=${dur} → единицы похожи на ${
        dur > 0 && maxEnd > dur * 100 ? 'МИЛЛИСЕКУНДЫ' : 'СЕКУНДЫ'
      }`,
    );
    console.log('\n──── первые 15 реплик (speaker | start-end | text) ────');
    for (const s of segsRaw.slice(0, 15)) {
      const o = s as Record<string, unknown>;
      console.log(`[${o.speaker}] ${o.start}-${o.end}: ${String(o.text ?? '').slice(0, 90)}`);
    }
  } else {
    console.log('segments пуст / не найден — печатаю extendedResult целиком для ручного разбора:');
    console.log(JSON.stringify(er ?? raw, null, 2).slice(0, 5000));
  }

  console.log('\nдиаризация-мета:', JSON.stringify(er?.diarization ?? null));
  console.log('\nГОТОВО. Зафиксировать в ТЗ: формат speaker, единицы start/end, поведение numSpeakers.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
