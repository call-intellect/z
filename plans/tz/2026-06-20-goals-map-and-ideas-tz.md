---
type: tz
status: РЕАЛИЗОВАНО 2026-06-20 (Ф1–Ф5, ветка feature/idv-and-goals-map → dev)
feature: goals-map-and-ideas
date: 2026-06-20
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-20-goals-map-and-ideas/99-synthesis.md
  - plans/tz/2026-06-05-goal-vector-compass.md
  - plans/tz/2026-06-05-goals-improvements.md
  - plans/archive/2026-06-02-goals-okr-v2.md
  - second-brain/01_projects/goals-and-strategic-alignment.md
---

> Анализ: `plans/analysis/2026-06-20-goals-map-and-ideas/99-synthesis.md` (research-complete) · Решения владельца Д1–Д3: 2026-06-20

# ТЗ — Карта целей + идеи (радиальная strategy-map выравнивания)

## Цель

Добавить в раздел `/goals` третью вкладку **«Карта»** — радиальную карту целей: **главная цель (`Goal.isPrimary`) в центре**, остальные цели кольцами по горизонту (`strategic→annual→quarterly→monthly→sprint`), связи-рёбра по `parentGoalId`. Карта показывает, **ведёт ли цель к главной** или **висит несвязанной** (orphan), даёт **включаемый слой идей** (другим цветом, рёбра `Idea.goalId`) и действие **«Принять идею → цель»**. Для orphan-целей Кора предлагает родителя по смыслу — владелец подтверждает.

## Зачем (болезненное состояние по факту)

- В `/goals` есть только **список** и **вложенное дерево** (`GoalsClient.tsx:176-205` переключатель `viewMode: "list" | "tree"`; `GoalsTreeView` рендерит `buildTree`-узлы). Единого поля «вся стратегия одним взглядом» нет — нельзя за 30 секунд увидеть, всё ли ведёт к главной цели и что висит в стороне.
- Понятия «orphan-цель» (цель, не ведущая к главной) в коде **нет** — `buildTree` (`goal.ts:567-590`) просто кладёт цели без родителя в `roots`, не отличая легитимную стратегическую вершину от «висящей» цели.
- Идеи (`/ideas`) и цели живут раздельно. `Idea.goalId` (`schema.prisma:6509`) связывает идею с целью, но **увидеть идеи рядом с целями на одной карте нельзя**, а «превратить идею в новую цель» в коде **отсутствует** (есть только привязка к существующей — `IdeasService.linkGoal`, `ideas.service.ts:274-313`).
- «Цели из разговоров» уже добываются (`Specialist314GoalsService` + LLM `goal-extract`, статус «Предложено Корой» = `promotionState='suggested'`), но это видно только списком — карта поднимет авто-цели в наглядное поле.

Рынок (анализ §4): свободный force-граф целей — мёртвый паттерн (Microsoft Viva Goals закрыт 31.12.2025 из-за провала adoption); лидеры дают детерминированную strategy-map. Единая карта идей+целей — белое пятно всего рынка (РФ+зарубеж) → дифференциатор Коры.

---

## REALITY-CHECK

| Факт (проверено) | Доказательство (path:line · символ) | Влияние на фазы |
|---|---|---|
| `Goal.isPrimary` **есть в схеме** (ТЗ-B Ф1 выкачен) + индекс | `schema.prisma:4383` (`isPrimary Boolean @default(false)`), `:4472` (`@@index([tenantId, isPrimary])`) | Ф1 НЕ добавляет колонку — только пробрасывает её в DTO списка |
| `Goal.parentGoalId` (self-relation, защита от циклов в сервисе) + `horizon` enum | `schema.prisma:4385-4387`, `:4377` (`GoalHorizon`) | Рёбра карты = `parentGoalId`; кольца = `horizon` |
| `Goal.embedding` (pgvector 1536) для KNN | `schema.prisma:4457` | Ф5 переиспользует для подсказки родителя |
| **`GoalListItemDto` НЕ содержит `isPrimary` и `horizon`** | `goals.dto.ts:137-158` (полей нет) | **Ф1: добавить оба поля в DTO + `select`** |
| **`GoalDomain` (фронт) НЕ содержит `isPrimary`/`horizon`** | `frontend/src/domain/goal.ts:294-315` | Ф1: зеркало на фронте |
| Карты целей нет; есть только `viewMode "list"\|"tree"` | `GoalsClient.tsx:176-205`; `GoalsTreeView` | Ф3: добавить `"map"` |
| **`react-force-graph-2d@1.29.1` УЖЕ установлена и поддерживает `dagMode/radialout/dagLevelDistance/dagNodeFilter/onDagError`** | `frontend/package.json` (`^1.27.0`→1.29.1); проверено `node_modules/react-force-graph-2d/dist/*.d.ts` | Ф3: радиал-карта БЕЗ новых зависимостей |
| Готовый паттерн графа на этой либе | `entities/[id]/graph/ForceGraphCanvas.tsx` (центр-узел, стрелки, пунктир, клики, FallbackList, lazy-import, ResizeObserver) | Ф3: зеркалить паттерн (но парные токены вместо hex) |
| **«Convert идея → новая цель» НЕТ** (только `linkGoal` к существующей) | `ideas.service.ts:274-313` (`linkGoal`); эндпоинта promote нет | **Ф4: новый `POST /ideas/:id/promote-to-goal`** |
| LLM `goal-hierarchy-link` (арбитр «какая цель — родитель») уже есть | `specialist-3-14-goals.service.ts` (`hierarchyArbiter`), промпт `goal-hierarchy-link` | Ф5: переиспользовать, новый промпт НЕ заводить |
| Нет отдельного backend-эндпоинта дерева целей — фронт строит локально | `goal.ts:567-590` `buildTree`; backend `goalsTree` не найден | Ф2: orphan-логику считать на фронте рядом с `buildTree` |
| RBAC `goal`: owner r/w/d, admin r, manager r | `policy.csv:106-118` | reparent/promote = owner; чтение карты = read |
| `/goals` может отсутствовать в сайдбаре | `nav-config.ts` (пункт `/goals` не найден агентом) | Ф3: проверить и при отсутствии добавить nav-пункт |
| Цели gated `feature.goals_strategy` | `<TierGate feature="feature.goals_strategy">` | Карта под тем же gate, новый entitlement НЕ нужен |

