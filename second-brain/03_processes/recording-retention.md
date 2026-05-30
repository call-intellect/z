---
name: recording-retention
title: Очистка записей по сроку хранения
trigger_type: cron
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - инженер media-stack
  - продакт биллинга
related_plans:
  - plans/tz/2026-05-08-mvp-fullstack-tz.md
related_projects:
  - 01_projects/recording.md
  - 01_projects/entitlements.md
---

# Очистка записей по сроку хранения

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Записи встреч в Z — это много мегабайт на каждую: несколько видеоминут и по одной аудиодорожке на каждого спикера. Если хранить всё вечно, S3-хранилище разрастётся в копеечку. Поэтому каждой записи при создании ставится «дата истечения» — через сколько дней её можно удалить. По умолчанию это 30 дней (настраивается на уровне тарифа клиента — в Pro-тарифе срок будет длиннее, в Free — короче). Партнёр Crossmark может вручную «продлить» запись на N дней через специальный API.

Раз в час крон-задача выходит и смотрит: какие записи уже «просрочены»? Для каждой — сначала аккуратно удаляются файлы из облачного хранилища S3 (и общий видеофайл, и все аудиодорожки), потом запись в базе помечается как «удалена» (`status='deleted', deletedAt=now`), и в журнал действий с записью добавляется строчка «удалено системой по причине: истёк срок тарифа». Метрика «удалено записей» инкрементируется — это видно в дашбордах observability.

Если что-то пошло не так — например, S3 временно недоступен — запись остаётся в БД в текущем статусе, в логи пишется ошибка. Крон не валит весь NestJS-процесс: один проход не удалось, следующий через час попробует снова. Сама запись в БД при этом не удаляется hard'ом — это сделают позже, когда срок soft-delete grace тоже истечёт (по умолчанию ещё 30 дней — другой крон `RetentionExtrasCron`).

## 2. Что запускает (триггер)

