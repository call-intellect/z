---
name: email-to-task
title: Создание задачи из входящего письма (Email-to-task)
trigger_type: cron
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт трекера
related_plans:
  - plans/tz/tracker-phase-4-rf.md
related_projects:
  - 01_projects/tracker.md
  - 01_projects/conversational-channels.md
---

# Создание задачи из входящего письма (Email-to-task)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

Клиент пишет письмо на адрес проекта (например, `support-acme@inbox.kora.app`). Письмо попадает в общий почтовый ящик платформы Z, оттуда раз в две минуты система забирает его, понимает «это для проекта Acme» по адресу, и автоматически создаёт **задачу в трекере** проекта. Тема письма становится заголовком задачи, текст — описанием, файлы во вложениях — приложениями задачи.

Никто из команды не пересохраняет письма вручную, не копипастит из почтового клиента. Клиент пишет так, как привык — на емейл; команда видит задачу в `/tracker/[projectId]` так, как привыкла — на доске.

**Что важно:** один общий почтовый ящик Z обслуживает все проекты всех компаний. У каждого проекта — свой alias (часть адреса до `@`), уникальный на всю платформу. Если письмо пришло на alias, которого нет, — оно отбивается (в логе будет запись «alias не найден»). Если проект существует, но email-приём отключён владельцем, — тоже отбивается («disabled»).

**Что НЕ делает этот процесс:** он не делает граф знаний. Письмо становится `Issue` в трекере, а не `RawEvent` в графе. Если нужно письма от клиентов превратить в карточки клиентов / решения / идеи — это отдельный процесс через `Source(type='email')` per-tenant (см. раздел 8, путаница `EmailFetchService` ↔ `ProjectInboxService`).

## 2. Что запускает (триггер)

- **Тип:** cron-расписание + IMAP-поллинг.
- **Что инициирует:** наступление очередной 2-минутки.
- **Технический источник:** `@Cron(process.env.MAIL_INBOX_POLL_CRON ?? '*/2 * * * *')` в `ImapPollCron.handle()`.

## 3. Шаги процесса (общий список)

1. **Cron каждые 2 минуты** проверяет тумблер `MAIL_INBOX_ENABLED` и подключается к общему IMAP-ящику.
2. **Платформа берёт все непрочитанные письма** в папке `INBOX` (или другой по ENV), но не больше `MAIL_INBOX_MAX_PER_RUN` за один проход.
3. **Каждое письмо парсится** (тема, отправитель, текст, html, вложения).
4. **По Message-ID проверяется идемпотентность** — если такое письмо уже обработали, пропускаем.
5. **Из заголовков `Delivered-To` / `X-Original-To` / `To`** извлекается alias до `@`.
6. **Ищется `Project` по уникальному `emailInboxAlias`** — если не нашлось или у проекта `emailInboxEnabled=false`, письмо помечается как «отбито» (bounced), создаётся запись в `MailInboundLog`.
7. **Создаётся `Issue`** через `IssuesService.create(...)` от имени `Project.ownerId`; тема → `title` (до 200 символов), text/html → `description` (до 5000), `externalSource='email'`, `externalId=Message-ID`.
8. **Вложения** заливаются в S3 (`mail-inbound/{tenantId}/{projectId}/{messageId}/{filename}`) и сохраняются как `IssueAttachment`.
9. **Письмо помечается `\Seen` в IMAP** (чтобы не подтягивать снова), запись `MailInboundLog(status='created')` сохраняется.

## 4. Что получается на выходе

- **Запись в БД:**
  - `Issue` в трекере проекта.
  - `IssueAttachment` на каждое вложение.
  - `MailInboundLog` с статусом `created` / `bounced` / `failed` / `duplicate` (для аудита).
- **В S3:** файлы вложений в бакете под префиксом `mail-inbound/...`.
- **Видно пользователю:**
  - В трекере: `/tracker/projects/[projectId]` → новая задача в колонке по умолчанию.
  - В админ-странице email-inbox проекта: `/tracker/projects/[projectId]/settings/email-inbox` (если такая страница существует — см. раздел 8) — последние попытки доставки.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Cron каждые 2 минуты | `@Cron(process.env.MAIL_INBOX_POLL_CRON ?? '*/2 * * * *')` → проверка `cfg.mailInbox.enabled` → `pollInbox()` | `backend/src/modules/mail/inbound/imap-poll.cron.ts:36..47` | cron `*/2 * * * *` (по умолчанию) | — | ✅ |
