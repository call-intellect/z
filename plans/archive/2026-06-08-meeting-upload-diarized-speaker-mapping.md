---
type: tz
status: ready-to-implement
feature: meeting-upload-diarized-speaker-mapping
date: 2026-06-08
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-07-agent-pipeline-trace-and-catalog.md
  - docs/operations/feature-flags.md
  - docs/operations/prod-deploy-log.md
supersedes: null
---
> Финальная версия (v2). Контракт Vox **подтверждён живым smoke-тестом** (Фаза 0 ✅). Доказательство выбора, картография кода, контракты, форматы и UI-макеты — внутри. Статус согласования с владельцем: 2026-06-08 (развилки Р1–Р6 закрыты).

# ТЗ — Загрузка встреч вручную (видео/аудио) с диаризацией и двухэтапной подписью говорящих

## 📌 Заметка для агента-исполнителя (порядок чтения)
1. Прочитай корневой `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты Z), затем этот файл целиком.
2. Источник правды о формате ответа Vox — раздел **«Контракт Vox API»** (подтверждён smoke-тестом, не угадывай).
3. Реализуй **строго по фазам** (Ф1→Ф6; Ф0 уже выполнена). Каждая фаза самодостаточна: своя картография `path:line`, «Что НЕ входит», машинная Acceptance.
4. `path:line` — это якоря на момент написания; перед правкой **перечитай файл** и ищи по уникальному символу/тексту (номера строк дрейфуют).
5. БД — **версионируемая миграция** (`bun run prisma:migrate -- --name …`), НЕ `db push`. В скриптах — `createPrismaClient()`, импорты из `../src`. ENV — только через `TypedConfigService`.
6. Не трогай боевой живой путь (`transcribe.worker`/`merge.worker`) — загрузка идёт отдельными воркерами и сходится с хвостом анализа через существующие `enqueue*`.

## Цель

Дать второй способ завести встречу помимо живого звонка LiveKit: **загрузить готовый файл** — видео ИЛИ аудио **любого формата** (Zoom, Яндекс.Телемост, Teams, веб-форматы, мобильные, экзотика). Из видео извлекается аудио; аудио уходит в наш Vox (self-hosted ASR — распознавание речи на `vox.agent-lia.ru`) **в режиме диаризации** (diarization — авторазделение одного потока по говорящим). На выходе — текст, разбитый по обезличенным говорящим. Пользователь **подписывает каждого говорящего** (имя + кто это: сотрудник из своих, либо внешний человек с компанией/должностью) и нажимает «Готов» — **только после этого** запускается весь анализ (отчёт под тип встречи, граф знаний, дашборды) с настоящими именами.

### Зачем (болезненное состояние)
Сейчас единственный источник встречи — живой звонок. Любая запись, сделанная вне Z (старый звонок, телефонный разговор, внешняя встреча), в продукт **не попадает** — а Z позиционируется как «память компании», и расширение входного канала прямо растит граф знаний. Технически живой конвейер получает роли «бесплатно»: каждый участник пишется отдельной дорожкой (`AudioTrack` per `livekitIdentity`), Vox гоняется по каждой дорожке с `diarizationEnabled=false`. У загруженного файла дорожек нет — все в одном потоке, разделить может только Vox-диаризация. Поэтому это **не «кнопка»**, а новая «голова» конвейера, сходящаяся с существующим хвостом.

## REALITY-CHECK (фактическое состояние кода на 2026-06-08)

Переиспользуется как есть (≈80% конвейера):
- ASR-клиент `VoxService.submit/poll` — [vox.service.ts](../../backend/src/modules/ai/services/vox.service.ts). Флаг `diarizationEnabled` уже прокинут ([vox.service.ts:75,93](../../backend/src/modules/ai/services/vox.service.ts#L75)), но **ответ диаризации не парсится** (только `word/startMs/endMs`).
- ffmpeg **есть в прод-образе** ([Dockerfile:47](../../backend/Dockerfile#L47) — `apk add … ffmpeg`, база `oven/bun:1.3-alpine`); готовый spawn-хелпер `runFfmpeg(args)` в [faststart.worker.ts:157](../../backend/src/modules/recordings/workers/faststart.worker.ts#L157) (temp-dir через `mkdtemp(join(tmpdir(),'z-faststart-'))`, скачивание из S3 в файл, stderr-буфер 64 КБ, проверка exit-code, cleanup в `finally`). Тот же паттерн в clip-render. **`ffprobe` пока НЕ используется** (идёт в том же apk-пакете — доступен).
- S3-слой `S3Service` — [s3.service.ts](../../backend/src/modules/recordings/s3.service.ts): `presignGet`, `getObject`, `putObject`, `putJson`, `delete`. **`presignPut` отсутствует** — прямой загрузки из браузера нет.
- Хвост: `Transcript.turns` (`DialogTurn[]`) → analyze/behavior-metrics/report-fast → knowledge-core → дашборды. Точка построения turns — [merge.worker.ts](../../backend/src/modules/ai/workers/merge.worker.ts).
- Модели `Participant` (role host/guest, `personId`/`userId`), `Person` (`relationship` employee/external/…), резолюция «кто сказал» → Entity через `speakerParticipantId` (сильнее всего) в [entity-resolution.service.ts](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts). Отображение транскрипта — `TranscriptTab` [MeetingResultPageReal.tsx:1249](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L1249).
- Дизайн-система: токены `bg-*`/`fg-*`/`accent*`/`chip-{success,warning,danger,info,lavender,sand}-bg/-fg`; компоненты `@/ui/shadcn/{button,badge,dialog,input,dropdown-menu,select,popover}`, `@/ui/components/shared/Chip`, **`@/ui/shared/ParticipantPicker`** (готовый поиск сотрудника/персоны с автоподстановкой и quick-create). i18n — `t('namespace.key')`, строки в [ru.ts](../../frontend/src/lib/i18n/ru.ts).
- Биллинг встреч — `MeetingsBalance`; ASR-минуты **не тарифицируются** (`AiUsageLog` пишет vox `costUsd:0`, observability).

Отсутствует / надо создать (это и есть остаток scope):
- ❌ Парсинг диаризации Vox (segments→speaker).
- ❌ `Meeting.source` (livekit|upload).
- ❌ Гейт перед анализом: `merge.worker` ставит analyze+behavior+report-fast **безусловно** ([merge.worker.ts:210-216](../../backend/src/modules/ai/workers/merge.worker.ts#L210)). Нужен статус `awaiting_speakers`.
- ❌ Транспорт загрузки: нет `presignPut`, нет endpoint загрузки медиа (существующие Multer-аплоады 10–25 МБ для картинок — не подходят под 2 ГБ).
- ❌ `ffprobe`-проверка + нормализация произвольного формата.
- ❌ Поля внешнего человека: `Person.company`/`jobTitle` отсутствуют.
- ❌ UI загрузки и подписи говорящих.

Параллельных сессий/веток/ТЗ по фиче нет (`git log --since`, `ls plans/tz | grep upload` — пусто на 2026-06-08).

## Принятые решения владельца (2026-06-08, не пересматривать без явного запроса)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Двухэтапно: (1) загрузка→диаризация→показ текста с обезличенными говорящими и подпись; (2) кнопка «Готов» → запуск анализа. Анализ НЕ стартует до «Готов». | Метки диаризации обезличенные и позиционные — на разных загрузках «Человек 1/2» меняются местами. Сопоставить надо ДО анализа, иначе отчёт/граф привяжутся к неверным людям. |
| Р2 | Подпись «один раз → меняется во всей расшифровке». Действий = числу говорящих (2–5). Доступны: назвать, **объединить** двух говорящих, **исключить** говорящего-шум. | Удобство для не-разработчика; защита от ошибок диаризации (over-segmentation). |
| Р3 | Внешний человек = имя + «кто это» (компания/должность). Каждый названный (и сотрудник, и внешний) сохраняется как `Person` и переиспользуется в следующих загрузках. | «Закладываем базу»: повторная подпись быстрее, человек сразу в графе/памяти. |
| Р4 | Лимит файла — **2 ГБ / до 4 часов**. | Покрывает почти любой реальный звонок; один presigned-PUT в S3 без нагрузки на бэкенд. |
| Р5 | Тарификация — **отдельный лимит на загрузки** (НЕ списывать `MeetingsBalance`); счётчик загрузок/мес на Org, настраивается в админке. | Загрузки не «съедают» баланс живых встреч; защита от безлимитной нагрузки на ASR. |
| Р6 | Хранение сырого медиа — **как у записей: 30 дней, настраивается** (`DEFAULT_RETENTION_DAYS`). | Единая политика; расшифровка/отчёт/граф хранятся всегда, истекает только сырой файл. |

## Доказательство выбора (два прохода + challenge-loop)

**Проход A — «диаризация → turns напрямую».** Отдельный воркер берёт ОДИН аудиофайл, зовёт Vox с `diarizationEnabled`, строит `Transcript.turns` напрямую из `extendedResult.segments[]` (segment = turn). Живой per-track конвейер не трогается. Гейт через статус `awaiting_speakers`.

**Проход B — «синтетические дорожки → reuse merge».** После диаризации режем поток на N виртуальных `TranscriptTrack` (по говорящему) и отдаём существующему `merge.worker`.

| Критерий | A (turns напрямую) | B (синтетические дорожки) |
|---|---|---|
| Не трогает боевой живой путь | ✓ отдельный воркер | ✗ ветвит/нагружает `merge.worker` |
| Соответствие формату Vox (segments уже interleaved по времени) | ✓ 1:1 | ✗ режем и снова мержим — двойная работа, риск пере-сортировки |
| Точная атрибуция (`speakerParticipantId`) | ✓ | ✓ но через лишний слой |
| Правки диаризации (объединить/исключить) | ✓ на уровне turns/маппинга | ✗ сложнее |
| Новая поверхность кода | ✓ минимум | ✗ синтетические `AudioTrack`/`TranscriptTrack` с S3-полями |
| Качество behavior-metrics | ⚠ segment-level (lowConfidence — как уже есть без word-timings) | ⚠ то же |

**Вывод:** A доминирует 5/6, проигрыша нет → выбран **A**.

**Challenge-loop по A:** (1) *корень, не симптом* — закрывает весь класс «внешний источник» (видео+аудио, любой формат, любое число говорящих); (2) *эффективность* — один вызов Vox без re-merge; resumable-multipart НЕ вводим (преждевременно при 2 ГБ, **vNext-триггер: лимит >5 ГБ**); (3) *нет кода ради кода* — переиспользуем VoxService, `runFfmpeg`, S3Service, Recording, faststart, Participant/Person, entity-resolution, transcript GET, analyze-хвост, `ParticipantPicker`.

## Контракты (единый источник правды)

### Контракт Vox API (✅ ПОДТВЕРЖДЕНО smoke-тестом Фазы 0, 2026-06-08)

**Submit** — `POST /api/v1/transcription/submit` (multipart/form-data):
| Поле | Тип | Дефолт | Прим. |
|---|---|---|---|
| `file` | binary | — | аудио |
| `model` | string | — | `VOX_MODEL` (прод `v3_e2e_rnnt`) |
| `punctuationMode` | string | `basic` | у нас `pro` |
| `diarizationEnabled` | boolean | `false` | **для загрузки = `true`** |
| `speakerMode` | string | `fixed_2` | сам нашёл 2 спикеров без подсказки (проверено) |
| `numSpeakers` | number | — | точное число (подсказка пользователя) |
| `maxSpeakers` | number | `6` | верхняя граница |

**Result** — `GET /api/v1/transcription/task/{taskId}` (реальный звонок 291 с, 2 говорящих, скрипт `backend/scripts/smoke-vox-diarization.ts`):
```jsonc
{
  "status": "COMPLETED",
  "transcriptText": "…",            // полный текст — верхний уровень
  "durationSeconds": 291.46,        // верхний уровень
  "diarizationEnabled": true,
  "speakerMode": "fixed_2",
  "extendedResult": {
    "segments": [
      { "start": 2.146, "end": 2.654, "speaker": "SPEAKER 1", "speaker_id": 1, "text": "Алло." }
    ],
    "speaker_text": "…", "speaker_text_with_timestamps": "…", "raw_text": "…", "normalized_text": "…",
    "role_labeling": { /* доп. попытка ролей оператор/клиент — на будущее, не обязателен */ },
    "merged_segments": [ /* … */ ], "variants": [ /* … */ ],
    "diarization": { "enabled": true, "mode": "fixed_2", "num_speakers": 2, "max_speakers": 6, "assigned_segments_count": 72 }
  }
}
```
✅ **Зафиксированные факты (угадывать нечего):**
- Сегменты — `extendedResult.segments[]`, поля `{ start, end, speaker, speaker_id, text }`.
- `start`/`end` — **СЕКУНДЫ** (float; maxEnd 290.8 ≈ durationSeconds 291.46) → в `DialogTurn.startSec/endSec` БЕЗ конвертации.
- Метка `speaker` — **`"SPEAKER 1"`, `"SPEAKER 2"`** (пробел, 1-indexed); `speaker_id` — целое (1,2,…). `displayLabel` = «Человек {speaker_id}».
- Без `numSpeakers` режим `fixed_2` корректно нашёл 2 говорящих. Для >2 — передавать `numSpeakers` (или опереться на `max_speakers`).

### Форматы и нормализация медиа (читаем ВСЁ)

**Принцип:** НЕ полагаемся на то, что Vox примет произвольный формат — **любой** загруженный файл прогоняется через ffmpeg, который декодирует практически любой контейнер/кодек и приводит аудио к одному формату для ASR. Так покрываются Zoom (mp4/m4a), Яндекс.Телемост, Teams, веб (webm), мобильные (3gp/amr) и экзотика.

**Приём на фронте (UI-валидация, не заменяет серверную):** `accept="video/*,audio/*"` + явный список расширений:
- Видео: `mp4, mov, m4v, webm, mkv, avi, wmv, flv, 3gp, mpeg, ts`.
- Аудио: `mp3, wav, m4a, aac, ogg, oga, opus, flac, amr, wma`.

**Серверная обработка (ingest-воркер, по паттерну `runFfmpeg`):**
1. **`ffprobe`** входного файла → есть ли аудио-дорожка и какие кодеки:
   ```
   ffprobe -v error -show_streams -show_format -of json <src>
   ```
   - Нет аудио-дорожки → FSM `failed`, код `UPLOAD_NO_AUDIO_STREAM` (видео без звука).
   - ffprobe/ffmpeg не смог декодировать → FSM `failed`, код `UPLOAD_DECODE_FAILED`.
2. **Извлечь+нормализовать аудио для Vox** (mono 16 кГц — совпадает с внутренним профилем Vox из Ф0 `audio_profile: {channels:1, sample_rate:16000}`):
   ```
   ffmpeg -hide_banner -y -i <src> -vn -ac 1 -ar 16000 -c:a libopus -b:a 24k <audio.ogg>
   ```
   Fallback, если энкодера opus нет в образе: `-c:a pcm_s16le <audio.wav>`.
3. **Видео для плеера:**
   - Если контейнер браузеро-нативный mp4 (h264+aac) → faststart-ремукс существующим воркером (`-c copy -movflags +faststart`), записать `Recording.mainVideoUrl` → плеер как у живой встречи (`presignComposite`, форс `video/mp4 inline`).
   - Иначе (webm/mkv/mov/avi/wmv/flv…) → инлайн-видео не делаем (без дорогого транскода); на странице результата играет нормализованное **аудио** + ссылка «скачать оригинал». **vNext-триггер:** если потребуется инлайн-видео для не-нативных — добавить транскод в mp4 h264/aac.
   - Аудио-загрузка (нет видео-дорожки) → только аудио-плеер.

**Проверка декодеров в прод-образе (Acceptance Фазы 2):**
```
ffmpeg -hide_banner -decoders | grep -E "h264|aac|mp3|opus|vorbis|flac|amrnb"
ffmpeg -hide_banner -encoders | grep -E "libopus|pcm_s16le"
ffprobe -version
```
Если каких-то декодеров нет — добавить нужные пакеты в [Dockerfile](../../backend/Dockerfile) (сейчас `apk add … ffmpeg`).

### Prisma (БД — миграция `bun run prisma:migrate -- --name meeting_upload_diarization`, НЕ db push)

```prisma
enum MeetingSource {
  livekit
  upload
}

