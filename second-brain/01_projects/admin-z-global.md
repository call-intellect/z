---
type: project
status: in_progress
phase: 9
---

# Z-Admin (super_admin консоль) — после редизайна 2026-05-25

> Глобальная админка владельца продукта Z/Кора. Доступ только под `User.isSuperAdmin = true` (отдельно от Membership-ролей Org).
> Реализована поэтапно (Фазы 0–9), источник правды по дизайну — [plans/archive/2026-05-25-admin-redesign-tz.md](plans/archive/2026-05-25-admin-redesign-tz.md).

## Назначение

Дать оператору Z единый интерфейс, в котором можно **«крутить» продукт без редеплоя**:

- Видеть пульс компании (KPI, sparkline, инциденты, журнал super_admin).
- Анализировать использование (по Org, функциям LLM, юнит-экономике, встречам, Knowledge-Core, Concierge).
- Управлять AI-моделями: цепочки primary/secondary/tertiary, A/B, прайс-карта, промпты, пороги Knowledge-Core, эмбеддинги.
- Управлять тенантами и тарифами (планы, entitlement-overrides).
- Управлять контентом продукта (типы встреч, email-шаблоны, system-messages, global-channels, UI-строки).
- Управлять каналами и интеграциями (боты, webhooks, integration keys, LiveKit).
- Управлять записями и медиа (retention, S3 storage).
- Управлять платформой (кроны, BullMQ-воркеры, лимиты, feature flags, безопасность, обслуживание).

Большая часть «крутилок», которые раньше лежали в `.env` (~140 переменных), мигрирована в БД (`AdminSetting`) и редактируется через UI с history и audit. Подробнее — [admin-settings.md](admin-settings.md).

## Доступ

- Поле `User.isSuperAdmin: Boolean @default(false)`.
- Назначается ТОЛЬКО через прямой `UPDATE` в БД: `UPDATE "User" SET "isSuperAdmin" = true WHERE email = ?`.
- UI для назначения super_admin'ов **не предусмотрен** (намеренно — снижает риск эскалации).

### Guard-цепочка

```
CookieAuthGuard → SuperAdminGuard → SuperAdminAuditInterceptor
```

- [SuperAdminGuard](backend/src/modules/auth/guards/super-admin.guard.ts) — `req.user.isSuperAdmin === true`, иначе `403 super_admin_required`.
- [SuperAdminAuditInterceptor](backend/src/modules/admin/super-admin.audit.interceptor.ts) — пишет каждый запрос в `SuperAdminAccessLog` (`reason` обязателен для severity `high`/`destructive`).

## Новая информационная архитектура (8 категорий × 36 разделов)

Каркас — двухуровневый сайдбар [AdminShell.tsx](frontend/app/(admin)/admin/AdminShell.tsx) + [navigation.ts](frontend/app/(admin)/admin/navigation.ts) (единый источник правды по структуре сайдбара и Cmd+K-палитры).

### 1. Пульс
| URL | Раздел |
|---|---|
| `/admin` | Дашборд (KPI + sparkline 30 дней) |
| `/admin/health` | Здоровье системы (очереди / БД / эмбеддинги / воркеры / S3 / LiveKit) |
| `/admin/incidents` | Инциденты (DLQ + failed jobs + правила алертов) |
| `/admin/audit` | Журнал super_admin |

### 2. Аналитика (read-only)
| URL | Раздел |
|---|---|
| `/admin/analytics/orgs` | Org и пользователи |
| `/admin/analytics/functions` | Функции LLM |
| `/admin/analytics/economics` | Юнит-экономика |
| `/admin/analytics/meetings` | Встречи |
| `/admin/analytics/knowledge` | Knowledge-Core |
| `/admin/analytics/concierge` | Concierge и AI-чат |
| `/admin/org/economics` | Экономика моей Org |

Старая страница `/admin/ai-usage` помечена legacy и в Фазе 9 заменена на 308-redirect на `/admin/analytics/functions`.

### 3. AI и модели
| URL | Раздел |
|---|---|
| `/admin/ai/routing` (и legacy `/admin/ai-models`) | Роутинг моделей (цепочка / метрики / история / A/B) |
| `/admin/llm-routes` | Управление роутами LLM |
| `/admin/ai/catalog` | Каталог LLM |
| `/admin/ai/prompts` (и `/admin/prompts`) | Промпты (registry + A/B) |
| `/admin/experiments` | A/B-эксперименты |
| `/admin/ai/knowledge-core` | Knowledge-Core настройки (~40 порогов через `AdminSettingField`) |
| `/admin/ai/embeddings` | Эмбеддинги |

