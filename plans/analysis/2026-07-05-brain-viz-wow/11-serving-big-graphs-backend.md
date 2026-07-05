---
type: analysis
status: research-input
segment: serving
snapshot_date: 2026-07-05
---

# Контур 11. Отдача большого графа с бэкенда: кластеризация, предрасчёт layout, стриминг, дельты

Вопрос контура: как отдавать граф в тысячи–десятки тысяч узлов из NestJS+Postgres во фронтенд так, чтобы (а) браузер не умер, (б) вау-эффект («мозг растёт на глазах») сохранился. Разобраны: серверная кластеризация в супер-узлы (Louvain/Leiden), expand-on-demand (раскрытие по клику), предрасчёт layout (раскладки координат) на сервере, стриминг/чанкование, инкрементальные дельты, лимиты Postgres CTE. Все версии npm-пакетов сняты с registry 2026-07-05 через `npm view`.

Главная рамка масштаба: у Коры **тысячи узлов на организацию** (не миллионы). Это радикально упрощает задачу — почти все «тяжёлые» техники (GPU-стриминг, бинарные тайлы) не нужны, а предрасчёт на сервере занимает секунды, не часы.

## Карточки

### 1. graphology + graphology-communities-louvain — серверная кластеризация в супер-узлы

**Функционально простым языком.** Библиотека графов для JS/TS (используется sigma.js и Gephi Lite) + модуль Louvain: разбивает граф на «сообщества» — плотно связанные группы узлов. Каждое сообщество можно показать одним супер-узлом («пузырь» с числом внутри), раскрываемым по клику.

**Вау-приёмы.** Раскраска узлов по сообществу — самый дешёвый способ сделать граф «осмысленно красивым»: кластеры визуально разделяются ещё до всякого 3D. Параметр `resolution` — готовая крутилка «крупнее/мельче кластеры».

**Технически.**
- Версии: `graphology` **0.26.0** (публикация 2025-01-26), `graphology-communities-louvain` **2.0.2** (2024-12-17) [verified, npm registry 2026-07-05].
- Бенчмарки из официальной документации [verified]: граф **1 000 узлов / 9 724 рёбер → 52,7 мс** (8 сообществ, модулярность 0,429); граф **50 000 узлов / 994 713 рёбер → 937,9 мс** (43 сообщества, модулярность 0,481). Для сравнения на том же 1000-узловом графе: jlouvain — 2 368 мс, ngraph.louvain — 71,1 мс, ngraph.louvain.native — 39,2 мс. Железо бенчмарка в доке не указано [verified, с оговоркой].
- Время работы ограничено числом РЁБЕР, не узлов. Возвращает плоское разбиение (без иерархии уровней); гранулярность — через `resolution` [verified].
- Работает в чистом Node.js (нет зависимостей от DOM) [verified — зависимости только graphology-indices/utils, mnemonist, pandemonium].

Источник снippета: https://graphology.github.io/standard-library/communities-louvain.html [verified]

```ts
import louvain from 'graphology-communities-louvain';

const communities = louvain(graph);
louvain.assign(graph, { resolution: 0.8 });
const details = louvain.detailed(graph);
```

**Что берём для Коры.** Основной инструмент серверной кластеризации: на масштабе Коры (тысячи узлов, десятки тысяч рёбер) Louvain отработает за **десятки–сотни миллисекунд** — можно пересчитывать хоть на каждый ingest. Но важно: у Коры уже ЕСТЬ доменная иерархия (12 областей → темы → сущности → блоки) — Louvain нужен не для построения уровней, а для (а) раскраски «скрытых» сообществ поверх формальной иерархии, (б) выявления кластеров, не совпадающих с темами (само по себе продуктовый инсайт: «эти люди/проекты связаны сильнее, чем показывает оргструктура»).

**Источники.** https://graphology.github.io/standard-library/communities-louvain.html (доки+бенчмарк, [verified]); npm registry 2026-07-05 [verified]; https://github.com/graphology/graphology/tree/master/src/communities-louvain [verified].

### 2. Leiden в JS/TS: leiden-ts и @graphty/algorithms

**Функционально простым языком.** Leiden — улучшение Louvain (2019): гарантирует связность сообществ (Louvain может выдать «рваное» сообщество из несвязанных кусков) и поддерживает иерархию уровней.

**Вау-приёмы.** Иерархические уровни Leiden = готовые «уровни зума» для семантического зума (semantic zoom — когда при отдалении показываются агрегаты, при приближении — детали).