| 2 | IMAP connect + search UNSEEN | `ImapFlow.connect()`, `client.search({ seen: false })`, ограничено `MAIL_INBOX_MAX_PER_RUN` (default 50) | `backend/src/modules/mail/inbound/project-inbox.service.ts:86..104` | inline | — | ✅ |
| 3 | Парсинг RFC822 | `simpleParser(msg.source)` (`mailparser`) — тема, from, to, text, html, attachments | `backend/src/modules/mail/inbound/project-inbox.service.ts:108..118` | inline | — | ✅ |
| 4 | Идемпотентность по Message-ID | `MailInboundLog.findUnique({ where: { messageId } })`; если уже есть → outcome=`duplicate` (помечаем `\Seen`, не создаём дубль Issue) | `backend/src/modules/mail/inbound/project-inbox.service.ts:170..188` | — | (read-only) | ✅ |
| 5 | Извлечение alias | `extractAlias(parsed)`: `Delivered-To` → `X-Original-To` → `To`; берём local-part, проверяем что домен === `cfg.mailInbox.domain` (default `inbox.kora.app`) | `backend/src/modules/mail/inbound/project-inbox.service.ts:360..407` | inline | — | ✅ |
| 6 | Routing → Project | `Project.findUnique({ where: { emailInboxAlias: alias } })`; если null/`deletedAt`/`emailInboxEnabled=false` → `MailInboundLog(status='bounced', reason=...)`; метрика `mail_inbound_bounce_total{reason}` | `backend/src/modules/mail/inbound/project-inbox.service.ts:213..257` | — | `MailInboundLog(bounced)` | ✅ |
| 7 | Создание Issue | `IssuesService.create(projectId, { title, description, priority: 'none', externalSource: 'email', externalId: messageId }, tenantId, ownerId)`; intentional bypass RBAC через прямой вызов сервиса (`ownerId` точно `member`) | `backend/src/modules/mail/inbound/project-inbox.service.ts:266..317`, `backend/src/modules/tracker/services/issues.service.ts` | прямой вызов сервиса | `Issue`, `MailInboundLog(created)` | ✅ |
| 8 | Вложения → S3 + IssueAttachment | `S3Service.putObject({ key: 'mail-inbound/{tenantId}/{projectId}/{messageId}/{filename}', body, contentType })` + `IssueAttachment.create({ issueId, fileUrl: key, fileName, fileSize, mimeType })`; best-effort: ошибка одного вложения не валит остальные | `backend/src/modules/mail/inbound/project-inbox.service.ts:439..487` | прямой вызов S3 | `IssueAttachment` × N | ✅ |
| 9 | `\Seen` + лог | `client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })`; если outcome=`failed` — НЕ помечаем `\Seen` (retry в следующем тике) | `backend/src/modules/mail/inbound/project-inbox.service.ts:130..140` | inline | `MailInboundLog` (только если processOne не упал до этого) | ✅ |

### 5.1 Структура данных

```
IMAP UNSEEN messages (общий ящик inbox.kora.app)
  ↓ ImapFlow.search + fetchOne (uid)
ParsedMail (mailparser)
  ↓ Message-ID dedup (MailInboundLog.messageId @unique)
extractAlias() → local-part из Delivered-To/X-Original-To/To
  ↓ Project.findUnique({ emailInboxAlias })  // @unique глобально
  ├── null/disabled → MailInboundLog(bounced, reason)
  └── ok → IssuesService.create({
            externalSource: 'email',
            externalId: messageId,
            title: subject.slice(0, 200),
            description: text/html.slice(0, 5000),
          })
            ↓
            Issue + MailInboundLog(created, issueId)
            ↓ для каждого attachment:
            S3.putObject + IssueAttachment.create
            ↓
            client.messageFlagsAdd(\Seen)
```

### 5.2 LLM-вызовы внутри процесса

LLM здесь **не вызывается**. Email-to-task — детерминированный pipeline (parser + routing + create). Авто-тэгирование / приоритезация задач (`IntakeAutoTriageQueueService`) — отдельный процесс, не часть этого.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики** (см. `backend/src/common/metrics/business-metrics.service.ts`):
- `mail_inbound_received_total{project_id, status}` — все обработанные письма (status ∈ `created|bounced|failed`).
- `mail_inbound_bounce_total{reason}` — причина отбоя (`no_message_id|no_alias_in_to|alias_not_found|disabled`).
- `mail_inbound_issue_created_total` — задачи, реально созданные из писем.
- `mail_inbound_attachment_uploaded_total` — успешные загрузки вложений в S3.

**Cron / поллинг:**
- `ImapPollCron @Cron('*/2 * * * *')` — каждые 2 минуты по умолчанию (ENV `MAIL_INBOX_POLL_CRON`).
- Per-проход лимит — `MAIL_INBOX_MAX_PER_RUN=50`.

**ENV / тумблеры:**
- `MAIL_INBOX_ENABLED` — глобальный kill-switch (по умолчанию `false`).
- `MAIL_INBOX_DOMAIN` (default `inbox.kora.app`), `MAIL_INBOX_IMAP_HOST/USER/PASS/PORT/TLS/FOLDER`.

