---
type: tz
status: ready-to-implement
feature: llm-cost-dashboard
date: 2026-07-03
owner: владелец
relates_to:
  - plans/architecture/2026-07-03-llm-cost-dashboard.md
  - plans/tz/2026-07-03-llm-metrics-rub-day-rate-fix.md
  - second-brain/04_не-сделано/README.md
  - second-brain/02_architecture/ai-agents-map.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-07-03-llm-cost-dashboard.md` · Статус согласования: 2026-07-03 (включая два уточнения, внесённые прямо при написании этого ТЗ — см. REALITY-CHECK).

# ТЗ: «Расход на LLM» — единый дашборд (консолидация 8 экранов)

Ветка `fix/invite-password-existing-user-multi-org` (не смержена в dev, не задеплоена). Работаем в ней же, если явно не сказано иное.

## Принцип реализуемости

Каждая фаза самодостаточна: свой `path:line`, свои файлы, свой acceptance. Не оптимизируй мимо явных решений ниже (Р1–Р13 из архитектуры, Б1–Б6 из этого ТЗ) — они уже приняты владельцем или обоснованы доказательным циклом. Технические развилки внутри фазы, которые действительно всё равно (порядок полей DTO, имя локальной переменной) — решай сам.

## REALITY-CHECK

Картография (vexp + фоновый workflow из 8 агентов-проверяльщиков) подтвердила бо́льшую часть архитектуры дословно, но вскрыла **две несостыковки, которые меняют продукт** — обе возвращены владельцу и решены ДО этого ТЗ (архитектура `plans/architecture/2026-07-03-llm-cost-dashboard.md` уже обновлена соответствующими Р12/Р13, повторно одобрена):

1. **Три из пяти «живых экранов расхода» — не чистые витрины.** `/admin/analytics/orgs` — на деле общий список организаций (тариф/подписка/участники), расход — одна колонка. `/admin/economics/orgs/[id]` — кроме расхода несёт форму редактирования бюджет-лимита компании. `/admin/analytics/functions/[taskType]` — кроме расхода несёт **свой собственный редактор цепочки моделей** (provider/tier + isActive), вызывающий тот же `putChain`, что и «Роутинг моделей». Решение владельца: эти три — не редиректим целиком, хирургически вырезаем только денежную часть (Р12 в архитектуре).
2. **Найден дубль конфигурации** (независимо от денег): `/admin/ai/routing/[taskType]` («Цепочка») и `/admin/analytics/functions/[taskType]` оба редактируют один и тот же роут модели через `AdminAiModelsService`/`putChain`. Решение владельца: убрать дубль в этом же ТЗ (Р13), единственное место редактирования — «Роутинг моделей».

Дополнительно подтверждено фактом (не меняет продукт, но меняет реализацию):
- `AiCostDaily` (`backend/prisma/schema.prisma:3189-3217`) содержит все поля, нужные для 5 уровней: `tenantId, date, taskType, provider, model, callsCount, callsSuccess, costUsd, costRub, inputTokens, outputTokens, cachedTokens`. Индексы `@@unique([tenantId,date,taskType,provider,model])`, `@@index([tenantId,date])`, `@@index([date,taskType])` — новых индексов/миграций не требуется.
- Наполняется `DailyCostAggregatorCron.runForDate(date)` (`backend/src/modules/admin/economics/daily-cost-aggregator.cron.ts:41-150`), крон `0 1 * * *`. Модель в схеме с 2026-05-23 (`git log -S "model AiCostDaily"`), первая реально посчитанная ночь — 2026-05-24. Сырой `AiUsageLog` (`schema.prisma:1637`) — с 2026-05-09, retention по умолчанию 365 дней (крутилка `llm.usage_log.delete_after_days`, `backend/src/modules/ai/services/ai-usage-log-cleanup.service.ts:20-21`).
- Формула RUB **уже верна** (Фаза 1/2 `plans/tz/2026-07-03-llm-metrics-rub-day-rate-fix.md`, коммиты f3aae431/9ba907dd) — не переделывать. Актуальный метод-образец построчного расчёта: `AdminAiModelsService.metrics_()` (`backend/src/modules/admin/ai-models/ai-models.service.ts:435-456`) — построчный `COALESCE("costRub", "costUsd" * fxForCoalesce)`.
- Три места сегодня независимо считают расход по `AiUsageLog` (не по `AiCostDaily`): `AdminOrgsService.listOrgs()` (`backend/src/modules/admin/services/admin-orgs.service.ts:111-119`, USD, не RUB), `UnitEconomicsService.getGlobal()` (`backend/src/modules/admin/economics/unit-economics.service.ts:16-123`, три `$queryRaw`), `OrgEconomicsCron.computeForOrg()` (`backend/src/modules/admin/economics/org-economics.cron.ts:80-174`, три `$queryRaw`). Первые два консолидируются на `AiCostDaily` в этом ТЗ. Третий **не трогаем** — он же обслуживает вне-scope self-service `/admin/org/economics` (`OrgEconomicsController` → `UnitEconomicsService.getOrg()` → `computeForOrg()`) и ночной Prometheus-гейдж бюджета — трогать его означало бы затронуть вне-scope экран.
- Frontend: `recharts ^3.8.1` уже в зависимостях, готовый образец тренд-графика с headline-числом — `frontend/src/ui/components/dashboard/modern/AreaTrend.tsx` (+ `StatCard.tsx`, `MiniStackedBar.tsx`). Для узких строк таблицы (уровень 4, спарклайн в ячейке) — готовый безрецептовый `frontend/src/ui/components/admin/AdminSparkline.tsx:21` (чистый SVG, без recharts). `AdminCsvDownloadButton.tsx` (`frontend/src/ui/components/admin/AdminCsvDownloadButton.tsx:13-21`) — клиентский генератор CSV из уже загруженных строк (Blob, не серверный стриминг) — именно его переиспользуем для Р9 (CSV на каждом уровне), не старый `/export/usage.csv`.
- Форматирование рублей сегодня **три несовместимые реализации** (`admin-plan.ts:87`, `billing.ts:113` копейки, `admin-ai-model.ts:103` копейки-fallback). Для нового дашборда — своя простая `formatRub(rub: number): string` внутри доменного файла нового экрана (см. Фаза 5), не наследовать чужую сигнатуру.
- Guard-паттерн суперадмин-контроллеров одинаков везде: `@ApiExcludeController() @Controller('api/v1/admin/...') @UseGuards(CookieAuthGuard, SuperAdminGuard) @UseInterceptors(SuperAdminAuditInterceptor)` (примеры: `admin-usage.controller.ts:37-40`, `admin-orgs.controller.ts:34-37`, `ai-models.controller.ts:39-42`). Новый контроллер — точно тот же паттерн.
- `TenantGuard` на суперадмин-контроллерах намеренно отсутствует (суперадмин работает поперёк всех Org) — не добавлять.

## Принятые решения владельца (не пересматривать)

Полный список Р1–Р13 — в `plans/architecture/2026-07-03-llm-cost-dashboard.md` (разделы 7-8), сюда не дублирую целиком. Ключевые для реализации:
- Р1: источник — `AiCostDaily`, не пересчёт по `AiUsageLog` на каждый показ.
- Р2/Р12/Р13: только `/admin/analytics/economics` и `/admin/analytics/functions` (список) получают полный редирект; `/admin/analytics/orgs`, `/admin/economics/orgs/[id]`, `/admin/analytics/functions/[taskType]` — хирургическая правка (деньги/дубль-редактор вырезаются, остальное остаётся); `/admin/ai/routing/[taskType]` «Метрики» — встроенная вырезка (не ссылка).
- Р3/Р4: три мёртвых redirect-заглушки (`/admin/economics`, `/admin/usage/functions(+[taskType])`, `/admin/usage/users`) и `getUsersUsage` (бэк+фронт) удаляются насовсем.
- Р5/Р6: только рубли; единое окно расчёта периода везде.
- Р7: таксономия 176 taskType → 4 модуля (см. Фаза 1, дословный список).
- Р8: три параллельные «двери» на уровне 1 (по модели/разделу/компании).
- Р9: CSV-экспорт на каждом уровне.
- Р11: дефолтный период — 30 дней.

## Scope

**Входит:**
- Новый backend-источник данных для 5 уровней с трендом день/неделя, читающий `AiCostDaily` (Фаза 1-2).
- Разовый бэкафилл `AiCostDaily` за 2026-05-09..2026-05-22 (Фаза 3).
- Новый фронт-экран `/admin/analytics/llm-cost` (Фаза 4).
- Удаление мёртвого кода: `getUsersUsage`, 3 redirect-заглушки (Фаза 5).
- Полный редирект 2 чистых витрин + обновление nav (Фаза 6).
- Хирургическая правка 3 гибридных экранов + удаление дубля редактора цепочки (Фазы 7-9).

**Не входит (см. архитектуру раздел 6, не переоткрывать):**
- `/admin/org/economics` (self-service) — не трогаем вообще.
- `/admin/ai/routing` список, вкладки «Цепочка»/«История переключений»/«A/B-тест» в `/admin/ai/routing/[taskType]` — не трогаем (кроме добавления встроенной вырезки в «Метрики», Фаза 4).
- `/admin/ai/catalog`, `/admin/ai/models` — не трогаем.
- Разбивка по пользователю, по tier/success на общей лестнице — сознательно нет (см. границы архитектуры). `AdminAiModelsService.metrics_()` (tier/success по одному taskType) — не трогаем, кроме встраивания в «Метрики» вырезки нового источника РЯДОМ (Фаза 4).
- `AdminDashboardClient.tsx` / `AdminUsageService.getDashboard()` (`/admin` главная «Пульс») — использует те же данные, но это отдельный экран вне периметра 8 — не трогаем, только не удаляй `getDashboard`/`getCallsLog`/`getCallDetails`/`getFunctionCalls` при уборке (Фаза 5) — они не относятся к удаляемым `getUsersUsage`/`getFunctionsUsage`.
- `OrgEconomicsCron.computeForOrg()`, `UnitEconomicsService.getOrg()` — не трогаем реализацию (используются self-service, вне scope), меняем только кто их ВЫЗЫВАЕТ (Фаза 8).
- vNext, отдельная задача: реального человеческого короткого лейбла на каждый из 176 taskType (сегодня и на новом экране самый глубокий уровень показывает `taskType` технической строкой моноширинным шрифтом — как везде в существующих admin-экранах сегодня). `[ASSUMPTION, LOW]`.
- vNext: устранение общей избыточности `OrgEconomicsCron.computeForOrg()` (третья независимая реализация, но обслуживает вне-scope self-service) — зафиксировать строкой в `second-brain/04_не-сделано/README.md`, не чинить сейчас.

## Доказательство выбора (Проход A/Б + challenge-loop)

**Развилка Б1 — форма backend API для 5 уровней.**

*Проход A (выбран).* Пять именованных REST-эндпоинтов под одним контроллером (`overview`, `models/:model`, `modules/:module`, `companies`, `companies/:tenantId`), каждый — своя Zod-DTO, свой Prisma-запрос к `AiCostDaily`.

*Проход Б.* Один универсальный эндпоинт `GET /llm-cost/breakdown?groupBy=model|module|company|none&filterX=...` с discriminated-union Zod-схемой на комбинации `groupBy`+`filter*`.

| Критерий | A | Б |
|---|---|---|
| Соответствие стилю проекта (`admin-usage`, `admin-orgs`, `admin-economics` — везде именованные ресурсы, не generic groupBy) | ✓ | ✗ |
| Swagger читаем без разбора комбинаций параметров | ✓ | ✗ |
| Независимое кэширование под каждый уровень (как `AdminCacheService` у `getDashboard`) | ✓ (просто) | ✗ (нужен ключ-хэш от комбинации) |
| Меньше строк кода на старте | ✗ | ✓ |
| Валидация «level+filter обязателен вместе» | тривиальна (свой параметр на своём роуте) | нужен `.refine()` на комбинации |

Расхождение по 4 из 5 критериев в пользу A — выбрана без второго раунда challenge-loop (не архитектурная развилка «на грани», явное большинство).

**Challenge-loop по А:**
1. *Корень, не симптом?* Да — единый контракт для всех текущих и будущих потребителей (в т.ч. хирургических врезок в старые экраны), а не точечный фикс одного экрана.
2. *Самое эффективное?* Да — `AiCostDaily` уже маленькая (≤ строк на день×tenant×taskType×provider×model), `groupBy`/`$queryRaw` по ней — миллисекунды даже без доп. кэша. Кэш по образцу `AdminCacheService` — не заводим на старте (числа малы), заводить только если профилирование покажет TTFB > 300мс на проде — числовой триггер, не преждевременная оптимизация.
3. *Код ради кода?* Нет — общие куски (построение `WHERE date BETWEEN`, построение тренда по дням) выносятся в приватные хелперы сервиса, не копипастятся 5 раз.

## Прогресс реализации

- [x] Фаза 1 — таксономия (файл-константа)
- [ ] Фаза 2 — backend: 5 эндпоинтов
- [ ] Фаза 3 — бэкафилл 2026-05-09..2026-05-22
- [ ] Фаза 4 — фронт: новый экран
- [ ] Фаза 5 — уборка мёртвого кода
- [ ] Фаза 6 — редирект 2 чистых витрин + nav
- [ ] Фаза 7 — хирургия: список организаций
- [ ] Фаза 8 — хирургия: юнит-экономика компании
- [ ] Фаза 9 — хирургия + дедуп: деталь функции

## Контракт-first

### Фаза 1 — таксономия (файл-константа)

Новый файл `backend/src/modules/admin/economics/llm-cost-module-map.ts`:

```ts
export type LlmCostModule = 'memory_graph' | 'extraction' | 'agent' | 'other';