**Технически.**
- `leiden-ts` **0.1.0** (публикация 2026-04-26) [verified, npm]: чистый TypeScript, **ноль runtime-зависимостей**, 16 КБ ESM, MIT. Бенчмарк из README репозитория: LFR-10k (**10 000 узлов / 643 259 рёбер**) — **в 4,6 раза быстрее graspologic**, Q=0,4933 [claimed — цифры автора пакета, независимого подтверждения нет]. Заявлена иерархическая выдача мульти-уровневых партиций «как в leidenalg» [claimed]. Риск: версия 0.1.0, единственный релиз — незрелый пакет.
- `@graphty/algorithms` **1.7.1** (2026-01-09) [verified, npm]: `leiden(graph, { resolution: 1.0, iterations: 10, randomSeed })` → `{ communities: Map<NodeId, number>, modularity }` [verified — описание API из npm-выдачи]. Позиционируется «для браузерных сред», но чистый TS — в Node работает [inferred].
- `@aflsolutions/graphology-communities-leiden` — репак Leiden-ветки graphology; автор форка сообщает: на графах **>100k узлов / >500k рёбер — минуты на проход**, добавлен cap `maxIterations` [claimed — README форка].
- В основном монорепо graphology зрелого Leiden-пакета нет [triangulated(2) — поиск npm + обсуждения].

Источник сниппета: https://github.com/crodesrepos/leiden-ts [verified]

```ts
import { Graph, leiden } from 'leiden-ts';

const graph = Graph.fromEdgeList(34, [[0, 1], [0, 2], [0, 3]]);
const result = leiden(graph, { seed: 42, resolution: 1.0 });
```

**Что берём для Коры.** На старте Leiden НЕ нужен: доменная иерархия областей/тем уже даёт уровни, Louvain даёт раскраску. Leiden берём в бэклог на этап, когда захотим автоматические иерархические сообщества поверх сырого графа (паттерн GraphRAG, карточка 3) — и тогда сначала `leiden-ts` (zero-deps, TS), с фолбэком на собственную итерацию Louvain по конденсированному графу.

**Источники.** https://github.com/crodesrepos/leiden-ts [verified]; npm registry [verified]; https://www.npmjs.com/package/@graphty/algorithms [verified]; https://github.com/aflsolutions/graphology-communities-leiden [claimed].

### 3. Microsoft GraphRAG — образец иерархии уровней сообществ

**Функционально простым языком.** GraphRAG строит граф знаний из текстов и группирует сущности иерархическим Leiden: уровень 0 — крупные сообщества, глубже — мельче и плотнее. Ровно та же задача, что у Коры: «области → темы → сущности» из сырых текстов встреч.

**Вау-приёмы.** Навигация по уровням гранулярности: пользователь смотрит сверху 5–10 «континентов», проваливается в «страны» и «города». Каждому сообществу LLM пишет резюме — супер-узел не безликий кружок, а осмысленная карточка.

