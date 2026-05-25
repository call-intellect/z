---
type: analysis
status: ready
feature: admin-redesign
date: 2026-05-25
---

# Анализ: Редизайн глобальной админки Z-Admin

## Что хотим сделать

Перестроить главную админку (`frontend/app/(authenticated)/admin/*`) из плоской навигации с 18 пунктами без вкладок — в **двухуровневый сайдбар + модульные разделы с вкладками**, отделить аналитику от управления, и вытащить ~140 ENV-переменных (тюнинг-knobs, лимиты, кроны, пороги, шаблоны) в БД с UI-редактированием. Цель — чтобы оператор Z мог управлять продуктом без redeploy и без программиста.

## Зачем (цель и ценность)

**Сейчас:** оператор Z (super_admin) может только смотреть аналитику и переключать модели/тарифы. Любая правка порога Knowledge-Core, retention, лимита пользователя, email-шаблона, расписания крона, фиче-флага требует:
1. Открыть код / `env.schema.ts`.
2. Запросить программиста.
3. Дождаться деплоя.

**После редизайна:** всё, что не секрет — крутится из UI. У оператора есть «пульс» (живой главный экран с графиками), журнал собственных действий (для compliance), глобальный поиск, ручной запуск кронов, доступ к DLQ воркеров. Информационная архитектура масштабируется до 30+ разделов без боли.

**Ценность:**
- Снижается фрикция изменения продукта в 10 раз — настройки правит оператор, не разработчик.
- Снижается риск конфигов «забытых в ENV» — всё под audit'ом.
- Поддерживает заявку на «AI-операционный директор + цифровой двойник компании» (см. memory `project_positioning_research_v2`) — продукт должен сам собой управлять, не через ssh.

## Как работает сейчас

Каркас — [AdminShell.tsx](frontend/app/(authenticated)/admin/AdminShell.tsx). Левая колонка — плоский сайдбар из 5 групп / 18 пунктов. Контент справа.

Selection patterns:
- Сайдбар (основная навигация).
- `<Select>` shadcn — period/tier/scope/status.
- Toggle-кнопки в детальных карточках (`24h/7d/30d` — рассинхрон с глобальными `day/week/month`).
- `Input + кнопка «Найти»` — поиск без debounce.
- Confirm-диалог через `useConfirmDialog` — для деструктивных операций.

**Вкладок (`Tabs`) — нет нигде** (грэп `TabsList|TabsTrigger` по `/admin` — ноль матчей).

Backend-инфра уже зрелая:
- `SuperAdminGuard` + `SuperAdminAuditInterceptor` пишут `SuperAdminAccessLog` на каждый запрос.
- `AdminCacheService` (single-process Map, TTL 60s) — кэш на чтение.
- Модули `admin/ai-models`, `admin/prompt-templates`, `admin/llm-routes`, `admin/economics`, `admin/controllers/{experiments,functions,health,orgs,usage,prices}`, `admin/integration-keys`, `admin/recordings-admin`, `admin/meetings-admin` — покрывают экономику, модели, орги, встречи.

**ENV** (`backend/src/common/config/env.schema.ts`) — 1328 строк, ~210 переменных. Из них:
- ~50 — секреты и инфра (`*_SECRET`, `*_API_KEY`, `DATABASE_URL`, `JWT_*`) — остаются.
- ~140 — тюнинг (пороги, лимиты, кроны, фиче-флаги, шаблонные значения) — должны переехать в БД.
- ~20 — гибрид (ENV = дефолт, БД = override).

## Что не так с текущей админкой (аудит-сводка)

Кратко (полный разбор — в чате 2026-05-25):