export const LLM_COST_MODULE_LABELS: Record<LlmCostModule, string> = {
  memory_graph: 'Память/граф',
  extraction: 'Извлечение из разговора',
  agent: 'Агент',
  other: 'Прочее/служебное',
};

// taskType -> модуль. Источник: аудит 2026-07-03 (176 значений LlmTaskType на момент
// написания, см. llm-router.service.ts). taskType, отсутствующий в карте (новый,
// появившийся после аудита) -> 'other' + учитывается в totals.unmapped, чтобы не
// потеряться молча (см. Acceptance).
export const LLM_COST_MODULE_BY_TASK_TYPE: Record<string, LlmCostModule> = {
  'summary': 'extraction',
  'report-by-type': 'extraction',
  'chapters': 'extraction',
  'tasks': 'extraction',
  'chat': 'agent',
  'regenerate-section': 'extraction',
  'custom-prompt': 'extraction',
  'follow-up': 'extraction',
  'clip-title': 'extraction',
  'card-rollup': 'extraction',
  'card-chat': 'agent',
  'block-ingest': 'extraction',
  'chunk-context': 'memory_graph',
  'meeting-skeleton': 'extraction',
  'block-distill': 'memory_graph',
  'block-linker': 'memory_graph',
  'entity-resolver': 'memory_graph',
  'entity-merge-arbiter': 'memory_graph',
  'entity-name-resolve': 'memory_graph',
  'block-link-confirm': 'memory_graph',
  'rag-route': 'memory_graph',
  'rag-plan': 'memory_graph',
  'rag-rerank': 'memory_graph',
  'rag-sufficiency': 'memory_graph',
  'rag-groundedness': 'agent',
  'entity-graph-builder': 'memory_graph',
  'theme-classify': 'memory_graph',
  'theme-summarize': 'memory_graph',
  'reframing': 'extraction',
  'card-rollup-v2': 'extraction',
  'chat-v2': 'agent',
  'goal-alignment': 'memory_graph',
  'dashboard-summary': 'memory_graph',
  'role-profile-build': 'memory_graph',
  'transcript-clean-refine': 'extraction',
  'behavior-refine': 'extraction',
  'meeting-quality-score': 'other',
  'custom-report': 'extraction',
  'chat-v2-cite-select': 'agent',
  'chat-v2-conversation-title': 'agent',
  'meeting-title': 'extraction',
  'regulation-extract': 'extraction',
  'regulation-dedupe': 'memory_graph',
  'knowledge-clone-extract': 'memory_graph',
  'knowledge-clone-merge': 'memory_graph',
  'decision-extract': 'extraction',
  'decision-supersede-detect': 'memory_graph',
  'insight-extract': 'extraction',
  'insight-link-to-decisions': 'memory_graph',
  'idea-extract': 'extraction',
  'idea-cluster-merge': 'memory_graph',
  'probe-formulate': 'memory_graph',
  'idea-status-summarize': 'other',
  'probe-response-classify': 'extraction',
  'probe-quality-judge': 'other',
  'probe-value-gate': 'memory_graph',
  'probe-draft-from-memory': 'memory_graph',
  'subject-memory-rule-extract': 'extraction',
  'subject-memory-judge': 'memory_graph',
  'company-summary-compile': 'memory_graph',
  'task-assignee-arbiter': 'other',
  'debate-decision-supersede': 'memory_graph',
  'debate-decision-supersede-critic': 'memory_graph',
  'debate-decision-supersede-supporter': 'memory_graph',
  'debate-decision-supersede-neutral': 'memory_graph',
  'debate-curation-verify': 'memory_graph',
  'debate-curation-verify-critic': 'memory_graph',
  'debate-curation-verify-supporter': 'memory_graph',
  'debate-curation-verify-neutral': 'memory_graph',
  'debate-conflict-arbiter': 'memory_graph',
  'debate-conflict-arbiter-critic': 'memory_graph',
  'debate-conflict-arbiter-supporter': 'memory_graph',
  'debate-conflict-arbiter-neutral': 'memory_graph',
  'skill-trait-detect': 'extraction',
  'skill-trait-merge': 'memory_graph',
  'skill-trait-verify': 'memory_graph',
  'executable-persona-compile': 'memory_graph',
  'clone-respond': 'agent',
  'skill-trait-concept-name': 'memory_graph',
  'role-principle-synthesize': 'memory_graph',
  'value-motivation-detect': 'extraction',
  'process-marker-detect': 'extraction',
  'cdm-case-interview': 'memory_graph',
  'persona-behavior-judge': 'other',
  'dialog-classify': 'agent',
  'dialog-multi-query': 'memory_graph',
  'dialog-summarize': 'agent',
  'dialog-extract-plan': 'memory_graph',
  'dialog-understand': 'memory_graph',
  'support-clone-draft': 'agent',
  'support-answer-critic': 'agent',
  'support-edit-classify': 'other',
  'support-contour-curate': 'memory_graph',
  'process-template-extract': 'extraction',
  'axis-classify': 'memory_graph',
  'router-fallback': 'other',
  'brand-voice-extract': 'memory_graph',
  'cross-functional-friction-summary': 'extraction',
  'role-map-extract': 'memory_graph',
  'role-completeness-rationale': 'other',
  'concierge-respond': 'agent',
  'concierge-toolcall-validate': 'other',
  'assistant-confirm-classify': 'agent',
  'checkin-parse': 'extraction',
  'operations-summary': 'extraction',
  'checkin-sentiment': 'extraction',
  'checkin-sentiment-batch': 'extraction',
  'operations-weekly-digest': 'extraction',
  'operations-daily-digest': 'extraction',
  'operations-monthly-digest': 'extraction',
  'customer-risk-digest': 'extraction',
  'personal-brief-hint': 'extraction',
  'blocker-synthesis-summary': 'extraction',
  'value-recap-narrative': 'extraction',
  'commitment-extract-dates': 'other',
  'orchestrator-plan': 'agent',
  'orchestrator-subagent': 'agent',
  'orchestrator-synthesize': 'agent',
  'orchestrator-verify': 'agent',
  'proactive-message-craft': 'agent',
  'helpfulness-detect': 'extraction',
  'helpfulness-trait-merge': 'memory_graph',
  'helpfulness-spotlight-formulate': 'other',
  'recognition-formulate': 'other',
  'issue-infer-fields': 'extraction',
  'issue-goal-suggest': 'memory_graph',
  'meeting-extract-actions': 'extraction',
  'intake-auto-triage': 'extraction',
  'telegram-create-task': 'extraction',
  'telegram-forward-to-task': 'extraction',
  'telegram-reply-classify': 'extraction',
  'telegram-digest-formulate': 'extraction',
  'meeting-report-fast': 'extraction',
  'fact-supersede-detect': 'memory_graph',
  'feedback.cluster': 'memory_graph',
  'sprint-helper-suggest': 'other',
  'sprint-review-summary': 'extraction',
  'autorule-extract': 'other',
  'concierge-step-prm': 'other',
  'practice-skill-extract': 'extraction',
  'practice-skill-adversarial-verify': 'other',
  'team-health-analyzer': 'other',
  'reflection-quality-scorer': 'other',
  'hr-recommender': 'other',
  'meeting-speaker-analyzer': 'extraction',
  'forecast-weekly': 'other',
  'sprint-daily-digest': 'extraction',
  'sprint-weekly-digest': 'extraction',
  'issue-progress-draft': 'extraction',
  'issue-activity-digest': 'extraction',
  'goal-vector-tracker': 'other',
  'decision-hygiene': 'other',
  'table-infer-schema': 'other',
  'table-architect-pass': 'other',
  'table-entity-check': 'other',
  'table-extract-rows': 'extraction',
  'table-auto-fill': 'other',
  'table-semantic-filter': 'other',
  'goal-extract': 'extraction',
  'task-extract': 'extraction',
  'goal-hierarchy-link': 'memory_graph',
  'goals-pulse-summarize': 'extraction',
  'chatbox-summary': 'extraction',
  'knowledge-specialists-combined': 'extraction',
  'dialog-multi-query-clone': 'memory_graph',
  'experiment-extract': 'extraction',
  'experiment-summarize-lessons': 'memory_graph',
  'task-dedupe': 'memory_graph',
  'task-dedup-arbiter': 'memory_graph',
  'task-closure-verify': 'extraction',
  'goal-task-link': 'memory_graph',
  'document-attribution-suggest': 'other',
  'document-summarize': 'other',
  'client-meeting-split': 'extraction',
  'compile-org-document': 'memory_graph',
  'chat-summary': 'extraction',
};