enum UploadSpeakerAssignment {
  unassigned
  employee
  external
  excluded
}
```
В `enum MeetingStatus` ([schema.prisma:71](../../backend/prisma/schema.prisma#L71)) добавить **между `transcription_ready` и `ai_processing`**:
```prisma
  transcription_ready
  awaiting_speakers   /// upload-only: текст готов, ждём подписи говорящих (Р1). Анализ — по «Готов».
  ai_processing
```
В `model Meeting` ([schema.prisma:1159](../../backend/prisma/schema.prisma#L1159)):
```prisma
  source                MeetingSource @default(livekit)
  /// Для source=upload: подсказка числа говорящих (Vox numSpeakers). NULL = авто.
  uploadNumSpeakersHint Int?
  uploadSpeakers        MeetingUploadSpeaker[]
  // + @@index([tenantId, source, createdAt]) — подсчёт лимита загрузок/мес (Р5)
```
В `model Person` ([schema.prisma:4514](../../backend/prisma/schema.prisma#L4514)):
```prisma
  /// Для relationship=external — компания/работодатель (свободный текст). Подпись говорящих (Р3).
  company  String? @db.VarChar(200)
  /// Должность внешнего человека. У сотрудников роль идёт через PersonRole/Appointment.
  jobTitle String? @db.VarChar(200)
  uploadSpeakers MeetingUploadSpeaker[]
