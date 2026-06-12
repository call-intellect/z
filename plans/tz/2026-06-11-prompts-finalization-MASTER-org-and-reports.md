---
title: ФИНАЛЬНОЕ ТЗ — Усиленные промпты орг-агентов (регламент/инструкция: определить + написать) + все отчёты/протоколы по типам встреч + сервисная доделка
date: 2026-06-11
status: ready-to-implement (FINAL — единый контракт для агента-реализатора)
type: tz-master
supersedes:
  - plans/tz/2026-06-11-org-extractor-and-compiler-finalize.md     # вобран целиком (Часть A)
  - plans/tz/2026-06-11-prompt-polish-fewshot-org-and-reports.md   # вобран целиком (Часть B + промпт-части A)
source_of_truth_prompts:
  - plans/analysis/2026-06-09-prompt-rewrites/21c-specialists-regulations-clone-arbiters.md  # БЫЛО→СТАЛО regulation-экстрактора
  - plans/analysis/2026-06-09-prompt-rewrites/22-org-entities-COMPARE-and-compiler.md         # орг-сущности + полный SYSTEM компилятора
  - plans/analysis/2026-06-09-prompt-rewrites/10a-report-by-type-internal.md                  # внутренние type-*
  - plans/analysis/2026-06-09-prompt-rewrites/10b-report-by-type-client.md                    # клиентские type-*
  - plans/analysis/2026-06-09-prompt-rewrites/11-main-report-and-summaries.md                 # главный отчёт + summary
  - backend/src/modules/knowledge-core/prompts/decision-extract.prompt.ts                     # ЭТАЛОН few-shot (строки 43-51)
---

# ФИНАЛЬНОЕ ТЗ — Усиленные промпты: орг-агенты + отчёты/протоколы + сервисная доделка

> **Для кого.** Это единый, самодостаточный контракт для агента-реализатора. Реализовывать строго по нему,
> фаза за фазой; источники полных текстов промптов — в `source_of_truth_prompts` выше.
>
> **Что делаем и зачем.** Доводим до «полноценного» качества промпты группы извлекающих агентов (точнее
> достают факты, меньше выдумок и пропусков) и достраиваем сервисную обвязку орг-документов (версии + шаги).
> Затем выкат и наблюдение прода (без golden-харнесса).
>
> **ГЛАВНАЯ ГАРАНТИЯ (требование владельца).** Переписывание/усиление промптов **обязательно** для КАЖДОГО
> агента из таблицы §0 — ни один не пропускается. Если у агента в §0 стоит «промпт», его `*.prompt.ts`/`type-*.ts`
> ДОЛЖЕН получить few-shot + усиления; приёмка проверяет это грепом (см. §Приёмка).

## §0. Состав работ — исчерпывающий список агентов

