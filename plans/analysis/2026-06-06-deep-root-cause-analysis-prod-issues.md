# Глубокий разбор корней проблем прода Кора (пред-ТЗ) — 2026-06-06

> Подготовка к ТЗ: по каждой найденной проблеме — **корень + механизм + варианты фикса + рекомендация**, с доказательствами (file:line, Context7, прод-факты diag/Playwright). Код НЕ менялся.
> Источник: повторный тест прода + 2 свежие встречи владельца (`01KTEAH38…` «тестоая встреча», `01KTED9V9F…` «тест сте») + 4 параллельных code-разбора + сравнительный разбор AI-агентов.
> Связанные: [retest-RESULTS-technical.md](2026-06-06-retest-RESULTS-technical.md), [retest-RESULTS-plain.md](2026-06-06-retest-RESULTS-plain.md).

---

## 0. Сводка и КРОСС-ВЫВОД

| # | Проблема | Корень (коротко) | Серьёзность | Главный фикс |
|---|---|---|---|---|
| A | Пайплайн встречи иногда ~20 мин | Весь старт пост-обработки висит на ОДНОМ composite-вебхуке `egress_ended`; нет крон-фоллбэка | 🔴 интермиттентно | composite-egress reconcile-крон (pull статуса) |
| B | Граф теряет связи (невалидный JSON) | `json_schema strict` для DeepSeek превращается в `tool_choice:'auto'` (не required, не strict) → flash отдаёт прозу; битый ответ = «успех», fallback на secondary НЕ срабатывает | 🟠 | форс tool-call + strict; парс-fail → router-fallback |
| C | ChunkLoadError рушит детальные страницы | `next build` на **Turbopack** (Next 16 дефолт) + нет `deploymentId` → version skew: старый HTML вкладки vs новый билд | 🔴 | `deploymentId` + ретрай + **`next build --webpack`** |
| D | Видео не проигрывается | `<media-player>` Vidstack не «оживает» — React-контроллер не присоединяется (внутр. `<video>` пустой). НЕ deploy-gap (фикс на проде) → Turbopack/standalone роняет чанк инициализации Vidstack | 🔴 | **`next build --webpack`** ИЛИ нативный `<video>` |
| E | Задачи извлекаются плохо (дубли, пропуски) | 3 несогласованных источника задач + слабый дедуп (trim+lowercase) + слабые экстракторы fast/main на коротком ASR-тексте + ошибки ASR | 🟠 продуктово важно | единый источник задач + сильный дедуп + capable-модель |
| UX | Отчёт открывается, но нельзя скачать/скопировать, не виден подробно | модалка без действий копирования/печати | 🟡 | кнопки «Скачать»/«Копировать» + развёрнутый просмотр |

### 🔑 Кросс-вывод (C + D — общий корень): **Turbopack в prod-сборке**
Прод собран из `dev` (фиксы бренда «Кора»/меню/доступа живые на проде ⇒ это не main). Значит видео-фикс `8fab2fc2` (`load="eager"`) **тоже на проде** — но видео всё равно мёртвое. То есть D — **не** «фикс не доехал», а рантайм-проблема Vidstack под Turbopack. Та же сборка даёт ChunkLoadError (C). **`next build` в Next 16 по умолчанию идёт Turbopack'ом** (флага в `frontend/package.json:8` нет). Гипотеза: Turbopack-prod рассогласует реестр модулей (C) и tree-shake'ит/не грузит чанк регистрации Vidstack-элемента (D). **Откат на `next build --webpack` — один фикс, закрывающий и C, и D.** Это первый, что стоит проверить (дёшево, S).

### Эмпирическое доказательство по A (две встречи — один в один)
| | completed → recording_ready | итого до ai_ready |
|---|---|---|
| Встреча 1 `01KTEAH38…` | **18 мин 22 с** 🔴 | ~20 мин |
| Встреча 2 `01KTED9V9F…` | **1.7 с** ✅ | ~50 с |
Один и тот же код, разный результат ⇒ **интермиттентная доставка egress-вебхука**, а не систематическая медленность. Когда вебхук пришёл за 1.7 с — весь конвейер ~50 с.

---

## 1. A — латентность пайплайна (18-минутная пауза)

**Корень.** Запуск всей пост-обработки (`transcribe → analyze → report → граф`) триггерится **исключительно** приходом composite-вебхука `egress_ended`. Крона/поллинга, который дотянул бы статус composite-egress из LiveKit после `room_finished`, **нет**. 18 мин — задержка доставки вебхука самим LiveKit (push-модель с ретраями и **секвенированием**: новые события не доставляются, пока старое «не обработано или не заброшено»), а не время финализации egress (по доке SendEOS ≤30 с).

