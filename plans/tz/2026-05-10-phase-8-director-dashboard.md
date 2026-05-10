---
type: tz
status: draft
phase: 8
feature: дашборд директора (owner-вид) — срез знаний компании за период с виджетами и AI-чатом
date: 2026-05-10
parent_tz: plans/tz/2026-05-10-knowledge-core-tz.md
references:
  - second-brain/01_projects/themes.md
  - second-brain/02_architecture/knowledge-core.md
  - plans/tz/2026-05-10-knowledge-core-tz.md (Фаза 8)
---

# ТЗ: Фаза 8 — Дашборд директора

> Самостоятельный документ для агента-исполнителя. Все архитектурные решения зафиксированы. Если возникает развилка — выбирай вариант, явно прописанный в разделе «Архитектурные решения», или следуй базовым правилам Z (skill `core-engineering-standards`, `nestjs-rules`, `frontend-rules`).

## Цель фазы

Главная страница для роли `owner` Org — **срез знаний компании за день/неделю/месяц** на основе ядра знаний (IdeaBlock, Entity, Theme, IdeaBlockLink). Это первая страница, которую видит владелец Org после логина (вместо текущего DashboardClient, который рассчитан на менеджера).

Принципиально: дашборд директора **не дублирует** функции карточки встречи или Theme-страницы. Он отвечает на 5 вопросов:
1. **Что нового узнали в компании?** — топ новых тем + топ новых сигналов с высоким весом.
2. **Какие сигналы идут от клиентов?** — счётчики по типам.
3. **Что сейчас в фокусе?** — активные растущие темы.
4. **Кто/что в центре внимания?** — топ сущностей по росту упоминаний.
5. **Что мы ещё не понимаем?** — открытые вопросы (signalType=knowledge_gap).

Плюс: **AI-чат «Спросите про вашу компанию»** — org-scope (использует `POST /api/v1/chat/v2 {scope:'org'}` из Фазы 6).

## Что входит

### Backend

#### 8.1. Сервис `DirectorDashboardService`

`backend/src/modules/dashboard/services/director-dashboard.service.ts` (новый модуль `dashboard`).

Один публичный метод:
```ts
getDirectorView(args: {
  tenantId: string;
  period: 'week' | 'month';  // по умолчанию week
}): Promise<DirectorDashboardDto>
```

Возвращает агрегированную структуру (см. §«DTO» ниже). Внутри — 5 параллельных SQL/Prisma-запросов через `Promise.all`:

1. **`newThemes`** — `Theme.findMany WHERE tenantId AND status='active' AND createdAt >= since ORDER BY weight DESC, lastSignalAt DESC LIMIT 10`. Маппинг: `id, name, branch, weight, dynamic, blocksCount` (через `_count: {blocks: true}`).
2. **`newSignals`** — `IdeaBlock.findMany WHERE tenantId AND status='canonical' AND createdAt >= since AND signalType IN (pain, churn_risk, risk, feature_request, decision, commitment, competitor_move, metric_change) ORDER BY confidence DESC, dynamicScore DESC LIMIT 10`. Маппинг: `id, name, signalType, confidence, criticalQuestion, trustedAnswer (truncate 280), evidenceMeetingId? (через первый IdeaBlockEvidence)`.
3. **`signalCounters`** — `IdeaBlock.groupBy({by: ['signalType'], where: {tenantId, status: 'canonical', createdAt: {gte: since}}, _count: {_all: true}})`. Возвращаем целевые типы: `pain`, `feature_request`, `churn_risk`, `objection`, `risk`, `decision`, `commitment`. Остальные — суммируем в `other`.
4. **`activeThemes`** — `Theme.findMany WHERE tenantId AND status='active' AND dynamic='growing' ORDER BY weight DESC, lastSignalAt DESC LIMIT 10`. Маппинг как `newThemes`, плюс `lastSignalAt`.
5. **`hotEntities`** — топ-10 `Entity` с наибольшим ростом упоминаний за период. Запрос:
   ```sql
   SELECT e.id, e.canonicalName, e.type,
          COUNT(DISTINCT bm.blockId) AS recentMentions
   FROM "Entity" e
   JOIN "IdeaBlockEntity" bm ON bm.entityId = e.id
   JOIN "IdeaBlock" b ON b.id = bm.blockId
   WHERE e.tenantId = $1
     AND e.mergedIntoId IS NULL
     AND b.status = 'canonical'
     AND b.createdAt >= $2
   GROUP BY e.id
   ORDER BY recentMentions DESC
   LIMIT 10
   ```