| # | Агент (что делает) | Файл | Промпт (few-shot+усиление) | Сервис/схема | Источник полного текста |
|---|---|---|---|---|---|
| A1 | **Экстрактор** — определяет в разговоре регламент/процесс/политику/инструкцию | `knowledge-core/prompts/regulation-extract.prompt.ts` | ✅ да | гейт `isOrgNorm`+downstream | rewrites 21c |
| A2 | **Комбинированный экстрактор** (8 сущностей за проход, в т.ч. regulations[]) | `knowledge-core/prompts/specialists-combined.prompt.ts` | ✅ да (синхронно с A1) | гейт `isOrgNorm` в regulations[] | rewrites 21c |
| A3 | **Компилятор** — пишет сам документ (contentMd регламента/инструкции/процесса/политики) | `knowledge-core/prompts/structured-document-compiler.prompt.ts` + `services/structured-document-compiler.service.ts` + `services/specialist-3-1-regulations.service.ts` | ✅ да (пример сборки) | версии `CardVersion` + sync `steps[]`→`ProcessStep` | rewrites 22 §3 |
| A4 | (опц.) Экстрактор инсайтов | `knowledge-core/prompts/insight-extract.prompt.ts` | ✅ да | — | rewrites 21a |
| B1 | **Главный быстрый отчёт встречи** | `ai/services/prompts/meeting-report-fast.prompt.ts` | ✅ да | — | rewrites 11 |
| B2.1 | Отчёт: командная встреча | `ai/services/prompts/type-team.ts` | ✅ да | — | rewrites 10a |
| B2.2 | Отчёт: планёрка/standup | `ai/services/prompts/type-standup.ts` | ✅ да | — | rewrites 10a |
| B2.3 | Отчёт: проектная | `ai/services/prompts/type-project.ts` | ✅ да | — | rewrites 10a |
| B2.4 | Отчёт: план-факт | `ai/services/prompts/type-plan_fact.ts` | ✅ да | — | rewrites 10a |
| B2.5 | Отчёт: ретроспектива | `ai/services/prompts/type-retrospective.ts` | ✅ да | — | rewrites 10a |
| B2.6 | Отчёт: ревью/оценка | `ai/services/prompts/type-review.ts` | ✅ да | — | rewrites 10a |
| B3.1 | Отчёт: custdev | `ai/services/prompts/type-custdev.ts` | ✅ да | — | rewrites 10b |
| B3.2 | Отчёт: партнёрская | `ai/services/prompts/type-partner.ts` | ✅ да | — | rewrites 10b |
| B3.3 | Отчёт: customer success | `ai/services/prompts/type-customer_success.ts` | ✅ да | — | rewrites 10b |
| B4 | **Протокол клиенту** (нейтральный, наружу) | `ai/services/prompts/client-meeting-split.prompt.ts` | ✅ да | — | rewrites 10b |

> `type-interview.ts` и `type-sales.ts` few-shot **уже имеют** — их не трогаем (если только реализатор не
> увидит, что пример не соответствует текущей схеме — тогда привести в порядок и обновить снапшот).

## Принципы (обязательны для всех фаз)
1. **Cache-friendly** — few-shot и усиления = **статичные строки в КОНЕЦ** существующего SYSTEM-массива; переменных данных в SYSTEM не добавлять (они остаются в USER). Правка SYSTEM один раз переедет кэш провайдеров — это ожидаемо и разово ([[feedback_llm_prompts_cache_friendly]]).
2. **No-golden, ship-and-observe** — приёмка = `typecheck`+`lint`+`build`+обновлённые снапшоты, затем выкат и наблюдение прода ([[feedback_no_golden_ship_and_observe_prod]]). Golden-харнесс НЕ запускать.
3. **Ship-On** — выкатываем включённым; рискованное (строгий гейт) — за kill-switch (ON), откат без редеплоя ([[feedback_ship_on_flags]]).
4. **Контракт промпта не ломать молча** — few-shot пишется строго под ФАКТИЧЕСКУЮ JSON/tool-схему файла (поля и enum брать из самого файла). Новое поле схемы вводится ТОЛЬКО там, где это явно прописано (A1.2/A2 — `isOrgNorm`).
5. **Снапшоты** — каждый тронутый промпт = обновить его `*.snapshot.spec.ts`/`*.prompt.spec.ts` в том же коммите (`bunx vitest run -u <путь>`), просмотреть глазами.
6. **Few-shot всегда 2 полюса** — положительный пример (что извлечь) + негативный (edge case: что НЕ извлекать / честная пустота). Негативный пример сам по себе работает как анти-плодёж на уровне промпта.
7. **Recall-страховка** — гейт A1.2/A2 НЕ должен молча терять реальные регламенты (их меньше и они важнее решений). Поведение за kill-switch + наблюдение `core_specialist_cards_total{type}`.

## Эталон формата few-shot (копировать стиль 1-в-1)
`decision-extract.prompt.ts:43-51` — блок в массиве строк SYSTEM:
```
'',
'ПРИМЕРЫ.',
'',
'Положительный пример (что извлечь):',
'Блок «…» (signalType=…). Цитаты: «…».',
'Вывод: {…валидный JSON строго под схему этого промпта…}.',
'',
'Что НЕ делать (edge case — <причина>):',
'Блок «…». Цитаты: «…».',
'Вывод: {…пустой/низкий confidence…}. Пояснение: <почему не извлекаем>.',
```