**Вывод:** фундамент ~85% готов. Не хватает: (1) `isPrimary`+`horizon` в DTO списка, (2) frontend orphan/alignment-логики, (3) самого компонента радиал-карты, (4) слоя идей + `promote-to-goal`, (5) AI-подсказки родителя. **Колонок Prisma добавлять НЕ нужно** — вся схема уже есть.

---

## Принятые решения владельца (2026-06-20) — не пересматривать

| # | Решение | Обоснование |
|---|---|---|
| Д1 | Вид карты — **радиальная strategy-map** (главная цель в центре, цели кольцами по горизонту, детерминированная раскладка). НЕ свободный force-граф. | Свободный граф — мёртвый паттерн (Viva Goals закрыт из-за провала adoption; 27 OKR-тулов его не используют; «главная цель»-хаб даёт hairball). Радиал = ровно «главная в центре» при читаемости. Анализ §6–7, red-team. |
| Д2 | Orphan — **структурный** (нет пути к `isPrimary` по связям) **+ AI-подсказка** «похоже, относится к цели X» с ручным подтверждением. AI НЕ выносит авто-вердикт «orphan». | Структурный критерий надёжен (OKR lineage); семантический авто-вердикт даёт ложные срабатывания и подрывает доверие (red-team). |
| Д3 | Идеи — **включаемый слой** карты (по умолчанию выкл) + действие **«Принять идею → цель»** (привязать к существующей ИЛИ создать новую) прямо с карты. | Слияние идей+целей в один граф по умолчанию = hairball (red-team); слой по кнопке защищает читаемость. Единая карта — дифференциатор. |

## Решения аналитика/архитектора (доказаны в §«Доказательство выбора»)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | Карта — на **уже установленной `react-force-graph-2d` в `dagMode:'radialout'`**, НЕ вводить React Flow+dagre | Проверка `node_modules`: radialout/dagNodeFilter/onDagError уже есть → радиал, orphan-float и детект циклов из коробки. dagre даёт иерархию, не радиал. Новая зависимость = код ради кода (challenge-loop) + нарушение «не плодить». Готовый паттерн `ForceGraphCanvas`. |
| Б2 | Граф собираем **на фронте** из существующих списков (`goalsApi.list` + `ideasApi.list`), orphan считаем рядом с `buildTree`; backend только обогащает DTO | Фронт уже строит дерево локально (`buildTree`) — тот же паттерн; новый тяжёлый graph-эндпоинт = дублирование. Z ≤ 30 человек → целей десятки, клиентская сборка дешева. |
| Б3 | «Принять идею → цель» = **и привязка** (`linkGoal`, есть), **и создание** (`promote-to-goal`, новый эндпоинт); новая цель `source='manual', promotionState='active'` | Слова владельца «принять идею, чтобы стала целью» = создание; но иногда идея относится к уже существующей цели = привязка. Даём оба. Человек принял → `manual`. |
| Б4 | AI-подсказка родителя (Д2) — **переиспонять `goal-hierarchy-link`** + `Goal.embedding` KNN, read-only эндпоинт; подтверждение через существующий `PATCH /goals/:id {parentGoalId}` | Промпт и KNN-логика уже есть в `Specialist314` — новый промпт сломал бы prompt-cache и плодил бы дубль. Подтверждение через готовый reparent-путь. |
| Б5 | Цвет узлов на canvas — резолвить **парные токены** через `getComputedStyle(--chip-*-fg)`, НЕ hardcode hex | canvas требует строку цвета, не Tailwind-класс; резолв из CSS-переменных уважает парные токены и тему (light/dark). Улучшение над `ForceGraphCanvas` (там hex — легаси). |

---

## Доказательство выбора

### Развилка 1 — библиотека визуализации (Б1)
| Критерий | A. React Flow (@xyflow) + dagre | B. react-force-graph-2d radialout (рекоменд.) |
|---|---|---|
| Радиальная форма Д1 (главная в центре) | ✗ dagre = иерархия TD/LR, радиал нужен доп. d3-кодом | ✓ `dagMode:'radialout'` нативно |
| Новые зависимости (Ship-On «не плодить») | ✗ +2 пакета (@xyflow/react, dagre) | ✓ 0 — уже установлена |
| Orphan-визуал | △ узлы без рёбер стоят, но не «отлетают» | ✓ `dagNodeFilter` → orphan свободно плавает |
| Детект циклических связей | △ свой код | ✓ `onDagError` колбэк |
| Готовый паттерн в репо | ✗ нет | ✓ `ForceGraphCanvas.tsx` |
| Богатые узлы-карточки (DOM) | ✓ HTML-узлы | △ canvas (`nodeCanvasObject`) — для CEO-вида простой узел даже лучше (red-team: не усложнять) |
| Детерминизм раскладки | ✓ фикс-позиции | △ кольца детерминированы (топология), угол — физика; митигация: фикс центра `fx/fy=0` + `cooldownTicks` |

