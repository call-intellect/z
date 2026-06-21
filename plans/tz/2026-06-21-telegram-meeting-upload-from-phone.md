---
type: tz
status: ready-to-implement
feature: telegram-meeting-upload-from-phone
date: 2026-06-21
owner: sergrv80@gmail.com
relates_to:
  - plans/analysis/2026-06-21-telegram-upload-meeting-from-phone.md
  - plans/tz/2026-05-26-telegram-via-crossmark-proxy.md
  - second-brain/05_история/2026-06-04-telegram-proxy-static-token.md
  - second-brain/01_projects/telegram-user-flows.md
  - second-brain/01_projects/conversational-channels.md
---

> Анализ: `plans/analysis/2026-06-21-telegram-upload-meeting-from-phone.md` · Статус согласования: 2026-06-21 (решения Р-1…Р-5 закрыты владельцем)

# ТЗ: Загрузка встречи (аудио/видео) с телефона через Telegram-бот

## 1. Цель

Дать пользователю прислать запись встречи (аудио/видео) **в Telegram-бота с телефона** так, чтобы она автоматически прошла штатный конвейер `meeting-uploads` (извлечение медиа → транскрибация → диаризация) и остановилась в статусе `awaiting_speakers`, ожидая разметки спикеров и уточнения типа встречи **с компьютера** на уже существующем экране. После подтверждения спикеров — штатный AI-отчёт по типу встречи, идентичный загрузке через веб.

## 2. Зачем (болезненное состояние → решение)

Сейчас запись встречи можно загрузить **только из веб-кабинета** (presigned-PUT в браузере, `meeting-uploads.controller.ts`). С телефона это неудобно: пользователь снял/записал встречу в мессенджере и хочет «кинуть файл в бота». Telegram-бот Коры уже принимает медиа (`voice`/`audio`/`document`), уже знает автора (`ChannelBinding`), уже умеет качать файлы — но присланное **не создаёт встречу**: `voice`/`audio` уходит в ассистента, `document` — в базу знаний (`telegram-bot.adapter.ts` ветки `handleVoice`/`handleDocument`).

Решение — **мостик «Telegram → meeting-uploads»**: переиспользовать готовый конвейер (≈80% кода), добавив серверный приём файла из канала и маршрутизацию медиа-сообщений «это запись встречи». Главный технический блокер — лимит Telegram Bot API **20 МБ** на скачивание ботом (`getFile`), который наш crossmark-прокси **не снимает** (он ретранслятор к `api.telegram.org`). Снимается через self-hosted **Local Bot API Server** (`TELEGRAM_LOCAL=1`, лимит до 2 ГБ).

## 3. REALITY-CHECK (факт по коду на 2026-06-21)