- **Тип:** расписание (cron).
- **Кто инициирует:** `RetentionCron` каждый час (`@Cron('0 * * * *')`).
- **Технический источник:** `RetentionCron.sweep` → `RetentionService.processAll` → внутри — `processExpired` для Recording (+ ещё четыре sweep'а — RawEvent / Blocks / Chat / Audit — управляются ENV-флагами и относятся к другим процессам).

Параллельный, **отдельный** cron `RetentionExtrasCron` тоже идёт раз в час и доделывает то, что относится не к записям, но запускается тем же декоратором (`@Cron(CronExpression.EVERY_HOUR)`).

## 3. Шаги процесса (общий список)

1. **Расписание срабатывает каждый час** — крон запускает «прогон ретеншена».
2. **Из БД берётся пачка просроченных записей** (до 100 за раз): `Recording.expiresAt < now` И статус НЕ `deleted`/`archived`. Если ничего — выходим (no-op).
3. **На каждую запись** собираются S3-ключи: общий видеофайл (`mainVideoUrl`) + все аудиодорожки (`audioTracks[].audioUrl`).
4. **Файлы пакетно удаляются из S3** через `S3Service.delete(keys)`. Если ошибка — лог + переход к следующей записи (не валим весь прогон).
5. **В одной транзакции**: `Recording.status='deleted', deletedAt=now`, + `RecordingAction({action:'deleted', actor:'cron', reason:'tariff_expired'})`.
6. **Метрики:** `recordings_deleted_total{reason='tariff_expired'}` инкрементируется, а также общий счётчик `core_retention_deleted_total{kind:'recording'}`.
7. **После прохода ВСЕХ записей** — структурированный лог `{processed, failed}`.
8. **Через ещё 30 дней** (`softDeleteGraceDays`) — отдельный крон `RetentionExtrasCron.hardDeleteMeetings` сметает `Meeting`-записи, у которых `deletedAt < now - graceDays`. Сам `Recording`-record при этом тоже уйдёт по FK.

## 4. Что получается на выходе

- **S3:** файлы (composite mp4 + per-track ogg) удалены безвозвратно.
- **БД:** `Recording.status='deleted'`, `deletedAt`. В журнале — `RecordingAction(action='deleted', actor='cron', reason='tariff_expired')`. Сама запись `Recording` пока остаётся (для аудита и presigned-эндпоинт вернёт `RecordingNotReadyError`).
- **Метрики:** `recordings_deleted_total{reason='tariff_expired'}` ↑.
- **Хосту:** на странице `/meetings/<id>/result` запись больше не доступна — `RecordingsService.getDownloadUrl` бросит `RecordingNotReadyError` (потому что `status !== 'ready'`).
- **Партнёру Crossmark:** аналогично — `getCrossmarkDownloadUrl` тоже бросит ошибку.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Cron-расписание | `@Cron('0 * * * *')` `RetentionCron.sweep` → `RetentionService.processAll`. `processAll` запускает `processExpired` для Recording **всегда** (тут нет per-Org политики); RawEvent / Blocks / Chat / Audit — только если соотв. ENV-флаг (`rawEventsEnabled` / `auditEnabled` / `chatEnabled` / `blocksEnabled`). В конце — `markAllSwept` (помечает `lastSweepAt` всем Org-политикам) | `backend/src/modules/retention/retention.cron.ts:23-64`, `retention.service.ts:152-178` | cron `0 * * * *` | `OrgRetentionPolicy.lastSweepAt` (в `markAllSwept`) | ✅ |
| 2 | Выборка кандидатов | `prisma.recording.findMany({where:{expiresAt:{lt:now}, status:{notIn:['deleted','archived']}}, include:{audioTracks:true}, take:100})`. Размер батча — константа `RetentionService.BATCH_SIZE = 100`. Если пусто — early return | `backend/src/modules/retention/retention.service.ts:57-95` | inline | — (только чтение) | ✅ |
| 3 | Сбор S3-ключей | `deleteOne(recording)` собирает: `extractKeyFromUrl(mainVideoUrl, bucket)` + `extractKeyFromUrl(audioUrl, bucket)` для каждого AudioTrack. Использует тот же `s3-keys.ts`, что и `RecordingsService.start()`/`ensureTrackEgress()` | `backend/src/modules/retention/retention.service.ts:97-134`, `backend/src/modules/recordings/s3-keys.ts` | inline | — | ✅ |
| 4 | Удаление в S3 | `S3Service.delete(keys)` — пакетный DeleteObjects (S3 SDK). Ошибки бросаются вверх; `processExpired` ловит их в `try/catch` per-record, увеличивает `failed`, продолжает | `backend/src/modules/retention/retention.service.ts:113-115,77-91`, `backend/src/modules/recordings/s3.service.ts` | S3 DeleteObjects | — | ✅ |
| 5 | Update БД | `prisma.$transaction([recording.update({status:'deleted', deletedAt:now}), recordingAction.create({action:'deleted', actor:'cron', reason:'tariff_expired'})])`. **Сам Recording НЕ удаляется** — только меняется статус | `backend/src/modules/retention/retention.service.ts:117-130` | inline | `Recording.status`, `Recording.deletedAt`, `RecordingAction` | ✅ |
| 6 | Метрики | `incRecordingsDeleted({reason:'tariff_expired'})` (`recordings_deleted_total{reason}`) + `incCoreRetentionDeleted({kind:'recording'})` (общий счётчик `core_retention_deleted_total{kind}`) | `backend/src/modules/retention/retention.service.ts:132-134`, `backend/src/common/metrics/business-metrics.service.ts` | — | — | ✅ |
| 7 | Финальный лог | `logger.log({processed, failed}, 'Retention sweep: завершён')`. Cron-обёртка добавляет агрегат по всем sweep'ам (recordings + rawEvents + blocks + chat + audit + failed) | `backend/src/modules/retention/retention.cron.ts:30-55`, `retention.service.ts:93` | — | — | ✅ |
| 8 | Hard-delete встречи (отдельный cron) | `RetentionExtrasCron.hardDeleteMeetings`: `prisma.meeting.deleteMany({where:{deletedAt:{lt:now - softDeleteGraceDays*24*60*60*1000}}})`. По FK cascade удалятся `Recording`, `AudioTrack`, `Participant`, `MeetingEvent`. Параллельно — `hardDeleteUsers`, `hardDeleteCards`, очистка `Export`, `WebhookDelivery`, `ShareView`, `ApiAccessLog`, `AuditLog` (365 дней фиксировано) | `backend/src/modules/retention/retention-extras.cron.ts:33-160` | cron `EVERY_HOUR` | hard-delete `Meeting`, cascade `Recording`/`AudioTrack`/`Participant`/`MeetingEvent` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
Recording (status in ['recording','finalizing','ready','failed'])
  ↓ при создании (RecordingsService.start)
expiresAt = now + cfg.retention.defaultDays * 86400000 (по умолчанию 30 дней)
  ↓ опц. extendRetention (Crossmark API)
expiresAt += addDays * 86400000
  ↓ ждём до expiresAt
  ↓ @Cron('0 * * * *') → RetentionService.processExpired
S3: composite.mp4 + per-track .ogg удалены
Recording.status='deleted', deletedAt=now
RecordingAction(action='deleted', actor='cron', reason='tariff_expired')
  ↓ ждём cfg.retention.softDeleteGraceDays (30 дней)
  ↓ другой cron (RetentionExtrasCron.hardDeleteMeetings)
Meeting удалён hard-delete'ом → cascade Recording/AudioTrack/Participant/MeetingEvent
```

### 5.2 LLM-вызовы внутри процесса

Нет. Чисто хозяйственный процесс.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `recordings_deleted_total{reason}` — `reason='tariff_expired'` для крон-удалений, `'user_request'` для ручных через `deleteEarly`.
- `core_retention_deleted_total{kind}` — общий счётчик; `kind='recording'`/`'raw_event'`/`'block'`/`'chat'`/`'audit'`.

**BullMQ очереди:** нет. Всё синхронно в `@Cron`.

**Логи:**
- `RetentionCron` — `«Retention cron: проход завершён»` + сводка по всем sweep'ам.
- `RetentionService` — `«Retention sweep: найдены просроченные записи»` / `«Retention sweep: завершён»` / `«Retention sweep: ошибка удаления записи»`.
- `RetentionExtrasCron` — `«Retention extras: проход завершён»`.

**Известные грабли:**
- `BATCH_SIZE = 100` — если за час накопилось больше 100 просроченных записей, остальные будут удалены в следующих прогонах. На MVP-объёмах это не проблема, но если когда-то будут «волны истечения» (например, переход с большего срока на меньший) — нужно увеличить либо запустить ad-hoc скрипт.
- `processExpired` **не транзакционный** на уровне «или все записи, или никакая» — для каждой записи отдельный `try/catch`. Это сознательно: один битый S3-ключ не должен валить весь прогон.
- `extractKeyFromUrl(audioUrl, bucket)` — если `audioUrl` начинается с `s3://bucket/<key>` (формат placeholder для не-завершившихся записей), функция вернёт корректный ключ — и мы попытаемся удалить файл, которого может не быть в S3. S3 DeleteObjects на несуществующий ключ молча no-op'ит — поэтому не падаем.
- **Per-tenant retention policy** (`OrgRetentionPolicy.rawEventDays`/`archivedBlockDays`/`chatMessageDays`/`auditLogDays`) есть, но **для Recording её нет** — у Recording единый `cfg.retention.defaultDays = 30` (с ENV fallback `DEFAULT_RETENTION_DAYS`). Это пробел: разные тарифы имеют **одно** значение, фактический per-tariff retention сейчас управляется не через retention-политику, а через `RecordingsService.start()` использует общий config. Per-Org retention для Recording **не реализован**.
- **Архив (`archived`)** в коде есть как статус (`Recording.status='archived'`, `archivedAt`), но никакой логики архивации в коде нет — только проверки `status notIn ['deleted','archived']` в выборке. Это «зарезервированный путь».
- `RetentionExtrasCron.purgeAuditLogs` — фикс 365 дней; per-Org `auditLogDays` (через `RetentionService.processExpiredAuditLogs`) может сделать строже, но не мягче.

**Кнопки админки:** `/admin/media/retention` — admin-controller (см. `backend/src/modules/admin/media/retention/admin-retention.controller.ts`). Через него админ может посмотреть состояние и, возможно, форсированно запустить sweep — детали в карточке `01_projects/admin.md`.

## 7. Связанные процессы

- [[meeting-end-and-recording]] — это процесс, который создаёт `Recording.expiresAt` (при `start()` ставит `now + cfg.retention.defaultDays`).
- [[meeting-post-processing]] — пользуется записью и аудиодорожками до того, как они истекут.
- [[raw-event-to-graph]] — отдельный sweep `processExpiredRawEvents` идёт по тому же cron'у, но удаляет RawEvent + payload S3 + cascade'ит IdeaBlockEvidence.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ / архитектуре, но не реализовано:**
- **Per-tariff retention для записей** — `Recording.retentionDays` поле есть в БД (`schema.prisma`), но в коде всегда заполняется одним глобальным `cfg.retention.defaultDays`. Нет связи `tariff → retentionDays`. Если бизнес-логика «Pro = 365 дней / Free = 30 дней» нужна — пробел, нужно реализовать через `EntitlementsService.getRecordingRetentionDays(tenantId)` или per-Org конфигурацию.
- **Архив записей перед удалением** — `Recording.status='archived'` и `archivedAt` есть в схеме, в коде sweep пропускает архивные (`status notIn ['deleted','archived']`), но никакая логика **перевода** записи в архив не написана. Если предполагается «холодное хранение» (например, S3 Glacier) — это не реализовано.

**Реализовано иначе:**
- **Soft-delete сначала, hard-delete через grace** — это не классический «удалить файл и забыть». Два уровня:
  1. `RetentionCron` (этот процесс) — S3-файлы удаляются, БД-запись `Recording` помечается `deleted`, но **сохраняется** для аудита и метрик.
  2. `RetentionExtrasCron.hardDeleteMeetings` — через `softDeleteGraceDays` (30 дней) `Meeting`-запись удаляется hard-delete'ом, по FK cascade уходит `Recording`. Это страховка «отменить, восстановить» — но фактически восстановить нельзя, потому что S3-файлы уже снесены на первом шаге.

**Реализовано, но не описано в ТЗ:**
- **Глобальный `core_retention_deleted_total{kind}` счётчик** — позволяет в Grafana одной метрикой смотреть «какие категории данных сейчас активно сметаются».
- **`OrgRetentionPolicy.lastSweepAt`** — для каждой Org помечается, когда последний раз прошёл sweep. В админке можно показать «вот, эту Org мы сметали час назад».
- **Lazy-init `OrgRetentionPolicy`** — если для Org политики нет, `RetentionPolicyService.getOrInit` создаёт её с дефолтами из `schema.prisma`. Это позволяет не делать обязательный seed при создании Org.
- **`fail-soft` для S3-cleanup в RawEvent sweep** — там `s3.delete().catch(...)` явный warning, чтобы битый S3-ключ не блокировал удаление записи из БД. Для Recording sweep — наоборот, ошибка S3 валит конкретный record, остальное идёт дальше.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-21 | Per-Org retention для RawEvent/Blocks/Chat/Audit (Фаза 11 knowledge-core); Recording sweep остался глобальным | [[01_projects/recording]] |
| 2026-05-08 | `RetentionCron` + `RetentionService.processExpired` для Recording (M2) | [[plans/tz/2026-05-08-mvp-fullstack-tz]] |