**Вывод: B.** Единственный минус (богатые DOM-узлы) не нужен для CEO-вида и закрывается детальной панелью по клику (как `EntityGraphClient`). Радиальную форму Д1 React Flow+dagre **не даёт** без доп. кода — A проигрывает по целевому критерию.

### Развилка 2 — источник данных карты (Б2)
| Критерий | A. Новый backend-эндпоинт `/goals/map` (как entity-graph) | B. Сборка на фронте из списков (рекоменд.) |
|---|---|---|
| Дублирование | ✗ повторяет `entity-graph.service` | ✓ переиспользует `goalsApi.list`+`ideasApi.list`+`buildTree`-паттерн |
| Orphan-логика | бэк | фронт (рядом с `buildTree`, unit-тест) |
| Объём backend-правок | новый сервис+контроллер+DTO | только +2 поля в `GoalListItemDto` |
| Масштаб (Z ≤30 чел, целей десятки) | избыточно | дёшево клиентски |

**Вывод: B.** Backend трогаем минимально (Ф1) + 2 точечных эндпоинта для действий (Ф4 promote, Ф5 suggest), которые НЕ про сборку графа.

### Challenge-loop (3 вопроса к выбранному решению)
1. **Корень, не симптом?** Да: даём структурную модель «aligned/top_level/orphan» (класс «несвязанности»), а не латаем один экран. Закрывает и «ведёт ли к главной», и «висят ли идеи».
2. **Самое эффективное?** Да: 0 новых зависимостей, 0 новых колонок Prisma, переиспользование `goal-hierarchy-link`/`ForceGraphCanvas`/`buildTree`. KR-на-узле отложено в vNext (узлу для CEO-вида хватает статуса+типа; детали — по клику).
3. **Нет кода ради кода?** Да: не вводим React Flow/dagre/новый LLM-промпт/новый graph-эндпоинт/новую колонку. Слой идей — переключатель, не отдельная подсистема.

---

## Scope

### Входит
- **Ф1:** `isPrimary` + `horizon` в `GoalListItemDto` (+ `select`) и зеркало `GoalDomain`.
- **Ф2:** frontend-домен: `computeGoalAlignment(goals)` (aligned/top_level/orphan) + `buildGoalGraph(goals, alignment, ideas, showIdeas)` → `{nodes, links}`. Unit-тесты.
- **Ф3:** компонент `GoalsMapView` (радиал на `react-force-graph-2d` radialout, центр=`isPrimary`, кольца=`horizon`, рёбра=`parentGoalId`, orphan-float+danger, цвет=`progressStatus` парными токенами, клик→детальная панель, состояния loading/empty/error, FallbackList). Третья вкладка «Карта» в `GoalsClient`. Проверка/добавление nav-пункта `/goals`.
- **Ф4:** слой идей (переключатель «Показать идеи», по умолчанию выкл; узлы-идеи другим цветом, рёбра `Idea.goalId`, зона «идеи без цели»). Backend `POST /ideas/:id/promote-to-goal`. Действие «Принять идею → цель» (привязать существующую через `linkGoal` ИЛИ создать новую через promote) из панели идеи на карте.
- **Ф5:** `POST /goals/:id/suggest-parent` (KNN по `Goal.embedding` + `goal-hierarchy-link`, read-only) + UI на orphan-узле «Кора предлагает: подцель к X» → подтверждение через `PATCH /goals/:id {parentGoalId}`.

### Не входит (→ vNext / другое ТЗ)
- **Промежуточный слой «инициатива»** (idea→initiative→goal) — vNext (анализ §8 Р3); сейчас прямая `Idea.goalId` + `IdeaCluster` достаточно.
- **KR-прогресс на узле карты** (бейдж «N из M») — vNext: требует роллапа KR в список целей; на MVP узел показывает статус/тип, KR — в детальной панели по клику (`GET /goals/:id`).
- **Drag-drop рисование связей** на карте — vNext; связывание orphan идёт через AI-подсказку+подтверждение (Д2) и существующий reparent-диалог.
- **Компас цели (ТЗ-B)** — соседняя ось «движемся ли к цели», отдельное ТЗ; карта его не трогает.
- **Ручная подача идеи в UI** — отдельный вопрос (идеи сейчас только авто из встреч); карта работает с существующими идеями.
- Финансовые метрики на узлах — запрещены (инвариант продукта).

---

## Граничные контракты с другими ТЗ