export function resolveLlmCostModule(taskType: string): LlmCostModule {
  return LLM_COST_MODULE_BY_TASK_TYPE[taskType] ?? 'other';
}
```

**Acceptance Фазы 1:**
- `bunx vitest run` новый файл `llm-cost-module-map.spec.ts`: для каждого значения union `LlmTaskType` из `backend/src/modules/ai/services/llm-router.service.ts` (импортировать тип, пройтись через `Object.keys` эквивалента рантайм-массива `ALL_LLM_TASK_TYPES`, уже импортируемого в `admin-usage.service.ts:5`) — `resolveLlmCostModule(t)` возвращает не `undefined` (всегда попадает в один из 4). Тест **не проверяет, что каждый taskType есть в explicit-карте** (новые `taskType`, добавленные после написания карты, ожидаемо падают в `'other'` через `??` — это штатное поведение, не баг теста).
- `grep -c "': '" backend/src/modules/admin/economics/llm-cost-module-map.ts` даёт число записей ≥ 170 (весь список выше, дословно).
- `bun run typecheck` зелёный.

Закрывает: R1.

### Фаза 2 — backend: 5 эндпоинтов

Новые файлы: `backend/src/modules/admin/economics/llm-cost-dashboard.controller.ts`, `llm-cost-dashboard.service.ts`, `backend/src/modules/admin/dto/llm-cost-dashboard.dto.ts`.

**DTO** (Zod, файл `llm-cost-dashboard.dto.ts`):
```ts
import { z } from 'zod';