```
Новая модель:
```prisma
model MeetingUploadSpeaker {
  id               String                  @id @default(cuid())
  meetingId        String
  meeting          Meeting                 @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  /// Сырая метка Vox ("SPEAKER 1"). Уникальна в пределах встречи.
  label            String
  /// Отображаемая метка до подписи ("Человек 1").
  displayLabel     String
  turnsCount       Int                     @default(0)
  speakingSeconds  Int                     @default(0)
  /// Репрезентативный фрагмент (самая длинная реплика) — подсказка для опознания.
  sampleText       String                  @db.Text
  assignment       UploadSpeakerAssignment @default(unassigned)
  personId         String?
  person           Person?                 @relation(fields: [personId], references: [id], onDelete: SetNull)
  externalName     String?                 @db.VarChar(200)
  externalCompany  String?                 @db.VarChar(200)
  externalPosition String?                 @db.VarChar(200)
  /// Объединение (Р2): этот говорящий = тот же, что `mergedIntoLabel`.
  mergedIntoLabel  String?
  /// Участник, созданный на confirm (идемпотентность повторного confirm).
  participantId    String?
  createdAt        DateTime                @default(now())
  updatedAt        DateTime                @updatedAt

  @@unique([meetingId, label])
  @@index([meetingId])
}
```

### Vox-типы — [vox.types.ts](../../backend/src/modules/ai/services/vox.types.ts)
```ts
export interface VoxSubmitOptions {
  language?: VoxLanguage;
  punctuationMode?: VoxPunctuationMode;
  diarizationEnabled?: boolean;
  speakerMode?: string;     // 'fixed_2' (дефолт Vox)
  numSpeakers?: number;
  maxSpeakers?: number;
}
/** Сегмент диаризации (turn-level). Подтверждено Ф0: start/end — секунды (без конвертации). */
export interface VoxDiarizedSegment {
  startSec: number;         // = segment.start (сек)
  endSec: number;           // = segment.end (сек)
  speaker: string;          // сырая метка ("SPEAKER 1")
  speakerId: number;        // segment.speaker_id (1,2,…) → «Человек N»
  text: string;
}
// В VoxResult добавить: segments?: VoxDiarizedSegment[];
```

### REST-эндпоинты (Zod-DTO `nestjs-zod` + Swagger; префикс `/api/v1`; `TenantGuard` + `@RequireEntitlement('feature.meeting')`)

| Метод · путь | Body | Ответ | Коды ошибок |
|---|---|---|---|
| `POST /meetings/upload` | `UploadCreateSchema` | `{ meetingId, uploadUrl, uploadKey, expiresAt }` | `UPLOAD_DISABLED`, `UPLOAD_QUOTA_EXCEEDED`, `UPLOAD_FILE_TOO_LARGE`, `UPLOAD_UNSUPPORTED_FORMAT` |
| `POST /meetings/:id/upload/complete` | `{}` | `202 { status }` | `MEETING_NOT_FOUND`, `UPLOAD_NOT_PENDING` |
| `GET /meetings/:id/speakers` | — | `{ speakers: UploadSpeakerDto[], turns: TranscriptTurn[] }` | `MEETING_NOT_FOUND`, `SPEAKERS_NOT_READY` |
| `PUT /meetings/:id/speakers` | `SpeakerAssignmentsSchema` | `{ speakers: UploadSpeakerDto[] }` | `MEETING_NOT_AWAITING_SPEAKERS`, `INVALID_SPEAKER_LABEL`, `INVALID_PERSON` |
| `POST /meetings/:id/speakers/confirm` | `{}` | `202 { status }` | `MEETING_NOT_AWAITING_SPEAKERS`, `SPEAKERS_NOT_FULLY_ASSIGNED` |
| `GET /meetings/:id/upload/playback` | — | `{ kind: 'video'\|'audio', url, expiresAt }` | `MEETING_NOT_FOUND`, `MEDIA_NOT_READY` |
| (ingest-воркер) | — | — | `UPLOAD_NO_AUDIO_STREAM`, `UPLOAD_DECODE_FAILED` |

```ts
export const UploadCreateSchema = z.object({
  type: z.nativeEnum(MeetingType),
  title: z.string().min(1).max(200),
  customPrompt: z.string().max(10000).nullish(),
  fileName: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024), // Р4
  numSpeakersHint: z.number().int().min(1).max(20).nullish(),
});
export const SpeakerAssignmentSchema = z.object({
  label: z.string().min(1),
  assignment: z.enum(['unassigned', 'employee', 'external', 'excluded']),
  personId: z.string().nullish(),               // employee
  externalName: z.string().max(200).nullish(),  // external
  externalCompany: z.string().max(200).nullish(),
  externalPosition: z.string().max(200).nullish(),
  mergedIntoLabel: z.string().nullish(),        // объединение (Р2)
});
export const SpeakerAssignmentsSchema = z.object({
  assignments: z.array(SpeakerAssignmentSchema).min(1).max(20),
});
```

### Очереди BullMQ (новый модуль `meeting-uploads`, воркеры регистрируются в [workers.module.ts](../../backend/src/modules/ai/workers.module.ts), concurrency=1 как ffmpeg-воркеры)

| Queue | jobId | Payload | Воркер делает |
|---|---|---|---|
| `meeting.upload-ingest` | `meeting_upload_ingest_${meetingId}` | `{ meetingId }` | ffprobe → видео→faststart mp4 (playback, если нативный) + извлечь/нормализовать аудио; `Recording(ready)`; FSM→`recording_ready`; enqueue upload-transcribe |
| `meeting.upload-transcribe` | `meeting_upload_transcribe_${meetingId}` | `{ meetingId }` | Vox submit(diarization)+poll → `Transcript.turns` из segments + `MeetingUploadSpeaker[]`; FSM→`awaiting_speakers`; **анализ НЕ ставить** |

> jobId через `_` (не `:`) — ограничение BullMQ Custom Id (как `transcript-clean_${meetingId}`).

### Поток (ASCII)
```
[Браузер] POST /meetings/upload ──► Meeting(source=upload, status=scheduled) + presigned PUT
   │  PUT файла напрямую в S3 (Р4 ≤2 ГБ)
   └─ POST /meetings/:id/upload/complete ──► queue meeting.upload-ingest
   ffprobe → [видео нативн.]→faststart.mp4 (mainVideoUrl) ; извлечь+норм. аудио (mono 16к ogg/opus)
   Recording(ready, retention 30д) ; FSM scheduled→recording_processing→recording_ready
                                  ──► queue meeting.upload-transcribe
   Vox(diarizationEnabled, numSpeakers?) → segments[] → Transcript.turns + MeetingUploadSpeaker[]
   FSM recording_ready→transcription_processing→awaiting_speakers          ⟵ СТОП. Анализ не идёт.
   ───────────────────────────────────────────────────────────────────────
   [UI Этап 1] GET /speakers → панель говорящих + лента ; PUT /speakers (черновик)
   [Готов]    POST /speakers/confirm
                 Participant'ы (+Person external: company/jobTitle, relationship=external)
                 relabel Transcript.turns (speaker=имя, speakerParticipantId ; excluded→убрать ; merged→один)
                 FSM awaiting_speakers→ai_processing
                 enqueueAnalyze + enqueueBehaviorMetrics + maybeEnqueueMeetingReportFast   ⟵ дальше как у живой
