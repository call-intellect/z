---
type: analysis
status: research-input
feature: goals-map-and-ideas
date: 2026-06-20
snapshot_date: 2026-06-20
---

> Контур: техническая реализация карты/графа целей в React/Next.js. Сводка для [99-synthesis.md](99-synthesis.md).

# Техника — граф-визуализация целей в React (5 библиотек)

**Главный вывод:** для Z это **две разные задачи разными инструментами**: (1) **редактируемая детерминированная карта дерева целей** (ручное связывание, фикс-позиции) → **React Flow / @xyflow + dagre**; (2) **обзорный граф «память» (цели+идеи+темы, orphan)** → **react-force-graph-2d, которая у Z уже стоит**.

## React Flow / @xyflow/react — node-based, drag-drop, детерминизм
- **Layout НЕ встроен** — подключают внешний движок: **dagre** (лучший для дерева, «inverted-V», динамический размер узлов), d3-hierarchy (одно-корневое дерево), ELK (мощнее, сложнее), d3-force (дорого каждый рендер). `[verified]` reactflow.dev/learn/layouting · 2026-06-20
- Готовый пример «Dagre Tree». `[verified]` reactflow.dev/examples/layout/dagre
- ⚠️ **Rename:** пакет `reactflow` → **`@xyflow/react` (v12, стаб. июль 2024)**, импорт `{ ReactFlow }`, стили `@xyflow/react/dist/style.css`, React 19-совместимо. `[verified]` reactflow.dev/learn/troubleshooting/migrate-to-v12
- **Лицензия MIT, бесплатно для коммерции; React Flow Pro НЕ нужен** (это подписка на поддержку/Pro-примеры, ядро MIT). `[verified]` github.com/xyflow/xyflow/discussions/3397 · reactflow.dev/pro/pricing
- Цвет/форма: `type` узла → свой React-компонент (богатый UI, Tailwind/парные токены), мини-карта красит `nodeColor={fn}`, тёмная тема `colorMode`. `[verified]` reactflow.dev/learn/customization/theming
- Лимит: DOM-узлы (каждый узел = React-компонент) — потолок ниже canvas, но 50–200 узлов комфортно.

## react-force-graph-2d — force-directed, УЖЕ В Z
- Canvas + d3-force; **DAG-режим** (td/bu/lr/radialout) даёт детерминированную раскладку по уровням. `[verified]` github.com/vasturiano/react-force-graph · deepwiki .../6.2-dag-layouts
- **Orphan бесплатно**: `dagNodeFilter` → несвязанные «свободно плавают» в стороне. `onDagError` → циклы. `[verified]`
- «Главная в центре» — `forceRadial` + фикс центрального узла (`fx/fy`). `[verified]` d3js.org/d3-force/position
- Производительность: canvas до ~5k узлов, 50–200 «глубоко в зелёной зоне». `[verified]` cylynx.io/blog/...
- Цвет/форма: `nodeCanvasObject(node,ctx,scale)` — рисуешь форму/цвет/подпись Canvas API. `[verified]`
- Лимит: не редактор (нет ручного создания рёбер из коробки); строгие слои физика не гарантирует (в чистом force-режиме; в dagMode — гарантирует уровни).
- В Z уже есть рабочий паттерн: `frontend/app/(authenticated)/entities/[id]/graph/ForceGraphCanvas.tsx` (центр-узел, стрелки, пунктир «истёкших» рёбер, клики, FallbackList, ResizeObserver, lazy-import).

## Cytoscape.js (+dagre/cola/concentric)
- Богатые layouts из коробки (dagre/concentric/breadthfirst/cola), MIT. `[verified]` js.cytoscape.org · github.com/cytoscape/cytoscape.js-dagre
- ⚠️ Императивный DOM мимо React virtual DOM — «трётся» с React. `[verified]`

## Прочие
- **vis-network** — иерархия богатая, но тот же конфликт с React + ручное глушение physics. **Не рекомендую.** `[verified]`
- **ELK.js/dagre** — это калькуляторы координат, не рендереры; **dagre достаточно**, ELK = оверкилл. `[verified]`
- **reagraph** — WebGL для React, но дублирует уже стоящий react-force-graph → не вводить без причины. `[verified|claimed]` reagraph.dev

## UX-ориентир рынка
- Perdoo Strategy Map / Quantive alignment map — **иерархический tree/alignment map**, статусы on track/at risk/has issues (зелёный/жёлтый/красный). Паутина — для исследования связности (как граф памяти Obsidian), не для дерева целей. `[verified]` capterra.com/p/156365 · tempo.io/blog/best-okr-software

## Что перенять (вход в синтез)
1. **Две карты, два инструмента**: редактируемая карта целей → `@xyflow/react`(MIT,v12)+dagre (детерминизм, drag-drop связывание, богатые узлы); обзорный граф «цели+идеи+темы» → переиспользовать `react-force-graph-2d`.
2. **Orphan двухслойно**: визуально (force/dagNodeFilter раскидывает) + бэкенд-флаг `isOrphan` (нет пути к `isPrimary`).
3. Цвет/форма по `type`+`status`, парные токены `bg-{color}+text-{color}-fg`, RAG-статус, `horizon`→размер.
4. Layout-калькулятор отдельным слоем (`src/domain/goal-graph-layout.ts`), мемоизация, dagre один раз (force каждый кадр дорог).
5. Мобильно: `fitView`+canvas; на телефоне — урезанный режим 1–2 уровня, тап вместо hover.