- **`schema.prisma model Goal`** — НЕ трогаем (все нужные поля есть: `isPrimary:4383`, `parentGoalId:4385`, `horizon:4377`, `embedding:4457`). Re-Read блока перед любой правкой — не перезатирать.
- **`goal-vector-tracker.cron.ts`, `GoalVectorWidget`, компас ТЗ-B** — НЕ трогаем (другая ось).
- **`goal-hierarchy-link` промпт** — переиспользуем как есть, SYSTEM не правим (prompt-cache).
- **`Specialist314GoalsService`** — НЕ трогаем; Ф5 вызывает ту же KNN+арбитр-логику через отдельный read-only путь или выделенный публичный метод (если приватный — добавить тонкую обёртку, не дублируя промпт).
- **`ForceGraphCanvas.tsx` (entity-graph)** — НЕ трогаем; `GoalsMapView` — новый компонент, паттерн зеркалим, но цвета на парных токенах (Б5).
- **`GoalListItemDto`/`goal.ts` domain** — этот ТЗ добавляет ТОЛЬКО `isPrimary`+`horizon`, не трогая прочие поля.

---

## Контракт-first

### 1. Ф1 — DTO списка целей (`backend/src/modules/goals/dto/goals.dto.ts`, `GoalListItemDto:137-158`)
Добавить два поля (re-Read блок перед правкой):
```ts
  /// ТЗ карты целей (2026-06-20) — флаг главной цели (центр радиал-карты).
  isPrimary: boolean;
  /// ТЗ карты целей (2026-06-20) — горизонт для колец карты.
  horizon: 'strategic' | 'annual' | 'quarterly' | 'monthly' | 'sprint';
```
В `GoalsService.list` (`goals.service.ts`) — добавить `isPrimary: true, horizon: true` в `select` и проброс в маппер DTO.

### 2. Ф1 — зеркало домена (`frontend/src/domain/goal.ts`, `GoalDomain:294-315`)
```ts
  isPrimary: boolean;
  horizon: GoalHorizon; // тип уже объявлен в goal.ts
```
Маппер `goalFromApi` — проброс полей (строка/boolean, без преобразований).

### 3. Ф2 — frontend-домен карты (`frontend/src/domain/goal-map.ts`, новый файл)
```ts
export type GoalAlignment = 'aligned' | 'top_level' | 'orphan';

/// aligned — цепочка parentGoalId достигает цели с isPrimary.
/// top_level — сама isPrimary ИЛИ (parentGoalId===null && horizon==='strategic').
/// orphan — иначе (нет пути к главной): parentless не-стратегическая,
///          или цепочка обрывается на не-primary не-strategic корне,
///          или родитель вне набора (битая ссылка).
export function computeGoalAlignment(
  goals: readonly GoalDomain[],
): Map<string, GoalAlignment>;

export interface GoalMapNode {
  id: string;
  kind: 'goal' | 'idea';
  label: string;
  isPrimary: boolean;          // goal-only
  horizon: GoalHorizon | null; // goal-only (для кольца/уровня)
  progressStatus: GoalProgressStatus | null;
  alignment: GoalAlignment | null;
  ideaStatus: IdeaStatus | null; // idea-only
}
export interface GoalMapLink {
  source: string;
  target: string;
  kind: 'parent' | 'idea_goal';
}
export function buildGoalGraph(args: {
  goals: readonly GoalDomain[];
  alignment: Map<string, GoalAlignment>;
  ideas?: readonly IdeaDomain[];
  showIdeas: boolean;
}): { nodes: GoalMapNode[]; links: GoalMapLink[] };
```
Защита: цикл `parentGoalId` (если в данных есть) — `computeGoalAlignment` обходит с `visited`-сетом, на повторный узел → останавливается (узел трактуется как orphan, не зацикливается).

### 4. Ф3 — раскладка карты (контракт компонента `GoalsMapView`)
- `dagMode="radialout"`, `dagLevelDistance` фикс (напр. 80), центр = узел `isPrimary` с `nodeVal` крупнее; фикс центра `fx=0, fy=0`.
- Уровень узла задаётся топологией (`parentGoalId`); для orphan-узлов — `dagNodeFilter={(n)=>n.alignment!=='orphan'}` → orphan «отлетает» (Д1/Д2 визуально).
- `onDagError` — не бросать, логировать (циклическая связь целей → best-effort).
- `cooldownTicks` фикс (напр. 120) для оседания и стабильности между рендерами.
- Цвет узла (Б5) — резолв через `getComputedStyle(document.documentElement).getPropertyValue('--chip-<tone>-fg')`:
  - `progressStatus`: `on_track`→`success`, `at_risk`→`warning`, `stalled`→`danger`, `achieved`→`success`, `dropped`→`muted`.
  - `alignment==='orphan'` → перекрыть `danger` + пунктирная обводка узла.
  - `isPrimary` → `accent`/крупнее.
  - `kind==='idea'` → отдельный тон (напр. `info`/`accent-2`) + другая форма (ромб vs круг).
- Рёбра: `kind==='parent'` сплошное; `kind==='idea_goal'` пунктир/другой тон.
- `onNodeClick` → детальная боковая панель: для goal — `GET /goals/:id` (статус, KR, ответственный, действия); для idea — карточка идеи + «Принять идею → цель».
- Состояния: `loading` (Skeleton), `error` (`text-chip-danger-fg`), `empty` (нет целей → «Цели ещё не заданы»), нет `isPrimary` → баннер «Не выбрана главная цель» + центр-fallback (цель max `weight`, при равенстве min `createdAt` — как ТЗ-B B-2).
- `FallbackList` при ошибке загрузки либы (как `ForceGraphCanvas.tsx:197-262`).

