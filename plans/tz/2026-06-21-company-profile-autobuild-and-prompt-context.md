---
type: tz
status: ready-to-implement
feature: company-profile-autobuild-and-prompt-context
date: 2026-06-21
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-21-subject-memory-and-self-learning/99-synthesis.md
  - plans/archive/2026-06-15-chat-v2-unified-answer-prompt.md
  - plans/archive/2026-06-14-assistant-router-dedup-and-prompt.md
  - second-brain/04_не-сделано/README.md
---
> Анализ: `plans/analysis/2026-06-21-subject-memory-and-self-learning/99-synthesis.md` (Слой 1) · Статус согласования: 2026-06-21
> Закрывает строку №67 реестра «не сделано» (профиль компании в промпт).

# Слой 1 — Авто-профиль компании + подстановка контекста в промпты

## Цель + Зачем
**Болезненное состояние:** агенты Коры представляются «Корой», а не сотрудником **конкретной** компании; не знают, чем компания занимается → отвечают обобщённо. Реестр «не сделано» №67. Поле `CompanyProfile` существует, но **не наполняется** (cron создаёт пустышку).

**Что строим:** агент-компилятор раз в N часов собирает **краткое описание компании** (3–5 абзацев «чем занимается, продукты, рынок, как себя называет») из графа знаний с провенансом, кладёт в `CompanyProfile`; владелец может **закрепить** (pinned) — авто-сборка закреплённое не перетирает; короткий **org-capsule** (1 абзац) подставляется в SYSTEM ассистента и chat-v2 **отдельным стабильным per-tenant хвостом** (cache-friendly), фактура — через текущий RAG.

**Метрика «решено»:** `CompanyProfile.summaryJson` непуст у активных тенантов; capsule присутствует в SYSTEM chat-v2 и ассистента; prompt-cache hit-rate ассистента ≥60% (не деградировал).