---

# ЧАСТЬ A — Орг-агенты (определяют → пишут регламент/инструкцию)

## A1 — Экстрактор `regulation-extract`

### [ ] A1.1 — few-shot (3 примера, ГОТОВЫЙ текст для вставки)
Вставить в конец SYSTEM-массива `regulation-extract.prompt.ts` (после строки `'Калибровка confidence: …'`, перед `].join('\n')`). JSON строго под `regulation_extract_v1` (поля: `kind/name/statement/extractionStatus/roles/evidenceQuote/scope/ownerHint/severity/category/processStepHint/confidence`):

```js
'',
'ПРИМЕРЫ.',
'',
'Положительный — regulation (взаимодействие ролей + срок):',
'Блок «Проверка договоров» (signalType=regulation). Цитаты: «Все договоры с подрядчиком сначала уходят юристу на проверку, юрист отвечает в течение 3 рабочих дней».',
'Вывод: {"kind":"regulation","name":"Юридическая проверка договоров с подрядчиками","statement":"Каждый договор с подрядчиком проходит юридическую проверку до подписания; юрист отвечает в течение 3 рабочих дней.","extractionStatus":"существует","roles":["юрист","менеджер"],"evidenceQuote":"договоры с подрядчиком сначала уходят юристу на проверку","scope":"org","ownerHint":"юрист","severity":null,"category":"regulation","processStepHint":null,"confidence":0.9}.',
'',
'Положительный — instruction (одна роль, без передачи между ролями):',
'Блок «Возврат в 1С» (signalType=process_step). Цитаты: «Менеджер оформляет возврат в 1С: открыть заказ, создать возврат, провести документ».',
'Вывод: {"kind":"instruction","name":"Как менеджеру оформить возврат в 1С","statement":"Менеджер оформляет возврат в 1С: открыть заказ → создать возврат → провести документ.","extractionStatus":"существует","roles":["менеджер"],"evidenceQuote":"Менеджер оформляет возврат в 1С: открыть заказ, создать возврат, провести","scope":"role:менеджер","ownerHint":"менеджер","severity":null,"category":null,"processStepHint":null,"confidence":0.88}.',
'',
'Что НЕ извлекать (edge case — чужая практика + гипотетика):',
'Блок «Онбординг как в Google» (signalType=regulation). Цитаты: «Хорошо бы когда-нибудь описать онбординг так, как это делают в Google».',
'Вывод: {"kind":"regulation","name":"Онбординг по образцу Google (не норма)","statement":"Недостаточно сигнала: упомянута чужая практика и гипотетика, это не действующая норма компании.","extractionStatus":null,"roles":[],"evidenceQuote":null,"scope":null,"ownerHint":null,"severity":null,"category":null,"processStepHint":null,"confidence":0.15}. Пояснение: «как в Google» — чужая практика, «хорошо бы когда-нибудь» — гипотетика; не повторяемая норма компании → тело не извлекаем, confidence низкий.',
```
**Снапшот:** у `regulation-extract` отдельного снапшота нет — просто `build` зелёный.

