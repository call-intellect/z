# Лучшая архитектура извлекающего слоя — финал, технический (доказано, TZ-ready)

> Дата: 2026-06-30 · Тип: analysis · Парный человеческий файл: [FINAL-plain](2026-06-30-extraction-best-architecture-FINAL-plain.md)
> Приоритет: **точность/достоверность → надёжность → стоимость** (стоимость вторична; рефактор санкционирован); инвариант — **no-regression** существующего.
> Метод: 3 многоагентных прохода (выбор+доказательство архитектуры · no-regression по коду) + 2 веб-разведки (KG/GraphRAG; chunk-size 2025-2026) + состязательная проверка. Все факты — `файл:строка` или источник.
> **Следующий шаг (TZ-ready нырок в код):** [2026-06-30-extraction-change-map-pre-tz.md](2026-06-30-extraction-change-map-pre-tz.md) — карта изменений по work-packages (сейчас→станет→режем→откат→приёмка), перепроверена по живому коду 18 агентами; там же §0.1 — поправки к фактам этого файла (ProcessTemplate-строитель частично есть; примитив derive-by-signalType уже написан но не подключён; типов объяснено 14 а не 15; рубильник `SPECIALISTS_COMBINED_ENABLED` сейчас не выключается через ENV).

## 1. TL;DR