### 4. Тенанты
| URL | Раздел |
|---|---|
| `/admin/orgs` | Список Org |
| `/admin/orgs/plans` | **Тариф** (одна карточка `tier_standard`; 6 ключей `billing.*` через AdminSetting; калькулятор seats; история правок) — 2026-05-31 |
| `/admin/orgs/entitlements` | Entitlements (overrides) |

### 5. Контент продукта
| URL | Раздел |
|---|---|
| `/admin/content/meeting-types` | Типы встреч |
| `/admin/content/emails` | Email-шаблоны (Handlebars + bootstrap-sync) |
| `/admin/content/system-messages` | Системные сообщения |
| `/admin/content/global-channels` | Глобальные каналы |
| `/admin/content/copy` | Глоссарий и UI-строки |

Подробнее — [admin-content.md](admin-content.md).

### 6. Каналы и интеграции
| URL | Раздел |
|---|---|
| `/admin/integrations/bots` | Conversational боты |
| `/admin/system/telegram-bot` | Telegram-бот |
| `/admin/integrations/webhooks` | Webhook subscriptions |
| `/admin/integrations/keys` | Integration keys |
| `/admin/integrations/livekit` | LiveKit |

### 7. Записи и медиа
| URL | Раздел |
|---|---|
| `/admin/media/meetings` | Все встречи |
| `/admin/media/expiring` | Истекающие записи |
| `/admin/media/retention` | Сроки хранения (`RetentionPolicy`) |
| `/admin/media/storage` | S3 хранилище |

### 8. Платформа
| URL | Раздел |
|---|---|
| `/admin/platform/crons` | Кроны (см. [admin-crons.md](admin-crons.md)) |
| `/admin/platform/workers` | Воркеры BullMQ (см. [admin-workers.md](admin-workers.md)) |
| `/admin/platform/limits` | Лимиты и квоты |
| `/admin/platform/flags` | Feature flags |
| `/admin/platform/security` | Безопасность |
| `/admin/platform/maintenance` | Бэкапы и обслуживание |

## Модульный блок вкладок

В каждом разделе используется единая обвязка из [frontend/ui/components/admin/](frontend/ui/components/admin/):

- `AdminSection` — обёртка с хлебными крошками + заголовком + слот для действий + слот для вкладок.
- `AdminTabs` — `radix-ui/tabs` с URL-driven состоянием (`?tab=metrics`), lazy-render.
- `AdminBreadcrumbs` — хлебные крошки.
- `AdminDangerZone` — стандартный блок с двойным подтверждением и обязательной textarea «причина» для severity `high`/`destructive`.
- `AdminSparkline` — `recharts`, минимальный line chart для KPI.
- `AdminSettingField` — универсальное поле, генерируется из Zod-схемы (`z.number()`→Input, `z.enum()`→Select, `z.boolean()`→Switch).
- `AdminSettingHistoryDrawer` — выезжающая панель со списком предыдущих значений настройки.
- `AdminCsvDownloadButton` — CSV-экспорт текущей таблицы.

Хуки — [useAdminQuery](frontend/app/(admin)/admin/useAdminQuery.ts), `useAdminSettingValue`, `useAdminSettingEditor`, `useAdminCsvExport`, `useAdminCommandPalette`.

В Фазе 9 финально мигрированы оставшиеся `useEffect + useState + fetchData` дубликаты ([prompts/PromptsListClient](frontend/app/(admin)/admin/prompts/PromptsListClient.tsx), [ai-models/AiModelsClient](frontend/app/(admin)/admin/ai-models/AiModelsClient.tsx)) — теперь единственный паттерн в админке — `useAdminQuery`.

## ENV → AdminSetting

Механизм описан в [admin-settings.md](admin-settings.md). Кратко:

1. `AdminSetting` хранит значение в БД (`category` + `section` + `key` + `value Json`).
2. `AdminSettingsService` ([backend/src/modules/admin/settings/](backend/src/modules/admin/settings/)) — get/set/list/history, LRU-кэш TTL 30s (для security/retention — 5s).
3. Изменение значения публикует в Redis канал `admin:setting:invalidate` — все HTTP- и worker-процессы сбрасывают LRU за <1s.
4. `TypedConfigService.getDynamic<T>(key, fallbackEnvKey?, default?)` — единая точка чтения. Если в БД нет — ENV-fallback; нет ENV — `default`.
5. Bootstrap-сидинг ([backend/scripts/seed-admin-settings.ts](backend/scripts/seed-admin-settings.ts)) идемпотентно заполняет ~140 ключей из текущих ENV.