### [ ] A1.2 — анти-плодёж гейт `isOrgNorm` (схема + промпт + downstream) — kill-switch
**Схема:** добавить в `REGULATION_EXTRACT_JSON_SCHEMA` булево `isOrgNorm` (в `required`).
**Промпт:** правило в SYSTEM — «`isOrgNorm`=true, если фрагмент — повторяемая норма/инструкция/политика КОМПАНИИ («как делаем всегда»); false — чужая практика, гипотетика, разовое поручение, голое упоминание без содержания. На false остальные поля можно вернуть пустыми, confidence низкий». В негативном few-shot (A1.1) добавить `"isOrgNorm":false`, в положительных — `true`.
**Downstream (КРИТ — здесь recall-риск):** в `specialist-3-1-regulations.service.ts` на `isOrgNorm=false`:
- НЕ создавать карточку-документ; если `extractionStatus∈{нужен,обсуждается}` — сохранить как «заявленная потребность» (низкое доверие), иначе `skip` с метрикой `core_specialist_skipped_total{specialist="regulation",reason="not_a_norm"}`.
- За kill-switch `aiFeatures.regulationGateStrict` (тип kill-switch, **дефолт ON**). OFF → гейт игнорируется (старое поведение «создавать всегда»).
**Файлы:** `regulation-extract.prompt.ts` (схема+SYSTEM), `specialist-3-1-regulations.service.ts`, реестр флага. **Приёмка:** на тест-блоке «чужая практика» карточка регламента не создаётся; флаг OFF возвращает старое поведение.

## A2 — Комбинированный экстрактор `specialists-combined`
### [ ] A2.1 — few-shot regulations[] (синхронно с A1)
В `buildSpecialistsCombinedSystemPrompt()` (тело `body`, после блока «Калибровка confidence для regulations…», строка ~511) добавить компактный few-shot в формате блоков `[BLOCK:id]` с выводом по `submit_all_8_entities` (заполнен только `regulations[]`, остальные 7 — пустые):
```js
'',
'ПРИМЕР (regulations):',
'[BLOCK:blk_12] (signalType=regulation) «Проверка договоров» О: договоры с подрядчиком сначала к юристу, ответ за 3 дня.',
'→ regulations: [{"sourceBlockId":"blk_12","kind":"regulation","name":"Юр-проверка договоров с подрядчиками","statement":"Каждый договор с подрядчиком проходит юр-проверку до подписания; срок ответа юриста — 3 рабочих дня.","severity":"mandatory","extractionStatus":"существует","roles":["юрист"],"evidenceQuote":"договоры с подрядчиком сначала к юристу","confidence":0.9}].',
'НЕ извлекать: «хорошо бы как в Google» (чужая практика+гипотетика) → в regulations НЕ добавлять (или isOrgNorm=false).',
```
### [ ] A2.2 — `isOrgNorm` в схеме regulations[] (если A1.2 принят)
Добавить `isOrgNorm` (bool) в `RegulationDraftSchema` (zod) + в `SUBMIT_ALL_8_ENTITIES_TOOL.regulations.items` + ветку персиста в `specialists-combined.service.ts` (тот же downstream-смысл, тот же kill-switch). **Снапшот:** обновить `specialists-combined.snapshot.spec.ts` если есть; иначе `build`.

## A3 — Компилятор `structured-document-compiler` (пишет сам документ)

### [ ] A3.1 — промпт: пример сборки (ГОТОВЫЙ) + усиление
В `COMPILE_ORG_DOCUMENT_SYSTEM_BODY` перед секцией `## Формат вывода` добавить блок `## Пример (kind=regulation)` — материал → собранный `contentMd` c таблицей «Шаг·Действие·Ответственный·Срок» и маркером `[требует уточнения]` в пустой ячейке. Зафиксировать ожидаемую структуру (контракт tool НЕ трогать):
```
## Пример (kind=regulation)
Материал: «Договоры с подрядчиком → юрист проверяет (срок 3 дня) → руководитель подписывает».
contentMd (фрагмент):
### 4. Порядок выполнения
| Шаг | Действие | Ответственный | Срок |
|---|---|---|---|
| 1 | Передать договор на юр-проверку | Менеджер | [требует уточнения: срок передачи] |
| 2 | Проверить договор | Юрист | 3 рабочих дня |
| 3 | Подписать договор | Руководитель | [требует уточнения] |
changeReason: «первичная сборка из материала».
```