| Подсистема | Факт | Вывод для ТЗ |
|---|---|---|
| Конвейер `meeting-uploads` (ingest→transcribe→awaiting_speakers→confirm→AI) | **Готов и работает** для веб-загрузок. `MeetingUploadIngestWorker`, `MeetingUploadTranscribeWorker`, `confirmSpeakers` — без изменений | НЕ трогаем. Только подаём файл серверно |
| Экран разметки спикеров `SpeakersScreen.tsx` + route `/meetings/[id]/speakers` | **Готов**, работает в статусе `awaiting_speakers` | НЕ трогаем. Бот шлёт ссылку сюда |
| Telegram-бот: webhook, дедуп, `ChannelBinding` (verified), `getFile`/`downloadFile`(Buffer) | **Готовы**. `requireVerifiedBinding()` даёт `userId`; tenant — через `Membership` (`resolveTenantForBinding`) | Переиспользуем привязку и скачивание |
| `createUpload()` (`meeting-uploads.service.ts:70`) | Отдаёт **presigned-PUT для браузера**; валидация формата/размера + `assertQuota`/`assertUploadEnabled` зашиты внутри | Выносим валидацию в общий хелпер; делаем серверный вход без presigned |
| `S3Service` (`recordings/s3.service.ts`) | Есть `putObject({key,body:Buffer,contentType})` (:112), `putJson` (:99), `getObject` (:65). **Потокового (stream) upload НЕТ** | Файл до 2 ГБ в `Buffer` = OOM → нужен `putObjectStream` (multipart) |
| `TelegramApiClient.downloadFile` (`telegram-api-client.ts:99`) | Возвращает **весь файл `Buffer`** | До 2 ГБ в память нельзя → нужен `downloadFileStream` |
| `msg.voice ?? msg.audio` (`telegram-bot.adapter.ts:234`) | `audio` СЕЙЧАС идёт в голосовую ветку (ASR→ассистент) | Переразвести: длинное `audio`/`video` → встреча, короткое `voice` → ассистент |
| Типы `TelegramMessage` (`telegram.types.ts:54`) | НЕТ `video`/`video_note` | Добавить типы |
| Транспорт `cfg.telegramProxy.apiBase/fileBase`, `resolveApiBase()/resolveFileBase()` | **Готовы** — клиент уже резолвит base-URL | Local Bot API Server = новое значение этих URL |
| Крутилки: `cfg.getDynamic<T>(adminKey, ENV_KEY, codeDefault)` + реестр `admin-setting-schema-registry.ts` (`[key, zodSchema]`) | **Готовы**. Пример: `assertQuota` через `billing.meetingUploadsPerMonth` | Новые пороги/флаги — тем же паттерном |

**Вывод:** фича — мостик, не новая подсистема. Реальный остаток: (1) инфра Local Bot API Server, (2) серверный потоковый приём файла из канала, (3) маршрутизация медиа в адаптере, (4) крутилки/тексты/прод.

## 4. Принятые решения владельца (НЕ пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р-1 | Лимит 20 МБ снимаем **Local Bot API Server** (`TELEGRAM_LOCAL=1`, до 2 ГБ) сразу в этом ТЗ | Прокси crossmark лимит не снимает (ретранслятор к `api.telegram.org`); без local-сервера крупные встречи недоступны. Подтверждено Context7 (`aiogram/telegram-bot-api`) |
| Р-2 | Различение «встреча vs голосовое ассистенту» — **по типу+размеру**: `video`/`video_note`/`audio`/`document`-аудио-видео → встреча; короткое `voice` (≤ порог N сек) → ассистент как сейчас | Естественно для пользователя, без лишних кнопок |
| Р-3 | Каналы — **только Telegram**. Архитектура канал-агностична (общий серверный метод) | Быстрее проверить спрос; MAX добавится тем же паттерном (vNext) |
| Р-4 | Тип встречи по умолчанию — **крутилка** `meeting_upload.telegram_default_type` (дефолт `team`); правится с компьютера | Тип уточняется позже на экране результата; нейтральный дефолт |
| Р-5 | Telegram-загрузки считаются в **ту же** месячную квоту `billing.meetingUploadsPerMonth` | Единый учёт, переиспускает `assertQuota` |

## 5. Доказательство выбора архитектуры (проход A vs B + challenge-loop)

Полная матрица — в анализе §5/§7. Ключевая развилка реализации — **как принимать файл до 2 ГБ из webhook**.

| Критерий | A: sync-скачивание в webhook + `Buffer`→`putObject` | B: async-очередь + потоковый `stream`→S3 multipart |
|---|---|---|
| Webhook отвечает Telegram быстро (нет ретраев) | ✗ держит соединение всё скачивание | ✓ отвечает сразу, качает воркер |
| Память при файле 2 ГБ | ✗ OOM (весь файл в `Buffer`) | ✓ поток, не материализуется целиком |
| Переиспользование `meeting-uploads` | ✓ | ✓ |
| Сложность | проще | +очередь, +`putObjectStream`, +`downloadFileStream` |