1. **18 плоских пунктов в сайдбаре** без collapsible / поиска — потолок масштабирования близко.
2. **Нет вкладок** — детальная карточка функции рендерит шапку + цепочку + графики + audit стопкой вниз.
3. **Два «дашборда»**: `/admin` и `/admin/economics`, пересечение очевидно, разделение не объяснено.
4. **Размытая ИА AI-стека**: «Модели агентов», «A/B-эксперименты», «Прайс-карта», «LLM провайдеры», «LLM модели» — 5 пунктов про модели в одной группе, что чем отличается — непонятно без контекста.
5. **`AI-вызовы (legacy)` прямо в навигации** — публичный технический долг.
6. **Рассинхрон периодов** (`day/week/month` глобально vs `24h/7d/30d` в детальных).
7. **Нет sparkline / time-series** на главном экране — только табличные KPI.
8. **Нет глобального поиска** (Cmd+K) по сущностям.
9. **Нет CSV/JSON-экспорта** ни одной таблицы.
10. **Audit-log super_admin не виден в UI** — бэкенд пишет, оператор не может посмотреть.
11. **Защита на клиенте** (`AdminPagePermissionGate`) — бэк защищён `SuperAdminGuard`, но раздача SSR HTML не-super_admin'у — лишний шум.
12. **Кроны и воркеры BullMQ — нет UI** — оператор лезет в Redis CLI.
13. **Knowledge-Core пороги (~40 ENV)** — ядро продукта крутится только через redeploy.
14. **Параллельно два паттерна fetch**: `useAdminQuery` (новый) и `useEffect + useState` (старый, например в `PromptsListClient.tsx`) — техдолг.

## Принципы будущей админки

1. **ENV — только секреты и инфра-адреса.** Остальное в БД, редактируется из UI, перечитывается без рестарта.
2. **Модульный блок вкладок** — стандартный компонент `AdminSection` с URL-driven табами (`?tab=settings`).
3. **Двухуровневый сайдбар.** 8 категорий, collapsible. Активный путь подсвечен на обоих уровнях.
4. **Аналитика и управление — разные экраны.** «Сколько потратили на функцию» и «Какую модель использовать для функции» — два разных раздела, не один.
5. **Audit-first.** Любая правка super_admin → в `SuperAdminAccessLog` + видна в UI на вкладке «История» каждого раздела.
6. **Cmd+K-палитра** — прыжки между Org / юзером / встречей / функцией / разделом.
7. **Mobile-first для просмотра, desktop для управления.** Сложные формы — только на desktop, аналитика — везде.
8. **Все деструктивные действия — двойное подтверждение** + audit-запись с причиной (текстовое поле).

## Новая информационная архитектура (8 категорий)

### 1. Пульс компании (Operations)
| Раздел | URL | Вкладки |
|---|---|---|
| Дашборд | `/admin` | Сутки / Неделя / Месяц |
| Здоровье системы | `/admin/health` | Очереди / БД / Эмбеддинги / Воркеры / S3 / LiveKit |
| Инциденты | `/admin/incidents` *(новый)* | Сейчас горит / История 7д / Правила алертов |
| Журнал super_admin | `/admin/audit` *(новый)* | Лента / Фильтр по admin / Фильтр по сущности |

### 2. Аналитика (read-only)
| Раздел | URL | Вкладки |
|---|---|---|
| Org и пользователи | `/admin/analytics/orgs` | Активность / Рост / Retention / Когорты |
| Функции LLM | `/admin/analytics/functions` | Расход / Fail rate / Latency / По Org |
| Юнит-экономика | `/admin/analytics/economics` | Доход / Расход / Маржа / Прогноз / По Org |
| Встречи и записи | `/admin/analytics/meetings` | Длительность / Типы встреч / Участники / Retention |
| Knowledge-Core | `/admin/analytics/knowledge` *(новый)* | Блоки / Темы / Графы / Рост |
| Concierge / AI-чат | `/admin/analytics/concierge` *(новый)* | Запросы / No-answer / Top queries / Feedback |

### 3. AI и модели (управление LLM-стеком)
| Раздел | URL | Вкладки |
|---|---|---|
| Роутинг моделей | `/admin/ai/routing` | Цепочка / Метрики / История переключений / A/B |
| Каталог LLM | `/admin/ai/catalog` | Провайдеры / Модели / Цены / Smoke-тесты |
| Промпты | `/admin/ai/prompts` | Список / Версии / A/B / Feedback |
| Knowledge-Core настройки | `/admin/ai/knowledge-core` *(новый)* | Distill / Entity / Theme / Idea / Insight / Skill / Persona |
| Эмбеддинги | `/admin/ai/embeddings` *(новый)* | Модель / Chunking / Batch / Реиндексация |

