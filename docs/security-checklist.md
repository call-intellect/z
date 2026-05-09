# Security checklist (MVP)

Проверка перед релизом. Каждый пункт — реальная верификация, не «декларация».

## Аутентификация

- [x] **HMAC: timing-safe сравнение.** `backend/src/modules/auth/services/hmac.service.ts:78` — `crypto.timingSafeEqual(bufA, bufB)`. Длины буферов выравниваются перед сравнением.
- [x] **HMAC: timestamp window.** `hmac.service.ts:36` — `drift > cfg.crossmark.hmacTimestampWindowSeconds` (по умолчанию 300 сек, защита от replay).
- [x] **JWT: алгоритм фиксирован HS256, защита от `alg:none`.** `backend/src/modules/auth/services/jwt.service.ts:19` — `const ALGORITHM: jwt.Algorithm = 'HS256'`. При verify передаём `algorithms: [ALGORITHM]` (whitelist) — атака с `alg:none` или `alg:RS256` отклоняется.
- [x] **Bcrypt password hash, rounds=12.** `backend/scripts/set-admin-password.ts:22` — `BCRYPT_ROUNDS = 12`. `admin-login.service.ts` сравнивает через `bcrypt.compare` + dummy-hash для timing-safe-fail.

## Авторизация

- [x] **CookieAuthGuard / HmacGuard / AdminGuard разделены.** Каждый guard проверяет свой источник identity, не путаются.
- [x] **OptionalAuth — явный декоратор.** `/access` и `/join` — единственные endpoint'ы, где cookie опциональна (запросы без cookie проходят как guest).
- [x] **Admin audit log.** `admin.audit.interceptor.ts` пишет в `AdminAuditLog` все mutating action'ы (POST/DELETE/PATCH под `/admin/...`).

## Веб-безопасность

- [x] **CSP полный whitelist.** `frontend/next.config.js` — `default-src 'self'`, `script-src 'self' 'unsafe-inline'` (RSC), `connect-src 'self' ${BACKEND} ${LIVEKIT} wss://*.crossmark.ru`, `media-src 'self' blob:`, `frame-ancestors 'none'`, `object-src 'none'`. Backend Helmet — те же директивы для prod (`backend/src/main.ts`).
- [x] **frame-ancestors 'none'.** Дублируется в CSP (frontend + backend) и в `X-Frame-Options: DENY` (helmet `frameguard.action='deny'` + явный header в `next.config.js`).
- [x] **HSTS (prod).** `backend/src/main.ts` — `strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true }`. `frontend/next.config.js` — header `Strict-Transport-Security` под `isProd`.
- [x] **X-Content-Type-Options: nosniff.** Helmet (default) + явный header.

## Инъекции / XSS

- [x] **SQL injection невозможна.** Только Prisma (parameterized queries). Сырых SQL-конструкций в `backend/src` — нет (проверено grep'ом `prisma.$queryRaw|prisma.$executeRaw` — отсутствуют как небезопасные строковые builds).
- [x] **XSS на guest_name.** `backend/src/modules/participants/participants.service.ts:67` — `sanitizeGuestName()` strip'ает `<>&"'` через regex, обрезает до 80 символов. На фронте `guest_name` рендерится через React (auto-escape).
- [x] **Custom prompt длина ≤10000.** `backend/src/modules/meetings/dto/create-meeting.dto.ts:17,29` — `z.string().max(10000)`.

## Rate limiting

- [x] **Глобальный лимит.** `app.module.ts` — `ThrottlerModule` с `default: 120/min`.
- [x] **Точечный лимит на public endpoints.** `meetings.controller.ts:/access` и `participants.controller.ts:/join` — `@Throttle({ default: { ttl: 60_000, limit: 30 } })`.

## Cookies

- [x] **httpOnly + sameSite=lax + secure (prod) + домен.** `backend/src/modules/participants/participants.controller.ts:73-77` — `httpOnly: true, secure: !isDevelopment, sameSite: 'lax', domain: cfg.auth.cookieDomain`.

## Секреты

- [x] **Никаких секретов в git.** `.gitignore` исключает `.env`, `.env.*` (кроме `.env.example`). Проверено grep'ом — никаких ключей в `backend/src`.
- [x] **Никаких console.log с секретами.** `console.log` в `backend/src` отсутствует (проверено grep'ом). Используется только `pino`-логгер с redact.
- [x] **HTTPS only в prod.** Документировано в `docs/architecture/deployment.md`. nginx терминирует TLS, certbot autorenew. HSTS включён.
- [x] **Integration key хранится только как sha256-hash.** Сырой ключ показывается ровно один раз при создании (`integration-keys.controller.ts:83`, `scripts/create-integration-key.ts`).

## Идемпотентность

- [x] **Crossmark: X-Idempotency-Key.** `backend/src/modules/meetings/meetings.crossmark.controller.ts` обеспечивает уникальность `(integrationKeyId, idempotencyKey)`.
- [x] **LiveKit webhooks: дедуп по `event.id`.** Проверка в `webhooks/livekit-webhooks.controller.ts`.

## Зависимости

- [ ] **`bun audit` чистый.** Не запускали в этой сессии — выполнить `cd backend && bun audit` перед релизом. Все «high/critical» — закрыть upgrade'ом, остальные — задокументировать в `docs/known-issues.md`.

## Не сделано (отложено на V1.1)

- Pen-test внешним подрядчиком — V2.
- WAF (nginx ModSecurity / cloudflare) — V1.1.
- Автоматический ротатор JWT/HMAC ключей — V1.1.
