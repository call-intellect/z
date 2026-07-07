---
type: analysis
status: research-input
segment: engine-3d
snapshot_date: 2026-07-05
---

# Контур 05 — движок 3D-графа: экосистема vasturiano (3d-force-graph / react-force-graph-3d) + постобработка three.js

Главный технический контур для «вау-3D-мозга» Коры. Проверено по первоисточникам 2026-07-05: npm registry, GitHub-репозитории и issues, официальные examples. Все сниппеты — дословно из официальных примеров либо с пометкой «адаптация».

## Карточки

### 1. 3d-force-graph — ядро движка (vanilla JS)

**Функционально простым языком.** Берёт `{nodes, links}` и рисует граф в 3D: узлы — сферы (или любой three.js-объект), рёбра — линии, раскладка — «физика» (узлы отталкиваются, рёбра стягивают). Камерой можно летать, узлы кликабельны и таскаются. Всё управляется цепочкой методов-сеттеров.

**Вау-приёмы.** Bloom-свечение (bloom — эффект ореола вокруг ярких объектов) одной строкой через `postProcessingComposer()`; бегущие частицы по рёбрам; плавный полёт камеры к узлу; авто-орбита камеры; «выстрел» частицей по ребру по событию (`emitParticle`).

**Технически.**

- Версия **1.80.0**, опубликована 2026-04-05; зависимости: `three ">=0.179 <1"`, `three-forcegraph@1`, `three-render-objects@^1.41`, `kapsule@^1.16` — npm registry, https://registry.npmjs.org/3d-force-graph/latest (снято 2026-07-05) [verified]
- Репозиторий жив: последний push 2026-04-05, 6174 звезды, 250 открытых issues — GitHub API, https://github.com/vasturiano/3d-force-graph (2026-07-05) [verified]
- **ВАЖНО:** `three` — это **прямая зависимость** пакета (не peerDependency). Если приложение ставит свой `three` другой версии, в бандл попадают два экземпляра three → ломаются шейдеры постобработки [verified package.json + inferred следствие]

**(1) Bloom-свечение — официальный пример целиком.**
Источник: https://github.com/vasturiano/3d-force-graph/blob/master/example/bloom-effect/index.html (master, снято 2026-07-05) [verified]

```js
import { UnrealBloomPass } from 'https://esm.sh/three/examples/jsm/postprocessing/UnrealBloomPass.js';

const Graph = new ForceGraph3D(document.getElementById('3d-graph'))
  .backgroundColor('#000003')
  .jsonUrl('../datasets/miserables.json')
  .nodeLabel('id')
  .nodeAutoColorBy('group');

const bloomPass = new UnrealBloomPass();
bloomPass.strength = 4;
bloomPass.radius = 1;
bloomPass.threshold = 0;
Graph.postProcessingComposer().addPass(bloomPass);
```

Параметры автора: `strength 4, radius 1, threshold 0` на почти чёрном фоне `#000003` — это и есть «неоновый мозг» из демо. Порог 0 = светится всё; для селективности см. карточку 5.

**(2) Частицы по рёбрам.**
Источник (боевые значения из официального DAG-примера): https://github.com/vasturiano/3d-force-graph/blob/master/example/tree/index.html [verified]

```js
const graph = new ForceGraph3D(document.getElementById('graph'))
  .linkDirectionalParticles(2)          // частиц на ребро
  .linkDirectionalParticleWidth(0.8)    // размер (default 0.5)
  .linkDirectionalParticleSpeed(0.006); // скорость (default 0.01)
```

Разовый «импульс знания» по ребру (для «мозг растёт на глазах») — официальный пример emit-particles: https://github.com/vasturiano/3d-force-graph/blob/master/example/emit-particles/index.html [verified]

```js
const Graph = new ForceGraph3D(elem)
  .linkDirectionalParticleColor(() => 'red')
  .linkDirectionalParticleWidth(4)
  .linkHoverPrecision(10)
  .graphData(gData);

Graph.onLinkClick(Graph.emitParticle); // выстрел частицей по клику на ребро
// программно: Graph.emitParticle(linkObject)
```

Цена: по README частицы — «small spheres», распределённые вдоль ребра и анимируемые каждый кадр [verified README]; т.е. стоимость ~ `рёбра × частицы` дополнительных объектов на кадр [inferred]. Официальный паттерн-смягчение — частицы **только на подсвеченных рёбрах** (см. пункт 6 ниже: `linkDirectionalParticles(link => highlightLinks.has(link) ? 4 : 0)`).

