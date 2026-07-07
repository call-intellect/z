---
type: analysis
status: research-input
segment: engine-alt
snapshot_date: 2026-07-05
---

# Контур 07 — альтернативные React-движки графов (reagraph, G6 v5, xyflow, deck.gl, vis-network, ngraph.pixel, Orb)

Контекст: Кора — «память компании», граф знаний (12 областей → темы → сущности → блоки-факты), тысячи узлов на организацию. Нужны (1) вау-3D-визуализация «мозг растёт» и (2) практичная навигация с drill-down (проваливание вглубь по уровням). Стек: Next.js 16 App Router + React 19 + Tailwind 4. В репо уже есть `react-force-graph-2d@1.29.1` (npm-публикация 2026-02-04 [verified]).

Все версии пакетов сняты с npm registry 2026-07-05 командой `npm view` [verified]. Звёзды/issues — GitHub API 2026-07-05 [verified].

---

## Карточки

### 1. reagraph (reaviz/reagraph) — WebGL 2D/3D граф для React

**Функционально простым языком.** Готовый React-компонент `<GraphCanvas nodes edges />`: отдаёшь массивы узлов и рёбер — получаешь интерактивный WebGL-граф (внутри Three.js + react-three-fiber). Из коробки: 2D и 3D force-layout (раскладка силами), radial/tree/hierarchical раскладки, выделение с подсветкой соседей, кластеризация по атрибуту, лассо-выделение, тёмная/светлая тема, edge bundling (стягивание пучков рёбер).

**Технически.**
- Версия: `reagraph@4.32.0`, публикация 2026-06-25, лицензия Apache-2.0 [verified]. GitHub: 1 057 звёзд, 11 open issues, последний push 2026-06-25 — проект живой [verified: api.github.com/repos/reaviz/reagraph, 2026-07-05].
- Зависимости 4.32.0: `three ^0.184`, `@react-three/fiber ^9.6.1`, `@react-three/drei ^10.7.7`, `d3-force-3d`, `graphology`, `zustand 5` [verified: package.json master]. R3F v9 — это ветка под React 19, т.е. текущий reagraph по стеку совпадает с нашим React 19 [verified]. React 19 совместимость заявлена с v4.23.0, c 4.31.0 (2026-06-09) — ESM-only, UMD удалён [verified: CHANGELOG.md].
- Next.js 16: SSR нет (WebGL/window) → компонент только `"use client"` + `next/dynamic(() => import(...), { ssr: false })` [inferred: стандартный приём для window-зависимых либ, официального Next-гайда у reagraph нет].
- **Лимиты производительности (числа):** issue #113 (2023-07-26, v4.10.4): 400+ узлов/рёбер → 12–28 FPS; 2 600+ → 1–3 FPS и зависание ~40 с; 40 000+ → краш вкладки [verified: github.com/reaviz/reagraph/issues/113]. Discussion #254 (июль–декабрь 2024): мейнтейнер подтверждает «рёбра супер-дороги в отрисовке», профайлер показывает блокировку main thread >2 с, вся работа — в UI-потоке, web workers только обсуждаются [verified: github.com/reaviz/reagraph/discussions/254]. В changelog есть точечные фиксы («perf для 500+ узлов» в 4.15.11, «performance enhancements» в 4.32.0), но новых публичных бенчмарков после фиксов нет [verified: CHANGELOG; эффект — unverified].
- **Честная оценка красоты из коробки:** дефолт — плоские цветные точки/сферы + подписи, аккуратно, но без свечения, частиц и глубины; Linkurious в обзоре 2025-01-31 характеризует его «high-performing but raw» (мощный, но сырой как библиотека) [triangulated(2): linkurious.com/blog/top-javascript-graph-libraries + собственные доки/сторибук]. Bloom (свечение), частицы, полёт камеры по маршруту — из коробки НЕТ; трюки типа `onNodeClick → фокус камеры` есть через `focusOnSelect` [verified: доки Selection].

**Вау-приёмы (сниппеты).**