**Технически.** Иерархический Leiden применяется рекурсивно, «пока не достигнут порог размера сообщества»; уровни хранятся деревом (parent/child), число сообществ убывает с уровнем [verified — официальная документация dataflow + discussion #1128].

**Что берём для Коры.** Паттерн «супер-узел = сообщество с LLM-резюме»: у Коры темы уже имеют названия/описания — при свёртке темы в супер-узел показывать её резюме и счётчики (N сущностей, M фактов, последнее обновление такой-то встречей). Порог размера сообщества как критерий остановки drill-down — хорошее правило: не раскрывать уровень, если в нём < K узлов, а сразу показывать листья.

**Источники.** https://microsoft.github.io/graphrag/index/default_dataflow/ [verified]; https://github.com/microsoft/graphrag/discussions/1128 [verified].

### 4. graphology-layout + graphology-layout-forceatlas2 — предрасчёт координат на сервере

**Функционально простым языком.** ForceAtlas2 (FA2) — силовая раскладка из Gephi: считает x/y всех узлов так, чтобы связанные были рядом, кластеры — раздельно. Синхронная версия работает в чистом Node — можно считать на бэке и отдавать готовые координаты.

**Вау-приёмы.** Предрасчёт ≠ отказ от анимации: клиент получает финальные координаты, но АНИМИРУЕТ переход к ним (tween от случайных/предыдущих позиций) — «мозг собирается на глазах» за 1–2 секунды без единого тика физики в браузере.

**Технически.**
- Версии: `graphology-layout-forceatlas2` **0.10.1** (2024-11-08), `graphology-layout` **0.6.1** (2022-09-20) [verified, npm].
- Обязательное условие: у узлов должны быть НАЧАЛЬНЫЕ x/y (алгоритм падает, если все в (0,0)) — посев через `circular`/`random` из graphology-layout [verified, доки].
- `barnesHutOptimize: true` — аппроксимация отталкивания O(n·log n) вместо O(n²); порог включения в доке не задан числом [verified]. `inferSettings(graph)` автоматически подбирает настройки от размера графа [verified].
- Веб-worker-обёртка (`graphology-layout-forceatlas2/worker`) — только браузер; в Node вместо неё — BullMQ sandboxed-процесс (карточка 11) [verified + inferred].
- Опции фиксации узлов (pinning) в списке настроек НЕТ [verified — отсутствует в официальной таблице настроек]. Для дельт с закреплением старых узлов — ngraph (карточка 5) или трюк «мало итераций от старых позиций».
- Ориентир скорости: оригинальная статья FA2 (PLOS One 2014) на датасетах до 23 133 узлов давала средние времена в сотни мс на достижение 50%-качества [verified, но это Java/Gephi — на JS переносить осторожно, [inferred]]. Sigma.js-экосистема (та же реализация) по оценке конкурента «сдаёт» на layout свыше 50 000 рёбер [claimed — сравнительная страница Ogma о sigma.js].

Источник сниппетов: https://graphology.github.io/standard-library/layout.html и https://graphology.github.io/standard-library/layout-forceatlas2.html [verified]

```ts
import { circular } from 'graphology-layout';
import forceAtlas2 from 'graphology-layout-forceatlas2';

circular.assign(graph, { scale: 100 });
const settings = forceAtlas2.inferSettings(graph);
forceAtlas2.assign(graph, { iterations: 300, settings });
```

**Что берём для Коры.** Основной путь предрасчёта: graphology уже нужен для Louvain, FA2 из той же экосистемы, один граф-объект на оба шага. На тысячах узлов 300–500 итераций — секунды в фоне [inferred от бенчмарков FA2/Louvain]. Координаты сохраняем в снапшот и отдаём клиенту.

**Источники.** https://graphology.github.io/standard-library/layout-forceatlas2.html [verified]; https://graphology.github.io/standard-library/layout.html [verified]; https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679 [verified]; https://doc.linkurious.com/ogma/latest/compare/sigmajs.html [claimed].

### 5. ngraph.forcelayout + ngraph.offline.layout — pinning и бинарные позиции

**Функционально простым языком.** Экосистема Андрея Каширина (anvaka, автор визуализаций «вся npm-вселенная»). `ngraph.forcelayout` — силовая раскладка с ЯВНЫМ закреплением узлов; `ngraph.offline.layout` — утилита «посчитай layout большого графа офлайн и сохрани на диск».

**Вау-приёмы.** Именно этим стеком сделаны знаменитые вау-демо anvaka (карты npm/GitHub на сотни тысяч узлов): позиции считаются заранее, клиент только рендерит и летает камерой — плавность полёта не зависит от размера графа.

**Технически.**
- Версии: `ngraph.forcelayout` **3.3.1** (2022-10-04), `ngraph.graph` **20.1.2** (2026-02-14 — экосистема жива), `ngraph.offline.layout` **2.0.0** (2025-03-29) [verified, npm].
- `layout.pinNode(node, true)` — «layout не будет двигать этот узел»; `setNodePosition(id, x, y)`; итерации явным циклом `layout.step()`; quad-tree аппроксимация сил O(n·log n); 2D/3D/nD [verified, README].
- `ngraph.offline.layout`: default 500 итераций, чекпойнты каждые 5 итераций, результат — `.bin` файл **Int32 Little Endian, по 3 числа (x,y,z) на узел** в порядке обхода графа; авто-резюм с чекпойнта; пример в README генерит сетку 10 000×10 000 [verified, README]. BSD-3/MIT.

Источник сниппета: https://github.com/anvaka/ngraph.forcelayout [verified]

```ts
import createGraph from 'ngraph.graph';
import createLayout from 'ngraph.forcelayout';

const g = createGraph();
const layout = createLayout(g, { dimensions: 2 });
layout.setNodePosition(oldId, prev.x, prev.y);
layout.pinNode(g.getNode(oldId), true);
for (let i = 0; i < 60; i++) layout.step();
const pos = layout.getNodePosition(newId);
```

**Что берём для Коры.** Два применения: (а) **инкрементальная дельта** — единственный из рассмотренных JS-инструментов с честным pinning: старые узлы закрепляем, новые «прилипают» к соседям за 30–60 итераций; (б) идея **бинарного формата позиций** (Float32Array вместо JSON) — в бэклог на случай если org-графы вырастут до 50k+ узлов; на текущем масштабе JSON+gzip достаточно.

**Источники.** https://github.com/anvaka/ngraph.forcelayout [verified]; https://github.com/anvaka/ngraph.offline.layout [verified]; npm registry [verified].

### 6. Neo4j Bloom — expand-on-demand и потолок 10 000

**Функционально простым языком.** Bloom — визуальный исследователь графа от Neo4j. Никогда не грузит «весь граф»: пользователь ищет стартовые узлы, затем раскрывает соседей по клику. Даёт индустриальный ответ на вопрос «сколько узлов на экран — уже слишком».

**Вау-приёмы.** Расширение по правому клику с выбором ТИПА связи и направления («покажи только клиентов этого менеджера») — раскрытие как осмысленное действие, а не вываливание всего. GPU-ускоренные силовые layout для плотных сцен.

**Технически.**
- Лимит запроса узлов по умолчанию — **10 000, настраивается**; формулировка Neo4j: «10 000 узлов — обычная точка, после которой визуализация перестаёт быть эффективной», лимит защищает приложение от зависания [verified — доки + community-форум, triangulated(2)].
- Expand: соседи выбранного узла;选ективно по типу/направлению связи; лимит переопределяется в контекстном меню [verified, доки Scene interactions].
- Поиск кратчайшего пути ограничен **20 хопами** [verified].
- Для БД **>10 млн узлов+связей** Bloom при генерации перспективы предлагает «quick scan» — сэмплирование вместо полного скана [verified, доки].

**Что берём для Коры.** Два числа-ориентира в продукт: (1) **дефолтный потолок одного ответа графового эндпоинта — 5–10k узлов**, дальше — только агрегаты; (2) expand по клику должен уметь фильтр по типу связи (у Коры: «упоминается вместе», «участник», «решение из встречи») — это одновременно и практичная навигация, и защита от лавины. Паттерн «стартовая точка → раскрытие» — основной режим drill-down-навигации Коры; полный обзор — только на уровнях-агрегатах.

**Источники.** https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/bloom-scene-interactions/ [verified]; https://neo4j.com/docs/bloom-user-guide/current/bloom-tutorial/ [verified]; https://community.neo4j.com/t/bypass-10000-node-limit-in-bloom-neo4j-desktop/45670 [verified]; https://neo4j.com/product/bloom/ [claimed — маркетинговые формулировки].

### 7. Linkurious Ogma — visual grouping с асинхронным раскрытием

**Функционально простым языком.** Ogma — коммерческий JS-движок графов «для больших данных». Ключевая механика для нашего контура — «трансформации»: группировка узлов в супер-узлы налету, раскрытие/сворачивание двойным кликом, причём дети группы ПОДГРУЖАЮТСЯ С СЕРВЕРА в момент раскрытия.

**Вау-приёмы.** In-place expand/collapse с анимацией открытия группы: layout всей сцены НЕ пересчитывается, дети раскладываются рекурсивным layout ВНУТРИ раскрытой группы — сцена не «прыгает» (сохранение mental map — «ментальной карты», привычного расположения). Анимации открытия/закрытия групп из коробки.

**Технически.**
- Официальный пример «Visual grouping expand/collapse» (Ogma 6.0.x): двойной клик → асинхронный fetch детей → `addNodes()` → рекурсивный layout внутри группы для снятия перекрытий [verified — страница примера; полный код примера интерактивный, в статике не извлекается].
- В Ogma 5.2 layout сгруппированных сцен ускорен «в 5 раз» заменой вычислений на pattern matching [claimed — блог вендора].
- Закрытая лицензия, цен в открытом доступе нет — как библиотеку НЕ рассматриваем, только как образец UX-механики.

**Что берём для Коры.** Контракт раскрытия супер-узла: клиент шлёт `GET /graph/nodes/:id/expand`, сервер отдаёт детей С ПРЕДРАССЧИТАННЫМИ координатами в локальной системе родителя (offset от центра супер-узла), клиент вставляет их с анимацией «разлёта» из точки родителя. Держать раскрытие локальным (не перекладывать всю сцену) — главное правило анти-«прыжков».

**Источники.** https://doc.linkurious.com/ogma/latest/examples/visual-grouping-async-expand.html [verified]; https://linkurious.com/blog/ogma-5-2/ [claimed]; https://doc.linkurious.com/ogma/latest/ [verified].

### 8. Cambridge Intelligence (KeyLines/ReGraph) — «воронка данных» и progressive disclosure

**Функционально простым языком.** Вендор графовых SDK 15+ лет пишет методички «как показывать большие графы». Центральная идея: миллион узлов на экране — НЕ инсайт; ценность создаёт последовательное сужение.

**Вау-приёмы (методология).** «Воронка данных» из 5 шагов: фильтруй рано (на сервере) → агрегируй и перемоделируй (супер-узлы) → выбирай визуальную модель под вопрос пользователя → разгружай сцену фильтрами/группировкой → применяй layout для проявления паттернов. Progressive disclosure — «деталь по запросу» через зум/фильтр/клик, а не всё сразу [verified — их официальные гайды].

**Технически.** Прямая рекомендация: тяжёлые операции сопровождать progress-индикатором; GPU-рендеринг держит плавность на «плотных реальных данных» [claimed — про собственный SDK].

**Что берём для Коры.** «Воронку» кладём в основу API-дизайна: сервер отдаёт РОВНО тот уровень, который нужен текущему вопросу пользователя (обзор компании / область / тема / окрестность узла), а не «граф целиком, разберётесь на клиенте». Каждому экрану — свой эндпоинт-уровень.

**Источники.** https://cambridge-intelligence.com/visualize-large-networks/ [verified]; https://cambridge-intelligence.com/big-graph-data-visualization/ [verified].

### 9. Graphistry — server-GPU-стриминг как верхняя планка

**Функционально простым языком.** Graphistry считает layout и аналитику на СЕРВЕРНЫХ GPU и стримит результат в браузерный WebGL — «Netflix для графов». Показывает, где потолок подхода «сервер считает, клиент рендерит».

**Вау-приёмы.** Живой стриминг кадров/буферов «клиент↔облако» на ~20 fps при миллионах элементов; клиентский WebGL-движок рендерит **до 8 млн узлов+рёбер**, типичные старые клиентские GPU тянут **100k–2 млн элементов** [claimed — архитектурная документация и маркетинг вендора].

**Технически.** Микросервисы на GPU, обмен через Apache Arrow; Python-клиент pygraphistry [verified — admin-доки архитектуры]. Заявление «60×+ быстрее и больше данных, чем десктопный Gephi» [claimed].

**Что берём для Коры.** НЕ берём технологию (наш масштаб на 2–3 порядка меньше), берём принцип и планку: вся тяжесть — на сервере, клиенту — только готовые буферы; и подтверждение, что «десятки тысяч узлов» для предрассчитанного WebGL-рендера — комфортная зона даже слабых GPU.

**Источники.** https://graphistry-admin-docs.readthedocs.io/en/latest/planning/architecture.html [verified/claimed]; https://github.com/graphistry/pygraphistry [verified]; https://www.graphistry.com/gpu [claimed].

### 10. PostgreSQL: рекурсивные CTE, их потолок, materialized snapshot

**Функционально простым языком.** Рекурсивный CTE (Common Table Expression — «запрос, вызывающий сам себя») — штатный способ обходить граф связей в Postgres. Работает отлично на мелких обходах и катастрофически — на широких/глубоких.

**Технически.**
- Синтаксис с защитой от циклов: вручную (массив `path` + `= ANY(path)`) или встроенной клаузой **`CYCLE ... SET ... USING ...` (PostgreSQL 14+)** [verified — официальная документация].
- Потолок (кейс-исследование, май 2024, один источник): дерево **335 000 узлов, ветвление 6** — рекурсивный CTE **47 секунд**; причина — рекурсивный экзекьютор материализует ВСЕ промежуточные строки (на глубине 7 это 6⁷=279 936 строк с дублями), не умеет держать `visited` между итерациями. Тот же обход C-расширением с in-memory adjacency BFS — **227 мс (×207)**; кратчайший путь на цепочке 10k: 618 мс → 49 мс (×12); НО на мелких обходах (глубина 3) CTE и так даёт 12 мс [verified — статья с воспроизводимыми цифрами; независимой репликации нет, поэтому фактически triangulated(1)].
- Практическое правило из того же кейса: CTE ОК при глубине ≤5 и узком фронтире; избегать при экспоненциальном ветвлении и требовании sub-second [verified].

Источник сниппета: https://www.postgresql.org/docs/current/queries-with.html [verified]

```sql
WITH RECURSIVE walk(id, depth) AS (
    SELECT el."toEntityId", 1
    FROM "EntityLink" el WHERE el."fromEntityId" = $1
  UNION ALL
    SELECT el."toEntityId", w.depth + 1
    FROM "EntityLink" el JOIN walk w ON el."fromEntityId" = w.id
    WHERE w.depth < 3
) CYCLE id SET is_cycle USING path
SELECT DISTINCT id FROM walk WHERE NOT is_cycle;
```

**Что берём для Коры.** Жёсткое разделение: (а) **рантайм-обходы CTE — только локальные** («почему этот узел здесь»: узел → блоки-факты → evidence → встреча; глубина ≤3, фронтир — десятки строк — это зона, где CTE быстр); (б) **полный граф организации НИКОГДА не собирается CTE на запрос** — вместо этого два плоских `SELECT` (узлы + рёбра по `orgId`, у Коры это тысячи строк) → сборка graphology-графа в Node → **материализованный снапшот** (таблица `GraphSnapshot` с JSONB payload + версия), пересобираемый BullMQ-джобой. Materialized view Postgres не нужен — снапшот-таблица под контролем джобы проще (инвалидация по версии, дельты).

**Источники.** https://www.postgresql.org/docs/current/queries-with.html [verified]; https://dev.to/ineron/your-postgresql-already-has-a-graph-engine-you-just-have-to-build-it-2ng7 (2024-05-06) [verified, один источник].

### 11. BullMQ sandboxed processors — предрасчёт в фоне в стеке Коры

**Функционально простым языком.** Louvain+FA2 — CPU-bound секунды; в Node это заблокирует event loop HTTP-процесса. BullMQ (уже в стеке Коры) умеет выносить обработчик джобы в отдельный процесс/поток («песочница»).

**Технически.**
- Sandboxed processor = файл-обработчик, запускаемый в child process (по умолчанию) или worker thread (`useWorkerThreads: true`, доступно с BullMQ v3.13.0); падение процессора не роняет воркер; CPU-тяжёлый код не приводит к stalled-джобам [verified — официальные доки BullMQ].
- Рекомендация самих доков: «если воркеры очень CPU-интенсивны — используйте sandboxed» [verified].

Источник сниппета: https://docs.bullmq.io/guide/workers/sandboxed-processors [verified]

```ts
import { Worker } from 'bullmq';
import path from 'path';

const processorFile = path.join(__dirname, 'graph-snapshot.processor.js');
const worker = new Worker('graph-snapshot', processorFile, { useWorkerThreads: true });
```

**Что берём для Коры.** У Коры воркеры in-process в NestJS (`WorkersModule`); для graph-snapshot-джобы это первый кандидат на sandboxed-вынос: 1–3 секунды чистого CPU на организацию при пересчёте. На текущем масштабе допустим и обычный (не-sandboxed) обработчик — секундная блокировка внутри BullMQ-воркера не смертельна, но sandboxed — правильная страховка при росте org-графов.

**Источники.** https://docs.bullmq.io/guide/workers/sandboxed-processors [verified]; https://docs.bullmq.io/guide/workers/concurrency [verified].

### 12. react-force-graph-2d — принимающая сторона: fx/fy и cooldownTicks=0

**Функционально простым языком.** Библиотека, уже стоящая в репо Коры. Ключ контура: она умеет принять ГОТОВЫЕ координаты и не гонять физику вовсе — тогда серверный предрасчёт доезжает до экрана без клиентских тормозов.

**Технически.**
- Версия: `react-force-graph-2d` **1.29.1** (2026-02-04) [verified, npm].
- Пропсы: `warmupTicks` (default 0 — тики движка ДО первого рендера), `cooldownTicks` (default Infinity — сколько кадров крутить физику), `cooldownTime` (default 15 000 мс); фиксация узла — поля `fx/fy/fz` в данных узла [verified — README].
- Комбинация для предрассчитанного графа: узлам задать `fx/fy` из снапшота + `cooldownTicks={0}` — движок заморожен, рендер мгновенный [verified — README-пропсы; сама комбинация — общепринятый рецепт из issues, triangulated(2)].
- Лимиты из issues (2020 г., 3D-вариант): «производительность значимо падает после ~7k элементов» (5k узлов + 7k рёбер, issue #223); 117 927 узлов / 117 921 рёбер — WebGL out of memory (issue #202) [verified — issues; давность 5+ лет, современное железо мягче, но порядок величины актуален [inferred]].
- Next.js 16 App Router / React 19: библиотека обращается к window/canvas → компонент строго `"use client"` + `next/dynamic` с `ssr: false` [inferred — браузерная природа библиотеки; прямых доков по Next 16 нет].

**Что берём для Коры.** Контракт отдачи: снапшот-эндпоинт возвращает узлы уже с `x,y` → фронт мапит в `fx,fy` (замороженный режим для обзорных уровней) ЛИБО в стартовые `x,y` без фиксации + `cooldownTicks={60}` (короткое «оживание» — вау-дрожание при загрузке, без полной пересборки).

**Источники.** https://github.com/vasturiano/react-force-graph [verified]; https://github.com/vasturiano/react-force-graph/issues/223 [verified]; https://github.com/vasturiano/react-force-graph/issues/202 [verified]; npm registry [verified].

## Эскизы кода для Коры (маппинг на NestJS + Prisma + Redis + BullMQ)

Имена моделей — реальные из `backend/prisma/schema.prisma` (Entity, EntityLink, IdeaBlock, Theme…); имена ПОЛЕЙ в эскизах — приблизительные, сверить со схемой при реализации.

### Модель снапшота (Prisma, новая таблица)

```prisma
model GraphSnapshot {
  id        String   @id @default(cuid())
  orgId     String
  level     Int
  version   Int
  payload   Json
  nodeCount Int
  edgeCount Int
  builtAt   DateTime @default(now())

  @@unique([orgId, level, version])
  @@index([orgId, level])
}
```

### BullMQ-джоба предрасчёта кластеров + layout (sandboxed processor)

Паттерны собраны из: https://docs.bullmq.io/guide/workers/sandboxed-processors + https://graphology.github.io/standard-library/communities-louvain.html + https://graphology.github.io/standard-library/layout.html + https://graphology.github.io/standard-library/layout-forceatlas2.html + https://graphology.github.io/serialization.html

```ts
import { SandboxedJob } from 'bullmq';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { circular } from 'graphology-layout';
import forceAtlas2 from 'graphology-layout-forceatlas2';

module.exports = async (job: SandboxedJob<{ orgId: string }>) => {
  const { orgId } = job.data;
  const prisma = createPrismaClient();
  const redis = createRedis();

  const [entities, links] = await Promise.all([
    prisma.entity.findMany({ where: { orgId }, select: { id: true, name: true, kind: true } }),
    prisma.entityLink.findMany({ where: { orgId }, select: { fromEntityId: true, toEntityId: true, weight: true } }),
  ]);

  const graph = new Graph({ type: 'undirected', multi: false });
  for (const e of entities) graph.addNode(e.id, { label: e.name, kind: e.kind, size: 1 });
  for (const l of links) {
    if (graph.hasNode(l.fromEntityId) && graph.hasNode(l.toEntityId) && !graph.hasEdge(l.fromEntityId, l.toEntityId)) {
      graph.addEdge(l.fromEntityId, l.toEntityId, { weight: l.weight ?? 1 });
    }
  }

  louvain.assign(graph, { resolution: 1 });
  circular.assign(graph, { scale: 100 });
  const settings = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, {
    iterations: 400,
    settings: { ...settings, barnesHutOptimize: graph.order > 2000 },
  });

  const payload = graph.export();
  const version = await nextVersion(prisma, orgId, 2);
  await prisma.graphSnapshot.create({
    data: { orgId, level: 2, version, payload, nodeCount: graph.order, edgeCount: graph.size },
  });
  await redis.set(`graph:snap:${orgId}:2`, JSON.stringify({ version, payload }), 'EX', 7 * 86400);
  return { version, nodes: graph.order, edges: graph.size };
};
```

Триггеры постановки джобы: завершение knowledge-ingest встречи (debounce 5–10 минут через BullMQ delayed + jobId-дедупликация) + ночной cron полного ребилда. Крутилки (итерации, debounce, потолок узлов) — в AdminSetting по правилу №9 CLAUDE.md.

### Эндпоинт с уровнями детализации (NestJS)

Уровни из доменной иерархии Коры (не из Louvain): `0` — 12 областей (супер-узлы со счётчиками), `1` — темы, `2` — сущности с Louvain-раскраской, expand — окрестность узла.

```ts
@Controller('orgs/:orgId/graph')
@UseGuards(TenantGuard)
export class GraphServeController {
  @Get('snapshot')
  async snapshot(
    @Param('orgId') orgId: string,
    @Query() q: GraphSnapshotQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cached = await this.redis.get(`graph:snap:${orgId}:${q.level}`);
    const snap = cached ? JSON.parse(cached) : await this.service.loadFromDb(orgId, q.level);
    res.setHeader('ETag', `"g${q.level}-v${snap.version}"`);
    if (q.sinceVersion !== undefined && q.sinceVersion < snap.version) {
      return this.service.buildDelta(orgId, q.level, q.sinceVersion, snap.version);
    }
    return snap;
  }

  @Get('nodes/:nodeId/expand')
  async expand(
    @Param('orgId') orgId: string,
    @Param('nodeId') nodeId: string,
    @Query() q: GraphExpandQueryDto,
  ) {
    return this.service.neighbors(orgId, nodeId, {
      limit: Math.min(q.limit ?? 50, 200),
      cursor: q.cursor,
      linkKinds: q.linkKinds,
    });
  }
}
```

Правила отдачи (ориентиры из карточек 6 и 8): один ответ ≤ 5 000 узлов; expand с cursor-пагинацией рёбер (limit 50–200) и фильтром типа связи; gzip уже включается стандартным compression-middleware; ETag → 304 при повторном заходе.

### Инкрементальная дельта после новой встречи (pinning через ngraph)

Источник паттерна pinning: https://github.com/anvaka/ngraph.forcelayout ; обоснование сохранения mental map: https://vis.cs.ucdavis.edu/papers/tarik_incremental.pdf

```ts
import createGraph from 'ngraph.graph';
import createLayout from 'ngraph.forcelayout';

function placeDelta(oldNodes: PositionedNode[], added: DeltaNode[], addedLinks: DeltaLink[]) {
  const g = createGraph();
  for (const n of oldNodes) g.addNode(n.id);
  for (const n of added) g.addNode(n.id);
  for (const l of [...existingLinks(oldNodes), ...addedLinks]) g.addLink(l.from, l.to);

  const layout = createLayout(g, { dimensions: 2 });
  for (const n of oldNodes) {
    layout.setNodePosition(n.id, n.x, n.y);
    layout.pinNode(g.getNode(n.id)!, true);
  }
  for (const n of added) {
    const c = centroidOfKnownNeighbors(n, oldNodes, addedLinks);
    layout.setNodePosition(n.id, c.x + jitter(), c.y + jitter());
  }
  for (let i = 0; i < 60; i++) layout.step();

  return added.map((n) => ({ id: n.id, ...layout.getNodePosition(n.id) }));
}
```

Ответ дельты клиенту: `{ fromVersion, toVersion, addedNodes: [{id,x,y,community,…}], addedLinks, removedNodeIds }` — фронт анимирует «прорастание» новых узлов из центроида соседей. Это и есть механика «мозг растёт на глазах» после каждой встречи, без пересборки сцены. Полный FA2-ребилд — только ночью (дрейф позиций накапливается, раз в сутки сцена «оседает» заново; версия снапшота меняется, клиент перезагружает целиком).

### Оценка размера ответа [inferred]

Узел `{id(cuid 25), label≤40, kind, x, y, community, size}` ≈ 130–180 байт JSON; ребро ≈ 60–90 байт. Граф 5 000 узлов + 15 000 рёбер ≈ 1,7–2,5 МБ raw ≈ 300–600 КБ gzip — комфортно для одного запроса. 50k узлов — уже 15–25 МБ raw: на таком масштабе переходить на уровни/expand строго и рассматривать бинарные позиции (Float32Array, паттерн ngraph.offline.layout).

## Сводка: топ-выводы контура

1. **Масштаб Коры — «лёгкий» по меркам индустрии.** Тысячи узлов на организацию — это зона, где серверный предрасчёт (Louvain ~50 мс на 1k узлов, ~940 мс на 50k узлов/1M рёбер; FA2 — секунды) выполняется на каждый ingest без GPU и внешних сервисов [verified — бенчмарки graphology].
2. **Схема «сервер считает — клиент рендерит» — консенсус всех разобранных систем** (Bloom, Ogma, Graphistry, anvaka-стек): физика на клиенте при тысячах узлов — главный убийца и fps, и батареи; координаты и сообщества должны приезжать готовыми [triangulated(4)].
3. **Уровни детализации строить из доменной иерархии Коры, а не из алгоритма.** Область→Тема→Сущность→Факт — уже готовые LOD-уровни с осмысленными названиями (то, что GraphRAG вынужден синтезировать Leiden'ом+LLM, у Коры есть бесплатно). Louvain — только раскраска и «скрытые сообщества» поверх [verified паттерн GraphRAG + inferred маппинг].
4. **Потолок одного ответа — 5–10k узлов** (дефолт Bloom 10 000 «как точка, где визуализация перестаёт работать»; react-force-graph деградирует с ~7k элементов в 3D) — всё, что больше, отдавать агрегатами и expand-on-demand с cursor-пагинацией и фильтром по типу связи [triangulated(2)].
5. **Рекурсивные CTE в Postgres — только для локального drill-down** (глубина ≤3, «почему узел здесь → из какой встречи»); полный граф собирать двумя плоскими SELECT + материализованный снапшот в таблице `GraphSnapshot` (JSONB) + Redis-кэш. Кейс 335k-узлов: CTE 47 с против BFS 227 мс — не наш рантайм-путь [verified, один источник].
6. **Инкрементальные дельты — ключ к вау «мозг растёт».** После встречи не пересчитывать всё: ngraph.forcelayout с `pinNode` старых узлов + посев новых у центроида соседей (30–60 итераций, миллисекунды) → клиенту только `addedNodes/addedLinks` с координатами; полный ребилд — ночным cron. Сохранение mental map подтверждено исследованиями инкрементального layout [verified paper + verified API].
7. **Стек реализации целиком в экосистеме Коры:** graphology 0.26.0 + louvain 2.0.2 + FA2 0.10.1 (предрасчёт, sandboxed BullMQ-процессор c `useWorkerThreads`), ngraph.forcelayout 3.3.1 (дельты с pinning), react-force-graph-2d 1.29.1 (`fx/fy` + `cooldownTicks=0`, `"use client"` + dynamic ssr:false). Python/Rust/GPU не требуются [verified версии].
8. **Leiden — в бэклог, не в MVP:** зрелого JS-Leiden нет (leiden-ts 0.1.0 свежий и одинокий, форки graphology-Leiden сообщают минуты на 100k+ узлов); Louvain закрывает задачу раскраски на нашем масштабе [triangulated(2)].

## Ограничения контура (что не удалось проверить)

- **Железо бенчмарков graphology не документировано** — абсолютные мс (52,7/937,9) переносимы на прод-сервер Коры лишь по порядку величины; нужен собственный микробенчмарк на реальном org-графе.
- **Бенчмарк leiden-ts «4,6× быстрее graspologic»** — только README автора (v0.1.0, один релиз), независимой репликации нет [claimed].
- **Кейс «CTE 47 с vs 227 мс»** — одна статья (dev.to, 2024-05); цифры внутренне согласованы и объяснены механикой экзекьютора, но не реплицированы третьей стороной.
- **Цифры Graphistry (8 млн элементов, ~20 fps стриминг)** — маркетинг и админ-доки вендора, без внешнего бенчмарка [claimed].
- **Код примера Ogma async-expand** извлечь не удалось (интерактивная страница) — контракт восстановлен по описанию и changelog [verified описание / inferred детали].
- **Совместимость react-force-graph-2d 1.29.1 именно с React 19 + Next.js 16** формально в README не заявлена — необходимость `"use client"` + `dynamic(ssr:false)` выведена из браузерной природы библиотеки [inferred]; проверяется пятиминутным смоуком в репо (пакет уже установлен).
- **Точные лимиты производительности на современном железе 2026** для react-force-graph — issues с числами датированы 2020 годом; актуальный порог (вероятно выше 7k) требует собственного замера.
- Формат `payload JSONB` против отдельных колонок-массивов (позиции Float32 в bytea) на графах >50k узлов — не сравнивался на практике, отложено до реального роста.