export const LlmCostPeriodSchema = z.enum(['7d', '30d', '90d']).default('30d');
export type LlmCostPeriod = z.infer<typeof LlmCostPeriodSchema>;

export const LlmCostTrendGranularitySchema = z.enum(['day', 'week']).default('day');

export const LlmCostOverviewQuerySchema = z.object({
  period: LlmCostPeriodSchema,
  trend: LlmCostTrendGranularitySchema,
});
export type LlmCostOverviewQuery = z.infer<typeof LlmCostOverviewQuerySchema>;

export const LlmCostModelQuerySchema = LlmCostOverviewQuerySchema;
export const LlmCostModuleQuerySchema = LlmCostOverviewQuerySchema;

export const LlmCostCompaniesQuerySchema = z.object({
  period: LlmCostPeriodSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  search: z.string().optional(),
});
export type LlmCostCompaniesQuery = z.infer<typeof LlmCostCompaniesQuerySchema>;

export const LlmCostCompanyDetailQuerySchema = LlmCostOverviewQuerySchema;
```
`[ASSUMPTION, LOW]`: период фиксирован на `'7d'|'30d'|'90d'` без `custom from/to` на первой итерации — макет архитектуры показывает `[7д 30д 90д Свой▾]`, но владелец явно закрыл только «дефолт 30 дней» (Р11), про `Свой` период отдельного решения не было. Если при фронт-реализации (Фаза 4) понадобится `custom` — добавь `from`/`to` опциональными полями по образцу `DashboardQuery` (`admin-usage.dto.ts:6-15`), не блокируйся, это тривиальное расширение схемы.

**Типы ответов** (в `llm-cost-dashboard.service.ts`):
```ts
export interface LlmCostTrendPoint { date: string; costRub: number; }

export interface LlmCostOverviewView {
  period: LlmCostPeriod;
  totals: { costRub: number; callsCount: number; prevPeriodCostRub: number | null; changePct: number | null };
  trend: LlmCostTrendPoint[];
  byModel: Array<{ model: string; costRub: number; sharePct: number }>;
  byModule: Array<{ module: LlmCostModule; label: string; costRub: number; sharePct: number }>;
  topCompanies: Array<{ tenantId: string; name: string; costRub: number; sharePct: number }>; // top 20
}

export interface LlmCostModelDetailView {
  model: string;
  totals: { costRub: number; sharePct: number };
  trend: LlmCostTrendPoint[];
  byModule: Array<{ module: LlmCostModule; label: string; costRub: number; sharePct: number }>;
}

export interface LlmCostModuleDetailView {
  module: LlmCostModule;
  label: string;
  totals: { costRub: number; sharePct: number };
  trend: LlmCostTrendPoint[];
  byTaskType: Array<{ taskType: string; costRub: number; callsCount: number }>;
}

export interface LlmCostCompanyRow {
  tenantId: string; name: string; costRub: number; sharePct: number; trend: LlmCostTrendPoint[];
}
export interface LlmCostCompaniesView { items: LlmCostCompanyRow[]; nextCursor: string | null; }

export interface LlmCostCompanyDetailView {
  tenantId: string; name: string;
  totals: { costRub: number };
  trend: LlmCostTrendPoint[];
  byModel: Array<{ model: string; costRub: number; sharePct: number }>;
}
```

**Сервис** — все запросы через `prisma.aiCostDaily.groupBy`/`aggregate` (НЕ `$queryRaw` — модель маленькая, `groupBy` типобезопасен и достаточен, в отличие от `AiUsageLog`-based соседей, которым `$queryRaw` был нужен для смешанных SUM/COUNT/FILTER в одном проходе):

```ts
// backend/src/modules/admin/economics/llm-cost-dashboard.service.ts
@Injectable()
export class LlmCostDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private periodToDays(period: LlmCostPeriod): number {
    return period === '7d' ? 7 : period === '30d' ? 30 : 90;
  }

  private dateRange(period: LlmCostPeriod): { gte: Date; lt: Date; prevGte: Date } {
    const days = this.periodToDays(period);
    const now = new Date();
    const lt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const gte = new Date(lt.getTime() - days * 86_400_000);
    const prevGte = new Date(gte.getTime() - days * 86_400_000);
    return { gte, lt, prevGte };
  }

  private async buildTrend(where: Prisma.AiCostDailyWhereInput, granularity: 'day' | 'week'): Promise<LlmCostTrendPoint[]> {
    const rows = await this.prisma.aiCostDaily.groupBy({
      by: ['date'],
      where,
      _sum: { costRub: true },
      orderBy: { date: 'asc' },
    });
    if (granularity === 'day') {
      return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), costRub: Number(r._sum.costRub ?? 0) }));
    }
    // week: ISO-неделя, ключ — понедельник недели в формате YYYY-MM-DD
    const byWeek = new Map<string, number>();
    for (const r of rows) {
      const d = r.date;
      const day = (d.getUTCDay() + 6) % 7; // 0=Пн
      const monday = new Date(d.getTime() - day * 86_400_000);
      const key = monday.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) ?? 0) + Number(r._sum.costRub ?? 0));
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, costRub]) => ({ date, costRub }));
  }

  async overview(q: LlmCostOverviewQuery): Promise<LlmCostOverviewView> { /* ... */ }
  async modelDetail(model: string, q: LlmCostModelQuery): Promise<LlmCostModelDetailView> { /* ... */ }
  async moduleDetail(module: LlmCostModule, q: LlmCostModuleQuery): Promise<LlmCostModuleDetailView> { /* ... */ }
  async companies(q: LlmCostCompaniesQuery): Promise<LlmCostCompaniesView> { /* ... */ }
  async companyDetail(tenantId: string, q: LlmCostCompanyDetailQuery): Promise<LlmCostCompanyDetailView> { /* ... */ }
}
```

`[ASSUMPTION, LOW]`: тела `overview`/`modelDetail`/`moduleDetail`/`companies`/`companyDetail` не расписаны построчно (это была бы избыточная детализация — принцип «не описывай, что уже говорят имена» из CLAUDE.md применим и к ТЗ). Обязательный паттерн для КАЖДОГО метода: (а) один `groupBy`/`aggregate` по `AiCostDaily` с нужным `by`/`where`, (б) `sharePct = row.costRub / totals.costRub * 100` считать в TS после запроса, не в SQL, (в) для `byModel`/`byModule`/`topCompanies`/`byTaskType` — группировка по `model`/`resolveLlmCostModule(taskType)` (модуль — TS-группировка после чтения `taskType`-groupBy, а не SQL, т.к. маппинг — не колонка БД) /`tenantId`/`taskType` соответственно, СВЕРНУТАЯ по `costRub` (`SUM`), не по количеству строк. `topCompanies` — `orderBy _sum.costRub desc, take 20`, имена подтягивать одним `prisma.org.findMany({where:{id:{in:...}}})` (как в `unit-economics.service.ts:63-66`). `companies()` — курсорная пагинация по образцу `admin-usage.service.ts::getUsersUsage` (`:406-414`, `encodeCursor`/`decodeCursor` base64 JSON), поиск — `Prisma.OrgWhereInput.OR` на `name`/`slug` (как `admin-orgs.service.ts:92-97`), для каждой строки — свой `buildTrend({tenantId, date: {gte,lt}}, granularity)` (не более `limit` штук за раз — не N+1 в SQL-смысле, но N+1 в смысле числа вызовов `buildTrend`; при `limit<=50` это приемлемо, профилировать только если появится жалоба на скорость — числовой триггер).

**Контроллер:**
```ts
// backend/src/modules/admin/economics/llm-cost-dashboard.controller.ts
@ApiExcludeController()
@Controller('api/v1/admin/llm-cost')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class LlmCostDashboardController {
  constructor(private readonly svc: LlmCostDashboardService) {}

  @Get('overview')
  overview(@Query(new ZodValidationPipe(LlmCostOverviewQuerySchema)) q: LlmCostOverviewQuery) {
    return this.svc.overview(q);
  }

  @Get('models/:model')
  modelDetail(@Param('model') model: string, @Query(new ZodValidationPipe(LlmCostModelQuerySchema)) q: LlmCostModelQuery) {
    return this.svc.modelDetail(decodeURIComponent(model), q);
  }

  @Get('modules/:module')
  moduleDetail(@Param('module') module: LlmCostModule, @Query(new ZodValidationPipe(LlmCostModuleQuerySchema)) q: LlmCostModuleQuery) {
    return this.svc.moduleDetail(module, q);
  }

  @Get('companies')
  companies(@Query(new ZodValidationPipe(LlmCostCompaniesQuerySchema)) q: LlmCostCompaniesQuery) {
    return this.svc.companies(q);
  }

  @Get('companies/:tenantId')
  companyDetail(@Param('tenantId') tenantId: string, @Query(new ZodValidationPipe(LlmCostCompanyDetailQuerySchema)) q: LlmCostCompanyDetailQuery) {
    return this.svc.companyDetail(tenantId, q);
  }
}
```

Регистрация: добавить `LlmCostDashboardController` в `controllers: [...]` и `LlmCostDashboardService` в `providers: [...]` файла `backend/src/modules/admin/admin.module.ts` (тот же файл, что регистрирует `AdminUsageController`/`AdminUsageService` — точки вставки `admin.module.ts:102`/`:127` как якорь по аналогии, точные строки перечитать перед правкой).

**Acceptance Фазы 2:**
- `bunx vitest run src/modules/admin/economics/llm-cost-dashboard.service.spec.ts` — новый файл, минимум: (а) `overview()` на фикстуре из 3 `AiCostDaily` строк (2 модели, 2 модуля через 2 taskType, 2 компании) возвращает верные суммы/доли/тренд; (б) `companyDetail()` для несуществующего `tenantId` возвращает `totals.costRub === 0`, пустой `byModel`, не бросает; (в) `moduleDetail('other', ...)` агрегирует все taskType с модулем `other`, включая ЗАВЕДОМО отсутствующий в карте (проверяет fallback из Фазы 1 сквозным путём).
- `curl -s localhost:3000/api/v1/admin/llm-cost/overview?period=30d\&trend=day` (в контейнере, залогинившись суперадмином) возвращает 200 и валидный JSON по `LlmCostOverviewView`.
- Swagger `/api/docs` НЕ содержит новый контроллер (подтверждён `@ApiExcludeController()`, как и все соседи).
- `bun run typecheck && bun run lint && bun run build` зелёные.

Закрывает: R2, R3, R4, R5.

### Фаза 3 — бэкафилл 2026-05-09..2026-05-22

Новый файл `backend/scripts/backfill-ai-cost-daily-gap.ts`, по образцу `backend/scripts/backfill-commitment-due-dates.ts` (идемпотентность-check → `NestFactory.createApplicationContext(AppModule)` → работа → выход):

```ts
import { AppModule } from '../src/app.module';
import { DailyCostAggregatorCron } from '../src/modules/admin/economics/daily-cost-aggregator.cron';
import { createPrismaClient } from './_lib/prisma';