### 4. Тенанты (Org)
| Раздел | URL | Вкладки |
|---|---|---|
| Список Org | `/admin/orgs` | Активные / Замороженные / Удалённые |
| Карточка Org | `/admin/orgs/[id]` | Обзор / Тариф и лимиты / Участники / Источники / Экономика / Аудит / Опасная зона |
| Тарифы (планы продукта) | `/admin/orgs/plans` *(новый)* | Список / Фичи плана / Лимиты плана / История изменений |
| Entitlements (overrides) | `/admin/orgs/entitlements` *(новый)* | По Org / По фиче / Истекающие |

### 5. Контент продукта (lookup-таблицы)
| Раздел | URL | Вкладки |
|---|---|---|
| Типы встреч | `/admin/content/meeting-types` *(новый)* | Список / Промпты под тип / Шаблон отчёта |
| Email-шаблоны | `/admin/content/emails` *(новый)* | Список / Превью / История |
| Системные сообщения | `/admin/content/system-messages` *(новый)* | Баннеры / Maintenance / Алерты пользователю |
| Глобальные каналы | `/admin/content/global-channels` *(новый, заменяет seed-скрипт)* | Список / Подписки / Статистика |
| Глоссарий и copy-strings | `/admin/content/copy` *(новый)* | Термины / UI-строки / История |

### 6. Каналы и интеграции
| Раздел | URL | Вкладки |
|---|---|---|
| Conversational боты | `/admin/integrations/bots` | Telegram / Max / Email-inbox |
| Webhook subscriptions | `/admin/integrations/webhooks` | Активные / История доставок / DLQ |
| Integration keys | `/admin/integrations/keys` | Ключи / Скоупы / Использование |
| LiveKit | `/admin/integrations/livekit` *(новый)* | SFU / Egress / TURN / Переключение |

### 7. Записи и медиа
| Раздел | URL | Вкладки |
|---|---|---|
| Все встречи | `/admin/media/meetings` | Активные / Завершённые / С AI-отчётом |
| Истекающие записи | `/admin/media/expiring` | Скоро / Просрочены / Опасная зона |
| Retention | `/admin/media/retention` *(новый)* | По типу данных / Превью удаления / История |
| S3 storage | `/admin/media/storage` *(новый)* | Бакеты / Статистика / Переключение провайдера |

### 8. Платформа (низкий уровень)
| Раздел | URL | Вкладки |
|---|---|---|
| Кроны | `/admin/platform/crons` *(новый)* | Список / Расписания / Последние запуски / Ручной запуск |
| Воркеры BullMQ | `/admin/platform/workers` *(новый)* | Очереди / Active / Failed (DLQ) / Retry / Pause |
| Лимиты и квоты | `/admin/platform/limits` *(новый)* | Глобальные / По тарифу / Override по Org |
| Feature flags | `/admin/platform/flags` *(новый)* | Список / По Org / История переключений |
| Безопасность | `/admin/platform/security` *(новый)* | Argon / JWT TTL / IP-salt / Rotation |
| Бэкапы и миграции | `/admin/platform/maintenance` *(новый)* | Статус / Ручной запуск / История |

**Итого:** 36 разделов в 8 категориях. Вместо 18 плоских пунктов — структурированная двухуровневая навигация.

## Модульный блок вкладок (`AdminSection`)

Один переиспользуемый компонент:

