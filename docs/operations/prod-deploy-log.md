# Накопительная prod-инструкция — Z / Кора

> **Назначение.** Единый реестр операций, которые нужно выполнить на проде после очередного push в `dev` / `main`.
> Каждый push, который требует операций (миграция БД, seed, patch, новые ENV, рестарт), **обязан** добавить запись в раздел [🚨 Накоплено к выкату](#-накоплено-к-выкату).
> После реального выката на прод накопленный блок переезжает в [📂 Архив применённых](#-архив-применённых).
>
> **Прод-программист:** открой раздел «Накоплено к выкату», иди сверху вниз — это твоя готовая копи-пейст-инструкция.
> **Агент (Claude):** правила обновления см. в [🔄 Правила поддержки файла](#-правила-поддержки-файла) и в `CLAUDE.md` → «Триггер 1: после `git push`».
>
> ⚠️ **ПРАВИЛО №1.** Z на проде живёт целиком внутри `docker-compose.yml` (postgres + redis + migrate + backend + frontend, единый стек). Все команды этого файла — через `docker compose exec backend …` (для запущенного backend) или `docker compose run --rm backend …` (для разового запуска). **Никаких прямых `cd backend && bun run …` или `bun install` на хосте.** Хост — только `git pull` + `docker compose build/up/down`.

---

## 🚨 Накоплено к выкату

**Окно:** 2026-05-20 .. 2026-05-27 (с момента последнего prod-cut).
**Источник:** все рефлексии в `second-brain/05_история/` с этой даты + git log dev.
**Содержит:** ~80 prod-скриптов (patch/seed/migrate/backfill/setup) + ~175 новых Prisma-моделей + ~135 новых ENV (все опциональные) + 2 опасных schema-изменения + новый модуль биллинга (Tochka).

> Все рабочие директории — внутри контейнера `backend` (`/app`). На хосте оставайся в корне репо `~/work/z` (или где у тебя `docker-compose.yml`).

---

### 💳 ТЗ 2026-05-27 — billing/tochka/referrals/dadata (новый блок)

Ветка: `feature/billing-tochka-referral-dadata`. 8 коммитов (52cde75..4416801). Введены 5 новых модулей backend: `billing`, `inn-lookup`, `meetings-balance`, `referrals` + интеграция в `entitlements`/`meetings`/`quotas`. **Frontend ещё не сделан** (Фаза 9 ТЗ §14) — поэтому новые эндпоинты пока доступны только через Swagger `/api/docs`.

**Кратко по шагам прод-инструкции (полные команды — в соответствующих секциях ниже):**

- **Шаг 1 — ENV** — 36 новых переменных. Все опциональные с дефолтами; backend стартует без них. На MVP минимум: `BILLING_PROVIDER=manual` (default), оставить feature-flags `false`. Реальные значения для Tochka — после регистрации app в кабинете Точки.
- **Шаг 4 — Prisma** — auto через `migrate`-сервис. 10 новых моделей: `Subscription`, `SubscriptionEvent`, `Invoice`, `BillingEventLog`, `BillingProviderConfig`, `MeetingsBalance`, `Referral`, `ReferralAttribution`, `ClientReferralLink`, `ReferralPayout`. 7 новых enum.
- **Шаг 6 — Patch** — 1 новый: `migrate-entitlements-to-standard.ts` (legacy `tier_basic/pro/enterprise` → `tier_standard`). Идемпотентный.
- **Шаг 7 — Seed** — ничего не нужно (плановых seed'ов в фазах нет).
- **Шаг 8 — Backfill** — 1 новый: `backfill-meetings-balance.ts` (стартовый `MeetingsBalance(balance=150)` для всех existing Org).
- **Шаг 10 — Per-tenant: Tochka OAuth** — отдельная операция владельца (не код). См. ниже «Tochka подключение в production».
- **Шаг 12 — Smoke** — проверить:
  - `GET /api/v1/billing/subscription` отдаёт null для свежей Org с DEMO,
  - `GET /api/v1/billing/meetings-balance` отдаёт balance после backfill,
  - `GET /api/v1/internal/billing/provider-events` отдаёт `{ok:true}` (webhook probe),
  - `POST /api/v1/admin/orgs/:tenantId/billing/activate {paymentMode:'bonus',...}` создаёт Subscription+Invoice+SubscriptionEvent+AdminAuditLog + грантует 150 встреч.

#### Tochka подключение в production

Делается **один раз** при первом включении реального провайдера Tochka:

1. Зарегистрировать приложение в кабинете Точки → получить `client_id`/`client_secret`.
2. Прописать в `.env`:
   ```bash
   BILLING_PROVIDER=tochka
   FEATURE_BILLING_TOCHKA=true
   FEATURE_BILLING_CARD_RECURRING=true     # вкл. оплату картой через рекуррент
   FEATURE_BILLING_BANK_INVOICE=true       # вкл. безналичный счёт
   TOCHKA_MODE=production
   TOCHKA_CUSTOMER_CODE=<выдан Точкой>
   TOCHKA_ACCOUNT_ID=<счёт/БИК>
   TOCHKA_CLIENT_ID=<выдан Точкой>
   TOCHKA_CLIENT_SECRET=<секрет>
   TOCHKA_REDIRECT_URI=https://api.kora.app/api/v1/internal/billing/tochka/oauth/callback
   TOCHKA_WEBHOOK_URL=https://api.kora.app/api/v1/internal/billing/provider-events
   TOCHKA_WEBHOOK_AUTO_REGISTER=true
   BILLING_PUBLIC_API_URL=https://api.kora.app
   BILLING_LEGAL_ENTITY_NAME=<ООО/ИП>
   BILLING_LEGAL_ENTITY_INN=<наш ИНН>
   BILLING_LEGAL_ENTITY_KPP=<наш КПП>
   BILLING_LEGAL_ENTITY_ADDRESS=<юр.адрес>
   BILLING_LEGAL_ENTITY_BIK=<БИК>
   BILLING_LEGAL_ENTITY_ACCOUNT=<р/с>
   # DaData (для inn-lookup fallback)
   DADATA_API_KEY=<токен dadata>
   INN_LOOKUP_PROVIDER=tochka_then_dadata
   ```
   `docker compose up -d --force-recreate backend`
3. Открыть backend-логи: `docker compose logs -f backend | grep "TOCHKA OAuth"`
   → увидеть строку `откройте URL в браузере: https://enter.tochka.com/connect/authorize?...`
   → открыть URL в браузере, авторизоваться в кабинете Точки → callback придёт на `/internal/billing/tochka/oauth/callback`.
4. Альтернатива через admin-API (если super_admin уже залогинен):
   ```bash
   curl -s https://api.kora.app/api/v1/admin/billing/tochka/oauth/authorize-url \
     -H "Cookie: <session>" -H "X-Org-Id: <org>"
   # → {url:"https://enter.tochka.com/connect/authorize?..."}
   # Открыть url в браузере. После callback'а проверить:
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "SELECT key, jsonb_pretty(value_json::jsonb) FROM billing_provider_config;"
   # Должна быть запись 'tochka.production.oauth_tokens' с accessToken и refreshToken.
   ```
5. Webhook регистрируется автоматически при старте backend через 1.5с (если `TOCHKA_WEBHOOK_AUTO_REGISTER=true`).
6. Канарейка: на тестовой Org → `POST /api/v1/billing/pay/card` с `billingPeriod=monthly, seatsExtra=0` → 1 ₽ (потребуется снижение `BASE_MONTHLY_PRICE_KOPECKS` в коде для канарейки, либо использовать stage-окружение).

#### Реферальная программа — что проверить

После выката `referrals` модуль работает автоматически:
- Лендинг должен бить `POST /api/v1/public/referrals/attribution {slug, fingerprint?, referer?}` (throttle 10/min/IP) когда юзер заходит по `?ref=<slug>`.
- Фронт после signup зовёт `POST /api/v1/referrals/attribute-current-org` с заголовками `X-Z-Ref` (из cookie) и `X-Z-Fingerprint`.
- Cron `0 10 10 * *` Europe/Moscow закрывает прошлый месяц — на проде убедиться что `@nestjs/schedule` поднимает его.
- Партнёру нужно: `POST /referrals/me` (создать профиль), `POST /referrals/me/verify-inn`, `POST /referrals/me/accept-contract` — без этого cron 10-го числа переведёт payout в `void`.

---

## 🚀 Полный чек-лист обновления (Сценарий A: данные сохраняем)

> Стандартный workflow обновления работающего прода. Если БД жалко потерять — это твой путь.

```bash
# ─── 1. SSH на сервер + в директорию проекта ───────────────────────
ssh root@prod
cd /home/docker/z
set -a && source .env && set +a              # подтянуть POSTGRES_USER/DB в shell

# ─── 2. БЭКАП БД ────────────────────────────────────────────────────
mkdir -p backups && \
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/z_main_$(date +%F-%H%M).dump" && \
ls -lh backups/ | tail -3
# Размер должен быть > 0 байт. Сохрани файл — нужен для отката.

# ─── 3. Pull кода ──────────────────────────────────────────────────
git pull origin dev
git log -1 --oneline                          # увидь последний коммит

# ─── 4. Sanity-check lockfile ──────────────────────────────────────
grep -c npmmirror backend/bun.lock frontend/bun.lock   # должно быть 0 и 0

# ─── 5. .env — проверить новые ENV ─────────────────────────────────
# Открой .env и сверься с разделом «Шаг 1 — ENV» ниже.
# Если добавлял новые NEXT_PUBLIC_* — нужна пересборка frontend в Шаге 9.
nano .env
set -a && source .env && set +a

# ─── 6. GATE — защитный backfill ДО migrate ────────────────────────
# Только если у тебя legacy Meeting с tenantId=NULL (есть до этого выката).
# postgres уже up с прошлого деплоя — `run --rm` стартует одноразовый контейнер.
docker compose run --rm backend bun run scripts/backfill-orgs-fase0.ts
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts --apply
docker compose run --rm backend bun run scripts/tighten-meeting-tenant-not-null.ts
# Последняя команда: exit 0 = можно идти дальше, exit 1 = STOP, разбирайся.

# ─── 7. Build + up (миграция автоматически через migrate-сервис) ───
docker compose build                          # 5-15 минут на холодную, 1 на инкремент
docker compose up -d --build                  # postgres + redis + migrate (one-shot) + backend + frontend

# Дождаться миграции:
docker compose logs -f migrate
# Жди: "✓ postgres-init.sql выполнен" + "=== apply-postgres-init DONE ===", Ctrl+C
docker compose ps                             # все 4 контейнера healthy

# ─── 8. Подхват новых ENV / NEXT_PUBLIC_* ──────────────────────────
# Если правил .env (Шаг 5):
docker compose up -d --force-recreate backend
# Если правил NEXT_PUBLIC_*:
docker compose up -d --build frontend

# ─── 9. ОДНА КОМАНДА: применить patch + seed + backfill + migrate ──
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update --continue-on-fail
# В конце: "=== SUMMARY === Всего: NN, OK: M, FAIL: K"
# Если есть FAIL — посмотри список упавших, разбирайся индивидуально.

# ─── 10. Per-tenant setup (опц., только если меняются токены/URL) ──
# Telegram (глобальный, БЕЗ --tenant-id):
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://api.prod.host --webhook-secret=<секрет>

# ─── 11. Включение CLONE_V2_ENABLED (только если бизнес-готово) ────
# Убедись что в /admin/clones корректно отображаются гранты после
# patch-migrate-clone-access (он внутри агрегатора). Только тогда:
# В .env: CLONE_V2_ENABLED=true
# Подхват:
# docker compose up -d --force-recreate backend

# ─── 12. nginx (только если меняешь BACKEND_HOST_PORT/FRONTEND_HOST_PORT) ─
# sudo nginx -t && sudo systemctl reload nginx

# ─── 13. Smoke ─────────────────────────────────────────────────────
curl https://api.prod.host/health
curl https://api.prod.host/health/ready       # пара post/redis/livekit = ok
curl -s https://api.prod.host/api/docs > /dev/null && echo "Swagger OK"
curl -s https://api.prod.host/metrics | grep -E 'bullmq_(probe|conversational|chat-v2|knowledge-clone|skill|tracker)' | head
```

**Если что-то пошло не так — см. [🆘 Troubleshooting](#-troubleshooting) внизу.**

---

## 🆕 Полный чек-лист для чистого старта (Сценарий B: данные сносим)

> Beta/staging, или прод где volume PG несовместим с composite-образом. **Все данные пользователей будут потеряны.**

```bash
ssh root@prod
cd /home/docker/z
set -a && source .env && set +a

# ─── 1. (опц.) Бэкап перед wipe — на случай если передумаешь ──────
mkdir -p backups && \
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "backups/z_main_before_wipe_$(date +%F-%H%M).dump" 2>/dev/null || echo "БД уже сломана — пропускаем бэкап"

# ─── 2. WIPE: down -v снесёт volumes (БД + redis-AOF) ─────────────
docker compose down -v --remove-orphans
docker volume ls | grep z_                    # должно быть пусто

# ─── 3. Pull + проверка lockfile + .env ────────────────────────────
git pull origin dev
grep -c npmmirror backend/bun.lock frontend/bun.lock     # 0 и 0
# Минимальный .env (см. ниже «Шаг 1 — ENV»):
nano .env
set -a && source .env && set +a

# ─── 4. Build + up (на чистой БД gate не нужен) ────────────────────
docker compose build
docker compose up -d
docker compose logs -f migrate                # жди "DONE", Ctrl+C
docker compose ps                             # все healthy

# ─── 5. Проверка composite-образа postgres + расширений ───────────
docker compose ps postgres                    # IMAGE: z-postgres-age-pgvector:pg16
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('age','vector');"
# Должно вернуть 2 строки

# ─── 6. ОДНА КОМАНДА: bootstrap super-admin + все seed'ы ──────────
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail
# Минует patch/backfill/migrate (на пустой БД нечего бэкфилить).

# ─── 7. Setup ботов + smoke ────────────────────────────────────────
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://api.prod.host --webhook-secret=<секрет>

curl https://api.prod.host/health
curl https://api.prod.host/health/ready
```

---

## 🚀 TL;DR — что делает агрегатор

`backend/scripts/apply-prod-deploy.ts` — единая точка для всех ~80 prod-операций:

```bash
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap   # чистый старт
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update      # обновление
docker compose exec backend bun run scripts/apply-prod-deploy.ts                    # all (default)

# Полезные флаги:
#   --dry-run            показать что будет запущено, не выполнять
#   --continue-on-fail   продолжать после ошибки скрипта (default: stop)
```

В конце: `=== SUMMARY === Всего: NN, OK: M, FAIL: K` + список упавших. Если есть FAIL — `exit 1`.

> При добавлении нового `seed-*` / `patch-*` / `backfill-*` / `migrate-*` скрипта **обязательно** допиши его в массив `STEPS` в `backend/scripts/apply-prod-deploy.ts` — иначе на проде он не запустится.

---

## Два сценария выката

| Сценарий | Когда | Куда смотреть |
|---|---|---|
| **A. Обновление (данные сохраняем)** | Стандартный workflow: prod уже работает, данные пользователей важны | Шаги 0..12 ниже (с GATE-backfill'ами и patch/migrate-скриптами для legacy) |
| **B. Чистый выкат с нуля (wipe & fresh)** | Beta/staging без важных данных; или postgres-volume несовместим с новым образом (например, был pg17 → стал composite pg16) | См. [📦 Сценарий B: Чистый выкат с нуля](#-сценарий-b-чистый-выкат-с-нуля) ниже. **Минует patch/backfill/migrate — на пустой БД они не нужны.** |

⚠️ Если `docker compose up` падает с ошибкой про `database files are incompatible with server` или `migrate` exit 1 на CREATE EXTENSION — у тебя НЕ composite postgres-образ запущен (или volume старого PG). Перейди в [Сценарий B](#-сценарий-b-чистый-выкат-с-нуля).

---

### Шаг 0 — Pre-flight (один раз перед выкатом)

**0.1. Apache AGE в postgres-образе.**
`migrate`-сервис compose выполняет `bunx prisma db push && bun scripts/apply-postgres-init.ts`. Последний создаёт `CREATE EXTENSION age` и `ag_catalog.create_graph('z_graph')` для онтологии (Фаза 0).

В `docker-compose.yml` (корневой) postgres-сервис собирается из `infra/postgres/Dockerfile` — composite-образ `z-postgres-age-pgvector:pg16` с уже включёнными `age 1.5+`, `pgvector 0.8+` и `shared_preload_libraries = 'age'`. Ничего отдельно настраивать не нужно — образ соберётся при первом `docker compose build`.

Если у тебя на проде **managed Postgres** (Yandex / Selectel) вместо composite-образа:
- В настройках кластера прописать `shared_preload_libraries = 'age'` → рестарт инстанса.
- Проверить:
  ```bash
  docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SHOW shared_preload_libraries;"
  ```

См. `second-brain/02_architecture/age-deployment-decision.md`.

**0.2. Бэкап БД.** Обязательно перед `prisma:push` (Шаг 4) и `patch-*` (Шаг 6).

```bash
# Одной командой — mkdir + pg_dump (директория backups/ может ещё не существовать на свежем сервере):
mkdir -p backups && docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "backups/z_main_$(date +%F-%H%M).dump" && ls -lh backups/ | tail -3
```

> ⚠ `$POSTGRES_USER` и `$POSTGRES_DB` берутся из shell-окружения хоста. Если они не экспортированы — подставь явные значения (`-U z_app -d z_main`) или сначала `set -a && source .env && set +a`.

Восстановление:
```bash
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < backups/z_main_<TIMESTAMP>.dump
```

**0.3. Lockfile-санитизация (одноразовое).**
Если `bun.lock` в репо ссылается на `cdn.npmmirror.com` (китайский CDN — пакеты оттуда удаляются произвольно), `docker compose build` упадёт на `error: GET https://cdn.npmmirror.com/... - 404`. Фикс уже закоммичен (`backend/bunfig.toml` + `frontend/bunfig.toml` с `registry = "https://registry.npmjs.org"` + перегенерированные `bun.lock`). Проверка:
```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть по 0
```

**0.4. ENV** — см. Шаг 1.

---

### Шаг 1 — ENV (новые ключи за период)

Все ENV, добавленные за окно, **опциональны (имеют дефолты)** — backend стартует без них. Но рекомендованный минимум для прода:

```bash
# === Conversational channels β-9 (2026-05-25) — глобальный Telegram-бот ===
KORA_BOT_USERNAME=kora_bot          # без @, для deep-link
INVITE_TTL_DAYS=14
INVITE_REMINDER_DAYS=7
MAGIC_LINK_TTL_MINUTES=15
MAGIC_LINK_RATE_LIMIT_PER_HOUR=5
INACTIVE_BINDING_DAYS=30

# === Telegram через прокси telegram.crossmark.ru (2026-05-26) ===
# ТЗ: plans/tz/2026-05-26-telegram-via-crossmark-proxy.md.
# Прод по умолчанию через прокси — backend и Telegram не имеют прямой связи из ДЦ.
TELEGRAM_PROXY_ENABLED=true                       # default true; false = аварийный rollback на api.telegram.org
TELEGRAM_PROXY_API_BASE=https://telegram.crossmark.ru
TELEGRAM_PROXY_FILE_BASE=https://telegram.crossmark.ru
TELEGRAM_PROXY_ADMIN_EMAIL=<email учётки в прокси>   # регистрация — на /register прокси, один раз
TELEGRAM_PROXY_ADMIN_PASSWORD=<секрет>               # хранить в vault; ротация раз в квартал
TELEGRAM_PROXY_ADMIN_JWT_PREFETCH_SEC=60             # обновлять JWT за 60с до exp
TELEGRAM_PROXY_REQUEST_TIMEOUT_MS=15000              # потолок одного outbound-вызова
TELEGRAM_PROXY_HEALTH_INTERVAL_SEC=30                # интервал health-cron

# === Web Push (если включается push-уведомления) ===
# ВНИМАНИЕ: VAPID_* НЕ в EnvSchema → опечатки не валидируются zod'ом, фича просто молча отключится.
VAPID_PUBLIC_KEY=<docker compose run --rm backend bunx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<...>
VAPID_SUBJECT=mailto:noreply@kora.app
PUSH_MAX_FAILURES=5
# Frontend (build-arg!) — тот же public key:
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<тот же public>

# === Email-to-task (T5, опц., default OFF) ===
MAIL_INBOX_ENABLED=false                 # включить ТРЕБУЕТ заполнения остальных
MAIL_INBOX_DOMAIN=inbox.kora.app
MAIL_INBOX_IMAP_HOST=imap.kora.app
MAIL_INBOX_IMAP_PORT=993
MAIL_INBOX_IMAP_USER=inbox@kora.app
MAIL_INBOX_IMAP_PASS=<secret>
MAIL_INBOX_IMAP_TLS=true
MAIL_INBOX_IMAP_FOLDER=INBOX
MAIL_INBOX_POLL_CRON=*/2 * * * *
MAIL_INBOX_MAX_PER_RUN=50

# === T3 LLM провайдеры (kie + grsai) ===
KIE_API_KEY=<secret>
GRSAI_API_KEY=<secret>

# === Kill-switch'и (все default false — можно не дублировать) ===
BITEMPORAL_ENABLED=false
BITEMPORAL_SUPERSEDE_ENABLED=false
CLONE_V2_ENABLED=false                   # ТОЛЬКО ПОСЛЕ Шага 6.10 (patch-migrate-clone-access)
SPECIALISTS_COMBINED_ENABLED=false
COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM=false
DATACLASS_POLICY_ENFORCEMENT=shadow      # off | shadow | enforce — на проде сначала shadow

# === Concierge → dialog-layer integration (ТЗ 2026-05-27) ===
# При CONCIERGE_DIALOG_LAYER_ENABLED=true главный AI-агент использует
# 5-шаговый pipeline DialogService (contextualize → confidence → classify →
# multi-query + AnswerCache) и параллельный pre-retrieval по queries через
# ToolRouter.execute('search_knowledge'). Default false — на проде сначала
# включаем на 1 dev-tenant, потом полный raise. Откат — одной ENV.
CONCIERGE_DIALOG_LAYER_ENABLED=false        # фича-флаг pipeline (default false)
CONCIERGE_PRE_RETRIEVAL_TOP_K=12            # cap items в pre-retrieval после dedup
CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS=3000     # per-query timeout (мс), не блокирует основной flow
```

**Применение в compose.** ENV читаются из корневого `.env` через `env_file: [.env]` (см. `docker-compose.yml`). После правки `.env`:
```bash
docker compose up -d --force-recreate backend
```
(`restart` НЕ перечитает env-переменные — нужен именно `--force-recreate`.)

⚠️ **NEXT_PUBLIC_\*** вшиваются в frontend-бандл во время **сборки** (build-args). При смене любой `NEXT_PUBLIC_*` — обязательная пересборка:
```bash
docker compose up -d --build frontend
```

Полный список — `backend/src/common/config/env.schema.ts`. VAPID_*, CONCIERGE_* сознательно вне EnvSchema (TS2589 при глубоких `.merge()`) — читаются через `process.env` напрямую.

---

### Шаг 2 — Pull + сборка образов

```bash
# на хосте, в корне репо
git pull origin dev

# Пересобрать backend + frontend + postgres-композит (если изменился infra/postgres/Dockerfile).
docker compose build
```

`docker compose build` использует `bun install --frozen-lockfile` внутри Dockerfile и `bunfig.toml` (registry = npmjs.org). Никакого `bun install` на хосте не нужно.

---

### Шаг 3 — PRE-MIGRATION gate (защитный backfill ДО `migrate`-сервиса)

`prisma db push` (внутри `migrate`-сервиса) сделает `Meeting.tenantId` NOT NULL. Если есть legacy-Meeting с NULL — push упадёт и весь `docker compose up` зависнет.

Сначала чиним — через `run --rm backend` (одноразовый контейнер с новым кодом, postgres уже запущен с прошлого выката):

```bash
# postgres должен быть up (со старого деплоя). Если нет:
docker compose up -d postgres redis

docker compose run --rm backend bun run scripts/backfill-orgs-fase0.ts
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts                  # dry-run
docker compose run --rm backend bun run scripts/backfill-meeting-tenant-id.ts --apply          # реальный прогон
docker compose run --rm backend bun run scripts/tighten-meeting-tenant-not-null.ts             # exit 1 == STOP
```

Если `tighten-*` падает → разбирайся, **не запускай Шаг 4** пока не вернёт 0.

---

### Шаг 4 — Прогон миграций (автоматически через `migrate`-сервис)

Запуск всего стека. `migrate` отработает первым (`prisma db push` + `apply-postgres-init.ts`), потом стартанёт `backend`.

```bash
docker compose up -d
docker compose logs -f migrate     # пока не увидишь "DONE" / exit 0
```

⚠️ **`prisma:push` спросит подтверждение на:**
1. **DROP колонки `Transcript.rawIndexS3Url`** (NOT NULL) — данные перенесены в новую модель `TranscriptTrack`. Если потребуется — добавь `--accept-data-loss` в команду `migrate`-сервиса (`docker-compose.yml` → `migrate.command`) и пересобери. Перед этим убедиться, что нет внешних потребителей S3-ключа.
2. **`Meeting.tenantId` → NOT NULL** — gate из Шага 3 должен был всё прибрать. Если не сработал — вернись.

**Что нового в схеме** (за окно ~165 новых моделей):
- Kora-v2 фундамент: AdminSetting, EmailTemplate, RetentionPolicy, CronSchedule, FeatureFlag
- knowledge-core graph: Decision, Insight, Idea, IdeaCluster, IdeaBlockLink, EntityLink, Interaction
- Tracker (~20 моделей): Issue, IssueState, IssueComment, IssueAttachment, IssueLink, IssueRelation, IssueWebhook, IssueWebhookLog, IntakeIssue, Project, ProjectMember, Label, Cycle, Plan, ImportLog, HolidayCalendar
- Company Foundation (Фаза 0): Person, Role, Department, JobDescription, Document, Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Market, OrgUnit, Vendor, CompanyProfile, FunctionalDomain, Appointment, RoleProfile
- Skill / Clone (γ-1): Skill, SkillProfile, SkillTrait, SkillTraitCategory, SkillTraitConcept, ExecutablePersona, PersonKnowledgeCategoryEmbedding, CloneAccessGrant
- AI/LLM Admin: LlmProvider, LlmModel, LlmModelExperiment, LlmTaskRouteChange, PromptTemplate, PromptTemplateVersion, AiResultFeedback, AiCostDaily, OrgBudgetCap, CurrencyRate
- Meetings/Curation: TranscriptTrack, MeetingBehaviorMetrics, MeetingQualityScore, MeetingReport, CurationItem, CardVersion, CompletenessSlot
- Operations β: Experiment, DailyCheckIn, DailyOperationsDigest, WeeklyOperationsDigest, ProactiveNotification, ProbeEvent
- Gamification: ActivityFeedItem, Recognition, HelpfulnessTrait, HelpfulnessSpotlight, Badge, UserBadge, TeamTemplate
- Channels: Channel, ChannelBinding, Notification, NotificationDelivery, MailInboundLog, ChatV2Conversation, ChatV2Message
- Calendar (MVP): Event, EventParticipant, EventReminder
- Concierge / Push: ConciergeConversation, ConciergeMessage, OrgConciergeQuota, OrchestratorRun, PushSubscription

Расширение существующих:
- `Meeting`: +linkedIssueId, +reportFastStatus, +recordByDefault, +behaviorMetricsStatus, +qualityScoreStatus
- `Transcript`: +turns(Json), +roomChat, +cleanedS3Url, +cleaningStatus; **DROP rawIndexS3Url**
- `AiResult`: +summaryFast, +promptTemplateVersionId, +experimentGroup
- `AiUsageLog`: +inputCostPerMillionTokensSnapshot, +costRub, +dataClassAudit
- `Task`: +assigneeUserId (FK на User)
- `User`: +calendarFeedToken (VarChar 80)
- `User` (2026-05-29, онбординг v2): +`companyRole UserCompanyRole?` (enum: founder, general_director, operations_director, department_head, team_lead, specialist), +`profileCompletedAt DateTime?`. Оба nullable — обратно совместимо, простой db push.
- `Org` (2026-05-29, онбординг v2): +`teamSize VarChar(20)?`, +`painPoints String[]`, +`currentStack String[]`, +`plannedFeatures String[]`, +`welcomeCompletedAt DateTime?`, +`companyInfoCompletedAt DateTime?`, +`departmentsCompletedAt DateTime?`, +`rolesCompletedAt DateTime?`, +`teamInvitedAt DateTime?`, +`firstSprintCreatedAt DateTime?`, +`firstMeetingCreatedAt DateTime?`, +`setupCompletedAt DateTime?`. Все nullable — обратно совместимо, простой db push.
- `User` (2026-05-27, коммит `ade4c25`): +`phone VarChar(20)?`, +`signupRef VarChar(255)?`, +`consentDataProcessing Boolean @default(false)`, +`consentMarketing Boolean @default(false)`, +`consentAcceptedAt DateTime?`. Lead-style регистрация: телефон, два чекбокса согласий, ref-tracking из URL. Все nullable / с дефолтом — обратно совместимо, простой db push без `--accept-data-loss`.
- `CloneAccessGrant` (2026-05-26, коммит `fc3d6fe`): +`revokedAt DateTime?`, +`revokedBy String?`, +`expiresAt DateTime?` + 2 индекса. Все поля nullable — обратно совместимо, простой db push.
- **Sprints (2026-05-27, коммиты `bb4aa6e`/`9df3d6c`/`bc34ea6`):**
  - `Project` +4 опц. scope-поля (`customerCardId/vendorId/subjectPersonId/departmentId`) + 4 индекса. Обратные relations добавлены в `Card/Vendor/Person/Department` как `scopedProjects Project[]` с уникальными relation-name'ами (ProjectCustomerCard / ProjectVendor / ProjectSubjectPerson / ProjectDepartment).
  - `Cycle` — обратные relations `linkedMeetings Meeting[]` (MeetingLinkedCycle) и `sprintHints SprintHint[]` + индекс `(tenantId, completedAt)`.
  - `Meeting` +`linkedCycleId String?` + relation MeetingLinkedCycle + индекс. Простой db push, обратно совместимо.
  - Новая модель `SprintHint` (cycleId, kind, severity, status, title, body, affectedIssueIds[], sourceBlockIds[], contentHash для дедупа, confidence). 3 новых enum: `SprintHintKind` (10 значений), `SprintHintSeverity`, `SprintHintStatus`.
  - `MeetingType` +`sprint_review` (для встречи «Итоги спринта»).

Enum расширения (без удалений — Postgres не умеет DROP VALUE):
- `MeetingType`: +review, +retrospective, +task_discussion
- `SignalType`: +30 значений
- `EntityType`: +customer, +vendor, +document, +goal, +event, +technology, +metric, +market, +org_unit
- `EntityLinkType`: +30 значений
- `IdeaBlockLinkType`: +resolves, +supersedes
- `MembershipRole`: +coo
- `SourceType`: +conversational, +tracker_event
- `VerificationPurpose`: +magic_link, +invite_accept
- ~50 новых enum-типов целиком

---

### Шаг 5 — Postgres-init (HNSW + GIN + partial unique + AGE graph)

Выполняется автоматически внутри `migrate`-сервиса (см. Шаг 4) после `prisma db push`. Если нужно прогнать вручную (например, после ручной правки SQL):
```bash
docker compose run --rm backend bun run apply-postgres-init
```

Что создаёт (всё через `IF NOT EXISTS`, идемпотентно):
- **Extensions:** `vector`, `age` (+ `LOAD 'age'`, `SET search_path`)
- **Graph:** `ag_catalog.create_graph('z_graph')`
- **HNSW (cosine) на embedding-колонках:** Decision, Insight, Idea, IdeaCluster, SkillTrait, SkillTraitConcept, PersonKnowledgeCategoryEmbedding, HelpfulnessTrait, Issue, MeetingTranscriptChunk, IdeaBlock, Entity
- **GENERATED tsvector + GIN (словарь `russian`):** IdeaBlock.search_tsv, decisions.decision_search_tsv, insights.insight_search_tsv
- **GIN на массивах:** Event.participantsPersonIds, Vendor.contractIds, decisions/insights/ideas/EntityLink.* массивы IDs
- **Partial unique индексы:** meeting_report_pending_unique, Vendor_tenantId_inn_unique_idx, Entity_strong_inn/ogrn/email/domain_uniq, channels_global_unique
- **Composite:** probe_events_tenant_status_created_idx, Entity_strong_phone_idx

---

### Шаг 6 — One-off patch-скрипты (порядок важен!)

> Все patch-скрипты — через `exec backend` (контейнер уже запущен после Шага 4).

```bash
# 6.1 — Knowledge-core: переименования + entityId
docker compose exec backend bun run scripts/patch-rename-client-to-customer.ts --dry-run
docker compose exec backend bun run scripts/patch-rename-client-to-customer.ts
docker compose exec backend bun run scripts/patch-migrate-entity-custom-to-topic.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-document.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-goal.ts
docker compose exec backend bun run scripts/patch-backfill-entity-id-person.ts
# либо composite alias (запускает все три выше):
# docker compose exec backend bun run patch:backfill-entity-id
docker compose exec backend bun run scripts/patch-person-relationship.ts

# 6.2 — Card versioning + document defaults
docker compose exec backend bun run scripts/patch-backfill-card-versions.ts
docker compose exec backend bun run scripts/patch-document-use-cases-default.ts

# 6.3 — Org / Person timezone (Europe/Moscow по умолчанию)
docker compose exec backend bun run scripts/patch-org-timezone-default.ts
docker compose exec backend bun run scripts/patch-person-timezone-default.ts

# 6.4 — Mission/Vision/Strategy → CompanyProfile (по умолчанию dry-run!)
docker compose exec backend bun run scripts/patch-migrate-mvs-to-company-profile.ts            # dry-run
docker compose exec backend bun run scripts/patch-migrate-mvs-to-company-profile.ts --apply    # запись

# 6.5 — PersonRole → Appointment (по умолчанию dry-run!)
docker compose exec backend bun run scripts/patch-migrate-person-role-to-appointment.ts            # dry-run
docker compose exec backend bun run scripts/patch-migrate-person-role-to-appointment.ts --apply    # запись

# 6.6 — Skill traits категории (γ-1)
docker compose exec backend bun run scripts/patch-skill-trait-categories-from-strings.ts --dry-run
docker compose exec backend bun run scripts/patch-skill-trait-categories-from-strings.ts

# 6.7 — KC-Temporal (bitemporal + dataclass + strong-ids + channel-binding)
docker compose exec backend bun run scripts/patch-bitemporal-backfill.ts --dry-run
docker compose exec backend bun run scripts/patch-bitemporal-backfill.ts
docker compose exec backend bun run scripts/patch-clones-role-versioning.ts
docker compose exec backend bun run scripts/patch-clones-dataclass-update.ts
docker compose exec backend bun run scripts/patch-backfill-dataclass-audit.ts
docker compose exec backend bun run scripts/patch-channel-binding-defaults.ts
docker compose exec backend bun run scripts/patch-extract-strong-ids.ts

# 6.8 — Prompt registry no-op (для будущей совместимости; сейчас ничего не пишут)
docker compose exec backend bun run scripts/patch-prompt-block-ingest-v2-fase0b.ts
docker compose exec backend bun run scripts/patch-prompt-role-profile-build-fase0d.ts

# 6.9 — LLM миграция на DeepSeek-V4-Pro (chat-v2 + 19 одиночек)
docker compose exec backend bun run scripts/patch-chat-v2-to-pro.ts
docker compose exec backend bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --dry-run
docker compose exec backend bun run scripts/patch-mass-migrate-to-deepseek-pro.ts --update-existing

# 6.10 — Первичная миграция грантов CloneAccessGrant (2026-05-26, коммит 87fef5d)
# ОБЯЗАТЕЛЬНО ДО переключения CLONE_V2_ENABLED=true (см. Шаг 1).
docker compose exec backend bun run scripts/patch-migrate-clone-access.ts
# опц. для одного тенанта:
# docker compose exec backend bun run scripts/patch-migrate-clone-access.ts --tenant <orgId>

# 6.11 — Регистрация глобального Telegram-бота в прокси telegram.crossmark.ru
# (2026-05-26). Идемпотентен. Предусловия:
#   - выставлены TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD в .env (см. Шаг 1);
#   - в /admin/system/telegram-bot уже установлен токен бота (иначе скрипт
#     выходит с инструкцией и кодом 0);
#   - аккаунт зарегистрирован вручную на https://telegram.crossmark.ru/register.
docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts
# опц. — ротация webhookSecret (старый перестаёт работать сразу):
# docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts --rotate-secret
```

⚠️ **НЕ запускать на проде** (помечен внутри файла «без согласования»):
- `backfill-task-assignee-userid.ts`

ℹ️ **Доступно оператору при инциденте — НЕ плановая операция** (коммит `177e465`):
- `patch-rollback-to-deepseek-flash.ts` — массовый откат всех LlmTaskRoute с `deepseek-v4-pro` обратно на `deepseek-v4-flash`. Запуск только при подтверждённой регрессии:
  ```bash
  docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --dry-run --update-existing
  docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --update-existing
  ```

### Шаг 6.11 — Переключение `CLONE_V2_ENABLED` (после Шага 6.10)

После того как миграция грантов отработала и владелец сверил список в `/admin/clones`:

```bash
# 1. правка .env на хосте:
#    CLONE_V2_ENABLED=true
# 2. подхват без пересборки (force-recreate перечитывает env_file):
docker compose up -d --force-recreate backend
```

Откат:
```bash
# .env: CLONE_V2_ENABLED=false
docker compose up -d --force-recreate backend
```

---

### Шаг 7 — Seed-скрипты

```bash
# 7.1 — Базовый каркас LLM (порядок важен: providers → models → prices → routes)
docker compose exec backend bun run scripts/seed-default-llm-providers-and-models.ts
docker compose exec backend bun run scripts/seed-llm-model-prices.ts
docker compose exec backend bun run scripts/seed-prompt-templates.ts                          # 13 системных шаблонов
docker compose exec backend bun run scripts/seed-llm-task-routes-default.ts                   # дефолтные цепочки

# 7.2 — Тарифы / Entitlements / Retention / Календарь / Шаблоны команд / Домены
docker compose exec backend bun run scripts/seed-entitlements.ts                              # OrgEntitlement(tier_pro)
docker compose exec backend bun run scripts/seed-retention-policies.ts
docker compose exec backend bun run scripts/seed-holiday-calendar-ru-2026.ts                  # производственный календарь РФ
docker compose exec backend bun run scripts/seed-team-templates.ts                            # 10+5 системных TeamTemplate
docker compose exec backend bun run scripts/seed-functional-domains.ts                        # 8 базовых FunctionalDomain per Org

# 7.3 — Admin settings
docker compose exec backend bun run scripts/seed-admin-settings.ts
docker compose exec backend bun run scripts/seed-admin-setting-daily-digest.ts

# 7.4 — Бейджи (gamification T1)
docker compose exec backend bun run scripts/seed-badges.ts                                    # 5 базовых

# 7.5 — Глобальный Telegram канал (β-9)
docker compose exec backend bun run scripts/seed-global-channels.ts

# 7.6 — LLM TaskRoutes для всех новых taskType (за период, безопасно идемпотентно)
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-B.ts                   # behavior-refine
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-C.ts                   # meeting-quality-score
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-D.ts                   # transcript-clean-refine
docker compose exec backend bun run scripts/seed-llm-task-routes-phase-E.ts                   # custom-report
docker compose exec backend bun run scripts/seed-llm-task-routes-regulations.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-knowledge-clone.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-knowledge-core.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-decisions.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-insights.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-ideas-and-probe.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-skill-and-clone.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-skill-concept.ts             # skill-trait-concept-name
docker compose exec backend bun run scripts/seed-llm-task-routes-chat-v2.ts                   # chat-v2-conversation-title, chat-v2-cite-select
docker compose exec backend bun run scripts/seed-llm-task-routes-recognition.ts               # recognition-formulate
docker compose exec backend bun run scripts/seed-llm-task-routes-helpfulness.ts               # 3 helpfulness taskType
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8.ts                    # checkin-parse, operations-summary
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-1.ts                  # checkin-sentiment(+batch), operations-weekly-digest
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-2.ts                  # commitment-extract-dates/status
docker compose exec backend bun run scripts/seed-llm-task-routes-beta-8-3.ts                  # operations-daily-digest
docker compose exec backend bun run scripts/seed-llm-task-routes-axis-classify.ts             # axis-classify, router-fallback
docker compose exec backend bun run scripts/seed-llm-task-routes-brand-voice.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-company-foundation.ts        # department-extract, domain-expand, maturity-rationale
docker compose exec backend bun run scripts/seed-llm-task-routes-concierge.ts                 # concierge-respond, concierge-toolcall-validate
docker compose exec backend bun run scripts/seed-llm-task-routes-cross-functional.ts          # cross-functional-friction-summary
docker compose exec backend bun run scripts/seed-llm-task-routes-experiments.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-process-template.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-role-map.ts                  # role-map-extract, role-completeness-rationale
docker compose exec backend bun run scripts/seed-llm-task-routes-orchestrator.ts              # 4 orchestrator-*
docker compose exec backend bun run scripts/seed-llm-task-routes-proactive.ts                 # proactive-message-craft
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3.ts            # meeting-extract-actions, intake-auto-triage
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase3-c.ts          # issue-infer-fields, issue-goal-suggest
docker compose exec backend bun run scripts/seed-llm-task-routes-tracker-phase4-telegram.ts   # telegram-create-task и др. (4 шт.)
docker compose exec backend bun run scripts/seed-llm-task-routes-feedback-cluster.ts          # feedback.cluster (4 уровня)
docker compose exec backend bun run scripts/seed-llm-task-routes-clone-v2.ts                  # dialog-multi-query-clone, clone-respond v2 → deepseek-v4-pro
docker compose exec backend bun run scripts/seed-llm-task-routes-specialists-combined.ts      # knowledge-specialists-combined (Variant Б+)
docker compose exec backend bun run scripts/seed-llm-task-routes-dialog-layer.ts              # 5 dialog-* taskType
docker compose exec backend bun run scripts/seed-llm-task-routes-temporal.ts                  # fact-supersede-detect
docker compose exec backend bun run scripts/seed-llm-task-routes-kie-grsai-ab.ts              # A/B на dialog-multi-query (status=draft)
docker compose exec backend bun run scripts/seed-llm-task-routes-sprints.ts                   # Sprints (2026-05-27): sprint-helper-suggest + sprint-review-summary (deepseek-v4-pro → gpt-5.4-mini → qwen3.5:9b)

# 7.7 — Глобальный default: DeepSeek-V4-Pro primary на ВСЕ taskType
docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts
# Если хочешь перебить уже существующие primary:
# docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts --update-existing
```

ℹ️ Большинство `seed-llm-task-routes-*` принимают `--update-existing` — без него существующие записи не трогаются. Защита `editedByAdmin` блокирует затирание ручных правок.

---

### Шаг 8 — Backfill (после schema + seed)

```bash
docker compose exec backend bun run scripts/backfill-meeting-sources-fase1.ts                 # дефолтный Source(type=meeting) per Org
docker compose exec backend bun run scripts/backfill-entity-link-types-fase0.ts               # EntityLink.fromType/toType → 'entity'
docker compose exec backend bun run scripts/backfill-commitment-due-dates.ts --dry-run
docker compose exec backend bun run scripts/backfill-commitment-due-dates.ts                  # β-8.2
docker compose exec backend bun run scripts/backfill-onboarding-setup-completed.ts            # онбординг v2: Org с отделами → setupCompletedAt = createdAt (идемпотентен, батчами по 100)

# Опционально (дорого по LLM-quota):
docker compose exec backend bun run scripts/skill-trait-concepts-backfill.ts
docker compose exec backend bun run scripts/person-knowledge-embeddings-backfill.ts --dry-run
docker compose exec backend bun run scripts/person-knowledge-embeddings-backfill.ts

# НЕ запускать (помечен «без согласования»):
# docker compose exec backend bun run scripts/backfill-task-assignee-userid.ts
```

---

### Шаг 9 — Миграции (β-9 Telegram + Tracker legacy Task)

```bash
# β-9: per-tenant Telegram-каналы → один глобальный
docker compose exec backend bun run scripts/migrate-telegram-channels-to-global.ts --dry-run
# Изучи output (cases A/B/C/D/E). Если ок:
docker compose exec backend bun run scripts/migrate-telegram-channels-to-global.ts
# Аварийный откат:
# docker compose exec backend bun run scripts/migrate-telegram-channels-back.ts

# Tracker: legacy Task → Issue (по умолчанию dry-run!)
docker compose exec backend bun run migrate-task-to-issue                # = bun run scripts/migrate-task-to-issue.ts (dry-run)
docker compose exec backend bun run migrate-task-to-issue --apply        # реальная запись
```

---

### Шаг 10 — Per-tenant: настройка ботов

```bash
# Telegram (β-9, 2026-05-25): теперь ГЛОБАЛЬНЫЙ — один на всю инсталляцию, без --tenant-id!
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://prod.host --webhook-secret=<секрет>

# MAX (платформа Дзен): пока per-tenant
docker compose exec backend bun run setup:max-bot \
  -- --token=$MAX_TOKEN --tenant-id=$ORG_ID --public-host-url=https://prod.host --webhook-secret=<секрет>
```

⚠️ В старых рефлексиях `setup-telegram-bot` мог упоминаться с `--tenant-id` — **это устарело с β-9**.

---

### Шаг 11 — Рестарт после ENV / кода

```bash
# Поднять / пересоздать с новым образом (миграция уже отработала в Шаге 4):
docker compose up -d --build

# Только подхватить новый .env (без пересборки кода):
docker compose up -d --force-recreate backend

# Если worker'ы вынесены в отдельный сервис (см. ниже) — рестарт его тоже:
# docker compose up -d --force-recreate worker
```

⚠️ В текущем `docker-compose.yml` **backend и BullMQ-воркеры — один контейнер** (worker'ы in-process по `backend/src/workers/main.ts`, который тоже грузится в HTTP-приложение). Один рестарт `backend` подхватывает и новые REST/WS-роуты, и новые BullMQ-очереди, и новые `@Cron`'ы.

Если когда-нибудь будет добавлен отдельный сервис `worker` — рестарт строго оба, иначе новые очереди не подцепятся.

---

### Шаг 12 — Smoke-проверка

```bash
# Health endpoints (изнутри compose-сети nginx → backend):
curl https://prod.host/health
curl https://prod.host/api/docs                  # Swagger UI

# Или напрямую к контейнеру (если nginx ещё не настроен):
docker compose exec backend wget -qO- http://127.0.0.1:3000/health
docker compose exec backend wget -qO- http://127.0.0.1:3000/health/ready
```

В Swagger должны появиться разделы: **tracker, projects, issues, cycles, intake, webhooks, comments, labels, attachments, relations, team-templates, chat-v2, conversational, curation, decisions, events, ideas, insights, knowledge-clone, clones, probe, regulations, vendors, calendar (events)**.

**Sprints (2026-05-27 / расширено 2026-05-28).** В Swagger под тегом `tracker / cycles` должны появиться `GET /api/v1/cycles/:id/dashboard`, `POST /api/v1/cycles/:id/start-meeting`, `GET /api/v1/cycles/:id/hints`, `GET /api/v1/cycles/:id/review`, `POST /api/v1/cycles/:id/review/regenerate`; под тегом `tracker / sprint-hints` — `POST /api/v1/sprint-hints/:id/{dismiss,resolve}`; под тегом `tracker / sprints` (2026-05-28) — `GET /api/v1/sprints` (master-detail список с фильтрами) и `POST /api/v1/sprints/quick-create` (атомарное создание Project+Cycle); под тегом `vendors` — `POST /api/v1/vendors`, `PATCH /api/v1/vendors/:id`, `DELETE /api/v1/vendors/:id`. Smoke модели и базового потока:

```bash
docker compose exec backend bun run scripts/smoke-sprints.ts
```

(создаёт временный Department + Project с departmentId scope + Cycle + 3 Issue + Meeting(sprint_review) + SprintHint, проверяет dismiss; 2026-05-28: расширен — также проверяет list-фильтр scope=department, inline-create Vendor, quick-create scope=vendor с cleanup. Чистит за собой).

```bash
curl https://prod.host/metrics | grep -E 'z_voice_ws|z_mail_inbound|z_llm_cache|z_prompt_injection|bullmq_'
```

Должны быть `bullmq_*` метрики под новые очереди: `probe-*, conversational-send, chat-v2-cleanup, card-stale-detector, idea-clusterer, insight-clusterer, knowledge-clone-rebuild, skill-profile-*, executable-persona-build, skill-manager-digest, tracker.webhook-delivery`.

**Telegram через прокси (2026-05-26).** После Шага 6.11 проверь, что:

```bash
# Метрики прокси — outcome должен быть ok после первого outbound:
curl https://prod.host/metrics | grep -E 'telegram_proxy_request_total|telegram_proxy_health_check_total'

# Health-cron: после ~30с в Redis должен появиться ключ tg:proxy:healthy='1'.
docker compose exec backend bun -e 'import("ioredis").then(m=>{const r=new m.default(process.env.REDIS_URL);r.get("tg:proxy:healthy").then(v=>{console.log("tg:proxy:healthy=",v);process.exit(0)})})'
```

В админке `/admin/system/telegram-bot` — карточка «Прокси telegram.crossmark.ru»
должна быть зелёной (бот зарегистрирован, healthy=true). Кнопка
«Проверить прокси сейчас» возвращает HTTP 200 и < 1000 мс.

```bash
# Hot-reload Prometheus alerts (если изменялись правила, и Prometheus в этом же compose):
docker compose exec prometheus kill -HUP 1
```

---

## 📦 Сценарий B: Чистый выкат с нуля

> Используй когда: данные в БД можно потерять (beta/staging), ИЛИ postgres-volume несовместим с composite-образом `z-postgres-age-pgvector:pg16` (например, был унаследован старый `pgvector/pgvector:pg17`). На чистой БД **не нужны** patch/backfill/migrate-скрипты (Шаги 6, 8, 9) — нечего бэкфилить.

### B.1 — Down + wipe volumes

```bash
cd /home/docker/z         # путь к docker-compose.yml на проде
docker compose down -v    # -v удаляет volumes: z_z-postgres-data, z_z-redis-data
```

⚠️ **Безвозвратно стирает БД и redis-AOF.** Если есть хоть какие-то данные, которые жалко — сначала `Шаг 0.2` бэкап.

### B.2 — Pull + ENV

```bash
git pull origin dev
set -a && source .env && set +a   # подтянуть POSTGRES_USER/DB в shell
```

**Обязательный минимум в `.env`:**
```bash
POSTGRES_DB=z_main
POSTGRES_USER=z_app
POSTGRES_PASSWORD=<openssl rand -hex 16>
DATABASE_URL=postgresql://z_app:<тот_же_пароль>@postgres:5432/z_main

JWT_SESSION_SECRET=<openssl rand -hex 32>
JWT_DEEP_LINK_SECRET=<openssl rand -hex 32>
WEBHOOK_SECRETS_ENCRYPTION_KEY=<openssl rand -base64 32>
IP_HASH_DAILY_SALT=<openssl rand -hex 16>

LIVEKIT_API_KEY=<совпадает с infra/livekit/livekit.yaml>
LIVEKIT_API_SECRET=<совпадает>
LIVEKIT_WEBHOOK_API_KEY=<тот же>
LIVEKIT_WEBHOOK_API_SECRET=<тот же>

# NEXT_PUBLIC_* — вшиваются в frontend-бандл на сборке
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.tld
NEXT_PUBLIC_BACKEND_URL=https://api.your-domain.tld
NEXT_PUBLIC_LIVEKIT_URL=wss://media.your-domain.tld
NEXT_PUBLIC_FRONTEND_URL=https://app.your-domain.tld

# Первый супер-админ (создаётся через bun prisma/seed.ts в Шаге B.6)
ADMIN_BOOTSTRAP_EMAIL=<твой email>
ADMIN_BOOTSTRAP_NAME=Admin

# Все Kill-switch'и оставь false:
BITEMPORAL_ENABLED=false
BITEMPORAL_SUPERSEDE_ENABLED=false
CLONE_V2_ENABLED=false                   # на чистой БД сразу можно true (нет existing pol'ей)
SPECIALISTS_COMBINED_ENABLED=false
COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM=false
DATACLASS_POLICY_ENFORCEMENT=shadow

# Опциональное (если используешь Telegram-бот):
KORA_BOT_USERNAME=kora_bot
```

### B.3 — Sanity-check + build

```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть 0 / 0
docker compose build                                     # 5-15 мин на холодную
```

### B.4 — Up (postgres → init.sql → migrate → backend → frontend)

```bash
docker compose up -d
docker compose logs -f migrate
# Жди:
#   "✓ postgres-init.sql выполнен"
#   "=== apply-postgres-init DONE ==="
# затем Ctrl+C
```

### B.5 — Проверка composite-образа PG + extensions

```bash
docker compose ps postgres
# IMAGE должно быть: z-postgres-age-pgvector:pg16

docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT extname, extversion FROM pg_extension WHERE extname IN ('age','vector');"
# 2 строки: age 1.5+, vector 0.8+

docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT name FROM ag_catalog.ag_graph WHERE name = 'z_graph';"
# 1 строка: z_graph
```

Если postgres image не composite — пересобери и форсируй recreate:
```bash
docker compose build postgres
docker compose up -d --force-recreate postgres
```

### B.6 — Бутстрап первого супер-админа

```bash
docker compose run --rm backend bun prisma/seed.ts
# Создаст User по ADMIN_BOOTSTRAP_EMAIL + Org "default" + role=admin.
```

### B.7 — Базовый каркас LLM (без него AI-фичи не работают)

```bash
docker compose exec backend bun run scripts/seed-default-llm-providers-and-models.ts
docker compose exec backend bun run scripts/seed-llm-model-prices.ts
docker compose exec backend bun run scripts/seed-prompt-templates.ts
docker compose exec backend bun run scripts/seed-llm-task-routes-default.ts
```

### B.8 — Прочие seed'ы (тарифы, календарь, шаблоны, домены, бейджи, Telegram)

```bash
docker compose exec backend bun run scripts/seed-entitlements.ts
docker compose exec backend bun run scripts/seed-retention-policies.ts
docker compose exec backend bun run scripts/seed-holiday-calendar-ru-2026.ts
docker compose exec backend bun run scripts/seed-team-templates.ts
docker compose exec backend bun run scripts/seed-functional-domains.ts
docker compose exec backend bun run scripts/seed-admin-settings.ts
docker compose exec backend bun run scripts/seed-admin-setting-daily-digest.ts
docker compose exec backend bun run scripts/seed-badges.ts
docker compose exec backend bun run scripts/seed-global-channels.ts
```

### B.9 — LLM TaskRoutes для всех новых taskType (35 скриптов одним циклом)

```bash
for s in phase-B phase-C phase-D phase-E regulations knowledge-clone knowledge-core \
         decisions insights ideas-and-probe skill-and-clone skill-concept chat-v2 \
         recognition helpfulness beta-8 beta-8-1 beta-8-2 beta-8-3 axis-classify \
         brand-voice company-foundation concierge cross-functional experiments \
         process-template role-map orchestrator proactive tracker-phase3 \
         tracker-phase3-c tracker-phase4-telegram feedback-cluster clone-v2 \
         specialists-combined dialog-layer temporal kie-grsai-ab; do
  echo "=== seed-llm-task-routes-$s ==="
  docker compose exec backend bun run scripts/seed-llm-task-routes-$s.ts
done

# Глобальный primary: DeepSeek-V4-Pro
docker compose exec backend bun run scripts/seed-llm-default-primary-deepseek-pro.ts
```

### B.10 — Setup глобального Telegram-бота (если используешь)

```bash
docker compose exec backend bun run setup:telegram-bot \
  -- --token=$TG_TOKEN --public-host-url=https://prod.host --webhook-secret=<секрет>
```

### B.11 — Smoke

```bash
curl https://prod.host/health
curl https://prod.host/health/ready
# {"ok":true,"checks":{"postgres":"ok","redis":"ok","livekit":"ok"}}

curl -s https://prod.host/api/docs > /dev/null && echo "Swagger OK"
curl -s https://prod.host/metrics | grep -E 'bullmq_(probe|conversational|chat-v2|knowledge-clone|skill|tracker)' | head
```

### Чего в Сценарии B НЕ делать

- ❌ Шаг 3 (PRE-MIGRATION gate) — нет legacy Meeting с NULL tenantId.
- ❌ Шаг 6 (patch-*) — нечего патчить, БД пустая. Исключение: `patch-migrate-clone-access.ts` безопасно запустить (no-op, нет existing Appointment), если планируешь сразу `CLONE_V2_ENABLED=true`.
- ❌ Шаг 8 (backfill-*) — нечего бэкфилить.
- ❌ Шаг 9 (migrate-telegram-channels-to-global / migrate-task-to-issue) — нет legacy данных.

---

## 🆘 Troubleshooting

### `apply-prod-deploy.ts` упал на конкретном скрипте

Запусти с `--continue-on-fail` — увидишь полный список упавших. Идемпотентные скрипты безопасно перезапустить, уже сделанные пройдут как `skipped`:

```bash
docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail
```

### `Cron Job with the given name (...) already exists`

9 скриптов используют `NestFactory(AppModule)` и поднимают весь Nest — это может конфликтовать с уже запущенными `@Cron`-декораторами. Известный технический долг, скрипты:

- `seed-global-channels.ts`
- `migrate-telegram-channels-to-global.ts` / `migrate-telegram-channels-back.ts`
- `patch-backfill-dataclass-audit.ts`
- `backfill-commitment-due-dates.ts`
- `backfill-task-assignee-userid.ts`
- `person-knowledge-embeddings-backfill.ts`
- `skill-trait-concepts-backfill.ts`
- `e2e-feedback-clustering.ts`

Обходные пути:
1. **Запускать в одноразовом контейнере** (где Nest ещё не работает с @Cron):
   ```bash
   docker compose run --rm backend bun run scripts/seed-global-channels.ts
   ```
   НЕ через `exec backend` (там Nest уже инициализирован с cron'ами в основном процессе).
2. **Долгосрочно** — переписать эти скрипты на `createPrismaClient()` из `_lib/prisma`, без `NestFactory`. См. правило в `CLAUDE.md` → Триггер 1 → Шаг 5.

### `migrate` exit 1 при `docker compose up`

Смотри логи:
```bash
docker compose logs --tail=100 migrate
```

Типичные причины:
| Лог | Что делать |
|---|---|
| `extension "age" is not available` | Postgres-контейнер НЕ composite-образ. Проверь `docker compose ps postgres` → IMAGE должно быть `z-postgres-age-pgvector:pg16`. Если нет — `docker compose build postgres && docker compose up -d --force-recreate postgres`. |
| `database files are incompatible with server` | Старый volume (от другой версии PG) и новый образ несовместимы. Только Сценарий B (wipe). |
| `Meeting.tenantId NOT NULL violation` | Не запустил GATE (Шаг 6 в Сценарии A). Сначала backfill, потом retry migrate. |
| `Cannot find module '../src/...'` | Старый backend-образ без `src/` в runner. Пересобери: `docker compose build backend && docker compose up -d --force-recreate backend`. |

### `bun install` падает на `cdn.npmmirror.com - 404` в docker build

Lockfile прибит к китайскому зеркалу. Проверь:
```bash
grep -c npmmirror backend/bun.lock frontend/bun.lock     # должно быть 0 и 0
```
Если ≠ 0 — что-то пошло не так с pull или последний коммит откатил фикс. Перегенерация:
```bash
cd backend && rm bun.lock && bun install && cd ..
cd frontend && rm bun.lock && bun install && cd ..
git diff bun.lock                              # проверь что нет npmmirror
git add backend/bun.lock frontend/bun.lock && git commit -m "fix(deploy): regen bun.lock"
```

### Backend не стартует после `docker compose up`

```bash
docker compose logs --tail=200 backend
```

Чаще всего:
- **Невалидный ENV** (zod fail): в логе будет «Невалидная конфигурация ENV» + поле. Открой `.env`, исправь, `docker compose up -d --force-recreate backend`.
- **DATABASE_URL** не дозвонился до postgres: проверь `docker compose ps postgres` — должен быть healthy. URL внутри compose: `postgres:5432`, не `localhost`.

### LiveKit `fail` в `/health/ready`

```json
{"checks":{"livekit":"fail:Unable to connect..."}}
```

`LIVEKIT_URL` из `.env` (внутри backend-контейнера) не дозвонился до media-сервера. Проверь:
- `LIVEKIT_URL` в `.env` указывает на доступный domain/IP (НЕ `localhost` если media в другом контейнере/сети).
- Media-сервер запущен и порт 7880/443 доступен.
- `LIVEKIT_API_KEY/SECRET` совпадают с `infra/livekit/livekit.yaml` на media-сервере.

### Откатить выкат

```bash
# 1. Откатить код
git log --oneline -10
git reset --hard <previous_commit>
# 2. Откатить БД из бэкапа
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists < backups/z_main_<TIMESTAMP>.dump
# 3. Поднять с откатанным кодом
docker compose up -d --build
```

---

## ⚠️ Особо опасные операции (требуют согласования владельца)

| Операция | Чем опасна | Защита |
|---|---|---|
| `prisma:push` + `--accept-data-loss` (внутри `migrate`-сервиса) | DROP `Transcript.rawIndexS3Url` — данные исчезнут | Данные перенесены в `TranscriptTrack` (Wave 5). Проверить отсутствие внешних потребителей S3-ключа. |
| Запуск `migrate` без AGE в postgres-образе | Падение с `extension "age" is not available` | Шаг 0.1 |
| `patch-mass-migrate-to-deepseek-pro.ts --update-existing` | Перезатирает primary провайдер у НЕ-admin-edited LlmTaskRoute | Сначала `--dry-run`. `editedByAdmin` защищён. |
| `seed-llm-default-primary-deepseek-pro.ts --update-existing` | Меняет primary у ВСЕХ taskType | `editedByAdmin` НЕ трогается. ТОЛЬКО для сброса ручных настроек. |
| `migrate-task-to-issue --apply` | Конвертирует legacy Task → Issue | Идемпотентен. Сначала dry-run. Task не удаляется. |
| `backfill-task-assignee-userid.ts` | В шапке файла «НЕ ЗАПУСКАТЬ НА ПРОДЕ без согласования» | Пропустить. |
| `patch-rollback-to-deepseek-flash.ts --update-existing` | Массовый откат 26 LlmTaskRoute pro→flash. Не плановая | Защищён флагом `--update-existing`; `editedByAdmin=true` не трогает. Сначала `--dry-run`. |
| `CLONE_V2_ENABLED=true` без `patch-migrate-clone-access.ts` | У всех пользователей пропадёт доступ к клонам | См. Шаг 6.10 + 6.11. Порядок: миграция грантов → сверка в `/admin/clones` → ENV → `force-recreate backend`. |

---

## 📂 Архив применённых

_(пусто — это первый накопительный документ; после первого выката переносим блок «Накоплено к выкату» сюда с датой)_

---

## 🔄 Правила поддержки файла

### Жёсткие правила формата команд

1. **Все команды — через `docker compose`.** Никаких `cd backend && bun run ...` на хосте. Z в проде целиком в контейнерах.
2. **Patch/seed/backfill/migrate-скрипты** — через `docker compose exec backend bun run scripts/<file>.ts` (backend уже запущен) ИЛИ `docker compose run --rm backend bun run scripts/<file>.ts` (одноразовый контейнер, если backend ещё не стартовал — например, в Шаге 3).
3. **Schema/postgres-init** — автоматически через `migrate`-сервис при `docker compose up`. Вручную: `docker compose run --rm backend bun run apply-postgres-init`.
4. **Бэкап БД** — только через `docker compose exec -T postgres pg_dump`, никаких локальных `pg_dump` к ip-сервера.
5. **ENV** — правка корневого `.env` + `docker compose up -d --force-recreate backend` (для `NEXT_PUBLIC_*` — `--build frontend`).
6. **Restart** — `docker compose up -d --build backend` (новый код) или `docker compose up -d --force-recreate backend` (новый ENV).

### Когда обновлять

После каждого `git push` в `dev`/`main`, если push содержит:

| Что изменилось | Куда писать в разделе «Накоплено к выкату» |
|---|---|
| `backend/prisma/schema.prisma` (новая модель / nullable→NOT NULL / drop / новый enum) | Шаг 4 |
| `backend/scripts/postgres-init.sql` (HNSW / GIN / partial unique / extension) | Шаг 5 |
| Новый файл `backend/scripts/patch-*.ts` | Шаг 6 |
| Новый файл `backend/scripts/seed-*.ts` | Шаг 7 |
| Новый файл `backend/scripts/backfill-*.ts` | Шаг 8 |
| Новый файл `backend/scripts/migrate-*.ts` | Шаг 9 |
| Новый файл `backend/scripts/setup-*.ts` | Шаг 10 |
| `backend/src/common/config/env.schema.ts` (новая ENV) | Шаг 1 |
| Новая модель worker / cron / BullMQ-очередь | Шаг 12 (smoke: добавить в grep по `bullmq_`) |
| Новый REST/Swagger раздел | Шаг 12 (smoke: добавить в список разделов Swagger) |
| Включение нового feature flag по умолчанию | Шаг 1 («Kill-switch'и») |
| Изменения в `docker-compose.yml` (новые сервисы / порты / depends_on) | Pre-flight 0 или Шаг 11 |
| Изменения в `Dockerfile` / `bunfig.toml` / `bun.lock` | Шаг 2 |

### Как обновлять

1. После `git push` запусти у себя:
   ```bash
   git show --stat HEAD
   git diff HEAD~N --name-only | grep -E '(prisma/schema|scripts/(seed|patch|migrate|backfill|setup|smoke)|postgres-init\.sql|env\.schema\.ts|Dockerfile|bunfig|docker-compose)'
   ```
2. Для каждого попавшего файла добавь строчку в соответствующий шаг — **обязательно с префиксом `docker compose exec backend …`** (или `run --rm backend …` для pre-up сценариев).
3. Если переименовываешь существующий скрипт или меняешь поведение — **обнови запись inline**, не дублируй.
4. Если запись становится неактуальной (фича откатили) — удали из «Накоплено к выкату».

### Когда переносить в архив

После триггера «выкат прошёл / прод обновили / выкатили» — целиком копируешь блок «🚨 Накоплено к выкату» в новый подраздел `## 📂 Архив применённых` → `### 2026-MM-DD — выкат N` с пометкой кто выкатил и какие были инциденты. Раздел «Накоплено к выкату» обнуляется (Pre-flight + пустой Шаг 1..12).

### Связь с рефлексией

При записи рефлексии в `second-brain/05_история/` всегда ссылайся на этот файл («prod-инструкция обновлена → см. `docs/operations/prod-deploy-log.md`»), вместо того чтобы дублировать команды в рефлексии.