- **Победитель: C4 (гибрид)** — единогласно у 3 судей (линзы: точность / надёжность / целостность графа). Состязательный критик подтвердил C4 **как цель**, но опроверг как **единый пакет** → выкат **последовательностью с A/B-гейтами**.
- **C4 = C2-база** (тонкий спайн + один когерентный комбо-извлекатель + `derive-from-graph-by-signalType` + снос обходчиков хаба) **+** реестр few-shot определений типов **+** сшивка нити по графу (overlap/by-turn/coreference/gleaning) **+** хронологическая сверка разворота **+** процедурный слой шаг→шаг **+** несколько глубоких дериверов на надёжность-критичных семействах.
- **Статус-кво (важно):** комбо **уже основной путь для 9 типов** в проде — `SPECIALISTS_COMBINED_ENABLED` default `true` ([env.schema.ts:404](../../backend/src/common/config/env.schema.ts#L404), [typed-config.service.ts:1014](../../backend/src/common/config/typed-config.service.ts#L1014), [feature-flags.md:214](../../docs/operations/feature-flags.md) — kill-switch ON с 2026-06-20). `knowledge-core.md:838` («не включён») — устарело, верить коду.
- **Размер куска:** «мелко» — **верно** (не устарело); настоящий фикс — сшивка нити по графу, не больший контекст. Движок — **Claude Opus 4.x**.

## 1.1 Решения владельца (2026-06-30)

- **Build-all-at-once:** строить всю целевую архитектуру одним заходом; единственный хард-констрейнт — снос старого пути только ПОСЛЕ доказанного паритета нового (build-then-delete), откат через kill-switch, подтверждение через A/B. «Фазы ради осторожности» не нужны; причинные зависимости (R1/R2/R4/R5) — нужны.
- **Хроносверка — ОБА axis (Decision + факты).** Реализация: **поставщик вердикта** в существующих писателей (`specialist-3-3` для Decision, `FactSupersedeService` для IdeaBlock), НЕ параллельный писатель (см. R7).
- **me-tasks — гибрид:** прямой `Issue.create` сохраняется, но через единый дедуп-guard по `sourceBlockId`/контенту + provenance-ссылка в граф.

## 2. Почему C4 — баллы судей

| Кандидат | Точность | Надёжность | Стоимость | Итог |
|---|---|---|---|---|
| C0 статус-кво+патчи | 3-6 | 3-7 | 9 | не лечит корень/консервирует хаос |
| C1 мега-агент | 2-3 | 2 | 3-5 | убивает атом памяти, дедуп, граф — отвергнут |
| C2 спайн+комбо+derive | 7-8 | 6-8 | 8-9 | верный хребет, не закрывает 4 дыры достоверности |
| C3 рой узких агентов | 6 | 6-7 | 4 | дубль-карточки (доказано), цена — отвергнут как база |
| **C4 гибрид** | **9** | **8-9** | **5-7** | **ПОБЕДИТЕЛЬ** |

**Доказательство «комбо > рой» (`SUMMARY-BPLUS-VS-G.md`, замер 18:13/3.7×):** это про **когерентность, не recall** — coverage 4:4 поровну (41 vs 42 сущности), комбо выиграл accuracy/structure/detail; **единственная галлюцинация у роя** — `blk_032` продублирован в двух traitType с одной цитатой. Вывод: рой структурно плодит дубль-карточки и null-провенанс; комбо читает кусок раз → когерентная типизация. **Валидность ограничена:** n=1 синтетика, судья = та же модель, 8/10 семейств (без goals/tasks), без чат-реплик. → доказывает только **базу C2**, не 5 добавок C4.

**Что C2 в чистом виде НЕ закрывает (отсюда C4):** (а) 42 из 57 signalType без определения в теле промпта (`block-ingest.prompt.ts:44-45` — friction только в enum); (б) арка/разворот (независимые окна); (в) ребра шаг→шаг нет в `IdeaBlockLinkType` вообще; (г) gleaning отсутствует.

**Глубокие агенты ≠ возврат к рою:** они — L5-деривативы из графа (или отдельные проходы), не дубль-извлекатели из сырья; только для 3 семейств: решения/разворот, конфликты, процедуры. Остальное — один комбо.

## 3. Целевая архитектура

**Слой 1 — тонкий спайн (общий, дёшево, один раз):** нарезка по репликам (не by-token) + провенанс (цитата+время+rawEventId) + entity-resolution + эмбеддинг + грубый роутинг на 5-6 семейств **для пробуждения**, НО точный `signalType` остаётся на `IdeaBlock` (от него зависит `router.matchSpecialists`, GOALS=commitment|plan_item, TASKS=action_item). **Сшивка нити:** overlap окон, отдельный воркер кореференции/глобального entity-resolution, кросс-оконная достройка рёбер по графу, gleaning.

**Слой 2 — извлечение:** один **комбо** на массу семейств (канало-агностичный) + **глубокие деривёры** на решения/разворот, конфликты, процедуры. **Реестр few-shot** определений 57 типов.

**Движок:** Claude Opus 4.x (лучший multi-needle@1M = 76% vs ~18-26%; самый низкий уровень галлюцинаций + abstain — под приоритет «достоверность важнее полноты»), фильтр по dataClass в llm-router.

**Крутилки** (размер сегмента/окна, overlap, пороги дедупа, min-длина сегмента) → AdminSetting (`getDynamic`/`resolveSync`), не ENV, не магия в коде (CLAUDE.md §9).

## 4. Размер куска — вердикт (разведка 2025-2026)

- Наша задача — **latent-association extraction** (низкое лексическое сходство «вопрос↔факт»): эффективная длина **2K-8K токенов** даже у топ-моделей (NoLiMa ICML 2025: Claude 3.5 = 4K, Gemini = 2K). Whole-doc извлечение = **22 узла vs 78 чанком (×3.5 потеря)**; LongMemEval: длинный диалог роняет recall, Claude abstain'ит.
- **Lost-in-the-middle не решён** (RoPE decay). Эффективное окно ≈ 50-65% заявленного.
- **Вывод:** мелкая нарезка верна. Наши 3000 ток. даже консервативны (безопасный потолок ~8-12K — можно умеренно укрупнить, но для точности не нужно). Фикс — **сшивка нити по графу**: overlap (SLIDE +24%/+39%), by-turn нарезка, отдельный coreference-проход, gleaning. **Не** whole-episode.
- **Кэш не аргумент за большой контекст:** на разных встречах общий префикс — только инструкция/схема; контент уникален; TTL 5 мин. (Подтверждает прошлый вывод.)
- **Свой A/B обязателен** (чужие пороги — ориентир): needle-in-the-middle на реальных транскриптах (позиции 1/5/10/15/20), overlap встык vs перекрытие, by-token vs by-turn — как **регресс-гейт качества**.

## 4.1 Нарезка и сшивка нити — 6 приёмов в 3 слоя (конкретный дизайн, владелец: «всё сразу»)

Резать **by-turn/семантически, не by-token**. Все параметры (overlap, размер окна, порог gleaning, min-длина сегмента) → AdminSetting.

**Слой 0 (дёшево, сразу):**
1. **Overlap между окнами** — переносить хвост ~1-2 реплик в начало следующего окна. Сейчас overlap держится только внутри speaker-группы (`segment-builder.service.ts:325-337`), а окна режутся встык (`block-extraction.service.ts:407-408`).
2. **Позиция окна** — передавать `windowIndex/total` в промпт; сейчас считается, но идёт только в логи (`block-extraction.service.ts:416`, в `buildBlockIngestPrompt` не попадает).
6. **Gleaning** — 1-2 раунда self-reflection в `processWindow` (`block-extraction.service.ts:456+`); порог min-длины сегмента → короткие чат-реплики в лёгкий путь (R13).

**Слой 1 (главный рычаг, ОДНА фича):**
3+4. **Episode skeleton → contextual header.** Дешёвый первый проход по эпизоду → оглавление (темы/кто/решения-в-работе) → релевантный срез в шапку каждого окна. Расширить `chunk-context.service.ts` (сейчас статичная мета: источник/дата/участники) бегущим резюме «что обсудили до этого куска». Это работа тонкого спайна. (Anthropic Contextual Retrieval: −до 49% провалов извлечения.)

**Слой 2 (страховка разворота):**
5. **Хронологическая сверка** по `IdeaBlockEvidence.sourceTimestamp` эпизода → вердикт в `FactSupersedeService.applySupersedes` / `specialist-3-3` supersede-tx (**один писатель на ось**, R7). Покрывает **Decision И факты** (решение владельца).

**Принцип:** арку восстанавливаем структурой графа/оглавлением, не размером окна (§4). Размер сегмента ~600 верен; потолок окна ~8-12K (можно укрупнить ради меньшего числа швов, не ради точности — решает A/B).

## 5. Регрессии и митигации (по живому коду — проход 2)

| # | Риск | Severity | Evidence | Митигация |
|---|---|---|---|---|
| R1 | Комбо **не пересобирает профили** (clone/skill застынут) | 🔴 critical | `specialist-3-2…:109` / `3-7…:126` enqueue rebuild; в `specialists-combined.service.ts` ноль enqueue | До сноса поблочных — ставить те же rebuild-job по personId из комбо-пути |
| R2 | Комбо **meeting-only** → чат/Bitrix/doc без 9 типов; **главный канал** | 🔴 critical | `block-distill.worker.ts:197-256` (enqueue только при meetingId; `resolveMeetingIdForBlock` фильтрует `sourceType='meeting'`); `router.service.ts:190-192` вырезает COMBINED_COVERED | Сделать комбо канало-агностичным (`{rawEventId\|episodeId}`) ДО сноса; промпт `channelKind` |
| R3 | Деградация на 3-словных репликах **не измерена** | 🔴 critical | `chat-ingest.service.ts:58-71` (1 msg=1 RawEvent, segment endMs=0) | A/B на реальном чате; min-длина сегмента (AdminSetting) → короткое идёт лёгким путём |
| R4 | Снос `meeting-extract-actions` = **полная потеря задач из встреч** | 🔴 critical | LIVE `analyze.worker.ts:399-404`→`meeting-extract-actions.service.ts:425`; `specialist-3-15` скипает meeting-блоки (`:93-106`). (`operational-inspectors-cleanup.md:50` зовёт его «мёртвым» — неверно, верить коду) | Не сносить, пока унифицированный извлекатель не покрыл встречи с identity-резолвом по участникам |
| R5 | Деградация дашбордов конфликтов при сносе regex **до** обучения нарезчика | 🟠 high | нарезчик не метит friction (`block-ingest.prompt.ts:44-45`); `PersonalRelationBuilder` голодает (`:84,96`); burnout `:208-216`, operations `:752-772`, team-health `:107-115` | Порядок-гейт: научить нарезчик friction → усилить PersonalRelationBuilder (вторая сторона = `IdeaBlockEvidence.authorPersonId`, снять ≥2) → A/B паритет рёбер → снос regex |
| R6 | Потеря **ProcessTemplate** (шаг→шаг) при сносе process-detector | 🟠 high | `router.service.ts:95` (PROCESS_DETECTOR в COMBINED_COVERED, уже отфильтрован) но комбо его не строит (только Regulation/Instruction) | Вернуть в комбо ProcessTemplate-секцию **или** убрать из COMBINED_COVERED (строить поблочно) — нужно для C4-этапа процедур |
| R7 | **Второй писатель** в граф (хроносверка) | 🔴 critical | один писатель на ось: `fact-supersede.service.ts:405` (IdeaBlock.validUntil, Redis-лок+скептик), `specialist-3-3:368-393` (Decision), `temporal-conflict.service.ts` (*Link) | Хроносверка — **поставщик вердикта** в существующего владельца оси, не писатель. Если пишет — tx+`updateMany WHERE validUntil IS NULL`+Redis-лок. Дедуп ConflictItem по `(tenant,resourceType,existingId,newId,relationType)` |
| R8 | Дубли задач при унификации (3 контура, разный дедуп) | 🟠 high | meeting-extract (vector 0.85+sha1), telegram-parser, `me-tasks.service.ts:100,157` (Issue напрямую, без дедупа) | Единый дедуп-guard по `sourceBlockIds` для всех писателей ДО сноса любого |
| R9 | Осиротевшие воркеры/очереди | 🟠 high | `specialist-routing-dispatcher.worker.ts:83-104,150-152` (throw на неизвестный jobName) | Чистить router (COMBINED_COVERED/PRIORITY/SPECIALIST) + register-карту + удаление воркера **атомарно** в одном коммите |
| R10 | Смена enum `SignalType`→реестр-строку ломает tsc | 🟠 high | full `Record<SignalType,…>` SIGNAL_TYPE_CONTEXT_RU (`chat-v2.service.ts:292`), гард `signal-type-label.spec` | **Не менять enum.** «42 немых» лечатся few-shot в промпте. Добавить `satisfies readonly SignalType[]` к SIGNAL_TYPE_VALUES |
| R11 | Few-shot сдвигает распределение типов на истории | 🟠 medium | тип, что «угадывался» fact → станет objection/friction | Baseline частот signalType до → diff после; следить за роутингом |
| R12 | Процедурное ребро: `ALTER TYPE ADD VALUE` нельзя в той же tx + нет ретро-backfill | 🟡 low | шаблон `20260623120000_add_signaltype_action_item` | Отдельная миграция, регистрация в `apply-prod-deploy STEPS`, без same-tx backfill |
| R13 | gleaning на коротких репликах = пустые повторы, рост стоимости | 🟡 low | чат: 1 реплика = 1 окно | Порог min-длины; gleaning только выше порога |
| — | `meeting-report-fast.tasks` — **мёртвый выход, сносить безопасно** | ✅ | `meeting-report-fast.worker.ts:346` только логирует | Убрать синхронно со схемой/.strict()-промптом |

## 6. Безопасный порядок миграции (strangler-fig)

1. **Канало-агностичный комбо + перенос 4 побочек** (rebuild профилей, decision-hygiene, ProcessTemplate) при живых поблочных. Kill-switch `SPECIALISTS_COMBINED_ENABLED` → в AdminSetting (сейчас только ENV) для мгновенного отката без передеплоя.
2. **Реестр few-shot определений** 42 «немых» типов (enum не трогать; `satisfies` + обновить ~39 snapshot-тестов). Baseline распределения.
3. **Научить нарезчик метить friction** + усилить PersonalRelationBuilder (поблочные и regex ещё живы).
4. **A/B на реальном чате** через kill-switch (ON=combined / OFF=поблочные): сущности/RawEvent, паритет рёбер `conflicted_with`, паритет задач/конфликтов из чата (до=после), стоимость gleaning. Свежий замер с goals/tasks в комбо (расширение tool инвалидирует prompt-cache).
5. **Только при зелёном A/B — физический снос** обходчиков, каждый **отдельным blueprint→ТЗ** (конфликты | задачи | commitment-соцслой | ThemeSilence), не бандлить (INDEX §5). Снос regex-детектора — после friction-гейта (§3).
6. **commitment-соцслой** (promise-keeper/cascade/network) — по готовому `commitment-task-unification` (снизу вверх, 7 DI-потребителей синхронно; не трогать commitment→GOALS `router.service.ts:426-429`).
7. **Хроносверка — последней**, через существующих писателей (R7).
8. **gleaning + сшивка нити** (overlap/by-turn/coreference) — с A/B и порогом min-длины.

Держать как откат до подтверждённого паритета **на реальном чат-трафике**: kill-switch combined; 13 поблочных мастеров физически НЕ удалять; regex-детектор не сносить до зелёного friction-A/B.

## 7. A/B-гейт (спека) — на РЕАЛЬНОМ канале, не на синтетике

Метрики уже есть: `temporal_edges_invalidated_total`, `kc_fact_supersede_verdict`, `decision_supersede_chain_length`, `risk_edge{relation,outcome}`. Мерить ДО/ПОСЛЕ на telegram/Bitrix:
- извлечено сущностей на чат-RawEvent (полнота+качество); needle-in-the-middle на наших транскриптах;
- рождаются ли `conflicted_with` из графа ≥ regex;
- паритет задач/конфликтов из чата (потеря в окне миграции);
- сдвиг распределения signalType после few-shot;
- стоимость/latency gleaning на коротких репликах;
- ложные skill/helpfulness по клиенту в Bitrix (channelKind);
- abstain-поведение Opus: не теряем ли реальные имплицитные решения.
**Сделать регресс-гейтом knowledge-core, не разовым замером.**

## 8. Открытые вопросы (до blueprint/tz-author)

1. **Gate цепочки:** `tz-author` требует approved-blueprint в `plans/architecture/` — сейчас есть только analysis. Нужен blueprint по C4 (по шагам §6, каждое слияние отдельно).
2. **Хроносверка — уровень:** факты / решения / оба? (определяет, через какого писателя оси заводить — `FactSupersedeService` или `specialist-3-3`).
3. **me-tasks** (прямой `Issue.create` без дедупа) — в хаб или оставить? Решение владельца.
4. **Расхождение доков:** `feature-flags.md:214` (combined ON) vs `knowledge-core.md:838` (не включён) — обновить второе.
5. Рассинхрон дефолтов `blockIngestMaxTokensPerSegment` 2000(env)/1500(seed) — выровнять.

## 9. Источники

- Воркфлоу-проходы: выбор архитектуры (3 судьи + критик), no-regression (4 проверки по коду), chunk-size 2025-2026, KG/GraphRAG.
- Первоисточник замера: `backend/test/eval/specialists-experiment/reports/SUMMARY-BPLUS-VS-G.md` (18:13/3.7×, blk_032).
- Анализы: [block-ingest-audit](2026-06-29-block-ingest-extractor-design-audit.md), [conflict-detection-hub](2026-06-29-conflict-detection-through-graph-hub.md), [inventory](2026-06-29-extraction-agents-inventory-and-modular-standardization.md), [plain+collapse](2026-06-29-agents-plain-language-and-collapse-thesis.md), [INDEX](2026-06-29-agents-modularization-INDEX.md), unified-extraction-spine, task-extraction-pipeline-unification, commitment-task-unification.
- Внешний ресёрч: NoLiMa (ICML 2025, arxiv 2502.05167), Chroma Context Rot/LongMemEval (2025), GraphRAG (2404.16130), Zep/Graphiti (2501.13956), EDC (2404.03868), AutoSchemaKG (2505.23628), ODKE+ (2509.04696), SLIDE (2503.17952), CrossAug (2605.28004), ofox.ai/particula long-context benchmarks 2026.
