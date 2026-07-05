---
type: analysis
status: research-input
segment: engine-gpu
snapshot_date: 2026-07-05
---

# Контур 06: GPU/WebGL-движки для очень больших графов

Исследованы: **cosmos.gl** (бывший @cosmograph/cosmos), **Cosmograph** (продукт поверх cosmos.gl), **sigma.js v3 + graphology**, **deepscatter** (Nomic), **regl-scatterplot**. Все лицензии проверены по первоисточникам (npm registry + LICENSE в репо + сайты вендоров), даты релизов — по GitHub API. Снимок на 2026-07-05.

**Главный лицензионный итог контура (для коммерческого SaaS Коры):**

| Пакет | Версия | Лицензия | Коммерция |
|---|---|---|---|
| `@cosmos.gl/graph` (движок) | 3.1.0 | **MIT** | ✅ можно |
| `@cosmograph/cosmograph` (продукт) | 2.3.2 | **CC-BY-NC-4.0** | ❌ блокер (платная Business-лицензия) |
| `@cosmograph/react` | 2.3.2 | **CC-BY-NC-4.0** | ❌ блокер + нет React 19 в peerDeps |
| `sigma` | 3.0.3 | **MIT** | ✅ можно |
| `graphology` (+ все плагины louvain/fa2) | 0.26.0 | **MIT** | ✅ можно |
| `@react-sigma/core` | 5.0.6 | **MIT** | ✅ можно (React 18/19) |
| `deepscatter` | 2.15.2 | **CC-BY-NC-SA-4.0** | ❌ блокер (лицензия у Nomic) |
| `regl-scatterplot` | 1.16.0 | **MIT** | ✅ можно |

Все строки таблицы — [verified] через `npm view <pkg> license` (registry.npmjs.org, 2026-07-05) и подтверждены LICENSE/README репозиториев (ссылки в карточках).

---

## Карточки

### 1. cosmos.gl — `@cosmos.gl/graph` (бывший `@cosmograph/cosmos`)

**Функционально простым языком.** Движок force-графа (граф с физической симуляцией притяжения/отталкивания), у которого ВСЯ физика — не только отрисовка — считается на GPU (видеокарте) в шейдерах (программах, исполняемых на видеокарте). CPU почти не занят: раскладка сотен тысяч узлов «разворачивается» на глазах за секунды. Это тот самый эффект «мозг растёт на глазах»: бросаешь сырые точки — и граф живьём расплетается в структуру. Проект в мае 2025 передан в OpenJS Foundation (фонд, где живут Node.js, Electron и т.п.) и сменил имя `@cosmograph/cosmos` → `@cosmos.gl/graph`; старый npm-пакет помечен deprecated с текстом «This package has been moved to @cosmos.gl/graph» [verified, npm registry 2026-07-05].

