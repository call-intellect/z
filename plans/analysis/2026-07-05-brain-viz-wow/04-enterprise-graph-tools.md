---
type: analysis
status: research-input
segment: enterprise
snapshot_date: 2026-07-05
---

# Enterprise-инструменты графовой визуализации: за что платят деньги

Контур: Neo4j Bloom / NVL / NeoDash, Linkurious (Ogma), Cambridge Intelligence (KeyLines / ReGraph), Graphistry, GraphXR, yFiles, Memgraph Lab (+Orb), Gephi Lite, бонус — cosmos.gl.
Цель: каталог приёмов, которые рынок считает «премиальными», чтобы воспроизвести их открытым стеком для Коры (Next.js 16 + React 19 + Tailwind 4, в репо уже есть react-force-graph-2d; масштаб — тысячи узлов на организацию).

Все URL проверены 2026-07-05. Теги достоверности: [verified] — первоисточник (доки/репо/официальная демка), [triangulated(N)] — N источников разной природы, [claimed] — маркетинг вендора о себе, [inferred] — косвенный вывод, [unverified] — не подтверждено первоисточником (для цен из сторонних каталогов источник указан рядом).

---

## Карточки

### 1. Neo4j Bloom (в Aura переименован в «Explore»)

**Функционально простым языком.** Готовое приложение «исследователь графа» для бизнес-пользователя поверх Neo4j: ищешь почти естественным языком, видишь сцену (scene — текущий кусок графа на экране), раскрываешь соседей, сохраняешь и делишься сценами. Ключевая идея — Perspective (перспектива): бизнес-взгляд на один и тот же граф под конкретный отдел — какие категории узлов видны, какими цветами/иконками/подписями рисуются, какие сохранённые запросы доступны. [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-perspectives/bloom-perspectives/

**Вау-приёмы (за что хвалят/платят).**
- **Search phrases (поисковые фразы)** — почти-естественный язык: фраза «Customers from $country ordering $category» — это сохранённый Cypher-запрос с параметрами; Bloom матчит любую часть фразы без регистра, параметры имеют типы (string/int/float/bool/Date/Time/DateTime), подсказки следующего параметра фильтруются значением предыдущего (chaining). [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-tutorial/search-phrases-advanced/
- **Scene actions (действия на сцене)** — параметризованный Cypher из контекстного меню над ВЫДЕЛЕННЫМИ узлами (`WHERE elementId(n) IN $nodes`): «показать снятые с производства товары этих поставщиков». READ или WRITE (WRITE — только с разрешением). [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-tutorial/scene-actions/
- **GDS-интеграция** — кнопкой запускаются алгоритмы Graph Data Science: центральности (Betweenness, Degree, Eigenvector, PageRank) и сообщества (Louvain, Label Propagation, WCC); результат сразу визуализируется rule-based-стилями: размер/градиент цвета по центральности, уникальный цвет на сообщество. [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-tutorial/gds-integration/
- **Deep links (глубокие ссылки)** — URL с контекстом поиска; при `run=true` Bloom сам выполняет первый вариант запроса — граф-сцена как «ссылабельный» артефакт. [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-tutorial/deep-links/
- **Presentation mode** — сцена во весь экран без поисковой строки и панелей + экспорт визуализации для отчётов. [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-visual-tour/

**Технически.**
- Рендер: «high performance, GPU-powered physics and rendering» (WebGL явно не назван в About-странице). [verified] — https://neo4j.com/docs/bloom-user-guide/current/about-bloom/
- Потолок визуализации: **10 000 записей на сцену** (рекомендация — возвращать пути, а не отдельные связи). [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-tutorial/search-phrases-advanced/
- Авто-генерация перспективы замедляется при **>10 000 000 узлов+связей** в БД (предлагается quick scan). [verified] — https://neo4j.com/docs/bloom-user-guide/current/bloom-perspectives/bloom-perspectives/
- Лицензия: бесплатно в Aura («Explore») и Neo4j Desktop; Enterprise-вариант (server plugin) добавляет хранение перспектив в БД, шаринг и авторизацию. [verified] — https://neo4j.com/docs/bloom-user-guide/current/about-bloom/

**Что берём для Коры.**
- Perspectives → «взгляды» на мозг компании: область/роль (продажи видят клиентов-сделки, продукт — фичи-решения). У Коры уже есть 12 областей — перспектива = сохранённый пресет фильтра+стиля.
- Search phrases → у Коры уже есть AI-чат: инвертируем приём — ответ чата содержит deep link, открывающий граф-сцену с подсветкой узлов-источников. Это прямой ответ на требование «почему это здесь, из какой встречи».
- Scene actions → контекстное меню узла: «показать встречи-источники», «показать соседние решения», «кто говорил об этом».
- Потолок 10k записей на сцену — подтверждение, что «сцена = подмножество» является нормой enterprise-UX: не рисовать весь граф, а начинать с обзора и раскрывать.

**Источники:** перечислены построчно выше; все — официальные доки Neo4j, обращение 2026-07-05.

---

### 2. Neo4j NVL (Neo4j Visualization Library)

**Функционально.** Библиотека (npm `@neo4j-nvl/base`, TypeScript), из которой собраны сами Bloom/Explore — то есть Neo4j продаёт UX, а «кирпичи» отдаёт бесплатно. React-обёртки есть. [verified] — https://neo4j.com/docs/nvl/current/ , https://www.npmjs.com/package/@neo4j-nvl/base

**Вау-приёмы.** Двухрежимный рендер как продуктовая фича: Canvas — «красивый» режим для малых графов, WebGL — «быстрый» для больших, переключение динамически по мере роста данных.

**Технически.**
- Canvas-рендер — для графов **до ~1 000 узлов** (подписи и стрелки рисуются только в canvas-режиме); WebGL-рендер — GPU, **100 000+ узлов**, жертвует деталями ради скорости. [verified] — README `@neo4j-nvl/base` (npm) + https://neo4j.com/docs/nvl/current/base-library/
- Опции: layout, лимиты zoom/pan, выбор рендерера, minimap-контейнер; готовые interaction handlers; `getHits()` для попаданий указателя. [verified] — https://neo4j.com/docs/nvl/current/base-library/

**Что берём для Коры.** Сам паттерн «двухдвижковости»: обзор всего мозга — дешёвый GPU-режим без подписей; при приближении — переключение на детальный рендер с подписями/иконками. На нашем стеке это пара react-force-graph-3d (обзор, three.js) ↔ 2D-детальная сцена, или LOD внутри одного canvas.

**Источники:** https://neo4j.com/docs/nvl/current/ [verified]; https://www.npmjs.com/package/@neo4j-nvl/base [verified].

---

### 3. NeoDash

**Функционально.** Open-source low-code конструктор дашбордов над Neo4j: таблицы, графы, bar/line, карты, sankey, choropleth; интерактивность через «Parameter Select»-карточки, подставляющие значения в Cypher. [verified] — https://github.com/neo4j-labs/neodash , https://neo4j.com/labs/neodash/

**Статус (важно).** Проект **больше не поддерживается** — Neo4j рекомендует «Dashboards in the Neo4j Console». [verified] — https://github.com/neo4j-labs/neodash (README, обращение 2026-07-05).

**Что берём для Коры.** Немного: подтверждение спроса на «граф + обычные чарты в одном экране» (пульс компании = не только граф). Отдельный вывод: даже у Neo4j дашборды мигрировали в managed-продукт — рынок платит за сопровождаемость, не за виджеты.

---

### 4. Linkurious Ogma (SDK) + Linkurious Enterprise (приложение)

**Функционально.** Ogma — коммерческая JS-библиотека «всё в одном» для больших интерактивных графов: рендер, лейауты, геораскладка, группировки, аннотации. Linkurious Enterprise — готовое расследовательское приложение на её базе (фрод/AML — антиотмывание денег). [verified] — https://linkurious.com/ogma/

**Вау-приёмы.**
- **Transformations (трансформации)** — декларативные node/edge grouping: агрегация узлов в мета-узлы = LOD (level of detail — уровень детализации) как API первого класса. [verified] — https://doc.linkurious.com/ogma/latest/compare/sigmajs.html
- **Geo-mode** — тот же граф поверх карты одним переключением.
- **Annotation layers** — слои стрелок/текста поверх графа для рассказа истории.
- Timeline, lasso-выделение, мобильные жесты. [verified] — там же.

**Технически.**
- Рендер: WebGL-first, автоматический fallback (запасной вариант) на Canvas; SVG поддерживается. [verified] — https://doc.linkurious.com/ogma/latest/compare/sigmajs.html
- Заявленный масштаб: «display more than **100 000 nodes and 100 000 edges**» [claimed] — https://linkurious.com/blog/ogma-js-library-large-scale-graph-visualization/ ; «**10 000 узлов за 1 секунду**», «layouts до **40x быстрее** других решений» [claimed] — https://linkurious.com/ogma/ ; force-layout «**>1 000 000 рёбер** на новом железе за секунды» [claimed] — compare-страница.
- Для сравнения там же про sigma.js (наш open-source сосед): «задыхается на 5k узлов с иконками», force-layout деградирует после 50k рёбер [claimed — вендор о конкуренте, относиться осторожно].
- Лейауты: force, hierarchical, circular, sequential, circle-packing, radial, grid, concentric. [verified] — compare-страница.
- Официальный Performance Workbench: пресеты 50/500/3000 узлов, FPS-метр (60 — идеал, 30–60 — норм), замер времени лейаута. [verified] — https://doc.linkurious.com/ogma/3.0/examples/performance.html
- Цены: Ogma — «contact vendor», 30-дневный триал [verified] — https://www.capterra.com/p/10011703/Ogma/ ; Linkurious Enterprise Watchtower — от **$25 000/год** [unverified, вторичный: softwareadvice.com] при противоречащей записи «от $990/год» [unverified, вторичный: sourceforge.net] — вероятно разные тарифы/продукты.

**Что берём для Коры.**
- Grouping/transformations — центральный практичный приём: область → мета-узел, клик — раскрытие тем, ещё клик — сущности и блоки. Ровно наш drill-down (пошаговое углубление) по иерархии 12 областей.
- Мысль «LOD — это API, а не хак»: держать агрегацию в данных (бэкенд отдаёт уровни), а не в рендере.
- FPS-воркбенч — скопировать как внутренний бенчмарк: наш стенд с 1k/5k/20k синтетических узлов и FPS-метром до выбора либы.

---

### 5. Cambridge Intelligence: KeyLines (JS) / ReGraph (React)

**Функционально.** Два SDK одного вендора: KeyLines — ванильный JS, ReGraph — «родной» React (два компонента: chart + timebar, декларативный data-driven API). Аудитория — расследования: кибербезопасность, фрод, разведка. [verified] — https://cambridge-intelligence.com/regraph/

**Вау-приёмы.**
- **Combos** — фирменная группировка узлов в «комбо-узлы» с анимированным раскрытием: главный инструмент борьбы с визуальной кашей + drill-down. [verified] — https://cambridge-intelligence.com/regraph/features/
- **Time bar** — отдельный компонент-гистограмма времени, фильтрующий граф периодом; связка «граф + время» продаётся как ключевая. [verified] — там же.
- **Graph engine на клиенте** — центральности и обходы (traversal) прямо в браузере, результат — в стили (размер/цвет/фильтр). [verified] — там же.
- Annotations для совместной работы, экспорт PNG/JPEG/SVG/PDF. [verified] — там же.
- Свежие релизы: KeyLines 8.2/8.3 — «animated flow» (анимированное течение по связям — движущиеся штрихи, показывающие направление), богатые стили подписей связей, Figma Design Kit; ReGraph 5.2/5.3 — плавнее анимации combo. [verified] — https://cambridge-intelligence.com/product-update-may-2025/
- Позиционирование ReGraph: «более полированный визуальный опыт», умные combo-лейауты. [claimed] — https://cambridge-intelligence.com/regraph/

**Технически.**
- Рендер: WebGL + fallback на HTML5 Canvas. [verified] — https://cambridge-intelligence.com/regraph/features/
- Публичных ЧИСЕЛ производительности нет — на features-странице только «state of the art force directed layout to manage even the largest of datasets». [verified: отсутствие чисел; формулировка — claimed]
- Цены не публикуются; лицензия per-application, подписочная. [verified] — https://cambridge-intelligence.com/pricing/ ; ориентир от **$4 500/год за одного разработчика** [unverified, вторичный: itqlick.com, май 2023].

**Что берём для Коры.**
- Combos с анимированным раскрытием — эталон UX drill-down: не «перерисовали граф», а «узел раскрылся на глазах» (сохранение ментальной карты). Воспроизводимо на нашем стеке: мета-узлы + анимация позиций (d3-force reheat + tween).
- Timebar — идеальный ход для «мозг растёт на глазах»: слайдер по неделям, узлы появляются по мере встреч. Гистограмма количества новых блоков по времени = сам по себе индикатор наполненности.
- «Animated flow» по рёбрам — дешёвый вау-эффект (в three.js/шейдере — бегущие частицы по линку; в react-force-graph есть particles на линках из коробки).

---

### 6. Graphistry

**Функционально.** GPU-платформа «загрузи датасет — получи интерактивный граф»: сервер считает лейаут/аналитику на GPU (RAPIDS — NVIDIA-стек GPU-датафреймов), браузер рисует WebGL-ем. PyGraphistry — питон-обвязка; продаётся аналитикам, не разработчикам UI. [verified] — https://github.com/graphistry/pygraphistry

**Вау-приёмы.**
- Масштаб как шоу: пример «**50 000 узлов и 500 000+ рёбер**» в браузере [claimed] — https://www.graphistry.com/gpu ; «T4 GPU обрабатывает **>100 млн рёбер**, H100 — миллиарды, время выполнения — секунды» (про GPU-аналитику, не про рендер) [claimed] — README pygraphistry; «RAPIDS-режим даёт **100X+** ускорение» [claimed] — https://pypi.org/project/graphistry/
- Встроенные point-and-click инструменты: drilldowns, **timebar**, фильтры, гистограммы по атрибутам. [claimed] — README pygraphistry.
- GFQL и MCP-интеграция (graphistry-mcp) — граф-аналитика для LLM-агентов. [verified: репо существует] — https://github.com/graphistry/graphistry-mcp

**Технически.**
- Архитектура: серверный GPU (докер/облако) + клиентский GPU-рендер «в любом стандартном браузере». [verified] — https://www.graphistry.com/gpu
- Цены: Hub Free — **$0/мес** (публичные unlisted-визуализации); Hub Pro — по подписке, «~5% стоимости самого дешёвого выделенного enterprise-сервера» [claimed] — https://www.graphistry.com/blog/gpu-graph-intelligence-for-everyone-with-graphistry-hub-pro ; AWS Marketplace: подписка на AMI бесплатна, платишь за GPU-инстанс [verified] — https://aws.amazon.com/marketplace/pp/prodview-ppbjy2nny7xzk

**Что берём для Коры.**
- Урок архитектуры: при их масштабах лейаут уезжает на сервер. Для тысяч узлов Коры это НЕ нужно — но предвычисление лейаута на бэке (NestJS-воркер считает позиции ночью, фронт получает x/y/z) — тот же приём в миниатюре, убирает «прыгающий» старт force-layout и ускоряет первую отрисовку до мгновенной.
- Гистограммы атрибутов рядом с графом (сколько блоков по областям/типам) — их стандартный инструмент «где густо, где пусто».

---

### 7. GraphXR (Kineviz)

**Функционально.** Браузерное 3D-«рабочее пространство» для исследования графов: единственный в контуре, у кого 3D — базовый режим, а не опция. Импорт из Neo4j/Memgraph/SQL/CSV/JSON, аналитика (пути, центральности, сообщества), гео и время, совместные проекты. [verified] — https://helpcenter.kineviz.com/user-guides/v3/g-user/intro-overview.html

**Вау-приёмы.**
- Сама подача «граф = 3D-пространство, в котором летаешь» — их главный продукт; плюс **VR-режим (beta) через WebXR в Chrome**. [verified] — https://www.kineviz.com/graphxr (упоминание VR/WebXR)
- **Parametric layout** — раскладка узлов по осям из значений свойств (время → X, категория → Y, метрика → Z): граф превращается в 3D-scatter (диаграмму рассеяния) и обратно — переход между «графом» и «графиком» одной анимацией. [verified: наличие Parametric/Geometric/World Map layout] — https://helpcenter.kineviz.com/user-guides/v3/g-user/intro-overview.html
- Стилизация: цвет/иконка/подпись, размер узла от значения свойства, портретные изображения в узлах. [verified] — там же.

**Технически.**
- Работает в Chrome (Win/Mac/Linux); числовых лимитов узлов в доках нет. [verified: отсутствие чисел]
- Цены: подписка **$5 000–15 000/мес** [unverified, вторичный: alternativeto.net, снимок февраля 2024]; долгосрочные ключи — через контакт с вендором.

**Что берём для Коры.**
- Прямое доказательство: за 3D-полёт по графу компании платят тысячи долларов в месяц — наш «вау-слой» имеет рыночный прецедент.
- Parametric layout — сильная идея для Коры: одна кнопка перестраивает мозг из «органического шара» в «оси»: время встреч по X, области по Y — и обратно. Анимированный переход между лейаутами = дешёвый вау.
- VR оставить за скобками MVP (у них — beta в одном браузере).

---

### 8. yFiles (yWorks)

**Функционально.** Самый «инженерный» SDK контура: 30+ лет, любые диаграммы (не только force-графы), огромный API, десятки лейаутов. Ценится за автоматические раскладки качества «как рисовал человек». [verified] — https://www.yfiles.com/the-yfiles-sdk

**Вау-приёмы.**
- **Гибридный рендер по зуму**: WebGL — когда далеко (много мелких элементов), при приближении выше порога — переключение на SVG с идеальной типографикой; стили обоих рендеров создаются из одних данных, переход бесшовный. Официальная демка с регулируемым порогом и FPS-метром. [verified] — https://www.yfiles.com/demos/showcase/large-graphs/
- WebGL2-бекенд: «размер графа ограничен в основном видеокартой — **миллионы элементов** плавно и анимированно» [claimed, из офиц. доков] — https://docs.yworks.com/yfiles-html/dguide/advanced/webgl2.html
- Честная оговорка в доках: без оптимизаций комфортно «до нескольких сотен элементов», «большие графы» = тысячи—десятки тысяч. [verified] — https://docs.yworks.com/yfiles-html/dguide/advanced/large_graph_performance.html
- Для больших графов рекомендуются лейауты: Hierarchical, Organic, Tree, RadialTree. [verified] — там же.

**Технически.**
- Три техники рендера в одном SDK: SVG / Canvas / WebGL2. [verified] — доки выше.
- Лицензия: **бессрочная (one-time), royalty-free** (без отчислений с приложений), опциональная подписка на обновления; конкретные цены — только через конфигуратор/сейлов. [verified] — https://www.yfiles.com/pricing

**Что берём для Коры.**
- Гибрид «WebGL вдали ↔ DOM/SVG вблизи» — лучший найденный ответ на конфликт «вау-масштаб vs читаемые карточки узлов». Для Коры: three.js-сцена для полёта, при зуме на узел — HTML-оверлей (React-карточка блока с текстом факта и ссылкой на встречу). Тот же паттерн, наш стек.
- Их честные пороги («сотни элементов без оптимизаций») — калибровка ожиданий: наши «тысячи узлов» уже требуют WebGL/LOD, DOM-рендер не потянет.

---

### 9. Memgraph Lab (+ GSS + Orb)

**Функционально.** Бесплатный визуальный клиент Memgraph (запросы + визуализация). Фишка — **GSS (Graph Style Script)**: CSS-подобный язык стилизации графа. [verified] — https://memgraph.com/docs/memgraph-lab/features/graph-style-script

**Вау-приёмы.**
- Стили как код: директивы `@NodeStyle` / `@EdgeStyle` с выражениями над переменными `node`, `edge`, `graph` — цвет/размер/форма узла вычисляются формулой от данных («size: зависящий от количества связей»). [verified] — https://memgraph.com/blog/how-we-integrated-custom-css-like-language-to-style-graphs
- Карта: map tiles (тайлы карты) прямо в GSS для гео-графов. [verified] — доки GSS.
- Дефолтные стили per-theme (светлая/тёмная) через YAML-конфиг, подкладываемый в докер. [verified] — https://memgraph.com/docs/memgraph-lab/features/custom-configuration

**Технически.**
- Orb — их открытая либа визуализации (родилась внутри Lab/Playground): Apache-2.0, TypeScript, Canvas-рендер + D3 для алгоритмов, DefaultView/MapView (leaflet), симуляция в web worker. Последний релиз **v0.4.3 — 12.02.2024**, 419 звёзд — темп поддержки низкий. [verified] — https://github.com/memgraph/orb
- Использует ли текущий Lab по-прежнему Orb — из открытых материалов не однозначно. [inferred]

**Что берём для Коры.**
- Идею «стиль = функция от данных» как контракт: у нас правило вида `size = f(количество блоков)`, `brightness = f(свежесть последней встречи)`, `цвет = область` должно жить в одном декларативном месте (конфиг/JSON), а не размазываться по компонентам. Это и есть механизм «видно где наполнено/пусто».
- Orb как либу НЕ берём (Canvas, вялая поддержка) — берём только паттерн.

---

### 10. Gephi Lite

**Функционально.** Бесплатная веб-версия классического Gephi: раскладка, внешний вид, фильтры, метрики сети — в браузере. v1.0 вышла **08.10.2025** после полного редизайна (UX-исследование + дизайнер); текущая v1.0.2 — **01.12.2025**. [verified] — https://gephi.wordpress.com/2025/10/08/gephi-lite-v1/ , https://github.com/gephi/gephi-lite

**Вау-приёмы.**
- Два связанных вида: «Graph» и «Data» (таблица) — выделения, фильтры и метрики общие; смотришь на одно и то же с двух углов. [verified] — https://www.ouestware.com/2025/07/31/gephi-lite-new-design-en/
- Touch/multitouch и отзывчивый UI — «листай сеть как карту» с планшета. [claimed] — блог Gephi.

**Технически.**
- Стек: React + TypeScript, рендер — **sigma.js** (WebGL), модель — graphology, GPLv3, 333 звезды. [verified] — https://github.com/gephi/gephi-lite
- Практический потолок: **~10 000 узлов / 20 000 рёбер**. [verified] — https://gephi.wordpress.com/2025/10/08/gephi-lite-v1/

**Что берём для Коры.**
- Ориентир масштаба open-source-стека: sigma.js/graphology комфортно до ~10k узлов — наши «тысячи узлов на органзацию» внутри лимита даже без GPU-экзотики.
- Паттерн «граф + таблица с общим выделением» — дешёвая практичная навигация: клик по узлу подсвечивает строки-блоки (и наоборот), таблица = список фактов с «из какой встречи».
- GPLv3 — код не копируем (вирусная лицензия), смотрим только UX.

---

### 11. Бонус: cosmos.gl / Cosmograph (открытый GPU-движок)

**Функционально.** Не enterprise-вендор, а недостающее звено для воспроизведения их масштаба бесплатно: force-layout И рендер целиком на GPU (фрагментные/вершинные шейдеры), без CPU-симуляции вовсе.

**Технически.**
- cosmos.gl (бывш. @cosmograph/cosmos): **MIT**, WebGL2 через luma.gl, «real-time симуляция сотен тысяч точек и связей» [claimed], релиз **v3.1 — 30.06.2026** (живой проект), 1.2k звёзд, TypeScript + GLSL. [verified] — https://github.com/cosmosgl/graph
- Демо Cosmograph: **475 448 узлов / 1 014 134 рёбер** интерактивно в браузере. [claimed — статья авторов Cosmograph] — https://nightingaledvs.com/how-to-visualize-a-graph-with-a-million-nodes/ (23.08.2022)
- Там же авторы: обычные GPU-подходы к force-layout упираются в паттерны доступа к памяти — их вклад именно в шейдерную симуляцию.

**Что берём для Коры.** Если решим, что react-force-graph-3d (three.js, CPU-физика d3-force-3d) не тянет вау-масштаб «весь мозг с частицами» — cosmos.gl это MIT-запасной аэродром уровня Graphistry-клиента. Минус: 2D, свой рендер (не three.js) — сложнее добавить полёт камеры/3D-свечение.

---

## Сводка: топ-выводы контура

### Рыночное определение «вау» (за это показывают демо и берут деньги)
1. **Масштаб как спецэффект**: миллион рёбер на экране (Graphistry, cosmos.gl), «10k узлов за 1 секунду» (Ogma [claimed]). Достигается одинаково: WebGL/GPU-рендер + вынос физики из main thread (web worker у Orb, шейдеры у cosmos.gl, сервер у Graphistry).
2. **Живая физика и анимированные переходы**: GPU-powered physics (Bloom), анимированное раскрытие combo (ReGraph), animated flow — бегущее «течение» по связям (KeyLines 8.2). Всё, что движется само, читается как «мозг живой».
3. **Время как ось шоу**: timebar продаёт каждый второй вендор (ReGraph — отдельный React-компонент, Graphistry, Ogma timeline). Реплей роста графа по датам = наш «мозг растёт на глазах» — приём стандартный, реализация тривиальная (фильтр по createdAt + появление узлов с анимацией).
4. **3D/полёт продаётся сам по себе**: GraphXR берёт $5–15k/мес [unverified, вторичный] фактически за «граф как 3D-мир» + parametric morph (перестройка облака узлов по осям-свойствам с анимацией).

### Рыночное определение «практично» (за это продлевают подписку)
5. **Иерархическая агрегация = главный анти-каша приём**: combos (ReGraph), transformations/grouping (Ogma), авто-LOD. Вывод для Коры: drill-down область→тема→сущность→блок должен быть агрегацией ДАННЫХ (мета-узлы с бэка), а не трюком рендера.
6. **Rule-based styling — деньги за «видно где что»**: размер/градиент по метрике (Bloom+GDS), стиль-как-код (Memgraph GSS), стили от данных (yFiles). Для Коры: наполненность области = размер/яркость, пустота = тусклый «призрак»-узел; свежесть = свечение.
7. **Поиск человеческим языком поверх графа**: search phrases с параметрами и chaining (Bloom). У Коры это уже есть в виде AI-чата — не хватает только моста «ответ чата → сцена графа» (deep link + подсветка источников).
8. **Provenance (происхождение) через контекстные действия**: scene actions над выделением (Bloom), drilldowns (Graphistry). «Почему это здесь» = действие «показать встречу-источник» в контекстном меню узла.
9. **Сцена как артефакт**: сохранённые сцены, deep links, presentation mode, экспорт PNG/SVG/PDF (Bloom, ReGraph). Расшариваемая ссылка на состояние графа — дешёвая и очень «enterprise» фича.
10. **Гибридный рендер по зуму** (yFiles WebGL↔SVG, NVL WebGL↔Canvas): вдали — тысячи точек, вблизи — читаемая карточка с текстом. Для Коры: three.js-облако + React/HTML-оверлеи при фокусе на узле.

### Числа лимитов (сводная таблица)

| Движок | Рендер | Заявленный масштаб | Тег |
|---|---|---|---|
| Ogma | WebGL → Canvas/SVG fallback | 100k+ узлов и рёбер; layout >1M рёбер «за секунды» | [claimed] |
| KeyLines/ReGraph | WebGL + Canvas fallback | публичных чисел НЕТ | [verified: отсутствие] |
| Graphistry | сервер-GPU (RAPIDS) + WebGL-клиент | пример 50k узлов/500k+ рёбер; аналитика: T4 >100M рёбер | [claimed] |
| yFiles | WebGL2 / SVG / Canvas гибрид | «миллионы элементов» на WebGL2; без оптимизаций — сотни | [claimed] / [verified] |
| NVL (движок Bloom) | Canvas ↔ WebGL | Canvas ~1k узлов; WebGL 100k+ | [verified, npm README] |
| Bloom (приложение) | «GPU-powered» | потолок сцены 10 000 записей | [verified] |
| Gephi Lite (sigma.js) | WebGL | ~10k узлов / 20k рёбер практический потолок | [verified] |
| cosmos.gl | WebGL2-шейдеры (всё на GPU) | сотни тысяч точек real-time; демо 475k узлов/1M рёбер | [claimed] |
| GraphXR | 3D в браузере (Chrome) | чисел не публикует | [verified: отсутствие] |
| Memgraph Orb | Canvas + D3, worker-симуляция | чисел не публикует | [verified: отсутствие] |

Вывод по числам: масштаб Коры (тысячи узлов на организацию) — **ниже порога боли всех движков**; даже sigma.js-класс справится с практичной частью, а вау-3D упирается не в число узлов, а в качество эффектов (свечение/частицы/камера) — это territory three.js/react-force-graph-3d.

### Порядок цен (что стоит «премиальность»)

| Продукт | Цена | Тег |
|---|---|---|
| KeyLines | от ~$4 500/год за разработчика (май 2023); лицензия per-application | [unverified, вторичный: itqlick] |
| Ogma | по запросу; триал 30 дней | [verified] |
| Linkurious Enterprise Watchtower | от $25 000/год (либо тариф от $990/год — противоречие источников) | [unverified, вторичные: softwareadvice / sourceforge] |
| yFiles | бессрочная royalty-free, цена через конфигуратор | [verified: модель; цифр нет] |
| Graphistry | Hub Free $0; Hub Pro «~5% цены выделенного сервера»; AWS AMI: платишь только за GPU-инстанс | [verified/claimed] |
| GraphXR | $5 000–15 000/мес (снимок фев. 2024) | [unverified, вторичный: alternativeto] |
| Bloom/Explore, NVL, NeoDash, Memgraph Lab, Orb, Gephi Lite, cosmos.gl | бесплатно / OSS | [verified] |

Т.е. рынок платит $4.5k–25k/год за SDK и до $180k/год за managed-3D — при том что ни один приём из каталога выше не является технически закрытым: всё воспроизводимо на three.js/react-force-graph + свои данные. Ров вендоров — полировка и поддержка, не алгоритмы.

### Минимальный премиальный набор для Коры (по итогам контура)
1. Мета-узлы областей/тем с бэка + анимированное раскрытие (паттерн combos/transformations).
2. Декларативные стайлинг-правила: размер=объём знаний, свечение=свежесть, тусклость=пустота (паттерн GSS/GDS-styling).
3. Timebar-реплей «как рос мозг» по датам встреч (паттерн ReGraph/Graphistry).
4. Deep link из ответа AI-чата в сцену графа с подсветкой узлов-источников (паттерн Bloom search phrases + deep links).
5. Контекстное действие «из какой встречи это» на узле-блоке (паттерн scene actions).
6. Гибрид: WebGL-облако вдали ↔ HTML-карточка узла вблизи (паттерн yFiles/NVL).
7. Presentation mode + расшариваемая ссылка на сцену (паттерн Bloom) — для CEO-демо.

---

## Ограничения контура (что не удалось проверить)

- **Цены KeyLines/ReGraph, Ogma, yFiles, GraphXR** — вендоры не публикуют прайсы; все цифры из сторонних каталогов (itqlick 2023, alternativeto 2024, softwareadvice) без подтверждения первоисточником; TrustRadius отдал 403. Противоречие $990 vs $25 000/год по Linkurious не разрешено.
- **Производительность KeyLines/ReGraph числами** — вендор публичных бенчмарков не даёт (проверены features-страница и product-update блоги); сравнить с Ogma «в цифрах» нельзя без триала.
- **Маркетинговые числа Ogma (40x, 1M рёбер) и Graphistry (100M+ рёбер на T4)** — независимых замеров не найдено; тег [claimed], на веру не брать.
- **Живые демо не прогонялись руками** (Performance Workbench Ogma, large-graphs demo yFiles, Graphistry Hub) — контур ограничился документацией и описаниями демо; FPS на нашем референс-железе неизвестен.
- **Bloom slideshow** — в доках подтверждён только Presentation mode (полноэкранная сцена) и экспорт; отдельной «слайдшоу из сцен» функции в актуальной документации не нашёл — возможно, встречается только в старых маркетинговых материалах.
- **Использует ли актуальный Memgraph Lab библиотеку Orb** — не однозначно из открытых источников; Orb без релизов с февраля 2024.
- **GraphXR: технология рендера (three.js? свой движок?) и лимиты узлов** — не раскрыты в открытой документации.
- Снимок на 2026-07-05; блоги Cambridge Intelligence датируются вплоть до июня 2026 — на момент чтения могли выйти новые релизы с числами.