**Пример (порог KNN кластеризации тем):**

```ts
// До: const t = config.get('THEME_COSINE_THRESHOLD');
// После:
const t = await config.getDynamic('knowledge.theme.cosine_threshold', 'THEME_COSINE_THRESHOLD', 0.78);
```

В UI: `/admin/ai/knowledge-core` → поле «Порог KNN-кластеризации тем» → значение редактируется через `AdminSettingField` (Zod `z.number().min(0).max(1)`), история через `AdminSettingHistoryDrawer`. Любое сохранение → audit-row + Redis pub/sub → следующий tick `theme-clusterer` уже видит новое значение.

## Audit-first

Все правки super_admin пишутся в `SuperAdminAccessLog` через [SuperAdminAuditInterceptor](backend/src/modules/admin/super-admin.audit.interceptor.ts). Колонка `reason String?` обязательна для severity `high` / `destructive` (физическое удаление Org, переключение primary LLM, очистка очереди).

UI журнала — `/admin/audit` — фильтры по `adminId` / `entity` / `from`/`to`, прямые ссылки на затронутые сущности.

## Cmd+K-палитра

[AdminCommandPalette.tsx](frontend/ui/components/admin/AdminCommandPalette.tsx) — `cmdk`, секции:

- **Разделы** — клиентский индекс из `ADMIN_NAV_FLAT` (см. [navigation.ts](frontend/app/(admin)/admin/navigation.ts)).
- **Действия** — частые операции (Refresh кэша, Очистить DLQ, …).
- **Org / Юзеры / Встречи** — server-side через `/admin/search` (debounce 200ms).

Открытие — `Cmd+K`/`Ctrl+K`. Открывается на любой странице админки.

## Связанные документы

- [admin-settings.md](admin-settings.md) — AdminSetting / AdminSettingsService / TypedConfigService.getDynamic.
- [admin-crons.md](admin-crons.md) — `CronManagerService` + `CronSchedule` UI.
- [admin-workers.md](admin-workers.md) — BullMQ-инспектор (retry/pause/resume/DLQ).
- [admin-content.md](admin-content.md) — типы встреч / email-шаблоны / system-messages / global-channels / copy-strings.
- [admin-org-knowledge-core.md](admin-org-knowledge-core.md) — Org-Admin (для owner Org, отдельный шелл).
- [llm-router.md](llm-router.md) — A/B-эксперименты, prices, dataClass-routing.
- [tariffs-and-entitlements.md](tariffs-and-entitlements.md) — управление tier через Z-Admin.
- [api-layer.md](api-layer.md) — раздел «Admin (Z-Admin) — новые эндпоинты Фаз 0-9» с полным списком префиксов.

## История

- **Фаза 0** — каркас + БД (`AdminSetting`, `Plan`, `FeatureFlag`, `EmailTemplate`, `MeetingType`, `SystemMessage`, `RetentionPolicy`, `CronSchedule`, `CronRunHistory` + `AdminSettingHistory`).
- **Фаза 1** — Пульс (новый `/admin`, `/admin/health`, `/admin/audit`, `/admin/incidents`).
- **Фаза 2** — Аналитика (перенос `/admin/usage/*` → `/admin/analytics/*`, CSV-экспорт, новые `/admin/analytics/knowledge` и `/admin/analytics/concierge`).
- **Фаза 3** — AI и модели (`/admin/ai/routing`, `/admin/ai/catalog`, `/admin/ai/prompts`, `/admin/ai/knowledge-core`, `/admin/ai/embeddings`).
- **Фаза 4** — Тенанты и тарифы (карточка Org, `/admin/orgs/plans`, `/admin/orgs/entitlements`).
- **Фаза 5** — Контент (типы встреч, email-шаблоны, system-messages, global-channels, copy-strings).
- **Фаза 6** — Каналы и интеграции (боты, webhooks, integration keys, LiveKit).
- **Фаза 7** — Записи и медиа (retention, S3 storage).
- **Фаза 8** — Платформа (кроны, воркеры, лимиты, feature flags, security, maintenance).
- **Фаза 9** — Полировка: 308-redirect `/admin/ai-usage`, унификация period-селектора (`day/week/month`), миграция оставшихся `useEffect+useState` на `useAdminQuery`, обновление second-brain.