### 5. Ф3 — вкладка в `GoalsClient.tsx` (`:176-205`)
Расширить `viewMode: "list" | "tree" | "map"`; добавить третью кнопку «Карта» (русская подпись, иконка `Network`/`Share2`); при `"map"` рендерить `<GoalsMapView goals={...} ideas={...} />`. Nav: проверить `nav-config.ts` — если `/goals` нет в `DESKTOP_NAV`, добавить пункт «Цели» (icon `Target`, `gateFeature:"feature.goals_strategy"`, `roles: LEADERSHIP_ROLES`).

### 6. Ф4 — `POST /api/v1/ideas/:id/promote-to-goal` (`ideas.controller.ts` + `ideas.service.ts`)
Zod-DTO тела:
```ts
export const PromoteIdeaToGoalSchema = z.object({
  horizon: z.enum(['strategic','annual','quarterly','monthly','sprint']).optional(),
  parentGoalId: z.string().cuid().nullable().optional(),
});
```
Поведение `promoteToGoal({tenantId, ideaId, userId, horizon, parentGoalId})`:
- Загрузить идею (tenant-scoped); нет → `404 idea_not_found`.
- Если `idea.goalId !== null` → `409 idea_already_linked` (уже привязана; сначала отвязать).
- В `$transaction`: создать `Goal{ tenantId, name: idea.statement (trim, ≤200), description: idea.rationale ?? '', source:'manual', promotionState:'active', horizon: horizon ?? 'quarterly', parentGoalId: parentGoalId ?? null, createdById: userId }`; `idea.goalId = newGoal.id`; если `idea.status ∈ {captured,in_discussion}` → `idea.status='accepted'`, `statusChangedByUserId=userId`, `statusReason='promoted_to_goal'`; AuditLog `idea.promoted_to_goal`.
- Вернуть `{ goalId: string, idea: IdeaDetailDto }`.
- RBAC: `canWrite(user, tenantId, 'goal')` И `canWrite(user, tenantId, 'idea')` (owner/admin).
- `parentGoalId` (если задан) — валидировать существование + tenant (как `linkGoal`); цикл невозможен (новая цель).
Коды ошибок: `idea_not_found` (404), `idea_already_linked` (409), `parent_goal_not_found` (400).

### 7. Ф5 — `POST /api/v1/goals/:id/suggest-parent` (`goals.controller.ts` + сервис)
Read-only. Поведение:
- Загрузить цель; нет → `404 goal_not_found`.
- KNN по `Goal.embedding` (cosine, HNSW) среди активных целей tenant, исключая саму цель и её потомков (анти-цикл) → top-K (напр. 5) кандидатов.
- Вызвать `goal-hierarchy-link` (переиспользовать логику `Specialist314GoalsService.hierarchyArbiter`) → вердикт `child_of/duplicate/standalone` + `parentId` + `reasoning` + `confidence`.
- Вернуть `{ suggestedParentGoalId: string | null, verdict: 'child_of'|'standalone'|'duplicate', candidates: [{goalId,name,similarity}], reasoning: string, confidence: number }`.
- RBAC: `canRead(user, tenantId, 'goal')`. Ничего НЕ меняет; подтверждение — отдельным `PATCH /goals/:id {parentGoalId}` (существует).
- Если у цели/кандидатов нет `embedding` → fallback ILIKE по первым словам (как в `Specialist314`); пусто → `suggestedParentGoalId: null, verdict:'standalone'`.

### 8. ASCII-поток (read-path карты)
```
GoalsClient (viewMode="map")
  ├─ goalsApi.list(orgId, {status:'all', limit:200})  → GoalDomain[] (с isPrimary,horizon)  [Ф1]
  ├─ (showIdeas) ideasApi.list(orgId, {status:...})    → IdeaDomain[]
  ├─ computeGoalAlignment(goals)  → Map<id, aligned|top_level|orphan>   [Ф2]
  └─ buildGoalGraph({goals,alignment,ideas,showIdeas}) → {nodes,links}  [Ф2]
        │
        └─ <GoalsMapView> react-force-graph-2d dagMode=radialout         [Ф3]
              center=isPrimary(fx/fy=0) · кольца=horizon · orphan=dagNodeFilter float
              onNodeClick → панель (goal: GET /goals/:id | idea: «Принять→цель»)
                 ├─ idea→link existing:  POST /ideas/:id/goal {goalId}     [есть]
                 ├─ idea→new goal:       POST /ideas/:id/promote-to-goal   [Ф4]
                 └─ orphan→suggest:      POST /goals/:id/suggest-parent    [Ф5]
                       → confirm: PATCH /goals/:id {parentGoalId}          [есть]
```

---

## Границы фичи

✅ **Always:** русский UI; парные токены (`bg-{tone}`/`text-{tone}-fg`), для canvas — резолв `--chip-*-fg` через `getComputedStyle`; re-Read файла после каждого Edit; orphan только структурный; AI — только подсказка с подтверждением.
⚠️ **Ask first:** менять центр-fallback (B-2); вводить новую колонку Prisma; трогать `goal-hierarchy-link` SYSTEM; делать слой идей включённым по умолчанию.
🚫 **Never:** React Flow/dagre/cytoscape/новый граф-движок (Б1); новый LLM-промпт для подсказки (переиспользовать `goal-hierarchy-link`); `prisma migrate`/`new PrismaClient()`; авто-вердикт «orphan» по семантике без подтверждения; `text-white`/hex/slate в `GoalsMapView`; финансовые поля на узлах; трогать компас ТЗ-B / goal-vector cron.