- Репо: https://github.com/cosmosgl/graph — **MIT** [verified по LICENSE через GitHub API, spdx MIT], 1191 звезда, последний push 2026-07-02 (живой).
- Релизы: v3.0.0 — 2026-06-17, **v3.1.0 — 2026-06-30** [verified, GitHub Releases API]; в npm dist-tags: latest 3.1.0, beta 3.2.0-beta.0 [verified].
- Вступление в OpenJS: анонс 2025-05-14, создатель Никита Рокотян, поддерживают Рокотян и Ольга Стукова — https://openjsf.org/blog/introducing-cosmos-gl [verified].
- Заявка масштаба: «visualize over one million nodes and links» — из блога OpenJS [claimed, слова мейнтейнеров]; README: «real-time simulation of hundreds of thousands of points and links on modern hardware» [claimed].
- **Официальный стресс-тест в репо: «Hyperbolic Graph (140k points, ~1M links)»** — числа зашиты в название стори [verified, исходник]: https://github.com/cosmosgl/graph/blob/main/src/stories/stress-test.stories.ts
- **2D-only.** API оперирует только парами (x, y); ни одного упоминания 3D в README/доках/сториях [verified по README и config.ts; отсутствие — inferred].
- Ограничение симуляционного пространства: `spaceSize` по умолчанию 4096, «larger values may crash on some devices, e.g. iOS» (issue #203) [verified, комментарий в src/config.ts]. Из статьи Рокотяна: пространство — квадратная сетка; при переполнении сетки раскладка «шумит» артефактами [verified, Nightingale 2022-08-23].

**Вау-приёмы.**
- Живая GPU-симуляция: граф «кипит» и расплетается в реальном времени — главный вау контура.
- v3: **GPU-переходы всего** — позиции, цвета, размеры точек анимируются по умолчанию (`transitionDuration: 800`, easing CubicInOut) даже на сотнях тысяч узлов [verified, README v3].
- Подсветка соседей из коробки: `highlightedPointIndices` / `outlinedPointIndices` / `focusedLinkIndex` + `getNeighboringPointIndices()` [verified, README v3].
- Кластерная сила (`simulationCluster` + `setPointClusters`) — узлы стягиваются к центроидам своих кластеров; `getClusterPositions()` отдаёт центроиды для HTML-подписей [verified, стори clusters].
- Collision force (GPU, spatial-hash) — точки не наползают друг на друга [verified, README v3].
- Touch/пинч/long-press на планшетах — демо у клиента с телефона [verified, README v3].

**Технически.**
- v3 отрисовка портирована с regl на **luma.gl (WebGL 2)**; конструктор асинхронный (`graph.ready`), можно шарить один GPU-`Device` между несколькими графами [verified, README + https://openjsf.org/blog/cosmos-gl-v3 от 2026-06-25].
- Данные — плоские `Float32Array`: позиции `[x1,y1,x2,y2,...]`, связи — пары индексов `[src,tgt,...]`. Никаких объектов на узел — поэтому и масштаб.
- `linkBlending: false` — отключить альфа-смешение рёбер = заметно быстрее на плотных графах [verified, README v3].
- SSR: чистый браузерный класс (WebGL, DOM) — в Next.js App Router только `"use client"` + создание в `useEffect`; официальной React-обёртки **нет** (`@cosmos.gl/react` в npm не существует — 404 [verified]). Community-обёртка `@sqlrooms/cosmos` 0.28.0 (MIT, react>=18, но пиннит движок ^2.6.4, не v3) [verified, npm].

Источник (README Quick Start): https://github.com/cosmosgl/graph#quick-start

```ts
import { Graph } from '@cosmos.gl/graph'

const div = document.querySelector('div')
const config = {
  spaceSize: 4096,
  simulationFriction: 0.1, // инертность графа
  simulationGravity: 0,    // выключить гравитацию
  simulationRepulsion: 0.5,// сила отталкивания точек
  curvedLinks: true,
  fitViewOnInit: true,
  fitViewDelay: 1000,
  fitViewPadding: 0.3,
  enableDrag: true,
  onClick: (pointIndex) => { console.log('Clicked point index: ', pointIndex) },
}

const graph = new Graph(div, config)

// Точки: [x1, y1, x2, y2, x3, y3]
graph.setPointPositions(new Float32Array([0.0, 0.0, 1.0, 0.0, 0.5, 1.0]))
// Связи: [источник1, цель1, источник2, цель2]
graph.setLinks(new Float32Array([0, 1, 1, 2, 2, 0]))
graph.render()
```

Подсветка соседей при hover (минимальная адаптация под API v3 из README — `getNeighboringPointIndices` + config-driven highlighting): https://github.com/cosmosgl/graph#whats-new-in-v30

```ts
graph.setConfigPartial({
  onPointMouseOver: (index) => {
    const neighbors = graph.getNeighboringPointIndices(index)
    const links = graph.getConnectedLinkIndices(index)
    graph.setConfigPartial({
      highlightedPointIndices: [index, ...(neighbors ?? [])],
      highlightedLinkIndices: links ?? [],
    })
  },
  onPointMouseOut: () => {
    graph.setConfigPartial({ highlightedPointIndices: [], highlightedLinkIndices: [] })
  },
})
```

Подписи кластеров HTML-оверлеем (скопировано с сокращением из официальной стори): https://github.com/cosmosgl/graph/blob/main/src/stories/create-cluster-labels.ts и https://github.com/cosmosgl/graph/blob/main/src/stories/clusters/with-labels.ts

```ts
const { div, graph } = createCosmos({
  pointPositions, pointColors, pointClusters, // pointClusters: индекс кластера на точку
  simulationGravity: 2,
  simulationCluster: 0.25, // сила стягивания к центроиду кластера
  simulationRepulsion: 10,
})

const updateClusterLabels = (graph: Graph): void => {
  const clusterPositions = graph.getClusterPositions() // [x1,y1,x2,y2,...]
  for (let i = 0; i < clusterPositions.length / 2; i++) {
    const [x, y] = clusterPositions.slice(i * 2, i * 2 + 2)
    const screenXY = graph.spaceToScreenPosition([x ?? 0, y ?? 0])
    labelDivs[i].style.left = `${screenXY[0]}px`
    labelDivs[i].style.top = `${screenXY[1]}px`
  }
}
graph.setConfigPartial({
  onZoom: () => updateClusterLabels(graph),
  onSimulationTick: () => updateClusterLabels(graph),
})
```

React 19 / Next.js 16 (обёртки нет — свой клиентский компонент, паттерн стандартный для ванильных WebGL-классов):

```tsx
'use client'
import { useEffect, useRef } from 'react'
import { Graph } from '@cosmos.gl/graph'

export function BrainGraph({ positions, links }: { positions: Float32Array; links: Float32Array }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const graph = new Graph(ref.current, { fitViewOnInit: true, enableDrag: true })
    graph.setPointPositions(positions)
    graph.setLinks(links)
    graph.render()
    return () => graph.destroy()
  }, [positions, links])
  return <div ref={ref} className="h-full w-full" />
}
```

**Что берём для Коры.** Первый кандидат на «вау-режим мозга»: MIT, живой (релиз 5 дней назад), GPU-раскладка тысяч узлов Коры мгновенна (стресс-тест 140k/1M — на 1-2 порядка выше нашего масштаба), кластерная сила идеально ложится на «12 областей компании» (области = pointClusters, подписи — HTML-оверлей по `getClusterPositions`), GPU-переходы дают «мозг дышит» бесплатно. Минусы: 2D-only (полёт камеры — только zoom/pan, не орбита), нет рендера меток узлов (лейблы — свой HTML/canvas-слой), React-обёртку пишем сами (30 строк). Для drill-down-навигации голого cosmos мало — нет reducer-модели и богатого label-менеджмента, это территория sigma.

**Источники.**
- https://github.com/cosmosgl/graph — README, LICENSE MIT, 2026-07-02 [verified]
- https://openjsf.org/blog/introducing-cosmos-gl — 2025-05-14 [verified]
- https://openjsf.org/blog/cosmos-gl-v3 — 2026-06-25 [verified]
- https://github.com/cosmosgl/graph/blob/main/src/config.ts — spaceSize/iOS [verified]
- https://github.com/cosmosgl/graph/blob/main/src/stories/stress-test.stories.ts — 140k/1M [verified]
- https://nightingaledvs.com/how-to-visualize-a-graph-with-a-million-nodes/ — Рокотян, 2022-08-23, устройство GPU-раскладки [verified, но 2022 год — про v1/regl]
- npm registry: `@cosmos.gl/graph` 3.1.0 MIT; `@cosmograph/cosmos` deprecated [verified 2026-07-05]

---

### 2. Cosmograph — `@cosmograph/cosmograph` + `@cosmograph/react`

**Функционально простым языком.** Готовый «комбайн» поверх cosmos.gl от той же команды: компонент графа + сопутствующие виджеты (гистограммы, таймлайн, поиск, легенды) + приложение run.cosmograph.app + Jupyter-виджет. То, что в cosmos.gl пришлось бы собирать руками, здесь из коробки.

**Вау-приёмы.** Те же, что у cosmos.gl (это его витрина), плюс связанные виджеты: клик по гистограмме фильтрует граф и наоборот.

**Технически.**
- `@cosmograph/react` 2.3.2 (опубликован 2026-06-23): peerDeps `react >=16.8.0 || ^17 || ^18` — **React 19 НЕ заявлен** [verified, npm registry]. В React 19-проект встанет только через `overrides`/`--legacy-peer-deps` — на свой риск.
- **Лицензия — главный факт: CC-BY-NC-4.0 на оба пакета** [verified, npm license field]. Страница «Citing and licensing» подтверждает: «Cosmograph is freely available for non-commercial use under the Creative Commons Attribution Non Commercial CC BY-NC 4.0», «this license does not permit commercial use of the Cosmograph software», для коммерции — «reach out to us for a Business license» (цены не публикуются) [verified]: https://cosmograph.app/docs-general/citing-and-licensing/
- Заявка производительности продукта: «up to 1 million nodes and several million edges in real-time» [claimed, cosmograph.app].

Источник (доки React): https://cosmograph.app/docs/cosmograph/Cosmograph%20Library/React%20Advanced%20Usage/ — ТОЛЬКО как справка, в Кору не тащим:

```tsx
import { CosmographProvider, Cosmograph, CosmographHistogram, useCosmograph } from '@cosmograph/react'

const FitButton = () => {
  const { cosmograph } = useCosmograph()
  return <button onClick={() => cosmograph.fitView()}>Fit View</button>
}

const App = () => (
  <CosmographProvider>
    <Cosmograph {...config} />
    <CosmographHistogram accessor={'value'} />
    <FitButton />
  </CosmographProvider>
)
```

**Что берём для Коры.** **Ничего из кода — лицензионный блокер для SaaS** (CC-BY-NC + непубличная Business-лицензия + нет React 19). Берём как референс UX: связка «граф + гистограмма + поиск + таймлайн» — образец аналитического режима, который собираем сами из MIT-частей (cosmos.gl + свои виджеты). Важно не перепутать в package.json: движок `@cosmos.gl/graph` — можно, всё с префиксом `@cosmograph/*` — нельзя.

**Источники.**
- https://cosmograph.app/docs-general/citing-and-licensing/ — CC-BY-NC-4.0, Business license [verified]
- npm: `@cosmograph/cosmograph` 2.3.2 CC-BY-NC-4.0; `@cosmograph/react` 2.3.2 CC-BY-NC-4.0, peer react ≤18 [verified 2026-07-05]
- https://cosmograph.app/ — «1 million nodes» [claimed]

---

### 3. sigma.js v3 + graphology (+ `@react-sigma/core`)

**Функционально простым языком.** Зрелый тандем: **graphology** — модель графа и алгоритмы (сообщества, метрики, раскладки), **sigma.js** — WebGL-отрисовка и интеракции. Позиционирование самих авторов: «graphs of thousands of nodes and edges» [verified, sigmajs.org]. Это не «миллионный» движок, а рабочая лошадка интерактивной навигации: hover-подсветка соседей, поиск с автодополнением, кастомные формы узлов, curved edges (изогнутые рёбра), метки с приоритетами. В проде: Gephi Lite и G.V() [verified, слова мейнтейнера в discussion #1469].

- Репо: https://github.com/jacomyal/sigma.js — **MIT**, 12 082 звезды; sigma 3.0.3 (релиз 2026-04-30), идёт v4 (4.0.0-alpha.7) [verified, GitHub API + npm].
- Делают OuestWare + Sciences Po médialab, спонсор v3 — автор G.V() [verified, https://www.ouestware.com/2024/03/21/sigma-js-3-0-en/].
- graphology 0.26.0 MIT; graphology-communities-louvain 2.0.2 MIT; graphology-layout-forceatlas2 0.10.1 MIT [verified, npm].
- `@react-sigma/core` **5.0.6** (2025-12-01): peerDeps `react ^18.0.0 || ^19.0.0`, `sigma ^3.0.2`, `graphology ^0.26.0` — **React 19 официально поддержан** [verified, npm].

**Лимиты числами.**
- Собственная заявка: «тысячи узлов и рёбер» [verified, sigmajs.org].
- Оценка конкурента (Linkurious Ogma, осторожно — заинтересованная сторона): sigma «renders 100k edges easily with default styles», «struggles with 5k nodes with icons», «force layout falls beyond 50,000 edges» [claimed(competitor)]: https://doc.linkurious.com/ogma/latest/compare/sigmajs.html
- Ключевое отличие от cosmos: **раскладка на CPU** (ForceAtlas2 в web worker — отдельном фоновом потоке браузера), GPU — только отрисовка. На 100k+ узлов раскладка будет минутами, отрисовка — терпимо.
- v3 внутри: instanced rendering (переиспользование геометрии), picking (определение узла под курсором) без ручного quadtree [verified, блог OuestWare]. v4-план: order-independent transparency, picking+render в один проход, рёбра+узлы в одном слое, DOM-метки [verified, discussion #1469].

**Вау-приёмы.**
- Reducer-модель: `nodeReducer`/`edgeReducer` перекрашивают/прячут узлы на лету без мутации данных — hover-подсветка соседей, «пригасить всё нерелевантное» — эталонный паттерн drill-down.
- Кастомные шейдерные программы узлов: градиент/свечение/пиктограммы/бордеры (`@sigma/node-border` — множественные кольца ≈ halo).
- `@sigma/edge-curve` — изогнутые рёбра с метками.

**Технически — сниппеты.**

Hover-подсветка соседей через reducers (скопировано с сокращением из официальной стори): https://github.com/jacomyal/sigma.js/blob/main/packages/storybook/stories/1-core-features/4-use-reducers/index.ts

```ts
import Graph from "graphology";
import Sigma from "sigma";

const graph = new Graph();
graph.import(data);
const renderer = new Sigma(graph, container);

const state: { hoveredNode?: string; hoveredNeighbors?: Set<string> } = {};

function setHoveredNode(node?: string) {
  state.hoveredNode = node;
  state.hoveredNeighbors = node ? new Set(graph.neighbors(node)) : undefined;
  renderer.refresh({ skipIndexation: true }); // данные графа не менялись — дёшево
}

renderer.on("enterNode", ({ node }) => setHoveredNode(node));
renderer.on("leaveNode", () => setHoveredNode(undefined));

renderer.setSetting("nodeReducer", (node, data) => {
  const res = { ...data };
  if (state.hoveredNeighbors && !state.hoveredNeighbors.has(node) && state.hoveredNode !== node) {
    res.label = "";
    res.color = "#f6f6f6"; // пригасить не-соседей
  }
  return res;
});

renderer.setSetting("edgeReducer", (edge, data) => {
  const res = { ...data };
  if (
    state.hoveredNode &&
    !graph.extremities(edge).every((n) => n === state.hoveredNode || graph.areNeighbors(n, state.hoveredNode))
  ) {
    res.hidden = true;
  }
  return res;
});
```

Louvain-кластеризация (детекция сообществ; скопировано из README): https://github.com/graphology/graphology/blob/master/src/communities-louvain/README.md

```js
import louvain from 'graphology-communities-louvain';

const communities = louvain(graph);      // { nodeKey: communityIndex }
louvain.assign(graph);                   // записать community в атрибут узла
louvain.assign(graph, { resolution: 0.8 }); // меньше resolution — крупнее сообщества
const details = louvain.detailed(graph); // count, modularity, dendrogram
```

Бенчмарк Louvain из того же README [verified]: граф 1000 узлов / 9724 рёбер — **52.7 мс** (graphology) против 2368 мс (jlouvain); EuroSIS 1285/7524 — 30.8 мс. На масштабе Коры (тысячи узлов) — мгновенно, можно звать на каждый пересчёт графа.

Кастомная шейдерная программа узла — градиент, основа для glow (скопировано с сокращением): https://github.com/jacomyal/sigma.js/blob/main/packages/storybook/stories/1-core-features/5-custom-rendering/node-gradient.ts

```ts
import { NodeProgram, ProgramInfo } from "sigma/rendering";
import { NodeDisplayData, RenderParams } from "sigma/types";
import { floatColor } from "sigma/utils";

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;
const UNIFORMS = ["u_sizeRatio", "u_pixelRatio", "u_matrix"] as const;

export default class NodeGradientProgram extends NodeProgram<(typeof UNIFORMS)[number]> {
  getDefinition() {
    return {
      VERTICES: 1,
      VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
      METHOD: WebGLRenderingContext.POINTS,
      UNIFORMS,
      ATTRIBUTES: [
        { name: "a_position", size: 2, type: FLOAT },
        { name: "a_size", size: 1, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
    };
  }
  processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData) {
    const array = this.array;
    array[startIndex++] = data.x;
    array[startIndex++] = data.y;
    array[startIndex++] = data.size;
    array[startIndex++] = floatColor(data.color);
    array[startIndex++] = nodeIndex;
  }
  setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo): void {
    const { u_sizeRatio, u_pixelRatio, u_matrix } = uniformLocations;
    gl.uniform1f(u_sizeRatio, params.sizeRatio);
    gl.uniform1f(u_pixelRatio, params.pixelRatio);
    gl.uniformMatrix3fv(u_matrix, false, params.matrix);
  }
}
```

Фрагментный шейдер к нему (радиальный градиент от цвета к белому центру; для glow меняем `mix` на затухание альфы к краю): https://github.com/jacomyal/sigma.js/blob/main/packages/storybook/stories/1-core-features/5-custom-rendering/node-gradient-frag.glsl.ts

```glsl
precision mediump float;
varying vec4 v_color;
varying float v_border;
const float radius = 0.5;

void main(void) {
  vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
  vec4 white = vec4(1.0, 1.0, 1.0, 1.0);
  float distToCenter = length(gl_PointCoord - vec2(0.5, 0.5));
  if (distToCenter > radius)
    gl_FragColor = transparent;
  else if (distToCenter > radius - v_border)
    gl_FragColor = mix(transparent, v_color, (radius - distToCenter) / v_border);
  else
    gl_FragColor = mix(v_color, white, (radius - distToCenter) / radius);
}
```

Готовые кольца/бордеры без своего GLSL (скопировано из README): https://github.com/jacomyal/sigma.js/blob/main/packages/node-border/README.md

```ts
import { NodeBorderProgram } from "@sigma/node-border";

graph.addNode("some-node", {
  x: 0, y: 0, size: 10, type: "border",
  label: "Some node", color: "blue", borderColor: "red",
});

const sigma = new Sigma(graph, container, {
  nodeProgramClasses: { border: NodeBorderProgram },
});
```

Большие графы: быстрые рёбра + ForceAtlas2 в worker (скопировано с сокращением): https://github.com/jacomyal/sigma.js/blob/main/packages/storybook/stories/2-advanced-usecases/large-graphs/index.ts

```ts
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import { EdgeLineProgram, EdgeRectangleProgram } from "sigma/rendering";

const renderer = new Sigma(graph, container, {
  defaultEdgeColor: "#e6e6e6",
  defaultEdgeType: "edges-fast",
  edgeProgramClasses: {
    "edges-default": EdgeRectangleProgram, // толщина, но дороже
    "edges-fast": EdgeLineProgram,         // 1px-линии, сильно быстрее
  },
});

const sensibleSettings = forceAtlas2.inferSettings(graph);
const fa2Layout = new FA2Layout(graph, { settings: sensibleSettings });
fa2Layout.start(); // раскладка в web worker, не блокирует UI
```

React 19 + Next.js 16 App Router (`window`/WebGL нет на сервере → только динамический импорт внутри клиентского компонента): паттерн из FAQ react-sigma и обсуждения Next.js [verified]: https://sim51.github.io/react-sigma/docs/faq/ и https://github.com/vercel/next.js/discussions/73861

```tsx
'use client'
import dynamic from "next/dynamic";

// dynamic({ ssr: false }) в App Router допустим только в client-компоненте
const SigmaContainer = dynamic(
  () => import("@react-sigma/core").then((mod) => mod.SigmaContainer),
  { ssr: false },
);

export default function GraphView() {
  return (
    <SigmaContainer style={{ height: "600px" }}>
      {/* LoadGraph-компонент с useLoadGraph() внутри */}
    </SigmaContainer>
  );
}
```

`npm install @react-sigma/core sigma graphology` + обязательный CSS `import "@react-sigma/core/lib/style.css"` [verified, доки react-sigma].

**Что берём для Коры.** Основной кандидат на **практичную навигацию** (режим 2 из ТЗ): reducers = «пригасить всё, кроме ветки», louvain = автоматические сообщества поверх наших 12 областей (проверка «где области рвутся»), поиск + автозум камеры на узел (`camera.animate`) — из стори reducers, curved edges для параллельных рёбер, node-border — статусные кольца («наполнено/пусто»). Масштаб Коры (тысячи узлов) — комфортная зона sigma. 3D нет (максимум наклон камеры `angle`). Слабое место — «вау»: физика на CPU, живой полёт раскладки на десятках тысяч узлов не покажет.

**Источники.**
- https://github.com/jacomyal/sigma.js — MIT, 12 082 звезды [verified]
- https://www.sigmajs.org/ — «thousands of nodes and edges» [verified]
- https://www.ouestware.com/2024/03/21/sigma-js-3-0-en/ — 2024-03-21, что нового в v3 [verified]
- https://github.com/jacomyal/sigma.js/discussions/1469 — статус v3/план v4, Gephi Lite и G.V() в проде [verified]
- https://doc.linkurious.com/ogma/latest/compare/sigmajs.html — лимиты 100k рёбер / 5k узлов с иконками / FA2 после 50k рёбер [claimed(competitor)]
- npm: sigma 3.0.3, @react-sigma/core 5.0.6 (react ^18||^19), louvain 2.0.2, fa2 0.10.1 — все MIT [verified 2026-07-05]

---

### 4. deepscatter — Nomic (движок Atlas)

**Функционально простым языком.** Зумируемый скаттерплот (точечная диаграмма) «на миллиарды точек»: данные заранее нарезаются в квадродерево тайлов Apache Arrow (колоночный бинарный формат), браузер догружает тайлы по мере зума — как карты Google, только из точек. Это движок Nomic Atlas (карты эмбеддингов LLM). НЕ граф: рёбер и force-раскладки нет.

**Вау-приёмы.** Плавные GPU-интерполяции между проекциями; «миллиард точек со статического хостинга» (тайлы можно раздавать с GitHub Pages). Примеры из README [verified]: 5.5M твитов (Atlas), 20M биомедицинских абстрактов (Nomic + Тюбинген), 1M+ документов arXiv.

**Технически.**
- Рендер: WebGL через regl, трансформации grammar-of-graphics на GPU [verified, README].
- Подготовка данных: **обязательный офлайн-шаг на Python** — companion-утилита quadfeather нарезает тайлы (пример из README: 1M точек тайлами по 50 000) [verified].
- npm deepscatter 2.15.2, последняя публикация 2025-05-29; репо nomic-ai/deepscatter — 1155 звёзд, последний push 2025-05-29 — **13+ месяцев без движения** [verified, GitHub API].
- **Лицензия: CC-BY-NC-SA-4.0** (npm license field; README: «provided under an NC-CC-BY-SA license for all noncommercial use»); блог автора Бена Шмидта прямо: «any commercial applications require a license from Nomic» [verified]: https://benschmidt.org/post/2022-10-27-career-news/

**Что берём для Коры.** **Ничего в код: двойной блокер** — некоммерческая лицензия + Python-шаг подготовки (противоречит принципу №7 CLAUDE.md). Берём идею: тайловая подгрузка уровней детализации по зуму — паттерн для будущего «семантического зума» мозга Коры (области → темы → сущности → блоки), реализуемый поверх любого MIT-движка собственным loader-ом.

**Источники.**
- https://github.com/nomic-ai/deepscatter — README, примеры, NC-лицензия [verified]
- npm deepscatter 2.15.2 «CC BY-NC-SA 4.0» [verified 2026-07-05]
- https://benschmidt.org/post/2022-10-27-career-news/ — 2022-10-27, коммерция только через Nomic [verified]

---

### 5. regl-scatterplot — flekschas

**Функционально простым языком.** Лёгкий MIT-скаттерплот на WebGL (regl): пан/зум, lasso-выделение (обвод мышью), связанные точки (полилинии-траектории). Тоже не граф-движок, но честный ответ «сколько точек тянет браузер».

**Вау-приёмы / лимиты числами.** README [verified]: «render up to **20 million points**» в performance mode (точки — квадраты, альфа-смешение выключено, рекомендация `pointSize: 0.25` для 20M); быстрый lasso. Демо: https://flekschas.github.io/regl-scatterplot/

**Технически.** regl-scatterplot 1.16.0 (2026-05-08), MIT, 235 звёзд, push 2026-07-01 — маленький, но живой [verified, npm + GitHub API]. Ванильный класс — в React тот же паттерн `useRef`+`useEffect`+`"use client"`, что у cosmos.

**Что берём для Коры.** В основной стек не нужен (у нас граф, не облако точек). Полезен как: (а) референс порядка величин — 20M точек = потолок WebGL-скаттера на среднем железе; (б) запасной слой, если появится карта эмбеддингов IdeaBlock (аналог Atlas, но MIT).

**Источники.**
- https://github.com/flekschas/regl-scatterplot — README «up to 20 million points» [verified]
- npm regl-scatterplot 1.16.0 MIT [verified 2026-07-05]

---

## Сводка: топ-выводы контура

1. **Лицензионная развилка Cosmograph решена точно:** движок `@cosmos.gl/graph` — **MIT** (с мая 2025 в OpenJS Foundation, переименован из `@cosmograph/cosmos`), а вся обвязка `@cosmograph/*` (cosmograph, react) — **CC-BY-NC-4.0**, коммерция только через непубличную Business-лицензию. Для SaaS Коры: движок берём свободно, пакеты `@cosmograph/*` — под запрет в package.json. [verified по npm license fields + cosmograph.app/docs-general/citing-and-licensing/ + LICENSE репо]
2. **cosmos.gl — единственный в контуре с force-симуляцией на GPU** (физика в шейдерах, не только рендер): официальный стресс-тест 140k узлов / ~1M рёбер, заявка мейнтейнеров — 1M+; v3.1 (2026-06-30) на luma.gl/WebGL2 с GPU-анимациями позиций/цветов/размеров по умолчанию — эффект «мозг живой» бесплатно. Масштаб Коры (тысячи узлов) — <1% его потолка.
3. **sigma.js v3 — движок навигации, не масштаба:** сами авторы говорят «тысячи узлов»; конкурент оценивает потолок в ~100k рёбер default-стилями и деградацию FA2-раскладки после 50k рёбер [claimed(competitor)]. Зато reducers (hover-подсветка соседей), Louvain за ~50 мс на 1k узлов, кастомные GLSL-программы узлов и curved edges — готовый drill-down.
4. **React 19 + Next.js 16:** `@react-sigma/core` 5.0.6 официально поддерживает React 19 (peer `^18||^19`); у cosmos.gl официальной React-обёртки нет вовсе (обёртка = 30 строк `useRef`+`useEffect`), а `@cosmograph/react` заявляет только react ≤18. Всё в контуре — браузерный WebGL: в App Router обязательны `"use client"` + `dynamic(..., { ssr: false })` изнутри клиентского компонента.
5. **3D в этом контуре нет ни у кого:** cosmos.gl и sigma — строго 2D (у sigma есть только наклон камеры `angle`). Если «полёт сквозь мозг» обязателен в 3D — это другой контур (three.js / 3d-force-graph); цена — потеря GPU-симуляции cosmos.
6. **deepscatter и Cosmograph-продукт выпадают по лицензии** (CC-BY-NC(-SA)), deepscatter ещё и заморожен 13+ месяцев и требует Python-шаг подготовки тайлов. regl-scatterplot (MIT, 20M точек) — не граф, оставить как справочный потолок производительности.
7. **Рабочая гипотеза для Коры — гибрид на общем data-слое graphology (MIT):** режим «вау-мозг» = cosmos.gl (GPU-симуляция, 12 областей как pointClusters + simulationCluster, подписи кластеров HTML-оверлеем по getClusterPositions, подсветка соседей через highlightedPointIndices); режим «навигация» = sigma.js (reducers, Louvain, поиск с camera.animate, node-border для «наполнено/пусто»). Louvain и метрики считаются один раз в graphology и подаются в оба рендера.
8. **Ловушки cosmos.gl, найденные в первоисточниках:** `spaceSize` > 4096 крашится на iOS (issue #203, комментарий прямо в config.ts); раскладка живёт в квадратной сетке — при переполнении «шумит»; `setConfig()` в v3 сбрасывает конфиг к дефолтам (обновлять только через `setConfigPartial()`); на плотных графах включать `linkBlending: false`.

## Ограничения контура (что не удалось проверить)

- **Нет независимых FPS-бенчмарков cosmos.gl v3** на референсном железе: 140k/1M — официальная стори без опубликованных чисел кадров; «1M+ узлов» — заявка мейнтейнеров в блоге OpenJS [claimed]. Честную цифру «узлов при 60fps на средней машине» даст только свой прогон стори на нашем железе (осталось за рамками веб-контура).
- Лимиты sigma.js «100k рёбер / 5k узлов с иконками / FA2 после 50k рёбер» — из сравнительной страницы конкурента Linkurious [claimed(competitor)]; собственных официальных бенчмарков sigma v3 не публикует (мейнтейнеры в блоге прямо пишут «looking forward to being able to measure that reliably»).
- Цена Business-лицензии Cosmograph не публикуется — только «reach out»; не проверялась перепиской.
- `@sqlrooms/cosmos` (MIT React-обёртка cosmos) не тестировалась и пиннит движок v2.6.x, не v3 — совместимость с v3.1 не проверена.
- Поведение `dynamic({ ssr: false })` именно в Next.js 16 проверено по обсуждениям Next 15/react-sigma FAQ [triangulated(2)], но не собственным прогоном на Next 16.
- Санкционные/региональные ограничения загрузки npm-пакетов для РФ-прода не проверялись (вне рамок контура).
