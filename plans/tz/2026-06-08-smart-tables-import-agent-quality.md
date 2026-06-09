---
type: tz
status: ready-to-implement
feature: smart-tables-import-agent-quality
date: 2026-06-08
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-08-smart-tables-live-test-and-agent-quality.md
  - plans/tz/2026-06-02-smart-tables-auto-creation.md
  - second-brain/01_projects/smart-tables.md
---
> Анализ-источник: `plans/analysis/2026-06-08-smart-tables-live-test-and-agent-quality.md` (живой тест на проде, 10 прогонов) · Статус согласования: 2026-06-08

# ТЗ — Качество агента умных таблиц: детерминированные пост-пассы поверх LLM (Document-to-Table)

## Цель

Поднять надёжность и точность цепочки **Document-to-Table** (импорт Excel/CSV →
3-pass инференс схемы → cosine-dedup → строки) за счёт **детерминированных
пост-проверок поверх LLM**: LLM классифицирует, код сверяет результат с реальными
данными колонок, которые на этом пути уже на руках.

Четыре улучшения (все доказаны прогонами на проде, см. анализ):

- **R1 — Retry pass-1 (DRAFT).** Сейчас сбой первого пасса = жёсткий `400` без
  повтора. Док-во: импорт «Реестр рисков» упал `table_schema_generation_failed`,
  тот же файл прошёл со 2-й попытки. Цель: hard-fail импортов **~10% → ~1–2%**.
- **R2 — Полнота опций select/status из данных.** LLM теряет «хвостовые»
  значения (в проде: «Отказ» в стадии клиентов, «Прочее» в услуге поставщиков).
  Цель: полнота опций **~78% → ~100%** на tabular-импорте.
- **R3 — Сигнал пересечения колонок (Jaccard) в dedup.** При переименовании
  схемы агентом cosine не находит очевидного слияния (в проде: «Идеи и бэклог» →
  агент назвал «Запросы и пожелания», колонки идентичны, кандидат не найден).
  Цель: **~11%** импортов перестают плодить таблицу-дубль.
- **R4 — Type-guard по сэмплу значений.** Точечный misfire типа на неоднозначной
  колонке (в проде: «Результат» со свободным текстом → тип `date`). Цель: поймать
  **~100%** tabular type-misfire (`date/number/currency/percent`), которые не
  парсятся из данных.

## Зачем (болезненное состояние → решение)

Document-to-Table — **единственный живой путь создания таблиц** (Text-to-Schema
через Concierge выключен флагом `feature.tables_text_to_schema`, проверено на
проде `403 feature_tables_text_to_schema_disabled`). На этом пути LLM — лоссовый
энумератор: он надёжно **классифицирует** колонку, но ненадёжно **перечисляет**
все её значения и иногда ошибается типом. При этом полный набор значений каждой
колонки уже распарсен из файла и лежит в `sampleRows`. Логично закрыть полноту
опций, валидность типа и устойчивость dedup **детерминированным кодом**, а не
просьбами к LLM — это дешевле (0 LLM-токенов), воспроизводимо и не ломает
prompt-кэш. Подход — продолжение уже существующих пост-пассов `normalize()` и
`alignToHeaders()` в том же сервисе.

## REALITY-CHECK (факт по коду на 2026-06-08)

Картография по реальному коду `backend/src/modules/tables/`:

- **`TableAgentService.inferSchemaFromTabular`** (`table-agent.service.ts:162`)
  принимает `{ tenantId, headers, sampleRows }`. ВАЖНО: `sampleRows` — это **все
  строки до `importMaxRows`** (контроллер `tables.controller.ts:255` шлёт
  `limitedRows`, не 20). Внутри `buildTabularPrompt` (`:277`) режет до 20 ТОЛЬКО
  для промпта; для пост-пассов доступен полный массив. → R2/R4 имеют ground-truth
  по каждой колонке.