Источник: https://reagraph.dev/docs/getting-started/Basics
```tsx
import { GraphCanvas } from 'reagraph';

const nodes = [{ id: '1', label: '1' }, { id: '2', label: '2' }];
const edges = [{ source: '1', target: '2', id: '1-2', label: '1-2' }];

export const MyDiagram = () => (
  <GraphCanvas nodes={nodes} edges={edges} layoutType="forceDirected3d" />
);
```

Подсветка выделения + соседей (actives) и автофокус камеры. Источник: https://reagraph.dev/docs/advanced/Selection
```tsx
import { useRef } from 'react';
import { GraphCanvas, GraphCanvasRef, useSelection } from 'reagraph';

export const App = () => {
  const graphRef = useRef<GraphCanvasRef | null>(null);
  const { selections, actives, onNodeClick, onCanvasClick } = useSelection({
    ref: graphRef,
    nodes: myNodes,
    edges: myEdges,
    pathSelectionType: 'out',
    focusOnSelect: true
  });
  return (
    <GraphCanvas
      ref={graphRef}
      nodes={myNodes}
      edges={myEdges}
      selections={selections}
      actives={actives}
      onCanvasClick={onCanvasClick}
      onNodeClick={onNodeClick}
    />
  );
};
```

Кластеризация по атрибуту (наши «12 областей» ложатся 1-в-1). Источник: https://reagraph.dev/docs/advanced/Clustering
```tsx
const nodes = [
  { id: '1', label: 'Tesla', data: { category: 'EV' } },
  { id: '2', label: 'C8',    data: { category: 'ICE' } }
];
<GraphCanvas nodes={nodes} edges={[]} clusterAttribute="category" />
// работает только на force-directed layout; под капотом d3-force-cluster-3d
```