**Выбор — B.** Challenge-loop: (1) *корень, не симптом* — лимит памяти и timeout webhook решаются разом потоковой моделью, а не порогом-заплаткой; (2) *эффективность* — `Meeting` создаём **синхронно** в webhook (мс, даёт ссылку сразу), тяжёлое скачивание — в очередь; (3) *нет кода ради кода* — `putObjectStream` нужен реально (2 ГБ), очередь следует общему паттерну BullMQ проекта.

**Нумерованные решения:**
- **Б1.** `Meeting(source='upload')` создаётся синхронно в обработчике сообщения (валидация+квота+`prisma.create`), бот сразу отвечает ссылкой. *Почему:* мгновенный UX, лёгкая операция.
- **Б2.** Скачивание Telegram→S3 — в новой очереди `meeting.telegram-intake`, **потоково** (`downloadFileStream` → `putObjectStream`). *Почему:* до 2 ГБ нельзя в `Buffer`/в webhook.
- **Б3.** После заливки источника — `enqueueUploadIngest(meetingId)` (существующий вход конвейера). *Почему:* не дублируем ingest/transcribe/confirm.
- **Б4.** Local Bot API Server подключается как значение `cfg.telegramProxy.apiBase/fileBase` (или явный `TELEGRAM_BOT_API_BASE`), `TelegramApiClient` не меняет логику резолва. *Почему:* слой резолва base-URL уже есть.
- **Б5.** Маршрутизация по типу+размеру в `ingestUpdate`. *Почему:* решение Р-2.
- **Б6.** Все пороги/флаги — `getDynamic` (admin→ENV→code). *Почему:* принцип 9 CLAUDE.md.

## 6. Scope

**Входит:**
- Local Bot API Server (`aiogram/telegram-bot-api`, `TELEGRAM_LOCAL=1`) в `infra/telegram-bot-api/` (compose + nginx) + конфиг переключения backend на него.
- `S3Service.putObjectStream(...)` (managed multipart) и `TelegramApiClient.downloadFileStream(...)`.
- Серверный приём файла из канала: `MeetingUploadsService.createUploadFromChannel(...)` (создаёт `Meeting`, без presigned) + очередь `meeting.telegram-intake` и её воркер (скачивание→S3→`enqueueUploadIngest`).
- Telegram-адаптер: типы `video`/`video_note`; ветка `handleMeetingMedia()`; различение по типу+размеру; ответы пользователю + ссылка `/<...>/meetings/{id}/speakers`; дружелюбные тексты ошибок.
- Крутилки: `BOT_MEETING_UPLOAD_ENABLED` (kill-switch), `BOT_MEETING_VOICE_MAX_SECONDS` (порог voice→ассистент), `meeting_upload.telegram_default_type`; реестр + сид + `feature-flags.md`.
- Метрики, идемпотентность, prod-deploy шаги, smoke.

**Не входит (vNext / другие ТЗ):**
- MAX-канал (тот же мостик) — vNext, отдельное ТЗ (архитектуру закладываем канал-агностичной).
- Авто-подстановка «кто есть кто» по самопредставлениям/голосу — vNext (см. анализ; разметка остаётся ручной на готовом экране).
- Мини-страница «догрузка по ссылке» (вариант C анализа) — не нужна при Local Bot API Server.
- Изменения конвейера ingest/transcribe/confirm и экрана `SpeakersScreen` — НЕ трогаем.
- Замена crossmark-прокси для outbound/inbound прочего трафика бота — вне scope (Local API Server вводим как endpoint скачивания/Bot API нашего бота; модель размещения — §11 Ф1).

## 7. Граничные контракты с существующим кодом

