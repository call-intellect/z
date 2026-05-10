---
type: execution-plan
phase: 10
feature: knowledge-core — дополнительные источники (telegram-бот, телефония, email/IMAP, web-form-дамп) + per-Org API-ключи для ingest
status: in_progress
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

### Шаг 1 — Расширение `ApiKey` под scope='ingest'  ✅ DONE

- [x] **Prisma schema**: добавлено поле `ApiKey.scope String @default("api")` + индекс на `prefix`. Применён `prisma db push`.
- [x] **Zod-валидатор**: `CreateApiKeySchema.scope: z.enum(['api', 'ingest'])` (default `'api'`).
- [x] **`ApiKeysService.create(userId, dto, tenantId?)`** + `resolveIngestKey(rawKey)` — проверки revokedAt + scope='ingest'.
- [x] Префиксы: `z_*` (api) и `zik_*` (ingest).

### Шаг 2 — `IngestTokenGuard` с двумя режимами  ✅ DONE

- [x] Per-Org ApiKey (`zik_*`) → `ApiKeysService.resolveIngestKey` → `req.ingestContext = { tenantId, apiKeyId, source: 'org_key' }`.
- [x] Shared-secret (`INGEST_INTERNAL_TOKEN`) → `req.ingestContext = { tenantId: null, apiKeyId: null, source: 'shared_secret' }`.
- [x] `body.tenantId !== ingestContext.tenantId` → 403 `tenant_mismatch`.
- [x] `ApiAccessLog` пишется fire-and-forget при per-Org вызовах.

### Шаг 3 — `SourcesController` + `SourcesService`  ✅ DONE

- [x] `GET /api/v1/sources?type=`, `GET /:id`, `POST`, `PATCH`, `DELETE` (soft `isActive=false`), `POST /:id/test`.
- [x] Под `CookieAuthGuard + TenantGuard`. RBAC проверки явные через `RbacService` (`requireRead`/`requireManage`/`requireDelete`).
- [x] Расширен `RbacService.ResourceType` (`'source'`) + `policy.csv` (owner manage/delete, admin manage, manager read).
- [x] CryptoService (@Global) шифрует секреты в `Source.config` (botToken / apiKey / apiSalt / passwordEnc) — формат `gcm:v1:<iv>:<tag>:<ct>`. UI получает `<encrypted>`. При update значение `<encrypted>` подменяется на сохранённое в БД.
- [x] `lastEventAt` — последняя `RawEvent.receivedAt` (через `groupBy`).
- [x] `webhookUrl` отдаётся для type=bot и phone_call.
- [x] ENV: `CRYPTO_MASTER_KEY`, `PUBLIC_HOST_URL`.

### Шаг 4 — Адаптер `telegram`  ✅ DONE

- [x] `TelegramBotConfigSchema` (Zod) — `botToken/botUsername/webhookSecret>=32/allowedChatIds/includeForwarded`.
- [x] `TelegramAdapterService.registerWebhook` / `unregisterWebhook` через Bot API; URL `https://<publicHostUrl>/api/v1/ingest/telegram/<sourceId>`.
- [x] `POST /api/v1/ingest/telegram/:sourceId` без `IngestTokenGuard`, авторизация через `X-Telegram-Bot-Api-Secret-Token` (timing-safe compare).
- [x] Поддержка `update.message` и `update.channel_post`. Фильтры `allowedChatIds`, `includeForwarded`.
- [x] Payload: `{updateId, chatId, chatTitle, messageId, fromUserId, fromUsername, fromName, text, photoFileIds, date, raw}`. `sourceExternalId = 'tg:<chatId>:<messageId>'`.
- [x] `getMe` для smoke-test через `SourcesService.test`.
- [x] Лимит payload >4 MiB через `content-length` → 400 `payload_too_large`.
- [ ] Метрика `ingest_adapter_events_total{adapter='telegram',status=...}` — отложено, как vNext (отдельный label-pattern; не блокирующее).

### Шаг 5 — Адаптер `phone_call` (Mango Office)  ✅ DONE (с отклонением)