**(3) Полёт камеры к узлу.** `cameraPosition({x,y,z}, lookAt, ms)` — README API [verified]. Внутри — tween с easing Quadratic.Out, причём точка взгляда доезжает за 1/3 времени перелёта (см. карточку 3). Авто-орбита — официальный пример: https://github.com/vasturiano/3d-force-graph/blob/master/example/camera-auto-orbit/index.html [verified]

```js
const distance = 1400;
Graph.cameraPosition({ z: distance });
let angle = 0;
setInterval(() => {
  Graph.cameraPosition({ x: distance * Math.sin(angle), z: distance * Math.cos(angle) });
  angle += Math.PI / 300;
}, 10);
```
**(7) dagMode / иерархия.** Официальный пример дерева: https://github.com/vasturiano/3d-force-graph/blob/master/example/tree/index.html [verified]

```js
import { forceCollide } from 'https://esm.sh/d3-force-3d';
const NODE_REL_SIZE = 1;
const graph = new ForceGraph3D(elem)
  .dagMode('td')             // td|bu|lr|rl|zout|zin|radialout|radialin
  .dagLevelDistance(200)     // расстояние между уровнями (default: авто от числа узлов)
  .nodeRelSize(NODE_REL_SIZE)
  .d3Force('collision', forceCollide(node => Math.cbrt(node.size) * NODE_REL_SIZE))
  .d3VelocityDecay(0.3);
graph.d3Force('charge').strength(-15);
```

Грабля для Коры: dagMode корректен только для ациклического графа; **при цикле по умолчанию бросается исключение**, перехват — `onDagError(loopIds => …)`; узлы можно исключать из иерархии через `dagNodeFilter` — README [verified]. Для «областей → темы → сущности» с перекрёстными рёбрами: либо `radialout` + `dagNodeFilter` только по костяку дерева, либо onDagError → «мягкий» отказ в обычную раскладку.

**(8) Настройки d3-force-3d для «мозгоподобной» кластеризации.**
- Разрежённее (подписи читаются): `Graph.d3Force('charge').strength(-120)` — официальный text-nodes пример, https://github.com/vasturiano/3d-force-graph/blob/master/example/text-nodes/index.html [verified]
- Длина рёбер по типу связи + перегрев симуляции: https://github.com/vasturiano/3d-force-graph/blob/master/example/manipulate-link-force/index.html [verified]

```js
const linkForce = graph.d3Force('link')
  .distance(link => link.color ? settings.redDistance : settings.greenDistance);
graph.numDimensions(3); // re-heat симуляции после изменения силы (приём из примера); или graph.d3ReheatSimulation();
```

- Дефолты движка: `d3AlphaDecay 0.0228`, `d3VelocityDecay 0.4`, cooldownTicks `Infinity`, cooldownTime `15000` ms — README [verified]
- Заморозка узла: `node.fx = node.x; node.fy = node.y; node.fz = node.z` — официальный fix-dragged-nodes: https://github.com/vasturiano/3d-force-graph/blob/master/example/fix-dragged-nodes/index.html [verified]

