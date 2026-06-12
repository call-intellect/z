# Аудит безопасности Z / Кора — 2026-06-11

> **Тип:** read-only security research. Ничего не чинилось и не менялось — только поиск и документирование.
> **Метод:** многоагентная оркестрация (12 finder-агентов по областям риска → состязательная верификация каждой находки с перепроверкой митигаций по реальному коду) + независимая ручная сверка ядра auth/tenant/LiveKit главным агентом. Всего 53 суб-агента, 1091 чтение кода.
> **Покрытие:** tenant-изоляция, prompt-injection и утечка системных промптов, аутентификация/авторизация, секреты, инъекции (SQL/cmd/SSRF/path), доступ к файлам/S3, наблюдаемость, веб-периметр, цепочка поставок, frontend XSS.
> **Важно:** severity указан после состязательной корректировки (verifier перепроверял заявленный finder-ом уровень по митигациям). Где не удалось доказать однозначно — помечено «требует проверки».

---

## 1. Сводка

| Severity | Кол-во (уникальных) | Что это значит для нас |
|---|---|---|
| 🔴 **crit** | **2** | Прямой пробой мульти-тенантности: чтение конфиденциальных данных/PII чужой компании любым залогиненным пользователем |
| 🟠 **high** | **11** | Cross-tenant запись, IDOR между партнёрами, утечка системных промптов (IP), SSRF во внутреннюю сеть, отсутствие rate-limit (брутфорс/денежный DoS), публичный `/metrics` |
| 🟡 **medium** | **5** | Zip-bomb DoS, нет prod-guard на плейсхолдер-секреты, prompt-injection в клоне, SSRF доставки webhook, несанитизированный текст логов |
| ⚪ **low** | **13** | Timing-safe сравнения, TOCTOU magic-link, слабые дефолты несекретных солей, утечки в `/health`, hardening |
| ❔ **требует проверки** | **2** | Экранирование Cypher `$`, lockfile с китайского зеркала npmmirror.com |

**Исходно агенты подали 41 находку. Из них:** 34 подтверждены (`real`), 5 опровергнуты как ложные (`false-positive`, см. §5), 2 — `needs-check`. После дедупликации дублей (одни и те же дыры нашли несколько агентов) — **33 уникальных проблемы**.

### Систематический корень (читать первым)

Два критических и минимум четыре high-нарушения вытекают из **одного** архитектурного решения:

- `CookieAuthGuard` (аутентификация) и `TenantGuard` (проверка членства в Org) — **НЕ глобальные**. Они навешиваются вручную на каждый из ~209 контроллеров (opt-in).
- А `TenantMiddleware` глобально кладёт `req.tenantId` из **заголовка `X-Org-Id`** (или `:orgId`/`body`) **без проверки membership** — проверку делает только `TenantGuard`.

→ Любой контроллер, который читает/пишет тенант-данные по `req.tenantId`/`@CurrentOrg()`, но забыл `TenantGuard`, превращается в cross-tenant дыру. Изоляция данных **fail-open**, а не fail-safe. Глобальные `APP_GUARD` (`Subscription`/`Entitlement`/`MustChangePassword`/`DemoObserver`) — это paywall/demo-гейты, они tenant-изоляцию **не делают**. Самый высокорычажный фикс — **SEC-03** (сделать изоляцию fail-safe + машинный CI-гард), он закрывает целый класс.

### Что в безопасности сделано хорошо (для баланса)

- Пароли — **argon2** с параметрами OWASP-2024; JWT — **HS256 с явным `algorithms:[HS256]`** (атака `alg:none` невозможна), `issuer/audience` проверяются; секреты `JWT_*` обязательны и ≥32 символов.
- Шифрование секретов интеграций — **AES-256-GCM корректно** (random IV 96 бит, auth tag, без nonce-misuse).
- CORS — список origin без wildcard при `credentials:true`; стек ошибок уходит **только в логи**, клиенту — generic-сообщения; `helmet` (CSP/HSTS/frameguard/nosniff) в prod.
- LiveKit-webhook **проверяет подпись** (→401), токены LiveKit генерит только backend, TTL ограничен 8 ч; presigned-URL имеют срок.
- Frontend: markdown везде через `rehype-sanitize` **без** `rehype-raw`; React 19 сам нейтрализует `javascript:`-URL в `href/src`.

---

## 2. Таблица находок (по severity)

