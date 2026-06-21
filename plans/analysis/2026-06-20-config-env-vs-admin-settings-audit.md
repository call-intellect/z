# Аудит конфигурации: что должно жить в ENV, а что в суперадминке (AdminSetting)

> Дата: 2026-06-20 · Тип: анализ (read-only аудит + план переноса + проект правила) · Автор: оркестратор + 11 суб-агентов
> Триггер: владелец — «в `.env` свалено всё подряд (флаги, переменные, крутилки); там должны быть только секреты/ключи/доступы. Всё остальное — в суперадминку. Нужен анализ → ТЗ на перенос → правило».
> Метод: полный разбор `backend/src/common/config/env.schema.ts` (~250 объявлений) + проводки в `typed-config.service.ts` + реестра `admin-setting-schema-registry.ts`; 8 доменных классификаторов + поиск теневых `process.env` + документатор механизма + сэмплер хардкода. Всего классифицировано **504 точки конфигурации**.

---

## 1. Суть (TL;DR)

1. **Инфраструктура «крутилки в админке» уже есть и зрелая** — `AdminSetting` (БД) + `AdminSettingsService` + `TypedConfigService.resolveSync/getDynamic` (порядок: **админка → ENV → дефолт**) + реестр Zod-схем + автогенерируемое UI-поле + история изменений. **~150 ключей уже редактируются из суперадминки.** Ничего нового строить не нужно — нужно **достроить недоделанный перенос и закрыть утечку новых крутилок в ENV**.
2. **Но `.env` действительно «свалка»**: из ~250 ENV-переменных настоящие секреты/инфра — это **меньшинство (~68, ~27%)**. Бóльшая масса — **крутилки** (пороги, лимиты, cron, debounce/TTL, ~70 флагов `*_ENABLED`, rate-limit, retention), и **~320 из них читаются голым `this.get('ENV_KEY')`** — то есть **только из ENV, мимо админки**: покрутить нельзя без правки `.env` + редеплоя.
3. **Есть и грубые нарушения правила** «ENV только через валидируемую схему»: **26 переменных читаются напрямую через `process.env.*`** (блок `concierge`, `orchestrator`, `router`-fallback, `axis-classifier`, `consistency-checker`, `completeness-scanner`, `telegram-digest`, `role-profiles`) — **минуя `env.schema.ts` вообще** (нет валидации, нет дефолтов в одном месте, нет проводки в админку).
4. **Класс шире ENV**: в самом коде ещё **60-90+ хардкод-крутилок** (магические `0.78`/`0.92`/`30 дней`/`60_000 мс` прямо в сервисах и даже в SQL). Эталон правильного подхода уже живёт в коде (`probe.service.ts` через `getDynamic` с code-fallback) — на него надо мигрировать остальные.
5. **Корень — не «плохой `.env`», а отсутствие гейта**: нет правила и машинной проверки, которые заставляют новую крутилку идти в `AdminSetting`, а не в ENV/код. Поэтому свалка растёт. **Сначала ставим гейт (правило + lint-гард), потом разгребаем накопленное волнами.**

---

## 2. Критерий классификации (правило владельца)

| Остаётся в ENV (`KEEP_ENV`) | Переезжает в суперадминку (`MOVE_ADMIN`) |
|---|---|
| Секреты: ключи API, пароли, токены, секреты подписи JWT, ключи шифрования, соли | Пороги (cosine/confidence/similarity), веса |
| Строки подключения: `DATABASE_URL`, `REDIS_URL` | Лимиты (`MAX_*`, квоты, размеры) |
| Bootstrap рантайма (нужно ДО доступности БД): `NODE_ENV`, `PORT`, домены cookie, публичный URL | cron-расписания, debounce/TTL, окна в днях |
| Креды инфраструктуры: S3, LiveKit, TURN, SMTP-пароль, OAuth-секреты платёжки | Флаги фич `*_ENABLED` (kill-switch и решения владельца) |
| | retention (сроки хранения), rate-limit |