6. **`openQuestions`** — `IdeaBlock.findMany WHERE tenantId AND status='canonical' AND signalType='knowledge_gap' ORDER BY createdAt DESC LIMIT 10`. Маппинг: `id, name, criticalQuestion, createdAt`.

**Период:**
- `week` → `since = now() - 7d`.
- `month` → `since = now() - 30d`.
- Будущее: `custom` с `from/to` — vNext.

**Кэш:** `AdminCacheService` (из Фазы 7) **переиспользуем** через ре-export из admin-модуля или дублируем как `DashboardCacheService` (минимальный — Map с TTL). **Решение по умолчанию:** переиспользуем `AdminCacheService`. Ключ: `dashboard:director:${tenantId}:${period}`. TTL 60s. Инвалидация — пока не делаем (TTL 60s достаточно; директор не ждёт sub-секундной свежести).

#### 8.2. (Опционально на этой фазе) `dashboard-summary` LLM-агент

LLM-сервис, генерирующий 1-2 абзаца «Главное за неделю» поверх 5 виджетов. Использует существующий `taskType='dashboard-summary'` из `LlmTaskType` union.

**Решение:** реализуем **минимально**, как опциональный 7-й блок дашборда. Метод `DirectorDashboardService.getNarrativeSummary(...)`:
- На вход — все 6 виджетов выше.
- Вызов `LlmRouterService.invoke({taskType: 'dashboard-summary', tenantId, ...})` с компактным контекстом (топ-3 темы, топ-5 сигналов, счётчики, топ-3 сущности, топ-3 вопроса).
- Возвращает строку 200-400 символов в plain-text (без citations — это не chat).
- При фолбэке всех провайдеров — возвращает `null` (UI скрывает блок).

**Кэш:** отдельный ключ `dashboard:director:narrative:${tenantId}:${period}`, TTL **24h** (нет смысла дёргать LLM каждую минуту). Инвалидация — раз в сутки `@Cron('0 6 * * *')` сбрасывает все `dashboard:director:narrative:*` ключи.

**Промпт:** `backend/src/modules/dashboard/prompts/dashboard-summary.prompt.ts`. Новый промпт-файл (paid-edited через Z-Admin — vNext, на старте — code fallback). Структура: system promot русский, кратко, по делу: «Ты — аналитик в SaaS-компании. На основе сводки сигналов компании за неделю, скажи владельцу 3-4 главных факта и 1 рекомендацию. Без воды. 200-400 символов».

**Что не входит**: prompt-registry интеграция (skill `z-ai-agent-rules` рекомендует registry, но на Фазе 8 — code fallback допустим, как было в Фазе 5 для tasks/chapters/summary v2).

#### 8.3. DTO

`backend/src/modules/dashboard/dto/director-dashboard.dto.ts`:

```ts
type DirectorDashboardDto = {
  period: 'week' | 'month';
  generatedAt: string; // ISO
  newThemes: Array<{id, name, branch?, weight, dynamic, blocksCount}>;
  newSignals: Array<{id, name, signalType, confidence, criticalQuestion, trustedAnswer, evidenceMeetingId?}>;
  signalCounters: { pain, feature_request, churn_risk, objection, risk, decision, commitment, other };
  activeThemes: Array<{id, name, branch?, weight, dynamic, blocksCount, lastSignalAt?}>;
  hotEntities: Array<{id, canonicalName, type, recentMentions}>;
  openQuestions: Array<{id, name, criticalQuestion, createdAt}>;
  narrativeSummary: string | null; // null = LLM недоступен
};
```

Zod-схемы для валидации запроса (`period`).

#### 8.4. Контроллер

`backend/src/modules/dashboard/director-dashboard.controller.ts`:
```
@Controller('api/v1/dashboard')
@UseGuards(CookieAuthGuard, TenantGuard)
GET /director?period=week|month → DirectorDashboardService.getDirectorView(...)
```