- Поток внутри: `runThreePassPipeline` (`:197`) → `alignToHeaders` (`:308`).
  `alignToHeaders` строит property↔header 1:1 по индексу и **сохраняет
  `fromLlm.config`** (`:322`) → опции LLM для select/status доживают до выхода.
  → R2 дополняет именно их.
- **`runThreePassPipeline`** (`:197`): pass-1 DRAFT через `callJson` (`:213`);
  `if (!draftRaw) throw BadRequestException(code:'table_schema_generation_failed')`
  (`:219`). Passes 2–3 (ARCHITECT/ENTITY) при null **деградируют мягко** (fallback
  на предыдущий результат, `:239` и `:260`). → R1 трогает ТОЛЬКО pass-1.
- **`callJson`** (`:547`) уже глотает ошибку LLM (`try/catch → return null`,
  `:565`) и парсит JSON через `parseSchemaJson`. → retry оборачивает вызов
  `callJson` для pass-1, ничего внутри `callJson` не меняем.
- **`findSimilarTables`** (`:373`) уже забирает существующие таблицы вместе с
  именами колонок: `properties: { select: { name: true } }` (`:386`). → данные для
  Jaccard уже в выборке, доп. запрос НЕ нужен. Порог берётся через
  `getDedupThreshold()` (`:529`) паттерном `cfg.getDynamic(key, undefined, default)`
  с `try/catch → default` — **этот же паттерн переиспользуем** для новых тюнингов.
- **`normalize`** (`:610`): `ALLOWED_PROP_TYPES` (`:49`) включает
  `selectSingle/selectMulti/status/date/number/currency/percent/longtext/text` —
  все целевые типы R2/R4 валидны.
- **`parseNumericLoose`** ЭКСПОРТИРОВАН из `table-import.service.ts:30` — R4
  переиспользует его для проверки `number/currency/percent` (не дублировать).
- `cfg` и `embeddings` в `TableAgentService` — `@Optional()` (`:111`/`:115`):
  unit-тесты конструируют сервис двумя аргументами `(llm, prisma)`. → все новые
  чтения конфигов обязаны иметь code-fallback и не падать при `cfg === undefined`.
- Существующие тесты: `table-agent.service.spec.ts` (tabular-маппинг, cosine,
  entity-link, инварианты) — расширяем их, новый файл не плодим.

**Вывод REALITY-CHECK:** ни одного висящего контракта; вся фича — 3 локальных
изменения в 1 сервисе (+ переиспользование 1 экспортируемой функции). **БД не
трогается, новых ENV/AdminSetting-регистраций не требуется, фронт не меняется.**

## Принятые решения (owner + обоснованные ASSUMPTION)

