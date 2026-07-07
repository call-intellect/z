---
type: analysis
status: research-input
segment: oss-demos
snapshot_date: 2026-07-05
---

# OSS-исходники красивых графов и «мозгоподобных» визуализаций (контур 10)

Задача контура: найти открытый работающий код, из которого программист Коры собирает (а) вау-3D-режим графа знаний (свечение, частицы, полёт камеры) и (б) практичную навигацию drill-down (проваливание вглубь). Стек Коры: Next.js 16 App Router + React 19 + Tailwind 4; в репо уже есть `react-force-graph-2d`.

Зафиксированные npm-версии (из registry.npmjs.org, 2026-07-05) [verified]:
`3d-force-graph@1.80.0` (требует `three >=0.179 <1`) · `react-force-graph-2d@1.29.1` и `react-force-graph-3d@1.29.1` (peerDeps `react: "*"` → React 19 ОК) · `force-graph@1.51.4` · `three@0.185.1` · `three-spritetext@1.10.0` · `sigma@3.0.3` · `graphology@0.26.0` · `@react-sigma/core@5.0.6` (peerDeps `react ^18 || ^19`) · `reagraph@4.32.0` (внутри `three ^0.184`, `@react-three/fiber ^9.6.1` — линейка React 19) · `@cosmos.gl/graph@3.1.0`.

SSR-правило для всего контура: все перечисленные библиотеки трогают `window`/WebGL при импорте или монтировании → в Next.js 16 App Router компонент графа = `"use client"` + `next/dynamic(() => import(...), { ssr: false })`. Подтверждено issue vasturiano/react-force-graph #136, #155 [verified: https://github.com/vasturiano/react-force-graph/issues/136]. Ловушка: `ref` через `next/dynamic` не пробрасывается напрямую — нужен клиентский компонент-обёртка, внутри которой обычный import и `useRef` (issue #357) [verified: https://github.com/vasturiano/react-force-graph/issues/357].

---

## Карточки

### 1. vasturiano/3d-force-graph — ядро вау-режима