**Дополнительная авторизация:** только `owner` Org. Проверка: `RbacService.canManageOrg(userId, tenantId)` → если false (manager/admin/none) — `403 forbidden_role`. **Уточнение:** `admin`-роль в Membership **тоже видит** дашборд директора (партнёрская роль). Поэтому проверяем `role IN ('owner','admin')`. Реализуем через новый shortcut `RbacService.canViewDirectorDashboard(userId, tenantId)`.

#### 8.5. Модуль

`backend/src/modules/dashboard/dashboard.module.ts`:
- `controllers: [DirectorDashboardController]`.
- `providers: [DirectorDashboardService]`.
- Imports: `PrismaModule` (если не Global — проверить), `AiModule` (для LlmRouter), `AdminModule` (для AdminCacheService — если ре-export). `RbacModule` (Global).
- Экспорт сервиса не нужен — внешний потребитель только Frontend через REST.
- Регистрация в `AppModule`.

### Frontend

#### 8.6. Страница `/dashboard` — split на два вида

Текущий `frontend/app/(authenticated)/dashboard/page.tsx` + `DashboardClient.tsx` рассчитан на менеджера: «встречи сегодня», «задачи на неделю». Сохраняем его как **manager-вид**.

**Переключение:**
- Новый `dashboard/page.tsx` — server-компонент, получает `currentOrgRole` из cookie/контекста.
- Если `role IN ('owner','admin')` — рендерит `<DirectorDashboardClient>`.
- Иначе — рендерит существующий `<DashboardClient>` (manager-вид).

**Решение:** **не меняем** текущий `DashboardClient.tsx`, добавляем рядом новый `DirectorDashboardClient.tsx` и роутер-логика выбирает один из них на основе роли. URL остаётся `/dashboard` — пользователь не видит разницы.

#### 8.7. `DirectorDashboardClient`

`frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx`:

**Layout:**
- Header: приветствие («Привет, {name}»), переключатель периода (`Неделя | Месяц`), кнопка «Обновить» (force-refresh без кэша через `?nocache=1`).
- Если `narrativeSummary` есть — большой блок-цитата сверху (icon Sparkles).
- Сетка из 5 виджетов (2-3 колонки на десктопе, 1 на mobile):
  1. **«Что узнали за неделю/месяц»** — карточка с двумя колонками: «Новые темы» (top-10) + «Новые сигналы» (top-10). Темы кликабельны → `/themes/:id`. Сигналы кликабельны → `/meetings/:id/result?block=:blockId` (если есть `evidenceMeetingId`).
  2. **«Сигналы клиентов»** — горизонтальная гистограмма по `signalCounters`. Цвета: pain — оранжевый, churn_risk — красный, feature_request — синий, decision — зелёный, прочее — нейтральные. Под каждым счётчиком — ссылка «Открыть подборку» (фильтр в `/themes` или `/cards` — на старте просто disabled-ссылка с tooltip «vNext»).
  3. **«Активные темы»** — список топ-10 `activeThemes` (значок 📈 для `dynamic=growing`), с кратким описанием темы и веткой (`branch`). Клик → `/themes/:id`.
  4. **«Главные сущности недели»** — список топ-10 `hotEntities` с типом (клиент/проект/продукт) и числом упоминаний. Клик → пока на `/themes?entityId=:id` (если есть фильтр) или disabled (vNext: страница `/entities/:id`).
  5. **«Открытые вопросы»** — список топ-10 `openQuestions`, форматирование как Q&A: вопрос крупно, источник встречи мелко.

- **Под виджетами — AI-чат** «Спросите про вашу компанию»:
  - Использует существующий `chatApi.askV2({scope:'org', query})` (Фаза 6).
  - История — общая cross-history (`MeetingChatMessage` с meetingId/cardId = null), `chatApi.historyGlobal()`.
  - Виджет полностью эквивалентен `/chat` странице (Фаза 6), но встроен прямо в дашборд (выше viewport-fold для быстрого доступа). Можно вынести в общий компонент `<OrgChatPanel>` и переиспользовать в `/chat` и здесь.

#### 8.8. API-клиент

`frontend/src/api/dashboard.api.ts`:
```ts
export const dashboardApi = {
  getDirectorView: (period: 'week' | 'month'): Promise<DirectorDashboardApi> =>
    apiClient.get('/api/v1/dashboard/director', { params: { period } })
};
```

