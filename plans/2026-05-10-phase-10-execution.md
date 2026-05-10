---
type: execution-plan
phase: 10
feature: knowledge-core — дополнительные источники (telegram-бот, телефония, email/IMAP, web-form-дамп) + per-Org API-ключи для ingest
status: planned
date: 2026-05-10
source-tz: plans/tz/2026-05-10-knowledge-core-tz.md (§ Фаза 10)
---

# Фаза 10 — execution-план.

## Что входит и что НЕ входит

**Входит:** 4 адаптера источников (`telegram`, `phone_call`, `email`, `web_form`) поверх уже работающего `IngestService` (Фаза 1), per-Org API-ключи вместо `INGEST_INTERNAL_TOKEN`, UI `/settings/sources` для подключения/отключения/теста.

**НЕ входит (vNext):** WhatsApp Business, второй провайдер телефонии, OAuth для Gmail/Outlook (вместо IMAP-логин-пароль), bulk-импорт исторических переписок, message-edits/deletes (только append-only ingest). Каждый адаптер обрабатывает ровно ту схему, которую выдаёт его внешний API/протокол; нормализация смыслов делается block-ingest.worker'ом из Фазы 2.

## Принципиальные решения

1. **Адаптеры — отдельные подмодули** в [backend/src/modules/ingest/adapters/](backend/src/modules/ingest/adapters/), каждый со своим контроллером, сервисом и (при необходимости) cron'ом. Все они в итоге вызывают единственный `IngestService.ingest(...)` ([backend/src/modules/ingest/ingest.service.ts:77](backend/src/modules/ingest/ingest.service.ts#L77)) — никакой записи в `RawEvent` напрямую.
2. **Один Org → один Source per type per name.** Уникальность `Source(tenantId, type, name)` уже есть ([schema.prisma:1257](backend/prisma/schema.prisma#L1257)). Telegram-бот регистрируется как `Source(type=bot, name='Telegram: @<botUsername>')`. IMAP-почта — `Source(type=email, name=<imapUser>)`. АТС — `Source(type=phone_call, name='Mango: <ext>')`. Web-form — один общий `Source(type=web_form, name='Дамп мысли')` на Org.
3. **Идемпотентность по `sourceExternalId`** — определяется адаптером:
   - telegram — `tg:<chatId>:<messageId>`,
   - email — `Message-ID` заголовок (если нет — `sha256(from+date+subject+bodyLen)`),
   - phone_call — внешний `callId` от АТС,
   - web_form — `web:<userId>:<submitNonce>` (генерируется фронтом).
4. **Per-Org API-ключи** — расширяем существующую модель `ApiKey` (есть в схеме) новым `scope='ingest'`. `IngestTokenGuard` ([backend/src/modules/ingest/guards/ingest-token.guard.ts](backend/src/modules/ingest/guards/ingest-token.guard.ts)) поддерживает два режима: legacy `INGEST_INTERNAL_TOKEN` (для in-process backend-cron'ов IMAP-fetcher'а) и per-Org ключ (для внешних webhook'ов). Per-Org ключ автоматически привязывает запрос к `tenantId` ключа — тело запроса `tenantId` игнорируется/проверяется на совпадение.
5. **Гейтинг по тарифу** — каждый адаптер защищён `@RequireEntitlement('feature.adapter_<type>')` (декоратор появляется в Фазе 12). На Фазе 10 декоратор не используется (`OrgEntitlement` ещё нет) — стоит TODO-комментарий с конкретной строкой `// FIXME knowledge-core Фаза 12: добавить @RequireEntitlement(...)`.
6. **Чувствительные данные.** `dataClass` адаптер берёт из `Source.dataClass` (default = `internal`). Email адаптер: если в теме письма есть маркер `[CONFIDENTIAL]` или письмо в зашифрованной папке — поднимаем до `sensitive`. Telegram — берём из `Source.dataClass` без эвристик (на MVP).

## Backend

### Шаг 1 — Расширение `ApiKey` под scope='ingest'

- [ ] **Prisma schema**:
  - В `model ApiKey` поле `scope String @default("api")` уже есть (предположительно — проверить; если нет — добавить).
  - Добавить новое значение в Zod-валидаторе `ApiKeyCreateSchema`: `scope: z.enum(['api', 'ingest'])`.
  - Если `scope='ingest'`, то ключ нельзя использовать для других путей (см. шаг 2).
- [ ] **db push**: `bun run prisma:push --accept-data-loss` (если поле меняется).
- [ ] **Backfill не нужен** — существующие ключи остаются `scope='api'`.

### Шаг 2 — `IngestTokenGuard` с двумя режимами

- [ ] Добавить второй путь авторизации: если `Authorization: Bearer <token>` начинается с префикса `zik_` (zet ingest key) — резолвим через `ApiKeysService.findByPrefix(...)`, проверяем:
  - ключ существует, не отозван, `scope='ingest'`,
  - `apiKey.tenantId` есть.
- [ ] При успехе — кладём в `req.ingestContext = { tenantId, apiKeyId, source: 'org_key' }`. Контроллеры читают оттуда `tenantId` и игнорируют поле `tenantId` из body (или 400, если оно есть и не совпадает).
- [ ] Если префикса нет — текущая логика shared-secret работает как раньше (для in-process IMAP-cron'ов).
- [ ] Логирование в `ApiAccessLog` (модель уже есть, [schema.prisma:1034](backend/prisma/schema.prisma#L1034)) — для аудита внешних обращений.

### Шаг 3 — `SourcesController` + `SourcesService`

Новый модуль [backend/src/modules/sources/](backend/src/modules/sources/) — owner/admin-only управление Source'ами.

- [ ] `GET /api/v1/sources` — список Source'ов текущего Org (фильтр по type).
- [ ] `POST /api/v1/sources` — создать; body: `{type, name, config}`. `config` валидируется по type (см. шаги 4–7).
- [ ] `PATCH /api/v1/sources/:id` — обновить `name`, `config`, `isActive`, `dataClass`.
- [ ] `DELETE /api/v1/sources/:id` — soft-delete (`isActive=false`); реальное удаление — vNext (есть FK от RawEvent через onDelete: Restrict).
- [ ] `POST /api/v1/sources/:id/test` — адаптер-зависимый smoke-test (см. шаги 4–7), возвращает `{ok, details, lastErrorMessage?}`.
- [ ] Все endpoints под `CookieAuthGuard + TenantGuard + RbacGuard('source', 'manage')`.

### Шаг 4 — Адаптер `telegram`

Подмодуль [backend/src/modules/ingest/adapters/telegram/](backend/src/modules/ingest/adapters/telegram/).

- [ ] **`Source.config` schema (zod)** для `type=bot`, `subtype='telegram'`:
  ```ts
  TelegramBotConfigSchema = z.object({
    subtype: z.literal('telegram'),
    botToken: z.string().min(40),         // шифруется через CryptoService при write, расшифровывается lazy
    botUsername: z.string(),              // для отображения в UI: «@meeting_helper_bot»
    webhookSecret: z.string().min(32),    // X-Telegram-Bot-Api-Secret-Token
    allowedChatIds: z.array(z.number()).default([]),  // empty = принимать ВСЕ чаты
    includeForwarded: z.boolean().default(false),
  });
  ```
- [ ] **`TelegramAdapterService.registerWebhook(sourceId)`** — при создании/активации Source: HTTP POST на Telegram Bot API `setWebhook` с URL `https://<host>/api/v1/ingest/telegram/<sourceId>` и `secret_token=<webhookSecret>`. URL хоста — из `cfg.publicHostUrl`.
- [ ] **`TelegramAdapterService.unregisterWebhook(sourceId)`** — при `isActive=false` или delete: `deleteWebhook`.
- [ ] **`POST /api/v1/ingest/telegram/:sourceId`** (новый контроллер `TelegramWebhookController`, без `IngestTokenGuard` — авторизация через `X-Telegram-Bot-Api-Secret-Token` header):
  - валидация secret-токена (timing-safe compare, как в `IngestTokenGuard`),
  - `Source` lookup по `sourceId`, проверка `type=bot`, `isActive=true`, `subtype='telegram'`,
  - `allowedChatIds` filter: если массив непустой и `update.message.chat.id` не в нём → `200 ok` без ingest (Telegram не любит non-2xx),
  - `update.message.forward_from_chat` фильтр: если `includeForwarded=false` и есть forward — пропускаем,
  - **payload**: `{updateId, chatId, messageId, fromUserId, fromUsername, text, photoFileIds[], date, raw}` — `raw` это весь оригинальный update (для возможной дораскодировки в будущем),
  - `sourceExternalId = "tg:" + chatId + ":" + messageId`,
  - `occurredAt = new Date(update.message.date * 1000)`,
  - вызов `IngestService.ingest({...})` с `dataClass = source.dataClass`.
- [ ] **Test endpoint** `POST /api/v1/sources/:id/test` для telegram: `getMe` через Bot API → возвращает `{botUsername, canReceiveUpdates}`.
- [ ] **Метрика**: `ingest_adapter_events_total{adapter='telegram',status='accepted|filtered|failed'}`.
- [ ] **Лимит**: первый payload > 4 МБ (медиа-сообщения) — отклоняем с `payload_too_large`. Скачивание медиа в S3 — vNext.

### Шаг 5 — Адаптер `phone_call` (Mango Office)

Подмодуль [backend/src/modules/ingest/adapters/phone-call/](backend/src/modules/ingest/adapters/phone-call/).

- [ ] **`Source.config`** для `type=phone_call`, `subtype='mango'`:
  ```ts
  MangoCallConfigSchema = z.object({
    subtype: z.literal('mango'),
    apiKey: z.string().min(20),     // Mango API key — зашифровать
    apiSalt: z.string().min(20),    // их HMAC-salt
    extensions: z.array(z.string()).default([]),  // фильтр по добавочным
  });
  ```
- [ ] **`POST /api/v1/ingest/calls/mango/:sourceId`** (контроллер `MangoCallWebhookController`):
  - валидация подписи Mango: `sign = sha256(apiKey + json + apiSalt)` (по их docs),
  - `Source` lookup,
  - проверяем `event.entry === 'call'` (есть `summary` событие после звонка),
  - **создаём Meeting-родственное событие**: `Meeting(type='phone_call', source='external', externalCallId=<callId>, ownerId=null, ...)`. Точная схема — в шаге 5b.
  - кладём короткий «metadata-only» payload в `IngestService.ingest`. Сама транскрипция — асинхронно.
- [ ] **Шаг 5b — асинхронная транскрипция**:
  - Скачать запись звонка по `recordUrl` из event (Mango выдаёт MP3) → S3 `phone-calls/<tenantId>/<callId>.mp3`.
  - Поставить job в существующую очередь `transcribe.queue` (тот же Vox/GigaAM, что для встреч), но с `MeetingType='phone_call'` для роутинга промптов.
  - После транскрипции — `MeetingIngestAdapter.ingestMeeting(meetingId)` (Фаза 1) уже работает универсально → блоки появятся.
- [ ] **Test endpoint**: проверка подписи на тестовом payload (без реального звонка).
- [ ] **Метрика**: `ingest_adapter_events_total{adapter='phone_call',...}`, `phone_call_transcribe_duration_seconds`.

### Шаг 6 — Адаптер `email` (IMAP)

Подмодуль [backend/src/modules/ingest/adapters/email/](backend/src/modules/ingest/adapters/email/).

- [ ] **`Source.config`** для `type=email`, `subtype='imap'`:
  ```ts
  ImapMailboxConfigSchema = z.object({
    subtype: z.literal('imap'),
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean().default(true),
    user: z.string(),
    passwordEnc: z.string(),         // зашифровано CryptoService'ом
    folder: z.string().default('INBOX'),
    sinceDate: z.string().datetime().optional(), // для первого запуска
    sensitiveFolders: z.array(z.string()).default([]),  // папки, payload из которых = sensitive
  });
  ```
- [ ] **`EmailFetchService.fetchOne(sourceId)`**:
  - подключение `node-imap` (или `imapflow`),
  - `SEARCH UNSEEN SINCE <lastFetchAt or sinceDate>`,
  - для каждого письма: `mailparser` → `{messageId, from, to, cc, subject, date, text, html, attachments[]}`,
  - вложения > 1 MB → S3 `email-attachments/<tenantId>/<messageId>/<filename>`, ссылка в payload,
  - `sourceExternalId = messageId ?? sha256(from+date+subject+bodyLen)`,
  - `dataClass = sensitiveFolders.includes(currentFolder) ? 'sensitive' : source.dataClass`,
  - `IngestService.ingest(...)`,
  - после успешного ingest — `flag \\Seen`.
- [ ] **`EmailFetchCron`** (новый):
  ```ts
  @Cron('*/5 * * * *')
  async sweep() {
    if (!cfg.knowledgeCore.emailFetchEnabled) return;
    const sources = await prisma.source.findMany({ where: { type: 'email', isActive: true } });
    for (const s of sources) await this.svc.fetchOne(s.id).catch(log);
  }
  ```
- [ ] **ENV**: `EMAIL_FETCH_ENABLED` (default `false`), `EMAIL_FETCH_CRON` (default `'*/5 * * * *'`), `EMAIL_FETCH_MAX_PER_RUN` (default `50` писем за один проход на Source).
- [ ] **Test endpoint**: `POST /api/v1/sources/:id/test` для IMAP — пробует connect+login, возвращает `{ok, folderCount, lastUid}`.
- [ ] **CryptoService.encrypt/decrypt** — нужен сервис для шифрования паролей IMAP/токенов Telegram. Если уже есть — используем, иначе создаём как `backend/src/common/crypto/crypto.service.ts` с AES-256-GCM на ENV-ключе `CRYPTO_MASTER_KEY` (32 байта base64).

### Шаг 7 — Адаптер `web_form` («дамп мысли»)

- [ ] **`POST /api/v1/ingest/dump`** под `CookieAuthGuard + TenantGuard` (не shared-secret, не ApiKey):
  - body: `{text: string, occurredAt?: ISO, dataClass?: DataClass}`,
  - lazy-upsert `Source(tenantId, type='web_form', name='Дамп мысли')`,
  - `sourceExternalId = "web:" + userId + ":" + nonce` (nonce генерится фронтом),
  - payload: `{text, authorUserId, authorName}`,
  - вызов `IngestService.ingest`.
- [ ] **Quota**: `dump_per_day_per_user` (через существующий `QuotaService` ([backend/src/modules/quotas/quota.service.ts](backend/src/modules/quotas/quota.service.ts))), default 30/день.
- [ ] **Аудит**: `AuditLog(action='dump.created', resourceId=rawEventId, metadata={length, dataClass})`. Добавить константу `DUMP_CREATED` в [backend/src/modules/audit/audit.types.ts](backend/src/modules/audit/audit.types.ts).

### Шаг 8 — Регистрация модулей

- [ ] В `IngestModule` ([backend/src/modules/ingest/ingest.module.ts](backend/src/modules/ingest/ingest.module.ts)) добавить новые контроллеры (`TelegramWebhookController`, `MangoCallWebhookController`, `WebFormDumpController`) и сервисы.
- [ ] Email-fetcher и cron — в отдельном `IngestEmailModule` (потому что зависит от cron-scheduler'а; пусть импортируется из `IngestModule` или регистрируется в `AppModule`).
- [ ] `SourcesModule` — отдельный, импортируется в `AppModule`.

## Frontend

### Шаг 9 — Страница `/settings/sources`

- [ ] [frontend/app/(authenticated)/settings/sources/page.tsx](frontend/app/(authenticated)/settings/sources/page.tsx) — server обёртка, metadata.
- [ ] `SourcesClient.tsx` — таблица Source'ов: иконка по type (telegram/phone/mail/web), name, isActive toggle, dataClass badge, last RawEvent timestamp, кнопка «Тест», «Настроить», «Отключить».
- [ ] Кнопка «Подключить источник» → модалка с выбором типа → форма по типу:
  - **Telegram**: поля `botToken` (password input + подсказка «получить у @BotFather»), `botUsername`, `allowedChatIds` (textarea, по строке), `includeForwarded` (checkbox), `dataClass` (select). После сохранения — показать сгенерированный webhook URL (для пользователя информативно, секрет внутри).
  - **Mango**: `apiKey`, `apiSalt`, `extensions` (массив). Показать webhook URL для настройки в кабинете Mango.
  - **IMAP**: `host`, `port`, `secure`, `user`, `password`, `folder`, `sensitiveFolders`. Кнопка «Проверить подключение» (вызывает `POST /sources/:id/test`).
  - **Web-form**: только `dataClass` и `isActive` — само создание тривиальное.
- [ ] Sidebar: пункт «Источники» в группе «Настройки».

### Шаг 10 — Страница `/dump` (web-form-адаптер)

- [ ] [frontend/app/(authenticated)/dump/page.tsx](frontend/app/(authenticated)/dump/page.tsx) — большая textarea (`min-h-[60vh]`, monospace), кнопка «Сохранить мысль», счётчик символов.
- [ ] Перед submit — генерация `nonce = crypto.randomUUID()`, `POST /api/v1/ingest/dump`. На `429 quota_exceeded` — toast с retry-after.
- [ ] После успешного submit — toast «Мысль отправлена в knowledge-core», очистить textarea.
- [ ] Sidebar: пункт «Дамп мысли» (`Brain` icon, lucide-react).

## Verification

- [ ] `bun run typecheck` (backend) — зелёный.
- [ ] `bun run typecheck` (frontend) — зелёный.
- [ ] `bun run prisma:push` (если меняли schema под `ApiKey.scope`) — успешно.
- [ ] **Smoke по адаптеру** (на dev):
  - Telegram: создать source с боевым ботом, отправить ему сообщение → `RawEvent` создан → через 30 сек блок появляется в `/search`.
  - Mango: послать тестовый webhook через `curl` с правильной подписью → `Meeting(type='phone_call')` создан → транскрипция уходит в очередь.
  - IMAP: создать source с тестовым ящиком (можно maildev контейнер) → отправить туда письмо → cron в 5 мин сделает fetch → `RawEvent` есть.
  - Web-form: открыть `/dump`, отправить текст → toast → `RawEvent` в БД.

## Что НЕ сделано (вне Фазы 10)

- WhatsApp Business / второй провайдер телефонии / OAuth-Gmail — vNext, отдельные адаптеры по той же схеме.
- Скачивание медиа из Telegram (фото/документы) в S3 с распознаванием — vNext.
- Email: edits/replies threading — пока каждое письмо = отдельный `RawEvent`. Группировка в IdeaBlock — задача block-distill.worker'а (Фаза 2).
- Bulk-импорт исторических переписок — vNext (отдельная очередь, throttling, идемпотентность по `sinceDate`).
- `@RequireEntitlement('feature.adapter_*')` — добавляется в Фазе 12. До тех пор адаптеры доступны всем Org. TODO-комментарии оставлены в каждом контроллере.
- Полноценное API-key UI (генерация ingest-ключа из админки, ротация) — частично есть в `/settings/api-keys`, расширение на `scope='ingest'` — vNext (минимально достаточно: backend-поддержка + ручное создание через Z-Admin Фазы 7).

## Затронутые файлы

### Schema / config
- `backend/prisma/schema.prisma` — `ApiKey.scope` (если нужно расширить enum/тип).
- `backend/src/common/config/env.schema.ts` — `EMAIL_FETCH_ENABLED`, `EMAIL_FETCH_CRON`, `EMAIL_FETCH_MAX_PER_RUN`, `CRYPTO_MASTER_KEY`, `PUBLIC_HOST_URL` (если ещё нет).
- `backend/src/common/config/typed-config.service.ts` — геттеры `cfg.knowledgeCore.email*`, `cfg.crypto.masterKey`, `cfg.publicHostUrl`.

### Common
- `backend/src/common/crypto/crypto.service.ts` — новый (если нет).
- `backend/src/common/crypto/crypto.module.ts` — новый, `@Global()`.

### Ingest / адаптеры
- `backend/src/modules/ingest/guards/ingest-token.guard.ts` — расширение под per-Org ApiKey.
- `backend/src/modules/ingest/adapters/telegram/telegram.controller.ts` — новый.
- `backend/src/modules/ingest/adapters/telegram/telegram.service.ts` — новый.
- `backend/src/modules/ingest/adapters/telegram/telegram-config.schema.ts` — новый.
- `backend/src/modules/ingest/adapters/phone-call/mango.controller.ts` — новый.
- `backend/src/modules/ingest/adapters/phone-call/mango.service.ts` — новый.
- `backend/src/modules/ingest/adapters/phone-call/mango-config.schema.ts` — новый.
- `backend/src/modules/ingest/adapters/email/email-fetch.service.ts` — новый.
- `backend/src/modules/ingest/adapters/email/email-fetch.cron.ts` — новый.
- `backend/src/modules/ingest/adapters/email/imap-config.schema.ts` — новый.
- `backend/src/modules/ingest/adapters/email/ingest-email.module.ts` — новый.
- `backend/src/modules/ingest/adapters/web-form/dump.controller.ts` — новый.
- `backend/src/modules/ingest/adapters/web-form/dump.service.ts` — новый.
- `backend/src/modules/ingest/ingest.module.ts` — регистрация новых controllers/services.

### Sources
- `backend/src/modules/sources/sources.controller.ts` — новый.
- `backend/src/modules/sources/sources.service.ts` — новый.
- `backend/src/modules/sources/dto/source.dto.ts` — новый.
- `backend/src/modules/sources/sources.module.ts` — новый.

### Audit / quotas
- `backend/src/modules/audit/audit.types.ts` — добавить `DUMP_CREATED`, `SOURCE_CREATED`, `SOURCE_UPDATED`, `SOURCE_DELETED`, `SOURCE_TESTED`, `INGEST_API_KEY_USED`.

### Frontend
- `frontend/app/(authenticated)/settings/sources/page.tsx` — новый.
- `frontend/app/(authenticated)/settings/sources/SourcesClient.tsx` — новый.
- `frontend/app/(authenticated)/dump/page.tsx` — новый.
- `frontend/app/(authenticated)/dump/DumpClient.tsx` — новый.
- `frontend/src/api/sources.api.ts` — новый.
- `frontend/src/api/dump.api.ts` — новый.
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — добавить пункты «Источники», «Дамп мысли».

## DoD

- [ ] Owner может из UI подключить любой из 4 адаптеров и увидеть его в списке `/settings/sources`.
- [ ] Тестовое сообщение / звонок / письмо / дамп доходит до `RawEvent` (видно в `/api/v1/raw-events/:id` для admin).
- [ ] Через несколько минут (после block-ingest.worker / block-distill.worker из Фазы 2) — блоки доступны в `/search` и в `/chat` (scope='org').
- [ ] Внешние webhook'и проходят авторизацию: telegram — через secret-header, mango — через подпись, ingest API — per-Org ApiKey (`zik_*`).
- [ ] Идемпотентность: повторный webhook с тем же `sourceExternalId` не создаёт дубль.
- [ ] Соблюдение `dataClass`: при `sensitive` блоки не уходят во внешние LLM (это требование Фазы 11; на Фазе 10 dataClass только сохраняется, не enforced).
- [ ] Обновлён `second-brain/01_projects/ingest-and-sources.md` (создать, если нет): описание каждого адаптера, ENV, схемы `Source.config`, ограничения.
- [ ] Обновлён `second-brain/01_projects/api-layer.md`: новые endpoints `/api/v1/ingest/telegram/:id`, `/api/v1/ingest/calls/mango/:id`, `/api/v1/ingest/dump`, `/api/v1/sources/*`.
- [ ] Обновлён `second-brain/01_projects/admin.md`: страница `/settings/sources`, `/dump`.
- [ ] Обновлён `second-brain/01_projects/workers-queues.md`: `email-fetch.cron`, добавление `transcribe.queue` для `phone_call`.
- [ ] Чек-лист «Фаза 10» в `plans/tz/2026-05-10-knowledge-core-tz.md` помечен `[x]`.