| ID | Sev | Область | Файл | Суть |
|---|---|---|---|---|
| **SEC-01** | 🔴 crit | tenant | [search.controller.ts:62](backend/src/modules/search/search.controller.ts#L62) | Глобальный поиск `/api/v1/search` без `TenantGuard` берёт `tenantId` из `X-Org-Id` → чтение людей (PII), документов, решений, политик чужой Org |
| **SEC-02** | 🔴 crit | tenant/media | [meeting-visibility.service.ts:48](backend/src/modules/meetings/meeting-visibility.service.ts#L48) | `visibilityScope='org'` отдаёт отчёт/транскрипт/видео/аудиодорожки и список встреч **любому** залогиненному из чужой Org (нет проверки членства) |
| **SEC-03** | 🟠 high | tenant | [tenant.middleware.ts:35](backend/src/modules/rbac/middleware/tenant.middleware.ts#L35) | Системно: `req.tenantId` доверяется до `TenantGuard`; изоляция fail-open, держится на ручном навешивании guard на 209 контроллерах |
| **SEC-04** | 🟠 high | периметр | [app.module.ts:654](backend/src/app.module.ts#L654) | Глобальный `ThrottlerGuard` не зарегистрирован → **все `@Throttle` мертвы**, rate-limit периметра отсутствует |
| **SEC-05** | 🟠 high | auth/tenant | [api-keys.controller.ts:58](backend/src/modules/api-keys/api-keys.controller.ts#L58) | Выпуск `ingest`-ключа для чужой Org без membership → cross-tenant запись в граф (отравление памяти компании) |
| **SEC-06** | 🟠 high | tenant | [recordings.service.ts:477](backend/src/modules/recordings/recordings.service.ts#L477) | Cross-partner IDOR в Crossmark-канале: партнёр читает/качает/отменяет/продлевает чужую встречу по ULID (`partnerId` игнорируется) |
| **SEC-07** | 🟠 high | promptIP | [prompt-templates.controller.ts:87](backend/src/modules/admin/prompt-templates/prompt-templates.controller.ts#L87) | `GET :id` и `:id/versions/:vid` без RBAC → утечка system-промптов (IP Коры) и чужих org-промптов любому пользователю |
| **SEC-08** | 🟠 high | наблюдаемость | [metrics.module.ts:17](backend/src/common/metrics/metrics.module.ts#L17) | `/metrics` без auth раскрывает все Org-UUID и бизнес/стоимостную телеметрию по тенантам |
| **SEC-09** | 🟠 high | SSRF | [confluence-client.ts:120](backend/src/modules/documents/confluence-client.ts#L120) | SSRF в импорте Confluence: произвольный `baseUrl` + утечка `Authorization: Basic` чужому хосту |
| **SEC-10** | 🟠 high | SSRF | [trello-import.strategy.ts:636](backend/src/modules/tracker/strategies/trello-import.strategy.ts#L636) | SSRF в импорте Trello: `fetch` произвольного `attachment.url` с `redirect:follow`, тело → в S3 |
| **SEC-11** | 🟠 high | SSRF | [bitrix24-import.strategy.ts:121](backend/src/modules/tracker/strategies/bitrix24-import.strategy.ts#L121) | SSRF в импорте Bitrix24 (`webhookUrl` + `DOWNLOAD_URL`); тот же класс в `yandex-tracker-import.strategy.ts` |
| **SEC-12** | 🟠 high | auth | [auth.controller.ts:139](backend/src/modules/auth/auth.controller.ts#L139) | `POST /auth/admin-login` без `@Throttle` → брутфорс пароля админа (усугубляется SEC-04) |
| **SEC-13** | 🟠 high | auth | [app.module.ts:654](backend/src/app.module.ts#L654) | Нет `trust proxy` → per-IP троттл за nginx схлопывается в один бакет (DoS-локаут логина), throttle ещё и in-memory (пер-инстанс) |
| **SEC-14** | 🟡 med | secrets | [env.schema.ts:46](backend/src/common/config/env.schema.ts#L46) | Нет prod-guard на плейсхолдер-секреты: `.env.example` раздаёт `CHANGE_ME_min_32_chars…` (>32), проходит `min(32)` → риск выката с известным `JWT_SESSION_SECRET` = полный обход auth |
| **SEC-15** | 🟡 med | SSRF | [webhook-delivery.worker.ts:177](backend/src/modules/tracker/workers/webhook-delivery.worker.ts#L177) | SSRF доставки webhook трекера в обход `SsrfGuardService`; `responseStatus`/`errorMessage` → blind-оракул |
| **SEC-16** | 🟡 med | DoS | [document-import.service.ts:269](backend/src/modules/documents/document-import.service.ts#L269) | Zip-bomb: `unzipSync` инфлейтит весь архив в память ДО проверки размера → OOM воркера (падают все Org) |
| **SEC-17** | 🟡 med | promptInj | [clones.service.ts:2705](backend/src/modules/clones/services/clones.service.ts#L2705) | `clone-respond` без injection-guard (`wrapUserData`/`INJECTION_GUARD_NOTE`) → возможна утечка persona/системного промпта |
| **SEC-18** | 🟡 med | наблюдаемость | [log.service.ts:148](backend/src/modules/logging/log.service.ts#L148) | `message`/`errorMessage`/`errorStack` в `SystemLog` не санитизируются (редактируется только `details`) |
| **SEC-19** | ⚪ low | auth | [accounts.service.ts:493](backend/src/modules/accounts/accounts.service.ts#L493) | TOCTOU: одноразовый magic-link/reset-токен можно прожечь дважды (неатомарная пометка `usedAt`) |
| **SEC-20** | ⚪ low | auth | [mango.service.ts:93](backend/src/modules/ingest/adapters/phone-call/mango.service.ts#L93) | Проверка подписи Mango-webhook через `===` (не timing-safe); комментарий контроллера ложно утверждает обратное |
| **SEC-21** | ⚪ low | tenant | [feedback-user.controller.ts:77](backend/src/modules/feedback/controllers/feedback-user.controller.ts#L77) | `feedback.submit` берёт `orgId` из `X-Org-Id` без `TenantGuard` → мисатрибуция обратной связи чужой Org (не утечка) |
| **SEC-22** | ⚪ low | auth | [ics-feed.service.ts:50](backend/src/modules/events/services/ics-feed.service.ts#L50) | Сравнение токена ICS-ленты через `!==` (не constant-time); смягчено 256-бит энтропией токена |
| **SEC-23** | ⚪ low | secrets | [env.schema.ts:432](backend/src/common/config/env.schema.ts#L432) | Слабый дефолт `IP_HASH_DAILY_SALT='change-me-in-prod-please-32chars'` → деанонимизация IP посетителей share-ссылок |
| **SEC-24** | ⚪ low | secrets | [env.schema.ts:190](backend/src/common/config/env.schema.ts#L190) | `PROXY_PREFIX='myFeedproxy3128'` зашит дефолтом и в `.env.example` — часть `Authorization` к LLM-прокси |
| **SEC-25** | ⚪ low | secrets | [crypto.service.ts:82](backend/src/common/crypto/crypto.service.ts#L82) | `CryptoService` без ротации ключа и без fail-fast при отсутствии `CRYPTO_MASTER_KEY` (ленивая инициализация) |
| **SEC-26** | ⚪ low | наблюдаемость | [health.controller.ts:84](backend/src/modules/health/health.controller.ts#L84) | `/health/ready` без auth отдаёт сырой текст ошибок Postgres/Redis/LiveKit (хосты/порты) |
| **SEC-27** | ⚪ low | наблюдаемость | [request-logging.interceptor.ts:52](backend/src/modules/logging/request-logging.interceptor.ts#L52) | Латентно: интерсептор body-логирования пишет сырой `body`; редакция только по именам ключей (PII в произвольных полях). Путь сейчас мёртв + флаг OFF |
| **SEC-28** | ⚪ low | наблюдаемость | [main.ts:102](backend/src/main.ts#L102) | Ложный комментарий «Swagger в prod за basic-auth» — на деле просто выключен; риск будущей ошибки |
| **SEC-29** | ⚪ low | периметр | [concierge.controller.ts:76](backend/src/modules/concierge/concierge.controller.ts#L76) | Дорогие LLM-ручки без точечного `@Throttle` → денежный DoS бурстом (ограничено суточной квотой) |
| **SEC-30** | ⚪ low | promptIP | [llm-router.service.ts:1702](backend/src/modules/ai/services/llm-router.service.ts#L1702) | Дефолт `dataClass='internal'` → сырые данные клиента штатно уходят во внешние LLM. **By-design** (privacy деприоритизирована владельцем) |
| **SEC-31** | ⚪ low | supply | [document-parser.service.ts:131](backend/src/modules/ingest/parsers/document-parser.service.ts#L131) | `pdf-parse` используется при наличии `officeparser`; два `pdfjs-dist` в дереве (двойная атак-поверхность) |
| **SEC-32** | ❔ check | injection | [cypher-builder.ts:104](backend/src/common/graph/cypher-builder.ts#L104) | `escapeString` не экранирует `$` → теоретический пробой dollar-quote `$cypher$` в AGE. Сегодня недостижимо (в Cypher идут только серверные cuid) |
| **SEC-33** | ❔ check | supply | backend/bun.lock:1 | Весь backend-lockfile резолвится с `registry.npmmirror.com` (китайское зеркало), есть несуществующая `lodash@4.18.1` → разрыв цепочки доверия npm |

---

## 3. Топ-5: что чинить первым

1. **SEC-01 — cross-tenant в `/api/v1/search`** (crit, фикс на 1 строку).
   Навесить `@UseGuards(CookieAuthGuard, TenantGuard)` на `SearchController` и брать `tenantId` из `@CurrentOrg()`, а не из `@Headers('x-org-id')`. Сейчас любой залогиненный читает людей (имя+email), документы, решения, политики, регламенты чужой компании.

2. **SEC-02 — cross-tenant к встрече при `scope='org'`** (crit).
   В `MeetingVisibilityService.canView` ветку `if (visibilityScope==='org') return true` заменить на `return isMember` (членство в `meeting.tenantId`); симметрично в `buildListWhere`. Один предикат — гейт для 6 read-поверхностей (отчёт/транскрипт/видео/аудио/список), правка чинит весь класс.

3. **SEC-04 → SEC-12 → SEC-13 — включить и починить rate-limit** (high).
   Добавить `{ provide: APP_GUARD, useClass: ThrottlerGuard }` (оживляет все `@Throttle`), задать `app.set('trust proxy', <число hop nginx>)`, перевести throttle на Redis-storage, навесить строгий `@Throttle` на `admin-login`. Без этого — брутфорс пароля админа и magic-link/reset-токенов без потолка.

4. **SEC-05 — выпуск ingest-ключа для чужой Org** (high).
   Проверять membership (`RbacService.loadContext` / `TenantGuard`) и роль owner/admin перед созданием `ingest`-ключа. Иначе — запись произвольных событий в граф знаний чужой Org (отравление памяти, искажение AI-отчётов и клонов). Дополнительно проаудитить уже выпущенные ключи на `userId↔tenantId`.

5. **SEC-03 — сделать tenant-изоляцию fail-safe** (high, структурный).
   Ввести флаг `req.tenantVerified`, который ставит только `TenantGuard`; в `@CurrentOrg()`/интерсепторе бросать, если запрашивается `tenantId` без `tenantVerified`. Либо сделать `TenantGuard` глобальным с явным opt-out. Плюс CI-гард (ESLint/греп): контроллер с `@CurrentOrg`/`req.tenantId`/`X-Org-Id` обязан иметь `TenantGuard` или owner-scope. Этот фикс предотвращает рецидив SEC-01/02/05/21 при любых будущих доработках.

> **Сразу за топ-5:** **SEC-07** (утечка системных промптов — это интеллектуальная собственность Коры), **SEC-08** (публичный `/metrics` с Org-UUID — кормит другие IDOR), **SEC-09/10/11** (три SSRF в импортах — единый фикс через `SsrfGuardService` + `redirect:'manual'`), **SEC-14** (prod-guard на плейсхолдер-секреты — закрывает риск полного обхода auth и SEC-23/24 одним superRefine).

---

## 4. Детали критических и high-находок

### 🔴 SEC-01 — Cross-tenant утечка через глобальный поиск
**Файл:** [search.controller.ts:62,71-74](backend/src/modules/search/search.controller.ts#L62) · [search.service.ts:124-133,336-356,510-547](backend/src/modules/search/search.service.ts#L124)
**Суть.** `SearchController` навешивает только `@UseGuards(CookieAuthGuard)` — `TenantGuard` нет. `tenantId` берётся напрямую из `@Headers('x-org-id')` и без проверки членства уходит в `SearchService`. Все tenant-scoped поиски (`searchRoles/Departments/Persons/Documents/RoleProfiles/Processes/Regulations/Policies/Metrics/Decisions`) фильтруют **только** `where:{ tenantId }`. `searchPersons` возвращает `name+email` (PII), `searchDecisions` — `statement/text/rationale`.
**Эксплойт.** Залогиненный пользователь Org A → `GET /api/v1/search?q=а&types=person,document,decision,policy` с `X-Org-Id: <orgB>` → имена+email сотрудников, документы, стратегические решения, политики, регламенты чужой компании. Перебор по буквам выкачивает весь справочник.
**Митигации.** Не закрыто ничем: `CookieAuthGuard` только аутентифицирует; `TenantMiddleware` ставит `tenantId` без БД; глобального `TenantGuard` нет; фильтр по `tenantId` есть, но `tenantId` недоверенный.
**Фикс.** `@UseGuards(CookieAuthGuard, TenantGuard)` + `@CurrentOrg()` вместо заголовка.

### 🔴 SEC-02 — Cross-tenant к встрече при `visibilityScope='org'`
**Файл:** [meeting-visibility.service.ts:48,103-130](backend/src/modules/meetings/meeting-visibility.service.ts#L48) · [meetings.controller.ts:88](backend/src/modules/meetings/meetings.controller.ts#L88) · [recordings.controller.ts:31](backend/src/modules/recordings/recordings.controller.ts#L31)
**Суть.** Предикат `canView` при `visibilityScope==='org'` возвращает `true` **без** проверки, что запрашивающий — член `meeting.tenantId`. Для не-члена `loadContext()` возвращает `null` (graceful, без ошибки), но ветка `org` срабатывает раньше любой membership-проверки. Это единственный гейт для `getResult` (полный AI-отчёт), `getTranscript`, `getDownloadUrl` (presigned видео), `getAudioTracks` (поспикерное аудио), `list`. Контроллеры — только `CookieAuthGuard`. Флаг `MEETING_VISIBILITY_ENABLED` дефолт `true`. Дефолтный scope — `participants`, поэтому утечка ограничена встречами, которым владелец явно выставил «вся компания» — но для таких встреч доступ получает **любой аккаунт в системе из любой Org**.
**Эксплойт.** Пользователь Org B знает ULID встречи Org A со `scope='org'` → `GET /api/v1/meetings/<ulid>/result|transcript|recording/download|recording/audio-tracks` → полный контент чужой компании. `X-Org-Id` даже не нужен — гейт смотрит на `meeting.tenantId`.
**Фикс.** В ветке `org` требовать членство: `return ctx.isBypass || ctx.personId !== null`; симметрично в `buildListWhere`. Покрыть spec «чужой userId + scope=org → NotAuthorized».
**Примечание.** Verifier отдельно подтвердил, что путь `/transcript` для owner-only закрыт (`transcript-cleaning.service.ts:61`), но `getTranscript` встречи через общий предикат остаётся открыт.

### 🟠 SEC-03 — Системный анти-паттерн: `req.tenantId` доверяем до `TenantGuard`
**Файл:** [tenant.middleware.ts:35-66](backend/src/modules/rbac/middleware/tenant.middleware.ts#L35) · [current-org.decorator.ts](backend/src/modules/rbac/decorators/current-org.decorator.ts)
**Суть.** `TenantMiddleware` ставит `req.tenantId` из заголовка/параметра/тела без membership; проверку делает только per-controller `TenantGuard`; `@CurrentOrg()` просто отдаёт `req.tenantId`. Безопасность 33 эндпоинтов держится на ручном навешивании guard; один пропуск = утечка (как SEC-01/02/05/21). Машинного гарда нет.
**Фикс.** `req.tenantVerified` (ставит только `TenantGuard`) + бросать в `@CurrentOrg()`/интерсепторе без него; или глобальный `TenantGuard` c opt-out; + CI-правило.

### 🟠 SEC-04 — Глобальный `ThrottlerGuard` не зарегистрирован
**Файл:** [app.module.ts:164,654-695](backend/src/app.module.ts#L164)
**Суть.** `ThrottlerModule.forRoot([...])` подключён, но `{ provide: APP_GUARD, useClass: ThrottlerGuard }` в провайдерах **нет**. В NestJS `@Throttle()` — лишь метаданные, работают только при активном `ThrottlerGuard` (навешан ровно в одном месте — `tables.controller.ts:377`). Значит десятки `@Throttle` на login/register/magic-link/reset/shares **не работают**.
**Эксплойт.** Неограниченный брутфорс `POST /auth/login`, `/accounts/login`, перебор reset/magic-link-токенов, денежный DoS на LLM.
**Фикс.** Зарегистрировать глобальный `ThrottlerGuard`; убедиться, что трекинг по реальному IP (см. SEC-13).

### 🟠 SEC-05 — Выпуск ingest-ключа для чужой Org без membership
**Файл:** [api-keys.controller.ts:58-65](backend/src/modules/api-keys/api-keys.controller.ts#L58)
**Суть.** `POST /api/v1/api-keys` под одним `CookieAuthGuard`. Для `scope='ingest'` `tenantId` берётся из `X-Org-Id` и без проверки членства уходит в `ApiKeysService.create`. Сервис проверяет лимит ключей и наличие `tenantId`, но не membership/роль.
**Эксплойт.** Атакующий выпускает `zik_`-ключ на чужой `orgId`, затем `POST /api/v1/ingest` пишет произвольные `RawEvent` в граф знаний чужой Org → отравление памяти, инъекция фактов/решений, искажение AI-отчётов и клонов.
**Фикс.** Проверять `Membership` + роль owner/admin перед выпуском (идеально — `TenantGuard`). Проаудитить уже выпущенные ключи.

### 🟠 SEC-06 — Cross-partner IDOR в Crossmark-канале
**Файл:** [recordings.service.ts:477,575](backend/src/modules/recordings/recordings.service.ts#L477) · [meetings.service.ts:653,934,241](backend/src/modules/meetings/meetings.service.ts#L653)
**Суть.** `MeetingsCrossmarkController` (`/integrations/crossmark/v1/meetings`) идентифицирует партнёра по HMAC (`IntegrationKey`), но сервисные методы **не сверяют принадлежность встречи партнёру**: `getCrossmarkDownloadUrl(id, _partnerId)` — `partnerId` не используется; `getForCrossmark(id)` — без partner; `cancelScheduled(id, _partnerId)` / `extendRetention` — `partnerId` только в audit-строку. При создании привязка `Meeting→partner` не сохраняется.
**Эксплойт.** Партнёр P2 с валидным ключом по ULID встречи партнёра P1 → presigned-URL на чужую запись, отмена/продление/чтение чужой встречи.
**Фикс.** Сохранять владельца-партнёра при создании и добавить `WHERE partnerId` во все Crossmark-методы (404/403 для чужой).

### 🟠 SEC-07 — Чтение шаблонов промптов без RBAC (утечка IP)
**Файл:** [prompt-templates.controller.ts:87-89,137-143](backend/src/modules/admin/prompt-templates/prompt-templates.controller.ts#L87) · [prompt-templates.service.ts:137-184](backend/src/modules/admin/prompt-templates/prompt-templates.service.ts#L137)
**Суть.** Класс под одним `CookieAuthGuard`. Мутирующие/list-ручки вызывают `resolveRbac(user)`, но два эндпоинта **чтения** — `GET :id` и `:id/versions/:vid` — нет: голый `findUnique/findFirst` по id отдаёт полный `systemPrompt`. Системные шаблоны (`scope='system'`) — это промпт-инженерия Коры (IP); org-шаблоны — кастом чужих тенантов.
**Эксплойт.** Любой участник любой Org перебирает id → `GET /api/v1/admin/prompt-templates/<id>` → текст системных промптов и чужих org-промптов.
**Фикс.** Вызвать `resolveRbac` в `detail`/`getVersion`; в сервисе разрешать `system` (read-only) и `org` только при `orgId ∈ ownedOrgIds`; super_admin — всё. Добавить тест.

### 🟠 SEC-08 — `/metrics` без аутентификации раскрывает Org-UUID
**Файл:** [metrics.module.ts:17-20](backend/src/common/metrics/metrics.module.ts#L17) · [core-metrics-snapshot.cron.ts:71](backend/src/modules/knowledge-core/workers/core-metrics-snapshot.cron.ts#L71) · deploy/nginx/z-backend.conf:54-59
**Суть.** `/metrics` смонтирован на корне (вне `api/v1`, `TenantMiddleware` не покрывает), глобальных auth-guard нет. В лейблах метрик — сырой `tenantId` (org UUID): число блоков/сущностей/фактов, токены/стоимость LLM по тенанту. В nginx-шаблоне `allow…; deny all;` **закомментировано**.
**Эксплойт.** Аноним `GET https://api.<домен>/metrics` → список UUID всех Org, их размер/активность/стоимость (конкурентная разведка), а UUID далее идут как `X-Org-Id` в других IDOR.
**Фикс.** Закрыть на уровне приложения (internal-порт или guard) + обязательный nginx-ACL по умолчанию + не класть сырой `orgId` в лейблы (хеш/агрегат).

### 🟠 SEC-09 / SEC-10 / SEC-11 — SSRF в импортах (Confluence/Trello/Bitrix24, +Yandex)
**Файлы:** [confluence-client.ts:120](backend/src/modules/documents/confluence-client.ts#L120) · [trello-import.strategy.ts:636](backend/src/modules/tracker/strategies/trello-import.strategy.ts#L636) · [bitrix24-import.strategy.ts:121](backend/src/modules/tracker/strategies/bitrix24-import.strategy.ts#L121)
**Суть.** Эндпоинты импорта принимают `baseUrl`/`webhookUrl`/`attachment.url` как `z.string().url()` (любой URL) и делают `fetch` **без** `SsrfGuardService` (который в проекте есть и применяется в `webhooks-out`/`destinations`) с `redirect:'follow'`. Confluence дополнительно шлёт `Authorization: Basic` на указанный хост (утечка чужих Atlassian-кредов). Импорты Trello/Bitrix складывают тело ответа в S3 как вложение → канал чтения внутренних сервисов.
**Эксплойт.** Участник Org с write на documents/tracker указывает `baseUrl=http://169.254.169.254/latest/meta-data` или внутренний адрес → бэкенд ходит во внутреннюю сеть/облачные метаданные, результат читается через граф/вложения.
**Митигации.** Bitrix24/Trello-эндпоинты имеют `TenantGuard`+`requireWrite` (не crit, не cross-tenant), но сам SSRF открыт для легитимного admin тенанта. Confluence — то же, но + утечка Basic-auth.
**Фикс.** `SsrfGuardService.assertSafeOutboundUrl()` перед каждым `fetch` (включая пагинацию/редиректы — защита от DNS-rebinding), `redirect:'manual'`, whitelist `http/https`. **Чинить весь класс импорт-стратегий**, включая `yandex-tracker-import.strategy.ts`.

### 🟠 SEC-12 — `admin-login` без `@Throttle`
**Файл:** [auth.controller.ts:139](backend/src/modules/auth/auth.controller.ts#L139)
**Суть.** Legacy `POST /api/v1/auth/admin-login` (проверка пароля админа, bcrypt) вообще без `@Throttle`. Это самый чувствительный login-путь.
**Фикс.** Строгий `@Throttle({ limit:5, ttl:900_000 })` или удалить legacy-ручку (есть `unified-login`). Обязательно вместе с SEC-04.

### 🟠 SEC-13 — Нет `trust proxy` → троттл за nginx бесполезен
**Файл:** [app.module.ts:654-695](backend/src/app.module.ts#L654) · [accounts.controller.ts:89,142](backend/src/modules/accounts/accounts.controller.ts#L89)
**Суть.** В bootstrap нет `app.set('trust proxy', …)`. За nginx `req.ip` = адрес nginx (один для всех) → per-IP лимиты login/forgot/reset считаются суммарно по всем клиентам. Плюс throttle без явного storage = in-memory (пер-инстанс).
**Эксплойт.** (а) один атакующий исчерпывает общий бакет → 429 для всех (DoS-локаут логина); (б) если позже включат `trust proxy: true` без hop-count — `req.ip` подделывается через `X-Forwarded-For` и троттл обходится.
**Фикс.** `app.set('trust proxy', <точное число hop nginx>)` (не `true`); throttle на Redis-storage.

---

## 5. Опровергнутые находки (проверено — НЕ уязвимость)

| ID агента | Заявлено | Почему ложно |
|---|---|---|
| livekit-egress-3 | S3-ключ egress без `tenantId` → коллизия | `meetingId = ulid()` генерит сервер, в DTO поля id нет; ~80 бит энтропии — целевое перетирание недостижимо. Hardening на будущее, текущее воздействие нулевое |
| web-perimeter-4 | CSP `scriptSrc 'unsafe-inline'` в `main.ts` | Бэкенд — чистый JSON-API без HTML-рендера, `noSniff` включён; Swagger только в dev. У фронта свой CSP (`next.config.mjs`). На указанном файле воздействия нет |
| frontend-supplychain-2 | Drift реестра bunfig↔lockfile | Каждая запись имеет `sha512`-integrity, прод ставит `--frozen-lockfile` (не переразрешает реестр), `bunfig.toml` не копируется в образ. Подмена кода через drift невозможна (вопрос «код с зеркала» — это SEC-33, не drift) |
| frontend-xss-1 | `javascript:`-URL вложений чата в `href` | React 19 `sanitizeURL` нейтрализует `javascript:`-протокол в `href/src` (и в prod-сборке); `dangerouslySetInnerHTML` в чате нет. Заявленный вектор закрыт фреймворком (остаётся code-smell — нет валидации `data:`/домена) |
| frontend-xss-2 | markdown-рендер | Контрольная проверка: везде `rehype-sanitize` **без** `rehype-raw`; единственный `dangerouslySetInnerHTML` — статичная CSS-константа Tiptap без интерполяции. Уязвимости нет; ценность — гард на регрессию |

---

## 6. Требует проверки (`needs-check`)

- **SEC-32 — Cypher `$` не экранируется** ([cypher-builder.ts:104](backend/src/common/graph/cypher-builder.ts#L104)). `escapeString` экранирует `\` и `'`, но не `$`; итог оборачивается в `$cypher$…$cypher$`. Сегодня недостижимо (в Cypher идут только серверные cuid и whitelisted-метки; свободный текст хранится в Postgres, в AGE не интерполируется; `traverse()` в проде не вызывается). Defense-in-depth: рандомизированный dollar-quote-тег или agtype-параметризация + unit-тест + машинный инвариант «свободный текст не попадает в Cypher-литерал».
- **SEC-33 — lockfile с `npmmirror.com`** (backend/bun.lock). Все 1036 зависимостей резолвятся с китайского зеркала Alibaba (`registry.npmmirror.com`), в дереве `lodash@4.18.1` (на официальном npm такой версии нет — последняя 4.17.21), `@aws-sdk/*` с неправдоподобно высокими номерами. `integrity` фиксирует то, что отдало зеркало → при компрометации зеркала тампер-тарболл «проходит» проверку. Доказанного вредоносного кода в осмотренном `lodash` нет (нет postinstall) — это integrity/trust-риск и невоспроизводимость сборки. **Проверить:** пересоздать lock против `registry.npmjs.org`, `bun audit`, diff версий; CI-гард на host ≠ npmjs.org. Дата lock (2026-06-09) выше моего knowledge cutoff — высокие номера могли стать легитимными, требуется сверка с актуальным upstream.

---

## 7. Сгруппированные рекомендации (классами, а не точечно)

1. **Tenant-изоляция → fail-safe** (SEC-01, 02, 03, 05, 21): `req.tenantVerified` + запрет `@CurrentOrg()` без него + CI-гард «`X-Org-Id`/`req.tenantId` ⇒ обязателен `TenantGuard`». Это единый структурный фикс для всего класса cross-tenant.
2. **Rate-limit периметра** (SEC-04, 12, 13, 29): зарегистрировать `ThrottlerGuard` глобально, `trust proxy`, Redis-storage, строгий `@Throttle` на все login-пути и дорогие LLM-ручки.
3. **Единый SSRF-щит для исходящих** (SEC-09, 10, 11, 15): обёрнутый `SsrfGuardService` http-клиент для всех импортов/webhook + `redirect:'manual'`; покрыть Yandex-tracker.
4. **Prod-guard на секреты** (SEC-14, 23, 24): `superRefine` при `NODE_ENV='production'` — запрет `CHANGE_ME`/`change-me`/плейсхолдеров и минимальная энтропия для `JWT_*`, `*_SECRET`, `*_API_KEY`, `CRYPTO_MASTER_KEY`, `IP_HASH_DAILY_SALT`, `PROXY_PREFIX`. Закрывает риск полного обхода auth разом.
5. **Закрыть служебные эндпоинты** (SEC-08, 26): `/metrics` и `/health/ready` — internal-порт или auth/ACL; не отдавать сырые тексты ошибок и Org-UUID наружу.
6. **Промпт-IP и injection** (SEC-07, 17): RBAC на чтение шаблонов; прогнать `clone-respond` (и chat-v2/concierge) через `applyInputGuards`/`wrapUserData`/`INJECTION_GUARD_NOTE`.
7. **Timing-safe сравнения единым хелпером** (SEC-20, 22): заменить `===`/`!==` на `crypto.timingSafeEqual` во всех проверках подписей/токенов; поправить ложный комментарий Mango.
8. **Атомарность одноразовых токенов** (SEC-19): `updateMany({ where:{ id, usedAt:null } })` + `count===1`.
9. **Парсинг недоверенных файлов** (SEC-16, 31): потоковая распаковка ZIP с лимитом распакованного размера/числа записей; унификация PDF на одной библиотеке.

---

*Артефакты прогона (скрипт workflow, сырые дампы находок) — временные, в репозиторий не входят. Полные структурированные данные находок (description/exploit/fix/mitigations по каждой) получены из прогона `wf_5afd2f30-bef`.*