### [ ] A3.2 — сервис: история версий через `CardVersion`
Сейчас на verdict merge/extension компилятор пишет `{ contentMd, version: { increment: 1 } }` (`specialist-3-1-regulations.service.ts:443/613/813`), но история версий не создаётся. Доделать: при `CompileResult.ok=true` в той же транзакции, что update документа:
1. Создать `CardVersion`: `resourceType ∈ regulation|process|policy|instruction`, `resourceId`=doc.id, `version`=новый номер, `payload`={contentMd, steps?, signals, changeReasonText: compiled.changeReason}, `changeReason`=короткий КОД ≤40 симв. (`'compile'`/`'merge'`/`'extension'`), `trustTier='auto'`, `previousVersionId`=doc.currentVersionId, `createdByUserId`=null.
2. Обновить документ: `currentVersionId`=новая версия (relations есть: `RegulationCurrentVersion`/`InstructionCurrentVersion`/`PolicyCurrentVersion`/`ProcessCurrentVersion`).
> Человекочитаемый `changeReason` компилятора (1–3 строки) НЕ влезает в `CardVersion.changeReason VarChar(40)` → хранить в `payload.changeReasonText`, в колонку — короткий код. UI «История версий» уже читает `CardVersion` — миграции НЕ нужно.
**Приёмка:** на повторной встрече по теме у документа `version=2` И две записи `CardVersion`, связанные `previousVersionId`.

### [ ] A3.3 — сервис: sync `steps[]` → `ProcessStep` (kind=process)
Сейчас пишется один шаг из `processStepHint` (`upsertSingleProcessStep`, :1458); полный `compiled.steps[]` игнорируется (`:608-610` — «следующая волна»). Доделать reconcile **non-destructive**:
- для `kind=process` и `ok=true` со `steps.length>0`: пройти `compiled.steps[]` по порядку → upsert `ProcessStep` (match по нормализованному `title` в рамках процесса; нет — create с `order`=индекс+1; есть — update `description`/`order`).
- **НЕ удалять** существующие шаги вне нового набора (анти-потеря; устаревание — vNext). `existingSteps` уже передаётся в компилятор (`buildCompileOrgDocumentUserMessage:315-331`).
- За тем же kill-switch `aiFeatures.docCompilerEnabled` (уже есть).
**Приёмка:** процесс из N шагов → N строк `ProcessStep` с верным `order`; повтор не дублирует.

## A4 — (опц.) `insight-extract` few-shot + гейт
Только по явному «да» владельца (инсайт — не орг-документ, его не компилируем). По образцу `decision-extract`: 2 примера (системный insight vs разовая жалоба) + гейт `isInsight`. Если владелец не подтвердил — пропустить, оставить строкой в реестре «не-сделано».

---

# ЧАСТЬ B — Отчёты и протоколы по типам встреч (усиленные промпты)

## §B0 — сквозной стандарт каждого few-shot отчётного промпта
В каждый пример обязательно зашить три правила (они уже текстом в промптах — пример их закрепляет):
- **«решили ≠ обсудили»** — в `decisions`/итоги попадает только принятое, а не обсуждавшееся.
- **идея ≠ задача** — предложение идёт в `ideas`/`proposals`, не в action items.
- **честная пустота + `data_quality`** — при бедном/обрезанном транскрипте поля пустые + заполнен `data_quality` (1–2 фразы: покрытие спикерами / обрезка / низкая уверенность), а не выдумка.
Поля few-shot для каждого типа — строго из ФАКТИЧЕСКОЙ tool-схемы файла (`buildExtractTool` в нём). Точные структуры по типам — в черновиках 10a/10b и мастер-ТЗ `2026-06-10-MASTER…` §A11.