**(9) forceEngine: ngraph vs d3.** README: `forceEngine('d3' | 'ngraph')`, default `d3` [verified]. Слова автора (issue #30, 2018-02-08): «рекомендую d3, если будут динамические обновления графа»; ngraph по умолчанию «более tense» (натянутый), d3 приближается к нему через `d3VelocityDecay(0.2)` + `charge.strength(-100)` — https://github.com/vasturiano/3d-force-graph/issues/30 [verified]. ngraph.forcelayout использует quad tree для дальних сил (заявка на скорость на больших графах) — https://github.com/anvaka/ngraph.forcelayout README [verified; сравнительных чисел нет — [unverified]]. Для ngraph свой конфиг — `ngraphPhysics({...})`; **dagMode и d3Force работают только на d3** [verified README]. Вывод для Коры: живой растущий граф + кастомные силы → **d3**; ngraph — только если упрёмся в скорость раскладки статического снапшота.

**Деградация производительности (официальные ручки).** Все — README [verified]:
- `warmupTicks(100)` + `cooldownTicks(0)` — просчитать раскладку «всухую» и показать сразу финал, без анимации разлёта (совет автора в issues #223/#202)
- `pauseAnimation()` / `resumeAnimation()` — полная заморозка рендер-цикла «когда достаточно статичной картинки»
- `enablePointerInteraction(false)` — README прямо: hover/click-трекинг «at the cost of performance»
- `nodeResolution` (default 8) — понизить сегментацию сфер
- `onEngineStop(() => …)` — момент, когда раскладка замёрзла (место для фиксации fx/fy/fz всех узлов)

**Что берём для Коры.** Ядро вау-части: bloom-пресет из официального примера (strength 2–4, radius 1, threshold 0, фон #000003), частицы 2/0.8/0.006 как «нервные импульсы», `emitParticle` при появлении нового блока знаний, авто-орбита в режиме «скринсейвер мозга», `warmupTicks+cooldownTicks(0)` на повторных открытиях (позиции кэшируем в БД/localStorage и подставляем fx/fy/fz).

**Источники.** npm registry (2026-07-05); README https://github.com/vasturiano/3d-force-graph; примеры bloom-effect / tree / emit-particles / camera-auto-orbit / manipulate-link-force / fix-dragged-nodes (master); issues #30, #223, #202, #549.

---

### 2. react-force-graph-3d — React-обёртка (наш путь в Next.js 16)

**Функционально простым языком.** Тот же движок, но как React-компонент: данные и стили — пропсами, императивные методы (камера, силы, композер) — через ref.

**Вау-приёмы.** Все из карточки 1 + идиоматичная реактивность: подсветка соседей через state, живое добавление узлов через setState — граф сам красиво доукладывается.

**Технически.**

- Версия **1.29.1**, опубликована 2026-02-04; зависимости: `3d-force-graph ^1.79`, `react-kapsule ^2.5`, `prop-types 15`; **peerDependencies: `react: "*"`** → React 19 формально совместим; `react-kapsule@2.6.0` требует `react >=16.13.1` — npm registry (2026-07-05) [verified]. Отдельных issues «сломано на React 19» не нашёл (поиск 2026-07-05) [triangulated(2): peer-диапазон + отсутствие профильных issues]
- TypeScript-типы в комплекте (`dist/react-force-graph-3d.d.ts`), экспортируется тип `ForceGraphMethods` для ref [verified package.json]

**(1) Bloom в React — официальный пример.**
Источник: https://github.com/vasturiano/react-force-graph/blob/master/example/bloom-effect/index.html [verified]

```jsx
import ForceGraph3D from 'react-force-graph-3d';
import React, { useRef, useEffect } from 'react';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const FocusGraph = ({ data }) => {
  const fgRef = useRef();
  useEffect(() => {
    const bloomPass = new UnrealBloomPass();
    bloomPass.strength = 4;
    bloomPass.radius = 1;
    bloomPass.threshold = 0;
    fgRef.current.postProcessingComposer().addPass(bloomPass);
  }, []);
  return <ForceGraph3D ref={fgRef} backgroundColor="#000003"
    graphData={data} nodeLabel="id" nodeAutoColorBy="group" />;
};
```

**Грабля №1 (критичная): версия three.** Issue #558 (2025-01-09, open): UnrealBloomPass падает с `Shader Error … 'luminance': no matching overloaded function found` — https://github.com/vasturiano/react-force-graph/issues/558 [verified]. Причина — рассинхрон версии `three` приложения (откуда импортирован UnrealBloomPass) и `three` внутри 3d-force-graph [inferred — в треде не доведено до диагноза, но ошибка соответствует несовпадению shader chunks между версиями three]. Правило: ставить в приложение `three` внутри диапазона библиотеки `>=0.179 <1` (актуальный latest `three@0.185.1` [verified npm]) и следить, чтобы в lock-файле был **один** экземпляр three.

**(3) Полёт камеры к узлу по клику — официальный пример click-to-focus.**
Источник: https://github.com/vasturiano/react-force-graph/blob/master/example/click-to-focus/index.html [verified]

```jsx
const handleClick = useCallback(node => {
  const distance = 40;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
  fgRef.current.cameraPosition(
    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, // новая позиция
    node,   // lookAt
    3000    // мс перелёта
  );
}, [fgRef]);
<ForceGraph3D ref={fgRef} graphData={data} onNodeClick={handleClick} />
```

Для «полёта по поиску»: найти узел в `graphData.nodes` по id (после раскладки на нём живут x/y/z) и вызвать тот же `cameraPosition` [inferred из того же примера]. Обратно «показать всё» — `fgRef.current.zoomToFit(1000, px, nodeFilterFn)` [verified README].

**(5) Появление новых узлов с анимацией — официальный пример dynamic.**
Источник: https://github.com/vasturiano/react-force-graph/blob/master/example/dynamic/index.html [verified]

```jsx
const [data, setData] = useState({ nodes: [{ id: 0 }], links: [] });
useEffect(() => {
  setInterval(() => {
    setData(({ nodes, links }) => {
      const id = nodes.length;
      return {
        nodes: [...nodes, { id }],
        links: [...links, { source: id, target: Math.round(Math.random() * (id - 1)) }]
      };
    });
  }, 1000);
}, []);
<ForceGraph3D enableNodeDrag={false} graphData={data} />
```

Новые узлы «влетают» сами — физика дораскладывает без перезапуска сцены (обновляется только дельта data). Рецепт «мозг растёт на глазах»: этот паттерн + `emitParticle` на новых рёбрах + короткий `cameraPosition` к новому узлу [inferred композиция официальных приёмов].

**(6) Hover-подсветка соседей — официальный пример highlight (3D-версия).**
Источник: https://github.com/vasturiano/3d-force-graph/blob/master/example/highlight/index.html [verified]

```js
// при загрузке данных — прошить соседей:
gData.links.forEach(link => {
  const a = gData.nodes[link.source], b = gData.nodes[link.target];
  (a.neighbors ||= []).push(b); (b.neighbors ||= []).push(a);
  (a.links ||= []).push(link);  (b.links ||= []).push(link);
});

const highlightNodes = new Set(), highlightLinks = new Set();
let hoverNode = null;

Graph
  .nodeColor(node => highlightNodes.has(node)
    ? node === hoverNode ? 'rgb(255,0,0,1)' : 'rgba(255,160,0,0.8)'
    : 'rgba(0,255,255,0.6)')
  .linkWidth(link => highlightLinks.has(link) ? 4 : 1)
  .linkDirectionalParticles(link => highlightLinks.has(link) ? 4 : 0)
  .linkDirectionalParticleWidth(4)
  .onNodeHover(node => {
    if ((!node && !highlightNodes.size) || (node && hoverNode === node)) return;
    highlightNodes.clear(); highlightLinks.clear();
    if (node) {
      highlightNodes.add(node);
      node.neighbors.forEach(n => highlightNodes.add(n));
      node.links.forEach(l => highlightLinks.add(l));
    }
    hoverNode = node || null;
    updateHighlight();
  });

function updateHighlight() { // перезапуск акцессоров без пересборки сцены
  Graph.nodeColor(Graph.nodeColor())
    .linkWidth(Graph.linkWidth())
    .linkDirectionalParticles(Graph.linkDirectionalParticles());
}
```

React-вариант того же (state + Set) — https://github.com/vasturiano/react-force-graph/blob/master/example/highlight/index.html [verified].

**Drill-down (проваливание вглубь) — официальный пример expandable-nodes.**
Источник: https://github.com/vasturiano/react-force-graph/blob/master/example/expandable-nodes/index.html [verified]

```jsx
const handleNodeClick = useCallback(node => {
  node.collapsed = !node.collapsed;     // toggle
  setPrunedTree(getPrunedTree());       // показать только видимую часть дерева
}, []);
```

Автор прямо рекомендует этот паттерн как лекарство от больших графов: «group nodes into larger elements whose hierarchy can be extended on demand» — issue #223 [verified]. Это ровно «области → темы → сущности → блоки» Коры.

**Интеграция в Next.js 16 App Router (SSR).**
- `ssr: false` в `next/dynamic` **запрещён в Server Components** (Next 15+) — нужен клиентский wrapper с `'use client'` — https://nextjs.org/docs/app/guides/lazy-loading + https://medium.com/@joshisagarm3/the-ssr-false-trap-in-next-js-app-router-and-how-i-escaped-it-74816bc7a778 + https://github.com/PostHog/posthog/issues/26016 [triangulated(3)]
- **Грабля №2: ref не проходит через `next/dynamic`** — issues #324 (closed) и #357 (open): https://github.com/vasturiano/react-force-graph/issues/324 , https://github.com/vasturiano/react-force-graph/issues/357 [verified]. Решение от самого vasturiano (13.10.2021): выносить обычный импорт + создание ref во **внутренний файл**, а динамически импортировать уже его [verified]

Рабочая связка для Коры (адаптация рецепта vasturiano + доки Next.js; не дословный официальный код):

```tsx
// app/(authenticated)/brain/BrainGraphInner.tsx
'use client';
import { useRef, useEffect, useCallback } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import type { ForceGraphMethods } from 'react-force-graph-3d';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export default function BrainGraphInner({ data }: { data: GraphData }) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  useEffect(() => {
    const bloom = new UnrealBloomPass();
    bloom.strength = 2; bloom.radius = 1; bloom.threshold = 0;
    fgRef.current?.postProcessingComposer().addPass(bloom);
  }, []);
  const flyTo = useCallback((node: any) => {
    const d = 60, r = 1 + d / Math.hypot(node.x, node.y, node.z);
    fgRef.current?.cameraPosition({ x: node.x*r, y: node.y*r, z: node.z*r }, node, 2000);
  }, []);
  return <ForceGraph3D ref={fgRef} graphData={data} onNodeClick={flyTo} backgroundColor="#000003" />;
}

// app/(authenticated)/brain/BrainGraph.tsx
'use client';
import dynamic from 'next/dynamic';
export const BrainGraph = dynamic(() => import('./BrainGraphInner'), {
  ssr: false,
  loading: () => <div>Загружаем мозг…</div>,
});
// страница (Server Component) импортирует BrainGraph — ref живёт внутри Inner, наружу не течёт
```

Пины для package.json (frontend Коры): `react-force-graph-3d@1.29.1`, `three@0.185.1` (в диапазоне `>=0.179 <1` требуемом 3d-force-graph@1.80), `three-spritetext@1.10.0` [verified npm 2026-07-05].

**Что берём для Коры.** Весь клиентский слой: wrapper-паттерн для App Router, click-to-focus (3000→2000 мс), highlight-соседей (частицы только на подсвеченных рёбрах — это и вау, и экономия), expandable-nodes как штатный drill-down, dynamic-паттерн для live-роста графа.

**Источники.** npm registry (2026-07-05); https://github.com/vasturiano/react-force-graph (push 2026-02-04, ★3213); примеры bloom-effect / click-to-focus / highlight / dynamic / expandable-nodes; issues #201, #558, #324, #357, #223, #202; nextjs.org/docs/app/guides/lazy-loading.

---

### 3. three-forcegraph + three-render-objects — внутренние слои (что под капотом)

**Функционально простым языком.** `three-forcegraph` — сам граф как three.js-объект (геометрия узлов/рёбер/частиц + тики физики). `three-render-objects` — обвязка вокруг: сцена, камера, контролы, рендер-цикл, tween-перелёты, EffectComposer. 3d-force-graph = склейка этих двух.

**Вау-приёмы.** Это слой, где формально живут композер и камера — знание внутренностей позволяет тонкие хаки (свой рендер-луп для селективного bloom, доступ к `Graph.scene()`, `Graph.camera()`, `Graph.renderer()`, `Graph.controls()` — README [verified]).

**Технически.**
- `three-forcegraph@1.43.4` (push 2026-04-16): внутри и `d3-force-3d "2 - 3"`, и `ngraph.forcelayout@3` — оба движка едут в бандл [verified npm]
- `three-render-objects@1.42.0` (push 2026-05-16), peer `three>=0.179`, камера-твины на `@tweenjs/tween.js "18 - 25"` [verified npm]
- Из исходника `src/three-render-objects.js` [verified, снято 2026-07-05]: композер собран из `EffectComposer` + `RenderPass`; рендер-цикл: `state.postProcessingComposer ? composer.render() : renderer.render(scene, camera)` — т.е. **добавил pass → весь вывод пошёл через композер**; перелёт камеры: `new Tween(camPos).to(finalPos, ms).easing(Easing.Quadratic.Out)`, а lookAt — отдельным твином за `transitionDuration / 3` (камера сначала «поворачивает голову», потом долетает — отсюда киношность)
- `OutputPass` в композер по умолчанию **не** добавляется [verified исходник] → при кастомных пассах возможен сдвиг цветопередачи; официальные примеры bloom живут без него — некритично [inferred]

**(4) Кастомные узлы — три официальных рецепта.**

SpriteText-подписи (спрайт — плоская картинка, всегда лицом к камере): https://github.com/vasturiano/3d-force-graph/blob/master/example/text-nodes/index.html [verified]

```js
import SpriteText from 'three-spritetext';
Graph.nodeThreeObject(node => {
  const sprite = new SpriteText(node.id);
  sprite.material.depthWrite = false; // прозрачный фон подписи
  sprite.color = node.color;
  sprite.textHeight = 8;
  sprite.center.y = -0.6;             // подпись над узлом
  return sprite;
})
.nodeThreeObjectExtend(true);          // не заменять сферу, а дополнить
```

THREE.Sprite с текстурой (основа для glow-узла): https://github.com/vasturiano/3d-force-graph/blob/master/example/img-nodes/index.html [verified]

```js
Graph.nodeThreeObject(({ img }) => {
  const imgTexture = new THREE.TextureLoader().load(`./imgs/${img}`);
  imgTexture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: imgTexture });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(12, 12);
  return sprite;
});
```

Glow-спрайт для Коры (минимальная адаптация img-nodes: текстура — радиальный градиент с canvas, аддитивное смешивание; сам приём — стандарт three.js, [inferred]):

```ts
function makeGlowTexture(color: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color); g.addColorStop(0.35, color + 'aa'); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowMaterialByColor = new Map<string, THREE.SpriteMaterial>(); // кэш! не плодить материалы
Graph.nodeThreeObject(node => {
  let m = glowMaterialByColor.get(node.color);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: makeGlowTexture(node.color),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    glowMaterialByColor.set(node.color, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.setScalar(8 + Math.cbrt(node.val ?? 1) * 4);
  return s;
});
```
Полноценные меши: https://github.com/vasturiano/3d-force-graph/blob/master/example/custom-node-geometry/index.html — `new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.75 }))` [verified].

**InstancedMesh — честный ответ.** Из коробки **нет**: `nodeThreeObject` создаёт отдельный Object3D на каждый узел [verified по дизайну API и примерам]; заявок на instancing/WASM в issues — только открытый #439 (2021, без движения) [verified]. Экономия на тысячах узлов достигается спрайтами (1 квад на узел) и кэшем материалов/текстур, а не инстансингом [inferred]. GPU-вариант «в лоб» — сторонний форк-подход jaredmcqueen/analytics (three.js + GPU-акселерация, https://github.com/jaredmcqueen/analytics) — существует, работоспособность не проверял [unverified].

**Что берём для Коры.** Glow-спрайты с кэшем материалов по цвету области + SpriteText-подписи только на крупных узлах (области/темы), у листьев подпись — по hover через `nodeLabel`. Знание рендер-цикла — для селективного bloom (карточка 5).

**Источники.** npm registry; https://github.com/vasturiano/three-forcegraph (★299); https://github.com/vasturiano/three-render-objects (★60, исходник src/three-render-objects.js); примеры text-nodes / img-nodes / custom-node-geometry; three-spritetext@1.10.0 (peer three>=0.86) [verified].

---

### 4. Физика: d3-force-3d vs ngraph.forcelayout

**Функционально простым языком.** Два «двигателя разлёта»: d3 — гибкий конструктор сил (заряд, пружины-рёбра, центр, коллизии, свои силы), ngraph — более простой и «натянутый», с quad tree для дальних взаимодействий.

**Технически.**
- `d3-force-3d@3.0.6` (репо push 2025-04-09, ★443) — форк d3-force от самого vasturiano на 1/2/3 измерения [verified]
- Дефолтные силы графа: `link`, `charge`, `center`; каждую можно перенастроить или добавить свою (`d3Force('collision', forceCollide(...))`) [verified README]
- vasturiano (issue #30): **d3 — для динамически обновляемых графов**; поведение ngraph имитируется `d3VelocityDecay(0.2)` + `charge.strength(-100)` [verified]
- dagMode, d3AlphaDecay/VelocityDecay/ReheatSimulation — только на d3; на ngraph — только `ngraphPhysics({...})` [verified README]

«Мозгоподобный» пресет для Коры (сборка из проверенных значений официальных примеров [inferred композиция]):

```js
Graph.d3VelocityDecay(0.3);                            // вязкость (tree-пример)
Graph.d3Force('charge').strength(-120);                // разрежённость (text-nodes)
Graph.d3Force('link').distance(link =>                 // короткие рёбра внутри темы,
  link.type === 'in-theme' ? 25 : 90);                 // длинные между областями
Graph.d3Force('collision', forceCollide(n => Math.cbrt(n.val) * 4)); // без слипания
```

**Что берём для Коры.** Движок d3 (граф живой). Кластеризация «полушарий»: link.distance по типу ребра + charge −80…−150; опционально своя радиальная сила на 12 областей (d3 позволяет добавить произвольную силу).

**Источники.** https://github.com/vasturiano/d3-force-3d; README 3d-force-graph (Force engine configuration); issue #30; примеры tree / text-nodes / manipulate-link-force.

---

### 5. three.js постобработка: UnrealBloomPass и селективный bloom

**Функционально простым языком.** UnrealBloomPass заставляет светиться всё ярче порога. «Селективный bloom» — чтобы светились только избранные узлы (например, найденные поиском) — в three.js делается трюком: сцена рендерится дважды, при первом проходе всё «не светящееся» временно красится в чёрный.

**Технически.** Официальный пример three.js: https://threejs.org/examples/webgl_postprocessing_unreal_bloom_selective.html , исходник: https://github.com/mrdoob/three.js/blob/master/examples/webgl_postprocessing_unreal_bloom_selective.html (master, снято 2026-07-05) [verified]. Ключевой код:

```js
const BLOOM_SCENE = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_SCENE);
const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
const materials = {};

const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85);
bloomPass.threshold = 0; bloomPass.strength = 1; bloomPass.radius = 0.5;
const bloomComposer = new EffectComposer(renderer, bloomRenderTarget);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScene); bloomComposer.addPass(bloomPass);

const mixPass = new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { baseTexture: { value: null },
              bloomTexture: { value: bloomComposer.renderTarget2.texture },
              bloomStrength: { value: params.strength } },
  vertexShader, fragmentShader }), 'baseTexture');
const finalComposer = new EffectComposer(renderer, finalRenderTarget);
finalComposer.addPass(renderScene); finalComposer.addPass(mixPass); finalComposer.addPass(new OutputPass());

function render() {
  scene.traverse(darkenNonBloomed);   // всё вне bloom-слоя → чёрный материал
  bloomComposer.render();
  scene.traverse(restoreMaterial);    // вернуть материалы
  finalComposer.render();             // обычная сцена + свечение поверх
}
function darkenNonBloomed(obj) {
  if (obj.isMesh && bloomLayer.test(obj.layers) === false) {
    materials[obj.uuid] = obj.material; obj.material = darkMaterial;
  }
}
function restoreMaterial(obj) {
  if (materials[obj.uuid]) { obj.material = materials[obj.uuid]; delete materials[obj.uuid]; }
}
// включить свечение объекта: object.layers.toggle(BLOOM_SCENE);
```

**Ограничение в связке с 3d-force-graph:** библиотека отдаёт один композер и сама держит рендер-цикл; двухпроходный селективный bloom требует подмены цикла (свой `pauseAnimation()` + ручной requestAnimationFrame с `Graph.scene()/camera()/renderer()`). Вопрос про выборочный bloom в issue #421 остался без ответа мейнтейнера — https://github.com/vasturiano/3d-force-graph/issues/421 [verified].

**Практичная альтернатива без хирургии (рекомендация для Коры):** один UnrealBloomPass на всю сцену с `threshold ≈ 0.3–0.6`, обычные узлы — приглушённые цвета (ниже порога по яркости), выделенные (hover/поиск/новые) — насыщенные яркие спрайты с AdditiveBlending → светятся фактически только они. Это [inferred] (стандартное свойство threshold: bloom применяется к пикселям ярче порога — поведение параметра [verified] по докам примера), зато ноль вмешательства в рендер-цикл.

**Что берём для Коры.** V1 — глобальный bloom + управление яркостью материалов (дёшево, надёжно). V2 (если захочется кинематографа) — свой рендер-луп с двухкомпозерной схемой из официального примера three.js.

**Источники.** three.js example webgl_postprocessing_unreal_bloom_selective (master 2026-07-05); issues 3d-force-graph #421, #418 (в #418 — трюк смены фона через кастомный Pass); react-force-graph #558.

---

### 6. Лимиты производительности — числа из issues

Все цифры — прямые сообщения пользователей/автора в GitHub issues (репорты, не бенчмарки в лабораторных условиях; железо 2020–2022 годов):

| Масштаб | Что происходит | Источник |
|---|---|---|
| 1 238 узлов + 2 602 ребра (~3.8k элементов) | официальный пример «Large graph» — работает гладко, позиционируется как большой | датасет blocks.json пересчитан 2026-07-05, https://github.com/vasturiano/3d-force-graph/blob/master/example/large-graph/index.html [verified] |
| 5k узлов + 7k рёбер | «performance significantly drops after 7k elements» (дефолтные сферы) | issue #223, 2020-09-09, https://github.com/vasturiano/react-force-graph/issues/223 [verified] |
| 10–20k узлов | заметные FPS-просадки; для видео пришлось записывать замедленно и ускорять футаж | issue #202, комментарий 2021-01-14 [verified] |
| ~118k узлов + ~118k рёбер | WebGL out of memory на старте; с `warmupTicks=100, cooldownTicks=0` и без bloom — рендерится, но грузится 5–7 минут, fps «choppy» | issue #202, 2020-07-11, https://github.com/vasturiano/react-force-graph/issues/202 [verified] |

Рецепты автора против просадок (issues #223/#202/#549 + README) [verified]:
1. `warmupTicks(100)` + `cooldownTicks(0)` — пропустить анимацию раскладки;
2. упростить геометрию: не использовать сложные `nodeThreeObject`, снизить `nodeResolution` (default 8), прямые рёбра вместо curved;
3. меньше пассов постобработки (bloom первым под нож на 100k+);
4. `enablePointerInteraction(false)`;
5. collapse/expand иерархии (expandable-nodes) — «рисуй меньше»;
6. `pauseAnimation()` когда сцена статична;
7. `cooldownTicks(N)` для сокращения тиков после драга (#549).

Порог 60fps в цифрах никто из первоисточников не публиковал — экстраполяция: полный вау-набор (bloom + частицы + спрайты) комфортен в зоне до ~5k элементов, что покрывает «тысячи узлов на организацию» Коры [inferred].

---

## Сводка: топ-выводы контура

1. **Стек подтверждён и жив**: `react-force-graph-3d@1.29.1` (2026-02-04) → `3d-force-graph@1.80.0` (2026-04-05) → three `>=0.179 <1`; репозитории активны (push февраль–май 2026). React 19 формально поддержан (`peer react: "*"`), для Next.js 16 App Router обязателен клиентский wrapper: `'use client'` + `dynamic(import, { ssr: false })`, причём ref к графу живёт **внутри** динамически импортируемого файла (рецепт самого vasturiano, issues #324/#357).
2. **Все 9 требуемых эффектов закрываются официальными примерами** — сниппеты сняты дословно: bloom (strength 4 / radius 1 / threshold 0 на фоне #000003), частицы по рёбрам (2 / 0.8 / 0.006 + `emitParticle` для разовых импульсов), `cameraPosition(pos, node, 3000)` по клику/поиску, SpriteText/Sprite-узлы, живое добавление узлов через setState, hover-подсветка соседей через Set + переприменение акцессоров, dagMode (8 режимов, циклы кидают onDagError), тюнинг d3-сил, ngraph как опция.
3. **Селективный bloom — единственный эффект без готового рецепта в экосистеме**: официальная техника three.js (слои + darkenNonBloomed + два композера) требует подмены рендер-цикла библиотеки; issue об этом (#421) остался без ответа. Прагматичный путь: глобальный bloom с threshold 0.3–0.6 + яркостная сегрегация материалов — «светится только выделенное» без хаков.
4. **Главная грабля интеграции — двойной three**: `three` у 3d-force-graph — прямая dependency (не peer); свой импорт `UnrealBloomPass` из несовпадающей версии даёт shader error «luminance: no matching overloaded function» (issue #558, open). Лечение: пин `three@0.185.1` (внутри диапазона) и один экземпляр в lock-файле.
5. **Лимиты по числам**: комфорт до ~4k элементов (официальный «large» пример = 3.8k), деградация с ~7k (issue #223), 10–20k — просадки fps, ~118k — OOM без спецрежима. Кора с «тысячами узлов на организацию» — в комфортной зоне полного вау-набора; drill-down (expandable-nodes) держит видимую сцену маленькой по построению.
6. **Деградация управляемая и штатная**: `warmupTicks(100)+cooldownTicks(0)` (мгновенный показ готовой раскладки), `pauseAnimation()`, `nodeResolution↓`, `enablePointerInteraction(false)`, фиксация позиций `node.fx/fy/fz` после `onEngineStop` (позиции можно кэшировать и переоткрывать мозг без пересчёта).
7. **Движок физики для Коры — d3** (слова автора: d3 для динамических обновлений; dagMode и кастомные силы работают только на d3). «Мозгоподобность»: `charge −80…−150`, `link.distance` по типу ребра (25 внутри темы / 90 между областями), `forceCollide` по размеру узла, `d3VelocityDecay 0.3`.
8. **Камера — готовый кинематограф**: перелёты внутри — tween Quadratic.Out, lookAt доезжает за 1/3 времени (проверено по исходнику three-render-objects); авто-орбита — 10-строчный официальный пример; `zoomToFit` для «показать весь мозг».

## Ограничения контура (что не удалось проверить)

- **Свежих (2024–2026) публичных бенчмарков нет** — все числа масштабируемости из issues 2020–2022 на тогдашнем железе; на M-серии/современных GPU реальные пороги выше, но численно не подтверждены [unverified]. Перед ТЗ стоит прогнать спайк на реальном графе Коры (1–5k узлов) с bloom+частицами.
- Root cause ошибки #558 (несовпадение версий three) — мой диагноз по сигнатуре ошибки, мейнтейнер в треде причину не подтвердил [inferred].
- Селективный bloom поверх 3d-force-graph в бою не воспроизводил — только официальный three.js-пример + анализ рендер-цикла библиотеки [inferred].
- Работоспособность GPU-альтернативы jaredmcqueen/analytics не проверялась [unverified].
- Поведение ref-прокидывания через `next/dynamic` конкретно на React 19 + Next.js 16 (где ref стал обычным пропом) не тестировал — wrapper-паттерн рекомендован как гарантированно рабочий на всех версиях [inferred].
- Цена `linkDirectionalParticles` в fps числами нигде не зафиксирована — только качественная механика («small spheres» на кадр × рёбра × частицы) и официальный паттерн-смягчение «частицы только на подсвеченных рёбрах» [inferred].