- **Конвейер `meeting-uploads`**: используем как есть его вход `MeetingUploadsQueueService.enqueueUploadIngest(meetingId)` и S3-ключ `uploadSourceKey(meetingId, ext)`. Воркеры ingest/transcribe ждут `Meeting(source='upload', status='scheduled')` и файл по `uploadSourceKey` — наш приём ОБЯЗАН выставить ровно это.
- **`ChannelBinding`/tenant**: `userId` из `requireVerifiedBinding`, `tenantId` из `resolveTenantForBinding` (первый `Membership`) — как в `handleVoice`. Не изобретать свою привязку.
- **RBAC/entitlement**: приём встречи из канала ОБЯЗАН проверить `rbac.canWrite(userId, tenantId, 'meeting')` и активный entitlement `feature.meeting` (паритет с `meeting-uploads.controller.ts` guard'ами). Нет прав/entitlement → текст-отказ, встреча не создаётся.
- **`TelegramApiClient`**: `downloadFile`(Buffer) остаётся для `voice`/`document` (мелкие); добавляем `downloadFileStream` для встреч — не ломать существующие вызовы.

## 8. Контракт-first

### 8.1. Типы Telegram (`telegram.types.ts`)
Добавить (рядом с `TelegramVoice`/`TelegramDocument`):
```ts
export interface TelegramVideo {
  file_id: string;
  file_unique_id?: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
}
```
В `TelegramMessage` добавить поля: `audio?: TelegramAudio` (уже есть как `TelegramVoice` — оставить), `video?: TelegramVideo;`, `video_note?: TelegramVideo;`. В `allowed_updates` setWebhook ничего менять не нужно (всё внутри `message`).

### 8.2. Классификация входящего медиа (правило Р-2)
В `ingestUpdate` ДО текущей ветки `const voice = msg.voice ?? msg.audio` (`telegram-bot.adapter.ts:234`):
```
voiceMax = getDynamic<number>('bot.meeting.voiceMaxSeconds','BOT_MEETING_VOICE_MAX_SECONDS', 60)
isMeetingMedia =
     msg.video || msg.video_note
  || (msg.audio && (msg.audio.duration ?? 0) > voiceMax)
  || (msg.voice && (msg.voice.duration ?? 0) > voiceMax)
  || (msg.document && isAudioVideoMime(msg.document.mime_type, msg.document.file_name))
```
- `isAudioVideoMime`: mime начинается с `audio/` или `video/`, ЛИБО расширение имени ∈ `UPLOAD_ALLOWED_EXTENSIONS` (источник правды — `dto/meeting-uploads.dto.ts`, импортировать, **не дублировать список**).
- Если `isMeetingMedia` → `handleMeetingMedia(...)`. Иначе — существующее поведение (короткий `voice`/`audio` → `handleVoice`; `document` PDF/DOCX → `handleDocument`).
- `document` с аудио/видео-mime больше НЕ идёт в `DocumentsService`.

### 8.3. Серверный приём (`MeetingUploadsService`)
Вынести валидацию из `createUpload` в `private assertUploadAllowed({ext, sizeBytes, tenantId})` (формат, размер ≤ `UPLOAD_MAX_SIZE_BYTES`, `assertUploadEnabled`, `assertQuota`). Новый метод:
```ts
async createUploadFromChannel(input: {
  tenantId: string; ownerId: string; type: MeetingType; title: string;
  fileName: string; contentType: string; sizeBytes: number;
}): Promise<{ meetingId: string; uploadKey: string }>
```
- Вызывает `assertUploadAllowed`; `meetingId = ulid()`; `prisma.meeting.create({ data: { id, roomName:id, title, type, ownerId, tenantId, recordByDefault:true, status:'scheduled', source:'upload' }})`; возвращает `{ meetingId, uploadKey: uploadSourceKey(meetingId, ext) }`. **Не** ставит ingest (источник зальёт воркером).

### 8.4. Очередь приёма `meeting.telegram-intake`
- Имя очереди: `meeting.telegram-intake`. `jobId`: `meeting_tg_intake_${meetingId}` (идемпотентность — повторный webhook не создаёт второй job).
- Payload:
```ts
interface TelegramIntakeJob {
  meetingId: string; tenantId: string; botToken: string;
  fileId: string; uploadKey: string; contentType: string; sizeBytes: number; chatId: number;
}
```
- Worker: `getFile(fileId)` → `downloadFileStream(file_path)` → `s3.putObjectStream({key:uploadKey, body:stream, contentType})` → `enqueueUploadIngest(meetingId)`. Опции: `attempts:3`, backoff exponential 15s, concurrency 1, `removeOnComplete` 86400s. При финальном провале → `meetings.transitionStatus(meetingId,'failed',{reason:'telegram_intake_failed'})` + best-effort сообщение боту.

### 8.5. S3 потоковый upload (`S3Service`)
```ts
async putObjectStream(args: { key: string; body: Readable; contentType: string }): Promise<void>
```
Реализация — `@aws-sdk/lib-storage` `Upload` (managed multipart). **Сверить API через Context7** (`/aws/aws-sdk-js-v3`, lib-storage `Upload`) перед написанием.

### 8.6. Telegram потоковое скачивание (`TelegramApiClient`)
```ts
async downloadFileStream(args: { token: string; filePath: string }): Promise<Readable>
```
URL = `${this.resolveFileBase()}/file/bot${token}/${filePath}` (тот же резолв, что `downloadFile`). Вернуть `Readable` из тела ответа (`fetch` body → `Readable.fromWeb`). Учесть local-mode: при `TELEGRAM_LOCAL=1` `file_path` может быть абсолютным путём — **проверить экспериментом** (Ф1), при необходимости нормализовать (срез до `<token>/...`) для nginx `/file/`.

### 8.7. Крутилки (AdminSetting)
`env.schema.ts` (секция `MaxBotChannelSchema`, где уже `BOT_VOICE_ENABLED`):
```ts
BOT_MEETING_UPLOAD_ENABLED: zBool(true),
BOT_MEETING_VOICE_MAX_SECONDS: z.coerce.number().int().positive().default(60),
```
`typed-config.service.ts` `get bot()` — добавить `meetingUploadEnabled: this.get('BOT_MEETING_UPLOAD_ENABLED')`. Пороги, читаемые рантайм-крутилкой, — через `getDynamic`:
- `bot.meeting.voiceMaxSeconds` ← `BOT_MEETING_VOICE_MAX_SECONDS` ← 60
- `meeting_upload.telegram_default_type` ← (env не нужен) ← `'team'`
Реестр `admin-setting-schema-registry.ts` — добавить:
```ts
['bot.meeting.voiceMaxSeconds', POSITIVE_INT],
['meeting_upload.telegram_default_type', z.enum([...MeetingType values...])],
```
`BOT_MEETING_UPLOAD_ENABLED` — kill-switch (ON по умолчанию, как `voiceEnabled`); строка в `docs/operations/feature-flags.md`.

### 8.8. Ответы бота (русский; тексты-образцы)
- Принято: `«Запись принята, обрабатываю. Разметить спикеров и тип встречи: {publicHostUrl}/meetings/{id}/speakers»`.
- Нет прав: `«У вас нет прав на загрузку встреч. Обратитесь к администратору компании.»`
- Выключено (`BOT_MEETING_UPLOAD_ENABLED=false`): `«Загрузка встреч через бота сейчас выключена.»`
- Квота: `«Достигнут месячный лимит загрузок встреч. Обратитесь к администратору.»`
- Конвейер `UPLOAD_NO_AUDIO_STREAM`: `«В записи не нашлось звука — встреча без аудио не анализируется.»`
- `UPLOAD_DECODE_FAILED`/intake-провал: `«Не удалось обработать файл. Проверьте формат или загрузите запись через веб-кабинет.»`
Ссылка строится из `cfg.publicHostUrl` (`typed-config.service.ts:613`).

### 8.9. ASCII-поток
```
TG user → видео/аудио → webhook (sync):
  флаг ON? binding verified? rbac.canWrite + entitlement? тип+размер=встреча? квота?
     └─ да → createUploadFromChannel() → Meeting(scheduled, source=upload, type=default)
              → ответ «принято» + ссылка /meetings/{id}/speakers
              → enqueue meeting.telegram-intake {meetingId, fileId, uploadKey}
  meeting.telegram-intake (worker, async):
     getFile → downloadFileStream → putObjectStream(uploadKey) → enqueueUploadIngest(meetingId)
  [далее БЕЗ изменений]: ingest → transcribe(Vox диаризация) → awaiting_speakers
  человек с компьютера: SpeakersScreen → confirm → AI-отчёт
```

## 9. Границы фичи
- ✅ **Always:** переиспользовать `meeting-uploads`/`SpeakersScreen`; читать пороги через `getDynamic`; русские тексты; проверять binding+rbac+entitlement+квоту.
- ⚠️ **Ask first:** менять FSM `Meeting`; менять контракт ingest/transcribe; новый публичный эндпоинт; трогать crossmark-прокси для остального трафика.
- 🚫 **Never:** держать файл >20 МБ в `Buffer`; качать файл синхронно в webhook; `process.env.*` мимо `env.schema`; хардкод порогов/типа; список форматов копипастой (только импорт из dto); `new PrismaClient()` в скриптах.

## 10. Требования (R) и трассировка

- **R1.** Когда пользователь шлёт `video`/`video_note`/`audio`(>порог)/`document`-аудио-видео и `BOT_MEETING_UPLOAD_ENABLED=true`, система shall создать `Meeting(source='upload', status='scheduled', type=default)` и поставить `meeting.telegram-intake`.
- **R2.** Когда пользователь шлёт короткий `voice`/`audio` (≤ `BOT_MEETING_VOICE_MAX_SECONDS`), система shall сохранить текущее поведение (ассистент/чек-ин/заметка).
- **R3.** Система shall скачивать файл и загружать в S3 **потоково**, не материализуя его целиком в память.
- **R4.** Воркер `meeting.telegram-intake` shall по завершении вызвать `enqueueUploadIngest(meetingId)`; далее встреча доходит до `awaiting_speakers` штатным конвейером.
- **R5.** Если у пользователя нет `rbac.canWrite('meeting')` или активного `feature.meeting`, система shall отказать текстом и НЕ создавать встречу.
- **R6.** Если месячная квота `billing.meetingUploadsPerMonth` исчерпана, система shall отказать текстом про лимит.
- **R7.** Бот shall ответить пользователю ссылкой `…/meetings/{id}/speakers`.
- **R8.** Local Bot API Server (`TELEGRAM_LOCAL=1`) shall позволять боту скачать файл > 20 МБ (до 2 ГБ).
- **R9.** Все пороги/тип-дефолт shall читаться через `getDynamic` (admin→ENV→code); `BOT_MEETING_UPLOAD_ENABLED` — kill-switch ON.
- **R10.** Повторный webhook того же файла shall быть no-op (идемпотентный `jobId`).

## 11. Фазы

Зависимости: **Ф1 ∥ Ф2** (инфра независима от кода) → **Ф3** (адаптер, нужен сервис+очередь Ф2) → **Ф4** (полиш/прод, после Ф1+Ф3). Полноценность крупных файлов проверяется только после Ф1.

### Ф1 — Local Bot API Server (инфра + de-risk) `[ ]`
**Цель:** свой Bot API с `TELEGRAM_LOCAL=1`, доказать скачивание файла > 20 МБ.
**Входит:** `infra/telegram-bot-api/docker-compose.yml` (`aiogram/telegram-bot-api:latest`, env `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_LOCAL=1`, volume `telegram-bot-api-data`, nginx по образцу из Context7); README по размещению; backend-конфиг: возможность указать base/file-URL нашего сервера (через существующие `TELEGRAM_PROXY_API_BASE`/`TELEGRAM_PROXY_FILE_BASE` либо `TELEGRAM_BOT_API_BASE`).
**Открытый операционный вопрос (разобрать в README, не блокирует код):** Local Bot API Server подключается к Telegram DC по MTProto (api_id/api_hash) — из ДЦ Новосибирска прямого доступа к Telegram нет (причина существования crossmark-прокси). Варианты размещения: (а) на хосте с доступом к Telegram (как контур прокси), backend ходит по HTTP; (б) рядом с backend, если сетевой доступ к Telegram DC будет открыт. Зафиксировать выбранный вариант + fallback (остаёмся на crossmark для ≤20 МБ).
**Что НЕ входит:** изменения кода адаптера.
**Acceptance:** `docker compose -f infra/telegram-bot-api/docker-compose.yml up -d` поднимает сервис; `curl .../bot<token>/getMe` → ok; присланный тестовый файл > 20 МБ скачивается (`getFile`→`/file/...` → 200, размер совпал). Зафиксировать в README фактический формат `file_path` в local-mode.
**Закрывает:** R8.

### Ф2 — Backend: потоковый приём из канала `[ ]`
**Цель:** серверный вход файла в конвейер + потоковая передача + крутилки.
**Файлы:** `recordings/s3.service.ts` (+`putObjectStream`), `telegram-api-client.ts` (+`downloadFileStream`), `meeting-uploads.service.ts` (+`createUploadFromChannel`, вынос `assertUploadAllowed`), новая очередь `meeting-uploads.queues`/`-queue.service` (+`meeting.telegram-intake`) и воркер `workers/meeting-telegram-intake.worker.ts`, `env.schema.ts`, `typed-config.service.ts`, `admin-setting-schema-registry.ts`, сид крутилок (`backend/scripts/seed-admin-settings.ts`).
**Что НЕ входит:** правки `telegram-bot.adapter.ts` (Ф3); ingest/transcribe воркеры.
**Acceptance:** `bun run typecheck && lint && build` зелёные; `bunx vitest run` нового воркера (мок S3+API: stream→putObjectStream→enqueueUploadIngest вызван; провал скачивания → status `failed`); `getDynamic`-ключи присутствуют в реестре (grep `bot.meeting.voiceMaxSeconds`, `meeting_upload.telegram_default_type`); идемпотентность `jobId` (повторный enqueue — один job).
**Закрывает:** R3, R4, R9, R10 (частично).

### Ф3 — Telegram-адаптер: маршрутизация и ответы `[ ]`
**Цель:** распознать «запись встречи», создать встречу синхронно, ответить ссылкой.
**Файлы:** `telegram.types.ts` (+`video`/`video_note`), `telegram-bot.adapter.ts` (+`handleMeetingMedia`, ветка классификации §8.2, флаг `BOT_MEETING_UPLOAD_ENABLED`, `isAudioVideoMime` через импорт `UPLOAD_ALLOWED_EXTENSIONS`), метрика `incBotInbound{kind:'meeting_media'}`.
**Что НЕ входит:** инфра Ф1.
**Acceptance:** unit на классификацию (video→встреча; voice 10с→ассистент; audio 600с→встреча; document `application/pdf`→`handleDocument`; document `video/mp4`→встреча); `handleMeetingMedia` при нет-прав/выключено/квоте отвечает соответствующим текстом и НЕ создаёт встречу; успешный путь → `createUploadFromChannel` + enqueue intake + ответ содержит `/meetings/` и id. `typecheck/lint/build` зелёные.
**Закрывает:** R1, R2, R5, R6, R7.

### Ф4 — Тексты, метрики, прод, smoke `[ ]`
**Цель:** довести до выката.
**Входит:** дружелюбные тексты ошибок конвейера (маппинг кодов §8.8); `docs/operations/feature-flags.md` (строка про `BOT_MEETING_UPLOAD_ENABLED`); `docs/operations/prod-deploy-log.md` — Шаг 1 (новые ENV `BOT_MEETING_UPLOAD_ENABLED`/`BOT_MEETING_VOICE_MAX_SECONDS` + при размещении: `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/base-URL), Шаг 7 (сид крутилок), Шаг 12 (smoke grep новой очереди); регистрация сида в `apply-prod-deploy.ts STEPS`; second-brain (`01_projects/telegram-user-flows.md`, `conversational-channels.md`, `workers-queues.md`, `01_projects/ai-jobs.md` — новая очередь).
**Acceptance:** `grep meeting.telegram-intake` находит очередь в реестре воркеров; `feature-flags.md` содержит флаг; prod-deploy-log обновлён; сид идемпотентен (повторный прогон — no-op). Ручной smoke (после Ф1): файл из Telegram → встреча в `awaiting_speakers` → разметка → AI-отчёт.
**Закрывает:** R9 (флаг-реестр), прод-готовность.

## 12. Идемпотентность / флаги / прод
- Очередь: `jobId = meeting_tg_intake_${meetingId}` — повтор no-op (R10).
- Сид крутилок — upsert, повторный прогон no-op; зарегистрировать в `apply-prod-deploy.ts STEPS` (`phase:'seed'`).
- Флаг `BOT_MEETING_UPLOAD_ENABLED` — kill-switch, ON по умолчанию (Ship-On: фича выкатывается включённой). Строка в `feature-flags.md`.
- Prod: новый сервис `infra/telegram-bot-api` поднимается отдельно (как `infra/livekit`); backend получает base/file-URL через ENV. Новых таблиц/миграций НЕТ (Prisma не меняется).

## 13. Pre-mortem / Риски

| Риск | Митигация |
|---|---|
| Local Bot API Server недостижим к Telegram из ДЦ | Размещение на контуре с доступом к Telegram (Ф1 README); fallback — crossmark для ≤20 МБ, бот честно сообщает про лимит |
| `file_path` в local-mode абсолютный → nginx `/file/` 404 | Ф1 фиксирует фактический формат; `downloadFileStream` нормализует путь; покрыть unit |
| OOM на больших файлах | Потоковый `downloadFileStream`→`putObjectStream` (multipart), без `Buffer` целиком (R3) |
| webhook timeout/ретраи Telegram | Тяжёлое в очередь; webhook отвечает после лёгкого `prisma.create` (Б1) |
| `audio` ломает текущий UX ассистента | Порог `BOT_MEETING_VOICE_MAX_SECONDS`; короткий `voice`/`audio` — прежний путь (R2); unit на границу |
| Видео без аудио / битый контейнер | Конвейер даёт `UPLOAD_NO_AUDIO_STREAM`/`UPLOAD_DECODE_FAILED` → дружелюбный текст (§8.8) |
| Двойная отправка/дубль встречи | Идемпотентный `jobId` + дедуп `update_id` (есть) |

**Ревью-аспекты для `strict-production-review-gate`:** tenant-изоляция приёма (binding→Membership→tenantId), отсутствие утечки `botToken` в логи/ответы, проверка прав до создания встречи, отсутствие OOM-пути (нет `Buffer` на большом файле), идемпотентность intake, корректный FSM-переход при провале (`failed`).

## 14. DoD
- `bun run typecheck` (вкл. `.spec`), `lint`, `build` — зелёные; `cd frontend` не затрагивается (UI не меняется).
- vitest: воркер intake + классификация медиа.
- Crun-flags/крутилки в реестре + сиде; `feature-flags.md` обновлён.
- second-brain обновлён по таблице производных заметок (workers-queues, telegram-user-flows, conversational-channels, ai-jobs); `prod-deploy-log.md` Шаги 1/7/12.
- Рефлексия в `second-brain/05_история/`.
- Прод-инструкция в чат (diff команд) после push.

## 15. Итог
Реализация заполняется оркестратором по мере прохождения фаз.
