---
type: tz
status: ready-to-implement
feature: brain-viz-wow
date: 2026-07-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/architecture/2026-07-05-brain-viz-wow.md
  - plans/analysis/2026-07-05-brain-viz-wow/99-synthesis.md
  - plans/analysis/2026-07-05-brain-viz-wow/prototype/index.html
  - plans/architecture/2026-07-02-second-brain-by-branches.md
  - plans/tz/2026-07-02-living-topic-space.md
supersedes: plans/archive/2026-06-02-brain-visualization-people.md
---
> Архитектура (одобрена владельцем, карт-бланш): `plans/architecture/2026-07-05-brain-viz-wow.md` · Анализ: `plans/analysis/2026-07-05-brain-viz-wow/99-synthesis.md` (research-complete, red-team пройден) · Согласовано: 2026-07-05.
> **Эталон визуала — живой прототип** `plans/analysis/2026-07-05-brain-viz-wow/prototype/index.html` (верифицирован в браузере; скриншоты рядом). Реализация обязана визуально соответствовать прототипу, код переносится из сниппетов ниже.
> Принцип: не пересматривать принятые решения (§«Принятые решения»); не «оптимизировать» архитектуру по-своему; номера строк — на момент написания, перед правкой перечитать файл по якорю-символу.

# ТЗ: «Карта мозга» — вау-3D-визуализация второго мозга + практичная навигация

## Цель

Внутри раздела «Память» появляется третья вкладка **«Мозг»**: 3D-сцена «мозг компании» — светящийся граф областей/тем/сущностей на звёздном фоне, с полётом камеры, частицами, таймлапсом роста, — и практичный слой поверх той же сцены: поиск→полёт, карточка узла с провенансом, линзы, панель «Пробелы в знаниях» с кнопками действия, счётчик роста.

**Зачем** (из анализа, с источниками в 99-synthesis §1–2): ниша пуста (0 из 12 РФ-баз знаний имеют граф [triangulated(3)]); вау-рецепт канонизирован экосистемой 3d-force-graph; «дыры как фича» доказаны InfraNodus/Wikipedia red links; скриншот графа — социальный ритуал (Obsidian). Болевое: ценность Коры невидима, пустоты не управляются.

## REALITY-CHECK (снят 2026-07-05, по коду)

| Что | Факт | Следствие для ТЗ |
|---|---|---|
| Глобального граф-эндпоинта НЕТ | только локальный BFS `GET /api/v1/knowledge/graph/neighbors` ([graph.controller.ts:78](../../backend/src/modules/knowledge-core/api/graph.controller.ts), якорь `@Get('neighbors')`), max ~100 узлов | строим снапшот-эндпоинт (Ф1); neighbors реюзаем для drill-down блоков |
| «Память» = 2 вкладки | `TabsRoot` в [BranchMapClient.tsx:142-155](../../frontend/app/(authenticated)/memory/BranchMapClient.tsx) (якорь `TabsTrigger value="registries"`) | добавляем третий таб `value="brain"` (Ф2) |
| Области считаются | `BranchDerivationService.aggregateBranchMap(tenantId, viewerUserId)` ([branch-derivation.service.ts:104](../../backend/src/modules/knowledge-core/services/branch-derivation.service.ts)); `deriveBranchForEntityIds`/`ForThemeIds` (стр. 39/80) | branch узлов берём этими методами, НЕ дублируем логику |
| Граф-модели | `Entity` (type: enum `EntityType` 12+ классов, canonicalName, mentionsCount, mergedIntoId), `EntityLink` (полиморфные `fromType/toType` VarChar(50), см. `NodeType` в [graph.types.ts](../../backend/src/common/graph/graph.types.ts); status, validUntil, deletedAt), `IdeaBlock` (@@id([id, tenantId]), status, signalType, createdAt), `IdeaBlockLink`, `Theme` — всё tenant-scoped | фильтры выборки в Ф1 |
| Наполненность считается | `MaturityScorerService` ([maturity-scorer.service.ts](../../backend/src/modules/company-foundation/services/maturity-scorer.service.ts)) | яркость узлов ролей/отделов; НЕ вводить новую метрику |
| Entitlement-гейт есть | `@RequireEntitlement('feature.graph')` на классе graph.controller ([graph.controller.ts:59](../../backend/src/modules/knowledge-core/api/graph.controller.ts)) + гард-тест graph-entitlement-guard.spec.ts | тот же гейт на brain.controller; НЕ вводить новый ключ |
| Nudge-канал есть | `proactive-message-craft.service.ts`, `proactive-notifications.service.ts` ([modules/proactive/services/](../../backend/src/modules/proactive/services/)) | Ф4 реюз; свой канал НЕ строить |
| Рендер-база | `react-force-graph-2d@1.27` уже в frontend/package.json; three НЕТ | ставим 3D-пакеты той же экосистемы (Ф2) |
| Масштаб данных | dev-замер: тенант «Стрела» ≈ 174 Entity + 321 IdeaBlock + 32 Theme / ~6k рёбер (IdeaBlockLink доминирует ×18) | снапшот L2 без блоков; блоки — только drill-down |
| Прототип | `plans/analysis/2026-07-05-brain-viz-wow/prototype/index.html` — рабочий, все эффекты | канон UI-состава и поведения |
| Висящих контрактов не найдено | смежные фичи (branches, living-topic) выкачены 2026-07-03, зелёные | — |

## Принятые решения владельца (2026-07-05, не пересматривать)