---

## Фазы

Граф зависимостей: **Ф1 → Ф2 → Ф3**; **Ф4** и **Ф5** зависят от Ф3, между собой независимы (можно параллельно после Ф3).

### Ф1 — `isPrimary`+`horizon` в DTO/домене целей [ ]
**Цель:** список целей отдаёт поля, нужные карте (центр + кольца).
**Что входит:** `GoalListItemDto` += `isPrimary`, `horizon` (Контракт §1); `GoalsService.list` `select`+маппер; `GoalDomain` += оба поля + маппер (§2).
**Что НЕ входит:** KR-роллап в список; правки detail-DTO.
**Точные файлы:** `backend/src/modules/goals/dto/goals.dto.ts` (символ `GoalListItemDto`); `backend/src/modules/goals/services/goals.service.ts` (`list`, символ `select`); `frontend/src/domain/goal.ts` (символ `GoalDomain`, `goalFromApi`).
**Зависимости:** нет.
**Acceptance:**
- `grep "isPrimary" backend/src/modules/goals/dto/goals.dto.ts` и `grep "horizon" …` → присутствуют в `GoalListItemDto`.
- `grep -n "isPrimary\|horizon" frontend/src/domain/goal.ts` → в `GoalDomain` + маппере.
- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные; `cd frontend && bun run typecheck` зелёный.
- Swagger smoke: `GET /api/v1/goals?status=all` отдаёт `items[].isPrimary` (boolean) и `items[].horizon` (enum).

**Закрывает: R1, R2.**

### Ф2 — frontend-домен карты (alignment + graph) [ ]
**Цель:** чистые функции, превращающие плоский список в граф с orphan-метками.
**Что входит:** новый `frontend/src/domain/goal-map.ts` (Контракт §3): `computeGoalAlignment`, `buildGoalGraph`, типы `GoalMapNode/GoalMapLink/GoalAlignment`. Unit-тесты.
**Что НЕ входит:** рендер (Ф3); запросы к API.
**Точные файлы:** `frontend/src/domain/goal-map.ts` (новый); `frontend/src/domain/goal-map.spec.ts` (новый).
**Зависимости:** Ф1 (поля `isPrimary`/`horizon` в `GoalDomain`).
**Acceptance:**
- `grep "computeGoalAlignment\|buildGoalGraph" frontend/src/domain/goal-map.ts` → экспорт обеих.
- Vitest `bunx vitest run frontend/src/domain/goal-map.spec.ts` зелёный, кейсы:
  - цель с цепочкой к `isPrimary` → `aligned`;
  - `isPrimary`-цель → `top_level`; `parentGoalId=null && horizon='strategic'` → `top_level`;
  - `parentGoalId=null && horizon='quarterly'` → `orphan`;
  - цепочка к не-primary не-strategic корню → `orphan`;
  - циклическая `parentGoalId` → не зацикливается, узлы `orphan`;
  - `buildGoalGraph` со `showIdeas=false` → 0 idea-узлов; `showIdeas=true` → idea-узлы + рёбра `idea_goal`; идея с `goalId=null` → узел без ребра (orphan-идея).
- `cd frontend && bun run typecheck && bun run lint` зелёные.

**Закрывает: R3, R4.**

### Ф3 — компонент радиал-карты + вкладка [ ]
**Цель:** вкладка «Карта» с радиальной картой целей (центр=главная, кольца=горизонты, orphan отлетает).
**Что входит:** `frontend/src/ui/.../GoalsMapView.tsx` (Контракт §4, паттерн `ForceGraphCanvas`, токены вместо hex); вкладка `"map"` в `GoalsClient.tsx:176-205` (§5); проверка/добавление nav-пункта `/goals`; состояния loading/empty/error/нет-primary; `FallbackList`.
**Что НЕ входит:** идеи (Ф4); AI-подсказка (Ф5).
**Точные файлы:** `frontend/src/ui/components/goals/GoalsMapView.tsx` (новый); `frontend/app/(authenticated)/goals/GoalsClient.tsx` (символ `viewMode`); `frontend/src/ui/components/app-shell/nav-config.ts` (если `/goals` отсутствует).
**Зависимости:** Ф2.
**Acceptance:**
- `grep "radialout" frontend/src/ui/components/goals/GoalsMapView.tsx` → задан `dagMode`.
- `grep -n "text-white\|#[0-9a-fA-F]\{3,6\}\|slate-" frontend/src/ui/components/goals/GoalsMapView.tsx` → ПУСТО (инвариант токенов; цвета через `--chip-*`).
- `grep "getComputedStyle\|--chip-" frontend/src/ui/components/goals/GoalsMapView.tsx` → резолв токенов присутствует.
- `grep '"map"\|Карта' frontend/app/(authenticated)/goals/GoalsClient.tsx` → третья вкладка.
- Видимый текст русский (`grep -i "orphan\|primary\|node"` в JSX-подписях → пусто; подписи «висит вне стратегии», «главная цель»).
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
- Ручная (Playwright/qa): на `/goals` вкладка «Карта» рисует главную цель в центре, orphan-цель визуально отдельно; пустой tenant → empty-state без падения.

**Закрывает: R5, R6, R7, R8.**