## [ ] B1 — `meeting-report-fast` (ГОТОВЫЙ образец)
Добавить в конец SYSTEM пример под его tool-схему (summary + action_items + `data_quality`), закрепляющий «имя только из переданного списка участников» (правило уже есть) и честную метку качества:
```
ПРИМЕР.
Вход (фрагмент): «Сергей: запускаем доработку оплаты к пятнице. Аня: я возьму тесты». Спикеры покрывают ~60% реплик.
Вывод: summary — «Договорились запустить доработку оплаты к пятнице; тестирование за Аней.»;
action_items: [{"title":"Запустить доработку оплаты","assignee":"Сергей","due":"пятница"},{"title":"Провести тестирование","assignee":"Аня"}];
data_quality: «Спикеры распознаны примерно для 60% реплик; часть имён не атрибутирована.».
НЕ делать: не приписывать задачу человеку, которого нет в списке участников; если транскрипт пуст — summary честно «Запись слишком короткая для анализа», action_items: [].
```

## [ ] B2 — внутренние типы (6 файлов; развёрнутый образец + спека)
Каждому добавить few-shot (положительный + негатив) под фактическую схему. **Развёрнутый образец — `type-plan_fact.ts`** (остальным — по образцу):
```
ПРИМЕР (план-факт).
Вход: «Из 5 задач спринта сделали 3. Интеграцию с 1С не успели — Олег был на больничном. Отчёт по продажам не трогали, причину не назвали».
Вывод:
not_done: [{"item":"Интеграция с 1С","responsible":"Олег","reason":"был на больничном"}];
unexplained_gaps: ["Отчёт по продажам — причина не названа"];
data_quality: «Транскрипт полный, спикеры распознаны.».
Правила: «не успели» с причиной → not_done; без причины → unexplained_gaps (не выдумывать причину); «обсудили задачу» ≠ «сделали».
```
Спека для остальных пяти (поля — из схемы файла; сверка с rewrites 10a):
- [ ] **B2.1 `type-team`** — позитив с `decisions:[{text,speaker,changes_what}]` + `ideas[]`; негатив: обсуждение без решения → не в decisions.
- [ ] **B2.2 `type-standup`** — `proposals[]` (идеи ≠ задачи); «не уточнено» = сигнал, не пропуск.
- [ ] **B2.3 `type-project`** — `agreements`/`responsibilities`/`ideas`; договорённость с автором и сроком.
- [ ] **B2.4 `type-plan_fact`** — см. образец выше.
- [ ] **B2.5 `type-retrospective`** — `recurring_problems[]`; разовая жалоба ≠ системная проблема.
- [ ] **B2.6 `type-review`** — `decisions[]`; оценки людей формулировать гипотезно и приватно (не приговор).

## [ ] B3 — клиентские типы (3 файла; дуальный принцип)
few-shot + принцип «нейтрально наружу, оценки внутрь» (rewrites 10b). У каждого пример показывает: клиентские сигналы в свои поля, внутренние оценки НЕ утекают в нейтральные:
- [ ] **B3.1 `type-custdev`** — боли/потребности + `data_quality`; гипотезы клиента ≠ факты.
- [ ] **B3.2 `type-partner`** — договорённости/условия + `data_quality`.
- [ ] **B3.3 `type-customer_success`** — `competitors_mentioned[]`, `churn_risk_quote`; внутренний риск-комментарий не в клиентский протокол.

## [ ] B4 — `client-meeting-split` (протокол клиенту)
Добавить пример «нейтральный протокол» (outcome / issues / actions / next_contact) — **без единой оценки/температуры/ЛПР**. Закрепляет границу: внутренняя карточка (churn/upsell/interest) физически отдельна. Промпт уже несёт дуальный сплит — это закрепляющий пример «как звучит наружу».

---

# Сервис / БД
- **Миграций НЕТ.** Версионная инфра уже в схеме: полиморфная `CardVersion` (`resourceType/resourceId/version/payload/changeReason/trustTier`, `schema.prisma:3857`) + `currentVersionId` у `Regulation`/`Instruction`/`Policy`/`Process` (`:5858/:5912/:5953` + relations на `CardVersion`). `ProcessStep` есть (`:5806`).
- Отчётные поля (`data_quality`, `ideas` и т.п.) — в `AiResult.structuredData` (JSON) → схем БД не трогаем.