```
┌─ AdminSection ──────────────────────────────────────┐
│  Хлебные крошки  ·  Заголовок раздела               │
│  ─────────────────────────────────────────────────  │
│  [Обзор] [Настройки] [История] [Эксперименты] [...] │
│  ─────────────────────────────────────────────────  │
│                                                     │
│       контент активной вкладки                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Технически:**
- Базируется на `radix-ui/tabs` (уже в проекте).
- Активная вкладка — в URL `?tab=settings`, чтобы давать ссылку.
- Lazy-render: вкладка монтируется только при первом открытии.
- Стандартный набор «по умолчанию» (не все обязательны):

| Вкладка | Что показывает |
|---|---|
| Обзор | KPI карточки + 1–2 sparkline-графика + последние действия |
| Настройки | Форма с Zod-валидацией, save/cancel, дифф «было/стало» |
| Аналитика | Таблицы и графики (только read) |
| История | Audit-log изменений этого раздела |
| Эксперименты | A/B, если применимо |
| Опасная зона | Деструктивные действия с двойным подтверждением + текст-поле «причина» |

**Файлы:**
- `frontend/ui/components/admin/AdminSection.tsx` — обёртка
- `frontend/ui/components/admin/AdminTabs.tsx` — табы (URL-driven)
- `frontend/ui/components/admin/AdminBreadcrumbs.tsx`
- `frontend/ui/components/admin/AdminDangerZone.tsx` — стандартный блок «опасной зоны»

## Миграция ENV → БД

### Должны остаться в ENV (~50, секреты и инфра)
`DATABASE_URL`, `REDIS_URL`, `JWT_SESSION_SECRET`, `JWT_DEEP_LINK_SECRET`, `*_API_KEY`, `*_API_SECRET`, `LIVEKIT_*` (ключи), `CRYPTO_MASTER_KEY`, `COOKIE_DOMAIN`, `PUBLIC_FRONTEND_URL`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `IP_HASH_DAILY_SALT`, `INGEST_INTERNAL_TOKEN`, `ADMIN_BOOTSTRAP_EMAIL`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `TURN_PASSWORD`.

### Переезжают в БД (~140)
Сгруппировано по разделам админки:

| Группа ENV | Кол-во | Куда в админке |
|---|---|---|
| `MAX_*` (лимиты пользователя/Org) | ~30 | Платформа → Лимиты и квоты + Тарифы |
| `*_RETENTION_DAYS` | ~7 | Записи и медиа → Retention |
| `*_CRON` (расписания) | ~25 | Платформа → Кроны |
| Knowledge-Core пороги (`DISTILL_*`, `ENTITY_*`, `THEME_*`, `IDEA_*`, `INSIGHT_*`, `SKILL_*`, `PERSONA_*`, `BLOCK_*`, `LINK_*`, `CURATION_*`) | ~40 | AI → Knowledge-Core настройки |
| Эмбеддинги (`EMBEDDING_*`) | ~7 | AI → Эмбеддинги |
| Conversational (`CONVERSATIONAL_*`, `TELEGRAM_*`, `MAX_BOT_*`) | ~15 | Каналы → Боты |
| Webhook (`WEBHOOK_*`) | ~5 | Каналы → Webhook |
| AI-pipeline тюнинг (`PROBE_*`, `ROUTER_*`, `SEARCH_*`, `EXTRACTION_*`, `ANSWER_CACHE_*`, `DIALOG_SUMMARIZER_*`, `CONTEXTUALIZER_*`, `SUMMARIZER_*`) | ~20 | AI → Knowledge-Core настройки |
| Mail-inbox (`MAIL_INBOX_*`, `EMAIL_FETCH_*`) | ~7 | Каналы → Email-inbox |
| Безопасность нон-секретная (`ARGON_*`, `SESSION_TTL_*`, `DEEP_LINK_TTL_*`, `IDLE_MEETING_*`, `MAX_PARTICIPANTS_*`, `MAX_MEETING_DURATION_*`, `ADMIN_SESSION_TTL_*`) | ~10 | Платформа → Безопасность |
| Документы (`DOCUMENT_*`) | ~3 | Контент → Источники / Платформа → Лимиты |
| Share/clip/export (`SHARE_*`, `CLIP_*`, `EXPORT_*`) | ~5 | Записи → Retention / Платформа → Лимиты |

### Гибрид (ENV = дефолт, БД = override) (~20)
- `EMBEDDING_MODEL`, `ANTHROPIC_MODEL`, `DEEPSEEK_DEFAULT_MODEL`, `VOX_MODEL` — модели по умолчанию (уже частично перекрываются через `LlmRoute`).
- `OPENAI_BASE_URL`, `DEEPSEEK_BASE_URL`, `ANTHROPIC_PROXY_URL`, `OLLAMA_BASE_URL` — adressа провайдеров (memory `feedback_switchable_endpoints` требует переключаемости).
- `LIVEKIT_API_URL` — адрес SFU (для multi-region в будущем).
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`, `MAIL_FROM_NAME` — SMTP-конфиг.