```

## UI/UX дизайн (макеты и размещение)

> Принцип Р2: пользователь работает с **говорящими** (их 2–5), не с репликами (их сотни). Подписал один раз → перекрасилось и переподписалось во всей ленте мгновенно, до «Готов». Всё на русском; парные токены `bg-*`+`text-*-fg`, никаких `text-white`/hex.

### 1. Точка входа
Кнопку «Новая» в журнале ([MeetingsJournalReal.tsx:296](../../frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx#L296)) превратить в `DropdownMenu` (`@/ui/shadcn/dropdown-menu`):
```
Мои встречи                         [ Новая ▾ ]
                                    ├ ➕ Создать встречу     → /meetings/create
                                    └ ⬆ Загрузить запись     → /meetings/upload
```

### 2. Экран загрузки (`/meetings/upload`) — мастер из 2 шагов (зеркалит `CreateMeetingFormV2` step 'pick'→'configure')
```
Загрузить запись встречи
─ Шаг 1 · Тип встречи ──────────────────────────────
  [галерея карточек типов — как в создании, тот же markup]
─ Шаг 2 · Файл и детали ────────────────────────────
  ┌───────────────────────────────────────────────┐
  │   ⬆  Перетащите видео или аудио                │   ← dropzone (зеркало
  │      или нажмите, чтобы выбрать                │     DocumentsListClient:
  │   mp4·mov·mkv·webm·mp3·m4a·wav…  до 2 ГБ        │     dashed, accent на drag-over)
  └───────────────────────────────────────────────┘
  Название встречи *      [_____________________________]
  Сколько говорящих?      [ Авто ▾ ]   (необязательно)
                                          [ Загрузить и распознать ]
