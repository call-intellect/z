---
title: Безопасность Z (новое в ai-workspace)
status: actual
updated: 2026-05-09
---

# Безопасность Z

## SSRF-защита (`backend/src/modules/security/ssrf-guard.service.ts`)

Все outbound HTTP вызовы из webhooks-out / destinations проходят через `SsrfGuardService.assertSafeOutboundUrl(url)`:

1. **Протокол:** только `http`/`https`. Блокируются `javascript:`, `file:`, `gopher:`, `data:` etc.
2. **Хост:** блокируются:
   - `localhost`, `127.0.0.0/8`, `[::1]`
   - link-local: `169.254.0.0/16` (включая cloud-metadata `169.254.169.254`)
   - private RFC1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
3. **DNS-resolve перед каждым fetch** через `node:dns/promises.lookup` — защита от DNS-rebinding (атакующий может зарегистрировать домен с TTL=0, отдавать сначала публичный IP, потом приватный).
4. **Whitelist** через `WEBHOOK_EGRESS_ALLOWED_HOSTS` (CSV) — для тестирования.
5. **Telegram API (`api.telegram.org`)** — публичный, не блокируется.

При нарушении — `SSRFBlockedError extends BadRequestException` (400 с понятным сообщением).

## Шифрование секретов webhook (`encryption.service.ts`)

AES-GCM-256 envelope encryption через `node:crypto`:
- ENV: `WEBHOOK_SECRETS_ENCRYPTION_KEY` — 32 байта (256 бит) в base64. Генерация: `openssl rand -base64 32`.
- Формат хранения: `iv(12b).ciphertext.tag(16b)`, всё base64, склеено через точку.
- Tamper detection — на любую модификацию байт `EncryptionTamperError`.
- Используется для `WebhookSubscription.secretEncrypted`, `IntegrationDestination.config.botToken/url` (для Slack/Telegram/Generic).
- В админке/API plaintext-секрет показывается **один раз** при создании. Дальше — только `secretPrefix` (первые 4-8 символов).

## IP hashing (`ip-hashing.service.ts`)

`sha256(ip + IP_HASH_DAILY_SALT + dateString).toHex()`. Daily-rotated через `dateString` — старые ipHash не сматчатся с новыми, что соответствует 90-дневной retention `MeetingShareView`.

Используется в:
- `MeetingShareView.ipHash` — для подсчёта уникальных просмотров (anti-cheat: один view-инкремент в сутки на ipHash)
- `AuditLog.ipHash` — для расследований без хранения PII

## Per-user квоты (`quotas/quota.service.ts`)

Атомарный INCR в Redis с DECR rollback при превышении:
- Ключ: `quota:{userId}:{quotaName}:{floor(now/windowMs)*windowMs}`
- TTL: `windowMs/1000 + 60` секунд
- На превышение: DECR + `AuditLog(action='quota.exceeded')` + `incQuotaExceeded` метрика + `throw QuotaExceededError(retryAfterSeconds)` (HTTP 429 с Retry-After в теле)
- Snapshot в `UserQuotaCounter` (БД) каждые 10 инкрементов — для админ-дашборда

ENV-лимиты (см. `cfg.workspace.*`):
- `MAX_API_KEYS_PER_USER=10`
- `MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER=20`
- `MAX_DESTINATIONS_PER_USER=20`
- `MAX_TAGS_PER_USER=50`
- `MAX_USER_TEMPLATES_PER_USER=20`
- `MAX_CHAT_REQUESTS_PER_DAY=200`
- `MAX_CHAT_TOKENS_PER_DAY=2_000_000`
- `MAX_RENDER_JOBS_PER_HOUR=10`
- `MAX_BULK_EXPORTS_PER_DAY=5`
- `MAX_REGENERATE_PER_MEETING_PER_DAY=5`
- `MAX_MEETINGS_CREATED_PER_DAY_VIA_API=100`
- `MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER=10_000_000`

## Soft-delete + grace

`User.deletedAt` и `Meeting.deletedAt` — soft-delete. Hard-delete воркером `retention-extras.cron` через `SOFT_DELETE_GRACE_DAYS=30`. До этого:
- Юзер может восстановить аккаунт по email-ссылке (`UserVerificationToken(purpose=account_restore)`).
- Все API возвращают 404 (как будто не существует), кроме restore-flow.

Каскад через `onDelete: Cascade` в схеме почистит связанные `Task`/`Highlight`/`Share`/`MeetingTranscriptChunk` etc.

## Audit log

`AuditLog` пишется на критические мутации (`AUDIT.*` константы):
- `user.delete`, `share.create`, `api_key.create`, `webhook_subscription.create`, `destination.create`
- `meeting.delete`, `meeting.regenerate`
- `quota.exceeded` (автоматически из QuotaService)

Запросы — через `AuditLogService.query({ userId?, action?, from?, to?, limit, offset })`. Для admin-дашборда (TODO).

## Public REST API

Под `/api/v1/public/v1` с `BearerAuthGuard`:
- API-ключ формата `z_<32 base64url chars>`, hash = sha256, prefix первые 10 символов.
- Scopes: `read`/`write` (admin scope удалён).
- `lastUsedAt` обновляется fire-and-forget на каждый запрос.
- Все запросы логируются в `ApiAccessLog` (retention 30 дней).
- Swagger UI на `/api/public/v1/docs` (только публичные endpoint'ы).

## Шеринг (публичные ссылки)

`MeetingShare` / `HighlightShare` — токен `crypto.randomBytes(SHARE_TOKEN_LENGTH_BYTES=24).toString('base64url')` (32 base64url chars). 

Срок: 1/7/14 дней (`SHARE_ALLOWED_EXPIRATION_DAYS`). После — `expiresAt < now` → 410 Gone с лендингом «истекла» + CTA на регистрацию.

Публичный контроллер отдаёт заголовки:
- `Referrer-Policy: no-referrer`
- `X-Robots-Tag: noindex, nofollow, noarchive`
- `Cache-Control: private, no-store`

через `PublicShareHeadersInterceptor`.