### Архитектура хранения

Новая таблица в `schema.prisma`:

```prisma
model AdminSetting {
  key         String   @id          // напр. "knowledge.theme.cosine_threshold"
  value       Json                  // полиморфно: number | string | bool | obj
  category    String                // "ai" | "platform" | "content" | ...
  section     String                // "knowledge-core" | "crons" | ...
  schemaHash  String                // ссылка на zod-схему для валидации
  updatedBy   String?               // userId super_admin
  updatedAt   DateTime @updatedAt
  comment     String?               // причина изменения (audit)
  @@index([category, section])
}
```

**Сервис `AdminSettingsService`:**
- `get<T>(key, fallback?: T): Promise<T>` — БД → fallback (ENV) → default.
- `set(key, value, userId, comment)` → обновляет + аудит + инвалидирует кэш + emit'ит event `setting.updated` (для перечитки в воркерах через Redis pub/sub).
- В памяти — LRU-кэш с TTL 30s.

**Интеграция с `TypedConfigService`:**
- Существующий `typed-config.service.ts` дополняется методом `getDynamic<T>(key)` — сначала `AdminSettingsService`, потом ENV-default.
- Все вызовы `config.get('THEME_COSINE_THRESHOLD')` постепенно мигрируют на `config.getDynamic('knowledge.theme.cosine_threshold')`.

## Что добавить, чего сейчас нет (полный список)