```
Загрузка: прямой `PUT` файла в S3 по presigned-URL с индикатором прогресса (raw `fetch`, мимо JSON-only `api-client.ts`) → `POST /upload/complete` → экран «Распознаём речь…» (поллинг статуса). Превышение лимита/формат — тосты по кодам ошибок.

### 3. Экран подписи говорящих (`/meetings/[id]/speakers`) — главный экран Этапа 1
```
← Назад        Подпишите говорящих           Подписано 1 из 3   [ Готов ]
┌─ Говорящие ──────────────────┐  ┌─ Расшифровка ───────────────────────┐
│ ● Человек 1   [ Подписать ▾ ] │  │ 00:02  ● Сергей: Алло.               │
│   «Давайте начнём с цифр…»     │  │ 00:05  ○ Человек 2: Здравствуйте…   │
│   42 реплики · 61% времени     │  │ 00:12  ● Сергей: к пятнице…          │
│                               │  │ 00:18  ○ Человек 2: Подскажите…      │
│ ○ Человек 2  ▾ (редактирую)   │  │ …                                    │
│  ┌──────────────────────────┐ │  └──────────────────────────────────────┘
│  │ ◉ Сотрудник  ○ Внешний    │ │   [ ▶ ────────○──────── 04:51 ]  аудио
│  │ Сотрудник: [ поиск… ▾ ]   │ │   (видео-плеер вместо аудио, если
│  └──────────────────────────┘ │    загружено mp4-видео)
│ ◍ Человек 3   [Объединить│Исключить]
└───────────────────────────────┘
```
Редактор «Внешний»:
```
○ Внешний
Имя:       [ Оксана________________ ]
Компания:  [ ЖК «Флора и Фауна»_____ ]
Должность: [ Клиент_________________ ]
```
Компоненты и поведение:
- **Каждый говорящий** = строка-чип с цветной точкой (палитра из `chip-*` токенов, своя на спикера), `displayLabel`, статистикой (`turnsCount`, `% времени`), и `sampleText` (самая длинная реплика — подсказка для опознания).
- **Сотрудник** — переиспользовать **`ParticipantPicker`** ([@/ui/shared/ParticipantPicker](../../frontend/src/ui/shared/ParticipantPicker.tsx)) в одиночном режиме (поиск персоны/сотрудника с автоподстановкой). **Внешний** — свои поля имя/компания/должность (у `ParticipantPicker` их нет).
- **Живая замена:** правка в панели мгновенно перекрашивает и переподписывает реплики этого говорящего в ленте (локальный стейт, до confirm).
- **Объединить** (Р2) — «Это тот же человек»: две метки → один итоговый участник. **Исключить** — шум: реплики метки серые и уйдут из анализа.
- **«Готов»** активна, когда все говорящие с `speakingSeconds>0` подписаны или исключены → `POST /speakers/confirm`.
- Бонус (vNext, не блок): предзаполнять догадку из Vox `role_labeling` (оператор/клиент), чтобы ускорить подпись.

### 4. Журнал и статусы
- Новый статус `awaiting_speakers` в `STATUS_VIEW` ([meeting.ts:253](../../frontend/src/domain/meeting.ts#L253)): label **«Подпишите говорящих»**, tone `warning` (чип `chip-warning-bg`/`-fg`).
- На карточке такой встречи — CTA в action-row (как «Войти» у joinable): **«Подписать говорящих →»** на `/meetings/[id]/speakers`.
- Во время обработки — существующие label'ы: «Распознаём речь» (`transcription_processing`), после confirm — «Готовим отчёт» → «Отчёт готов».

### 5. Страница результата
Без изменений рендера `turns` (уже показывает `speaker`+`text`, [MeetingResultPageReal.tsx:1249](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L1249)) — после confirm там настоящие имена. Источник медиа для плеера — `GET /upload/playback` (видео если нативное mp4, иначе аудио).

## Scope
**Входит:** загрузка видео/аудио **любого формата** (≤2 ГБ, Р4) presigned-PUT в S3; ffprobe-валидация + ffmpeg-нормализация; faststart видео; Vox-диаризация и парсинг segments; построение turns; статус `awaiting_speakers` и гейт анализа; UI загрузки + экран подписи (один-раз→везде, объединить/исключить, автоподстановка сотрудника, поля внешнего); confirm → Participant/Person + relabel + запуск анализа; отдельный лимит загрузок/мес (Р5, AdminSetting); retention как у записей (Р6); kill-switch `MEETING_UPLOAD_ENABLED`; smoke Vox-диаризации (✅ Ф0).

**Не входит (vNext, с судьбой):**
- Разделение реплики, ошибочно приписанной не тому (только объединение/исключение целых меток — Р2). → vNext при появлении на проде.
- Resumable/multipart upload >5 ГБ. → vNext-триггер: лимит >5 ГБ.
- Транскод не-нативного видео в mp4 для инлайн-плеера. → vNext при запросе.
- Авто-опознание говорящего по голосу / использование Vox `role_labeling` для предзаполнения. → vNext.

## Граничные контракты с другими ТЗ
- Хвост анализа (`ai.analyze`, `core.meeting-report-fast`, knowledge-core) — **не меняем**, дёргаем существующими `AiQueueService.enqueueAnalyze/enqueueBehaviorMetrics` и `CoreQueueService.enqueueMeetingReportFast` (как `merge.worker`).
- Видео-плеер результата (`presignComposite` → `Recording.mainVideoUrl`) — переиспользуем для нативного mp4.

## Фазы (dependency-ordered)
Граф: **Ф0 ✅** → Ф1(schema) → {Ф2(upload+ingest+форматы), Ф3(diarized transcribe)} → Ф4(speakers API) → Ф5(frontend) → Ф6(flags/quota/prod). Ф2 и Ф3 параллельны после Ф1.

---

### Фаза 0 — Smoke-тест Vox-диаризации — ✅ ВЫПОЛНЕНО 2026-06-08
**Результат:** `backend/scripts/smoke-vox-diarization.ts` прогнан на реальном звонке (291 с, 2 говорящих) → факты в «Контракт Vox API». Парсер Ф3 пишется под этот факт. Остаётся опц. прогон на файле с 3+ говорящими (проверить `numSpeakers`).
**Закрывает:** R0.

---

### Фаза 1 — Prisma-схема, enum, FSM
**Цель:** структуры данных под загрузку и подпись.
**Что входит:** `MeetingSource`, `UploadSpeakerAssignment`, статус `awaiting_speakers`, `Meeting.source/uploadNumSpeakersHint`, `Person.company/jobTitle`, модель `MeetingUploadSpeaker` (сниппеты выше). FSM `ALLOWED_TRANSITIONS` ([meeting-fsm.ts:25](../../backend/src/modules/meetings/fsm/meeting-fsm.ts#L25)):
```ts
  scheduled: ['active', 'failed', 'recording_processing'],            // + upload-вход
  transcription_processing: ['transcription_ready', 'awaiting_speakers', 'failed', 'ai_failed'],
  awaiting_speakers: ['ai_processing', 'failed', 'ai_failed'],        // новый
