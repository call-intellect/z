---
type: tz
status: ready-to-implement
feature: meeting-tasks-quality-dedup-asr
date: 2026-06-06
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-06-handoff-brief-all-prod-fixes.md
  - plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md
  - plans/tz/2026-06-06-meeting-report-reliability-and-ui-honesty.md
---

> Анализ-источник: `deep-root-cause-analysis-prod-issues.md` §5 (E), §11 (ASR + агенты) · бриф §ТЗ-4 · Статус согласования: решения decisive (бриф, «минимально, без тяжёлого глоссария»).
> Цель в одну строку: убрать видимые **дубли и потери задач** и поднять понимание сырой речи — **усилением дедупа (числа/скобки), ASR-нотой и инъекцией org-контекста в промпты**, поверх уже сделанного reliability-ТЗ (merge fast+main, ASR `segments[].words`).

---

## 1. Цель и зачем (человеческим языком)

**Что владелец видел.** Задачи извлекаются с **дублями** («Сделать рассылку на **2000**» и «на **2 000**»; «Набрать команду» и «Набрать команду **(…)**») и **потерями** (терялись «200 встреч», «50 сделок»). Плюс ASR врёт на числах/терминах: «100 платящих»→«стопящих», «10 месяцев»→«10 минусов».

**Корень (доказан кодом + 2 встречами):**
1. **Слабый дедуп.** `pickPrimaryTasks` нормализует только `trim+lowercase` ([task.ts:58-68](../../frontend/src/domain/task.ts#L58-L68)) → «2000»/«2 000» (пробел-разделитель тысяч) и скобочные уточнения не схлопываются.
2. **ASR искажает вход, и это не лечится в промптах.** `transcript-clean-refine` НАМЕРЕННО не правит числа/имена ([:29,:37](../../backend/src/modules/ai/services/prompts/transcript-clean-refine.ts#L29)); в framing-хелперах [common.ts](../../backend/src/modules/ai/services/prompts/common.ts) есть преамбула/injection-guard/confidence/edge-case, но **НЕТ ноты про ASR** — модели нигде не сказано «это распознавание речи, возможны ошибки в числах/именах, восстанавливай смысл по контексту».
3. **Контекст компании не инъектится в summary/report.** Только task-экстракторы получают `formatParticipantsForPrompt` ([participant-context.ts:58](../../backend/src/modules/ai/services/prompts/participant-context.ts#L58)) — имена участников ЭТОЙ встречи. summary/report-by-type org-контекст (проекты/цели/люди) **не получают**, хотя загрузчик уже есть ([meeting-extract-actions.service.ts:413-449](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L413-L449) `loadOrgContext`).

**Чем решение лучше.** Демонстрация (§11.3 анализа): тот же гарбленый ASR-вход с ASR-нотой + контекстом восстанавливает «выйти на **100 платящих** клиентов», «провести **10** встреч-презентаций», «**500** рассылок», «10 минусов»→«10 месяцев». Дедуп с нормализацией чисел/скобок убирает ровно те дубли, что видел владелец. **Минимально — без тяжёлого глоссария** (только нота + реюз готового контекста).

---

## 2. REALITY-CHECK (что по факту в коде / что уже сделано reliability-ТЗ)

| Проверено | Факт | Источник |
|---|---|---|
| `pickPrimaryTasks` — УЖЕ merge | reliability Ф2 заменил «есть fast → только fast» на объединение fast+main с дедупом `trim+lowercase` | [task.ts:58-68](../../frontend/src/domain/task.ts#L58-L68) |
| Счётчики задач — УЖЕ унифицированы | reliability Ф2: бейдж/стат-карта/«Action items» читают `pickPrimaryTasks(Task)` (не `aiResult.tasks`) | reliability-ТЗ Ф2 |
| ASR word-ts — УЖЕ в работе | reliability Ф3: `segments[].words` + диагностика `vox.no_words` (корень не подтверждён без сырого прод-ответа) | reliability-ТЗ Ф3, commit `c26348df` |
| Паттерн ASR-ноты есть куда лечь | `common.ts`: `withRoomChatNote`/`withConfidenceCalibration`/`withEdgeCasePolicy`/`withZPreamble`/`withInjectionGuard` — все `withX(systemBody)` дописывают в КОНЕЦ system (cache-friendly) | [common.ts:181,272,331,357](../../backend/src/modules/ai/services/prompts/common.ts#L181) |
| Org-контекст-загрузчик есть | `loadOrgContext(tenantId, startedAt)` → `{projects, goals, people, meetingDateIso}` — **приватный** в meeting-extract-actions | [meeting-extract-actions.service.ts:413-449](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L413-L449) |
| Контекст участников — только в tasks | `formatParticipantsForPrompt` + `PARTICIPANT_IDENTIFICATION_RULES` используются `tasks-v2/tasks-unified/tasks-structured`, НЕ summary/report | [participant-context.ts:56,82](../../backend/src/modules/ai/services/prompts/participant-context.ts#L56) |
| Task-экстракторы | `tasks` (analyze.runTasks, main), `meeting-report-fast` (fast), `meeting-extract-actions` (IntakeIssue); промпты `tasks-unified.ts`/`tasks-structured.ts` | glob `prompts/tasks*.ts` |
| Маршрут task-экстракторов | `tasks`/`meeting-extract-actions` → `deepseek-v4-flash` (дёшево) | анализ §9 |
| transcript-clean — НЕ трогаем | правило «числа/имена — без изменений» намеренно; ASR-нота идёт в summary/report/tasks, НЕ в очистку | [transcript-clean-refine.ts:37](../../backend/src/modules/ai/services/prompts/transcript-clean-refine.ts#L37) |

**Следствие:** «показ всех задач» и «единый счётчик» УЖЕ сделаны (reliability Ф2) — **не дублировать**. Остаётся: усилить дедуп (числа/скобки) поверх merge; ASR-нота; org-контекст в summary/report; (опц.) capable-модель. «Единый канонический источник» (fast не персистит) — vNext (см. §5), т.к. reliability только что отгрузил merge-подход и он работает.

---

## 3. Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран).** Усилить дедуп в существующем merge + ASR-нота + org-контекст (+ опц. capable-модель). Строит на уже отгруженном.
**Проход B (альтернатива, бриф решение #1).** Реструктура «единый канонический источник»: fast НЕ персистит Task, канон — один main/structured; structuredData.tasks/IntakeIssue деривят из Task.

| Критерий | A: дедуп+ASR+контекст на остатке | B: единый источник (реструктура) |
|---|---|---|
| Чинит видимый дубль владельца («2000»/«2 000», скобки) | ✅ прямо (нормализация) | ⚠️ косвенно (убирает fast/main, но дубли внутри main остаются без нормализации) |
| Риск регрессии | ✅ низкий (точечная функция + аддитивные ноты) | ✗ средний — ломает только что отгруженный merge (reliability Ф2), может потерять fast-задачи если main слаб |
| Минимальность (просьба владельца) | ✅ да | ✗ нет (рефактор 3 писателей + дерив-контракты) |
| Качество извлечения на сыром ASR | ✅ ASR-нота+контекст бьют в корень | — (не про это) |

**Вывод.** A — минимально, чинит ровно то, что видел владелец, не ломает отгруженное. B полезен архитектурно, но избыточен и рискован сейчас → **vNext** (§5). Дедуп-нормализация — это и есть корень дублей (не симптом): чинит КЛАСС «числовые/скобочные варианты одной задачи».

**Challenge-loop:**
- *Корень?* Да — дедуп-нормализация бьёт в корень «варианты одной задачи»; ASR-нота — в корень «модель не знает про ASR-ошибки»; org-контекст — в корень «модель не цепляет имена/термины». Не симптомы.
- *Эффективнее?* Да — реюз `withX`-паттерна и `loadOrgContext` (не новые системы); глоссарий не строим (владелец просил минимум).
- *Кода ради кода?* Нет — `withAsrNote` 1 константа + 1 хелпер; org-контекст — вынос существующего загрузчика, не новый.

---

## 4. Принятые решения владельца (decisive, не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | **Усилить `pickPrimaryTasks`-нормализацию:** срезать скобочные уточнения, убрать пробелы-разделители тысяч («2 000»→«2000»), пунктуацию — ПЕРЕД сравнением. Семантический (эмбеддинг) дедуп — опц./vNext. | Это ровно дубли, что видел владелец. Нормализация перед сравнением — корень класса; эмбеддинг-дедуп тяжелее и не нужен для текущего кейса (минимально). Только нормализация, НЕ fuzzy — чтобы не схлопнуть реально разные задачи. |
| Р2 | **ASR-нота:** `withAsrNote(system)` в `common.ts` (как `withRoomChatNote`), применить к summary/report-by-type/tasks/extract-actions. **Без глоссария.** | Самый дешёвый способ поднять понимание речи без замены ASR (демонстрация §11.3). Нота — стабильная константа в КОНЕЦ SYSTEM → cache-friendly. Глоссарий — тяжёлая система, владелец просил минимум. |
| Р3 | **Инъекция org-контекста** (проекты/цели/люди) в summary/report-by-type — выносом `loadOrgContext` в общий сервис, реюз. | Модель цепляет имена/термины компании, не теряет конкретику. Реюз существующего загрузчика, не новая система. |
| Р4 | **(опц., tunable) Capable-модель на task-экстракцию:** `tasks`/`meeting-extract-actions` → `deepseek-v4-pro` через admin-editable route. | Capable стабильнее тащит конкретику на коротком тексте (§5 анализа: структурный агент дал 6/6). Цена pro выше — потому через admin-route (`feedback_admin_settings_not_env_or_code`), владелец флипает и мерит. taskType не массовый как граф. |

> Развилок нет. «Единый источник» (бриф решение #1) осознанно отложен в vNext (§5) — reliability отгрузил merge, минимально-разумно строить на нём.

---

## 5. Scope

**Входит:**
1. Усиление нормализации в `pickPrimaryTasks` (frontend `task.ts`) — Р1.
2. `ASR_NOTE` + `withAsrNote(system)` в `common.ts`; применение к summary/report-by-type/tasks/extract-actions — Р2.
3. Вынос `loadOrgContext` в общий сервис + инъекция компактного org-контекста в summary/report-by-type — Р3.
4. (опц.) Маршрут `tasks`/`meeting-extract-actions` → `deepseek-v4-pro` (admin-route/seed-патч) — Р4.

**Не входит (vNext, с судьбой):**
- **Единый канонический источник Task** (fast→preview-only, structuredData.tasks/IntakeIssue деривят из Task) — отдельное ТЗ, предусловие: не ломать reliability-merge; ссылка: бриф §ТЗ-4 решение #1, анализ §5. → `plans/tz/` vNext.
- **Семантический (эмбеддинг) дедуп** близких заголовков — vNext, если нормализации недостаточно (числовой триггер: >2 ложных дублей/встреча после Р1).
- **ASR word-ts корень** (почему vox пуст) — ведёт reliability Ф3 (`vox.no_words` доберёт форму); смена ASR-модели — решение владельца + отдельное ТЗ.
- Показ всех задач / единый счётчик — УЖЕ сделано (reliability Ф2), не дублировать.

---

## 6. Контракт (что именно поменять)

### 6.1 Усиление дедупа (Фаза 1) — `frontend/src/domain/task.ts`
Заменить `norm` в `pickPrimaryTasks`:
```ts
/** Нормализация заголовка для дедупа: числа без разделителей, без скобочных уточнений и пунктуации. НЕ fuzzy. */
export function normTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')                  // «Набрать команду (3 чел)» → «Набрать команду»
    .replace(/(?<=\d)[\s ]+(?=\d)/g, '')     // «2 000»→«2000», «1 000 000»→«1000000» (lookaround, один проход)
    .replace(/[«»"'`.,;:!?()]/g, ' ')             // пунктуация → пробел
    .replace(/\s+/g, ' ')
    .trim();
}
// в pickPrimaryTasks: const norm = (t: TaskDomain) => normTaskTitle(t.title);
```
> Экспортировать `normTaskTitle` для юнит-теста. Логику merge (fast приоритетнее) НЕ менять — только усилить `norm`.

### 6.2 ASR-нота (Фаза 2) — `backend/src/modules/ai/services/prompts/common.ts`
Добавить (по образцу `ROOM_CHAT_SYSTEM_NOTE` + `withRoomChatNote`):
```ts
/** Нота про ASR-происхождение транскрипта. Дописывается в КОНЕЦ system (cache-friendly). */
export const ASR_NOTE = `Учти: текст диалога — результат автоматического распознавания речи (ASR), не дословная стенограмма.
Возможны ошибки в числах, единицах, именах и терминах: «100 платящих» может распознаться как «стопящих», «10 месяцев» — как «10 минусов», «2 000» и «2000» — это одно число.
Восстанавливай вероятный смысл по контексту встречи (тема, роли, ранее названные цифры); нормализуй числа (убирай пробелы-разделители тысяч).
Не выдумывай факты, которых нет, — только исправляй очевидные искажения распознавания.`;

/** Дописывает ASR_NOTE к system. Применять в meeting-промптах поверх сырого ASR. */
export function withAsrNote(systemBody: string): string {
  return `${systemBody}\n\n${ASR_NOTE}`;
}
```
Применить `withAsrNote(...)` в system-билдерах: summary ([system-summary.ts](../../backend/src/modules/ai/services/prompts/system-summary.ts)), report-by-type ([type-*.ts](../../backend/src/modules/ai/services/prompts/) — в общий билдер отчёта или каждый `type-*`), task-экстракция ([tasks-unified.ts](../../backend/src/modules/ai/services/prompts/tasks-unified.ts), [tasks-structured.ts](../../backend/src/modules/ai/services/prompts/tasks-structured.ts)), `meeting-extract-actions`. **Композиция как у `withRoomChatNote`** (тот же call-site). Перечитать билдеры перед правкой — где уже стоят `withZPreamble`/`withRoomChatNote`, туда же `withAsrNote`.

### 6.3 Org-контекст в summary/report (Фаза 3)
Вынести `loadOrgContext` из `meeting-extract-actions.service.ts` в общий `OrgContextService` (модуль `tracker` или `ai`-shared), сигнатура без изменений: `loadOrgContext(tenantId, meetingStartedAt): Promise<{projects, goals, people, meetingDateIso}>`. `meeting-extract-actions` зовёт его же (без поведенческой регрессии). Добавить в `common.ts` форматтер + хелпер:
```ts
export function formatOrgContextForPrompt(ctx: { projects: {identifier?: string|null; name: string}[]; goals: {name: string}[]; people: {name: string}[] }): string { /* компактные строки: проекты, активные цели, сотрудники */ }
export function withOrgContextNote(systemBody: string, ctx: ...): string { /* дописать блок контекста + краткую инструкцию «связывай имена/термины с этим контекстом» */ }
```
Инъекция в summary + report-by-type system (analyze.worker `runSummary`/`runStructuredReport`): загрузить org-контекст по `meeting.tenantId` (⚠ verify: tenantId доступен в analyze.worker) и обернуть system `withOrgContextNote`. Блок — стабильная часть SYSTEM (cache-friendly: данные org меняются редко, кэш живёт между встречами одной org).

### 6.4 (опц.) Capable-модель (Фаза 4)
Маршрут `tasks` и `meeting-extract-actions` → `deepseek-v4-pro` через **admin-editable route** (UI админки) ИЛИ seed-патч `backend/scripts/patch-task-extractor-route-pro.ts` (`createPrismaClient()` из `_lib/prisma`, идемпотентно, регистрация в `apply-prod-deploy.ts` `STEPS` phase=update). НЕ хардкод модели в коде. Перечитать модель route-реестра перед патчем.

---

## 7. Фазы и Acceptance (машинно-проверяемо)

Граф: Ф1 (frontend) ⟂ Ф2 (промпты) ⟂ Ф3 (org-контекст) ⟂ Ф4 (route) — независимы. Порядок по value/risk: Ф1 → Ф2 → Ф3 → Ф4(опц.).

### Фаза 1 — Сильный дедуп
Файлы: `frontend/src/domain/task.ts` (+`__tests__/task.test.ts`).
**Не входит:** backend, промпты.
**Acceptance:** юнит `normTaskTitle`: `«Сделать рассылку на 2 000»` и `«…на 2000»` → одинаковая норма; `«Набрать команду (3 чел)»` и `«Набрать команду»` → одинаковая; `«1 000 000»`→`«1000000»`; **negative:** `«50 сделок»` и `«200 встреч»` → РАЗНЫЕ нормы (не схлопнуть). `pickPrimaryTasks` с fast=«рассылка 2000»+main=«рассылка 2 000» → 1 строка. `bun run typecheck/lint/test:unit` (frontend) зелёные.
Закрывает: R1.

### Фаза 2 — ASR-нота
Файлы: `common.ts` (+`common.spec.ts`), system-билдеры summary/report/tasks/extract-actions, их snapshot-спеки.
**Не входит:** дедуп, org-контекст, модель.
**Acceptance:** грепы: `ASR_NOTE`/`withAsrNote` в `common.ts`; `withAsrNote(` в билдерах summary/report-by-type/tasks/extract-actions. ASR_NOTE — в КОНЦЕ system (cache-friendly), SYSTEM-префикс стабилен. Снапшот-спеки промптов обновлены и зелёные. `bun run typecheck/lint/build` + затронутые `*.snapshot.spec` зелёные.
Закрывает: R2.

### Фаза 3 — Org-контекст в summary/report
Файлы: `OrgContextService` (new), `meeting-extract-actions.service.ts` (реюз), `common.ts` (форматтер), `analyze.worker.ts` (summary/report инъекция) (+спеки).
**Не входит:** дедуп, модель.
**Acceptance:** грепы: `OrgContextService.loadOrgContext` зовётся и из meeting-extract-actions, и из analyze.worker; `withOrgContextNote(` в summary/report-билдерах. meeting-extract-actions поведение не изменилось (его спек зелёный). `bun run typecheck/lint/build` зелёные.
Закрывает: R3.

### Фаза 4 — (опц.) Capable-модель
Файлы: `patch-task-extractor-route-pro.ts` (new) + `apply-prod-deploy.ts` STEPS.
**Acceptance:** патч идемпотентен (повторный прогон = no-op); после прогона `diag-routes.ts`/`diag llm-calls` показывают `tasks`/`meeting-extract-actions` → `deepseek-v4-pro`. Зарегистрирован в STEPS.
Закрывает: R4.

### Фаза 5 — Прод-верификация (владелец)
**Acceptance:** на тест-встрече с числами/наймами: нет дублей «2000»/«2 000»; задачи «200 встреч»/«50 сделок» извлечены раздельно; на гарбленом ASR-входе числа восстановлены (через `diag report`).

**Требования (EARS):**
- R1: Когда два заголовка задач отличаются только разделителем тысяч/скобочным уточнением/пунктуацией, система shall считать их дублем (одна строка); реально разные — раздельно.
- R2: Система shall дописывать ASR_NOTE в КОНЕЦ SYSTEM промптов summary/report-by-type/tasks/extract-actions (без изменения стабильного префикса — cache-friendly).
- R3: Когда строится summary/report-by-type, система shall инъектить компактный org-контекст (проекты/цели/сотрудники) из общего `OrgContextService`.
- R4: (опц.) Когда выбран capable-режим, система shall маршрутизировать `tasks`/`meeting-extract-actions` в `deepseek-v4-pro` через admin-route.

---

## 8. Границы фичи
- ✅ Always: реюз `withX`-паттерна и `loadOrgContext`; нормализация НЕ fuzzy; русский UI; cache-friendly ноты (стабильный SYSTEM).
- ⚠️ Ask first: семантический/эмбеддинг-дедуп; смена ASR-модели; реструктура источников Task.
- 🚫 Never: глоссарная система (владелец просил минимум); правка `transcript-clean-refine` (намеренно не правит числа); хардкод модели в коде (route — admin-editable).

## 9. Совместимость с prompt caching
- `ASR_NOTE` и org-контекст-блок — **стабильные** части SYSTEM, дописываются в конец (как `withRoomChatNote`/`withConfidenceCalibration`) → префикс не ломается, DeepSeek-кэш сохраняется. Org-контекст меняется редко (проекты/цели/люди) → кэш живёт между встречами одной org.
- Переменные данные (транскрипт) остаются в user-части — правило `feedback_llm_prompts_cache_friendly` соблюдено.

## 10. Риски / pre-mortem (ревью-аспекты)
| Риск | Митигация |
|---|---|
| Нормализация схлопнёт реально разные задачи | только числа/скобки/пунктуация, НЕ fuzzy; negative-тест «50 сделок»≠«200 встреч» (Ф1 acceptance) |
| ASR-нота ломает формат вывода (модель «исправит» лишнее) | нота явно «не выдумывай факты, только искажения распознавания»; снапшот-спеки фиксируют SYSTEM |
| Org-контекст раздувает промпт / ломает кэш | компактный блок (take-лимиты как в loadOrgContext: 40/30/60), стабильный → кэш-дружелюбно |
| tenantId недоступен в analyze.worker | ⚠ verify перед Ф3; если нет — пробросить из meeting |
| pro дороже на task-экстракции | Ф4 опц./tunable через admin-route, владелец мерит цену; не обязательна |

## 11. Idempotency / feature-flag / prod-deploy
- Ф1/Ф2/Ф3 — код (frontend + backend), без схемы/ENV/seed → прод: пересборка backend + деплой фронта; шагов prod-deploy-log не требуется (зафиксировать явно при сдаче).
- Ф4 (опц.) — патч-скрипт route → `prod-deploy-log.md` **Шаг 6** + регистрация в `apply-prod-deploy.ts` STEPS (idempotent acceptance).
- Feature-flag не нужен (улучшение качества, не рискованное внешнее); Ф4 управляется admin-route.

## 12. DoD
- `bun run typecheck`(вкл `.spec`)/`lint`/`build` зелёные (frontend+backend); снапшот-спеки промптов обновлены; юнит `normTaskTitle` (вкл. negative).
- second-brain: `01_projects/ai-jobs.md` (ASR-нота, org-контекст в summary/report), `02_architecture/code-pitfalls.md` (дедуп задач: числа/скобки).
- `docs/operations/prod-deploy-log.md` Шаг 6 — только если делается Ф4.
- Рефлексия в `05_история/`.
- В коде: 0 `process.env.*`, 0 `prisma migrate`, 0 `new PrismaClient(`; ноты cache-friendly.

## Итог
_(заполнит tz-orchestrator: дубли ушли? ASR-нота восстанавливает числа на проде? org-контекст в summary/report? capable-модель включена?)_