#### 8.9. Domain

`frontend/src/domain/director-dashboard.ts`:
- Типы `DirectorDashboardApi → DirectorDashboardDomain` + mapper.
- Лейблы: `signalTypeLabel(type)` — RU («pain» → «Боль клиента», `churn_risk` → «Риск ухода клиента», `feature_request` → «Запрос фичи», `objection` → «Возражение», `risk` → «Риск», `decision` → «Решение», `commitment` → «Обязательство»).
- Лейбл `entityTypeLabel(type)` — уже есть в существующем коде (см. `frontend/src/domain/entity.ts` если он есть).

### Документация

#### 8.10. Second-brain

- **Создать `second-brain/01_projects/director-dashboard.md`** — про дашборд директора: какие виджеты, как считаются, что vNext, как переключение manager/owner.
- **Обновить `second-brain/01_projects/frontend-pages.md`** — добавить `/dashboard` (роль-зависимый split).
- **Обновить `second-brain/02_architecture/module-map.md`** — добавить `backend/src/modules/dashboard/`.
- **Обновить `second-brain/01_projects/api-layer.md`** — добавить `GET /api/v1/dashboard/director`.

## Архитектурные решения (зафиксированы — не пересматриваем)

| # | Решение |
|---|---|
| 1 | **Один эндпоинт, один объект** — все 6 виджетов в одном ответе `GET /director?period=`. Никаких отдельных `/widgets/themes`, `/widgets/signals` — это удешевляет фронт и позволяет одному кэш-ключу покрывать всю страницу. |
| 2 | **Период только `week\|month`** в этой фазе. `custom from/to` — vNext. |
| 3 | **Роль `admin` тоже видит дашборд директора** — это партнёрская/руководящая роль в Org. `manager` — нет. `super_admin` — да (через bypass в `RbacService.canManageOrg`). |
| 4 | **AI-чат — встраивается в дашборд** через тот же `chat-v2` endpoint. Не делаем отдельный Q&A-агент. |
| 5 | **`narrativeSummary`** — опциональный блок. Если LLM упал/не настроен — UI скрывает блок (а не показывает заглушку). Это снижает шум на дашборде. |
| 6 | **`hotEntities` через SQL `groupBy(entityId)`** — без денормализованного `recentMentionsCount` поля. На малых Org (<100k блоков) запрос быстрый; на больших — индекс `(tenantId, blockId)` на `IdeaBlockEntity` уже есть. Оптимизация через MV — vNext. |
| 7 | **Кэш переиспользует `AdminCacheService`** из Фазы 7. Если Фаза 7 ещё не закрыта — агент создаёт минимальный аналог в `dashboard.module.ts` и в момент закрытия Фазы 7 делается рефакторинг. **На практике:** Фаза 7 закрывается **до** Фазы 8 (см. parent-tz блокирующая последовательность), поэтому `AdminCacheService` уже доступен. |
| 8 | **TTL кэша виджетов 60s, narrative — 24h.** |
| 9 | **`evidenceMeetingId` для `newSignals`** — берём `IdeaBlockEvidence.rawEventId → RawEvent.sourceType='meeting'? sourceExternalId : null`. Если первое evidence — не meeting (chat/email/etc — Фаза 10), `evidenceMeetingId = null` и UI не делает ссылку. |
| 10 | **«Главные сущности» исключают merged-сущности** (`mergedIntoId IS NULL`) — иначе будут дубликаты. |
| 11 | **Manager не видит дашборд директора** даже визуально. Текущий `DashboardClient.tsx` остаётся для них без изменений. |
| 12 | **Фаза 9 добавляет 7-й виджет** «Согласованность стратегии» — оставляем место в макете (комментарий в `DirectorDashboardClient.tsx`). |
| 13 | **Не делаем отдельную авторизацию страницы Frontend** — server-компонент `dashboard/page.tsx` смотрит на роль и рендерит соответствующий клиент. API защищён `RbacService.canViewDirectorDashboard`. |

## Что не входит

