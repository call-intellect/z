---
type: analysis
status: research-input
segment: pkm-core
snapshot_date: 2026-07-05
---

# Граф-визуализации в ядровых PKM-продуктах: Obsidian, Logseq, Roam, Foam

Контур исследования для «мозга Коры»: как устроены граф-виды (graph view — визуализация сети заметок) в эталонных PKM-продуктах (personal knowledge management — личная база знаний), чем технически рендерятся, где лимиты и — главное — что о них реально думают пользователи. Дата снимка: 2026-07-05. Все версии npm-библиотек проверены по registry.npmjs.org в день снимка.

---

## Карточки

### 1. Obsidian Graph View (встроенный, эталон жанра)

#### Функционально простым языком

Два режима [verified — официальная справка https://obsidian.md/help/plugins/graph]:

- **Глобальный граф** — вся база: кружок = заметка, линия = внутренняя ссылка. Размер узла растёт с числом входящих ссылок. Наведение подсвечивает связи узла, клик открывает заметку, правый клик — контекстное меню.
- **Локальный граф** — только соседи активной заметки, со слайдером глубины (depth — сколько «прыжков» по связям показывать) и режимами «входящие / исходящие / соседние ссылки» [verified — справка + разбор воркфлоу https://www.sivwuk.com/5-features-of-obsidian-graph-view-and-how-i-use-them/, 2022-03-27].

Панель настроек — 4 секции [verified — официальная справка]:

| Секция | Что внутри |
|---|---|
| **Filters** | поисковый запрос (полный синтаксис поиска Obsidian: `path:`, `tag:`, `file:`), тумблеры: теги, вложения, «только существующие файлы», сироты (orphans — заметки без связей) |
| **Groups** | цветовые группы: «новая группа» = поисковый запрос + цвет; всё, что матчится, красится этим цветом |
| **Display** | стрелки направления, порог проявления подписей при зуме (text fade threshold), размер узла, толщина линии, кнопка **Animate** (таймлапс) |
| **Forces** | 4 слайдера физики: center force (стягивание к центру), repel force (расталкивание узлов), link force (жёсткость «резинок»-связей), link distance (длина связи) |

Известная боль: настройки глобального графа НЕ наследуются локальными графами (глобальные лежат в `.obsidian/graph.json`, локальные — в `workspace`), пресеты фильтров просят с 2020 года — feature request с сотнями голосов так и не закрыт [triangulated(2) — https://gist.github.com/bobheadxi/ad4bc77a7b8c80d26f7668dac8a47576 + https://forum.obsidian.md/t/graph-view-presets-to-save-and-load-filters-display-settings/8131].

#### Вау-приёмы

- **Таймлапс роста хранилища**: кнопка «Animate» проигрывает появление узлов в хронологии по дате создания файла [verified — официальная справка]. Появился ~март 2021 [triangulated(2) — твит @obsdmd 2021-03-10 https://twitter.com/obsdmd/status/1369783112469725185 + тред форума 2021-03-12 https://forum.obsidian.md/t/how-to-make-your-graph-timelapse-animation-grow/14515].
- **Секрет «растущего мозга»**: эффект органического роста получается ТОЛЬКО при выключенных сиротах — узел появляется в момент появления первой связи и «прорастает» из существующей сети; со включёнными сиротами узлы сыплются россыпью и эффект теряется [verified — тот же тред 14515]. Пользователи выкладывают ролики «2 года базы за 30 секунд» как контент [пример: https://www.youtube.com/shorts/4YQhH61tvOc].
- Подсветка окрестности при наведении + проявление подписей только на зуме — граф остаётся «чистым» издалека и информативным вблизи [verified — справка].
- Цветовые группы по запросу — самый цитируемый приём осмысленности: «раскрасил папки/теги — увидел структуру» [triangulated(3) — справка, sivwuk.com, тред 71316].

#### Технически

- Рендер — **Pixi.js** (2D-движок поверх WebGL): «Pixi.js is doing the rendering, everything else is custom» (сотрудник joethei, 2022-07-28); до этого был D3, от которого отказались — «was not performant enough»; API графа закрытый и «quite messy» (лид-разработчик Licat, 2022-08-01) [verified — https://forum.obsidian.md/t/understanding-the-graph-view-core/41020].
- Раскладка — force-directed (силовая: узлы расталкиваются, связи стягивают) на CPU. Подтверждение CPU-природы: на i7-14700KF + 64 GB RAM + RTX 4090 глобальный граф вешает приложение при 130k заметок, при этом **одно ядро CPU в 100%, GPU простаивает** [verified — https://forum.obsidian.md/t/obsidian-graph-view-doesnt-work-for-a-large-vault/106287, сентябрь–октябрь 2025].
- Ломается и WebGL-слой: баг «pixiejs shaders broken» в v1.4.5 [verified — https://forum.obsidian.md/t/v1-4-5-graph-view-does-not-render-nodes-pixiejs-shaders-broken/66621].

#### Лимиты на тысячах заметок

- Модератор WhiteNoise: «anything above 25K files is not practical»; у репортера 130k заметок граф замерзает даже локальный при глубине 1, на 29k — работает [verified — тред 106287, окт. 2025].
- Отчёт о 50k заметок (40k импорт из Evernote): лаги всего приложения; после сокращения до 10k скорость вернулась [unverified — сниппет треда https://forum.obsidian.md/t/help-obsidian-lags-with-many-notes/82241, напрямую не читал].
- Открытый локальный граф в сайдбаре вызывает лаг набора текста; глобальный граф блокирует редактор пока перерисовывается (заметно от ~1000 заметок) [unverified — сниппеты тредов 52259, 4804].
- Практик с 6000+ заметок: открытие графа — «frustrating chore» (мучительная рутина); ушёл на самописную визу: экспорт vault в JSON → **graphology** (модель графа) + **sigma.js** (WebGL-рендер «thousands of nodes and edges») [triangulated(2) — https://wasi0013.com/2025/09/22/... (2025-09-22, прямое чтение — 403) + README sigma.js https://github.com/jacomyal/sigma.js]. sigma@3.0.3 вышла 2026-04-30 — жива [verified — npm registry].

#### Критика пользователей: когда «красиво, но бесполезно»

Канонический тред «What's the point of the graph view?» [verified — прямое чтение https://forum.obsidian.md/t/whats-the-point-of-the-graph-view-how-are-you-using-it/71316, ноябрь 2023 – июль 2024]:

**Лагерь «бесполезно»:**
- «The graph view turns out to be nothing than a bunch of dots… you can't actually do anything with it» — ждал раскрытия скрытых связей, получил точки (ObsidianOverlord9000, 2023-11-14).
- «Chaotic patterns have no meaning, time changes are uncontrollable and cannot be remembered» (charleslu, 2023-11-20).
- «Fiddling with criteria to get what I wanted was a complete waste of time» — текстовый поиск быстрее (writtenfool, 2023-11-18).
- Часть людей просто невизуалы и выключают граф совсем (AlanG, CarolineMathieson).

**Лагерь «полезно» — и все кейсы про ФИЛЬТРОВАННЫЙ или ЛОКАЛЬНЫЙ граф:**
- Оценка «весов» базы после импорта 2500 неразмеченных заметок — где густо, где пусто (mandalo, 2023-11-15).
- «Используй локальный граф, а не глобальный» + дисциплина тегов + закладки на конфигурации фильтров (Edmund, 2023-11-15).
- Полнотекстовый поиск в фильтре графа → найти несвязанные заметки по теме → создать связи (ottovanluchene, 2023-11-18).
- «Spatial awareness of the cohesion of my brain» — граф как пульс целостности базы (jhidalgochacon, 2024-07-09).
- Локальный граф как рабочий стол при написании статьи (bobdoto, 2024-07-11).

Внешняя критика в ту же точку:
- Zettelkasten-форум (Sascha, ноябрь 2020): «The value of a graphic view decreases over time. You cannot expect to have a life long system and rely on a graphic view» — с ростом базы полный граф неинтеллигибелен; **консенсус треда: практически полезны только фильтрованные подграфы** (по тегу/поиску/окрестности) [verified — https://forum.zettelkasten.de/discussion/1463/...].
- Академический обзор практиков knowledge graph: node-link диаграммы «impossible to interpret at scale», превращаются в «hairballs» (комки волос) [verified — arXiv 2304.01311 https://arxiv.org/html/2304.01311v4].
- Защита графа (Mark McElroy, «The Graph Ain't Just Eye Candy»): ценность — увидеть хабы/кластеры/паттерны мышления; режим работы — свободная ассоциативная навигация по графу, затем переключение в линейный аутлайн [triangulated(1) — https://markmcelroy.com/how-to-use-the-knowledge-graph-or-why-the-graph-aint-just-eye-candy/, по сниппету].

#### Что берём для Коры

1. **Групповая раскраска по запросу → у нас из коробки**: 12 областей компании = 12 предзаданных цветовых групп (у Obsidian юзер настраивает руками — у Коры цвета областей должны прийти с сервера, нулевая настройка).
2. **Таймлапс по `createdAt` узлов графа = дешёвый вау «мозг растёт»**: урок «orphans off» — в анимации узел должен появляться вместе с первым ребром, иначе россыпь точек вместо роста. У Коры даты есть у каждого блока-факта (дата встречи) — таймлапс «неделя за неделей» напрашивается.
3. **Локальный граф с глубиной = наш drill-down**: слайдер depth 1–3 от сущности (человек/клиент/проект) — прямо переносимый паттерн «почему это здесь»: сущность → блок-факт → встреча.
4. **Физику не отдавать пользователю**: 4 слайдера сил Obsidian — власть для гиков; для SMB-владельца дать 1–2 пресета («компактно» / «разлёт»), остальное зашить.
5. **Лимиты**: force-раскладка на CPU в один поток умирает к 25k узлов даже на RTX 4090. У Коры «тысячи узлов на организацию» — в зоне комфорта, но: layout считать в Web Worker (фоновом потоке браузера) или предрассчитывать на бэке, рендер — только WebGL (см. карточку экосистемы ниже).
6. **Главный урок критики**: сырой глобальный «хэйрбол» — 50/50 восторг/разочарование. Вау-режим (полный граф + свечение + таймлапс) и рабочий режим (фильтрованный подграф области/темы/сущности) — это ДВА разных экрана, и по умолчанию открывать надо не сырую массу, а уровень «12 областей».

#### Источники

- https://obsidian.md/help/plugins/graph — официальная справка (все настройки) [verified]
- https://forum.obsidian.md/t/understanding-the-graph-view-core/41020 — Pixi.js, отказ от D3 (2022) [verified]
- https://forum.obsidian.md/t/whats-the-point-of-the-graph-view-how-are-you-using-it/71316 — критика/защита (2023–2024) [verified]
- https://forum.obsidian.md/t/obsidian-graph-view-doesnt-work-for-a-large-vault/106287 — лимиты 25k–130k (2025) [verified]
- https://forum.obsidian.md/t/how-to-make-your-graph-timelapse-animation-grow/14515 — таймлапс, трюк с orphans (2021) [verified]
- https://forum.zettelkasten.de/discussion/1463/... — критика «graph decreases over time» (2020) [verified]
- https://wasi0013.com/2025/09/22/... — уход с Obsidian-графа на sigma.js при 6k+ заметок (2025) [triangulated(2)]

---

### 2. Экосистема 3D-графов Obsidian (плагины — где живёт «вау»)

#### Функционально простым языком

Встроенный граф Obsidian — 2D. Весь «вау-3D» отдан плагинам:

- **obsidian-3d-graph** (AlexW00) — первый 3D-граф, оригинал заброшен; форк HananoshikaYomaru и плагин «3D Graph New» построены на библиотеке **3d-force-graph** от vasturiano (Three.js/WebGL): вращение, зум, панорама, фильтры, группы-цвета [triangulated(3) — https://github.com/AlexW00/obsidian-3d-graph + https://github.com/HananoshikaYomaru/obsidian-3d-graph + https://www.obsidianstats.com/plugins/3d-graph-new]. В оригинале AlexW00 был запрос Timelapse Animation — issue #41, не реализован [verified — https://github.com/AlexW00/obsidian-3d-graph/issues/41].
- **Three D Graph View** (roasted-nz, v0.1.4, релиз ~май–июнь 2026, 587 загрузок): сферическая раскладка, **таймлапс-реплей по порядку создания заметок**, цвета по папкам, подсветка при наведении, **пульс + «сонар»-волны на текущей заметке**, авто-вращение [verified — https://community.obsidian.md/plugins/three-d-graph-view].
- **Экспериментальный 3D-рендерер D'Arcy Norman** (2026-04-10): Three.js + d3-force-3d + **GLSL-шейдеры** (программы для видеокарты) + **instanced rendering** (отрисовка тысяч одинаковых объектов одним вызовом GPU) + **~6000 фоновых частиц** для атмосферы; таймлапс по хронологии; фильтры: диапазон дат, теги, папки, окрестность заметки до 5 прыжков. Автор собрал это «за часы» вайбкодингом с Claude Code [verified — https://darcynorman.net/2026/04/10/experimental-obsidian-3d-graph-renderer/].

#### Вау-приёмы

Сложившийся рецепт «вау» в экосистеме (сумма трёх проектов выше): тёмный фон + свечение узлов + фоновые частицы + автополёт/автовращение камеры + таймлапс роста + пульс/сонар на активном узле. Всё это — поверх одной и той же библиотеки vasturiano.

#### Технически

- **3d-force-graph** (vasturiano): Three.js/WebGL, физика — d3-force-3d или ngraph (быстрее на больших графах); последний релиз **1.80.0 от 2026-04-05** — активно живёт [verified — npm registry, github.com/vasturiano/3d-force-graph].
- **react-force-graph** (тот же автор) — React-обёртки: ForceGraph2D / 3D / VR / AR с единым API пропсов; **react-force-graph-3d 1.29.1 от 2026-02-04** [verified — npm registry, github.com/vasturiano/react-force-graph].

#### Что берём для Коры

1. **Прямой upgrade path**: в репо Коры уже стоит `react-force-graph-2d` — 3D-режим = соседний пакет того же автора с тем же API пропсов. Минимальный риск миграции.
2. **Рецепт вау подтверждён рынком**: свечение + частицы + таймлапс + автовращение реализуемы на 3d-force-graph без написания своего движка; шейдерные изыски (GLSL, instanced rendering) — опциональный второй этаж.
3. **Физика: ngraph вместо d3-force-3d** при тысячах узлов — штатная опция библиотеки.
4. Прецедент Нормана: такой рендерер собирается агентом «за часы» — оценка трудоёмкости вау-части ниже интуитивной.

#### Источники

- https://github.com/vasturiano/3d-force-graph (+ npm 1.80.0, 2026-04-05) [verified]
- https://github.com/vasturiano/react-force-graph (+ npm react-force-graph-3d 1.29.1, 2026-02-04) [verified]
- https://darcynorman.net/2026/04/10/experimental-obsidian-3d-graph-renderer/ (2026-04-10) [verified]
- https://community.obsidian.md/plugins/three-d-graph-view (v0.1.4, 2026) [verified]

---

### 3. Logseq Graph View

#### Функционально простым языком

Logseq — аутлайнер (заметки = дерево блоков-буллетов, всё пишется в журнал по дням). Граф-вид показывает страницы и связи между страницами; есть глобальный и локальный. Управление скромнее обсидиановского: меньше фильтров, нет цветовых групп по запросу [triangulated(3) — сравнения 2026: https://www.atlasworkspace.ai/blog/obsidian-vs-logseq, https://productivitystack.io/compare/logseq-vs-obsidian/, https://fabric.so/comparison/obsidian-vs-logseq].

Консенсус сравнений 2026 года: граф Obsidian «более отполирован, кастомизируем и достойнее держит большие базы»; сильная сторона Logseq — гранулярность на уровне блока (связываются идеи, не страницы), но именно это граф и НЕ показывает (см. критику) [triangulated(3) — те же сравнения].

#### Вау-приёмы

Отсутствуют как класс — граф Logseq в обзорах называют функциональным минимумом; таймлапса нет [inferred — ни одно из 8 сравнений и форумных тредов не упоминает анимаций/таймлапса].

#### Технически

- Рендер: **pixi-graph-fork@0.2.0** — форк библиотеки zakjan/pixi-graph (PIXI.js + **graphology** как модель графа), плюс pixi-viewport@4.38.0 (камера/зум), PIXI v6.5.8. Точные версии зафиксированы в issue о битых peer-зависимостях [verified — https://github.com/logseq/logseq/issues/11612]. Оригинальный zakjan/pixi-graph — архивирован (read-only) [verified — https://github.com/zakjan/pixi-graph].
- Следствие PIXI: экспортированные публичные страницы требуют CSP `script-src 'unsafe-inline'` — граф не работает под строгой Content Security Policy (политика безопасности контента браузера) [verified — https://discuss.logseq.com/t/make-logseq-unsafe-eval-free-by-replacing-pixi-js/29197].
- Хрупкость WebGL-слоя: граф ломался при обновлении драйвера NVIDIA на Linux [unverified — сниппет https://github.com/logseq/logseq/issues/11769].

#### Критика пользователей

Тред «Confusion about the graph view. What's the point of it if you rely on blocks and journals?» [verified — прямое чтение https://discuss.logseq.com/t/confusion-about-the-graph-view-whats-the-point-of-it-if-you-rely-on-blocks-and-journals/28136]:

- Суть (eldelacajita, 2024-07-14): граф показывает «only links **between pages**, not blocks». Если работать «по-логсековски» — писать всё в журнал и линковать внутри блоков — граф пуст и «не отражает реальные связи». Родной воркфлоу продукта противоречит его же графу.
- Контраргумент (mentaloid, 2024-07-16): показывать блок-связи = граф станет «too noisy» на росте базы; рецепт — выносить знания на страницы, оставляя журналу хронологию.

#### Что берём для Коры

1. **Центральный урок — уровень агрегации рёбер**: у Коры атомы = блоки-факты (аналог блоков Logseq). Рисовать рёбра на уровне блоков = шум; на уровне «страниц» = потеря связей, за что Logseq и критикуют. Решение для Коры: **агрегировать блок-связи вверх** — ребро «сущность—сущность» с весом = числу общих блоков-фактов, а сами блоки показывать только в drill-down выбранного ребра/узла («почему связаны» = список фактов со ссылкой на встречу).
2. **Стек pixi-graph = graphology + PIXI + viewport** — референс архитектуры 2D-варианта (модель графа отдельно от рендера); но оригинал библиотеки архивирован — не брать.
3. **CSP-ловушка**: инлайновые шейдеры WebGL-либ конфликтуют со строгим CSP — проверить заранее с политиками Next.js 16, если Кора закручивает CSP.
4. Антиурок: граф «функционального минимума» без вау и без внятного ответа «зачем» → фичу не полюбили. Вау-слой — не украшение, а причина открыть экран.

#### Источники

- https://github.com/logseq/logseq/issues/11612 — pixi-graph-fork@0.2.0, версии стека [verified]
- https://discuss.logseq.com/t/make-logseq-unsafe-eval-free-by-replacing-pixi-js/29197 — CSP/PIXI [verified]
- https://discuss.logseq.com/t/confusion-about-the-graph-view-whats-the-point-of-it-if-you-rely-on-blocks-and-journals/28136 — критика page-vs-block (2024) [verified]
- Сравнения 2026: atlasworkspace.ai, productivitystack.io, fabric.so [triangulated(3)]

---

### 4. Roam Research Graph Overview

#### Функционально простым языком

Первый массовый «сетевой» PKM (пик хайпа 2020). Graph Overview — глобальная «паутина» страниц + локальный граф страницы. Настроек кастомизации минимально; фирменная идея продукта — связи на уровне блоков (block references), но в граф-обзор они, как и у Logseq, полноценно не подняты [triangulated(2) — https://nesslabs.com/roam-research + https://www.sitepoint.com/roam-research-beginners-guide/].

Маркетинговый нарратив (Ness Labs, обновлено 2021-01-05): «giant knowledge web representing your notes», карта «fluid, no hierarchy» как нейросеть мозга; граф = инструмент **метакогниции** («думать о том, как думаешь») [verified — прямое чтение nesslabs.com; по природе — пересказ ценности продукта, к цифрам относиться как [claimed]].

#### Вау-приёмы

Вау был нарративный, не технический: «увидеть свой мозг» — картинка графа Roam стала мемом и продавала подписки в 2020. Технических приёмов (свечение/частицы/таймлапс) нет [inferred — ни один источник не упоминает].

#### Технически

Рендер-стек закрытый; первоисточника (код/заявление разработчиков) найти не удалось [unverified]. Приложение целиком ClojureScript SPA; известные жалобы на скорость самого приложения («Roam can be slow sometimes» — Ness Labs) [verified — nesslabs.com].

#### Критика пользователей

- «Roam Research does not offer the best graph viewing experience — it gets bulky when there are a few dozens documents involved» — граф «распухает» уже на десятках документов [verified — https://www.sitepoint.com/roam-research-beginners-guide/].
- Прицельные reddit-треды по graph overview найти через поиск не удалось (выдача пуста — обсуждения рассеяны) [unverified]; косвенно: сторонние сервисы (InfraNodus) строят бизнес на том, что родной граф Roam не даёт аналитики — «выявляем структурные дыры в графе» [claimed — вендор о себе, https://noduslabs.com/cases/visualize-connections-notes-roam-research-infranodus/].

#### Что берём для Коры

1. **Нарратив продаёт**: «посмотрите, как думает ваша компания» — эмоциональная рамка Roam переносится на Кору дословно и усиливается тем, что у Коры граф строится сам (из встреч), без ручного линкования.
2. **Антиурок масштаба**: паутина без иерархии «распухает на десятках документов» — у Коры тысячи узлов, значит вход всегда через иерархию (области → темы), полный граф — только как вау-обзор.
3. **Дыра Roam = фича Коры**: аналитика поверх графа (где густо/пусто, дыры между кластерами) — то, за что пользователи Roam платят третьей стороне (InfraNodus), у Коры должно быть встроено («видно где наполнено/пусто»).

#### Источники

- https://nesslabs.com/roam-research (2021-01-05) [verified — чтение; ценностные тезисы = claimed]
- https://www.sitepoint.com/roam-research-beginners-guide/ — «bulky at dozens of documents» [verified]
- https://noduslabs.com/cases/visualize-connections-notes-roam-research-infranodus/ [claimed]

---

### 5. Foam (VS Code, open source — бонус-карточка)

#### Функционально простым языком

Бесплатный PKM-каркас внутри VS Code. Команда «Foam: Show Graph» открывает граф в WebView (встроенное браузерное окно редактора): узлы = заметки, цвет — по **типу узла**: note / placeholder / attachment; фильтры по тегам; клик = переход к заметке [triangulated(2) — https://github.com/foambubble/foam + DeepWiki https://deepwiki.com/foambubble/foam/2.3-vs-code-extension; прямое чтение docs/user/features/graph-visualization.md не удалось — 404, путь в репо сменился].

Ключевая деталь: **placeholder** — узел для заметки, на которую уже ссылаются, но которой ещё не существует. Дыры в базе видны прямо на графе как узлы-призраки другого цвета. Стилизация — настройкой `foam.graph.style` (цвета по типам под тему редактора) [triangulated(2) — те же источники].

#### Вау-приёмы

Нет; утилитарный граф. Ценность — семантика типов узлов, а не зрелище [inferred].

#### Технически

Модель графа — dagrejs/graphlib; рендер исторически — через расширение markdown-links; в комьюнити открытый «call for visualization» на замену [triangulated(2) — DeepWiki + https://github.com/foambubble/call-for-visualization]. Свежесть репо на дату снимка не проверена [unverified].

#### Что берём для Коры

1. **Узлы-призраки = визуализация «где пусто»**: прямой паттерн для требования Коры «видно где наполнено/пусто». Область/тема без блоков-фактов рисуется полупрозрачным «призраком» — пустота становится видимым объектом, а не отсутствием.
2. Раскраска по ТИПУ узла (область/тема/сущность/факт — у Коры 4 типа) как базовый слой семантики, поверх — цвета областей.

#### Источники

- https://github.com/foambubble/foam [triangulated]
- https://deepwiki.com/foambubble/foam/2.3-vs-code-extension [triangulated]
- https://github.com/foambubble/call-for-visualization [verified — существование инициативы]

---

## Сводка: топ-выводы контура

1. **Рендер-стек жанра един: WebGL, физика на CPU.** Obsidian — Pixi.js (ушли с D3 из-за производительности, 2022) [verified]; Logseq — pixi-graph-fork (PIXI + graphology) [verified]; самописные решения энтузиастов — sigma.js+graphology или Three.js (3d-force-graph). SVG/D3-рендер на тысячах узлов в жанре не выжил.
2. **Бутылочное горлышко — не рендер, а force-раскладка в одном потоке CPU**: 130k узлов вешают Obsidian при простаивающей RTX 4090; практический потолок встроенного графа ~25k файлов (модератор) [verified]. Для Коры (тысячи узлов) запас есть, но layout — в Web Worker или предрасчёт на бэке.
3. **Критика сходится в одну формулу: глобальный сырой граф = «bunch of dots», ценность — в фильтрованных подграфах.** Тред Obsidian 2023–2024 [verified], Zettelkasten-форум 2020 («value decreases over time», консенсус — только filtered sub-graphs) [verified], академики («hairballs at scale») [verified]. Все живые пользовательские кейсы пользы — локальный граф, цветовые группы, поиск-фильтр, поиск сирот.
4. **Вау и польза — разные экраны.** Встроенный 2D-граф Obsidian несёт пользу, «вау» вынесен в 3D-плагины (Three.js + свечение + частицы + автовращение + таймлапс). Кора должна строить оба слоя сознательно: вау-обзор (полный граф, полёт, таймлапс) и рабочий режим (drill-down от области/сущности с ответом «из какой встречи»).
5. **Таймлапс роста — самый дешёвый и проверенный вау-приём** (в Obsidian с 2021, в новых 3D-плагинах 2026 — снова он): анимация по датам создания узлов; критичный нюанс — узел появляется вместе с первым ребром (урок «orphans off»), иначе эффект рассыпается [verified].
6. **Уровень агрегации рёбер — главная продуктовая развилка** (боль Logseq и Roam): показывать связи атомов (блоков) = шум, только страниц = ложная пустота. Для Коры: рёбра агрегировать до сущностей/тем с весом, атомы-факты раскрывать по клику как объяснение «почему связано, из какой встречи».
7. **Библиотечная база для Коры готова и жива**: react-force-graph-2d уже в репо; 3D — react-force-graph-3d 1.29.1 (2026-02-04), 3d-force-graph 1.80.0 (2026-04-05), альтернатива 2D-масштаба — sigma 3.0.3 (2026-04-30) [verified — npm]. Плюс паттерн Foam «узлы-призраки» закрывает требование «видно где пусто».
8. **Настройки физики пользователю не нужны**: 4 слайдера Forces Obsidian — постоянный источник «fiddling… waste of time» [verified]; пресеты вместо слайдеров.

## Ограничения контура (что не удалось проверить)

- **Рендер-технология Roam Research** — код закрыт, заявлений разработчиков не нашёл; стек графа Roam остался [unverified].
- **Прицельные reddit-треды** по graph view (Obsidian/Roam) поиском не отдались (пустые выдачи) — критика опирается на официальные форумы Obsidian/Logseq и Zettelkasten-форум; reddit-настроения представлены только пересказом поисковика [unverified].
- Статья wasi0013 (sigma.js на 6k+ заметок) — прямое чтение заблокировано (403), факты восстановлены по двум независимым сниппетам [triangulated(2)].
- Числа тредов 82241 (50k→10k заметок) и 52259/4804 (лаг редактора) — по сниппетам поиска, треды напрямую не читал [unverified].
- Свежесть репо Foam (дата последнего коммита) — GitHub API недоступен из окружения (gh не установлен), не зафиксирована.
- Внутренности физики Obsidian (точный алгоритм сил, есть ли Web Worker) — API закрыт; вывод «CPU-bound, один поток» — из наблюдений пользователей [verified-наблюдение, inferred-механизм].