**Что берём для Коры.** Самый короткий путь «3D-граф в React за час»: наши уровни областей → `clusterAttribute`, drill-down через `onNodeClick + focusOnSelect`, подсветка соседей через `actives`. НО: при наших «тысячах узлов на организацию» упрёмся в потолок ~1–2k без серверной агрегации (числа выше) [verified #113], и вау-эффекты (bloom/частицы) придётся дописывать нельзя — внутренний Three-пайплайн не отдаёт post-processing наружу [inferred: API не экспонирует EffectComposer]. Вердикт: кандидат на «быстрый достойный 3D», не на «вау мирового уровня».

**Источники.** https://reagraph.dev/ [verified] · https://github.com/reaviz/reagraph [verified] · issues/113, discussions/254 [verified] · CHANGELOG.md [verified] · linkurious.com/blog/top-javascript-graph-libraries (2025-01-31) [verified].

---

### 2. AntV G6 v5 (+ 3D- и React-расширения) — «комбайн» графовой визуализации

**Функционально простым языком.** Фреймворк от Ant Group (Alibaba): раскладки, поведения (behaviors), плагины (minimap — мини-карта, hull — обводка кластеров, timebar — шкала времени, fisheye — лупа), темы, анимации появления узлов. Не React-компонент, а императивный `new Graph({...})` на div — React-обвязка пишется руками (официальный паттерн есть). 3D — отдельным расширением.

**Технически.**
- Версии: `@antv/g6@5.1.1` (2026-06-10), `@antv/g6-extension-3d@0.1.23` (2026-06-10), `@antv/g6-extension-react@0.2.7` (2026-06-10), все MIT [verified: npm view]. GitHub: 12 170 звёзд, 330 open issues, push 2026-06-09 [verified: api.github.com].
- React 19: ядро framework-agnostic (рисует в canvas), официальный интеграционный паттерн — `useRef + useEffect + graph.destroy()` в cleanup (выдерживает StrictMode) [verified: g6.antv.antgroup.com/en/manual/getting-started/integration/react]. `g6-extension-react` peer `react >=16.8` — React 19 проходит по диапазону [verified: npm peerDeps]; отдельного заявления «tested on React 19» нет [unverified].
- Next.js 16: SSR-гайда нет, canvas/window → `"use client"` + dynamic import ssr:false [inferred].
- Рендереры: Canvas / SVG / WebGL, переключаются опцией `renderer: () => new WebGLRenderer()` из `@antv/g-webgl` [verified: manual/further-reading/renderer + issue #6765]. WebGL-рендерер сырой: issue #6765 (2025-02-11, open) — неправильная отрисовка selected-состояния на WebGL [verified].
- **Лимиты числами:** официальные материалы дают лозунги («layout тысяч узлов — breeze», WASM/GPU-раскладки) без публичных FPS-бенчмарков [claimed: medium.com/antv G6 5.0 changelog + yanyanwang93.medium.com]. Косвенный маркер от самих доков: React-узлы рекомендованы ТОЛЬКО до ~2 000 узлов, дальше — canvas-узлы [verified: manual/element/node/react-node]. Для больших графов есть штатный behavior `optimize-viewport-transform` — прячет некритичные элементы при пане/зуме ради FPS [verified: manual/behavior/optimize-viewport-transform].
- Минусы по чужому опыту: «API challenging, часть доков на китайском» [verified: linkurious.com 2025-01-31]; версия 3D-расширения 0.1.x — ранняя [verified: npm].

**Вау-приёмы (сниппеты).**

3D-граф со сферами, светом и перспективной камерой. Источник: https://g6.antv.antgroup.com/en/manual/further-reading/3d
```ts
import { Graph, register, ExtensionCategory } from '@antv/g6';
import { renderer, Sphere, Line3D, Light } from '@antv/g6-extension-3d';

register(ExtensionCategory.NODE, 'sphere', Sphere);
register(ExtensionCategory.EDGE, 'line3d', Line3D);
register(ExtensionCategory.PLUGIN, 'light', Light);

const graph = new Graph({
  renderer,
  node: { type: 'sphere', style: { materialType: 'phong' } },
  edge: { type: 'line3d' },
  layout: { type: 'd3-force-3d' },
  plugins: [
    { type: 'light', directional: { direction: [0, 0, 1] } },
    { type: 'camera-setting', projectionMode: 'perspective', near: 0.1, far: 1000, fov: 45 },
  ],
});
graph.render();
// 3D-ноды: Sphere, Cube, Cylinder, Cone, Capsule, Torus; поведения DragCanvas3D/ZoomCanvas3D/ObserveCanvas3D
```

React-компонент как узел (карточка с Ant Design/Tailwind внутри). Источник: https://g6.antv.antgroup.com/en/manual/element/node/react-node
```tsx
import { ExtensionCategory, register, Graph } from '@antv/g6';
import { ReactNode } from '@antv/g6-extension-react';

register(ExtensionCategory.NODE, 'react-node', ReactNode);

const graph = new Graph({
  node: {
    type: 'react-node',
    style: { component: (data) => <MyCard title={data.id} /> },
  },
});
graph.render();
// рекомендация доков: react-node — до ~2000 узлов, дальше canvas-ноды
```

Официальный React-паттерн монтирования (StrictMode-safe). Источник: https://g6.antv.antgroup.com/en/manual/getting-started/integration/react
```tsx
const containerRef = useRef<HTMLDivElement>(null);
const graphRef = useRef<Graph>();
useEffect(() => {
  const graph = new Graph({ container: containerRef.current! });
  graphRef.current = graph;
  return () => { graphRef.current?.destroy(); graphRef.current = undefined; };
}, []);
```

**Что берём для Коры.** Самый богатый «практичный» набор из одного пакета: minimap, hull-обводка кластеров (визуально «где наполнено»), fisheye, timebar («мозг растёт во времени» = timebar по датам встреч — дешёвый вау), анимации появления узлов. 3D-расширение — рано (0.1.23 + баг WebGL-select) [verified]. Риск: императивный API + ручная синхронизация с React-состоянием — дороже в поддержке, чем декларативный reagraph/xyflow [inferred].

**Источники.** github.com/antvis/G6 [verified] · g6.antv.antgroup.com (manual/further-reading/3d, element/node/react-node, integration/react, behavior/optimize-viewport-transform) [verified] · medium.com/antv «G6 5.0-Beta ChangLog», yanyanwang93.medium.com «G6 5.0» [claimed] · issue #6765 [verified] · linkurious.com (2025-01-31) [verified].

---

### 3. @xyflow/react (React Flow 12) — карточки-узлы, drill-down, mini-map

**Функционально простым языком.** Не force-граф, а движок «узлы-карточки + рёбра» для структурных схем: каждый узел — обычный React-компонент (DOM), рёбра — SVG. Идеален для «страницы области»: процессы, иерархии, блок-схемы, где узлов десятки-сотни и каждый — богатая карточка с кнопками.

**Технически.**
- Версия: `@xyflow/react@12.11.1` (2026-06-22), MIT [verified: npm view]. GitHub xyflow/xyflow: 37 465 звёзд, 124 open issues, push 2026-06-30 — самый живой проект контура [verified].
- React 19: peer `react >=17` → проходит [verified: npm peerDeps]. Next.js: с v12 (июль 2024) официальная поддержка SSR/SSG — узлам задаются width/height/handles и flow рендерится на сервере, гидратируется на клиенте [verified: xyflow.com/blog/react-flow-12-release + reactflow.dev/learn/advanced-use/ssr-ssg-configuration]. Т.е. для Next 16 App Router достаточно `"use client"`; dynamic ssr:false не обязателен [verified].
- **Лимиты числами (DOM — главный потолок):** discussion #3003 — на вопрос «выживет ли 1000+ узлов» мейнтейнер: «React Flow не рассчитан на такой масштаб, canvas-подход будет сильно быстрее» [verified: github.com/xyflow/xyflow/discussions/3003]; issue #3044 «10k узлов — лагает» [verified]; issue #5117 «70k узлов — очень лагает» [verified]. Официальный perf-гайд: мемоизация nodeTypes/узлов, селективные сторы, `onlyRenderVisibleElements` (виртуализация вьюпорта) [verified: reactflow.dev/learn/advanced-use/performance].

**Вау-приёмы (сниппеты).**

Быстрый старт + управление состоянием. Источник: https://reactflow.dev/learn
```tsx
import { useState, useCallback } from 'react';
import { ReactFlow, applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const initialNodes = [
  { id: 'n1', position: { x: 0, y: 0 },   data: { label: 'Node 1' } },
  { id: 'n2', position: { x: 0, y: 100 }, data: { label: 'Node 2' } },
];
const initialEdges = [{ id: 'n1-n2', source: 'n1', target: 'n2' }];

export default function App() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const onNodesChange = useCallback((ch) => setNodes((ns) => applyNodeChanges(ch, ns)), []);
  const onEdgesChange = useCallback((ch) => setEdges((es) => applyEdgeChanges(ch, es)), []);
  const onConnect = useCallback((p) => setEdges((es) => addEdge(p, es)), []);
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange} onConnect={onConnect} fitView />
    </div>
  );
}
```

Кастомный узел-карточка (для практичной части Коры: карточка «тема/сущность» с бейджем наполненности) + регистрация в nodeTypes. Источник: https://reactflow.dev/learn/customization/custom-nodes (+ Handles: https://reactflow.dev/learn/customization/handles)
```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';

type TopicNodeData = { title: string; factsCount: number; sourceMeeting?: string };

export function TopicCardNode({ data }: NodeProps<{ data: TopicNodeData }>) {
  return (
    <div className="rounded-xl border bg-white/90 px-3 py-2 shadow">
      <div className="text-sm font-semibold">{data.title}</div>
      <div className="text-xs text-gray-500">{data.factsCount} фактов</div>
      {data.sourceMeeting && <div className="text-[10px]">из встречи: {data.sourceMeeting}</div>}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { topicCard: TopicCardNode }; // объявлять ВНЕ компонента (мемоизация)
```

Mini-map + фон + контролы одной строкой. Источник: https://reactflow.dev/api-reference/components/minimap
```tsx
import { ReactFlow, MiniMap, Controls, Background } from '@xyflow/react';
<ReactFlow nodes={nodes} edges={edges} fitView>
  <Background />
  <Controls />
  <MiniMap pannable zoomable />
</ReactFlow>
```

**Что берём для Коры.** Лучший инструмент контура для ПРАКТИЧНОЙ части: drill-down-страницы области/темы (срез 50–300 узлов), узлы-карточки с «почему это здесь, из какой встречи», mini-map, `onlyRenderVisibleElements`. НЕ подходит для вау-обзора всего мозга (тысячи узлов, DOM-потолок ~1k) [verified #3003]. Пара «WebGL-обзор → клик → React Flow-детализация» — рабочая архитектура.

**Источники.** github.com/xyflow/xyflow [verified] · reactflow.dev (learn, custom-nodes, performance, ssr) [verified] · xyflow.com/blog/react-flow-12-release [verified] · discussions/3003, issues/3044, issues/5117 [verified].

---

### 4. deck.gl + @deck.gl-community/graph-layers — GPU-слои для графа

**Функционально простым языком.** deck.gl — GPU-фреймворк визуализации данных (миллионы точек). graph-layers — общественный (community) модуль: слой `GraphLayer` рисует force-граф средствами deck.gl, раскладка d3-force, стили декларативным stylesheet.

**Технически.**
- Версия: `@deck.gl-community/graph-layers@9.3.7` (2026-06-11), MIT; peer: `@deck.gl/core ~9.3.0`, `@luma.gl ~9.3.2`, `zod ^4` [verified: npm view]. Репо deck.gl-community: 93 звезды, 45 open issues, push 2026-07-03 [verified].
- **Статус-предупреждение из собственных доков: «semi-maintained» — у части модулей нет выделенных мейнтейнеров** [verified: visgl.github.io/deck.gl-community]. README модуля — буквально «TBD» [verified: raw README]. Это красный флаг зрелости.
- React 19/Next 16: биндинг `@deck.gl/react` (DeckGL-компонент), клиентский рендер → `"use client"` (+ dynamic при проблемах) [inferred: WebGL].
- Лимиты: у community-модуля публичных бенчмарков нет [unverified]; предок (uber/graph.gl, архив) заявлял «medium 5000+ и large 10000+ узлов с интерактивной скоростью, GPGPU-раскладка» [claimed: github.com/uber/graph.gl + визгл showcase]. Сам deck.gl честно тянет сотни тысяч примитивов [triangulated(2): deck.gl доки + общеизвестные examples], узкое место — layout на CPU (d3-force) [inferred].

**Вау-приёмы (сниппет).**

GraphLayer + d3-force + декларативный stylesheet. Источник: https://raw.githubusercontent.com/visgl/deck.gl-community/master/docs/modules/graph-layers/developer-guide/get-started.md
```tsx
import DeckGL from '@deck.gl/react';
import { GraphLayer, D3ForceLayout } from '@deck.gl-community/graph-layers';

const layer = new GraphLayer({
  id: 'graph-layer',
  data: SAMPLE_GRAPH,
  layout: new D3ForceLayout(),
  stylesheet: {
    nodes: [
      { type: 'circle', radius: 10, fill: 'blue', opacity: 1 },
      { type: 'label', text: '@id', color: '#ffffff', offset: [0, 18] },
    ],
    edges: { stroke: 'black', strokeWidth: 2 },
  },
  enableDragging: true,
});

const App = () => (
  <DeckGL initialViewState={{ target: [0, 0], zoom: 1 }}
    controller={{ doubleClickZoom: false }} layers={[layer]} />
);
```

**Что берём для Коры.** Идея «граф как GPU-слой» красива (можно миксовать со ScatterplotLayer-частицами), но модуль semi-maintained с README «TBD» — строить на нём флагманский вау-экран рискованно [verified предупреждение]. Берём как источник приёма «частицы/точки поверх графа отдельным GPU-слоем», не как основной движок.

**Источники.** npmjs @deck.gl-community/graph-layers [verified] · visgl.github.io/deck.gl-community (warning) [verified] · developer-guide/get-started.md [verified] · uber/graph.gl README [claimed] · deck.gl/examples [verified].

---

### 5. vis-network (vis.js) — классика Canvas 2D с физикой

**Функционально простым языком.** Старейшая «сеть с физикой»: узлы прыгают-стабилизируются, drag&drop, встроенная кластеризация. Не React-библиотека — императивный `new Network(container, data, options)`.

**Технически.**
- Версия: `vis-network@10.1.0` (2026-05-15), лицензия «Apache-2.0 OR MIT» [verified: npm view]. GitHub: 3 595 звёзд, 344 open issues, push 2026-07-04 [verified].
- React 19: биндинга нет — ref + useEffect (как G6); SSR нет → `"use client"` + dynamic [inferred].
- **Лимиты числами:** собственные доки: «работает плавно до нескольких тысяч узлов и рёбер», дальше — только их встроенная кластеризация [verified: visjs.github.io/vis-network/docs/network/]. Практика из issues: 4 000 узлов — «very slow rendering» (visjs/vis#3187), ~7 500 узлов/9 000 рёбер — «appalling performance» (vis-network discussion #2230) [verified]. Memgraph, уходя с vis, писал: «большой граф в vis — симуляция и рендер занимают вечность и блокируют main thread» [verified: memgraph.com/blog/how-to-build-a-graph-visualization-engine-and-why-you-shouldnt].

**Вау-приёмы (сниппет).**

Базовая инициализация + кластеризация. Источник: https://visjs.github.io/vis-network/docs/network/
```js
const nodes = new vis.DataSet([{ id: 1, label: 'Node 1' }, { id: 2, label: 'Node 2' }]);
const edges = new vis.DataSet([{ from: 1, to: 2 }]);
const network = new vis.Network(
  document.getElementById('mynetwork'),
  { nodes, edges },
  {},
);
// для больших графов: network.clusterByHubsize(), clusterOutliers(), storePositions()
```

**Что берём для Коры.** Ничего как движок: canvas 2D без GPU, потолок ниже нашего объёма, вид из 2015-го [inferred + verified лимиты]. Полезная идея — паттерн «clusterOutliers + раскрытие кластера по клику» для practical-навигации.

**Источники.** visjs.github.io/vis-network/docs/network/ [verified] · github.com/visjs/vis-network [verified] · issues #3187, discussion #2230 [verified] · memgraph blog [verified].

---

### 6. ngraph.pixel (anvaka) — низкоуровневый 3D-рендер на шейдерах

**Функционально простым языком.** Маленькая библиотека Андрея Кашчи (anvaka, автор VivaGraph и городских «карт кода»): рисует граф в 3D одним низкоуровневым ShaderMaterial из Three.js — узлы как GPU-точки, поэтому очень быстро; управление камерой — «полёт» WASD как в игре.

**Технически.**
- Версия: `ngraph.pixel@2.4.1`, последняя публикация npm 2022-06-21; репо: 344 звезды, 10 open issues, последний push 2023-05-12 — **проект заморожен** [verified: npm + api.github.com].
- Критично: зависимость `three ^0.73.0` (2015 год) [verified: package.json] — в одном бандле с современным three 0.18x даст дубль Three и конфликты; ESM/React 19/Next 16 никогда не тестировались, README честно: «very early version» [verified: README]. CommonJS/browserify-эпоха [verified].

**Вау-приёмы (сниппет).**

3D по умолчанию, цвет/размер узла, физика. Источник: https://github.com/anvaka/ngraph.pixel (README)
```js
const graph = require('ngraph.graph')();
graph.addLink(1, 2);
const renderer = require('ngraph.pixel')(graph, {
  node: () => ({ color: 0xff00ff, size: 20 }),
  link: () => ({ fromColor: 0xff00ff, toColor: 0x00ffff }),
  physics: { springLength: 80, springCoeff: 0.0002, gravity: -1.2, theta: 0.8, dragCoeff: 0.02 },
});
// камера: WASD-полёт (three.fly), клик-драг мышью
```

**Что берём для Коры.** Как зависимость — нет (мертво, three-2015). Как ДОНОР ИДЕЙ — да: (1) узлы как GPU-point-cloud с per-vertex цветом/размером — это и есть рецепт «десятки тысяч узлов при 60 FPS» для кастомного R3F-слоя; (2) градиент рёбер fromColor→toColor — дёшево и красиво показывает направление знания; (3) WASD-полёт сквозь мозг — сильный вау-приём для демо [inferred: перенос приёмов, не кода].

**Источники.** github.com/anvaka/ngraph.pixel [verified] · npm ngraph.pixel [verified] · package.json (three ^0.73) [verified] · демо anvaka.github.io/ngraph.pixel [verified].

---

### 7. Orb (@memgraph/orb) — canvas-граф от Memgraph

**Функционально простым языком.** Библиотека, которую Memgraph написал для своих продуктов (Playground, Lab), устав от vis-network: d3-force-раскладка в web worker (фоновый поток), рендер на canvas, простое API «setup → render».

**Технически.**
- Версия: `@memgraph/orb@0.4.3`, последняя публикация **2024-02-12** (~2,5 года назад), Apache-2.0 [verified: npm view]. Репо: 419 звёзд, 23 open issues; push 2026-07-03 (активность в репо ≠ релизы — новых версий нет) [verified: api.github.com].
- React: биндинга нет, TypeScript есть; web workers для симуляции работают только при npm-сборке (не через CDN-линк) [verified: README]. 3D нет — только canvas 2D [verified].
- Лимиты: собственных публичных чисел нет [unverified]; Memgraph заявляет «на малых графах в 20× быстрее нашей старой vis-реализации, на больших до 40× (местами 60–80×)» — сравнение с их же vis-кодом, не абсолютные FPS [claimed: memgraph.com/blog].

**Вау-приёмы (сниппет).**

Источник: https://github.com/memgraph/orb (README)
```ts
import { Orb } from '@memgraph/orb';
const container = document.getElementById('graph');

const nodes = [{ id: 1, label: 'Orb' }, { id: 2, label: 'Graph' }];
const edges = [{ id: 1, start: 1, end: 2, label: 'DRAWS' }];

const orb = new Orb(container);
orb.data.setup({ nodes, edges });
orb.view.render(() => orb.view.recenter());
```

**Что берём для Коры.** Как движок — нет: релизы застыли на 0.4.3 с февраля 2024, нет 3D, нет React-слоя [verified]. Ценна их выстраданная архитектура: «симуляция d3-force в web worker, main thread только рисует» — именно этого не хватает reagraph (discussion #254) и это стоит повторить в нашем кастомном слое [triangulated(2): orb README + reagraph discussion #254].

**Источники.** github.com/memgraph/orb [verified] · npm @memgraph/orb [verified] · memgraph.com/blog/how-to-build-a-graph-visualization-engine-and-why-you-shouldnt [claimed/verified как их опыт].

---

## Сводка: топ-выводы контура

1. **Ни один «alternative»-движок не закрывает обе части задачи разом.** Вау-3D на тысячи узлов и практичные карточки-drill-down — разные технологии; из этого контура собирается только ПАРА движков, не один [inferred из лимитов ниже].
2. **Практичная часть — @xyflow/react 12.11.1, безальтернативно в контуре.** 37,5k звёзд, релиз июнь-2026, React 19 (peer >=17) и официальный SSR для Next [verified]. Потолок DOM: мейнтейнер прямо говорит «1000+ узлов — не наш масштаб» (disc. #3003), 10k — лаги (issue #3044) [verified] → рендерим срезы 50–300 узлов на уровень drill-down, узел-карточка «N фактов · из какой встречи» — сниппет в карточке 3.
3. **reagraph — единственный готовый React-3D в контуре, но с документированным потолком:** 400+ узлов → 12–28 FPS, 2600+ → 1–3 FPS (issue #113), рёбра дороги, всё в main thread (disc. #254) [verified]. Живой (4.32.0, июнь-2026, R3F 9/three 0.184 = наш React 19) [verified]. Красота из коробки — «аккуратно, но сыро» (Linkurious: «high-performing but raw») [triangulated(2)]. Годится для «мозга» ТОЛЬКО с серверной агрегацией до сотен видимых узлов; bloom/частицы не прикрутить без форка [inferred].
4. **G6 v5 — самый богатый практичный toolkit (minimap, hull, fisheye, timebar, кластеры), но 3D-расширение сырое** (0.1.23; баг WebGL-select #6765 открыт с 02-2025) и API императивный, интеграция с React 19 — ручной useEffect-паттерн [verified]. Брать стоит идеи (timebar «мозг растёт во времени», hull-обводка областей), а не сам движок для вау-части.
5. **Потолки производительности контура числами:** vis-network — «до нескольких тысяч» по собственным докам, 4k узлов уже very slow [verified]; xyflow — DOM, ~1k комфортно [verified]; reagraph — сотни узлов комфортно, 2,6k — слайдшоу [verified]; deck.gl graph-layers — GPU-рендер сотен тысяч точек, но модуль «semi-maintained», README «TBD» [verified]; ngraph.pixel — быстрый point-cloud-подход, но проект мёртв (npm 2022, three 2015 года) [verified].
6. **Главный архитектурный урок контура — «симуляция вне main thread».** Orb (d3-force в web worker) и боль reagraph (блокировки >2 с в main thread) сходятся на одном рецепте: layout считать в worker/на сервере, GPU только рисует [triangulated(2)]. Для Коры: позиции 12 областей и тем можно вообще предрассчитывать на бэке (NestJS) и отдавать замороженный layout — тогда фронту остаётся только красиво рисовать и анимировать камеру [inferred].
7. **Лицензии чистые у всех:** MIT (G6, xyflow, deck.gl-community, ngraph.pixel) и Apache-2.0 (reagraph, Orb, vis-network dual) — коммерческое использование без ограничений [verified: npm licenses].
8. **Рекомендация контура для Коры:** практичная навигация = @xyflow/react (сейчас, дёшево, идеально ложится на «страницу области»); вау-3D = НЕ из этого контура — reagraph лишь запасной «достойный минимум», а победителя стоит искать среди react-force-graph-3d/R3F+post-processing (смежный контур), заимствуя приёмы: point-cloud-узлы и градиентные рёбра (ngraph.pixel), worker-симуляция (Orb), timebar/hull (G6), кластер-атрибут и focusOnSelect (reagraph).

## Ограничения контура (что не удалось проверить)

- **Свежих (2025–2026) публичных FPS-бенчмарков reagraph после perf-фиксов 4.15.11/4.32.0 нет** — числа потолка взяты из issue #113 за 2023 (v4.10.4) и discussion #254 за 2024; возможно, сейчас чуть лучше, но порядок величин вряд ли изменился (архитектура main-thread не менялась) [inferred]. Проверяется только собственным стенд-тестом на нашем графе (~2–5k узлов).
- **G6 v5: маркетинговые заявления о WASM/GPU-раскладках и «тысячах узлов» не подтверждены независимыми бенчмарками** — официальные материалы без чисел FPS [claimed]; отдельного заявления о совместимости с React 19/Next 16 нет (peer-диапазоны проходят, но «tested» никто не писал) [unverified].
- **deck.gl graph-layers: реальную ёмкость модуля (не ядра deck.gl) измерить не по чему** — бенчмарки есть только у предка uber/graph.gl (архивирован) [claimed].
- **npmjs.com отдаёт 403 на прямые запросы** — weekly downloads не сняты; версии/даты взяты через npm registry CLI (точны), популярность оценена по звёздам GitHub.
- Не проверялись вживую (в браузере) официальные демо reagraph/G6-3D на предмет субъективного «вау» — оценка красоты из коробки опирается на доки, скриншоты и сторонний обзор Linkurious (2025-01-31), а не на собственный прогон с профайлером.
- Orb: активность репо в 2026 (push 2026-07-03) при отсутствии npm-релизов с 02-2024 не расшифрована (докс/CI-коммиты?) — статус «замороженные релизы» выставлен по npm-датам.