**Граница (GRAY) — нужно решение владельца:** base-URL провайдеров, id моделей LLM, выбор провайдера/режима, параметры безопасности (Argon, TTL сессий, окно HMAC), concurrency воркеров, cron-выражения (применяются только после рестарта). См. §6.

---

## 3. Что уже есть (инфраструктура переноса — НЕ строим заново)

- **БД:** `AdminSetting { key, value(Json), category, section, severity, schemaId, description, updatedBy, comment }` + `AdminSettingHistory` (полный audit-trail). [schema.prisma:10192](../../backend/prisma/schema.prisma#L10192)
- **Чтение конфига:** [typed-config.service.ts](../../backend/src/common/config/typed-config.service.ts)
  - `resolveSync('admin.key', 'ENV_KEY', default)` — синхронный, читает in-memory sync-кэш (наполняется на старте + при правке через Redis pub/sub) → ENV → дефолт. Для геттеров-конфигов.
  - `getDynamic('admin.key', 'ENV_KEY', default)` — async, ходит в `AdminSettingsService` (БД + L1-кэш 30с). Для hot-path, меняется на лету за ≤30с.
- **Вайтлист + валидация:** [admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts) — Map `key → ZodTypeAny` (~150 ключей). Из неё бэк отдаёт `/schema/:key`, фронт может автогенерить поле.
- **UI:** `AdminSettingField` (виджет по типу Zod), `useAdminSettingEditor` (save + reason-gate + история), профильные `*SettingsClient.tsx` страницы.
- **Сиды дефолтов:** ~25 скриптов `backend/scripts/seed-admin-setting-*.ts`, все в агрегаторе `apply-prod-deploy.ts`. Защита admin-edited (не затирают ручные правки).
- **Реестр флагов:** [docs/operations/feature-flags.md](../../docs/operations/feature-flags.md) — единая точка правды о флагах (тип · состояние).

**Вывод:** перенос одной крутилки = ~30 строк по готовому паттерну (см. §7), без новой архитектуры.

---

## 4. Масштаб (цифры аудита)

> **Дисклеймер точности:** 504 «точки» включают и геттеры, и теневые чтения, поэтому больше сырых ~250 ENV. Пропорции робастны, но **точную «проводку» каждой переменной нужно перепроверять на этапе ТЗ** (агенты местами ошибаются: напр. `DOMAIN_EXPANDER_*`/`BRAND_VOICE_*`/`EXPERIMENT_*` помечены `not-read`, хотя реально читаются геттерами `companyFoundation`/`brandVoice`/`experiments` — это `get-only`). Это иллюстрация **класса и порядка величин**, не финальный построчный наряд.

**По решению:**

| Disposition | Кол-во | Что значит |
|---|---:|---|
| **MOVE_ADMIN** | ~321 | Крутилка, сейчас `get-only`/`direct-process-env` — должна переехать в админку |
| **GRAY** | ~91 | Спорно — решение владельца (cron/base-URL/модели/security/concurrency) |
| **KEEP_ENV** | ~68 | Секрет/инфра/bootstrap — остаётся в ENV |
| **ALREADY_ADMIN** | ~24 | Уже проведено через `resolveSync`/`getDynamic` + реестр |

**По проводке:**

| Wiring | Кол-во | Смысл |
|---|---:|---|
| `get-only` (`this.get`) | ~371 | Только из ENV, мимо админки — основная масса для переноса |
| `resolveSync` | ~93 | Двухисточниковое (часть без записи в реестр → не редактируется из UI) |
| `direct-process-env` | **26** | **Мимо `env.schema.ts` вообще — нарушение правила** |
| `getDynamic` | 4 | Async-двухисточниковое |
| `not-read` | ~10 | Объявлено в схеме (часть — ложноположительные, см. дисклеймер) |

---

## 5. Находки по корзинам

### 5.1. `KEEP_ENV` — остаётся в ENV (≈68)
Секреты и инфра, бесспорно: `DATABASE_URL`, `REDIS_URL`, `JWT_SESSION_SECRET`, `JWT_DEEP_LINK_SECRET`, `CRYPTO_MASTER_KEY`, `WEBHOOK_SECRETS_ENCRYPTION_KEY`, `IP_HASH_DAILY_SALT`, `INGEST_INTERNAL_TOKEN`, все `*_API_KEY`/`*_SECRET`/`*_TOKEN`/`*_PASSWORD` (LiveKit, S3, Vox, DeepSeek, OpenAI, MiniMax, GrsAi, Kie, MAIL, TURN, TOCHKA, DADATA, BITRIX, VAPID-private), `NODE_ENV`, `PORT`, `LOG_LEVEL`, `COOKIE_DOMAIN`, `COOKIE_STANDALONE_DOMAIN`, `PUBLIC_FRONTEND_URL`, `PUBLIC_HOST_URL`, `ADMIN_BOOTSTRAP_EMAIL`, `ZDEMO_ORG_ID`. Действий не требует.

### 5.2. `MOVE_ADMIN` — переезжает в админку (≈321), по доменам
Самые «густые» зоны (читаются `get-only`):

| Домен (группа) | ~кол-во | Примеры |
|---|---:|---|
| KnowledgeCore (граф) | ~41 | `DISTILL_*`, `ENTITY_*`, `THEME_*`, `BLOCK_INGEST_*`, `CHAT_V2_*`, `BITEMPORAL_*`, `FACT_SUPERSEDE_*`, debounce/cron |
| Tracker/governance | ~31 | `AUTORULE_*`, `PRACTICE_SKILLS_*`, `GEPA_*`, `TEMPORAL_PROBE_*`, `SIGNAL_TYPE_*`, `IDEMPOTENCY_*` |
| BetaOps (чек-ины/COO/proactive) | ~28 | `DAILY_CHECKIN_*`, `COO_*`, `COMMITMENT_*`, `PROACTIVE_RULE_*`, `INVITE_*`, `MAGIC_LINK_*` |
| WorkspaceLimits | ~22 | `MAX_CHAT_*`, `MAX_*_PER_USER`, `MAX_*_PER_DAY`, `EXPORT_ZIP_*`, `CLIP_*` |
| Skill/clone | ~21 | `SKILL_*`, `CLONE_*`, `PERSONA_REBUILD_*`, concept-пороги |
| Persona | ~13 | `EXECUTABLE_PERSONA_*`, `DOMAIN_EXPANDER_*`, `BRAND_VOICE_*`, `MATURITY_*` |
| Logging (БД-логи) | ~11 | `LOG_DB_*` (batch/flush/retention/уровни) |
| Probe | ~10 | `PROBE_DEDUP_TTL_*`, `PROBE_RATE_LIMIT_*`, `PROBE_EXPIRY_*` |
| Retention | ~10 | `*_RETENTION_DAYS`, `SOFT_DELETE_GRACE_DAYS`, `RETENTION_SWEEP_BATCH_SIZE` |
| AiFeatureFlags | ~8 | `TRANSCRIPT_CLEANING_*`, `PROMPT_INJECTION_GUARD_*`, `SUMMARY_AGENT_*` |
| DialogLayer | ~8 | `ANSWER_CACHE_TTL_*`, `RETRIEVAL_CACHE_TTL_*`, `SUMMARIZER_*` |
| Budget · SmartTables · MaxBot · Conversational · Recording · др. | ~30 | `BUDGET_ALERT_*`, `TABLE_MAX_*`, `BOT_*`, `RECORDING_FASTSTART_*` |

### 5.3. `direct-process-env` — 26 нарушений (читаются мимо `env.schema.ts`)
**Самая грубая проблема.** Не валидируются, нет единого места дефолтов, не проводятся в админку:

- **Concierge (13):** `CONCIERGE_ENABLED`, `CONCIERGE_DIALOG_LAYER_ENABLED`, `CONCIERGE_PRM_SHADOW_ENABLED`, `CONCIERGE_PRM_ENABLED`, `CONCIERGE_PRM_TOP_K`, `CONCIERGE_PRM_SHADOW_SAMPLE_RATE`, `CONCIERGE_NATIVE_TOOLS_ENABLED`, `CONCIERGE_LOOPBACK_BASE_URL` (gray), `CONCIERGE_DAILY_MESSAGES_LIMIT`, `CONCIERGE_MONTHLY_MESSAGES_LIMIT`, `CONCIERGE_SSE_HEARTBEAT_SECONDS`, `CONCIERGE_PRE_RETRIEVAL_TOP_K`, `CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS` — [typed-config.service.ts:1337-1389](../../backend/src/common/config/typed-config.service.ts#L1337)
- **Orchestrator (3):** `ORCHESTRATOR_ENABLED`, `ORCHESTRATOR_MAX_SUBAGENTS_PER_RUN`, `ORCHESTRATOR_RUN_TIMEOUT_MINUTES` — `orchestrator.config.ts:25-33`
- **Router fallback (3):** `ROUTER_FALLBACK_NEGATIVE_TTL_SECONDS`, `ROUTER_LLM_FALLBACK_ENABLED`, `ROUTER_FALLBACK_CACHE_TTL_SECONDS` — `router.service.ts:697-719`
- **Воркеры/кроны (7):** `AXIS_CLASSIFY_ENABLED`, `ROLE_PROFILE_MIN_BLOCKS`, `CONSISTENCY_CHECKER_ENABLED`/`_DEDUP_TTL_SECONDS`, `COMPLETENESS_SCANNER_ENABLED`, `GOAL_ALIGNMENT_LOW_ENABLED`, `TELEGRAM_DIGEST_HOUR_LOCAL`

### 5.4. `not-read` — мёртвый/ложноположительный конфиг (≈10)
`DASHBOARD_THEME_SILENCE_ENABLED`/`_WEEKS` — проверить, читаются ли (по `feature-flags.md` должны быть живы). `DOMAIN_EXPANDER_*`/`BRAND_VOICE_*`/`MATURITY_SCORER_*`/`EXPERIMENT_*` — **ложноположительные** (реально `get-only` через геттеры `companyFoundation`/`brandVoice`/`experiments`). На этапе ТЗ — точечно перепроверить, удалить реально мёртвое.

### 5.5. `ALREADY_ADMIN` — уже сделано (≈24, плюс ~150 в реестре)
Эталон того, к чему идём: `knowledge.linkMinConfidence`, `embeddings.*`, `curation*`, `graph.ageEnabled`, `meetings.taskDedupe*`, `documents.maxSizeMb` и т.д. — `resolveSync`/`getDynamic` + строка в реестре + сид + UI-поле.

### 5.6. Хардкод-крутилки в КОДЕ (класс: 60-90+) — шире ENV
Магические константы прямо в сервисах/кронах/SQL, которые по правилу «крутилки → не в код» тоже подлежат выносу. Сэмпл (23 шт.):

- **knowledge-core:** `similarity >= 0.78` и `cosine >= 0.92` в SQL резолва сущностей ([entity-resolution.service.ts:1412](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L1412), [:771](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L771)); `dynamicScore > 0.1` в reframing-кроне.
- **dashboard:** пороги настроения/выгорания (`drop >= 0.2/0.4`, `MIN_COHORT_SIZE=3`, `TREND_THRESHOLD=0.05`), окна `RED_MOOD_WINDOW_DAYS=30`/`RELIABILITY_WINDOW_DAYS=14`/`WINDOW_DAYS=90` — десятки в `dashboard/services` и `dashboard/agents`.
- **ai:** `MONOLOGUE_THRESHOLD_MS=60_000`, `TURN_GAP_MS=2_000` (поведенческие метрики встречи); retention логов AI `SCRUB_DAYS=30`/`DELETE_DAYS=365`.
- **billing:** `LOOKAHEAD_DAYS=3`, `MIN_ATTEMPT_INTERVAL_HOURS=6` (рекуррентные платежи).
- **probe (эталон, уже правильно):** `getDynamic('probe.semanticDedupThreshold', undefined, 0.92)` — число лишь code-fallback. ← так должно быть везде.

**Где гуще всего:** `dashboard/*`, `knowledge-core/*` (вкл. SQL), `ai/services/*`.

---

## 6. GRAY — решения владельца (нужны ДО ТЗ на перенос)

91 спорная переменная сворачивается в **6 решений**. Рекомендация дана по каждому.

| # | Корзина | Состав | Рекомендация |
|---|---|---|---|
| **Р1** | **cron-расписания (29)** | `*_CRON`, `*_LOCAL_HOUR`, `*_HOUR_UTC` | **Переносить в админку с честной пометкой «после рестарта»** ИЛИ оставить «час/день» в админке, а сам факт запуска гейтить флагом-no-op. Чистые cron-строки `@Cron` НЕ применяются на лету (см. §7 caveats). Рекомендую: **часы/дни доставки (`*_LOCAL_HOUR`, `*_HOUR_UTC`) → в админку** (их крутят бизнес), а технические `*_CRON` периодичности воркеров — **оставить в ENV** (инфра-тюнинг, не бизнес-крутилка). |
| **Р2** | **base-URL провайдеров (28)** | `*_BASE_URL`, `*_API_URL`, `VOX_API_URL`, `GEPA_SERVICE_URL`, redirect-URL платёжки | **Оставить в ENV** (рекомендую): по правилу [[feedback_switchable_endpoints]] endpoint-ы переключаются через ENV; это инфра/доступы, рядом с ключами. Переносить в админку — риск «увели трафик на чужой URL из UI». |
| **Р3** | **id моделей LLM (5)** | `ANTHROPIC_MODEL`, `VOX_MODEL`, `DEEPSEEK_DEFAULT_MODEL`, `GEPA_REFLECTION_LM`, `GEPA_TASK_LM` | **В админку** (рекомендую): выбор модели — продуктовая крутилка, и для LLM уже есть admin-поверхность (`admin/ai-models`, llm-routes). Свести туда, ENV — fallback. |
| **Р4** | **параметры безопасности (≈9)** | Argon (`MEMORY_KB`/`ITERATIONS`/`PARALLELISM`), `SESSION_TTL_SECONDS`, `DEEP_LINK_TTL_SECONDS`, `S3_PRESIGNED_TTL_SECONDS`, `CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS` | **Оставить в ENV** (рекомендую): это параметры криптостойкости/безопасности; крутить их из UI — риск ослабить защиту по ошибке. Если переносить — только `severity:'destructive'` + reason. Сейчас `resolveSync` уже есть, но НЕ в реестре. |
| **Р5** | **выбор провайдера/режима (6)** | `BILLING_PROVIDER`, `TOCHKA_MODE`, `INN_LOOKUP_PROVIDER`, `LLM_MAIN_REPORT_PRIMARY`, `MAIL_DRY_RUN`, `OPS_DIGEST_DELIVER_TO_WEBPUSH` | **Смешанно:** продуктовые рубильники (`LLM_MAIN_REPORT_PRIMARY`, `OPS_DIGEST_*`, `MAIL_DRY_RUN`) → **в админку**; `BILLING_PROVIDER`/`TOCHKA_MODE` (sandbox/prod, привязаны к OAuth-кредам платёжки) → **оставить в ENV**. |
| **Р6** | **concurrency + OAuth-скоупы (≈12)** | `ROUTER_DISPATCH_CONCURRENCY`, `CONVERSATIONAL_OUTBOUND_CONCURRENCY`, `TOCHKA_OAUTH_SCOPES`/`_PERMISSIONS`, `TOCHKA_WEBHOOK_EVENT_TYPES`, `WEBHOOK_HMAC_PREFIX` | concurrency — **оставить в ENV** (не на лету, инфра-тюнинг). OAuth-скоупы/события платёжки — **оставить в ENV** (рядом с кредами интеграции). |

> Эти решения определяют, сколько из 91 GRAY уйдёт в `MOVE_ADMIN`. По рекомендациям: в админку добавится ~10-15 (модели + продуктовые рубильники + часы доставки), остальное останется в ENV осознанно (а не «по забывчивости»).

---

## 7. Механизм переноса (рунбук) + подводные камни

**Перенос одной крутилки `this.get('FOO_BAR')` → редактируемая `AdminSetting`:**
1. **Реестр:** добавить `['<dot.key>', <Zod>]` в `admin-setting-schema-registry.ts` (заготовки `UNIT_INTERVAL`/`POSITIVE_INT`/`z.boolean()`/…). Без этого UI рисует JSON-textarea.
2. **Чтение:** в `typed-config.service.ts` заменить `this.get('FOO_BAR')` → `this.resolveSync<T>('<dot.key>', 'FOO_BAR', <default>)` (sync-геттер) или `await this.getDynamic(...)` (hot-path/на лету). Дефолт в коде = **code-fallback, не источник правды**.
3. **Сид дефолта:** `backend/scripts/seed-admin-setting-<feature>.ts` по образцу `seed-admin-setting-portfolio-health.ts` (`createPrismaClient()`, защита admin-edited).
4. **Агрегатор:** строка в `apply-prod-deploy.ts` → `STEPS` (`phase:'seed-update'`). Иначе сид не попадёт в прод.
5. **UI-поле:** `SettingSpec` в профильной `*SettingsClient.tsx` (фронт держит **свою копию** Zod — продублировать ограничения).
6. **Прогон:** `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. На старте `hydrateSync` зальёт ключи в sync-кэш; правка через UI → `applySync` + Redis pub/sub `admin:setting:invalidate` → мгновенно на всех нодах.
7. **Док-триггеры:** новый флаг → `feature-flags.md`; новый сид → `prod-deploy-log.md` Шаг 7; ENV-fallback → Шаг 1.

**Подводные камни (важно для ТЗ):**
- ⚠️ **cron НЕ на лету:** `@Cron('...')` читает выражение один раз при старте. AdminSetting вернёт новое значение, но `SchedulerRegistry` уже зарегистрировал старое → нужен рестарт ИЛИ no-op-гейт в теле крона (как `goals.pulse.enabled`).
- ⚠️ **concurrency НЕ на лету:** пул BullMQ/`dispatchConcurrency` фиксируется при создании воркера.
- 🔴 **`set()` на бэке НЕ валидирует значение по реестру** (`SetSettingSchema = z.unknown()`) и НЕ требует reason по severity — **вся валидация только на фронте** (`useAdminSettingEditor`). Прямой POST/сид может записать мусор, `resolveSync` вернёт как есть. **Это надо чинить в рамках правила** (серверная валидация по реестру) — иначе перенос в админку снижает гарантии vs Zod-валидируемый ENV.
- ⚠️ **Фронт дублирует Zod вручную** (автоген из `/schema/:key` существует, но не используется) — рассинхрон бэк/фронт возможен. Кандидат на упрощение в рамках правила.
- ⚠️ **Два кэша:** L1 (async `get`, TTL 30с) и sync `cacheMap` (`resolveSync`). `set()` чистит оба; ручной SQL мимо `set()` — не виден до рестарта.

---

## 8. Рекомендованный план миграции (волнами → ТЗ-батчи)

Принцип: **сначала гейт (правило), потом разгрести накопленное по приоритету ценности для владельца.** Наивно переносить все ~320 разом — это огромный объём при том, что половину никто не крутит. Порядок:

- **ТЗ-0 «Гейт» (правило + машинный гард + серверная валидация).** Не код миграции, а: правило в CLAUDE.md, lint/тест-гард «новый ENV в `env.schema.ts` без пометки `@keep-env` → ошибка», серверная валидация `set()` по реестру. **Останавливает рост свалки.** Параллельно — чистка 26 `direct-process-env` под валидируемую схему + `resolveSync` (гигиена, быстрый выигрыш).
- **ТЗ-1 «Операционные крутилки, которые реально крутят»** (приоритет владельца): retention/логи (`*_RETENTION_DAYS`, `LOG_DB_*`), лимиты (`WorkspaceLimits`, квоты), пороги курации/дедупа, часы доставки дайджестов. ~60-80 ключей по профильным страницам админки.
- **ТЗ-2 «Граф и клоны»** (KnowledgeCore + Skill/Persona/Probe + DialogLayer): ~120 ключей, по 1 странице на домен. Большинство `live` (читаются per-job), часть debounce.
- **ТЗ-3 «Хардкод-крутилки → `getDynamic` с code-fallback»**: 60-90+ из §5.6 по приоритету (dashboard-пороги настроения, граф-пороги в SQL, retention логов). По эталону `probe.service.ts`.
- **GRAY-решения (Р1–Р6)** встраиваются в соответствующие волны.

Каждая волна = отдельное ТЗ в `plans/tz/`, реализуется по рунбуку §7, выкат через `apply-prod-deploy.ts`.

---

## 9. Проект ПРАВИЛА (governance) — чтобы свалка не росла

**Формулировка (в CLAUDE.md, новый под-пункт к принципу про AdminSetting):**

> **Крутилки — в AdminSetting, не в ENV и не в код.** В `.env`/`env.schema.ts` допустимы ТОЛЬКО: (а) секреты (ключи/пароли/токены/секреты подписи/ключи шифрования/соли), (б) строки подключения (`DATABASE_URL`/`REDIS_URL`), (в) bootstrap рантайма, нужный ДО доступности БД (`NODE_ENV`/`PORT`/`LOG_LEVEL`/домены cookie/публичный URL), (г) креды и endpoint-ы внешней инфры (S3/LiveKit/TURN/SMTP/провайдеры/платёжка — см. [[feedback_switchable_endpoints]]). **Всё остальное — порог, лимит, флаг, cron-час, debounce/TTL, retention, rate-limit, вес, выбор модели — это крутилка и идёт в `AdminSetting`** через `resolveSync`/`getDynamic` (admin→ENV→code-fallback) + строка в реестре + сид + UI-поле. Магическая константа того же рода прямо в коде сервиса — тоже нарушение (выносить через `getDynamic` с code-fallback). Прямой `process.env.*` мимо `env.schema.ts` — запрещён. Сомневаешься секрет/крутилка — таблица §2 этого аудита и решения Р1–Р6.

**Машинный гард (ТЗ-0):**
- Lint/тест: новая переменная в `env.schema.ts`, не помеченная как секрет/инфра (комментарий-маркер `// keep-env: <причина>` или отдельный список `KEEP_ENV_KEYS`), → проваливает CI.
- Тест: запрет `process.env.` вне whitelisted-файлов (`env.schema.ts`, `config.module.ts`, `main.ts`, `*/scripts/*`).
- Серверная валидация `AdminSettingsService.set()` по `getSchemaForKey(key)` (закрывает 🔴 из §7).

**Куда занести (триггеры завершения):**
- CLAUDE.md — под-пункт правила (выше).
- `~/.claude/.../memory/` — обновить `feedback_admin_settings_not_env_or_code.md` (добавить запрет `process.env.*` и хардкод-крутилок + ссылку на этот аудит).
- `second-brain/02_architecture/code-pitfalls.md` — техзаметка про два кэша / cron не на лету / `set()` без серверной валидации.
- `docs/operations/feature-flags.md` — уже единая точка для флагов; правило ссылается на неё.

---

## 10. Открытые вопросы (решения владельца)

1. **Р1–Р6 (§6)** — подтвердить рекомендации или поправить точечно (это определяет границу ENV/админка).
2. **Глубина переноса:** мигрируем все ~320 крутилок волнами ИЛИ только «операционно-крутимые» (ТЗ-1) + гейт, а редкие оставляем `get-only` до востребования? **Рекомендую второе** — ценность/усилие выше, гейт всё равно останавливает рост.
3. **Серверная валидация `set()`** (🔴 §7) — чинить в ТЗ-0 (рекомендую) или отдельно?

---

### Источники
- Код: `env.schema.ts`, `typed-config.service.ts`, `admin-setting-schema-registry.ts`, `admin-settings.service.ts`, `schema.prisma` (AdminSetting), `backend/scripts/seed-admin-setting-*.ts`, профильные `*SettingsClient.tsx`.
- Правила: CLAUDE.md (принцип 7/8, AdminSetting), `docs/operations/feature-flags.md`, memory `feedback_admin_settings_not_env_or_code` / `feedback_switchable_endpoints` / `feedback_ship_on_flags`.
- Аудит: 11 суб-агентов, 504 классифицированных точки (run `wf_603ce27f-784`).