### Ф4 — слой идей + «Принять идею → цель» [ ]
**Цель:** включаемый слой идей на карте + создание/привязка цели из идеи.
**Что входит:** backend `POST /ideas/:id/promote-to-goal` (Контракт §6, Zod+Swagger+коды ошибок, RBAC, `$transaction`, audit); frontend — переключатель «Показать идеи» (по умолчанию выкл) в `GoalsMapView`; idea-узлы (цвет/форма, рёбра `idea_goal`, зона «идеи без цели»); панель идеи с действиями «Привязать к цели» (`linkGoal`, есть) и «Сделать целью» (`promote-to-goal`).
**Что НЕ входит:** AI-подсказка (Ф5); слой инициатив (vNext).
**Точные файлы:** `backend/src/modules/ideas/ideas.controller.ts` (символ `promoteToGoal`); `backend/src/modules/ideas/services/ideas.service.ts` (символ `promoteToGoal`); `backend/src/modules/ideas/dto/*` (символ `PromoteIdeaToGoalSchema`); `frontend/src/api/ideas.api.ts` (метод `promoteToGoal`); `frontend/src/ui/components/goals/GoalsMapView.tsx` (слой идей).
**Зависимости:** Ф3.
**Acceptance:**
- `grep "promote-to-goal\|promoteToGoal" backend/src/modules/ideas/ideas.controller.ts` → эндпоинт.
- Unit/e2e: promote из идеи `status='captured', goalId=null` → создаётся `Goal{source:'manual',promotionState:'active'}`, `idea.goalId=newGoal.id`, `idea.status='accepted'`; повторный promote той же идеи → `409 idea_already_linked` (идемпотентная защита).
- `grep "PromoteIdeaToGoalSchema" backend/src/modules/ideas/dto` → Zod-DTO + Swagger.
- RBAC негатив: member (не owner/admin) → `403`.
- `grep "Показать идеи\|showIdeas" frontend/src/ui/components/goals/GoalsMapView.tsx` → переключатель, дефолт выкл.
- `cd backend && bun run typecheck && bun run lint && bun run build` + `cd frontend && …` зелёные.

**Закрывает: R9, R10, R11.**

### Ф5 — AI-подсказка родителя для orphan [ ]
**Цель:** на orphan-цели Кора предлагает родителя по смыслу; владелец подтверждает.
**Что входит:** backend `POST /goals/:id/suggest-parent` (Контракт §7, read-only, KNN+`goal-hierarchy-link`, RBAC read); frontend — на orphan-узле кнопка «Куда относится?» → показать предложение (имя цели + причина) → «Сделать подцелью» → `PATCH /goals/:id {parentGoalId}` (есть).
**Что НЕ входит:** авто-привязка без подтверждения (запрещено Д2).
**Точные файлы:** `backend/src/modules/goals/goals.controller.ts` (символ `suggestParent`); `backend/src/modules/goals/services/*` (переиспользование `hierarchyArbiter`/KNN из `specialist-3-14-goals.service.ts` — публичный метод или тонкая обёртка); `frontend/src/api/goals.api.ts` (метод `suggestParent`); `frontend/src/ui/components/goals/GoalsMapView.tsx`.
**Зависимости:** Ф3 (orphan-узлы на карте).
**Acceptance:**
- `grep "suggest-parent\|suggestParent" backend/src/modules/goals/goals.controller.ts` → эндпоинт read-only (RBAC `canRead 'goal'`).
- Эндпоинт НИЧЕГО не пишет: `grep -i "update\|create\|\.goal\.update" ` в методе сервиса → отсутствует (только чтение + LLM).
- Unit: цель без embedding → fallback, не падает, `verdict:'standalone'`.
- `grep "goal-hierarchy-link" backend/src/modules/goals` → переиспользование, нового промпта нет (`grep -rn "SYSTEM" …/prompts/goal-*suggest*` → файл не создан).
- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные.

**Закрывает: R12, R13.**

---

## Требования (R1..R13) + трассировка

| R | Формулировка (EARS) | Фаза |
|---|---|---|
| R1 | Когда вызывается `GET /goals`, система shall вернуть для каждой цели `isPrimary` (boolean) и `horizon` (enum). | Ф1 |
| R2 | Когда фронт мапит цель, `GoalDomain` shall содержать `isPrimary` и `horizon`. | Ф1 |
| R3 | Когда цепочка `parentGoalId` цели достигает цели с `isPrimary=true`, `computeGoalAlignment` shall вернуть для неё `aligned`; когда цель сама `isPrimary` или `parentGoalId=null && horizon='strategic'` — `top_level`; иначе — `orphan`. | Ф2 |
| R4 | Когда в данных есть циклическая `parentGoalId`, `computeGoalAlignment` shall завершиться без зацикливания и пометить узлы цикла `orphan`. | Ф2 |
| R5 | Когда открыта вкладка «Карта», система shall разместить цель с `isPrimary=true` в центре (`fx=0,fy=0`), остальные — кольцами по `horizon` (`dagMode='radialout'`). | Ф3 |
| R6 | Когда у цели `alignment='orphan'`, карта shall отрисовать её отдельно от дерева (`dagNodeFilter`) тоном `danger` с пунктирной обводкой. | Ф3 |
| R7 | Когда `GoalsMapView` рендерится, в исходнике shall отсутствовать `text-white`, hex-цвета, `slate-`; цвета узлов shall резолвиться из `--chip-*` через `getComputedStyle`. | Ф3 |
| R8 | Когда у tenant нет цели с `isPrimary=true`, карта shall показать баннер «Не выбрана главная цель» и центр-fallback (max `weight`, при равенстве min `createdAt`), не падая. | Ф3 |
| R9 | Когда переключатель «Показать идеи» выключен (дефолт), карта shall не отображать idea-узлы; когда включён — отображать idea-узлы и рёбра `idea_goal`, а идеи с `goalId=null` — без ребра. | Ф4 |
| R10 | Когда вызывается `POST /ideas/:id/promote-to-goal` для идеи с `goalId=null`, система shall создать `Goal{source:'manual',promotionState:'active'}`, проставить `idea.goalId` и (если статус captured/in_discussion) `idea.status='accepted'`. | Ф4 |
| R11 | Когда `POST /ideas/:id/promote-to-goal` вызвана для идеи с уже непустым `goalId`, система shall вернуть `409 idea_already_linked` и не создавать цель. | Ф4 |
| R12 | Когда вызывается `POST /goals/:id/suggest-parent`, система shall вернуть предложенного родителя (или `null`) + причину, ничего не изменяя в БД. | Ф5 |
| R13 | Когда у цели/кандидатов нет `embedding`, `suggest-parent` shall использовать ILIKE-fallback и не падать. | Ф5 |