Развилок уровня HIGH нет (нет новых моделей БД, контрактов API, billing/RBAC,
выбора провайдера). LOW-параметры зафиксированы дефолтами с обоснованием:

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Д1 | **R2/R4 живут только в tabular-пути** (`inferSchemaFromTabular`), НЕ в общем `runThreePassPipeline`. | Text-to-Schema не имеет данных колонок → детерминировать нечем; плюс он выключен флагом. Не раздувать общий путь. |
| Д2 | **R1 живёт в `runThreePassPipeline`** (shared), ретраится ТОЛЬКО pass-1. | Pass-1 — единственная точка жёсткого отказа; passes 2–3 уже fallback'ят (REALITY-CHECK). Выигрывают оба пути (text+tabular). |
| Д3 | Новые тюнинги читаются `cfg.getDynamic('<key>', undefined, <default>)` с `try/catch → default`, как `getDedupThreshold()`. Регистрация в admin-registry — **вне scope v1** (опц. vNext). | `[ASSUMPTION]` Мирроринг существующего паттерна в этом же файле; admin-override остаётся возможен без правки кода; не плодим seed/registry/prod-deploy шаги для внутренних алго-констант. |
| Д4 | `draftMaxAttempts` = **3** (2 ретрая), backoff **300 мс** фиксированный. | `[ASSUMPTION]` Наблюдали 1 транзиент из ~10, прошёл с немедленного повтора. 3 попытки при независимых сбоях дают p→p³ (≈0.1→0.001); 300 мс гасит provider-hiccup, не растягивая UX. |
| Д5 | R3: кандидат проходит при `cosine ≥ dedupThreshold(0.85) ИЛИ colJaccard ≥ 0.6`; сортировка по `max(cosine, jaccard)`; в DTO-поле `cosine` кладём **именно `max(cosine, jaccard)`** (имя поля не меняем). | `[ASSUMPTION]` Jaccard=1.0 на идентичных колонках («Идеи») флипает в верный merge; 0.6 = «больше половины колонок совпали». Сохранение имени `cosine` = ноль изменений фронта; «% совпадения» в UI остаётся осмысленным. |
| Д6 | R3: Jaccard считается **всегда** (in-memory, без LLM); cosine — если `embeddings` доступны. Кандидаты находятся даже при упавшем провайдере эмбеддингов. | Бонус-устойчивость: dedup перестаёт быть зависимым от внешнего эмбеддинг-провайдера. |
| Д7 | R2: union опций только если distinct-значений колонки **≤ 30**; иначе пропускаем (вероятно не select). Матч значений — case-insensitive + trim; новым опциям `id='opt-<n>'`, цвет — round-robin по палитре `[info,warning,success,danger,neutral]`. | `[ASSUMPTION]` 30 — потолок вменяемого select; защищает от засорения, если text-колонка проскочила как select. Round-robin — визуальное разнообразие чипов; не переопределяем уже выданные LLM цвета. |
| Д8 | R4: тип `date/number/currency/percent` понижается в `text`, если **< 50%** непустых сэмпл-значений парсятся как этот тип. Доп.: `text`→`longtext`, если **≥ 50%** значений длиннее 80 символов. | `[ASSUMPTION]` 50% — устойчивый порог против «случайно одно число»; «Результат» (0% дат) → text. 80 симв. — длинная фраза ≠ короткое имя. |
| Д9 | **Без feature-flag, ship-on.** | Детерминированные улучшения существующего пути; не меняют доступ/деньги; риск низкий (пороги консервативны), откат — revert. Соответствует инварианту Ship-On (CLAUDE.md п.8). |

## Доказательство выбора (Проход A vs B + challenge-loop)

**A — детерминированные пост-пассы в коде** (рекомендация): union опций из данных,
type-guard по сэмплу, Jaccard-сигнал, retry pass-1.
**B — промпт-инжиниринг**: усилить SYSTEM DRAFT/ARCHITECT («перечисли ВСЕ
distinct-значения select», «сверь тип с примерами») + LLM-валидатор для dedup.

| Критерий (ограничение фичи) | A (код) | B (промпт) |
|---|---|---|
| Гарантия полноты опций | ✓ union из данных = 100% | ✗ LLM лоссит хвост (наблюдали 2/9) |
| Стоимость на запрос | ✓ 0 LLM-токенов | ✗ длиннее промпт / доп. пасс = $ + латентность |
| Детерминизм / воспроизводимость | ✓ | ✗ LLM недетерминирован |
| Устойчивость к падению провайдера | ✓ Jaccard/union без LLM | ✗ |
| Не ломает prompt-кэш | ✓ SYSTEM не трогаем | ⚠ правка SYSTEM ломает 95–99% кэша (память `feedback_llm_prompts_cache_friendly`) |
| Покрывает text-to-schema (нет данных) | ✗ только tabular | ✓ |
| Сложность | ✓ локальные методы 1 файла | ✓ правка промптов |

Сходятся в пользу A на tabular-пути (5/7). Единственное преимущество B
(text-to-schema) **неприменимо**: text-to-schema выключен флагом и не имеет данных
для энумерации. **Вывод: A.**