**Доказательства (код):**
- `recording_ready` + `enqueueTranscribe` — единственный источник: [livekit-events.handler.ts:503-507](backend/src/modules/webhooks/livekit-events.handler.ts#L503-L507).
- `maybePromoteMeetingToReady` ([:472](backend/src/modules/webhooks/livekit-events.handler.ts#L472)) вызывается **только** из `onEgressEnded` ([:381-419](backend/src/modules/webhooks/livekit-events.handler.ts#L381-L419)).
- Reconcile-крон есть, но смотрит **только TRACK-дорожки** и только при `Recording.status ∈ {requested,recording}` ([recording-track-reconcile.cron.ts:35](backend/src/modules/recordings/cron/recording-track-reconcile.cron.ts#L35), [recordings.service.ts:401-408](backend/src/modules/recordings/recordings.service.ts#L401-L408)). После `room_finished` запись → `finalizing` → крон её не видит. **18 мин ≠ интервал крона.**
- Обёртка egress-клиента не умеет `listEgress`/`getEgress` ([livekit-egress.client.ts:51-102](backend/src/modules/recordings/livekit-egress.client.ts#L51-L102)) — для поллинга надо добавить.
- Context7 LiveKit Webhooks: «retries… sequences events… newer delivered only after older processed or abandoned… no absolute delivery guarantees».

**Вторичные тормоза (срезают «хвост», не относятся к 18-мин паузе):**
- **block-linker последовательный**: на каждый кандидат `await judgeLink` в for-loop, `LINK_KNN_TOP_K=10`, concurrency=2 → 44–73 с/проход, по job на каждый каноблок ([block-linker.worker.ts:144-152](backend/src/modules/knowledge-core/workers/block-linker.worker.ts#L144-L152), [env.schema.ts:525](backend/src/common/config/env.schema.ts#L525)).
- **meeting-report-fast 72 с** = латентность `deepseek-v4-pro` (в рамках таймаута 300 с).

**Варианты фикса:**
1. **🟢 Рекомендую: composite-egress reconcile-крон** (M/low). Добавить `listEgress` в клиент; `@Cron('*/1–2')` по `Meeting.status ∈ {completed,recording_processing}` + `Recording.status ∈ {finalizing,…}` старше ~60 с; если composite `EGRESS_COMPLETE` — вызвать существующий `onCompositeEnded` + `maybePromoteMeetingToReady` (вынести из webhook-handler в общий сервис). Идемпотентно. Ограничивает паузу сверху интервалом крона (≤2 мин вместо 18). Kill-switch ENV.
2. Ack-first приём вебхуков (M/med): обработку — в фон, всегда быстро 200, чтобы LiveKit не держал секвенс; + метрика gap `room_finished→egress_ended`; проверить рестарты backend в окне доставки. Бьёт в корень, но без гарантий — как дополнение к (1).
3. Радикально (L/med): транскрибация от per-track аудио, composite-видео — отдельной веткой; AI стартует раньше готовности видео.
4. Хвост (S/low): block-linker через `p-limit(N)` вместо for-loop / снизить `LINK_KNN_TOP_K`; report-fast — лёгкая модель на fast-путь (через AdminSetting).

**Рекомендация:** (1) сейчас + (2) параллельно; (4) отдельным мелким ТЗ; (3) — стратегически.

**Прод-пробы до/в ТЗ:** какие вебхуки реально пришли между 11:21 и 11:39 (`webhook_seen_event`/`meeting_event`); логи LiveKit Egress контейнера (EGRESS_ACTIVE→COMPLETE timestamps); был ли рестарт backend в окне; фактический `LLM_ROUTER_DISPATCH_TIMEOUT_MS` на проде (в memory 30000, в схеме 300000 — сверить).

---

## 2. B — слабый арбитр графа (невалидный JSON → потеря связей)

**Корень.** Арбитры связей просят строгий JSON, но **строгого режима нет**: DeepSeek-сервис конвертирует наш `json_schema strict` в синтетический tool с `tool_choice:'auto'` (без `required`, без `function.strict:true`) → `deepseek-v4-flash` вправе вернуть прозу вместо tool-call. Битый ответ router считает **успехом** (HTTP 200, `text` непустой) и **НЕ** уходит на secondary с настоящим structured-output — парс падает уже в call-site без шанса на fallback. Итог: ретрай той же flash → «fallback на none» (связь потеряна).

**Доказательства:**
- [deepseek.service.ts:139-160](backend/src/modules/ai/services/deepseek.service.ts#L139-L160) — `autoConvert` json_schema → tool, `tool_choice='auto'`, без strict.
- [deepseek.service.ts:283-288](backend/src/modules/ai/services/deepseek.service.ts#L283-L288) — tool-args стрингуются только если `text` пуст; проза в content → `text`=проза → парс падает.
- [block-link.service.ts:189-218](backend/src/modules/knowledge-core/services/block-link.service.ts#L189-L218) — for(attempt<2), parse null → метрика+«повтор», после 2 → «fallback на none».
- [entity-graph.service.ts:330-338](backend/src/modules/knowledge-core/services/entity-graph.service.ts#L330-L338) — **голый `JSON.parse`** без снятия ```-обёртки и **без ретрая** (хрупче block-linker).
- [llm-router.service.ts:1382-1489](backend/src/modules/ai/services/llm-router.service.ts#L1382-L1489) — fallback на secondary **только при throw**; «успешный битый» ответ = success → secondary не пробуется.
- secondary openai-proxy умеет настоящий strict json_schema ([openai-proxy.service.ts:91-101](backend/src/modules/ai/services/openai-proxy.service.ts#L91-L101)) — но до него не доходит.
- Тот же `tool_choice:'auto'` в новом adapter-пути ([openai-chat.adapter.ts:91-102](backend/src/modules/ai/services/protocol-adapter/adapters/openai-chat.adapter.ts#L91-L102)) — проблема **системная** (все json_schema-вызовы flash: block-ingest, task/chapter-extract, fact-supersede).

**Варианты фикса:**
1. **🟢 Форс tool-call + strict** (S/med): для не-thinking моделей (flash, gpt-5.4-*) ставить `tool_choice:{type:'function',function:{name}}` + `function.strict:true` вместо `'auto'`. Чинит ВСЕ json_schema-вызовы flash разом, цена та же. Риск: часть прокси-моделей даст 400 на форс/strict → нужен per-model guard + откат на 'auto' по существующей `LlmFormatNotSupportedError`.
2. **🟢 Устойчивый парс + parse-fail → router-fallback** (M/med): (а) в entity-graph заменить `JSON.parse` на `tryParseJson`; (б) ввести в `LlmRouter.call` опц. validate-callback; при невалидном — throw внутри dispatch → срабатывает catch → secondary (gpt-5.4-nano с реальным strict). Не зависит от поддержки strict у flash.
3. Сменить арбитра на `deepseek-v4-pro` (S/low по правке, но ❌ дорого ×12, медленно ×2.5, taskType массовый; не убирает `auto`).
4. Упростить вывод + few-shot + `json_object` (L/med): минимум полей в основном вызове, temporal/attributes — отдельно.

**Рекомендация:** **(1) + (2)** (оба класс-уровневые, без роста цены). (1) бьёт в корень, (2) — страховка если прокси не примет strict-Beta. Перед раскаткой — **мини-e2e на проде**: принимает ли `deepseek-v4-flash` через наш прокси (agent-lia) форс конкретной функции и `function.strict:true` (правило проекта — поведение фреймворка проверять эмпирически).

**Прод-пробы:** доля невалидного по `kc_block_linker_invalid_json_total{reason}` / `kc_block_linker_fallback_none_total`; для entity-graph метрик НЕТ — добавить; распределение «проза в content vs JSON-в-content vs пустой+tool_call» по `responsePreview` в `AiUsageLog`.

---

## 3. C — ChunkLoadError рушит детальные страницы

**Корень (двойной, один класс).** (1) prod-сборка идёт **Turbopack'ом** (Next 16 дефолт, флага нет — [package.json:8](frontend/package.json#L8) `"build":"next build"`, [:54](frontend/package.json#L54) `next ^16.2.6`); (2) деплой не защищён от **version skew**: `deploymentId` не задан, статика в образе, меняется неатомарно для уже открытых вкладок. Клиент со старым build-manifest делает `import()` чанка, чей реестр модулей не совпадает с текущим билдом → `Failed to load chunk … from module 964893` даже при 200 на файл.

**Доказательства:**
- Context7 Next 16: «Turbopack… used by default for `next build`»; откат — `next build --webpack`.
- `/tables/[id]` крашится **стабильно** — там единственная гарантированная клиентская lazy-граница: [TableClient.tsx:41-51](frontend/app/(authenticated)/tables/[id]/TableClient.tsx#L41-L51) `dynamic(()=>import('./components/GridView'),{ssr:false})` (glide-data-grid). `/result` — **периодически** (статический импорт плеера, lazy-границы нет).
- `deploymentId`/`generateBuildId` по frontend = пусто → штатная Next version-skew детекция (hard MPA-navigation) **не включена**.
- ОДНА фронт-реплика ([docker-compose.yml:180-211](docker-compose.yml#L180-L211), [z-frontend.conf:12-16](deploy/nginx/z-frontend.conf#L12-L16)) → классика «N реплик с разными билдами» **исключена**; рассинхрон — во времени (старый HTML vs новый образ после `--build frontend`).
- Нет `error.tsx`/`global-error.tsx` → дефолтный английский «This page couldn't load»; React #185 — вторичный (падение внутри Suspense-границы dynamic()).
- `/_next/static` отдаётся `immutable max-age=1y` ([z-frontend.conf:58-63](deploy/nginx/z-frontend.conf#L58-L63)) — удлиняет жизнь старого манифеста.

**Варианты фикса:**
- **A (S/low) 🟢:** `deploymentId: process.env.DEPLOYMENT_VERSION` (git sha) в next.config + ChunkLoadError-обработчик (один `location.reload` с защитой от цикла через sessionStorage) + `app/global-error.tsx` и локальные `error.tsx` **на русском**.
- **B (S/med) 🟢:** `"build":"next build --webpack"` — проверенное поведение чанков; **закрывает и D** (см. кросс-вывод).
- C (L/med): blue-green/общий volume для статики, ретеншн старых чанков — оверкилл при 1 реплике.
- D (M/low): пин Next + CI-smoke загрузки `/tables/[id]`.

**Рекомендация:** **A + B**. A гасит version skew штатно и убирает белый экран (тихий hard-reload, русский error UI). B снимает вероятную Turbopack-prod кварку и **одновременно чинит видео (D)**.

**Прод-проба (решает развилку):** сверить `buildId` в HTML вкладки, словившей ошибку, с текущим `buildId` сервера. Различаются → version skew (A первичен). Совпадают → чистый Turbopack-баг (B первичен).

---

## 4. D — видео-плеер не проигрывается

**Корень.** НЕ в `src`/`load`/`type` — в коде они корректны: [MeetingPlayer.tsx:95](frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx#L95) `src={{src:videoUrl,type:'video/mp4'}}`, [:101](frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx#L101) `load="eager"`. `<media-player>` Vidstack **не оживает**: React-контроллер `MediaPlayerInstance` не присоединяется к хосту → внутренний `<video>` пустой (`src=""`, networkState=0). Пропы ни на что не влияют — некому применить. **Это не deploy-gap:** прод = dev, где `8fab2fc2` есть ⇒ фикс на проде, но бессилен. Причина — **Turbopack/standalone роняет чанк регистрации Vidstack** (`sideEffects:['*.css']` помечает JS как tree-shakeable; `customElements.define` только в отдельном web-components-чанке).

**Доказательства:**
- `/recording/download` отдаёт `{url, expires_at}` с presigned S3-URL (`…/composite.mp4`) — **контракт корректен** (не редирект; проба: `200 application/json`, `keys:[url,expires_at]`), URL уходит **строкой** в плеер ([MeetingResultPageReal.tsx:207-213](frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L207-L213)).
- Видна крутилка, а не placeholder ([MeetingPlayer.tsx:66](frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx#L66)) ⇒ `videoUrl` дошёл.
- `@vidstack/react@1.13.x`: `prod/vidstack.js` — 0 вхождений `customElements.define`; регистрация — в отдельном чанке `chunks/vidstack-*.js`.
- В ТОМ ЖЕ файле уже работает **нативный** `<audio src controls preload>` для аудиодорожек ([MeetingResultPageReal.tsx:1275-1283](frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L1275-L1283)) — значит файл/CSP/кодек исправны, проблема именно в инициализации Vidstack.
- Тот же паттерн на share-страницах (ShareMeetingClient/ShareClipClient) — баг общий.

**Варианты фикса:**
1. Sanity (S/low): подтвердить свежий `--build frontend` из ветки с фиксом (вероятность deploy-gap низкая, но снять надо). → **скорее всего перейдём к (2)/Turbopack**.
2. **🟢 Нативный `<video>` вместо Vidstack** (M/low): `<video src={videoUrl} controls preload="auto" playsInline>` в MeetingPlayer + обе share-страницы; главы/хайлайты — CSS-оверлеем. Прецедент нативного `<audio>` уже работает. Самый надёжный под Next16/React19/Turbopack.
3. **`next build --webpack`** (S/med) — общий с C; вернёт инициализацию Vidstack, сохранит UX плеера.
4. Backend 302-redirect на presigned (M/med) — в связке с нативным `<video>`, не самостоятельно.

**Рекомендация:** сначала **(3) `--webpack`** (закрывает C и D одним ходом, сохраняя UX Vidstack). Если после webpack видео всё ещё мёртвое — **(2) нативный `<video>`** как гарантированный путь (минимальный UX-ущерб, есть прецедент).

---

## 5. E — качество извлечения задач (сравнительный разбор агентов)

**Что просили (эталон по 2 встречам):**
- Встреча 1: заключить 50 сделок · 200 встреч · рассылка 2 000 · нанять продажника · ему ассистента · техспеца.
- Встреча 2: 10 платящих клиентов/мес · 10 встреч-презентаций · 500 рассылок · анализ консалтинговых компаний.

**Как сработали агенты (факт из API прода):**
| Источник задач | Встреча 1 | Встреча 2 | Вывод |
|---|---|---|---|
| `summary` (MiniMax) | ✅ всё точно | ✅ точно | хорошо |
| `structuredData.tasks` (report-by-type, MiniMax) | ✅ **6 верных** | ❌ **0 задач** | НЕСТАБИЛЬНО |
| **Task-таблица** (fast + main → «Задачи»/UI) | 🔴 **4, с дублями, потеряны 200 встреч/50 сделок** | 🔴 **1 из 4** | плохо |
| IntakeIssue (meeting-extract-actions, deepseek-v4-flash) | 6 (приемлемо) | — | отдельный экстрактор |

**Корень (3 причины):**
1. **3 несогласованных источника задач** с разным качеством. UI-таблица берёт задачи из **слабых** экстракторов (fast = meeting-report-fast, main = analyze action-items), а НЕ из качественного `structuredData.tasks` (когда тот даёт 6 верных — таблица всё равно показывает слабые 4).
2. **Слабый дедуп** — [task.ts:58-68](frontend/src/domain/task.ts#L58-L68) `pickPrimaryTasks` нормализует только `trim+lowercase` → не схлопывает:
   - «Сделать рассылку на **2000**…» (fast) vs «…на **2 000**…» (main) — отличие в пробеле-разделителе тысяч;
   - «Набрать команду (…)» (fast) vs «Набрать команду» (main).
3. **Слабые экстракторы на коротком тексте + ошибки ASR.** ASR (vox) врёт на числах/терминах: «выйти на **стопящих** клиентов» (=100 платящих), «через 10 **минусов**» (=месяцев), и отдаёт 0 пословных таймингов. Искажённый вход → беднее извлечение.

**Сравнение «прогнал бы сам»:** структурный агент (MiniMax) на встрече 1 уже дал **все 6 верных** — значит capable-модель + хороший промпт ЗАДАЧУ ТЯНУТ. Слабое звено — что UI-таблица питается не им, плюс дедуп и нестабильность.

**Варианты фикса:**
1. **🟢 Единый источник задач для UI** (M): таблица Task ← `structuredData.tasks` (capable-модель) ИЛИ один сильный экстрактор; убрать конкуренцию fast/main в пользовательской поверхности (fast — только для «мгновенного» предпросмотра, помечать, не плодить Task-строки).
2. **🟢 Сильный дедуп** (S): нормализация перед сравнением — убрать пробелы/разделители в числах, привести «2 000»/«2000», обрезать скобочные уточнения, опц. семантическая дедупликация по эмбеддингу для близких заголовков.
3. **Capable-модель на task-экстракцию** (S через роутинг): для `meeting-extract-actions`/tasks поднять на `deepseek-v4-pro`/MiniMax (как структурный) — она стабильнее вытаскивает конкретику; оценить цену (taskType не такой массовый, как граф).
4. **ASR-качество** (M/L, отдельно): нормализация чисел/терминов постобработкой LLM; разобрать word-timestamps (связано с S5-02). Это улучшит вход для ВСЕХ агентов.
5. **Полнота-валидатор** (S): после извлечения — лёгкая проверка «сколько явных поручений в тексте vs извлечено», ретрай при недоборе.

**Рекомендация:** (1)+(2) первоочередно (архитектура источника + дедуп — дают видимый эффект сразу), (3) — поднять модель task-экстрактора, (4) ASR — отдельным треком (улучшает всё).

---

## 6. UX отчёта — «открывается, но сделан неправильно»

**Запрос владельца:** отчёт должен быть **виден подробно** (печататься ниже, не только в модалке), и в нём нужна возможность **скачать** или хотя бы **скопировать текст**.

**Текущее состояние (факт):** «Открыть» у основного отчёта поднимает **модалку** «Командная встреча» (Задачи/Решения/Обсудили) — контент есть, но **нет кнопок «Скопировать»/«Скачать» внутри** и нет развёрнутого инлайн-просмотра под видео. В шапке страницы есть «Скачать»/«Поделиться», но это про страницу, а не про конкретный отчёт.

**Фикс (S/M, low):**
- В диалоге отчёта (и/или инлайн-блоке под видео) добавить: **«Скопировать текст»** (plain-text/markdown рендер структуры) и **«Скачать»** (.md/.txt/.pdf).
- Дать **развёрнутый просмотр отчёта на самой странице** (аккордеон/секция «Отчёт целиком»), а не только модалкой.
- Сгенерировать читаемый текстовый вид из `structuredData` (тот же модуль `structured-report.tsx`, что уже даёт русские заголовки).

---

## 7. Прод-пробы, нужные до/во время ТЗ (read-only)
1. **A:** `webhook_seen_event`/`meeting_event` встречи 1 (какие вебхуки между 11:21–11:39, когда реально пришёл `egress_ended`); логи контейнера LiveKit Egress; рестарт backend в окне; реальный `LLM_ROUTER_DISPATCH_TIMEOUT_MS`.
2. **B:** мини-e2e на прокси agent-lia — принимает ли `deepseek-v4-flash` форс `tool_choice` конкретной функции + `function.strict:true` (если 400 → опираться на router-fallback). Снять `kc_block_linker_*` метрики.
3. **C:** сверить `buildId` HTML-вкладки с ошибкой vs сервера (skew vs Turbopack-баг); частота `--build frontend`.
4. **D:** локальный prod-билд (`next build` + `next start`, НЕ dev) — воспроизводится ли пустой `<video>`; грузится ли чанк инициализации Vidstack (Network); тот же ли баг на share-страницах.

---

## 8. Предлагаемая разбивка на ТЗ (после проб)
- **ТЗ-1 (🔴 фронт-стабильность):** `next build --webpack` + `deploymentId` + ChunkLoadError-ретрай + русские `error.tsx`/`global-error.tsx` + (если webpack не оживил видео) нативный `<video>`. **Закрывает C и D.**
- **ТЗ-2 (🔴 надёжность записи/пайплайна):** composite-egress reconcile-крон + ack-first вебхуки + метрика gap. (опц. block-linker параллелизм — мелким довеском.)
- **ТЗ-3 (🟠 граф):** форс tool-call+strict для flash + parse-fail→router-fallback + `tryParseJson` в entity-graph + метрика entity-graph.
- **ТЗ-4 (🟠 задачи):** единый источник задач для UI + сильный дедуп + capable-модель task-экстрактора + (трек ASR-качества отдельно).
- **ТЗ-5 (🟡 UX отчёта):** копировать/скачать + развёрнутый просмотр.

> Решения владельца, которые нужны перед ТЗ: (а) webpack vs остаться на Turbopack+deploymentId; (б) нативный `<video>` vs спасать Vidstack (UX-плеера); (в) поднимать ли модель task-экстрактора (цена) и какой источник задач сделать единым.

---

## 9. Модели и роутинг — «DeepSeek primary везде для кэша» (АУДИТ прод-БД + код)

**Запрос владельца:** чтобы везде первая модель была DeepSeek → работает prompt-кэш → на длинных встречах дешевле.

**Факт (прод-БД, `diag-routes.ts`, 130 taskType):**
- ✅ **119/130 — DeepSeek primary** (`deepseek-v4-flash` дёшево / `deepseek-v4-pro` capable). Пайплайн встречи в БД: `summary`→pro, `summary-v2`→pro, `meeting-report-fast`→pro, `tasks`/`chapters`/`meeting-extract-actions`→flash.
- ⚠️ **11/130 — НЕ DeepSeek primary:** `axis-classify`, `proactive-message-craft`, `role-completeness-rationale`, `telegram-reply-classify` → `ollama:qwen3.5:9b`; `brand-voice-extract`, `orchestrator-synthesize` → `gpt-4o`; `clip-title`, `meeting-quality-score` → `gpt-5.4-nano`; `concierge-respond` → `gpt-5-mini`; `debate-curation-verify-supporter`, `debate-decision-supersede-supporter` → `gpt-5.4*` (намеренно — diversity в debate).

**🔴 ГЛАВНОЕ РАСХОЖДЕНИЕ (конфиг ≠ факт): главный отчёт идёт МИМО DeepSeek-роутинга, на MiniMax.**
- Факт прогона ОБЕИХ встреч (`diag llm-calls`): `summary/-`, `report-by-type/-`, `tasks/-` → **`minimax:MiniMax-M2.5`**, хотя в БД для них стоит DeepSeek, а MiniMax в маршрутах **вообще нет**.
- Корень: [analyze.worker.ts:94](backend/src/modules/ai/workers/analyze.worker.ts#L94) (главный отчёт) использует **`LlmFallbackService`**, а НЕ БД-роутер `LlmRouterService`. В [llm-fallback.service.ts:12-61](backend/src/modules/ai/services/llm-fallback.service.ts#L12-L61) **primary = MiniMax** (исторически Anthropic→РФ-403→MiniMax, коммит `bb11babf`). Так что `summary`/`report-by-type`/`follow-up`/`custom`/`tasks(/-)` **всегда на MiniMax** — кэш DeepSeek тут НЕ работает.
- Новые агенты (`meeting-report-fast`, `chapters`, `meeting-extract-actions`, `tasks/tasks`) идут через `LlmRouterService` → DeepSeek ✅ (тут кэш работает).

**Цена прогона (факт, 1 встреча):** report-fast (deepseek-v4-pro) $0.012–0.016 (самый дорогой+медленный 37–72с); summary/report/tasks (minimax) ~$0.0005–0.001; flash-агенты ~$0.0003.

**Варианты:**
1. **🟢 Перевести главный отчёт (`analyze.worker`) с `LlmFallbackService` на `LlmRouterService`** (M/med) → `summary`/`report-by-type` пойдут на `deepseek-v4-pro` (как в БД) → единый DeepSeek-кэш на весь пайплайн. Риск: те же json_schema-кваки DeepSeek (см. §2) — но отчёт в основном free-text, риск ниже; нужны тесты вывода.
2. Оставить MiniMax, но осознанно (S): MiniMax тоже поддерживает `cacheControl` ([llm-fallback.service.ts:59](backend/src/modules/ai/services/llm-fallback.service.ts#L59)) → кэш есть, но НЕ DeepSeek (другой провайдер, другая экономика). Если цель — именно единый DeepSeek-кэш, не подходит.
3. Привести 11 не-DeepSeek taskType к DeepSeek, где это не диверсификация (S, через сид/админку): `axis-classify`, `meeting-quality-score`, `clip-title` — кандидаты; debate-supporter/orchestrator оставить (diversity).

**Рекомендация:** (1) — это и есть «DeepSeek везде» для пайплайна встречи; (3) точечно для 2-3 классификаторов. **Прод-проба:** убедиться, что перевод не ломает формат отчёта (мини-e2e), и сверить экономику pro-кэша vs MiniMax на длинной встрече.

---

## 10. Видео — ЭМПИРИЧЕСКИЙ ТЕСТ для решения (выполнен на проде)

Владелец: «нужны тесты, чтоб точно проигрывалось, может плеер поменять на надёжный».

**Тест (Playwright, прод):** в живую страницу вставлен нативный `<video src={presignedUrl}>` с реальной ссылкой записи → **результат:**
```
readyState: 4 (HAVE_ENOUGH_DATA) · networkState: 2 · duration: 90.6с
videoWidth×Height: 1280×720 · played: true · error: null
```
**Вывод (решающий):** файл/кодек/CSP/presigned-URL — **полностью исправны**, нативный `<video>` **играет**. Сломан ТОЛЬКО Vidstack (не инициализируется). ⇒ **Решение обосновано тестом: заменить плеер на нативный `<video>`** (надёжно, без зависимости от регистрации web-компонента под Turbopack). Альтернатива — сначала `next build --webpack` (может оживить Vidstack, §0/§4), но нативный `<video>` — гарантированный путь. (Примечание: на машине владельца активен Kaspersky-инъектор `kaspersky-labs.com` в страницу — на воспроизведение `<video>` не влияет, но кросс-доменный `fetch` к S3 он режет.)

---

## 11. AI-агенты + ПЛОХАЯ ТРАНСКРИПЦИЯ — глубокий разбор и как чинить в промпте

### 11.1 Что выдали агенты на 2 реальных встречах (сравнение)
| Источник задач | Встреча 1 «тестоая» | Встреча 2 «тест сте» |
|---|---|---|
| `summary` (MiniMax) | ✅ всё точно | ✅ точно |
| `structuredData.tasks` | ✅ 6 верных | ❌ 0 |
| **Task-таблица (UI)** | 🔴 4 с дублями, потеряны 200 встреч/50 сделок | 🔴 1 из 4 |

### 11.2 Корень «плохой транскрипции» (ASR врёт, и это никто не чинит)
- ASR `vox:v3_e2e_rnnt` мис-распознаёт: «выйти на **стопящих** клиентов» (=100 платящих), «через 10 **минусов**» (=месяцев), 0 пословных таймингов.
- Шаг очистки [transcript-clean-refine.ts:27-38](backend/src/modules/ai/services/prompts/transcript-clean-refine.ts#L27-L38) **намеренно НЕ исправляет** ASR: правило 2 «НЕ исправляй орфографию — ASR уже сделал», правило 5 «числа/имена — никаких изменений». То есть искажения проходят дальше **как есть**.
- В framing-хелперах [common.ts](backend/src/modules/ai/services/prompts/common.ts) есть преамбула Коры, инъекшн-гард, confidence-шкала, edge-case, room-chat — но **НЕТ ни одной ноты про ASR**. Модели нигде не сказано «это распознавание речи, возможны ошибки в числах/именах/терминах — восстанавливай смысл по контексту».
- **Контекст компании не инъектится** в summary/report: [glossary.ts](backend/src/modules/ai/services/prompts/glossary.ts) даёт только абстрактные термины (pain/objection), не людей/продукты/проекты. Только `meeting-extract-actions` грузит org-контекст ([meeting-extract-actions.service.ts:413-449](backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L413-L449)), но summary/report-by-type — нет.

### 11.3 Демонстрация «прогнать тот же prompt» (как просил владелец)
Гарбленый ASR-вход встречи 2: «наша цель… захватить через 10 минусов 10% рынка… выйти на стопящих клиентов… в первый месяц 10 платящих клиентов… 10 встреч-презентаций… 500 рассылок… ниша — консалтинговые компании… проведём анализ».
- **Текущий агент (без ASR-ноты, без контекста):** Task-таблица = 1 задача «Провести анализ…», потеряны клиенты/встречи/рассылки.
- **Прогон с ASR-нотой + контекстом (модель-ceiling):** корректно восстанавливается «выйти на **100 платящих** клиентов/мес», «провести **10** встреч-презентаций», «сделать **500** рассылок», «провести анализ консалтинговых компаний (где, размер)»; «10 минусов»→«10 месяцев». То есть **тот же транскрипт даёт полный набор задач, если в промпте сказать про ASR-ошибки и дать контекст (продажи/консалтинг, числовые ориентиры).**

### 11.4 Как чинить (промпт + архитектура)
1. **🟢 ASR-нота во все meeting-промпты** (S): новый хелпер `withAsrNote(system)` — «Текст — результат ASR; возможны ошибки в числах (‘100’↔’сто’), именах, терминах и единицах. Восстанавливай вероятный смысл по контексту встречи; нормализуй числа (‘2 000’=‘2000’).» Применить к summary/report-by-type/tasks/extract-actions.
2. **🟢 Инъекция org-контекста в summary/report** (M): прокинуть людей/проекты/цели/продукты (как уже делает extract-actions) в summary/report-by-type — модель цепляет имена/термины и не теряет конкретику.
3. **Единый источник задач для UI + сильный дедуп** (M, см. §5): UI-таблица ← один сильный экстрактор; нормализация дедупа (числа без пробелов, срезать скобки), опц. семантический дедуп.
4. **Capable-модель на task-экстракцию** (S через роутинг): `tasks`/`meeting-extract-actions` → pro/структурный (стабильнее на коротком тексте).
5. **(глубже) ASR-correction шаг** (M/L): отдельный LLM-проход, исправляющий числа/имена/термины по глоссарию компании ДО агентов (или расширить мандат transcript-clean-refine). Самый радикальный, но бьёт в корень для ВСЕХ агентов.
6. **(инфра) Качество ASR** (L): оценить смену модели vox / добавить domain-bias (словарь терминов/имён компании в ASR), разобрать word-timestamps (S5-02).

### 11.5 Тест-харнесс для агентов (чтобы «гонять синтетику»)
Чтобы прогонять агентов на синтетических транскриптах без реальных встреч — нужен харнесс (есть задел [combat-test-harness.md](../../plans/tz/2026-06-04-combat-test-harness.md)): набор эталонных транскриптов (чистый + гарбленый-ASR) + golden-ожидания (задачи/решения), прогон через реальные промпты, скоринг полноты/точности/дублей. Это даёт регрессионный замер ДО/ПОСЛЕ правок промптов и моделей. Рекомендуется как отдельное ТЗ-6.

### 11.6 Добавки к разбивке ТЗ (§8)
- **ТЗ-4 (задачи)** расширить: + ASR-нота + org-контекст в summary/report.
- **ТЗ-6 (новое):** агент-тест-харнесс (синтетика + golden + скоринг) для регрессии качества AI.
- **ТЗ-7 (новое, опц.):** перевод главного отчёта `analyze.worker` `LlmFallbackService`→`LlmRouterService` (DeepSeek-кэш везде) + точечная унификация 2-3 классификаторов на DeepSeek.
