# Orchestrator-prompt: Загрузка встречи через Telegram-бот

Ты — `tz-orchestrator`. Реализуй ТЗ `plans/tz/2026-06-21-telegram-meeting-upload-from-phone.md` фаза за фазой силами суб-агентов, с независимой приёмкой. Коммит по фазам, push — только по явному подтверждению владельца.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (принципы 7/8/9, vexp-first, Context7).
2. `plans/tz/2026-06-21-telegram-meeting-upload-from-phone.md` — основной контракт (это твой источник правды).
3. `plans/analysis/2026-06-21-telegram-upload-meeting-from-phone.md` — фон и обоснование вариантов.
4. Код-якоря (перечитать перед правкой — номера строк дрейфуют, ищи по символам):
   - `backend/src/modules/meeting-uploads/meeting-uploads.service.ts` — `createUpload`, `assertQuota`, `assertUploadEnabled`, `uploadSourceKey`.
   - `backend/src/modules/meeting-uploads/meeting-uploads-queue.service.ts` + `meeting-uploads.queues.ts` — образец очереди/воркера.
   - `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts` — `ingestUpdate` (ветка `const voice = msg.voice ?? msg.audio`), `handleVoice`, `handleDocument`, `requireVerifiedBinding`, `resolveTenantForBinding`.
   - `backend/src/modules/conversational/adapters/telegram-bot/telegram-api-client.ts` — `downloadFile`, `resolveFileBase`.
   - `backend/src/modules/conversational/adapters/telegram-bot/telegram.types.ts`.
   - `backend/src/modules/recordings/s3.service.ts` — `putObject` (образец для `putObjectStream`).
   - `backend/src/common/config/{env.schema.ts,typed-config.service.ts,env-classification.ts}` — секция бота, `getDynamic`, `publicHostUrl`.
   - `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — формат `[key, zodSchema]`.

## Инструменты
- vexp `run_pipeline` первым на каждую фазу (не grep при живом демоне). `get_skeleton` для осмотра.
- Context7 обязателен в Ф2: `@aws-sdk/lib-storage` `Upload` (managed multipart для `putObjectStream`); в Ф1: `aiogram/telegram-bot-api` (env, `TELEGRAM_LOCAL`, формат `file_path`, nginx).
- Fallback при недоступности vexp — Explore + Grep/Read.

## Граф фаз
- **Ф1 (инфра, de-risk)** ∥ **Ф2 (backend core)** — независимы.
- **Ф3 (адаптер)** — строго после Ф2 (нужны `createUploadFromChannel` + очередь `meeting.telegram-intake`).
- **Ф4 (полиш/прод/smoke)** — после Ф1 и Ф3.
Одна фаза = одна волна. Между волнами: зелёная верификация → commit → следующая волна без остановки; push отдельно с подтверждением.

## Факт-чек (не верь отчёту суб-агента)
После каждой фазы сам: re-Read изменённых файлов, grep ключевых маркеров, свой `bun run typecheck && lint && build` (+ `bunx vitest run` нужных спеков). Суб-агент мог отметить `[x]` без реального Edit — проверяй грепом символов:
- Ф2: `putObjectStream`, `downloadFileStream`, `createUploadFromChannel`, `meeting.telegram-intake`, `meeting_tg_intake_`, `bot.meeting.voiceMaxSeconds` в реестре.
- Ф3: `handleMeetingMedia`, `video_note`, `BOT_MEETING_UPLOAD_ENABLED`, импорт `UPLOAD_ALLOWED_EXTENSIONS` (не дубль-список).
- Ф4: `meeting.telegram-intake` в реестре воркеров, строка флага в `docs/operations/feature-flags.md`, шаги в `prod-deploy-log.md`.

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы из ТЗ выполнены и проверены тобой машинно (grep/re-Read/typecheck-lint-build/vitest), а не со слов агента. Требования R закрыты по строкам «Закрывает:».

## Инварианты (провалишь — фаза не зелёная)
- Никакого `Buffer` целиком на файле >20 МБ; скачивание/upload только потоком.
- `process.env.*` мимо `env.schema` запрещён; пороги/тип — через `getDynamic`.
- Список форматов — только импорт `UPLOAD_ALLOWED_EXTENSIONS`, не копипаста.
- Prisma не меняется (новых миграций нет); в скриптах `createPrismaClient()`, не `new PrismaClient()`.
- UI/тексты бота — русские; флаг — kill-switch ON (Ship-On); строка в `feature-flags.md`.
- Конвейер ingest/transcribe/confirm и `SpeakersScreen` — НЕ трогать.

## Failure-modes
- Local Bot API недостижим к Telegram из ДЦ → не блокируй код Ф2/Ф3 (работают для ≤20 МБ через crossmark); зафиксируй размещение в Ф1 README, fallback на crossmark.
- `file_path` local-mode абсолютный → нормализуй в `downloadFileStream`, покрой unit.
- Не расширяй scope: MAX-канал, авто-подстановка спикеров, мини-страница догрузки — vNext, не делать.