- Topический индикатор «Согласованность стратегии» (M-16) — Фаза 9.
- Drill-down на отдельные виджеты (страница `/dashboard/themes-week`, `/dashboard/signals-week`) — vNext.
- Кастомизация виджетов (порядок, скрытие) — vNext.
- Графики временных рядов (тренд расхода сигналов pain за 90 дней) — vNext.
- Push-уведомления при резком изменении сигналов — vNext.
- `narrativeSummary` через streaming/SSE — vNext.
- Полные unit-тесты на каждый widget-метод. Минимум — smoke-тест на `getDirectorView` на seed-данных.

## DoD

- [ ] При входе в Z как `owner` Org — попадает на `/dashboard`, видит **директорский** вид с виджетами (5 виджетов + AI-чат + опциональный narrative).
- [ ] При входе как `manager` — видит **прежний** менеджерский дашборд (встречи/задачи). Без регрессии.
- [ ] При входе как `admin` Org — видит директорский вид (как owner).
- [ ] `GET /api/v1/dashboard/director?period=week` возвращает корректные данные на seed-Org с ≥10 блоками и ≥5 темами.
- [ ] Все 5 SQL-запросов идут параллельно через `Promise.all` (проверка через timing).
- [ ] Кэш работает: повторный запрос за 60s не делает SQL заново (счётчик в логах).
- [ ] AI-чат на дашборде отвечает на вопрос «Какие основные риски недели?» с цитатами на встречи (через chat-v2 org-scope).
- [ ] При недоступности LLM (`narrativeSummary=null`) UI скрывает блок без ошибок.
- [ ] Manager попадает на `/dashboard` — директорский вид **не** виден (даже через DevTools нет утечки данных).
- [ ] Manager делает `GET /api/v1/dashboard/director` руками — `403 forbidden_role`.
- [ ] `bun run typecheck` (backend + frontend) — зелёные.
- [ ] Создан `second-brain/01_projects/director-dashboard.md`.
- [ ] Обновлён `second-brain/02_architecture/module-map.md` (раздел `dashboard`).
- [ ] Обновлён `decisions-log.md`.
- [ ] Создан `plans/2026-05-10-phase-8-execution.md` со `status: completed`.

## Риски и митигации

| Риск | Митигация |
|---|---|
| `hotEntities` SQL медленный на больших Org (>1M блоков) | Индекс `(tenantId, blockId)` на `IdeaBlockEntity` есть. Если на бенчмарке >500ms — добавить материализованное представление `MV.tenant_recent_entity_mentions` (refreshed nightly). На MVP не делаем. |
| `narrativeSummary` галлюцинирует или вводит в заблуждение | Промпт строго ограничивает: «без советов, основанных на данных вне сводки». В UI — мелкая подпись «AI-сводка, может содержать ошибки». Если прод-пользователи жалуются — выключить через Org-Admin тумблер `narrativeSummaryEnabled` (vNext). |
| `period` агрегация на `month` тяжёлая | Те же индексы. Если медленно — лимитировать `month` до 30 дней (не 30+). |
| `signalCounters` пропускает кастомные `signalType` | На Фазе 2 enum `SignalType` зафиксирован — все 14 типов известны. Новые типы — обновлять вручную в этой агрегации. |
| Manager видит owner-данные в DevTools | `/api/v1/dashboard/director` под `RbacService.canViewDirectorDashboard`, manager → 403. UI — рендерит `DirectorDashboardClient` только если backend разрешил (после первого запроса). До этого — fallback на manager-вид. |
| Кэш TTL 60s + manager-смена ролей | Кэш по `tenantId+period` — не зависит от userId. На смену роли — проблем нет. |

## Текущее состояние (на чём строим)