## REALITY-CHECK (по коду на 2026-06-21)
- **Модель готова, поля провенанса есть.** `CompanyProfile` ([schema.prisma:5568](../../backend/prisma/schema.prisma#L5568)): `displayName`, `missionJson/visionJson/strategyJson`, `stage`, `maturityScore`, **`sourceBlockIds[]` + `confidence`** (задел под авто-сбор) — но нет отдельного «summary» (краткое «чем занимается»).
- **Точка подстановки УЖЕ существует и УЖЕ cache-friendly.** `chat-v2.service.ts` собирает **стабильный per-tenant хвост «## О компании» в КОНЕЦ SYSTEM** — `buildCompanyAboutSection` ([chat-v2.service.ts:1259](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L1259)), вызывается из `buildSystemPrompt` ([chat-v2.service.ts:1303](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L1303)); summary/history переехали в конец USER (ТЗ 2026-06-15 §6 — SYSTEM стабилен). **Это ровно позиция, которую советует red-team.** Сейчас хвост отдаёт только `displayName`+`stage` — обогатить его summary.
- **Cron существует, но пустой.** `CompanyProfileBuilderCron` ([company-profile-builder.cron.ts:19](../../backend/src/modules/company-foundation/workers/company-profile-builder.cron.ts#L19)) только `getOrCreate` (lazy-create), **граф не читает**. `MaturityScorerCron` — образец cron'а, считающего по графу.
- **Ассистент (concierge) — БЕЗ «О компании».** `concierge-respond.prompt.ts` / `concierge-context-builder.service.ts` хвоста компании не имеют (реестр №67 «помощник: future»). Это gap, который закрываем.
- **`update()` для ручной правки есть** ([company-profile.service.ts:33](../../backend/src/modules/company-foundation/services/company-profile.service.ts#L33)) + аудит. Контроллер `company.controller.ts`, фронт `/company` (`CompanyClient.tsx`, домен `company-profile.ts`).

**Вывод:** механизм подстановки и модель готовы; новый — (а) компилятор summary из графа, (б) поле summary + pinned, (в) обогащение хвоста, (г) такой же хвост у ассистента. Достройка.

## Принятые решения владельца (из синтеза §6/§6-bis, не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Гибрид: авто-summary из графа + **ручное закрепление** (pinned не перетирается авто) | синтез §6 Слой 1; сохраняет контроль владельца |
| Р2 | Capsule (1 абзац) — **отдельным стабильным хвостом ПОСЛЕ BASE_SYSTEM_PROMPT**, НЕ в начале/середине | red-team `98`: регенерация внутри SYSTEM обнуляет prompt-cache всем запросам |
| Р3 | Фактура — через текущий RAG, capsule только самоидентификация+суть | синтез §4: лидеры на RAG; capsule для тональности |
| Р4 | Свежесть источников summary решает **код по `max(occurredAt)`** | синтез §4 (verified) |
| Р5 | Интервал пересчёта + enable — **AdminSetting**, не ENV | CLAUDE.md принцип 9 |
| Р6 | Гейт качества: prompt-cache hit-rate ассистента **≥60%** | red-team `98` |

## Доказательство выбора
Синтез §6 (Слой 1). Сжато:

| Критерий | A: текст в начале SYSTEM | B: чистый RAG, без capsule | C (выбран): capsule отдельным хвостом + RAG |
|---|---|---|---|
| prompt-cache | ✗ ломает всем | ✓ | ✓ (стабильный суффикс) |
| Самоидентификация «я сотрудник X» | ✓ | ✗ слабо | ✓ |
| Свежесть фактуры | ✗ устаревает | ✓ | ✓ |
| Токены | ✗ растёт | ✓ | ✓ (1 абзац) |
| Реюз кода | — | частично | ✓ (`buildCompanyAboutSection` уже есть) |

**Отвергнуто:** A — обнуляет кэш (red-team); B — теряет «кто я» (нужно для тона ассистента-сотрудника).

## Scope
**Входит:** поле `summaryJson` + `summaryPinned` в `CompanyProfile`; агент-компилятор summary из графа (cron, провенанс, `max(occurredAt)`); обогащение `buildCompanyAboutSection` (capsule из summary); такой же стабильный хвост в SYSTEM ассистента (concierge); крутилки AdminSetting; ручное закрепление через `update()`+UI-флаг; метрика cache hit-rate.
**Не входит (vNext):** (а) авто-профили отделов (`Department.missionStatement` — аналогично, отдельным ТЗ `department-profile-autobuild`); (б) показ источников/confidence summary в UI чата → vNext `company-summary-provenance-ui`; (в) summary в промпты извлечения отчётов/задач (этот ТЗ — chat-v2 + ассистент) → опц. позже.

## Граничные контракты
- **С chat-v2:** правим только `buildCompanyAboutSection`/`buildSystemPrompt`; BASE_SYSTEM_PROMPT и порядок «SYSTEM стабилен / данные в USER» НЕ трогаем (snapshot-спек `chat-v2-base-prompt.snapshot` не должен дрейфовать без причины — capsule идёт в per-tenant хвост, не в BASE).
- **С company-foundation:** компилятор пишет через `CompanyProfileService` (новый метод `applyAutoSummary`), не напрямую в Prisma из cron'а (как `applyMaturity`).
- **С knowledge-core:** компилятор читает граф read-only (IdeaBlock/Entity/Decision/Goal по tenantId); не пишет в граф.

## Контракт-first

### Prisma (расширить `CompanyProfile`)
```prisma
/// Краткое описание «чем компания занимается»: { contentMd, generatedAt }.
/// Источник capsule в промптах. JSON — как mission/vision (без alter при расширении).
summaryJson    Json?
/// true → summary закреплён владельцем; авто-компилятор НЕ перетирает. Р1
summaryPinned  Boolean  @default(false)
```
(`sourceBlockIds`/`confidence` уже есть — компилятор их заполняет.)

### Метод сервиса
```ts
// company-profile.service.ts
async applyAutoSummary(args: {
  tenantId: string;
  contentMd: string;
  sourceBlockIds: string[];
  confidence: number;
}): Promise<{ applied: boolean; reason: string }>;
// если summaryPinned=true → { applied:false, reason:'pinned' } (Р1)
```

### AdminSetting (реестр + сид + getDynamic)
| Ключ | Тип | Дефолт | Смысл |
|---|---|---|---|
| `companyProfile.autoSummaryEnabled` | boolean | `true` | kill-switch авто-компилятора |
| `companyProfile.summaryRebuildHours` | number | `24` | интервал пересчёта |
| `companyProfile.summaryMinSourceBlocks` | number | `8` | минимум блоков графа, иначе summary не строим (cold-start fallback на ручной ввод) |

### Capsule-формат (хвост SYSTEM, после BASE_SYSTEM_PROMPT)
```
## О компании
Вы — сотрудник и аналитик компании «{displayName}». Чем занимается: {summary.contentMd (обрезка ~600 симв.)}.
{stage ? «Стадия: {stageRu}.» : ''}
```
Стабилен per-tenant (меняется только при смене summary) — Р2.

## Фазы

### Фаза 1 — Поле summary + AdminSetting `[x]`
**Файлы:** `schema.prisma` (+`summaryJson`,`summaryPinned`); миграция; DTO `company-profile.dto.ts` (+summary в `CompanyProfileDto` и `UpdateCompanyProfileSchema` + `summaryPinned`); `company-profile.service.ts` (`toDto`/`update` поддерживают summary+pinned, `applyAutoSummary`); `admin-setting-schema-registry.ts` (+3 ключа)+сид.
**Что НЕ входит:** компилятор, подстановка.
**Acceptance:** `grep summaryJson schema.prisma`; миграция создаётся; `update({summary, summaryPinned})` сохраняет; `applyAutoSummary` при `pinned=true` → `{applied:false,reason:'pinned'}` (unit); typecheck/generate зелёные; сид идемпотентен.
**Закрывает:** модель + крутилки.

### Фаза 2 — Агент-компилятор summary из графа `[ ]`
**Файлы (new):** `company-summary-compiler.cron.ts` (или расширить `CompanyProfileBuilderCron`) — `@Cron`, интервал `summaryRebuildHours`; читает топ-блоки графа по tenantId (Entity/IdeaBlock/Decision/Goal), отбирает свежие по `max(occurredAt)` (Р4); промпт `company-summary-compile.prompt.ts` (cache-friendly) → `{contentMd}`; зовёт `applyAutoSummary` с `sourceBlockIds`+`confidence`; если блоков < `summaryMinSourceBlocks` → пропуск (cold-start). taskType `company-summary-compile` (capable, DeepSeek V4 Pro).
**Acceptance:** unit: при ≥порога блоков → `CompanyProfile.summaryJson` непуст, `sourceBlockIds` заполнены, `confidence` 0..1; при pinned → не перетёрто; при < порога → пропуск + метрика; kill-switch off → cron no-op. typecheck/lint/build.
**Закрывает:** авто-сбор, Р1, Р4.

### Фаза 3 — Подстановка capsule в chat-v2 + ассистент `[ ]`
**Файлы:** `chat-v2.service.ts` `buildCompanyAboutSection` ([:1259](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L1259)) — добавить `summary.contentMd` в хвост (обрезка ~600 симв.), позиция БЕЗ изменений (хвост после BASE). Ассистент: `concierge-context-builder.service.ts`/`concierge-respond.prompt.ts` — добавить тот же стабильный per-tenant хвост «## О компании» в конец SYSTEM (читает `CompanyProfileService.getRaw`). Метрика `company_capsule_injected_total{surface}`.
**Что НЕ входит:** UI источников.
**Acceptance:** unit chat-v2: при непустом summary — хвост содержит «Чем занимается:»; при пустом — мягко пропускается (как сейчас, fail-soft); BASE_SYSTEM_PROMPT не изменился (snapshot-спек зелёный — capsule вне BASE). Ассистент: SYSTEM содержит хвост «## О компании» при наличии профиля. Наблюдать: prompt-cache hit-rate ассистента ≥60% (Р6) — зафиксировать в метриках/проде.
**Закрывает:** №67 реестра, Р2, Р3, Р6.

### Фаза 4 — UI закрепления summary `[ ]`
**Файлы:** `frontend/.../company/CompanyClient.tsx` + `company.api.ts` + домен `company-profile.ts` — показать авто-summary (read), поле редактирования + переключатель «Закрепить» (`summaryPinned`); русский UI, парные токены.
**Acceptance:** на `/company` видно авто-summary; правка+закрепление сохраняются (`PATCH`); после закрепления авто-компилятор не перетирает (e2e/ручная); ни одного англ. слова в UI.
**Закрывает:** Р1 (контроль владельца), strict-production-review-gate (RBAC: только admin Org правит).

## Совместимость с prompt caching
Capsule = стабильный per-tenant суффикс SYSTEM (Р2). BASE_SYSTEM_PROMPT неизменен → кэш общего префикса жив; меняется только при реальной смене summary компании. `company-summary-compile` — стабильный SYSTEM, граф-данные в конце user.

## Pre-mortem / Риски
- **Раздувание capsule** → жёсткая обрезка ~600 симв.; ревью: capsule не тянет mission+vision+strategy целиком, только суть.
- **Cold-start (мало данных)** → `summaryMinSourceBlocks` + fallback на ручной ввод; пустой summary не ломает промпт (fail-soft, как сейчас).
- **Кэш-деградация** → Р6 метрика; capsule НЕ в начале SYSTEM.
- **Перетирание ручного текста** → `summaryPinned` тест обязателен.

## Idempotency / flag / prod-deploy
- Миграция (Шаг 4), сид настроек идемпотентен (Шаг 7), новый @Cron (Шаг 12 smoke).
- `companyProfile.autoSummaryEnabled` = kill-switch → `feature-flags.md`.
- prod-deploy-log Шаги 4, 12; ENV новых нет (всё AdminSetting, Шаг 1 — n/a).

## DoD
typecheck/lint/build; vitest; `01_projects/{ai-jobs,admin,frontend-pages}` + `02_architecture/data-model` обновить; `04_не-сделано` №67 → перенести в «Закрытые» после выката; vNext-строки (department-profile, provenance-ui); prod-deploy-log + feature-flags; рефлексия.

## Итог
_(заполнит tz-orchestrator)_