# Прод-операции
- **Флаг (новый):** `aiFeatures.regulationGateStrict` (kill-switch, дефолт ON) → `docs/operations/feature-flags.md` + `prod-deploy-log` Шаг 1. `aiFeatures.docCompilerEnabled` — уже есть.
- **ENV/миграции:** нет. Выкат — `docker compose up -d --build backend`.
- Кэш провайдеров переедет один раз (правка SYSTEM) — ожидаемо и разово.

# Наблюдение в бою (приёмка по проду, не golden)
До выката снять baseline, после 1–2 реальных встреч сравнить:
- `core_specialist_cards_total{type="regulation"|"process"|"policy"|"instruction", status="canonical"}` — **не должно просесть** (иначе гейт A1.2 строг → флипнуть `regulationGateStrict=OFF`).
- `core_specialist_skipped_total{specialist="regulation", reason="not_a_norm"}` — растёт умеренно (режем мусор, не всё).
- `diag graph --meeting <id>` / `diag report --meeting <id>` — регламент собран структурно (таблица/шаги); отчёт точнее (решения отделены от обсуждений, идеи в `ideas`, при бедном транскрипте — честный `data_quality`).
- UI «История версий» документа после второй встречи по теме — ≥2 версии; у процесса — пошаговые `ProcessStep`.

# Приёмка (общая, проверяет агент-реализатор)
- `cd backend && bun run typecheck && lint && build` и `cd frontend && bun run typecheck && build` — зелёные.
- **Гард «промпт реально усилен»:** `grep -l "ПРИМЕР" backend/src/modules/.../<каждый файл из §0>` → у ВСЕХ 14 промптов есть блок примеров (кроме уже имевших — type-interview/type-sales). Список §0 пройден полностью.
- Все тронутые `*.snapshot.spec.ts`/`*.prompt.spec.ts` обновлены и просмотрены глазами; CI-lint `inputKind` зелёный.
- Валидность few-shot: JSON каждого примера соответствует фактической схеме своего промпта (поля/enum существуют).
- diag на тест-встречах: (а) «чужая практика» не создаёт регламент; (б) повторная встреча → версия документа +1 и запись в `CardVersion`; (в) процесс → N шагов `ProcessStep`; (г) разовая задача не создаёт active-«Процесс».

# Порядок реализации (волны; между волнами не стоп — commit, push по подтверждению владельца)
1. **Волна 1 — орг-промпты:** A1.1, A2.1, A3.1 (чистый текст, безопасно).
2. **Волна 2 — орг-сервис:** A1.2+A2.2 (гейт+downstream, kill-switch), A3.2 (версии), A3.3 (steps-sync).
3. **Волна 3 — отчёты-промпты:** B1, B2 (6), B3 (3), B4 — параллельные кодеры по дизъюнктным файлам (снапшоты per-файл, конфликтов нет).
4. **Волна 4 (опц.):** A4 (insight) — по «да» владельца.

# Что НЕ входит
- Golden/eval-харнесс (по политике — выкат и наблюдение).
- Удаление устаревших `ProcessStep` при reconcile (только add/update; удаление — vNext).
- UI-diff между версиями документа (модель `CardVersion` готова; экран сравнения — отдельный фронт-ТЗ).
- Переписывание не перечисленных в §0 экстракторов (block-ingest, граф-арбитры и пр.) — отдельной волной «по остальным» (владелец: «дальше будем думать»).

# Итог (заполнять при реализации)
- [ ] A1.1 regulation few-shot · [ ] A1.2 гейт+downstream · [ ] A2.1 combined few-shot · [ ] A2.2 combined гейт · [ ] A3.1 compiler-пример · [ ] A3.2 CardVersion · [ ] A3.3 ProcessStep-sync · [ ] (опц.) A4 insight
- [ ] B1 report-fast · [ ] B2.1–B2.6 внутренние (6) · [ ] B3.1–B3.3 клиентские (3) · [ ] B4 client-split
- Реализовано: нет (ТЗ).
