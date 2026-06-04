# Дополнения к аудиту системы агентов — живая сессия 2026-06-04

> Дополняет [2026-06-04-agent-system-full-audit.md](2026-06-04-agent-system-full-audit.md) и МТЗ №1 [../tz/2026-06-04-razblokirovka-konveyera.md](../tz/2026-06-04-razblokirovka-konveyera.md).
> Найдено в интерактивной отладке этой сессии + на **боевых прод-данных** через read-only `backend/scripts/diag.ts`. Код на `dev@1c0214e4`; `prisma generate` + `tsc --noEmit` зелёные.

---

## A. Прод-подтверждение B1 (Vox-таймаут) на боевых данных

Через `diag.ts` разобрана единственная failed-встреча `01KT8KYS1XR9SM3C6WJTAKH6ZV` («презентация проекта команде», svmazur@mail.ru, 2026-06-04 06:08):

- **Статус:** `failed`, причина: `transcribe: Vox poll timeout: 60 попыток × 2000 ms`.
- **5 ASR-вызовов, все FAIL**, каждый ~**121 с** (=60 опросов × 2000 мс) — это ровно retry-storm на `attempts:5` (BullMQ).
- **Транскрипт:** `turns=false`; **отчёта нет** (`aiResult ОТСУТСТВУЕТ`); во второй мозг из встречи не ушло ничего.
- Технический след: 5 пар `vox.timeout → ai.transcribe.failed` (06:37 → 06:48).

**Вывод:** B1 (узкое место №1) подтверждён не логами, а боевыми данными. Это первый по приоритету фикс в МТЗ №1 (Ф1).

**Инструмент диагностики:** `bun --env-file=c:/work/z/.env run scripts/diag.ts trace --meeting <id>` (из `backend/`). Креды супер-админа — в **КОРНЕВОМ** `c:/work/z/.env` (Bun по умолчанию читает `backend/.env`, где их нет — нужен `--env-file`). Только чтение (единственный POST — логин). **Гейт:** заход в прод — только по явному подтверждению владельца в сессии. Команды: `trace`, `meetings`, `chain`, `llm-calls`, `call`, `report`.

---

## B. НОВЫЙ баг — `failed`-встреча прячет полностью готовое видео

На той же встрече запись **в полном порядке** (проверено в проде):
- `Recording.status = ready`, `mainVideoUrl` проставлен, composite `EGRESS_COMPLETE`, 615 МБ + faststart-версия 616 МБ (moov в начале — проигрываемая).

Но видео **не видно в интерфейсе**, потому что вся встреча помечена `failed` (транскрибация умерла → `transcribe.worker.onJobFailed` перевёл встречу в терминальный `failed`). Бэкенд запись не прячет — `toRecordingDto` ([backend/src/modules/meetings/meetings.service.ts:878](../../backend/src/modules/meetings/meetings.service.ts#L878)) отдаёт `hasRecording:true` даже для failed. Значит гейт во **фронте** (страница встречи на `status==='failed'` рендерит ошибку, а не блок записи), либо в authenticated video-url пути.

- **Severity:** medium-high (данные целы, но теряется доступ к видео + доверие пользователя).
- **Корень:** доступ к записи **связан со статусом AI-конвейера**. Падение AI-ветки утаскивает за собой исправную запись.
- **Фикс (развязать запись от AI-статуса):**
  1. **FSM:** падение только AI-ветки (transcribe/merge/analyze) не должно схлопывать встречу в терминальный `failed` — ввести под-статус (`transcription_failed` / `ai_failed`), при котором запись остаётся смотрибельной. См. `transcribe.worker.ts:onJobFailed`, `merge.worker.ts:onJobFailed`, FSM в `meetings.service.ts`.
  2. **И/ИЛИ фронт:** рендерить блок записи по `hasRecording`, а не по `status`.
- **Побочно:** когда починим B1 (Vox), эта встреча перестанет быть `failed` и видео покажется — но развязку всё равно сделать (любой будущий сбой AI не должен прятать видео).

→ Внести этим пунктом в МТЗ (отдельная маленькая фаза «развязка записи от AI-статуса», можно в составе Ф7 или новой Ф11).

---

## C. Ф1 (транскрибация) — две добавки по запросу владельца

Дополняют фазу Ф1 МТЗ №1 (помимо таймаута опроса Vox):

### C.1 Параллельная отправка дорожек
Сейчас дорожки транскрибируются **последовательно**: `for (… of audioTracks) { await transcribeOneTrack(…) }` ([backend/src/modules/ai/workers/transcribe.worker.ts:174](../../backend/src/modules/ai/workers/transcribe.worker.ts#L174)) — на 3 дорожках втрое дольше.
**Фикс:** заменить на `Promise.allSettled(audioTracks.map(t => transcribeOneTrack(t)))` с ограничением одновременности (пул 3–4, чтобы не перегрузить Vox). Именно `allSettled` (не `all`) — падение одной дорожки не валит остальные; стыкуется с per-track идемпотентностью Ф1 (упавшую дорожку ретраим, успешные не перетранскрибируем).

### C.2 Точность тайм-выравнивания «по ролям по времени»
Алгоритм мерджа **уже правильный**: `mergeWordTimestamps` ([backend/src/modules/ai/services/merger.ts:52-121](../../backend/src/modules/ai/services/merger.ts#L52-L121)) считает сдвиг `trackOffset = trackStartedAt − baseStartedAt`, приводит слова к общему таймлайну, сортирует по абсолютному времени и группирует в реплики по спикеру (пауза >1.5с).
**НО** точность держится на `AudioTrack.startedAt`, а он ставится как `new Date()` бэкенда на вебхуке `egress_started` ([backend/src/modules/webhooks/livekit-events.handler.ts:366](../../backend/src/modules/webhooks/livekit-events.handler.ts#L366); create — [backend/src/modules/recordings/recordings.service.ts:364](../../backend/src/modules/recordings/recordings.service.ts#L364)), а не как реальный старт аудиофайла. Для позднего участника / под лагом вебхуков сдвиг «уезжает» → реплики двух людей встают не туда по времени относительно друг друга.
**Фикс:** брать `startedAt` дорожки из тайминга самого LiveKit (egress/track start из webhook-инфо — тот же источник времени, что и аудиофайл), а не из `new Date()`. **Проверка в харнессе:** подать синтетику с известными моментами речи двух «спикеров» и сверить `turns[].startSec`.

---

## D. Состояние документов и оговорка

- Документы аудита/МТЗ/харнесса — **черновики синтеза** (агенты читали выверенную фактуру обоих аудит-прогонов). Перед действием по любому пункту — перепроверить `file:line` в коде (`vexp run_pipeline`/Read), особенно по `persons`/`orgs`/`conversational`/`schema` (их затронул merge при pull).
- Машинный гард: `tsc` **структурно слеп** к лишним ключам вложенного `where`/`data` в Prisma-литералах (поэтому `skillTrait.findMany({tenantId})` и `insight.create({dataClassAudit})` прошли typecheck, но падают в рантайме). Ловить **интеграционными тестами против реального Postgres**, не «добавить typecheck».