**Логи:** `ImapPollCron`, `ProjectInboxService` (warn на failed-письмах с указанием uid / messageId / err).

**Известные грабли:**
- **Письма без `Message-ID`** отбрасываются (outcome=`failed`, метрика `mail_inbound_bounce_total{reason='no_message_id'}`). Это сознательно — без Message-ID нет идемпотентности.
- **`failed`-письма НЕ помечаются `\Seen`** — застрянут в IMAP навсегда, если ошибка стабильная. Компромисс ради надёжности (ручной разбор через `MailInboundLog.recentLogs` в UI оператора).
- **`emailInboxAlias` уникален глобально**, не per-tenant. Конфликты между Org решаются на создании alias'а (см. `ProjectEmailInboxService`).
- **Дублирование IMAP-логики** между `ProjectInboxService` (этот процесс — Issue) и `EmailFetchService` (RawEvent, [[ingest-and-sources]]). См. явный комментарий в `project-inbox.service.ts:44`.

**Кнопки админки:**
- Per-project: `/tracker/projects/[projectId]/settings/email-inbox` (управление alias / тумблер / последние логи) — управляется `ProjectEmailInboxController`.
- Глобально в `/admin/platform/workers` отдельной очереди нет (cron, не BullMQ).

## 7. Связанные процессы

- [[ingest-and-sources]] (если будет карточка) — **параллельная** email-ingest цепочка через `EmailFetchService` + `Source(type='email')` per-tenant. Тот же IMAP-стек, но: alias не используется, конечная точка — `RawEvent` в графе знаний, не `Issue` в трекере. Это два независимых процесса в одной кодовой базе — намеренное разделение flows (см. комментарий `project-inbox.service.ts:44`).
- [[issue-lifecycle]] (если будет карточка) — то, что происходит с `Issue` после создания.
- [[telegram-inbox-ingestion]] — параллельный канал создания задач из Telegram (через `TelegramBotMessageHandler` → `IntakeService` → `Issue`).

## 8. Расхождения «задумано vs реализовано»

**Реализовано полностью:**
- IMAP-поллинг + парсинг + alias routing + создание Issue + вложения → S3.
- Идемпотентность по Message-ID через `MailInboundLog.messageId @unique`.
- Bounce-логи с причинами для оператора.
- Per-project тумблер `emailInboxEnabled` (управляется через `ProjectEmailInboxController`).

**Реализовано иначе, чем ожидалось:**
- **Email-приём НЕ через ConversationalModule.** В ожиданиях каталога T5 был «общий email-ingest через `email_imap` канал в `Channel/ChannelBinding`». Реальность: `MailInboundModule` — отдельный модуль вне `ConversationalModule`, со своим cron'ом, своей моделью (`MailInboundLog`), своими метриками (`mail_inbound_*`, не `conversational_inbound_*`). `Channel(kind='email_imap')` существует в схеме (`ChannelKind`) и упоминается в `link-code`, но реально не используется — нет адаптера `email_imap` в `ChannelRegistry`. Это сознательное решение (см. комментарий `project-inbox.service.ts:44`): per-project alias vs per-tenant Source — разные парадигмы.
- **Два разных IMAP-сервиса.** `EmailFetchService` (для `Source(type='email')` → RawEvent, граф) и `ProjectInboxService` (для общего ящика → Issue в трекере). Логика IMAP-connection скопирована, не разделена в общий util — явный долг.

**Не реализовано (gap):**
- **Outbound email-reply на письмо в Issue не реализован.** Если задача создана из письма, и кто-то добавил комментарий — клиент не получит email-ответ. Это снижает ценность фичи (клиент не понимает, что произошло с его обращением). В ТЗ T5 это присутствовало как future-task.
- **Auto-triage email-задач не подключён.** `IntakeAutoTriageQueueService` существует и используется в Telegram-обработке задач, но из email-flow его не вызывают. Email-задачи всегда создаются с `priority='none'` и без лейблов.

**Реализовано, не описано в ТЗ:**
- **`ChannelKind.email_imap`** добавлен в enum (`backend/prisma/schema.prisma`, `link-code` поддерживает в `LinkCodeKindSchema`), но реального адаптера в `ChannelRegistry` нет. Это «зарезервированное место» для будущего объединения с email-ingest через `Channel`.
- **`fail-open` на entitlement-проверке** в `EmailFetchCron` (не в этом процессе, но в близком): если `EntitlementService` упал, письма всё равно ingestятся. В `ProjectInboxService` entitlement не проверяется вообще — email-to-task всем включенным проектам доступен.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана. Зафиксировано разделение `MailInboundModule` vs `ConversationalModule`. | этот документ |
| Tracker Phase 4 / T5 | Email-to-task: `ProjectInboxService`, `MailInboundLog`, `ImapPollCron`, `Project.emailInboxAlias/Enabled` | plans/tz/tracker-phase-4-rf.md |