Challenge-loop по A: (1) **корень, не симптом** — чиним КЛАСС (все select/status,
все numeric/date колонки), а не наблюдённые 2 кейса; (2) **самое эффективное** —
0 LLM-токенов, локальные методы по образцу `normalize()`/`alignToHeaders()`, не
преждевременная оптимизация; (3) **нет кода-ради-кода** — каждый метод с
измеренным эффектом, `parseNumericLoose` переиспользуется. Прошёл.

## Совместимость с prompt caching

**Полная.** R1 ретраит pass-1 тем же промптом (кэш-дружелюбно). R2/R3/R4 —
детерминированный код, **SYSTEM-промпты не трогаются вовсе** → prompt-кэш
DeepSeek/OpenAI-proxy не инвалидируется. (Соответствует
`feedback_llm_prompts_cache_friendly`.)

## Scope

**Входит:**
- R1 retry pass-1 в `runThreePassPipeline`.
- R2 union опций select/status из данных в `inferSchemaFromTabular`.
- R3 Jaccard-сигнал в `findSimilarTables`.
- R4 type-guard (downgrade date/number/currency/percent; upgrade text→longtext) в `inferSchemaFromTabular`.
- Unit-тесты на каждое в `table-agent.service.spec.ts`.

**Не входит (с судьбой):**
- Редеплой коммита `26219233` (React #185 + pending-patches 404) — **отдельная
  ops-операция**, не код этого ТЗ. Блокер просмотра таблиц в гриде; выполняется
  деплоем ветки. См. анализ, Находка 0.
- Любые правки SYSTEM-промптов и Text-to-Schema (Phase 1) — вне scope (флаг OFF,
  нет данных). vNext, если включат флаг.
- Стабилизация имени таблицы при импорте (анализ F5) — **vNext**: R3 уже снимает
  вредное следствие (промах dedup); принудительная замена имени на базовое имя
  файла — отдельное UX-решение владельца.
- Регистрация новых тюнингов как редактируемых AdminSetting (UI) — опц. vNext
  (Д3): код уже читает через `getDynamic`, промоушен без правки кода.
- Серверная фильтрация по cells, миграция парсинга на DCS — чужой scope (анализ).

**Граничные контракты:** фронт (`ImportFromFileDialog`, `TableSchemaPreview`) и
DTO `ImportAnalyzeDto`/`InferredTableSchemaDto` — **не меняются**. Поле
`mergeCandidates[].cosine` сохраняет имя и диапазон 0..1 (значение = combined
score, Д5) → фронт-рендер `Math.round(cosine*100)% совпадения` валиден без правок.

## Границы автономии фазы

✅ **Always:** правки внутри `TableAgentService`; переиспользование
`parseNumericLoose`; расширение `table-agent.service.spec.ts`; `bun run typecheck/
lint`, `bunx vitest run`.
⚠️ **Ask first:** любое изменение сигнатур публичных методов сервиса; правка
DTO/контроллера/фронта; добавление ENV/AdminSetting-регистрации; правка
SYSTEM-промптов.
🚫 **Never:** `prisma migrate`/`new PrismaClient(`/`process.env.*`; новый
feature-flag; изменение `mergeCandidates` DTO-формы; правки в путь Text-to-Schema.

---

## Фазы

Зависимости: фазы **независимы** (разные методы одного сервиса), порядок 1→2→3
рекомендуемый. Каждая самодостаточна для одного суб-агента за сессию.

> ⚠️ Номера строк — на момент написания (2026-06-08). Перед правкой **перечитать
> файл** и искать по символу-якорю (имя метода/строковый литерал), не по номеру.

### Фаза 1 — R1: retry pass-1 (DRAFT)

**Файл:** `backend/src/modules/tables/services/table-agent.service.ts`
**Якорь:** метод `runThreePassPipeline` (`~:197`), блок `// ── pass 1: DRAFT` (`~:203`).

**Что входит:**
1. Добавить приватный хелпер чтения попыток (паттерн `getDedupThreshold`):
   ```ts
   /** Кол-во попыток pass-1 DRAFT (AdminSetting `table.agent.draft_max_attempts`, def 3). */
   private async getDraftMaxAttempts(): Promise<number> {
     if (!this.cfg) return 3;
     try {
       const n = await this.cfg.getDynamic<number>('table.agent.draft_max_attempts', undefined, 3);
       return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.floor(n) : 3;
     } catch {
       return 3;
     }
   }
   ```
2. Обернуть ТОЛЬКО pass-1 `callJson({ taskType: 'table-infer-schema', … })` в
   retry-цикл: до `attempts` попыток; между попытками `await sleep(300)`; если все
   попытки вернули null — тот же `throw BadRequestException({code:'table_schema_generation_failed', …})`,
   что и сейчас (текст сообщения не менять). Добавить локальный
   `sleep(ms)=new Promise(r=>setTimeout(r,ms))` (или вынести в начало файла).
3. Залогировать каждую неуспешную попытку:
   `this.logger.warn({ tenantId, attempt }, 'table-agent: DRAFT pass retry')`.
4. Passes 2 и 3 — **не трогать** (уже деградируют мягко).

**Что НЕ входит:** retry для passes 2/3; изменение `callJson`; изменение текста/кода ошибки.

**Acceptance (машинно-проверяемо):**
- Grep: в `runThreePassPipeline` присутствует цикл по `getDraftMaxAttempts()` и
  `setTimeout`/`sleep` вокруг DRAFT-вызова; вызовы ARCHITECT/ENTITY остались
  одиночными.
- Unit (новый, `table-agent.service.spec.ts`): мок `llm.call`, который для
  `taskType==='table-infer-schema'` бросает на 1-й вызов и возвращает валидный
  JSON на 2-й → `inferSchemaFromText` РЕЗОЛВИТСЯ (не бросает), `llm.call`
  по DRAFT вызван дважды.
- Unit (негатив): мок, где DRAFT всегда возвращает невалидный JSON → бросается
  `BadRequestException` с `error.code==='table_schema_generation_failed'`; число
  вызовов DRAFT == `draftMaxAttempts` (3 при отсутствии cfg).
- Unit: при `cfg===undefined` (конструктор 2 аргумента) дефолт = 3 попытки, не падает.
- `bunx vitest run backend/src/modules/tables/services/table-agent.service.spec.ts` — зелёный.

**Закрывает: R1**

### Фаза 2 — R2 + R4: type-guard и union опций из данных (tabular)

**Файл:** `backend/src/modules/tables/services/table-agent.service.ts`
**Якорь:** `inferSchemaFromTabular` (`~:162`), сразу ПОСЛЕ
`const aligned = this.alignToHeaders(schema, args.headers);` (`~:173`).
**Импорт:** `import { parseNumericLoose } from './table-import.service';` (функция
экспортирована, `table-import.service.ts:30`). При риске циклического импорта
(оба в одном модуле) — допустимо вынести `parseNumericLoose` в
`backend/src/modules/tables/services/_num.util.ts` и реимпортировать в обоих
местах [ASSUMPTION: предпочтительно прямой импорт; вынести только если tsc/линт
ругнётся на цикл].

**Порядок выполнения внутри `inferSchemaFromTabular` (строго): R4 → R2.**
(Сначала чиним тип; если колонка перестала быть select — опции ей не нужны.)

**Что входит:**
1. **R4 `reconcileTypesWithData(aligned, sampleRows)`** — приватный метод. Для
   каждой property `j`:
   - собрать непустые `vals = sampleRows.map(r => (r[j]??'').trim()).filter(Boolean)` (по всем строкам, не только 20). Если `vals.length===0` — пропустить колонку.
   - если `type ∈ {number,currency,percent}` и доля `parseNumericLoose(v)!==null` среди `vals` **< 0.5** → `type='text'`.
   - если `type==='date'` и доля `looksLikeDate(v)` **< 0.5** → `type='text'`.
   - если `type==='text'` и доля `v.length>80` среди `vals` **≥ 0.5** → `type='longtext'`.
   - `looksLikeDate(v)`: регэксп-проверка распространённых форматов, НЕ голый
     `Date.parse` (он слишком лоялен):
     ```ts
     private looksLikeDate(v: string): boolean {
       return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(v)      // 2026-05-28
         || /^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(v);          // 28.05.2026 / 28/05/26
     }
     ```
   - при понижении типа `date→text` сохранить остальные поля property неизменными.
2. **R2 `completeSelectOptions(aligned, sampleRows)`** — приватный метод. Для
   каждой property `j` с `type ∈ {selectSingle,selectMulti,status}`:
   - `distinct = uniqueCaseInsensitiveTrim(sampleRows.map(r=>r[j]))` (непустые).
   - если `distinct.length > 30` — **пропустить** колонку (Д7).
   - взять текущие `config.options` (если `config` нет — `{options:[]}`); собрать
     набор уже имеющихся имён (lowercased+trim).
   - для каждого distinct-значения, которого нет в наборе — добавить
     `{ id:'opt-<next>', name:<оригинальное значение>, color:<round-robin по [info,warning,success,danger,neutral]> }`.
     Счётчик `next` продолжает максимальный существующий `opt-N`+1; round-robin
     стартует с индекса = числа уже существующих опций.
   - записать обновлённый `config.options` обратно в property.
   - селектор round-robin: `PALETTE[idx % 5]`, `PALETTE=['info','warning','success','danger','neutral']`.
3. Вызвать оба в `inferSchemaFromTabular`: `this.reconcileTypesWithData(aligned, args.sampleRows); this.completeSelectOptions(aligned, args.sampleRows);` (мутируют `aligned.properties` или возвращают новый — выбрать один стиль, согласованный с `alignToHeaders`, который возвращает новый объект; **предпочесть возврат нового, без мутации входа**).
4. Лог: `this.logger.log({ tenantId, downgraded, optionsAdded }, 'table-agent: tabular post-pass')`.

**Что НЕ входит:** применение к text-пути; правка промптов; изменение
`alignToHeaders`/`normalize`; обработка `selectMulti`-ячеек с несколькими
значениями в одной строке (берём ячейку как одно значение — split по разделителю
= vNext).

**Acceptance (машинно-проверяемо):**
- Grep: методы `reconcileTypesWithData`, `completeSelectOptions`, `looksLikeDate`
  присутствуют; `inferSchemaFromTabular` вызывает оба ПОСЛЕ `alignToHeaders`.
- Unit R4 (кейс «Результат»): headers `['Формулировка','Результат']`, sampleRows
  где колонка `Результат` = свободный текст («Конверсия выросла на 18 процентов»…),
  LLM-схема навязала `Результат:date` → после `inferSchemaFromTabular` тип
  `Результат === 'text'`.
- Unit R4 (не ломает валидное): колонка с `['2026-05-28','2026-06-01',…]` и типом
  `date` → остаётся `date`. Колонка `['450000','1200000']` тип `currency` →
  остаётся `currency`.
- Unit R4 (longtext upgrade): колонка с значениями длиной >80 симв., тип `text` →
  `longtext`.
- Unit R2 (кейс «Отказ»): колонка `Стадия` со значениями
  `['Лид','Переговоры','Отказ',…]`, LLM-`config.options` без «Отказ» → после
  пост-пасса `options` содержит запись с `name==='Отказ'`, валидным `id` и
  `color ∈ {info,warning,success,danger,neutral}`; ранее существовавшие опции не
  переименованы и не перекрашены.
- Unit R2 (потолок): колонка-`selectSingle` с 31 distinct-значением → `options`
  НЕ дополняется (пропуск по Д7).
- Unit R2 (case-insensitive): значения `['Лид','лид ']` не плодят дубль опции.
- `bunx vitest run backend/src/modules/tables/services/table-agent.service.spec.ts` — зелёный.
- `bun run typecheck && bun run lint` (в `backend/`) — зелёные (учесть импорт
  `parseNumericLoose`).

**Закрывает: R2, R4**

### Фаза 3 — R3: Jaccard-сигнал в cosine-dedup

**Файл:** `backend/src/modules/tables/services/table-agent.service.ts`
**Якорь:** `findSimilarTables` (`~:373`).

**Что входит:**
1. Хелпер порога Jaccard (паттерн `getDedupThreshold`):
   ```ts
   /** Порог пересечения колонок (AdminSetting `table.import.dedup_col_jaccard`, def 0.6). */
   private async getJaccardThreshold(): Promise<number> {
     if (!this.cfg) return 0.6;
     try {
       const n = await this.cfg.getDynamic<number>('table.import.dedup_col_jaccard', undefined, 0.6);
       return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.6;
     } catch { return 0.6; }
   }
   ```
2. Хелпер `colJaccard(aNames: string[], bNames: string[]): number` — Jaccard по
   множествам нормализованных имён колонок (`trim().toLowerCase().replace(/\s+/g,' ')`);
   пустые множества → 0.
3. Перестроить тело `findSimilarTables`:
   - выбор таблиц (`prisma.table.findMany`) и `proposedCols = schema.properties.map(p=>p.name)` — оставить.
   - **cosine считать как сейчас, но опционально**: если `embeddings` доступны и
     батч-эмбеддинг удался — заполнить `cosineByTable`; при ошибке/недоступности
     — НЕ выходить с `[]`, а считать cosine=0 для всех (Д6).
   - для каждой таблицы: `jac = colJaccard(proposedCols, t.properties.map(p=>p.name))`,
     `cos = cosineByTable.get(t.id) ?? 0`, `score = Math.max(cos, jac)`.
   - кандидат проходит, если `cos ≥ dedupThreshold ИЛИ jac ≥ jaccardThreshold`.
   - вернуть top-3 по убыванию `score`, поле `cosine: score` (Д5 — имя поля не меняем).
4. Сохранить graceful-поведение: если таблиц нет — `[]`.

**Что НЕ входит:** изменение DTO-формы `mergeCandidates`; правка фронта; изменение
порога cosine (0.85) и его ключа.

**Acceptance (машинно-проверяемо):**
- Grep: в `findSimilarTables` есть `colJaccard`, `getJaccardThreshold`, выражение
  `Math.max(` для score; возврат больше НЕ делает ранний `return []` при
  недоступных embeddings (Jaccard-ветка остаётся).
- Unit R3 (кейс «Идеи»): proposed `{ name:'Запросы и пожелания', properties:
  [Формулировка,Источник,Приоритет,Ответственный,Статус] }`; в БД таблица
  `Идеи и бэклог` с ИДЕНТИЧНЫМ набором колонок; мок `embeddings` отдаёт низкий
  cosine (<0.85) → `findSimilarTables` ВОЗВРАЩАЕТ кандидата `Идеи и бэклог`
  (jaccard=1.0 ≥ 0.6), `cosine`-поле ≈ 1.0.
- Unit R3 (без embeddings): `embeddings===undefined` + идентичные колонки →
  кандидат всё равно найден по Jaccard (Д6).
- Unit R3 (истинно-негатив сохранён): proposed с непохожими колонками и низким
  cosine → кандидатов нет (как «Инвентарь»).
- Unit (регресс): высокий cosine (≥0.85) при низком Jaccard → кандидат остаётся
  (старое поведение не сломано).
- `bunx vitest run backend/src/modules/tables/services/table-agent.service.spec.ts` — зелёный.

**Закрывает: R3**

---

## Pre-mortem / Риски и ревью-аспекты

| Риск | Митигация (в ТЗ) |
|---|---|
| R2 засоряет опции, если text-колонка проскочила как select | R4 идёт ПЕРВЫМ (downgrade), + потолок 30 distinct (Д7) |
| R4 ошибочно понижает валидную date-колонку с грязным сэмплом | Порог 50% + регэксп-форматы (не голый `Date.parse`); консервативно |
| R3 ложно-позитивный merge при случайном совпадении имён колонок | Jaccard 0.6 = >половины колонок; merge всё равно лишь ПРЕДЛАГАЕТСЯ (кнопка), не авто |
| Циклический импорт `table-agent ↔ table-import` (`parseNumericLoose`) | Прямой импорт; при ошибке tsc — вынести в `_num.util.ts` (Д Фаза 2) |
| Мутация входного объекта пост-пассами | Возвращать новый объект, как `alignToHeaders`; не мутировать `args` |

**Ревью-аспекты для `strict-production-review-gate`:** не сломан ли существующий
positive-dedup (regress-тест); сохранён ли точный код/текст ошибки
`table_schema_generation_failed`; нет ли `process.env`/`new PrismaClient`/`migrate`;
graceful при `cfg===undefined` и упавших embeddings; SYSTEM-промпты не тронуты
(prompt-кэш цел).

## Idempotency / feature-flag / prod-deploy

- **Без feature-flag** (Д9, ship-on).
- **БД не трогается**, новых ENV в `env.schema.ts` нет, новых seed/patch/backfill/
  migrate-скриптов нет → **prod-deploy-log правок не требует**; выкат = обычный
  `docker compose up -d --build backend`.
- Новые `getDynamic`-ключи (`table.agent.draft_max_attempts`,
  `table.import.dedup_col_jaccard`) работают на code-fallback без регистрации;
  если позже захотят admin-edit — отдельная мелкая задача (Д3, vNext).

## DoD (общий чек качества)

- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` (в `backend/`) — зелёные.
- `bunx vitest run backend/src/modules/tables/services/table-agent.service.spec.ts` — все, включая новые, зелёные.
- Обновить `second-brain/01_projects/smart-tables.md` (раздел «Document-to-Table /
  качество»: добавить про детерминированные пост-пассы R1–R4 со ссылкой на это ТЗ
  и анализ).
- prod-deploy-log — НЕ требуется (нет schema/scripts/ENV/очередей/эндпоинтов).
- Рефлексия в `second-brain/05_история/` после push (триггер CLAUDE.md).
- Реестр «не сделано»: закрыть/не открывать строк не требуется (vNext-хвосты
  явно вынесены в «Не входит»).

## Итог

**Статус: реализовано целиком (2026-06-08).** Все 4 улучшения в одном сервисе
`table-agent.service.ts`:
- **Фаза 1 (R1)** `[x]` — retry pass-1 DRAFT в `runThreePassPipeline` (`getDraftMaxAttempts`,
  fallback 3, backoff 300 мс); passes 2/3 не тронуты.
- **Фаза 2 (R2+R4)** `[x]` — `reconcileTypesWithData` (порядок R4→R2) + `completeSelectOptions`
  + `looksLikeDate` в `inferSchemaFromTabular`; `parseNumericLoose` переиспользован.
- **Фаза 3 (R3)** `[x]` — `colJaccard` + `getJaccardThreshold` (0.6) в `findSimilarTables`;
  cosine стал опциональным (работает без embeddings, Д6), поле `cosine = max(cos,jac)`.

`parseNumericLoose` вынесена в `services/_num.util.ts` (разрыв value-цикла
`table-agent ↔ table-import`), реэкспорт из `table-import.service.ts` сохранён.
Верификация: `typecheck` 0 ошибок · `lint` 0 errors (мои файлы) · `build` ок ·
`vitest run src/modules/tables` — 12 файлов / 109 тестов зелёные (38 в
`table-agent.service.spec.ts`, включая новые R1–R4). БД/ENV/seed/миграции не
трогались → prod-deploy-log правок не требует.