| # | Что | Раздел | Сложность |
|---|---|---|---|
| 1 | Двухуровневый сайдбар | каркас | S |
| 2 | `AdminSection` + `AdminTabs` (URL-driven) | каркас | S |
| 3 | Cmd+K-палитра | каркас | M |
| 4 | Журнал super_admin (UI на `SuperAdminAccessLog`) | Пульс | S |
| 5 | Инциденты (DLQ + failed jobs + alert'ы) | Пульс | M |
| 6 | Sparkline-графики на главном экране | Пульс | S (recharts) |
| 7 | Кроны + ручной запуск | Платформа | M |
| 8 | Воркеры BullMQ + DLQ retry/pause | Платформа | M |
| 9 | `AdminSetting` таблица + сервис + интеграция в TypedConfigService | бэкенд | M |
| 10 | UI Knowledge-Core настроек (~40 порогов) | AI | M |
| 11 | UI лимитов / тарифов / Entitlements | Тенанты + Платформа | L |
| 12 | UI Retention | Записи | S |
| 13 | UI Conversational botов | Каналы | M |
| 14 | UI Email-шаблонов с превью | Контент | M |
| 15 | UI типов встреч + шаблонов отчёта | Контент | M |
| 16 | UI системных сообщений / maintenance-баннера | Контент | S |
| 17 | UI Feature flags | Платформа | M |
| 18 | CSV/JSON-экспорт всех таблиц | каркас | S (один хук) |
| 19 | Concierge / AI-чат аналитика | Аналитика | M |
| 20 | Knowledge-Core аналитика (блоки/темы/графы) | Аналитика | M |
| 21 | LiveKit health UI | Каналы | S |
| 22 | S3 storage UI + переключение | Записи | M |
| 23 | Глоссарий / copy-strings в БД | Контент | S |
| 24 | Глобальные каналы в БД (вместо seed) | Контент | S |
| 25 | Дифф «было/стало» на формах настроек | каркас | S |
| 26 | Web-Push админу при alert'ах | Пульс | M |
| 27 | Smoke-test провайдеров с кнопкой «Запустить» | AI | S |

S ≈ 1–2 дня, M ≈ 3–5 дней, L ≈ 1–2 недели.

## Фазы реализации

Поскольку приоритетов между блоками нет — порядок по технической зависимости (нельзя строить дом без фундамента).

### Фаза 0 — Фундамент (каркас + БД)
- [ ] Таблица `AdminSetting` в `schema.prisma` + `bun run prisma:push`
- [ ] `AdminSettingsService` + LRU-кэш + Redis pub/sub на инвалидацию
- [ ] Интеграция в `TypedConfigService.getDynamic()`
- [ ] Компоненты `AdminSection`, `AdminTabs` (URL-driven), `AdminBreadcrumbs`, `AdminDangerZone`
- [ ] Хук `useAdminCsvExport` (один на все таблицы)
- [ ] Cmd+K-палитра (cmdk lib)
- [ ] Двухуровневый сайдбар с collapsible-группами

### Фаза 1 — Пульс компании
- [ ] Новый `/admin` с KPI + sparkline (recharts)
- [ ] `/admin/health` переразложить на вкладки (Очереди / БД / Эмбеддинги / Воркеры / S3 / LiveKit)
- [ ] `/admin/audit` — журнал super_admin на основе `SuperAdminAccessLog`
- [ ] `/admin/incidents` — DLQ + failed jobs + Bull queue health

### Фаза 2 — Аналитика (read-only)
- [ ] Разделить текущие `/admin/usage/*` и `/admin/economics` на чистую аналитику без управления
- [ ] Knowledge-Core аналитика (`/admin/analytics/knowledge`)
- [ ] Concierge / AI-чат аналитика (`/admin/analytics/concierge`)
- [ ] CSV-экспорт всех таблиц

### Фаза 3 — AI и модели
- [ ] `/admin/ai/routing` — переразложить текущие ai-models на вкладки
- [ ] `/admin/ai/catalog` — слить prices/providers/models в одну страницу с вкладками
- [ ] `/admin/ai/prompts` — добавить вкладки к существующей странице
- [ ] **`/admin/ai/knowledge-core`** — UI порогов (мигрировать ~40 ENV)
- [ ] `/admin/ai/embeddings` — UI настроек эмбеддингов
- [ ] Smoke-test кнопка для провайдеров

### Фаза 4 — Тенанты и тарифы
- [ ] `/admin/orgs/[id]` — переразложить на вкладки (Обзор / Тариф / Участники / Источники / Экономика / Аудит / Опасная зона)
- [ ] `/admin/orgs/plans` — глобальные планы продукта
- [ ] `/admin/orgs/entitlements` — overrides по Org
- [ ] Мигрировать `MAX_*` ENV в `AdminSetting`

### Фаза 5 — Контент продукта
- [ ] `/admin/content/meeting-types` (CRUD типов встреч)
- [ ] `/admin/content/emails` (шаблоны писем с превью, мигрировать `mail.templates.ts` → БД)
- [ ] `/admin/content/system-messages` (баннеры / maintenance)
- [ ] `/admin/content/global-channels` (заменить `seed-global-channels.ts`)
- [ ] `/admin/content/copy` (глоссарий + UI-строки)

### Фаза 6 — Каналы и интеграции
- [ ] `/admin/integrations/bots` — Telegram / Max / Email-inbox конфиг
- [ ] `/admin/integrations/webhooks` — расширить текущий `/admin/webhooks` вкладками
- [ ] `/admin/integrations/livekit` — health + переключение

### Фаза 7 — Записи и медиа
- [ ] `/admin/media/retention` — мигрировать `*_RETENTION_DAYS` ENV в UI
- [ ] `/admin/media/storage` — S3 statistics + provider switch
- [ ] `/admin/media/meetings` и `/admin/media/expiring` — переразложить

### Фаза 8 — Платформа
- [ ] **`/admin/platform/crons`** — список всех `@Cron`-джобов (мигрировать `*_CRON` ENV)
- [ ] **`/admin/platform/workers`** — BullMQ queue inspector + retry/pause
- [ ] `/admin/platform/limits` — глобальные лимиты
- [ ] `/admin/platform/flags` — feature flags (заменить boolean ENV)
- [ ] `/admin/platform/security` — Argon / JWT TTL / rotation
- [ ] `/admin/platform/maintenance` — статус, ручные операции

### Фаза 9 — Полировка
- [ ] Web-Push админу при alert'ах
- [ ] Удалить `(legacy)`-страницу `/admin/ai-usage`
- [ ] Унифицировать period-селекторы (`day/week/month` → везде одинаково)
- [ ] Замигрировать оставшиеся `useEffect + useState`-страницы на `useAdminQuery`

## Файлы и модули, которые затронем

### Frontend (новые)
- `frontend/ui/components/admin/AdminSection.tsx`
- `frontend/ui/components/admin/AdminTabs.tsx`
- `frontend/ui/components/admin/AdminBreadcrumbs.tsx`
- `frontend/ui/components/admin/AdminDangerZone.tsx`
- `frontend/ui/components/admin/AdminSparkline.tsx`
- `frontend/ui/components/admin/AdminCommandPalette.tsx`
- `frontend/hooks/useAdminCsvExport.ts`
- `frontend/hooks/useAdminSetting.ts` (read+write `AdminSetting` через API)
- `frontend/app/(authenticated)/admin/audit/*` *(новое)*
- `frontend/app/(authenticated)/admin/incidents/*` *(новое)*
- `frontend/app/(authenticated)/admin/ai/knowledge-core/*` *(новое)*
- `frontend/app/(authenticated)/admin/platform/crons/*` *(новое)*
- `frontend/app/(authenticated)/admin/platform/workers/*` *(новое)*
- `frontend/app/(authenticated)/admin/content/**` *(новое поддерево)*
- ещё ~10 новых разделов

### Frontend (правки)
- [AdminShell.tsx](frontend/app/(authenticated)/admin/AdminShell.tsx) — двухуровневая навигация
- Все существующие `*Client.tsx` — постепенный переход на `AdminSection`/`AdminTabs`
- Унификация `useAdminQuery` (выпилить `useEffect + useState` дубликаты)

### Backend (новые)
- `backend/prisma/schema.prisma` — модели `AdminSetting`, `FeatureFlag`, `EmailTemplate`, `MeetingType`, `SystemMessage`, `RetentionPolicy`, `CronSchedule`
- `backend/src/modules/admin/settings/admin-settings.service.ts`
- `backend/src/modules/admin/settings/admin-settings.controller.ts`
- `backend/src/modules/admin/crons/admin-crons.controller.ts` (список + manual trigger)
- `backend/src/modules/admin/workers/admin-workers.controller.ts` (BullMQ inspector)
- `backend/src/modules/admin/audit/admin-audit.controller.ts` (просмотр `SuperAdminAccessLog`)
- `backend/src/modules/admin/incidents/admin-incidents.controller.ts`
- `backend/src/modules/admin/content/*` (meeting-types, emails, system-messages, global-channels)
- `backend/src/modules/admin/platform/feature-flags.controller.ts`

### Backend (правки)
- [typed-config.service.ts](backend/src/common/config/typed-config.service.ts) — добавить `getDynamic<T>()`
- `env.schema.ts` — пометить ~140 переменных как `@deprecated` после миграции (но не удалять, держать как fallback)
- Все `@Cron(...)` декораторы — заменить на `@Cron(CronSchedule.get('cron.name'))` с динамическим чтением
- Все `config.get('MAX_*')` — заменить на `config.getDynamic('limits.*')`

## Открытые вопросы

_Все вопросы закрыты 2026-05-25 (см. «Решения принятые»). Перешли к ТЗ._

## Решения принятые в ходе обсуждения

- **2026-05-25 — Модульный подход.** Переиспользуемый `AdminSection` + URL-driven вкладками вместо отдельных страниц-роутов под каждый аспект сущности.
- **2026-05-25 — ENV → БД.** Остаются только секреты и инфра-адреса (~50); ~140 тюнинг-переменных переезжают в `AdminSetting` с ENV-fallback на первый старт.
- **2026-05-25 — Разделение аналитики и управления.** Это две разные категории сайдбара. Не смешивать «сколько потратили на функцию» и «какую модель использовать для функции».
- **2026-05-25 — Audit-first.** Каждая правка super_admin → запись в `SuperAdminAccessLog` + видимая в UI вкладка «История» в каждом разделе.
- **2026-05-25 — Порядок реализации.** Приоритетов между блоками нет; диктуется технической зависимостью (Фундамент → Пульс → Аналитика → … → Платформа).
- **2026-05-25 — Перечитка настроек в воркерах.** Redis pub/sub канал `admin:setting:invalidate` + LRU-кэш TTL 30 секунд в каждом процессе. Не ходить в БД на каждый чих (Knowledge-Core воркер читает порог десятки тысяч раз в час).
- **2026-05-25 — Entitlements.** Используем существующий `OrgEntitlement` (`tenantId @unique` + `tier` + `featureOverrides Json` + `quotaOverrides Json` + `notes`) — не плодим параллельную сущность. Дополнительно создаём новую модель `Plan` (глобальный план продукта с `features Json` и `quotas Json`), на которую ссылается `OrgEntitlement.tier`.
- **2026-05-25 — Email-шаблоны.** Handlebars-source в plain text как сейчас, но в БД (`EmailTemplate`), а не в коде. HTML-версия — опциональная колонка `htmlBody`, добавим когда понадобятся маркетинговые письма.
- **2026-05-25 — Кроны через UI.** Гибрид: `@Cron(...)` как bootstrap-дефолт + `SchedulerRegistry.deleteCronJob()/addCronJob()` runtime-override из БД по событию `cron.schedule.updated`. Если БД упала — кроны всё равно работают на дефолтах.
- **2026-05-25 — Audit-причина.** Обязательна (textarea, min 10 символов) только для `severity: high|destructive` (изменение тарифа Org, заморозка/удаление, retention, отключение крона, security-параметры, лимиты затрагивающие >N% юзеров, feature flags в проде). Для `low|medium` — опциональна. Audit-запись `who/when/what` пишется всегда.
- **2026-05-25 — Feature flags scope.** Три уровня: глобальный default → override по Org → rollout по проценту юзеров (`hash(orgId + flagKey) % 100 < rolloutPercent`). MVP реализует первые два; rollout-percent — Фаза 9.
- **2026-05-25 — Cmd+K-палитра.** Клиентский индекс (на mount): разделы админки (36), функции LLM (taskType из `ALL_LLM_TASK_TYPES`), команды-действия, last-opened шорткаты из localStorage. Серверный fuzzy-search (debounce 200ms): Org, пользователи, встречи через `/admin/search?type=...&q=...`. Библиотека — `cmdk`.
- **2026-05-25 — Цветовая система.** Единый accent для всех 8 категорий, без раскраски групп. Различаем категории иконками `lucide-react`. Микро-цвет (приглушённая палитра) — только на бейджах состояния («3 ошибки», «12 новых»).
- **2026-05-25 — Хук-API.** Разделили на два: `useAdminSettingValue(key, fallback)` для чтения (95% использований, минимальный API), `useAdminSettingEditor(key, { schema, requiresReason, defaultValue })` для формы (полный state machine: value/setValue/save/reset/isDirty/isLoading/history/error). Schema — Zod, автогенерирует input по типу (`z.number()` → `<Input type="number">`, `z.enum([...])` → `<Select>`, `z.boolean()` → `<Switch>`).

## Следующий шаг

→ ТЗ: [plans/tz/2026-05-25-admin-redesign-tz.md](plans/tz/2026-05-25-admin-redesign-tz.md) — детальная разбивка по фазам с DoD, файлами, тестами.