```
Миграция `bun run prisma:migrate -- --name meeting_upload_diarization` → ревью SQL → `bun run prisma:generate`.
**Что НЕ входит:** логика, эндпоинты.
**Файлы:** [schema.prisma](../../backend/prisma/schema.prisma), [meeting-fsm.ts](../../backend/src/modules/meetings/fsm/meeting-fsm.ts), `prisma/migrations/*`.
**Acceptance:** `bun run typecheck` зелёный; `grep -E "model MeetingUploadSpeaker|enum MeetingSource|awaiting_speakers"` находит; файл миграции есть; повтор `prisma:migrate` — no-op.
**Закрывает:** R1, R8.

---

### Фаза 2 — Транспорт загрузки + ingest-воркер (форматы/ffmpeg)
**Цель:** загрузить файл в S3 и подготовить медиа к ASR из любого формата.
**Что входит:**
- `S3Service.presignPut(key, contentType, ttl?)` — по образцу `presignGet` ([s3.service.ts:52](../../backend/src/modules/recordings/s3.service.ts#L52)) через `PutObjectCommand` + `getSignedUrl`.
- Модуль `backend/src/modules/meeting-uploads/`: контроллер (`POST /meetings/upload`, `/upload/complete`, `GET /upload/playback`), сервис (создание Meeting `source=upload`; квота Р5; presigned PUT), очередь, `MeetingUploadIngestWorker`.
- S3-ключи: source `meetings/${id}/upload/source.<ext>`, аудио `meetings/${id}/upload/audio.ogg`, видео для плеера — существующий `compositeKey(id)`.
- Ingest-воркер по паттерну `runFfmpeg`/`mkdtemp` ([faststart.worker.ts:119,157](../../backend/src/modules/recordings/workers/faststart.worker.ts#L119)): ffprobe (раздел «Форматы»); извлечь+нормализовать аудио (mono 16к ogg/opus, fallback wav); нативное видео → faststart + `Recording.mainVideoUrl`; `Recording(status=ready, retentionDays=DEFAULT_RETENTION_DAYS, expiresAt)`; FSM `scheduled→recording_processing→recording_ready`; `enqueueUploadTranscribe`. Регистрация воркера в [workers.module.ts](../../backend/src/modules/ai/workers.module.ts) + [workers/main.ts](../../backend/src/workers/main.ts).
**Что НЕ входит:** Vox (Ф3); подпись (Ф4).
**Acceptance:**
- `POST /meetings/upload` (валид) → 201 `{meetingId,uploadUrl,uploadKey,expiresAt}`, Meeting `source=upload,status=scheduled`. Negative: `sizeBytes>2 ГБ` → `UPLOAD_FILE_TOO_LARGE`.
- После PUT + `/upload/complete` → job `meeting.upload-ingest`; на mp4-видео и на mp3-аудио (две фикстуры) → `Recording.status=ready`, аудио-объект в S3, FSM=`recording_ready`, job `meeting.upload-transcribe`. Видео без аудио → `UPLOAD_NO_AUDIO_STREAM`.
- Проверка декодеров (команды из «Форматы») в образе — зелёная.
- Повторный `/upload/complete` идемпотентен.
- `bunx vitest run backend/src/modules/meeting-uploads/*.spec.ts` зелёный (квота; ffmpeg-команда через мок spawn).
**Закрывает:** R2, R3, R5-квота-частично, R6.

---

### Фаза 3 — Диаризованный transcribe-воркер
**Цель:** из одного аудио — текст по говорящим, встать на гейт.
**Что входит:** расширить `VoxService.submit` (`speakerMode/numSpeakers/maxSpeakers`) и `parseVoxResult` (читать `extendedResult.segments[]`→`VoxDiarizedSegment[]`; единицы — секунды, Ф0; **per-track-путь без диаризации не менять**). `MeetingUploadTranscribeWorker`: `submit({diarizationEnabled:true, numSpeakers: meeting.uploadNumSpeakersHint ?? undefined})`, poll; строит `DialogTurn[]` (segment→turn, `speaker=displayLabel «Человек {speaker_id}»`), пишет `Transcript.turns/totalWords/totalDurationSeconds/mergedS3Url` (+merged.json как [merge.worker.ts:182](../../backend/src/modules/ai/workers/merge.worker.ts#L182)); пишет `MeetingUploadSpeaker[]` (label, displayLabel, turnsCount, speakingSeconds, sampleText); FSM `recording_ready→transcription_processing→awaiting_speakers`. **enqueueAnalyze/Behavior/ReportFast НЕ вызывать.**
**Файлы:** [vox.service.ts](../../backend/src/modules/ai/services/vox.service.ts), [vox.types.ts](../../backend/src/modules/ai/services/vox.types.ts), `meeting-uploads/workers/meeting-upload-transcribe.worker.ts`.
**Acceptance:** на фикстуре Vox-ответа (Ф0) → `Transcript.turns` с ≥2 `speaker`, `MeetingUploadSpeaker` = числу меток, статус `awaiting_speakers`; `grep -L "enqueueAnalyze" meeting-upload-transcribe.worker.ts` (нет анализа); per-track `parseVoxResult`-тесты и transcribe.worker.spec остаются зелёными; `bunx vitest run` нового воркера зелёный.
**Закрывает:** R4, R1.

---

### Фаза 4 — API подписи + confirm
**Цель:** прочитать/подписать и по «Готов» запустить анализ с настоящими именами.
**Что входит:** `GET /speakers` (`{speakers, turns}`); `PUT /speakers` (upsert черновика в `MeetingUploadSpeaker`; валидация tenant-принадлежности `personId`, отсутствие циклов `mergedIntoLabel`); `POST /speakers/confirm` (идемпотентно):
1. Валидация: каждый `speakingSeconds>0` имеет `assignment ∈ {employee,external,excluded}` иначе `SPEAKERS_NOT_FULLY_ASSIGNED`.
2. employee→`personId`; external→`Person(relationship=external, name, company, jobTitle, tenantId)` (расширить [persons.service.ts](../../backend/src/modules/persons/services/persons.service.ts) на company/jobTitle; поиск по (tenant,name,company) перед созданием — без дублей).
3. `Participant` (role=guest, personId, `livekitIdentity="upload:<label>"`) на каждую итоговую идентичность (объединённые → один).
4. Relabel `Transcript.turns`: `speaker=имя`, `speakerParticipantId=participant.id`; `excluded`→удалить turns; пере-записать merged.json.
5. FSM `awaiting_speakers→ai_processing`; `enqueueAnalyze + enqueueBehaviorMetrics + maybeEnqueueMeetingReportFast`.
**Acceptance:** неполная подпись→`SPEAKERS_NOT_FULLY_ASSIGNED`, статус не меняется; 1 employee+1 external→2 `Participant` (external с `Person.company/jobTitle`), turns с именами и `speakerParticipantId`, статус `ai_processing`, jobs поставлены; объединение→1 Participant на обе метки; исключение→turns метки удалены; повтор confirm — no-op; `bunx vitest run` сервиса confirm зелёный.
**Закрывает:** R2, R3, R7, R1.

---

### Фаза 5 — Frontend (загрузка + экран подписи)
**Цель:** UX по разделу «UI/UX дизайн».
**Что входит:** DropdownMenu на «Новая»; мастер `/meetings/upload` (тип+заголовок+dropzone+опц. число говорящих; presigned PUT с прогрессом; `/upload/complete`); экран `/meetings/[id]/speakers` (панель говорящих + лента, live-replace, `ParticipantPicker` для сотрудника, поля внешнего, объединить/исключить, «Готов»); статус `awaiting_speakers` в `STATUS_VIEW` + CTA на карточке; плеер из `/upload/playback`. API-методы в [meetings.api.ts](../../frontend/src/api/meetings.api.ts): `createUpload/completeUpload/getSpeakers/putSpeakers/confirmSpeakers/getPlayback`. DomainModel/UiModel для `UploadSpeaker`. Строки — в [ru.ts](../../frontend/src/lib/i18n/ru.ts) (`t()`). UI **только русский**, парные токены.
**Файлы:** `frontend/src/api/meetings.api.ts`, `frontend/src/domain/*`, `frontend/app/(authenticated)/meetings/upload/*`, `frontend/app/(authenticated)/meetings/[id]/speakers/*`, новый компонент панели подписи. Образцы: [CreateMeetingFormV2.tsx](../../frontend/src/ui/components/create-meeting-form/CreateMeetingFormV2.tsx), [DocumentsListClient.tsx:267](../../frontend/app/(authenticated)/documents/DocumentsListClient.tsx#L267), [ParticipantPicker.tsx](../../frontend/src/ui/shared/ParticipantPicker.tsx).
**Acceptance:** `bun run typecheck && lint && build` (frontend) зелёные; подпись одного говорящего меняет ВСЕ его реплики без перезагрузки; grep — ни одного английского слова в новых UI-строках.
**Закрывает:** R2-UX, R6-UX.

---

### Фаза 6 — Флаги, квота, прод-выкат
**Цель:** Ship-On — выкатываем включённым, с рубильником и настраиваемым лимитом.
**Что входит:** ENV `MEETING_UPLOAD_ENABLED` (kill-switch, default `true`) в [env.schema.ts](../../backend/src/common/config/env.schema.ts) + `TypedConfigService` → контроллер `UPLOAD_DISABLED` при OFF; строка в [feature-flags.md](../../docs/operations/feature-flags.md). Квота Р5 — AdminSetting `billing.meetingUploadsPerMonth` (default 20, super_admin, code-fallback, через `getDynamic`/`AdminSettingsService`); enforce: `count(Meeting tenantId, source=upload, deletedAt=null, createdAt в текущем месяце) >= лимит → UPLOAD_QUOTA_EXCEEDED`. prod-deploy-log: Шаг 1 (ENV+флаг), Шаг 4 (миграция enum/модель/статус), Шаг 12 (smoke очередей `meeting.upload-*` + Swagger новых эндпоинтов).
**Acceptance:** `MEETING_UPLOAD_ENABLED=false`→`UPLOAD_DISABLED`; превышение лимита→`UPLOAD_QUOTA_EXCEEDED`, лимит правится в админке без деплоя; feature-flags.md и prod-deploy-log обновлены.
**Закрывает:** R5, Ship-On.

## Требования (трассируемость)
- **R0** — формат Vox-диаризации зафиксирован эмпирически (✅ Ф0).
- **R1** — при `source=upload` анализ НЕ стартует до `/speakers/confirm`.
- **R2** — загрузка видео ИЛИ аудио (любой формат, ≤2 ГБ) → текст по говорящим, подпись «один раз → во всей расшифровке».
- **R3** — из видео извлекается аудио; внешний человек подписывается именем+компанией/должностью и сохраняется как `Person`.
- **R4** — один смешанный поток разбивается по говорящим Vox-диаризацией.
- **R5** — загрузка ограничена отдельным настраиваемым лимитом/мес, НЕ списывает `MeetingsBalance`.
- **R6** — нативное видео проигрывается на результате; сырой файл хранится 30 дней (настраивается).
- **R7** — доступны объединение и исключение говорящих.
- **R8** — `Person` хранит `company`/`jobTitle` для внешних (переиспользование в будущих загрузках).

## Границы фичи
- ✅ Always: переиспользовать VoxService/`runFfmpeg`/S3Service/Recording/faststart/Participant/Person/entity-resolution/analyze-хвост/`ParticipantPicker`; эндпоинты — Zod-DTO+Swagger; UI только русский; FSM только через `transitionStatus`.
- ⚠ Ask first: менять `merge.worker`/`transcribe.worker` живого пути; менять контракт `DialogTurn`; трогать analyze-воркеры.
- 🚫 Never: лить >2 ГБ через бэкенд (только presigned-PUT); анализ до confirm; `new PrismaClient()` в скриптах; `process.env.*` вне TypedConfigService; `db push` для коммита схемы.

## Совместимость с prompt caching
Не релевантно: фича — ASR + детерминированная сборка turns; downstream LLM-цепочка (analyze/report-fast) и её SYSTEM-промпты **не меняются**, кэш не затрагивается.

## Идемпотентность / Ship-On
Воркеры идемпотентны по jobId (`meeting_upload_*_${meetingId}`); confirm — по `MeetingUploadSpeaker.participantId`. Повтор — no-op. Ship-On: выкатываем ВКЛЮЧЁННЫМ; `MEETING_UPLOAD_ENABLED` — рубильник (ON, действий владельца не требует); лимит — AdminSetting с заданным дефолтом (выкат не блокируется).

## Pre-mortem / Риски (для strict-production-review-gate)
- **Единицы Vox** перепутаны → turns нулевой длины. Митигировано Ф0 (секунды) + тест-ассерт.
- **Большой файл через Node** → OOM/timeout. Митигировано presigned-PUT.
- **ffmpeg/декодер/контейнер** не поддержан → ingest падает. Митигировано ffprobe-валидацией + понятные коды `UPLOAD_NO_AUDIO_STREAM`/`UPLOAD_DECODE_FAILED` + проверкой декодеров в образе.
- **Гейт протёк** (analyze до confirm) → отчёт с «Человек N». Митигировано: анализ только в confirm + тест «нет enqueueAnalyze».
- **Дубли Person** при повторной подписи внешнего → поиск по (tenant,name,company); повтор confirm no-op.
- **tenant-утечка** (`personId` чужого tenant) → валидация в `PUT /speakers`.
- **Новый статус не учтён** в фильтрах/виджетах «готовности» → пройти по `STATUS_VIEW` и статус-фильтрам фронта.

## DoD
- `bun run typecheck` (вкл. `.spec`)·`lint`·`build` (backend+frontend) зелёные; релевантные `vitest` зелёные.
- second-brain по таблице производных заметок: `01_projects/<встречи/ai-jobs/workers-queues>.md`, `02_architecture/data-model.md` (модель/поля/enum/статус), `02_architecture/module-map.md` (`meeting-uploads`), `01_projects/api-layer.md` (6 эндпоинтов), `01_projects/frontend-pages.md` (экраны загрузки/подписи), `04_не-сделано/README.md` (vNext: split реплики, multipart >5 ГБ, транскод видео, role_labeling).
- prod-deploy-log (Шаги 1/4/12); новые скрипты (если будут) — в `apply-prod-deploy.ts` `STEPS`.
- feature-flags.md: строка `MEETING_UPLOAD_ENABLED`.
- Рефлексия в `05_история/` после push.

## Итог
_(заполняет tz-orchestrator по завершении: что реализовано целиком, что осталось.)_