const GAP_START = '2026-05-09'; // включительно — раньше AiUsageLog не существует
const GAP_END_EXCLUSIVE = '2026-05-24'; // исключительно — с этой даты крон уже сам считал

async function main() {
  // eslint-disable-next-line no-console
  console.log('=== START backfill-ai-cost-daily-gap ===');
  const preCheckPrisma = createPrismaClient();
  const existing = await preCheckPrisma.aiCostDaily.count({
    where: { date: { gte: new Date(GAP_START), lt: new Date(GAP_END_EXCLUSIVE) } },
  });
  await preCheckPrisma.$disconnect();
  if (existing > 0) {
    // eslint-disable-next-line no-console
    console.log(`Уже применено (${existing} строк в диапазоне). Выход.`);
    return;
  }

  const { NestFactory } = await import('@nestjs/core');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const cron = app.get(DailyCostAggregatorCron);

  let date = new Date(GAP_START);
  const end = new Date(GAP_END_EXCLUSIVE);
  let totalRows = 0;
  while (date < end) {
    const result = await cron.runForDate(date);
    totalRows += result.rowsUpserted;
    // eslint-disable-next-line no-console
    console.log(`progress: date=${result.date} rowsUpserted=${result.rowsUpserted}`);
    date = new Date(date.getTime() + 86_400_000);
  }
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`=== DONE: ${totalRows} строк за 14 дней ===`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

Регистрация в `backend/scripts/apply-prod-deploy.ts` STEPS (секция `backfill`, добавить рядом с существующими записями `:668-676`):
```ts
{ phase: 'backfill', script: 'scripts/backfill-ai-cost-daily-gap.ts', skipBootstrap: true, hint: 'AiCostDaily за 2026-05-09..2026-05-23 — период до появления ночного крона' },
```

**Acceptance Фазы 3:**
- Локальный прогон `bun run scripts/backfill-ai-cost-daily-gap.ts` на dev-БД: после первого прогона `prisma.aiCostDaily.count({where:{date:{gte: new Date('2026-05-09'), lt: new Date('2026-05-24')}}})` > 0 (если в dev-БД вообще есть `AiUsageLog` за этот период — если нет, скрипт должен завершиться без ошибки с `rowsUpserted=0` за каждый день, это тоже корректный сценарий, не баг).
- Повторный запуск скрипта сразу после первого — печатает «Уже применено» и не создаёт дублей (идемпотентность, `@@unique` в `AiCostDaily` защищает от дублей даже если pre-check пропустят, но pre-check должен ловить это раньше).
- Запись добавлена в `apply-prod-deploy.ts` STEPS, `bun run typecheck` зелёный.

Закрывает: R6.

### Фаза 4 — фронт: новый экран `/admin/analytics/llm-cost`

Новые файлы:
- `frontend/app/(admin)/admin/analytics/llm-cost/page.tsx` — тонкая обёртка (`Metadata` + рендер клиента).
- `frontend/app/(admin)/admin/analytics/llm-cost/LlmCostDashboardClient.tsx` — вся логика 5 уровней.
- `frontend/src/api/admin-llm-cost.api.ts` — API-клиент (5 методов, зеркалящих контроллер Фазы 2).
- `frontend/src/domain/admin-llm-cost.ts` — `ApiDto → DomainModel` мапперы + `formatRub()`.

**Контракт навигации внутри экрана** (важно для Фаз 6-9, которые на него ссылаются): состояние уровня — в query-параметрах URL, ПО ОБРАЗЦУ `AdminTabs` (`paramName`-синхронизация с `useSearchParams`), не 5 отдельных app-router путей:
- `?view=overview&period=30d` — уровень 1 (дефолт).
- `?view=model&id=<model>&period=30d` — уровень 2.
- `?view=module&id=<module>&period=30d` — уровень 3.
- `?view=companies&period=30d` — уровень 4 (список).
- `?view=company&id=<tenantId>&period=30d` — уровень 5.

Это ЕДИНЫЙ публичный контракт URL, на который ссылаются Фазы 6-9 («Смотреть расход →» ссылки с других экранов) — не меняй без обновления всех ссылающихся мест.

**Компоненты для переиспользования** (не создавать новые):
- Тренд-график — `AreaTrend` (`frontend/src/ui/components/dashboard/modern/AreaTrend.tsx`) для уровней 1-3 и 5; `AdminSparkline` (`frontend/src/ui/components/admin/AdminSparkline.tsx`) — в ячейках таблицы уровня 4.
- `AdminSection` — обёртка каждого уровня (`breadcrumbs`, `title`, `actions` — период-селектор справа).
- `useAdminQuery` — загрузка данных каждого уровня.
- `AdminEmpty`/`AdminError`/`AdminLoading` (`AdminStateViews.tsx`) — пустое/ошибка/загрузка состояния, единообразно с остальными admin-экранами.
- `AdminCsvDownloadButton` — на каждом уровне, `rows`=текущий загруженный breakdown-массив уровня, `columns` подобрать по видимым колонкам таблицы этого уровня.

**Acceptance Фазы 4:**
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
- Playwright/ручная проверка (см. общий DoD): заход на `/admin/analytics/llm-cost` под суперадмином показывает уровень 1 с графиком, тремя блоками (модель/раздел/компания), клик по любому — переход на соответствующий `?view=...`, URL меняется, `←` возвращает назад.
- Клик по строке компании на уровне 4 → уровень 5 показывает разбивку по моделям, сумма совпадает (± копейка на округление) с суммой этой компании на уровне 4.
- Пустой период (например, orgs без вызовов) — `AdminEmpty`, не пустая таблица без объяснения.
- Кнопка «Скачать CSV» присутствует и работает на каждом из 5 уровней.
- `/admin/ai/routing/[taskType]` вкладка «Метрики» (`RoutingDetailClient.tsx:520-645`, приватная функция `MetricsTabSection`) — рядом с существующей tier/success-разбивкой (не трогать её код) добавлена компактная врезка: заголовок «Расход по общему дашборду» + `costRub`/тренд за период из `adminLlmCostApi.moduleDetail`/`modelDetail` **отфильтрованный на этот taskType** — здесь нужен доп. метод `GET /api/v1/admin/llm-cost/task-types/:taskType` (простая обёртка: `aiCostDaily.groupBy({by:['date'], where:{taskType}})` + totals, без module/model разбивки) — добавь в контроллер/сервис Фазы 2 как 6-й эндпоинт `taskTypeDetail(taskType, query)`, тот же паттерн. Плюс ссылка «Смотреть в общем дашборде →» на `?view=module&id=<модуль этого taskType>`.

Закрывает: R7, R8, R9, R10, R11 (Р8/Р9/Р10/Р11 архитектуры).

### Фаза 5 — уборка мёртвого кода (независима от Фаз 2-4, можно делать первой/параллельно)

Удалить целиком:
- `frontend/app/(admin)/admin/economics/page.tsx` (redirect-заглушка).
- `frontend/app/(admin)/admin/usage/` — вся директория: `functions/page.tsx`, `functions/FunctionsClient.tsx`, `functions/[taskType]/page.tsx`, `functions/[taskType]/FunctionDetailClient.tsx`, `users/page.tsx`, `users/UsersUsageClient.tsx`.
- `backend/src/modules/admin/services/admin-usage.service.ts::getUsersUsage()` (`:304-416`) и всё, что использует ТОЛЬКО она (проверь перед удалением грепом `getUsersUsage` по всему backend — если найдётся второй вызывающий помимо контроллера, ОСТАНОВИСЬ и сообщи, не удаляй).
- `backend/src/modules/admin/controllers/admin-usage.controller.ts::users()` метод (`:54-56`).
- `UsersUsageQuerySchema`/`UsersUsageQuery`/`AdminUsersUsageRow`/`AdminUsersUsageApi` — грепни каждое имя по всему `backend/`+`frontend/` перед удалением, удаляй только если 0 остальных использований.
- `frontend/src/api/admin-usage.api.ts::getUsers` метод + типы `UsersUsageRequest`.
- В `backend/src/modules/admin/controllers/admin-usage.controller.ts::streamCsv` (`:120-158`) — убрать ветку `kind==='users'` (вызывала `getUsersUsage`); в `ExportCsvQuerySchema` (`admin-usage.dto.ts:57-67`) — убрать `'users'` из enum `kind`.

**Acceptance Фазы 5:**
- `grep -rn "getUsersUsage\|UsersUsageClient\|FunctionsClient\b" backend/src frontend/app frontend/src` — 0 совпадений (кроме этого ТЗ и второго мозга).
- `curl -I localhost:3000/api/v1/admin/usage/users` (после деплоя) → 404 (роут снят), не 500.
- Заход на `/admin/usage/users` (старый URL) → Next.js 404 (страницы больше нет физически — ЭТО ожидаемо, не баг: Р3 архитектуры явно требует «удаляются насовсем», не редирект).
- `bun run typecheck && bun run lint && bun run build` (backend и frontend) зелёные.

Закрывает: R12 (Р3, Р4 архитектуры).

### Фаза 6 — полный редирект 2 чистых витрин + nav

Зависит от Фазы 4 (нужен готовый URL `/admin/analytics/llm-cost`).

- `frontend/app/(admin)/admin/analytics/economics/page.tsx` — заменить содержимое на `redirect('/admin/analytics/llm-cost')` (по образцу `frontend/app/(admin)/admin/economics/page.tsx` ДО его удаления в Фазе 5 — скопируй паттерн, не сам файл). Удалить `EconomicsAnalyticsClient.tsx`.
- `frontend/app/(admin)/admin/analytics/functions/page.tsx` — заменить на `redirect('/admin/analytics/llm-cost?view=module')`. Удалить `FunctionsAnalyticsClient.tsx`. **Не трогать** `frontend/app/(admin)/admin/analytics/functions/[taskType]/` — это Фаза 9.
- Backend: `unit-economics.service.ts::getGlobal()` (`:16-123`) + маршрут `AdminEconomicsController` `GET unit-economics/global` (`admin-economics.controller.ts:48-53`) — удалить (грепни `getGlobal`/`unit-economics/global` перед удалением, как в Фазе 5).
- Backend: `admin-usage.service.ts::getFunctionsUsage()` (`:519-598`) + маршрут `admin-usage.controller.ts::functions()` (`:90-92`) — удалить (эта функция обслуживала ТОЛЬКО список; `functionCalls`/`getFunctionCalls` — другая функция, НЕ удалять, используется Фазой 9). Убрать `'functions'` из `ExportCsvQuerySchema.kind` enum и из `streamCsv`.
- `frontend/app/(admin)/admin/navigation.ts` — в секции `analytics` (`:104-151`) удалить пункты `href:"/admin/analytics/functions"` (label «Функции LLM») и `href:"/admin/analytics/economics"` (label «Юнит-экономика»); добавить один новый пункт `{ href: "/admin/analytics/llm-cost", label: "Расход на LLM", icon: CircleDollarSign, matchPrefix: "/admin/analytics/llm-cost" }` (иконка `CircleDollarSign` уже импортирована в файле, `:11`).

**Acceptance Фазы 6:**
- Заход на `/admin/analytics/economics` и `/admin/analytics/functions` (старые URL) → мгновенный редирект на `/admin/analytics/llm-cost` (соотв. с `?view=module` для второго) — проверить `curl -I` (307/308) или Playwright `page.goto` + итоговый URL.
- В сайдбаре админки: пункты «Функции LLM»/«Юнит-экономика» отсутствуют, есть «Расход на LLM», клик по нему открывает новый экран.
- `grep -rn "getGlobal\|getFunctionsUsage" backend/src` — 0 совпадений вне комментариев/тестов на удаление.
- `bun run typecheck && bun run lint && bun run build` зелёные (backend + frontend).

Закрывает: R13 (Р2 первая половина, Р6 частично).

### Фаза 7 — хирургия: список организаций (`/admin/analytics/orgs`)

Зависит от Фазы 4.

- `backend/src/modules/admin/services/admin-orgs.service.ts::listOrgs()` (`:81-153`) — убрать блок `prisma.aiUsageLog.groupBy` (`:111-119`) и поля `costUsdInPeriod`/`callsInPeriod` из `AdminOrgRow` (`:9-24`) и из формируемого `items` (`:147-148`).
- `frontend/src/domain/admin-org.ts` (`:19-59`) — убрать `costUsdInPeriod` из `AdminOrgRowApi`/`AdminOrgRowDomain` и из маппера.
- `frontend/app/(admin)/admin/analytics/orgs/OrgsAnalyticsClient.tsx` — колонка «Расход» (`:161`, значение `:195` `formatUsd(...)`) заменяется на колонку-ссылку: `<Link href={`/admin/analytics/llm-cost?view=company&id=${o.id}`}>Смотреть расход →</Link>`. Убрать импорт/использование `formatUsd` если он после этого больше нигде на странице не нужен (грепни перед удалением импорта).
- CSV-экспорт этой страницы (`:105`, колонка `"Расход, USD"`, `:68` значение) — убрать колонку из CSV-состава (раз данных больше нет).

**Acceptance Фазы 7:**
- `/admin/analytics/orgs` открывается, показывает список организаций с тарифом/подпиской/участниками как раньше, колонка расхода заменена ссылкой, клик по ссылке ведёт на уровень 5 нового дашборда с этой компанией.
- `grep -n "costUsdInPeriod" backend/src frontend/src frontend/app` — 0 совпадений.
- `bunx vitest run src/modules/admin/services/admin-orgs.service.spec.ts` (если существует — обновить под новую сигнатуру `AdminOrgRow` без `costUsdInPeriod`; если не существует — не заводить новый тестовый файл специально под эту правку, это регресс, не новая фича).
- `bun run typecheck && bun run lint && bun run build` зелёные.

Закрывает: R14 (Р12 часть 1).

### Фаза 8 — хирургия: юнит-экономика одной компании (`/admin/economics/orgs/[id]`)

Зависит от Фазы 4. **Не трогать** `UnitEconomicsService.getOrg()` саму реализацию и `OrgEconomicsController`/`/api/v1/org/economics/current` — они обслуживают вне-scope self-service.

- `frontend/app/(admin)/admin/economics/orgs/[id]/OrgEconomicsDetailClient.tsx` — заменить вызов `adminEconomicsApi.org(tenantId, {days:30})` (`:27`) на `adminEconomicsApi.getBudget(tenantId)` (уже существует, `admin-economics.api.ts:26-29`) для начальной загрузки блока бюджета; убрать рендер totals/topTaskTypes (30д/MTD/топ-5 задач), заменить на карточку-ссылку «Смотреть расход этой компании → /admin/analytics/llm-cost?view=company&id={tenantId}». Оставить без изменений форму `setBudget` (`:35`, редактирование лимита) и её UI.
- Backend: `AdminEconomicsController` — удалить маршрут `GET unit-economics/orgs/:id` (`:56-62`, вызывал `svc.getOrg`) — **только этот HTTP-роут суперадмин-контроллера**, НЕ `UnitEconomicsService.getOrg()` (метод остаётся, его продолжает вызывать `OrgEconomicsController` для self-service). Грепни `adminEconomicsApi.org(` перед удалением роута — должно остаться 0 вызывающих во фронте после правки этой же фазы.

**Acceptance Фазы 8:**
- `/admin/economics/orgs/[id]` открывается, показывает блок «Бюджет» (текущий лимит, форма редактирования работает — `PATCH .../budget` по-прежнему проходит), плюс ссылку на новый дашборд вместо старых totals/топ-задач.
- `/admin/org/economics` (self-service, вне scope) — открывается и работает БЕЗ ИЗМЕНЕНИЙ (регресс-проверка: `curl` или Playwright, значения совпадают с состоянием до этой фазы).
- `grep -n "adminEconomicsApi.org(" frontend/app frontend/src` — 0 совпадений.
- `bun run typecheck && bun run lint && bun run build` зелёные.

Закрывает: R15 (Р12 часть 2).

### Фаза 9 — хирургия + дедуп: деталь функции (`/admin/analytics/functions/[taskType]`)

Зависит от Фазы 4 (ссылка на новый дашборд) и наличия `/admin/ai/routing/[taskType]` (уже существует, не трогаем структурно).

- `frontend/app/(admin)/admin/analytics/functions/[taskType]/FunctionDetailAnalyticsClient.tsx` — убрать: состояние `providers`/`isActive`/`dirty`/`saving`, функцию `handleSave` (вызывала `adminAiModelsApi.putChain`), связанный UI редактирования цепочки (выбор provider/model, кнопка сохранения, `window.prompt` на причину). Заменить на карточку-ссылку «Настроить модель для этой операции → /admin/ai/routing/{encodeURIComponent(taskType)}» (ведёт на канонический редактор, вкладка «Цепочка» открывается там по умолчанию).
- Там же — убрать собственный расчёт стоимости (что бы ни показывал `adminFunctionsApi.detail(taskType)` из денежной части — грепни `adminFunctionsApi.detail` реализацию в `admin-experiments.api.ts` перед правкой, чтобы не сломать НЕ-денежные поля, которые эта же ручка может отдавать, например `isActive`/`providers` для отображения текущей цепочки БЕЗ редактирования — оставь read-only показ текущей цепочки, если он был, убери только форму РЕДАКТИРОВАНИЯ и сохранение). Добавить рядом карточку-ссылку «Смотреть расход этой операции → /admin/analytics/llm-cost?view=module&id={модуль этого taskType}» (модуль — через `resolveLlmCostModule(taskType)`, для этого фронту нужен доступ к той же карте — либо продублировать маленькую константу на фронте `frontend/src/domain/admin-llm-cost.ts` (Фаза 4) с тем же содержимым что в Фазе 1 backend-константы, либо (рекомендую) отдать `module` в ответе нового 6-го эндпоинта `taskTypeDetail` из Фазы 4-acceptance — тогда фронту не нужно дублировать карту).
- Оставить без изменений: вкладку/блок «Последние вызовы» (`adminUsageApi.getFunctionCalls`, не удалять — единственная оставшаяся уникальная функция этой страницы после хирургии).
- Добавить входящую ссылку: на уровне 3 нового дашборда (`?view=module&id=...`), в списке «Показать полный список из N видов» (Фаза 4) — каждая строка `taskType` кликабельна и ведёт на `/admin/analytics/functions/{taskType}` (чтобы страница не осиротела после удаления пункта «Функции LLM» из списка/nav в Фазе 6 — это ЕДИНСТВЕННЫЙ оставшийся путь навигации к ней из интерфейса, помимо прямого URL).

**Acceptance Фазы 9:**
- `grep -n "putChain" frontend/app/\(admin\)/admin/analytics/functions` — 0 совпадений (дубль убран).
- `grep -c "putChain" backend/src/modules/admin/ai-models` — было N вызывающих мест эндпоинта, после фазы ссылается только `/admin/ai/routing/[taskType]` (RoutingDetailClient.tsx) — backend-эндпоинт `PUT .../chain` не удаляем (он общий, используется каноническим редактором).
- Заход на `/admin/analytics/functions/{taskType}` показывает: ссылку на «Роутинг моделей» для этого taskType, ссылку на новый дашборд для расхода, работающий блок «Последние вызовы». Редактирования цепочки на этой странице больше нет.
- Клик на любой taskType в списке уровня 3 нового дашборда открывает эту страницу.
- `bun run typecheck && bun run lint && bun run build` зелёные (frontend).

Закрывает: R16 (Р12 часть 3, Р13).

## Границы фазы (общие для всех фаз)

- ✅ **Always**: переиспользовать существующие admin-UI-примитивы (`AdminSection`/`AdminTabs`/`AdminStateViews`/`AdminCsvDownloadButton`/`AdminSparkline`/`AreaTrend`); писать суммы только в рублях; грепать перед удалением любого метода/типа/файла, если явно не сказано «удалить безусловно».
- ⚠️ **Ask first**: если грep перед удалением (Фазы 5-9) находит НЕОЖИДАННОГО второго вызывающего — остановиться, не удалять, сообщить в чат конкретный path:line находки.
- 🚫 **Never**: не трогать `/admin/org/economics`, `/admin/ai/routing` (кроме врезки в «Метрики»), `/admin/ai/catalog`, `/admin/ai/models`, `AdminDashboardClient.tsx`/`getDashboard`; не вводить `process.env.*` напрямую; не использовать `prisma migrate`/`db push` (новых полей/таблиц это ТЗ не требует — только чтение существующей `AiCostDaily`, миграций нет вообще).

## Граф зависимостей фаз

```
Фаза 1 (таксономия) ──┐
                       ├──> Фаза 2 (backend API) ──> Фаза 4 (frontend экран) ──┬──> Фаза 6 (2 редиректа + nav)
Фаза 3 (бэкафилл, независима от 1-2) ──────────────────────────────────────────┼──> Фаза 7 (orgs список)
                                                                                 ├──> Фаза 8 (org economics detail)
Фаза 5 (уборка мёртвого кода, независима от всего) ─────────────────────────────┴──> Фаза 9 (functions detail + дедуп)
```
Фазы 5 и 3 можно делать в любой момент (нет входящих зависимостей). Фазы 6-9 нельзя начинать до готовности Фазы 4 (нужен рабочий URL `/admin/analytics/llm-cost`). Фазы 6, 7, 8, 9 между собой независимы (разные файлы) — можно параллелить.

## Требования (EARS)

- **R1**: Когда `resolveLlmCostModule(taskType)` вызывается с любым `taskType` из `ALL_LLM_TASK_TYPES`, система shall вернуть один из 4 модулей, никогда `undefined`.
- **R2**: Когда суперадмин запрашивает `GET /admin/llm-cost/overview?period=30d`, система shall вернуть totals+trend+topN по модели/модулю/компании, посчитанные из `AiCostDaily`, не из `AiUsageLog`.
- **R3**: Если запрошенный `period` не входит в `{7d,30d,90d}`, система shall отклонить запрос 400 (Zod-валидация).
- **R4**: Когда данных за период нет (пустая `AiCostDaily` в диапазоне), система shall вернуть нулевые totals и пустые массивы, не 500.
- **R5**: Все суммы в ответах эндпоинтов Фазы 2 shall быть в рублях (`costRub`), поле `costUsd` в новых DTO shall отсутствовать.
- **R6**: После прогона бэкафилла, `AiCostDaily` shall содержать строки за каждый день 2026-05-09..2026-05-23 включительно, для которых существовали данные в `AiUsageLog`.
- **R7**: Когда суперадмин открывает `/admin/analytics/llm-cost`, система shall показать уровень 1 по умолчанию с периодом 30 дней.
- **R8**: Когда суперадмин кликает по компании на уровне 4, система shall перейти на уровень 5 с суммой, равной сумме этой компании на уровне 4 (±1 копейка округления).
- **R9**: На каждом из 5 уровней shall присутствовать работающая кнопка CSV-экспорта.
- **R10**: Вкладка «Метрики» в `/admin/ai/routing/[taskType]` shall показывать врезку из нового источника, не ломая существующую tier/success-разбивку.
- **R11**: Если пользователь переходит по старому URL `/admin/analytics/economics` или `/admin/analytics/functions`, система shall редиректить на `/admin/analytics/llm-cost` (с `?view=module` для второго случая).
- **R12**: Если пользователь переходит на `/admin/usage/users`, `/admin/usage/functions`, `/admin/economics` (старые URL), система shall вернуть 404 (страницы физически удалены).
- **R13**: `/admin/analytics/orgs` shall продолжать показывать список организаций со всеми текущими нефинансовыми колонками после удаления денежной колонки.
- **R14**: `/admin/economics/orgs/[id]` shall продолжать позволять редактировать бюджет-лимит компании (`PATCH .../budget`) без регрессии.
- **R15**: `/admin/org/economics` (self-service) shall работать без каких-либо изменений в поведении или данных после всех фаз этого ТЗ.
- **R16**: После Фазы 9, попытка отредактировать цепочку моделей shall быть возможна только через `/admin/ai/routing/[taskType]`, не через `/admin/analytics/functions/[taskType]`.

## Pre-mortem / риски

| Риск | Вероятность | Что делаем |
|---|---|---|
| Грep перед удалением находит неожиданного второго вызывающего (`getUsersUsage`, `getFunctionsUsage`, `getGlobal`, `adminEconomicsApi.org`) | Средняя — код меняется быстро, между разведкой и реализацией могло что-то добавиться | Явно предписано в каждой фазе: находка → стоп, не удалять, спросить (⚠️ Ask first) |
| `AiCostDaily` пуста в dev-окружении (нет накопленных ночей) — Фазы 2/4 приёмка через `curl`/Playwright покажет пустые экраны, это не отличить от бага | Средняя | Перед Фазой 2-acceptance прогнать `DailyCostAggregatorCron.runForDate()` вручную на 2-3 датах dev-БД (или дождаться Фазы 3 бэкафилла) — иначе тестировать не на чем |
| `sharePct`-деление на 0 при `totals.costRub === 0` | Низкая, но гарантированно всплывёт на пустом периоде | Явно проверять `totals.costRub > 0 ? x/totals*100 : 0` во всех местах расчёта доли (R4) |
| `/admin/analytics/functions/[taskType]` после хирургии (Фаза 9) становится «пустым» местом навигации, если забыть входящую ссылку с уровня 3 | Средняя — легко забыть при копипасте фазы | Явно прописано отдельным пунктом в Фазе 9 + Фазе 4-acceptance |
| Двойной редирект (Фаза 6 стр. `/admin/economics` уже удалена в Фазе 5, но кто-то держит в закладке старый `/admin/economics` → сегодня redirect на `/admin/analytics/economics`, которая после Фазы 6 сама redirect на новый дашборд) | Уже неактуально — Фаза 5 удаляет `/admin/economics` целиком (404), а не оставляет цепочку редиректов | Порядок фаз (5 до/параллельно 6) исключает цепочку |

## Ревью-аспекты (для strict-production-review-gate)

- RBAC: все новые роуты — `CookieAuthGuard+SuperAdminGuard` идентично соседям, `TenantGuard` НЕ добавлен (намеренно, суперадмин кросс-tenant).
- Идемпотентность: бэкафилл-скрипт (Фаза 3) — двойной прогон не дублирует строки (`@@unique` + pre-check).
- Наблюdаемость: новые эндпоинты не требуют новых метрик prom-client (чтение, не запись, синхронный HTTP) — `[N/A: чисто read-only admin-эндпоинты, аналогично соседним admin-usage/admin-orgs без метрик]`.
- Обработка ошибок: пустые периоды/несуществующие `model`/`module`/`tenantId` в URL — не 500, см. R4.
- Миграции данных: только бэкафилл (Фаза 3), не меняет существующие строки, только заполняет пробел.
- Rollout/флаг: Ship-On — фича идёт сразу включённой, флага не заводим (не деньги/доступ по CLAUDE.md принципу 8, чистая read-only витрина).
- Тесты: unit на `resolveLlmCostModule` (Фаза 1) и `LlmCostDashboardService` (Фаза 2); регресс-проверка self-service (Фаза 8) и nav (Фаза 6) — вручную/Playwright, отдельных vitest-файлов не заводим под UI-регресс (не принято в этом проекте для чистого фронта, см. `frontend/README`/существующие спеки).

## DoD

- `bun run typecheck && bun run lint && bun run build` — зелёные и в `backend/`, и в `frontend/`.
- `bun run test:unit` (backend) — зелёный, включая новые файлы Фаз 1-2.
- Второй мозг обновлён по чек-листу CLAUDE.md: новый контроллер/эндпоинт → `second-brain/01_projects/api-layer.md` + `docs/operations/prod-deploy-log.md` Шаг 12 (Swagger smoke — хотя контроллер `@ApiExcludeController`, всё равно завести пункт ручной проверки); новый `backfill-*.ts` → `prod-deploy-log.md` Шаг 8; строка про `AiCostDaily`/`DailyCostAggregatorCron` в `second-brain/04_не-сделано/README.md` — убрать из «Открыто», перенести в «Закрытые» с этим ТЗ.
- Рефлексия в `second-brain/05_история/2026-07-03-llm-cost-dashboard.md` (или следующей датой, если реализация растянется на другой день) после выката.
- Ручная/Playwright проверка golden path (описана в Acceptance каждой фазы) пройдена лично, не только тесты.

## Итог

Статус на момент написания ТЗ: **не реализовано** — только контракт. Реализация — задача `tz-orchestrator`, фаза за фазой, в порядке графа зависимостей выше. Заполнить после реализации: какие фазы закрыты, что осталось, результаты верификации.