---

## Совместимость с prompt caching

- Ф5 переиспользует существующий промпт `goal-hierarchy-link` **без изменения SYSTEM** — кэш не ломается. Новый промпт НЕ заводится (Б4).
- Ф4 `promote-to-goal` — без LLM (цель собирается из `idea.statement`/`rationale`).
- Остальные фазы LLM не вызывают. **Раздел релевантен: правок LLM-промптов нет.**

---

## Pre-mortem / Риски + ревью-аспекты

| Риск | Митигация |
|---|---|
| Радиал «прыгает» между рендерами (red-team) | Фикс центра `fx/fy=0` + `cooldownTicks` фикс + `dagMode` детерминирует кольца; Z ≤30 чел → быстрая сходимость |
| Ложные orphan на легитимных стратегических вершинах | `top_level` для `isPrimary` и `parentGoalId=null && horizon='strategic'`; orphan только для не-стратегических без пути |
| canvas не берёт Tailwind-классы → соблазн hex | Б5: резолв `--chip-*-fg` через `getComputedStyle` (тема light/dark уважается); grep-гард в Acceptance Ф3 |
| Слой идей → hairball | Дефолт выкл (Д3); идеи листьями, orphan-идеи в отдельной зоне |
| `promote-to-goal` дубль-цели при повторе | `409 idea_already_linked` (R11) |
| `suggest-parent` цикл (предложит потомка родителем) | Исключать саму цель и её потомков из KNN-кандидатов |
| Нет главной цели у tenant | R8 fallback-центр + баннер |

Ревью-аспекты для `strict-production-review-gate`: multi-tenancy (все запросы `tenantId`-scoped: list, promote, suggest), RBAC (promote=owner/admin write, suggest=read), идемпотентность promote (409), отсутствие финансов, токены/русский UI, отсутствие правок prompt-cache, read-only гарантия `suggest-parent`.

---

## Idempotency / feature-flag / prod-deploy

- **Feature-flag:** не требуется. Карта — UI-вкладка под существующим `feature.goals_strategy`; переключатель «Показать идеи» — view-control (не rollout-флаг). Фича выкатывается ВКЛЮЧЕННОЙ (Ship-On). `promote-to-goal`/`suggest-parent` — обычные RBAC-gated действия.
- **Idempotency:** `promote-to-goal` защищён `409` при повторе (R11). Миграций/seed/patch/backfill НЕТ (схема не меняется).
- **Затронутые шаги prod-deploy-log.md:** Шаг 12 (smoke новых эндпоинтов): `POST /api/v1/ideas/:id/promote-to-goal`, `POST /api/v1/goals/:id/suggest-parent` + расширенный `GET /api/v1/goals` (поля `isPrimary`/`horizon`). **Schema (Шаг 4) НЕ затронут** (колонок не добавляем). `apply-prod-deploy.ts STEPS` — без изменений.
- second-brain по таблице производных: `01_projects/goals-and-strategic-alignment.md` (вкладка «Карта» + promote + suggest-parent), `01_projects/api-layer.md` (2 новых эндпоинта + расширение DTO), `01_projects/frontend-pages.md` (вкладка карты).

---

## DoD

- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные (вкл. `.spec`).
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
- `bunx vitest run frontend/src/domain/goal-map.spec.ts` зелёный; backend-тесты promote/suggest зелёные.
- second-brain обновлён (см. выше); `docs/operations/prod-deploy-log.md` Шаг 12 дополнен.
- Рефлексия в `second-brain/05_история/`.
- Ручная приёмка (qa-tester/Playwright): вкладка «Карта» — главная в центре, orphan отдельно, слой идей по кнопке, «Принять идею → цель» и «Куда относится?» работают.

---

## Итог

- [x] Ф1 — `isPrimary`+`horizon` в DTO/домене целей
- [x] Ф2 — frontend-домен карты (alignment + graph) + тесты
- [x] Ф3 — компонент радиал-карты + вкладка «Карта»
- [x] Ф4 — слой идей + «Принять идею → цель» (`promote-to-goal`)
- [x] Ф5 — AI-подсказка родителя для orphan (`suggest-parent`)