- **Метрики:** 6 174 звёзд, MIT, последний push 2026-04-05, npm `3d-force-graph@1.80.0` [verified: https://github.com/vasturiano/3d-force-graph + registry.npmjs.org]
- **Функционально простым языком:** готовый 3D-граф с силовой укладкой (force-directed — узлы разлетаются как заряды и стягиваются связями), рендер ThreeJS/WebGL. 31 официальный пример в папке `example/` — фактически конструктор нашего вау-режима.
- **Вау-приёмы (самые эффектные примеры, живая демка + исходник):**
  - Bloom (свечение): https://vasturiano.github.io/3d-force-graph/example/bloom-effect/ · код https://github.com/vasturiano/3d-force-graph/blob/master/example/bloom-effect/index.html [verified]
  - Бегущие частицы по рёбрам: https://vasturiano.github.io/3d-force-graph/example/directional-links-particles/ · код `example/directional-links-particles/index.html` [verified]
  - Полёт камеры к узлу по клику: https://vasturiano.github.io/3d-force-graph/example/click-to-focus/ · код `example/click-to-focus/index.html` [verified]
  - Автооблёт камеры (кинематографичный «мозг вращается»): https://vasturiano.github.io/3d-force-graph/example/camera-auto-orbit/ [verified]
  - Текст вместо узлов (названия тем как звёзды): https://vasturiano.github.io/3d-force-graph/example/text-nodes/ [verified]
  - Подсветка соседей при наведении: https://vasturiano.github.io/3d-force-graph/example/highlight/ [verified]
  - Разворачивание/сворачивание узлов кликом (drill-down): `example/expandable-nodes/` [verified из README-списка]
  - Emit particles on demand (вспышка-импульс по ребру в момент события): `example/emit-particles/` [verified из README-списка]
- **Технически:** поверх `three-forcegraph` + `d3-force-3d`; доступ к сцене three.js (`Graph.scene()`), к камере (`Graph.cameraPosition()`), к постпроцессингу (`Graph.postProcessingComposer()`). Любой узел — произвольный `THREE.Object3D` через `nodeThreeObject`.
- **Лимиты производительности числами:** официальный пример «Larger graph» — ~4 000 элементов, работает гладко [verified: README]. Issue #223 react-обёртки: 5k узлов + 7k рёбер = «significant performance drop» на дефолтных настройках [verified: https://github.com/vasturiano/react-force-graph/issues/223]. Issue #202: 117 927 узлов / 117 921 рёбер → WebGL out of memory через несколько секунд [verified: https://github.com/vasturiano/react-force-graph/issues/202]. Вывод: комфортная зона без оптимизаций — до ~5–8k видимых элементов; «тысячи узлов на организацию» Коры проходят, но весь граф разом на 50k+ — нет [inferred].
- **Что берём для Коры:** это ОСНОВА. Четыре сниппета ниже — готовый вау-набор: свечение + импульсы знаний по рёбрам + полёт к области при клике + названия областей текстом.

Источник: https://github.com/vasturiano/3d-force-graph/blob/master/example/bloom-effect/index.html [verified]
```html
<script type="module">
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
</script>
```

Источник: https://github.com/vasturiano/3d-force-graph/blob/master/example/directional-links-particles/index.html [verified]
```js
const Graph = new ForceGraph3D(document.getElementById('3d-graph'))
  .jsonUrl('../datasets/miserables.json')
  .nodeLabel('id')
  .nodeAutoColorBy('group')
  .linkDirectionalParticles("value")
  .linkDirectionalParticleSpeed(d => d.value * 0.001);
```

Источник: https://github.com/vasturiano/3d-force-graph/blob/master/example/click-to-focus/index.html [verified, дословно]
```js
const Graph = new ForceGraph3D(elem)
  .jsonUrl('../datasets/miserables.json')
  .nodeLabel('id')
  .nodeAutoColorBy('group')
  .onNodeClick(node => {
    const distance = 40;
    const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
    const newPos = node.x || node.y || node.z
      ? { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }
      : { x: 0, y: 0, z: distance };
    Graph.cameraPosition(newPos, node, 3000);
  });
```

Источник: https://github.com/vasturiano/3d-force-graph/blob/master/example/text-nodes/index.html [verified, дословно]
```js
import SpriteText from "https://esm.sh/three-spritetext";
const Graph = new ForceGraph3D(document.getElementById('3d-graph'))
  .jsonUrl('../datasets/miserables.json')
  .nodeAutoColorBy('group')
  .nodeThreeObject(node => {
    const sprite = new SpriteText(node.id);
    sprite.material.depthWrite = false;
    sprite.color = node.color;
    sprite.textHeight = 8;
    sprite.center.y = -0.6;
    return sprite;
  })
  .nodeThreeObjectExtend(true);
Graph.d3Force('charge').strength(-120);
```

### 2. vasturiano/react-force-graph — React-обёртка (наш прямой путь)

- **Метрики:** 3 213 звёзд, MIT, push 2026-02-04; npm `react-force-graph-3d@1.29.1`, peerDeps `react: "*"` → React 19 совместим [verified: registry.npmjs.org]
- **Функционально:** те же 2D/3D/VR/AR графы как React-компоненты; API один-в-один с `3d-force-graph` (props вместо методов).
- **Вау-приёмы:** зеркальная галерея примеров, включая bloom на React с `useRef` + `useEffect` — ровно наш кейс для Next.js.
- **Технически:** тонкая обёртка через `react-kapsule`; внутри тот же `3d-force-graph@^1.79`.
- **Что берём для Коры:** паттерн «ref + postProcessingComposer» — единственно правильный способ включить свечение в React-компоненте.

Источник: https://github.com/vasturiano/react-force-graph/blob/master/example/bloom-effect/index.html [verified, дословно]
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

Подключение в Next.js 16 App Router (паттерн из issue #136/#155/#357 [verified]):
```tsx
// app/(authenticated)/graph/GraphView.tsx  — "use client" + обычный import + useRef внутри
// app/(authenticated)/graph/page.tsx:
import dynamic from 'next/dynamic';
const GraphView = dynamic(() => import('./GraphView'), { ssr: false });
```

### 3. vasturiano/force-graph (2D) — то, что уже стоит в Коре

- **Метрики:** 2 056 звёзд, MIT, push 2026-04-16, npm `force-graph@1.51.4` [verified]
- **Функционально:** canvas-2D вариант; та же модель данных и те же `linkDirectionalParticles`/highlight-приёмы.
- **Что берём для Коры:** дешёвый апгрейд уже существующего 2D-графа — частицы по рёбрам и hover-подсветка соседей работают и в 2D с тем же API [verified: галерея примеров force-graph]. Полный hover-паттерн (Set подсвеченных, соседи через предрасчёт `node.neighbors`) — дословно в https://github.com/vasturiano/3d-force-graph/blob/master/example/highlight/index.html [verified].

### 4. jacomyal/sigma.js + packages/demo — эталон 2D-навигации по большому графу

- **Метрики:** 12 082 звезды, MIT, push 2026-06-09; npm `sigma@3.0.3` + `graphology@0.26.0` [verified]
- **Функционально:** WebGL-рендер 2D-графов «тысячи узлов и рёбер»; живая демка — карта страниц Википедии с поиском, наведением, кластерами: https://www.sigmajs.org/demo/ [verified]
- **Вау-приёмы:** мгновенный пан/зум по десяткам тысяч узлов, hover-фейд остального графа, лейблы появляются от зума (LOD — level of detail).
- **Технически:** исходник демки — Vite + React + react-sigma в монорепо: https://github.com/jacomyal/sigma.js/tree/main/packages/demo [verified]. React-биндинги `@react-sigma/core@5.0.6` официально поддерживают React 19 (peerDeps `^18 || ^19`) [verified: registry.npmjs.org].
- **Что берём для Коры:** архитектуру «панель поиска + подсветка кластера + фейд» из `packages/demo/src` для практичного 2D-режима, когда узлов станет 20k+. Это запасная лошадь для навигации, не для вау.

### 5. johnymontana/sigma-graph-examples — React 19 + Sigma 3 стартер

- **Метрики:** 3 звезды, MIT [verified: https://github.com/johnymontana/sigma-graph-examples]
- **Функционально:** 14 работающих примеров от «загрузить граф» до «поиск+фильтрация», «миникарта», «анимированные переходы», «Neo4j property graph». Живая демка: https://sigma-graph-examples.vercel.app/ [verified]
- **Технически:** React 19 + TypeScript + Vite + Sigma 3 + graphology + ForceAtlas2 [verified: README] — доказательство, что наша связка версий заводится без плясок.
- **Что берём для Коры:** примеры 7 (Graph Search & Filtering) и 13 (Animated Transitions) как референс кода фильтров «где наполнено/пусто».

### 6. reaviz/reagraph — WebGL-граф на react-three-fiber

- **Метрики:** 1 057 звёзд, Apache-2.0, push 2026-06-25; npm `reagraph@4.32.0`, внутри `three@^0.184` + `@react-three/fiber@^9.6.1` (R3F 9 = линейка React 19) [verified: registry.npmjs.org]
- **Функционально:** декларативный `<GraphCanvas nodes edges/>` с готовыми фичами: кластеризация, lasso-выделение, радиальные/иерархические укладки, тёмная тема, path finding (поиск пути между узлами). Демо/сторибук: https://reagraph.dev [verified]
- **Вау-приёмы:** «из коробки» аккуратный вид без ручного three.js; кластеры с подписями.
- **Технически:** так как это R3F-сцена, к ней подключается `@react-three/postprocessing` (Bloom) — но это уже наша доработка [inferred].
- **Что берём для Коры:** вариант Б «быстро и прилично»: если решим не собирать вау-режим руками, reagraph даёт кластеризацию областей за час. Минус: меньше контроля над «мозгом», сообщество меньше vasturiano.

### 7. cosmos.gl (cosmograph-org) — GPU-движок для сотен тысяч узлов

- **Метрики:** ~1 200 звёзд, MIT, релиз v3.1 — 30 июня 2026; npm `@cosmos.gl/graph@3.1.0` [verified: https://github.com/cosmograph-org/cosmos]
- **Функционально:** вся силовая симуляция И рендер — в шейдерах GPU (fragment/vertex, luma.gl/WebGL2); «real-time симуляция сотен тысяч точек и рёбер на современном железе» [claimed: README]. Демки-сторибук: https://cosmosgl.github.io/graph/ [verified]
- **Вау-приёмы:** граф «дышит» в реальном времени даже на 100k+ узлов — сама скорость и есть вау; это движок продукта cosmograph.app.
- **Технически:** низкоуровневый API — позиции точек кладутся `Float32Array`; React-обёртки нет, интеграция руками в `useEffect` [verified: README-пример].

Источник: https://github.com/cosmograph-org/cosmos (README) [verified]
```js
import { Graph } from '@cosmos.gl/graph';
const graph = new Graph(div, config);
graph.setPointPositions(new Float32Array([0.0, 0.0, 1.0, 0.0, 0.5, 1.0]));
graph.setLinks(new Float32Array([0, 1, 1, 2, 2, 0]));
graph.render();
```
- **Что берём для Коры:** страховка масштаба. Когда граф организации перерастёт 20–50k узлов и vasturiano начнёт задыхаться (см. лимиты в карточке 1) — переезжаем «вау-полотно» на cosmos.gl, сохранив наши цвета/партиклы поверх.

### 8. jackyzha0/quartz — Obsidian-подобный graph view для веба (лучший практичный клон)

- **Метрики:** 12 700 звёзд, MIT [verified: https://github.com/jackyzha0/quartz]
- **Функционально:** генератор сайтов из Markdown-заметок с интерактивным графом «как в Obsidian» — то, что тысячи людей публикуют как «цифровой сад» (digital garden).
- **Вау-приёмы:** hover: соседи остаются opacity 1.0, остальной граф фейдится до 0.2; лейблы масштабируются и проявляются от зума; плавные твины (tween — анимация значения) [verified: исходник].
- **Технически:** ровно один файл — `quartz/components/scripts/graph.inline.ts`, 649 строк: физика на d3-force (`forceSimulation/forceManyBody/forceCenter/forceLink/forceCollide/forceRadial`), рендер на **pixi.js** (GPU-canvas), анимации на `@tweenjs/tween.js` [verified: https://github.com/jackyzha0/quartz/blob/v4/quartz/components/scripts/graph.inline.ts — импорты процитированы дословно].
- **Что берём для Коры:** ЭТО донор практичной 2D-навигации: скопировать логику hover-фейда 1.0/0.2, радиус узла от числа связей (`nodeRadius()`), появление подписей от зума. Файл самодостаточен и переносим в наш React-компонент почти без правок.

### 9. Obsidian 3D Graph — триада плагинов (клоны «мозга» поверх 3d-force-graph)

- **AlexW00/obsidian-3d-graph:** 376 звёзд, MIT, последний push 2023-10-24 (заморожен) [verified: GitHub API]
- **HananoshikaYomaru/obsidian-3d-graph:** 169 звёзд, MIT, релиз 1.1.11 от 2023-12-23; TypeScript 96.7% [verified]
- **Apoo711/obsidian-3d-graph:** 68 звёзд, MIT, push 2026-06-29 — ЖИВОЙ наследник [verified: GitHub API]
- **Функционально:** «весь vault как 3D-мозг»: фильтры по запросу, группы цветом, поиск с фокус-полётом к заметке, размер узла от степени (числа связей), подписи гаснут с расстоянием [verified: README HananoshikaYomaru].
- **Технически:** все три — поверх `3d-force-graph` vasturiano [verified: acknowledgements]. Т.е. это доказательство, что из библиотеки карточки 1 собирается полноценный «Obsidian-мозг».
- **Что берём для Коры:** из HananoshikaYomaru/Apoo711 — готовые продуктовые паттерны: (а) label fading по дистанции камеры, (б) node size = f(degree), (в) «поиск → полёт к узлу», (г) фильтры-группы. Смотреть `src/` обоих реп; свежие фиксы производительности — в коммитах Apoo711 за 2026 [verified: даты push].

### 10. anvaka/pm «Software Galaxies» — граф как галактика (легенда жанра)

- **Метрики:** 1 800 звёзд, MIT, последний коммит 2026-06-24 [verified: https://github.com/anvaka/pm/commits/master]
- **Функционально:** вся npm/PyPI/GitHub-вселенная пакетов как звёздное небо, полёт на WASD. Живая демка: https://anvaka.github.io/pm/#/ [verified]
- **Вау-приёмы:** «граф GitHub — более 1 100 000 узлов, рендер 60 fps при полёте» [claimed: README anvaka]. Каждый пакет — светящаяся точка-звезда, связи проявляются при приближении.
- **Технически:** рендер на ngraph.pixel (см. карточку 11); укладка посчитана офлайн, в браузере только показ [verified: README + архитектура ngraph]. Это ключевой трюк масштаба: не считать физику в браузере.
- **Что берём для Коры:** идею «предрасчитанная укладка на бэке (NestJS-воркер) + браузер только летает». Для тысяч узлов Коры можно считать layout на сервере ночным cron и отдавать координаты — тогда фронт держит 60 fps [inferred из архитектуры pm].

### 11. anvaka/ngraph.pixel — быстрый 3D-рендерер на ShaderMaterial

- **Метрики:** 344 звезды, MIT [verified: https://github.com/anvaka/ngraph.pixel]
- **Функционально:** минималистичный 3D-граф: узлы — шейдерные точки, WASD-полёт из коробки. Демка: https://anvaka.github.io/ngraph.pixel/demo/basic/index.html?graph=balancedBinTree [verified]
- **Технически:** низкоуровневый `THREE.ShaderMaterial` вместо мешей — на порядок дешевле по draw calls, чем сферы vasturiano [verified: README «Fast graph renderer based on low level ShaderMaterial»]. Точечный вид узла: `lib/nodeView.js` [verified: https://github.com/anvaka/ngraph.pixel/blob/master/lib/nodeView.js]
- **Что берём для Коры:** приём «узел = шейдерная точка-спрайт со свечением в текстуре» для дальнего плана (зум-аут всего мозга), когда сферы становятся дороги. Код старый (не обновлялся годы) — берём приём, не зависимость [inferred].

### 12. jaredmcqueen/analytics — силовая укладка целиком на GPU (1M узлов)

- **Метрики:** 211 звёзд, **GPL-3.0**, демка http://jaredmcqueen.github.io/analytics/app.html [verified: https://github.com/jaredmcqueen/analytics]
- **Функционально:** Fruchterman-Reingold (алгоритм укладки) полностью в WebGL-шейдерах; «60 FPS при 1 000 000 узлов» [claimed: README].
- **Технически:** GLSL 3% кодовой базы, папка `/shaders` — позиции узлов живут в текстурах GPU (GPGPU-паттерн).
- **Что берём для Коры:** ВНИМАНИЕ, GPL-3.0 — копировать код в проприетарную Кору НЕЛЬЗЯ (заражает лицензией). Берём только идею GPGPU-симуляции; открытая MIT-альтернатива той же идеи — cosmos.gl (карточка 7) [verified: лицензии].

### 13. graphcentral/graph — knowledge graph на PIXI + WebWorkers (числа лимитов 2D)

- **Метрики:** 58 звёзд, MIT, релиз 0.1.0-rc.4 от 2022-09-05 [verified: https://github.com/graphcentral/graph]
- **Функционально:** «граф знаний Notion» с поиском и кластерами; демки прямо с числами: 5k узлов+5k рёбер, 50k+50k, 100k+100k («со 100k — деградация ожидаема») [verified: README, https://graphcentral.github.io/graph?graph_data=5000]
- **Технически:** PIXI.js рендер + силовая укладка в WebWorker (не блокирует UI) + IndexedDB кэш.
- **Что берём для Коры:** паттерн «физика в WebWorker» для нашего 2D-режима на react-force-graph-2d — снимаем фризы вкладки при пересчёте укладки на 10k+ узлов. И его же числа как ориентир потолка 2D-canvas/pixi: комфорт до ~50k [triangulated(2): README + живые демки].

### 14. the-halfbloodprince/GalaxyM1199 — генератор галактики (полный рецепт «звёздного мозга»)

- **Метрики:** 46 звёзд, лицензия **Unlicense** (public domain — можно копировать без ограничений), демка https://galaxy-m1199.web.app [verified: https://github.com/the-halfbloodprince/GalaxyM1199]
- **Функционально:** классическая спиральная галактика из курса Bruno Simon Three.js Journey (урок «Galaxy Generator»): 70 000 частиц-звёзд, 8 рукавов, вращение, градиент цвета от ядра к краям + 9 000 фоновых звёзд.
- **Вау-приёмы:** AdditiveBlending (сложение света — частицы «светятся» без постпроцессинга) + alphaMap-спрайт частицы + степенное распределение randomnessPower (звёзды гуще к рукавам).
- **Что берём для Коры:** фоновое «звёздное небо» вокруг графа-мозга и рецепт материала частиц. Ниже — дословный код позиционирования и материала.

Источник: https://github.com/the-halfbloodprince/GalaxyM1199/blob/master/src/script.js [verified, дословно]
```js
// параметры: count 70000, branches 8, spin 1, randomnessPower 5,
// insideColor '#ff6030', outsideColor '#1b3984'
for(let i=0; i<parameters.count; i++){
    const x = Math.random() * parameters.radius
    const branchAngle = (i % parameters.branches) / parameters.branches * 2 * Math.PI
    const spinAngle = x * parameters.spin
    const randomX = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random()<0.5 ? 1: -1)
    const randomY = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random()<0.5 ? 1: -1)
    const randomZ = Math.pow(Math.random(), parameters.randomnessPower) * (Math.random()<0.5 ? 1: -1)
    positions[i*3] = Math.sin(branchAngle + spinAngle) * x + randomX
    positions[i*3 + 1] = randomY
    positions[i*3 + 2] = Math.cos(branchAngle + spinAngle) * x + randomZ
    const mixedColor = colorInside.clone()
    mixedColor.lerp(colorOutside, x / parameters.radius)
    colors[i*3 + 0] = mixedColor.r; colors[i*3 + 1] = mixedColor.g; colors[i*3 + 2] = mixedColor.b
}
material = new THREE.PointsMaterial({
    size: parameters.size, depthWrite: false, sizeAttenuation: true,
    blending: AdditiveBlending, vertexColors: true, transparent: true, alphaMap: shape
})
```

### 15. three.js официальный пример drawrange — «plexus/нейросеть» эффект

- **Метрики:** репозиторий mrdoob/three.js, MIT; живая демка https://threejs.org/examples/webgl_buffergeometry_drawrange.html [verified]
- **Функционально:** облако частиц, между близкими автоматически проявляются линии с прозрачностью по дистанции — канонический «нейронный» эффект, который все копируют с кодпенов.
- **Технически (проверено по исходнику):** `maxParticleCount = 1000`, `minDistance: 150`, `LineSegments` + `setDrawRange(0, numConnected*2)`, альфа линии `1.0 - dist/minDistance` [verified: https://github.com/mrdoob/three.js/blob/master/examples/webgl_buffergeometry_drawrange.html — строки процитированы grep'ом]. Форум three.js подтверждает: известные «neural network» кодпены (prisoner849, https://codepen.io/prisoner849/full/yLKZdgv) сделаны на базе этого примера [triangulated(2): https://discourse.threejs.org/t/how-to-make-neural-network-effect/49172 + исходник].
- **Что берём для Коры:** hero-анимация «мозг думает» для пустых состояний/лендинга и слой «синапсы» между близкими узлами одной темы. MIT — копируем смело.

### 16. bytezpro/threejs-brain-animation — готовый React-компонент «мозг»

- **Метрики:** 11 звёзд, MIT, npm `threejs-brain-animation`; демка https://example-brain-animation.vercel.app/ [verified: https://github.com/bytezpro/threejs-brain-animation]
- **Функционально:** интерактивный 3D-мозг (вращение/зум) как React-компонент; GLSL — 10.2% кода (кастомные шейдеры) [verified: language breakdown].
- **Что берём для Коры:** быстрый «мозг-заставка» для онбординга, пока граф пустой («мозг растёт на глазах» — стадия 0). Маленький проект — код читается за вечер; шейдеры в `src/` [verified].

### 17. nomic-ai/deepscatter — миллиарды точек (лицензионный капкан)

- **Метрики:** 1 200 звёзд, лицензия **CC-BY-NC-SA (некоммерческая!)**, релиз v2.10.0 2023-04-11 [verified: https://github.com/nomic-ai/deepscatter]
- **Функционально:** зумируемый скаттерплот «свыше миллиарда точек» через квадродерево тайлов (как карты); демки Atlas: 5.5 млн твитов, 20 млн статей [claimed: README].
- **Технически:** regl (WebGL) + Apache Arrow для стриминга данных на GPU.
- **Что берём для Коры:** НИЧЕГО из кода (NC-лицензия несовместима с коммерческим продуктом) [verified]. Берём только архитектурную идею тайлинга данных при супер-масштабе. В отчёте — как маркер «куда индустрия ушла по масштабу».

### 18. xyjigsaw/Knowledge-Graph-And-Visualization-Demo — KG + Neo4j + 3d-force-graph

- **Метрики:** 202 звезды, MIT [verified: https://github.com/xyjigsaw/Knowledge-Graph-And-Visualization-Demo]
- **Функционально:** «2D-поиск + 3D-обзор» графа знаний (данные COVID-трейсинга): поиск по ключевым словам → подграф в 3D.
- **Технически:** Python/Flask + Neo4j + 3d-force-graph на фронте — стек не наш, но UX-паттерн ровно наш.
- **Что берём для Коры:** UX-схему «поиск словами → сфокусированный подграф в 3D», а не код. Подтверждает выбор 3d-force-graph как стандарта де-факто для KG-визуализаций [triangulated(3): этот репо + триада Obsidian-плагинов + примеры vasturiano].

### 19. grapheco/InteractiveGraph — старый комбайн (для полноты)

- **Метрики:** 1 100 звёзд, BSD-2-Clause, последний коммит 2020-08-12 — МЁРТВ [verified: https://github.com/grapheco/InteractiveGraph]
- **Функционально:** GraphNavigator/GraphExplorer/RelFinder поверх vis.js; демки живы (https://grapheco.github.io/InteractiveGraph/dist/examples/example1.html).
- **Что берём для Коры:** только UX-референс RelFinder («найди связь между двумя сущностями» — «почему Иван связан с клиентом X»). Код не берём: vis.js + jQuery, 6 лет без коммитов [verified].

---

## Сводка: топ-выводы контура

### Топ-5 «вот отсюда собираем наш вау»

1. **vasturiano/3d-force-graph + react-force-graph-3d@1.29.1 (карточки 1–2)** — фундамент. Четыре проверенных сниппета (bloom strength=4/radius=1/threshold=0 на `#000003`, `linkDirectionalParticles`, `cameraPosition(…, node, 3000)` по клику, SpriteText-подписи) дают 80% вау-эффекта «светящийся живой мозг» за дни, MIT, React 19 ОК, единственное требование — `dynamic(..., { ssr:false })` + клиентская обёртка для ref. Обоснование: самая большая галерея готовых эффектов (31 пример) + стандарт де-факто для KG (см. триангуляцию в карточке 18) + у Коры уже стоит 2D-версия того же API — минимальная цена входа.
2. **GalaxyM1199 / рецепт Bruno Simon (карточка 14)** — фоновая галактика: 9k фоновых звёзд + AdditiveBlending + alphaMap + спиральные рукава с lerp-градиентом цвета. Unlicense — копипаст без юридических вопросов. Это слой «космос», который отличит Кору от всех стандартных force-graph.
3. **Quartz graph.inline.ts (карточка 8)** — практичная навигация: hover-фейд 1.0/0.2, радиус узла от степени, лейблы от зума, твины. 649 строк проверенного на 12.7k-звёздном проекте кода d3+pixi, MIT. Это режим «работать с графом», парный к вау-режиму.
4. **HananoshikaYomaru + Apoo711 obsidian-3d-graph (карточка 9)** — продуктовые паттерны поверх той же 3d-force-graph: поиск→полёт к узлу, label fading по дистанции, фильтры-группы, размер узла от связности. Прямо мапится на «drill-down: область → тема → сущность → факт из встречи». Apoo711 жив (push 2026-06-29) — смотреть свежие перф-фиксы.
5. **cosmos.gl @cosmos.gl/graph@3.1.0 (карточка 7)** — страховка масштаба: GPU-симуляция сотен тысяч узлов, MIT, релиз 30 июня 2026. Когда тенант перерастает ~20k видимых узлов — вау-полотно мигрирует сюда, навигация остаётся на sigma/vasturiano.

### Ключевые числа лимитов (для ТЗ)

| Движок | Комфорт | Потолок | Источник |
|---|---|---|---|
| 3d-force-graph (меши) | ~4k элементов (офиц. пример) | 5k узлов+7k рёбер — деградация; 117 927 узлов — WebGL OOM | issues #223, #202 [verified] |
| force-graph 2D / pixi | 5k — гладко | ~50k ок, 100k — деградация (graphcentral демки) | [verified] |
| sigma.js v3 | «тысячи узлов» | демка Википедии ~десятки тысяч | [claimed+demo] |
| cosmos.gl v3.1 | сотни тысяч точек real-time | — | [claimed: README] |
| GPGPU (jaredmcqueen, GPL) | 1M узлов 60fps | — | [claimed: README] |
| anvaka/pm (предрасчёт укладки) | 1.1M узлов 60fps полёт | — | [claimed: README] |

Правило для Коры [inferred из таблицы]: тысячи узлов на организацию → vasturiano-стек хватает с запасом, если (а) не показывать все рёбра разом, (б) drill-down режет видимый подграф до сотен узлов, (в) на зум-ауте узлы упрощаются до точек-спрайтов (приём ngraph.pixel) или layout предрасчитан на бэке (приём anvaka/pm).

### Выводы по совместимости (React 19 + Next.js 16)

- `react-force-graph-2d/3d@1.29.1`: peerDeps `react: "*"` — React 19 ОК [verified]; SSR — только `ssr:false` + клиентская обёртка для ref (issues #136/#155/#357) [verified].
- `@react-sigma/core@5.0.6`: peerDeps `react ^18 || ^19` — официально [verified]; sigma рисует в canvas/WebGL → тоже `"use client"`.
- `reagraph@4.32.0`: на `@react-three/fiber ^9.6.1` — R3F 9 сделан под React 19 [verified: deps]; peerDeps `react >=16`.
- `three@0.185.1` актуален; `3d-force-graph@1.80` требует `three >=0.179` — пиновать three в проекте, чтобы UnrealBloomPass импортировался из той же копии (двойной three = классическая ловушка) [inferred, стандартная практика].

### Лицензии — светофор

- **Зелёный (копируем):** все vasturiano (MIT), sigma/graphology (MIT), quartz (MIT), obsidian-3d-graph триада (MIT), cosmos.gl (MIT), three.js examples (MIT), GalaxyM1199 (Unlicense), ngraph.pixel/pm (MIT), reagraph (Apache-2.0).
- **Красный (только идеи, ни строчки кода):** jaredmcqueen/analytics (GPL-3.0), nomic-ai/deepscatter (CC-BY-NC-SA) [verified].

---

## Ограничения контура (что не удалось проверить)

- FPS-числа cosmos.gl, jaredmcqueen (1M@60fps) и anvaka/pm (1.1M@60fps) — заявления README авторов [claimed], независимых бенчмарков с методикой не нашёл; собственный замер на данных Коры не проводился (это следующий шаг — прототип).
- Точная дата последнего коммита ngraph.pixel, GalaxyM1199 и graphcentral/graph не зафиксирована (GitHub API упёрся в rate-limit без токена; по косвенным признакам ngraph.pixel и graphcentral не развиваются с ~2022) [inferred].
- Совместимость `reagraph@4.32.0` с React 19 проверена по зависимостям (R3F 9.6.1), но не живым запуском в Next.js 16 [inferred].
- «31 пример» vasturiano и список фич reagraph взяты из README — каждый пример в браузере не открывался, кроме перечисленных живых демок [verified частично].
- Кодпены prisoner849 (yLKZdgv) не открывались напрямую — известны по ссылке из форума three.js [triangulated(2), но без прямой проверки содержимого].
- WebGPU-ветку (three.js WebGPURenderer/TSL) сознательно не копал: ни один из найденных граф-репо на неё ещё не переехал по состоянию на снапшот [unverified].