### Что уже есть
- **Сущности `Theme`, `IdeaBlock`, `Entity`, `IdeaBlockEntity`, `IdeaBlockEvidence`, `RawEvent`** — все из Фаз 2-4. Индексы на `(tenantId, status)`, `(tenantId, branch)`, `(tenantId, mergedIntoId)` есть.
- **`SignalType` enum** — 14 значений, в т.ч. `pain`, `churn_risk`, `feature_request`, `knowledge_gap`, `decision`, `commitment` ([backend/prisma/schema.prisma:197](backend/prisma/schema.prisma#L197)).
- **`ThemeDynamic`** — `growing/stable/declining`. `Theme.weight`, `Theme.lastSignalAt` уже есть.
- **`chatApi.askV2({scope:'org', query})`** — Фаза 6, готовый endpoint `POST /api/v1/chat/v2`.
- **`LlmRouterService` + `taskType='dashboard-summary'`** — taskType уже в union'е, но `LlmTaskRoute` для него нужно создать (через seed/admin-page).
- **`DashboardClient.tsx`** существующий — manager-вид, не трогаем.
- **`AdminCacheService`** — будет добавлен в Фазе 7 Шаге 8. Используем после.

### Что нужно добавить
- Новый модуль `backend/src/modules/dashboard/`.
- `DirectorDashboardService` + контроллер.
- `RbacService.canViewDirectorDashboard` shortcut.
- Промпт `dashboard-summary.prompt.ts`.
- Создать `LlmTaskRoute` запись для `dashboard-summary` (через DB-патч: `bun backend/scripts/patch-dashboard-summary-route.ts` — одноразовый скрипт по skill `safe-seed-rules`).
- Frontend: split логика, `DirectorDashboardClient`, API-клиент, domain-модели.

## Пошаговый план для агента-исполнителя

Фаза 8 разбита на **6 шагов**. Каждый — атомарный коммит.

### Шаг 1 — Backend модуль `dashboard` + сервис + контроллер

1. Создать структуру `backend/src/modules/dashboard/`:
   - `dashboard.module.ts`.
   - `services/director-dashboard.service.ts` — методы `getDirectorView`, `getNarrativeSummary` (private), все 6 query-методов как private.
   - `director-dashboard.controller.ts` — `GET /api/v1/dashboard/director?period=`.
   - `dto/director-dashboard.dto.ts` — Zod-схема для query, типы DTO ответа.
2. Расширить `RbacService` методом `canViewDirectorDashboard(userId, tenantId)` — обёртка над `loadContext` с проверкой `role IN ('owner','admin')` или `isSuperAdmin`.
3. Зарегистрировать модуль в `AppModule`.
4. **`narrativeSummary` отключён** в первом коммите (return null) — выносим LLM-часть в отдельный шаг.
5. `bun run typecheck` + ручной smoke на seed-данных.

**Коммит:** `feat(knowledge-core): фаза 8 шаг 1 — DirectorDashboardService + GET /api/v1/dashboard/director`.

### Шаг 2 — `narrativeSummary` LLM-часть

1. `backend/src/modules/dashboard/prompts/dashboard-summary.prompt.ts` — system prompt + builder для user-сообщения (компактная сводка топов).
2. `DirectorDashboardService.getNarrativeSummary(args)` — вызов `LlmRouterService.invoke({taskType: 'dashboard-summary', tenantId, systemPrompt, userMessage, sourceRef: {type:'dashboard', id: tenantId}})`. На фейл — `null`.
3. Кэш: ключ `dashboard:director:narrative:${tenantId}:${period}`, TTL 24h. Использует `AdminCacheService` (если Фаза 7 закрыта) или ad-hoc Map (иначе).
4. Cron `@Cron('0 6 * * *')` (можно прямо в `DirectorDashboardService`) для сброса всех narrative-ключей на ночь.
5. **Создать `LlmTaskRoute` запись** для `dashboard-summary` — одноразовый патч-скрипт `backend/scripts/patch-dashboard-summary-route.ts` (skill `safe-seed-rules`):
   ```ts
   await prisma.llmTaskRoute.upsert({
     where: { taskType_tenantId: { taskType: 'dashboard-summary', tenantId: null } },
     create: { taskType: 'dashboard-summary', tenantId: null, providers: [{ provider: 'anthropic' }, { provider: 'deepseek' }], isActive: true },
     update: {}  // не перезаписываем admin-edited
   });
   ```
6. `bun run typecheck` + ручной smoke (увидеть narrative в ответе API).

**Коммит:** `feat(knowledge-core): фаза 8 шаг 2 — narrativeSummary LLM (taskType=dashboard-summary)`.

### Шаг 3 — Frontend domain + API-клиент

1. `frontend/src/domain/director-dashboard.ts` — типы `DirectorDashboardApi/Domain`, mapper, лейблы (`signalTypeLabel`, локально или через переиспользование `signal.ts`, если есть).
2. `frontend/src/api/dashboard.api.ts` — `dashboardApi.getDirectorView(period)`.
3. `bun run typecheck` (frontend).

**Коммит:** `feat(knowledge-core): фаза 8 шаг 3 — frontend domain + dashboard.api`.

### Шаг 4 — Frontend split: page + DirectorDashboardClient

1. Изменить `frontend/app/(authenticated)/dashboard/page.tsx`:
   - Server-компонент: получить `currentOrgRole` из server-side cookie/контекста (через `me` endpoint или `cookies().get('orgRole')` если такой паттерн уже используется).
   - **Решение:** не дублируем server-side fetch, а делегируем выбор клиенту. Главная страница рендерит `<DashboardRouter>` (новый client-компонент), который через `useAuth()` смотрит роль и рендерит либо `<DashboardClient>`, либо `<DirectorDashboardClient>`.
   - Альтернативно (предпочтительнее): server-side `fetch` `/api/v1/me` → `currentOrgRole` → ветвление. Но это требует cookie forwarding в server-component, что в Next.js App Router возможно через `cookies()`.
   - **Зафиксировано:** клиентский split через `useAuth()`. Реализация: `'use client'` в page.tsx (или новый клиентский компонент-обёртка), внутри `if (role IN ('owner','admin','super_admin')) <DirectorDashboardClient/> else <DashboardClient/>`.
2. Создать `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx`:
   - State: `data: DirectorDashboardDomain | null`, `loading`, `period: 'week'|'month'`, `error`.
   - На mount + при смене `period` — fetch.
   - Header с переключателем периода и кнопкой «Обновить».
   - Если `narrativeSummary` есть — блок-цитата.
   - Сетка из 5 виджетов (карточки на shadcn `Card`).
   - Под сеткой — `<OrgChatPanel>` (см. шаг 5).
3. Skeleton loading state на каждом виджете.
4. `bun run typecheck` + ручной smoke в браузере (зайти как owner).

**Коммит:** `feat(knowledge-core): фаза 8 шаг 4 — frontend split + DirectorDashboardClient`.

### Шаг 5 — `<OrgChatPanel>` общий компонент

1. Извлечь chat-логику из `frontend/app/(authenticated)/chat/ChatClient.tsx` в общий компонент `frontend/src/ui/components/chat/OrgChatPanel.tsx`:
   - Props: `{ height?: string, withHistory?: boolean }`.
   - Использует `chatApi.askV2({scope:'org', query})` + `chatApi.historyGlobal()`.
2. В `/chat` странице переключиться на `<OrgChatPanel>`.
3. В `<DirectorDashboardClient>` использовать `<OrgChatPanel withHistory={false} height="400px">`.
4. `bun run typecheck` + ручной smoke на обеих страницах (без регрессии в `/chat`).

**Коммит:** `refactor(knowledge-core): фаза 8 шаг 5 — общий <OrgChatPanel> переиспользуется в /chat и /dashboard`.

### Шаг 6 — Документация + execution-план

1. Создать `second-brain/01_projects/director-dashboard.md` — структура страницы, виджеты, источники данных, переключение manager/owner, что vNext.
2. Обновить `second-brain/02_architecture/module-map.md` — раздел `dashboard`.
3. Обновить `second-brain/01_projects/frontend-pages.md` — `/dashboard` (split).
4. Обновить `second-brain/01_projects/api-layer.md` — `GET /api/v1/dashboard/director`.
5. Обновить `plans/decisions-log.md` — строка по Фазе 8.
6. Обновить родителя `plans/tz/2026-05-10-knowledge-core-tz.md` — отметить Фазу 8 в итоговом списке.
7. Создать `plans/2026-05-10-phase-8-execution.md` со `status: completed` (формат — как `phase-6-execution.md`).

**Коммит:** `docs(second-brain): рефлексия Фазы 8 — дашборд директора + обновление module-map / frontend-pages / api-layer`.

## Затронутые файлы (полный список)

### Backend (новое)
- `backend/src/modules/dashboard/dashboard.module.ts` — новый.
- `backend/src/modules/dashboard/services/director-dashboard.service.ts` — новый.
- `backend/src/modules/dashboard/director-dashboard.controller.ts` — новый.
- `backend/src/modules/dashboard/dto/director-dashboard.dto.ts` — новый.
- `backend/src/modules/dashboard/prompts/dashboard-summary.prompt.ts` — новый.
- `backend/scripts/patch-dashboard-summary-route.ts` — новый одноразовый патч.

### Backend (изменения)
- `backend/src/modules/rbac/rbac.service.ts` — `canViewDirectorDashboard(userId, tenantId)`.
- `backend/src/app.module.ts` — регистрация `DashboardModule`.

### Frontend (новое)
- `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` — новый.
- `frontend/src/domain/director-dashboard.ts` — новый.
- `frontend/src/api/dashboard.api.ts` — новый.
- `frontend/src/ui/components/chat/OrgChatPanel.tsx` — новый общий компонент.

### Frontend (изменения)
- `frontend/app/(authenticated)/dashboard/page.tsx` — split-логика.
- `frontend/app/(authenticated)/chat/ChatClient.tsx` — переход на `<OrgChatPanel>`.

### Documentation
- `second-brain/01_projects/director-dashboard.md` — новый.
- `second-brain/01_projects/frontend-pages.md` — обновление.
- `second-brain/01_projects/api-layer.md` — обновление.
- `second-brain/02_architecture/module-map.md` — обновление.
- `plans/decisions-log.md` — обновление.
- `plans/tz/2026-05-10-knowledge-core-tz.md` — отметка в итогах.
- `plans/2026-05-10-phase-8-execution.md` — новый.

## Сквозные правила (из проекта)

- **Никаких прямых LLM-вызовов**, только `LlmRouter` (skill `z-ai-agent-rules`).
- **Все DTO — Zod через `ZodValidationPipe`** (skill `nestjs-rules`).
- **Frontend ApiDto → DomainModel → UiModel** (skill `frontend-rules`).
- **Все query/mutation через `apiClient`**, никаких прямых fetch'ей.
- **`bun run prisma:push --accept-data-loss`** если будут изменения схемы. На Фазе 8 schema не меняется (всё уже есть).
- **Commit-сообщения** в Conventional Commits, область `knowledge-core`.

## Открытые вопросы (агент сам выбирает решение)

1. **Лейблы для `signalType` на русском** — где лежат: в `frontend/src/domain/signal.ts` (если есть) или в новом `domain/director-dashboard.ts`. **Решение по умолчанию:** найти существующий, если нет — добавить в `domain/signal.ts` (общее место). Не дублировать.
2. **Параллельный запуск SQL** через `Promise.all` или последовательно. **Решение по умолчанию:** `Promise.all` — все 5 запросов независимы, дают ~5x speedup на dashboard.
3. **Skeleton loading** — показывать сразу сетку из 5 пустых карточек или один общий «Загружаем...». **Решение по умолчанию:** сетка пустых карточек (per-widget skeleton) — даёт более полированный UX.

## Связанные документы

- Родитель: [plans/tz/2026-05-10-knowledge-core-tz.md](plans/tz/2026-05-10-knowledge-core-tz.md) (Фаза 8).
- Themes: [second-brain/01_projects/themes.md](second-brain/01_projects/themes.md).
- Knowledge-core: [second-brain/02_architecture/knowledge-core.md](second-brain/02_architecture/knowledge-core.md).
- Chat-v2: [plans/2026-05-10-phase-6-execution.md](plans/2026-05-10-phase-6-execution.md).
- Фаза 9 (расширяет дашборд индикатором «Согласованность стратегии»): [plans/tz/2026-05-10-phase-9-strategic-alignment.md](plans/tz/2026-05-10-phase-9-strategic-alignment.md).

## Итог (заполняется агентом)

- [ ] Шаг 1 — модуль + сервис + контроллер.
- [ ] Шаг 2 — narrativeSummary LLM.
- [ ] Шаг 3 — frontend domain + api.
- [ ] Шаг 4 — split + DirectorDashboardClient.
- [ ] Шаг 5 — OrgChatPanel общий компонент.
- [ ] Шаг 6 — документация + execution-план.
- [ ] Создан `phase-8-execution.md` со `status: completed`.
- [ ] Обновлён `decisions-log.md`.
- [ ] Обновлён `second-brain/`.