- [x] `MangoCallConfigSchema` (Zod) — `apiKey>=20/apiSalt>=20/extensions[]`.
- [x] `POST /api/v1/ingest/calls/mango/:sourceId` — form-encoded body `{json, sign}`. Подпись `sha256(apiKey+json+apiSalt)` валидируется.
- [x] Только `event.entry === 'call'` (summary). Фильтр по `extensions`.
- [x] `recordUrl` (если есть) скачивается в S3 `phone-calls/<tenantId>/<callId>.mp3` (fire-and-forget; ошибки не блокируют ingest).
- [x] Payload metadata-only: `{callId, from, to, durationSec, direction, recordingUrlExternal, recordS3Key, raw}`. `sourceExternalId='mango:<callId>'`.
- [x] `MangoAdapterService.test` (UI smoke-test): расшифровка ключей + расчёт sample-подписи.
- [ ] **ОТКЛОНЕНИЕ:** Meeting(type='phone_call') НЕ создаётся. `MeetingType` enum не содержит `phone_call`, у `Meeting` нет полей `source`/`externalCallId`, `ownerId` не nullable. Расширение схемы потребует изменения десятков controllers/UI — вне MVP Фазы 10. Хранится только `RawEvent`. Транскрипция и интеграция с `transcribe.queue` — vNext (отдельный воркер `phone-transcribe.worker`). Подробности: `plans/decisions-log.md` 2026-05-10.

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
- [x] `ImapMailboxConfigSchema` (Zod) — `host/port/secure/user/passwordEnc/folder/sinceDate?/sensitiveFolders`.
- [x] `EmailFetchService.fetchOne` через `imapflow` + `mailparser`. `SEARCH UNSEEN SINCE` (max(receivedAt)-1min или sinceDate или -7d). Attachments >1MB → S3 `email-attachments/<tenantId>/<messageId>/<filename>`. `sourceExternalId = Message-ID || 'email-fallback:<sha256-32>'`. dataClass повышается до `sensitive` если `sensitiveFolders.includes(folder)`. После ingest — `flag \\Seen`.
- [x] `EmailFetchCron @Cron('*/5 * * * *')`: гейт по `EMAIL_FETCH_ENABLED` + `WorkerOrgGate.checkOrThrow(tenantId, 'email-fetch')`.
- [x] ENV: `EMAIL_FETCH_ENABLED`/`EMAIL_FETCH_CRON`/`EMAIL_FETCH_MAX_PER_RUN`.
- [x] Test endpoint: `EmailFetchService.test` (connect+login+folderCount+lastUid).
- [x] CryptoService — реализован в Шаге 3 (Фаза 10).

### Шаг 7 — Адаптер `web_form` («дамп мысли»)  ✅ DONE

- [x] `POST /api/v1/ingest/dump` под `CookieAuthGuard + TenantGuard` (Cookie+Org, не shared-secret, не ApiKey).
- [x] Body Zod: `{text: 1..50000, occurredAt? ISO, dataClass? DataClass, nonce? 8..64}`.
- [x] `DumpService.createDump`: lazy-upsert `Source(tenantId, type='web_form', name='Дамп мысли')`; `sourceExternalId = 'web:<userId>:<nonce>'` (server-side UUID если nonce не передан).
- [x] Quota `dump_per_day_per_user` (max=30, window=24h) через `QuotaService.checkAndIncrement` — на превышение `429 quota_exceeded` с retry-after.
- [x] Audit `AUDIT.DUMP_CREATED` (`metadata: {length, dataClass}`).

### Шаг 8 — Регистрация модулей  ✅ DONE

- [x] `IngestModule` controllers: `IngestController` + `RawEventsController` + `TelegramWebhookController` + `MangoCallWebhookController` + `WebFormDumpController`.
- [x] `IngestModule` providers/exports: `IngestService`, `MeetingIngestAdapter`, `TelegramAdapterService`, `MangoAdapterService`, `DumpService`, `IngestTokenGuard`, `S3Service`.
- [x] `IngestEmailModule` (отдельно в AppModule) — `EmailFetchService` + `EmailFetchCron`.
- [x] `SourcesModule` (отдельно в AppModule) — импортирует `IngestEmailModule` для smoke-test IMAP.
- [x] `CryptoModule` (@Global, AppModule).
- [x] Audit constants добавлены: `SOURCE_CREATED/UPDATED/DELETED/TESTED`, `DUMP_CREATED`, `INGEST_API_KEY_USED`.
- [x] `RbacService.ResourceType` расширен `'source'`; policy.csv обновлён.
- [x] `bun run typecheck` зелёный, `bun run build` зелёный.

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