| # | Решение | Обоснование (почему) |
|---|---|---|
| Б1 | Движок вау-сцены — **react-force-graph-3d@1.29.1** (+ three@0.185.1, three-spritetext@1.10.0) | ADR 99-synthesis §3: единственный 3D с готовыми официальными сниппетами всех 9 эффектов; MIT; та же экосистема, что уже стоящий 2D; reagraph — 1–3 FPS на 2600 узлах (issue #113), cosmos.gl — 2D-only. Red-team не опроверг |
| Б2 | Клиент изолирован **фасадом** `BrainScene` (props-контракт §Контракты) | поправка red-team: оболочка заменима (r3f-forcegraph) без переписывания продукта |
| Б3 | **Сервер считает — клиент рендерит**: снапшот графа с готовыми x/y/z в БД+Redis, клиент замораживает `fx/fy/fz` | консенсус Bloom/Ogma/Graphistry/anvaka [99-synthesis §1.5]; первый кадр = собранный мозг |
| Б4 | Серверный layout и дельты — **d3-force-3d** (не ngraph) | red-team: тот же движок, что у клиента, MIT, живой (04.2025); ngraph заморожен 2022, BSD-3 |
| Б5 | Снапшот = **один уровень L2** (области+темы+сущности, cap `brain.snapshot.maxNodes`=3000, `truncated`-флаг); блоки-факты — НЕ узлы общей сцены, только drill-down/карточка | правило ≤5k узлов на ответ [Bloom 10k, деградация rfg ~7k]; урок Logseq: рёбра блоков = шум → агрегируются в вес рёбер |
| Б6 | Bloom — **глобальный UnrealBloomPass** (threshold-сегрегация яркостью), изолирован в одном модуле как «расходник» с маркером миграции на TSL | селективный bloom требует хирургии рендер-цикла (issue #421 без ответа); red-team: UnrealBloomPass — легаси у three r183+, менять слоем |
| Б7 | Частицы — **только на подсвеченных рёбрах** + `emitParticle` на событиях роста | официальный паттерн-смягчение производительности + акцент |
| Б8 | Звёздный фон — **свой** (равномерная сфера + lerp-градиент, из прототипа) | red-team: не копировать GalaxyM1199 (код платного курса) |
| Б9 | Линзы (Всё/Области/Люди/Темы), таймлапс, ghost — **клиентские фильтры одного снапшота** | 1 запрос, мгновенное переключение; payload мал (≤3k узлов) |
| Б10 | Дыры: ghost-узлы + панель «Пробелы» (пустые области, слабые пары областей) + CTA nudge через proactive; тон — «прокачка», не порицание | InfraNodus gaps + red links [08]; наследие старого ТЗ V7/V10 |
| Б11 | Вкладка «Мозг» — внутри «Памяти», плитки областей остаются главным видом; deep-link `?focus=` | архитектура §5; 3D — не единственная дверь (риск «3D хуже 2D» снят) |
| Б12 | Ship-On: выкат включённым всем с `feature.graph`; kill-switch `brain.map.enabled` (default true) | CLAUDE.md принцип 8; строка в feature-flags.md |
| Б13 | Фаза 0 — обязательный спайк производительности ДО остального | нет свежих независимых FPS-бенчей [ограничения 05/06/07]; red-team: пере-бенчить reagraph и сборку three-render-objects |
| Б14 | Мобайл — деградация (без bloom/частиц/звёзд, те же данные), не вау | архитектура §6 |

**Доказательство выбора** (полные состязательные таблицы, матрица 4 движков с источниками каждой оценки, red-team-вердикты) — [99-synthesis.md §3, §8](../analysis/2026-07-05-brain-viz-wow/99-synthesis.md). Здесь не дублируется.

## Требования (EARS)

- **R1.** Когда пользователь с entitlement `feature.graph` открывает «Память» → вкладку «Мозг», система shall отрисовать 3D-сцену из снапшота (области+темы+сущности) с готовой раскладкой; время до первого осмысленного кадра на «Стреле» ≤ 3 с (без учёта первой загрузки JS-чанка).
- **R2.** Система shall рисовать узлы glow-спрайтами: размер и яркость = f(kind, maturity/facts); подписи SpriteText — у областей и тем всегда, у сущностей — при hover/подсветке.
- **R3.** Система shall применять bloom ко всей сцене (strength 2.2, radius 0.85, threshold 0.08 — стартовые из прототипа, крутилки admin) на фоне `#000003` со звёздным слоем ≥3000 точек.
- **R4.** Когда пользователь наводит курсор на узел, система shall подсветить узел+соседей+их рёбра, включить частицы (3 шт/ребро) только на этих рёбрах и пригасить остальное; при уходе курсора — вернуть всё за ≤300 мс.
- **R5.** Когда пользователь кликает узел, система shall выполнить полёт камеры `cameraPosition(..., node, 1600 мс)` и открыть правую карточку узла (drawer).
- **R6.** Карточка узла shall содержать: тип (рус.), название, область, полосу наполненности (%), счётчик фактов, до 5 последних фактов с провенансом (название встречи/источника + дата [+ спикер, если доступен] + переход к источнику), до 5 соседей-карточек (клик = перелёт + новая карточка), кнопки «Спросить Кору про это», «Открыть страницу», для пустых — «Попросить подлить знания».
- **R7.** Когда пользователь печатает в строке поиска ≥2 символов, система shall показать автокомплит (до 6 узлов текущего снапшота: label подстрочно, регистронезависимо, включая aliases сущностей) и по выбору — выполнить R5-полёт.
- **R8.** Система shall предоставлять линзы Всё/Области/Люди/Темы (фильтр по kind/entityType) и чипы применённых линз; переключение без запроса к серверу, ≤200 мс.
- **R9.** Если у области/сущности `facts == 0` (или maturity < `brain.ghost.threshold`, default 0.1), система shall рисовать узел «призраком» (полупрозрачный, серый, подпись приглушена) и в карточке показывать CTA заполнения.
- **R10.** Система shall показывать панель «Пробелы в знаниях»: (а) пустые области, (б) до 3 пар областей с минимальной связностью (вес межобластных рёбер) среди непустых, с CTA; данные — `GET .../brain/gaps`.
- **R11.** Когда пользователь жмёт CTA «Попросить подлить» (карточка или панель), система shall отправить мягкое приглашение через proactive-канал адресату; повторный nudge тому же person в окне `brain.nudge.maxPerPersonPerWeek` (default 2) shall вернуть 429 с machine-readable кодом `BRAIN_NUDGE_THROTTLED` и человекочитаемым текстом «уже просили на этой неделе».
- **R12.** Система shall показывать в шапке сцены счётчик «за неделю: +K фактов» из `GET .../brain/growth` (K = IdeaBlock тенанта с `createdAt > now-7d`, status активные).
- **R13.** Система shall предоставлять таймлапс: ползунок недель (от первой недели данных тенанта до текущей) + кнопка Play (шаг ≤1 с/неделя); фильтрация по `createdAt` узлов на клиенте; узел появляется только вместе с ≥1 ребром (правило «orphans off»), кроме областей.
- **R14.** Когда клиент запрашивает `GET .../brain/graph/delta?sinceVersion=N` и версия снапшота выросла, система shall вернуть `{addedNodes(c x/y/z), addedLinks, removedNodeIds, toVersion}`; клиент shall дорастить сцену без перезагрузки (setState-мердж) и запустить `emitParticle` по каждому новому ребру. Поллинг — интервал `brain.delta.pollSeconds` (default 60, 0 = выкл).
- **R15.** Snapshot-джоба shall пересобирать граф тенанта при «грязности» (max(updatedAt) источников > builtAt) по cron каждые `brain.snapshot.dirtyCheckMinutes` (default 15) и полностью в 03:30 МСК; повторный запуск при отсутствии изменений = no-op (версия не растёт); jobId = `brain-snapshot:{tenantId}` (дедуп в очереди).
- **R16.** Все brain-эндпоинты shall быть tenant-scoped (`TenantGuard`), под `@RequireEntitlement('feature.graph')`, с Zod-DTO + Swagger; ответ графа ≤ `brain.snapshot.maxNodes` узлов, при обрезке `truncated: true`.
- **R17.** Система shall экспонировать метрики: `z_brain_snapshot_build_ms` (histogram), `z_brain_snapshot_nodes`/`_edges` (gauge per build), `z_brain_graph_requests_total{endpoint}`, `z_brain_nudge_total{result}`.
- **R18.** Кнопка «Демо-режим» shall скрывать все панели, включать авто-орбиту и `zoomToFit`; выход — той же кнопкой/Esc.
- **R19.** Deep-link `/memory?tab=brain&focus=<nodeId>` shall открывать вкладку и выполнять R5-полёт к узлу после загрузки.
- **R20.** При mount/unmount сцены ≥10 раз подряд (e2e) рост heap после GC shall быть < 25 МБ относительно первого mount (защита от известного семейства утечек #62/#202/#255: обязательный `_destructor`/dispose путь).
- **R21.** Если WebGL-контекст недоступен ИЛИ user-agent мобильный (`brain.mobile.degrade`=true), система shall показать деградированный режим: та же сцена без bloom/звёзд/частиц (мобайл) или fallback-заглушку со ссылками на карту областей (нет WebGL) — не пустой экран.
- **R22.** Весь UI — русский; DOM-оверлеи — только парные токены (`bg-*`+`text-*-fg`, без `text-white`/сырых hex); hex-цвета допустимы ТОЛЬКО внутри canvas/WebGL-рендера (материалы three.js).

## Scope

**Входит:** вкладка «Мозг» в Памяти; snapshot-конвейер (Prisma-модель, BullMQ-джоба, cron, Redis-кэш); эндпоинты graph/delta/growth/gaps/node-summary/nudge; вау-сцена (bloom, звёзды, glow, частицы, полёт, орбита, демо-режим); практичный слой (поиск, drawer, hover-карточка, линзы, крошки-история); дыры (ghost, панель «Пробелы», nudge); таймлапс + рост + дельта-прорастание; спайк Ф0; тесты, метрики, крутилки, kill-switch, prod-шаги.

**НЕ входит (судьба каждого):**
- Блоки-факты как узлы общей сцены — never (Б5); их drill-down вокруг узла — vNext-ТЗ `brain-viz-blocks-expand` (создать при запросе).
- Deep-link ИЗ ответа AI-чата в сцену (генерация ссылок чатом) — vNext `chat-to-brain-deeplink`; сам параметр `?focus=` делаем сейчас (R19).
- VR/AR, realtime во время встречи, редактирование графа, 2D-fallback-движок (sigma), Louvain-раскраска «скрытых сообществ», reagraph — отвергнуто/отложено, см. 99-synthesis §3.
- Таймлапс-«шаринг видео», экспорт PNG — vNext.
- Пере-дизайн плиток областей, смарт-таблицы, дашборды — не трогаем.

**Граничные контракты:** из living-topic-space берём только ссылки на страницы тем (роуты существуют); из branches — `BranchDerivationService` как чёрный ящик (не менять); из maturity — `MaturityScorerService.scopeDetail` как есть; proactive — существующий craft/notify, новых каналов нет.

## Контракты (contract-first, канон для копипасты)

### Версии пакетов (frontend/package.json, добавить)

```json
"react-force-graph-3d": "1.29.1",
"three": "0.185.1",
"three-spritetext": "1.10.0"
```
Backend (backend/package.json): `"graphology": "0.26.0"`, `"d3-force-3d": "3.0.6"`.
[verified npm registry 2026-07-05; Context7 в сессии недоступен — перед `bun add` быстрый `npm view <pkg> version` на свежий patch]. **Грабля №1 (обязательно):** `three` — прямая dependency 3d-force-graph (`>=0.179 <1`); в lock-файле обязан остаться **один** экземпляр three, иначе UnrealBloomPass падает shader-ошибкой `luminance: no matching overloaded function` (issue #558). После установки: `grep -c '"three@' frontend/bun.lock` → ровно 1 версия.
**Грабля №2:** `three-render-objects@1.42` импортирует `three/webgpu` — под bundler Next это резолвится из пакета three автоматически (проверено в спайке Ф0); в чистых importmap-страницах нужен маппинг (поймано в прототипе).

### Prisma: новая модель (файл миграции, НЕ push!)

С 2026-06-05 в проекте версионируемые миграции: `cd backend && bun run prisma:migrate -- --name brain_graph_snapshot` → ревью SQL → `bun run prisma:generate`. (Скилловая память «только prisma:push» устарела — канон CLAUDE.md.)

```prisma
model BrainGraphSnapshot {
  id        String   @id @default(cuid())
  tenantId  String
  version   Int
  payload   Json
  nodeCount Int
  edgeCount Int
  truncated Boolean  @default(false)
  builtAt   DateTime @default(now())
  sourceMaxUpdatedAt DateTime

  org Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, version])
  @@index([tenantId, builtAt])
}
```
`payload` = `{ nodes: BrainNode[], links: BrainLink[] }` (форма ниже). Хранить последние 3 версии на тенанта (старше — удалять в той же джобе; retention-крутилка `brain.snapshot.keepVersions`, default 3).

### DTO графа (Zod, backend/src/modules/knowledge-core/api/brain.dto.ts; фронт получает 1:1)

```ts
export const BrainNodeSchema = z.object({
  id: z.string(),                       // 'b:{branch}' | 't:{themeId}' | 'e:{entityId}'
  kind: z.enum(['branch', 'theme', 'entity']),
  entityType: z.string().optional(),    // EntityType для kind='entity'
  label: z.string(),
  branch: z.string(),                   // одна из 12 областей | 'unassigned'
  maturity: z.number().min(0).max(1),
  facts: z.number().int(),
  ghost: z.boolean(),
  x: z.number(), y: z.number(), z: z.number(),
  createdAt: z.string().datetime(),
});
export const BrainLinkSchema = z.object({
  source: z.string(), target: z.string(),
  kind: z.enum(['branch-adj', 'in-branch', 'theme-entity', 'entity-entity']),
  weight: z.number().int().min(1),
  createdAt: z.string().datetime(),
});
export const BrainGraphResponseSchema = z.object({
  version: z.number().int(),
  builtAt: z.string().datetime(),
  truncated: z.boolean(),
  nodes: z.array(BrainNodeSchema),
  links: z.array(BrainLinkSchema),
});
```

Правила сборки узлов/рёбер (детерминированные, реализуются в builder-сервисе Ф1):
- `branch`-узлы: 12 областей из `aggregateBranchMap` (+`unassigned`, если непустой); `facts` = сумма по области; `maturity` = нормированный сигнал плитки (или счётчики→0..1); ghost при facts==0.
- `theme`-узлы: активные Theme (не merged/archived), branch — `deriveBranchForThemeIds`; `facts` = count ThemeIdeaBlock.
- `entity`-узлы: Entity `mergedIntoId IS NULL`, топ по `mentionsCount` до капа (после тем и областей); label = canonicalName; branch — `deriveBranchForEntityIds`; `facts` = count IdeaBlockEntity.
- Рёбра: `in-branch` (тема→её область); `theme-entity` (ThemeEntity); `entity-entity` — агрегат активных EntityLink (status=active, deletedAt IS NULL, validUntil IS NULL, fromType/toType ∈ {null,'entity'}) c weight=count + **со-упоминания**: пары сущностей, деливших ≥`brain.link.comentionMin` (default 2) общих IdeaBlock (через IdeaBlockEntity), weight=числу общих блоков; `branch-adj` — кольцо 12 областей + агрегированные межобластные (weight = сумма entity-entity между областями) — они же вход для gaps.
- **Блоки и IdeaBlockLink узлами/рёбрами НЕ являются** (Б5) — только веса.

### Серверный 3D-layout (d3-force-3d в Node, детерминированный)

```ts
// backend/src/modules/knowledge-core/services/brain-layout.util.ts
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter } from 'd3-force-3d';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export function seedPositions(nodes: LayoutNode[]) {          // детерминизм: фиббоначчи-сфера вместо random
  nodes.forEach((n, i) => {
    const y = 1 - (i / Math.max(nodes.length - 1, 1)) * 2;
    const r = Math.sqrt(1 - y * y) * 300;
    n.x = Math.cos(GOLDEN * i) * r; n.y = y * 300; n.z = Math.sin(GOLDEN * i) * r;
  });
}
export function runLayout(nodes: LayoutNode[], links: LayoutLink[], ticks = 300) {
  const sim = forceSimulation(nodes, 3)
    .force('link', forceLink(links).id((d: LayoutNode) => d.id)
      .distance((l: LayoutLink) => l.kind === 'branch-adj' ? 150 : l.kind === 'in-branch' ? 34 : 60))
    .force('charge', forceManyBody().strength(-70))
    .force('collide', forceCollide((d: LayoutNode) => 4 + Math.cbrt(d.facts + 1) * 3))
    .force('center', forceCenter(0, 0, 0))
    .stop();
  for (let i = 0; i < ticks; i++) sim.tick();
}
```
Дельта (новые узлы после встречи): старым узлам выставить `fx=x, fy=y, fz=z` (pinning), новые посеять у центроида их соседей + джиттер, `runLayout(all, all, 60)` → вернуть координаты только новых. Числа сил — канон прототипа, менять только через крутилки.

### Эндпоинты (NestJS, backend/src/modules/knowledge-core/api/brain.controller.ts)

```ts
@ApiTags('brain')
@Controller('api/v1/knowledge/brain')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.graph')            // как graph.controller.ts:59
export class BrainController {
  @Get('graph')      graph(@TenantId() tenantId: string): Promise<BrainGraphResponseDto> {}          // Redis → БД(последняя версия) → 404 BRAIN_SNAPSHOT_NOT_READY если ни одной (фронт покажет «собираем карту»)
  @Get('graph/delta') delta(@TenantId() t: string, @Query() q: BrainDeltaQueryDto) {}                 // {sinceVersion:int} → BrainDeltaResponseDto {toVersion, addedNodes, addedLinks, removedNodeIds}
  @Get('growth')     growth(@TenantId() t: string): Promise<{ weekFacts: number; totalFacts: number }> {}
  @Get('gaps')       gaps(@TenantId() t: string): Promise<BrainGapsResponseDto> {}                    // {emptyBranches: string[], weakPairs: [{a,b,weight}], generatedAt}
  @Get('node/:nodeId/summary') summary(@TenantId() t: string, @Param('nodeId') id: string) {}        // BrainNodeSummaryDto ниже
  @Post('nudge')     nudge(@TenantId() t: string, @Body() b: BrainNudgeDto) {}                        // {targetPersonId?, branch?, hint?} → 202 | 429 BRAIN_NUDGE_THROTTLED | 422 BRAIN_NUDGE_NO_TARGET
}
```

`BrainNodeSummaryDto`: `{ id, kind, label, branch, maturity, facts, recentFacts: Array<{ blockId, title, answer, occurredAt, source: { label, meetingId?, speaker? } }>, neighbors: Array<{ id, kind, label, facts }>, pageHref }`. `recentFacts`: для entity — IdeaBlock через IdeaBlockEntity (status активные, order createdAt desc, limit 5, `title=name`, `answer=trustedAnswer` усечён до 200); для theme — через ThemeIdeaBlock; для branch — топ-темы области. `source` — тем же маппером, что лента живой темы `[ASSUMPTION: реюз форматтера источника из living-topic-space (frontend themes/[id]); если его нет на бэке — собрать из IdeaBlockEvidence первички]`. `pageHref`: entity→`/entities/{id}`, theme→`/themes/{id}`, branch→`/memory/{branch}`.

### BullMQ + cron

Очередь `brain-graph-snapshot`; jobId `brain-snapshot:{tenantId}`; sandboxed-процессор с `useWorkerThreads: true` (Louvain не нужен; layout 300 тиков на ~1–3k узлов — секунды CPU). Cron `brain-snapshot.cron.ts` в `WorkersModule` (in-process, как остальные @Cron): каждые N минут — dirty-check по тенантам (`max(updatedAt)` из Entity/EntityLink/Theme/IdeaBlockEntity > `sourceMaxUpdatedAt` последнего снапшота → enqueue); 03:30 МСК — enqueue всем активным Org безусловно.

### Крутилки AdminSetting (реестр [admin-setting-schema-registry.ts:16](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts), стиль строк как `theme.autofill.*`) + сид + UI-поля

```
['brain.map.enabled', z.boolean()],                       // kill-switch, default true (Ship-On)
['brain.snapshot.maxNodes', POSITIVE_INT],                // 3000
['brain.snapshot.dirtyCheckMinutes', POSITIVE_INT],       // 15
['brain.snapshot.layoutTicks', POSITIVE_INT],             // 300
['brain.snapshot.keepVersions', POSITIVE_INT],            // 3
['brain.link.comentionMin', POSITIVE_INT],                // 2
['brain.ghost.threshold', UNIT_INTERVAL],                 // 0.1
['brain.delta.pollSeconds', NON_NEGATIVE_INT],            // 60 (0=выкл)
['brain.nudge.maxPerPersonPerWeek', POSITIVE_INT],        // 2
['brain.fx.bloomStrength', z.number().min(0).max(6)],     // 2.2
['brain.fx.bloomRadius', UNIT_INTERVAL],                  // 0.85
['brain.fx.bloomThreshold', UNIT_INTERVAL],               // 0.08
['brain.mobile.degrade', z.boolean()],                    // true
```
Никаких новых ENV; `process.env.*` запрещён.

### Фасад клиента (props-контракт, Б2)

```ts
// frontend/app/(authenticated)/memory/brain/BrainScene.tsx  ('use client', dynamic ssr:false → BrainSceneInner)
export interface BrainSceneProps {
  graph: BrainGraphUi;                       // UiModel из domain/brain.ts
  focusNodeId?: string | null;               // R19
  lens: 'all' | 'areas' | 'people' | 'themes';
  maxWeek: number;                           // таймлапс-фильтр (индекс недели), Infinity = всё
  demoMode: boolean;
  fx: { bloomStrength: number; bloomRadius: number; bloomThreshold: number; degrade: boolean };
  onNodeClick(nodeId: string): void;
  onNodeHover(nodeId: string | null): void;
  onReady(api: { flyTo(nodeId: string): void; fitAll(): void; setOrbit(on: boolean): void; emitGrowth(delta: BrainDeltaUi): void }): void;
}
```
Всё продуктовое (drawer, поиск, панели, чипы) живёт СНАРУЖИ фасада в React — при смене движка переписывается только Inner.

### Клиентские сниппеты-каноны (источник над каждым; переносить как есть)

**Обёртка Next (ref внутри Inner — issues #324/#357, рецепт vasturiano):**
```tsx
// BrainScene.tsx
'use client';
import dynamic from 'next/dynamic';
export const BrainScene = dynamic(() => import('./BrainSceneInner'), {
  ssr: false, loading: () => <BrainSkeleton /> });
```

**Bloom (официальный пример react-force-graph bloom-effect, дословно + наши числа):**
```tsx
// BrainSceneInner.tsx (фрагмент)
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
useEffect(() => {
  if (fx.degrade) return;
  const bloom = new UnrealBloomPass();
  bloom.strength = fx.bloomStrength; bloom.radius = fx.bloomRadius; bloom.threshold = fx.bloomThreshold;
  fgRef.current?.postProcessingComposer().addPass(bloom);
  return () => { fgRef.current?.postProcessingComposer().removePass?.(bloom); };  // MIGRATION-MARKER: TSL/RenderPipeline (three r183+), см. Б6
}, [fx]);
```

**Glow-спрайт с кэшем материалов (канон прототипа; hex внутри canvas разрешён R22):**
```ts
const glowCache = new Map<string, THREE.SpriteMaterial>();
function glowMaterial(color: string, dim: boolean): THREE.SpriteMaterial {
  const key = color + (dim ? 'd' : '');
  let m = glowCache.get(key);
  if (m) return m;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, dim ? color + '66' : color);
  g.addColorStop(0.6, color + (dim ? '22' : '88')); g.addColorStop(1, 'transparent');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  glowCache.set(key, m); return m;
}
// nodeThreeObject: THREE.Group = Sprite(glowMaterial(цвет области, dim)) [+ SpriteText для branch/theme]
// размер: (branch 24 | theme 12 | entity 8) * (0.7 + 0.6*maturity); ghost → opacity 0.18
```

**Звёздный фон (свой, Б8 — канон прототипа):** сфера из `THREE.Points` (N=`3500`, радиус 600–3200, равномерно по сфере через `acos(2u-1)`, сплюснута по Y×0.55), `PointsMaterial{size:2.2, vertexColors, AdditiveBlending, depthWrite:false, opacity:.8}`, цвет lerp `#7f9dff→#1b2440` по радиусу; добавить в `fgRef.current.scene()`.

**Hover-подсветка соседей + частицы только на подсвеченном (официальный highlight-пример, адаптация из прототипа):** предрассчитать `node.neighbors`/`node.links` при загрузке; `Set highlightNodes/Links`; в `onNodeHover` перезаполнить и дёрнуть переприменение аксессоров (`fg.nodeThreeObject(fg.nodeThreeObject())` и т.д.); `linkDirectionalParticles(l => highlightLinks.has(l) ? 3 : 0)`, width 1.8, speed 0.008; не-соседей глушить dim-материалом.

**Полёт камеры (официальный click-to-focus):**
```ts
function flyTo(n: NodeObject, ms = 1600) {
  const d = 90, r = 1 + d / Math.hypot(n.x!, n.y!, n.z!);
  fgRef.current!.cameraPosition({ x: n.x! * r, y: n.y! * r, z: n.z! * r }, n, ms);
}
// fitAll: fgRef.current.zoomToFit(900, 40, n => !n.ghost)   ← призраков в кадр не считаем (канон прототипа)
```

**Авто-орбита (официальный camera-auto-orbit):** interval 16 мс, `cameraPosition({x: R*sin(a), y: R*0.18, z: R*cos(a)})`, `a += Math.PI/500`; R — текущая дистанция камеры.

**Замороженная раскладка с сервера + «оживание»:** узлам снапшота проставить `fx=x, fy=y, fz=z`; `<ForceGraph3D cooldownTicks={0} …>`; для дельты — новые узлы БЕЗ fx/fy/fz и `cooldownTicks={60}` на время прорастания, затем зафиксировать в `onEngineStop` (fx=x…) и вернуть `cooldownTicks={0}`.

**Дельта-прорастание (официальный dynamic-пример + emit-particles):** `setGraph(prev => ({nodes:[...prev.nodes, ...added], links:[...prev.links, ...addedLinks]}))`; по каждому новому ребру `fgRef.current.emitParticle(linkObj)`; мягкий `flyTo` к первому новому узлу, если пользователь не взаимодействовал ≥30 с.

**Дефолт сил клиента** (совпадает с сервером — визуальная преемственность): `d3Force('charge').strength(-70)`; `d3Force('link').distance(l => l.kind==='branch-adj'?150: l.kind==='in-branch'?34:60)`.

### Единый источник фронт↔бэк перечней

`kind`/`lens`/`link.kind`/цвета 12 областей — ТОЛЬКО в `frontend/src/domain/brain.ts` (UiModel) + `brain.dto.ts` (бэк); палитра областей: `[ASSUMPTION: взять существующее соответствие область→цвет из домена карты областей, если есть; иначе зафиксировать 12 hex из прототипа (строки AREAS) в domain/brain.ts]`. Никаких дублей enum в компонентах.

## Границы автономии исполнителя

- ✅ **Always:** переносить сниппеты как есть; держать один экземпляр three; все строки UI по-русски; tenant-фильтр в каждом запросе; идемпотентность джобы; крутилки через `getDynamic`, не константы.
- ⚠️ **Ask first (владельцу):** менять состав панелей/кнопок сцены; добавлять новые типы узлов; любые тексты nudge-сообщений вне тона «прокачка»; включение Louvain/2D-fallback.
- 🚫 **Never:** `prisma db push` в коммит; `new PrismaClient()` в скриптах (только `createPrismaClient()` из `scripts/_lib/prisma.ts`); `process.env.*`; пакеты `@cosmograph/*` и код deepscatter/GalaxyM1199/jaredmcqueen (лицензии/провенанс); блоки-факты узлами общей сцены; второй граф-движок; частицы на всех рёбрах разом; англицизмы в UI.

## Фазы (dependency-ordered: Ф0 → Ф1 → Ф2 → Ф3 ∥ Ф4 → Ф5)

### Фаза 0 — Спайк производительности и сборки `[ ]` (день)

**Ценность:** как команда, получаю числа FPS/сборки до инвестиций в экран, чтобы не строить на песке (Б13).
**Что входит:** (1) ветка-спайк: `bun add` пакетов из §Версии; страница `/dev/brain-spike` (route-группа `(design-preview)`) с генератором синтетики 1k/3k/5k узлов (правила рёбер как в контрактах) + полный вау-набор (bloom+звёзды+частицы-на-hover+спрайты) + FPS-метр (`requestAnimationFrame`-счётчик на экране); (2) прогон в Chrome/Safari/Brave на рабочем маке — таблица FPS; (3) контрольный прогон reagraph@4.32 на том же датасете 3k (двухчасовой, отдельная страница) — числа в таблицу; (4) прод-сборка `bun run build` — убедиться, что `three/webgpu`-импорт three-render-objects собирается (Грабля №2), зафиксировать бандл-размер чанка; (5) мини-тест утечки: кнопка mount/unmount ×10 + `performance.memory` до/после.
**Что НЕ входит:** реальные данные, продуктовый UI.
**Acceptance:** `[ ]` таблица результатов дописана в конец этого ТЗ (раздел Итог) с числами: FPS@1k/3k/5k по браузерам, reagraph@3k, heap-дельта, размер чанка; `[ ]` вердикт строкой: «go» ИЛИ список деградаций эффектов (что выключаем на каких порогах) ИЛИ эскалация владельцу при FPS<30 на 3k в Chrome; `[ ]` спайк-страница остаётся в `(design-preview)` (не удалять — это стенд).
**Закрывает:** R20 (предварительно), Б13.

### Фаза 1 — Backend: снапшот-конвейер и все эндпоинты `[ ]`

**Ценность:** как фронтенд-сцена, получаю готовый разложенный граф и дельты одним запросом, чтобы первый кадр был мгновенным (Б3).
**Мини-картография:** модуль `knowledge-core`: api/ (brain.controller.ts, brain.dto.ts — новые), services/ (brain-graph-builder.service.ts, brain-layout.util.ts, brain-gaps.service.ts, brain-nudge.service.ts — новые; branch-derivation.service.ts:39,80,104 — реюз), workers/ (brain-snapshot.processor.ts, brain-snapshot.cron.ts — новые; образец cron — graph-reconcile.cron.ts); prisma/schema.prisma (+модель, миграция `brain_graph_snapshot`); admin registry :16 (+13 строк) + сид-скрипт `seed-brain-settings.ts` (+ регистрация в `apply-prod-deploy.ts` STEPS, phase update); метрики — образец в common/metrics.
**Что входит:** всё из §Контракты (модель, builder по правилам сборки, layout-util со снипетом, очередь+jobId+sandboxed, cron dirty-check+ночной, Redis-кэш `brain:snap:{tenantId}` (SETEX 7d, инвалидация при новой версии), 6 эндпоинтов с Zod+Swagger+кодами ошибок, growth, gaps (пустые области + топ-3 слабых пар по `branch-adj` weight), summary, nudge через `proactive-message-craft` + throttle в Redis `brain:nudge:{tenantId}:{personId}` TTL 7d, крутилки+сид, метрики R17).
**Что НЕ входит:** любые фронт-файлы; Louvain; изменение branch-derivation/maturity.
**Acceptance:** `[ ]` `bun run typecheck && bun run lint` зелёные; `[ ]` миграция применяется на чистой dev-БД и повторно = no-op; `[ ]` unit (vitest): builder на фикстуре (3 области/2 темы/4 сущности/блоки) даёт детерминированные узлы/рёбра/веса и НЕ включает block-узлы; layout детерминирован (два прогона — одинаковые координаты); дельта пиннит старые (координаты старых не изменились) и располагает новые ≠(0,0,0); gaps находит пустую область и слабейшую пару; nudge: 2-й вызов в неделю → `BRAIN_NUDGE_THROTTLED`; `[ ]` integration: `GET /api/v1/knowledge/brain/graph` на «Стреле» → 200, nodes>100, links>150, все node.branch непустые, ответ <1.5 c; без entitlement → 403; чужой tenant → пусто/404; `[ ]` повторный прогон джобы без изменений данных → версия НЕ выросла (идемпотентность R15); `[ ]` grep-маркеры: `z_brain_snapshot_build_ms` в metrics-файле, `brain-snapshot:` jobId в процессоре, `RequireEntitlement('feature.graph')` в brain.controller.ts.
**Закрывает:** R12, R15, R16, R17, часть R10/R11/R14.

### Фаза 2 — Frontend: вкладка «Мозг» + вау-сцена `[ ]`

**Ценность:** как владелец, открываю Память→Мозг и вижу светящийся живой организм компании — впервые «чувствую», что Кора помнит (R1–R5, R18).
**Мини-картография:** [BranchMapClient.tsx:142-155](../../frontend/app/(authenticated)/memory/BranchMapClient.tsx) (третий TabsTrigger `brain` «Мозг», TabsContent с lazy-mount сцены только при активации таба); новые: `app/(authenticated)/memory/brain/` (BrainTab.tsx — оркестрация состояния: SWR graph, линзы, demo, фокус; BrainScene.tsx фасад; BrainSceneInner.tsx; BrainSkeleton.tsx; starfield.ts; glow.ts; bloom.ts); `src/api/brain.api.ts` (через api-client) → `src/domain/brain.ts` (ApiDto→Domain→Ui: недельные индексы для таймлапса из createdAt, цвета областей, neighbors-прошивка) — слои по frontend-rules.
**Что входит:** сцена по контракту фасада + ВСЕ сниппеты-каноны §Контракты (bloom-модуль с MIGRATION-MARKER, звёзды, glow-кэш, hover-подсветка+частицы, flyTo/fitAll/орбита, замороженный layout, линзы R8 как клиент-фильтр, демо-режим R18 с Esc, легенда, `?tab=brain&focus=` парсинг R19 частично — полёт после onReady); чтение fx-крутилок с бэка (прокинуть в конфиг-ответ graph-эндпоинта поле `fx` из AdminSetting — добавить в Ф1 DTO `fx: {bloomStrength, bloomRadius, bloomThreshold}`); деградация R21 (детект мобильного/WebGL, упрощённый режим); пустое состояние «собираем карту» на `BRAIN_SNAPSHOT_NOT_READY` (правила NN/g: статус+объяснение+CTA «подключить встречи»).
**Что НЕ входит:** drawer/поиск/hover-карточка (Ф3), gaps/таймлапс/дельта (Ф4).
**Acceptance:** `[ ]` `bun run typecheck && lint && build` зелёные (build ловит SSR/three-грабли); `[ ]` вкладка «Мозг» видна и лениво монтируется; `[ ]` Playwright-смоук: открыть /memory?tab=brain на «Стреле» — canvas присутствует, console errors = 0, скриншот визуально соответствует prototype/screenshot-overview.png (те же элементы: шапка-счётчик, чипы, легенда, светящиеся подписанные области); `[ ]` hover по узлу подсвечивает соседей ≤300 мс (визуально, смоук-видео/скрин); `[ ]` клик — полёт 1.6 с; `[ ]` unit domain/brain.ts: маппинг ApiDto→Ui, недельные индексы, прошивка neighbors; `[ ]` grep: `text-white` в новых файлах = 0; английских строк UI = 0; `dynamic(` + `ssr: false` присутствуют; `[ ]` вкладка скрыта при `brain.map.enabled=false` (kill-switch), плитки областей не задеты.
**Закрывает:** R1–R5, R8, R18, R21, R22, часть R19.

### Фаза 3 — Практичный слой: поиск, карточка узла, hover, история `[ ]`

**Ценность:** как менеджер, за два клика получаю «всё по X» и вижу, из какой встречи факт (R5–R7).
**Мини-картография:** новые `memory/brain/NodeDrawer.tsx`, `BrainSearch.tsx`, `HoverCard.tsx`, `BrainCrumbs.tsx`; api: summary-вызов; реюз паттерна drawer из существующих Sheet-компонентов проекта (найти по `Sheet`/`Drawer` в ui-ките — тот же стиль, что в смарт-таблицах RowDetail).
**Что входит:** поиск-автокомплит по узлам снапшота (label+aliases; aliases добавить в BrainNodeDto полем `aliases: string[]` для entity — дополнение Ф1 DTO) → flyTo+drawer (R7); drawer по `GET node/:id/summary` (состав R6 — канон prototype/screenshot-drilldown.png; соседи-карточки кликабельны; «Спросить Кору» = переход в чат с prefill `?ask=Расскажи про {label}` `[ASSUMPTION: параметр prefill чата — если нет, кнопка ведёт на /chat и копирует текст в буфер с тостом]`; «Открыть страницу» = pageHref); hover-карточка 400 мс задержки (id/label/facts/maturity из снапшота, без запроса); крошки-история последних 7 узлов + пины (localStorage `brain.pins`); Esc закрывает drawer; deep-link R19 полностью (фокус из URL, обновление URL при клике — router.replace без скролла).
**Что НЕ входит:** gaps-CTA (Ф4), правки бэка кроме aliases в DTO.
**Acceptance:** `[ ]` typecheck/lint/build; `[ ]` Playwright-сценарий: ввести «Логистик» → подсказка → Enter → камера летит, drawer открыт, в нём ≥1 факт с подписью источника и рабочая ссылка «Открыть страницу» (переход на /entities/... 200); `[ ]` unit: автокомплит (регистр/aliases/limit 6), формат крошек; `[ ]` summary-эндпоинт под нагрузкой Стрелы < 800 мс; `[ ]` негатив: узел без фактов — drawer показывает пустой блок с CTA (не краш); битый nodeId в ?focus= — тост «узел не найден», сцена жива.
**Закрывает:** R6, R7, R19; частично R9 (CTA в карточке).

### Фаза 4 — Пустоты, рост, время `[ ]`

**Ценность:** как руководитель, вижу дыры и запускаю их заполнение одной кнопкой; как владелец — вижу, что мозг растёт (R9–R15).
**Мини-картография:** `GapsPanel.tsx`, `Timeline.tsx`, `GrowthBadge.tsx` в memory/brain/; хук `useBrainDelta.ts` (SWR-поллинг delta по `brain.delta.pollSeconds`, пауза при document.hidden); ghost-стили в glow.ts.
**Что входит:** ghost-узлы R9 (в т.ч. legend-строка); панель «Пробелы» R10 (данные gaps; тексты — канон прототипа; CTA: «Спросить на встрече» → создать probe/повестку `[ASSUMPTION: если готового «в повестку» нет — CTA шлёт вопрос себе в чат Коры]`, «Попросить подлить» → POST nudge c выбором адресата из людей области (простой select), обработка 429 тостом); таймлапс R13 (ползунок+Play, недельные индексы из domain, «orphans off»: узел виден с недели первого ребра; области видны всегда); growth-бейдж R12 в шапке; дельта R14 (мердж+emitParticle+мягкий flyTo, обновление growth). Nudge-текст — крафт через proactive (уже cache-friendly), тон «прокачка» (образец в архитектуре §4в).
**Что НЕ входит:** авто-nudge без действия человека (never в этом ТЗ); недельные отчёты.
**Acceptance:** `[ ]` typecheck/lint/build; `[ ]` unit: недельная сетка таймлапса (первая неделя данных → индекс 1), orphans-правило, дельта-мердж без дублей узлов; `[ ]` Playwright: Play проигрывает ≥3 недели с видимым появлением узлов; панель пробелов показывает «Финансы» на фикстуре с пустой областью; клик nudge → тост успеха; повторный → тост «уже просили»; `[ ]` дельта-смоук: вставить в dev-БД новую сущность+ребро, дождаться поллинга → узел пророс без reload (видео/скрин), growth вырос; `[ ]` grep: `BRAIN_NUDGE_THROTTLED` обработан на фронте.
**Закрывает:** R9–R15 полностью.

### Фаза 5 — Надёжность, деградация, прод `[ ]`

**Ценность:** как компания, получаю фичу, которая не течёт, не падает в чужих браузерах и выкатывается штатно.
**Что входит:** e2e-тест утечки R20 (Playwright: 10× переключение вкладки Мозг↔Карта, замер `performance.memory.usedJSHeapSize` после принудительного GC-хинта; починка через dispose-путь Inner: `fgRef.current._destructor?.()` + очистка glowCache/starfield-геометрий в cleanup); кросс-браузерный смоук-чеклист (Chrome/Safari/Brave/Firefox — R-набор: рендер, hover, drawer; Brave — известный риск #597); мобильный режим R21 финально; presentation-режим отполирован (скрыть всё, курсор auto-hide 3 c); заполнение прод-артефактов (ниже); second-brain-обновления (ниже); строка kill-switch в [docs/operations/feature-flags.md](../../docs/operations/feature-flags.md).
**Что НЕ входит:** новые фичи.
**Acceptance:** `[ ]` e2e утечки зелёный с порогом R20; `[ ]` чеклист браузеров заполнен в Итоге (4 браузера × ок/деградация); `[ ]` `bun run test:unit` + `test:integration` зелёные целиком; `[ ]` Swagger smoke: 6 эндпоинтов видны в /api/docs; `[ ]` prod-deploy-log и feature-flags.md обновлены (grep строк `brain.map.enabled`, `brain_graph_snapshot`); `[ ]` рефлексия-заметка по триггеру push (процесс проекта).
**Закрывает:** R20, R21 финально; DoD.

## Сквозные аспекты (чек)

- **RBAC/tenant:** все запросы через TenantGuard + tenantId-фильтры; entitlement существующий (R16). Доступ к знаниям через graph НЕ расширяется: узлы = сущности/темы (уже видимые в реестрах); блоки — через summary с теми же правилами, что живая тема `[ASSUMPTION: если у блоков есть knowledge-access группы — summary фильтрует по ним тем же сервисом, что лента темы; проверить при реализации Ф1 по IdeaBlockAccess]`.
- **Observability:** метрики R17 + pino-логи джобы (start/done/ms/nodes) + console errors фронта = 0 в смоуках.
- **Ошибки/идемпотентность:** machine-readable коды (`BRAIN_SNAPSHOT_NOT_READY`, `BRAIN_NUDGE_THROTTLED`, `BRAIN_NUDGE_NO_TARGET`); джоба идемпотентна (R15); nudge-throttle.
- **Миграции/backfill:** одна миграция; backfill не нужен (снапшоты строятся с нуля джобой) — `[N/A: данных для переноса нет]`.
- **Rollout:** Ship-On, kill-switch Б12; без параметров владельца — `[N/A: доступ уже определён entitlement feature.graph]`.
- **Тесты:** пофазно выше; golden-фикстура графа — в Ф1 unit.
- **Prompt-caching:** `[N/A: своих LLM-вызовов нет; nudge реюзает существующий cache-friendly proactive-крафт]`.

## Pre-mortem / риски (что искать на ревью)

1. **Двойной three** → shader-краш (issue #558): проверять lock-файл на каждом PR фазы 2+ (grep-acceptance Ф0/Ф2).
2. **Утечки при переключении вкладок** (#62/#202/#255): dispose-путь обязателен, e2e R20 — не скипать.
3. **Hairball при росте данных:** cap+truncated (Б5) и co-mention-порог; при truncated=true фронт показывает бейдж «показаны самые связанные N».
4. **Дрейф layout при полном ребилде** (ночной пересчёт двигает всё): допустимо (пользователь не держит сцену сутками); дельты внутри дня не двигают старое (pinning-тест Ф1).
5. **CSP прода:** WebGL-шейдеры инлайновые — при закрученном CSP проверить в Ф5 смоуке на prod-подобном окружении (урок Logseq).
6. **Пустой/молодой тенант:** 12 областей почти все ghost → сцена всё равно осмысленна (кольцо областей + пустое состояние с CTA) — негатив-кейс в Ф2.
7. **Deprecated EntityType.client:** в выборках сущностей учитывать оба (`client`+`customer`) до завершения patch-rename.
8. **Bus factor движка:** фасад Б2 + спайк-стенд Ф0 остаются как страховка миграции.

## Prod-влияние (в prod-deploy-log при выкате)

- Шаг 4: миграция `brain_graph_snapshot` (новая таблица; применится автоматически `migrate deploy`).
- Шаг 7: `bun run scripts/seed-brain-settings.ts` — сид 13 крутилок brain.* (зарегистрировать в `apply-prod-deploy.ts` STEPS, phase seed/update).
- Шаг 12: smoke — новая очередь `brain-graph-snapshot` + cron `brain-snapshot.cron` (grep логов старта воркеров); Swagger-теги `brain` (6 эндпоинтов); первая сборка снапшотов после деплоя (ночной cron или ручной enqueue).
- ENV — нет. Реестр флагов: строка `brain.map.enabled` (kill-switch, ON) в feature-flags.md.

## Second-brain после реализации (таблица производных)

`01_projects/brain-map.md` (новая профильная заметка) · `02_architecture/module-map.md` (+brain в knowledge-core) · `02_architecture/data-model.md` (+BrainGraphSnapshot) · `01_projects/api-layer.md` (+6 эндпоинтов) · `01_projects/workers-queues.md` (+очередь/cron) · `01_projects/admin.md` (+крутилки brain.*) · `01_projects/frontend-pages.md` (+вкладка Мозг).

## DoD (каждая фаза)

`bun run typecheck && bun run lint && bun run build` (frontend и backend по принадлежности) зелёные; vitest фазы зелёные; UI-строки русские; без `process.env`/`new PrismaClient(`/`prisma db push`/`@cosmograph/`; acceptance-чекбоксы фазы проставлены с датой; расхождения с ТЗ — зафиксированы в Итоге, не замолчаны.

## Итог (заполняет оркестратор)

**Реализовано целиком:** нет (ТЗ готово 2026-07-05, код не начат). Ф0 `[ ]` · Ф1 `[ ]` · Ф2 `[ ]` · Ф3 `[ ]` · Ф4 `[ ]` · Ф5 `[ ]`.
Таблица спайка Ф0: _(FPS@1k/3k/5k Chrome/Safari/Brave · reagraph@3k · heap-дельта · чанк)_ — заполнить.
Чеклист браузеров Ф5: — заполнить.
