---
title: Функциональные модули AI-агентов Коры
date: 2026-06-15
status: living-document
owner: architecture
---

# Функциональные модули AI-агентов Коры

> **Зачем этот документ.** В Коре ~127 LLM-агентов (`union LlmTaskType`). Чтобы
> в них не утонуть, группируем их в **функциональные модули** — связки агентов,
> которые ВМЕСТЕ дают одну способность, с понятной границей и входом/выходом.
> Это навигационная «лупа»: смотришь на модуль целиком, а не на 127 имён.

## Что такое «функциональный модуль»

Модуль = группа агентов + сервисов, которые сообща закрывают **одну способность
продукта** (например, «общение с сотрудником» или «наполнение графа знаний»).
У модуля есть:
- **Назначение** — какую способность даёт.
- **Граница** — что входит и что НЕ входит (где кончается модуль).
- **Вход → выход** — что приходит и что отдаёт.
- **Состав** — агенты/`taskType` + ключевые промпты + файлы.
- **Инварианты** — правила, которые модуль обязан держать.
- **ТЗ/статус** — где сейчас перерабатывается.

### Связь с другой картой агентов
В [ai-agents-map.md](ai-agents-map.md) агенты делятся по **способу запуска** (событие
/ cron / диалог) — это другой разрез. Функциональный модуль может **пересекать** те
три: например, модуль «Помощник и общение» включает и диалоговые агенты (помощник,
chat-v2), и канальный классификатор, и разбор чек-инов. Оба разреза дополняют друг
друга: ai-agents-map — «кто как запускается», этот файл — «что вместе даёт способность».

---

## Реестр модулей

> Идём как с промптами: описываем по одному при заходе в область. `✅` — описан,
> `⬜` — заглушка-указатель, развернём при работе с модулем.

| # | Модуль | Способность | Ключевые агенты | Статус |
|---|---|---|---|---|
| **M1** | **Помощник и общение с сотрудниками** | единая точка диалога: вопросы к памяти, действия, заметки/идеи, планы/отчёты | dialog-classify, query-understand, extract-plan, concierge-respond, chat-v2, checkin-parse | ✅ описан ниже |
| M2 | Наполнение графа знаний (ingest) | сырое событие → блоки знаний → граф связей | block-ingest, block-distill, block-linker, axis-classify | ⬜ |
| M3 | Специалисты графа (типизация) | блоки → решения/регламенты/идеи/риски/навыки | 3-1 regulations, 3-3 decisions, 3-5 insights, 3-6 ideas, 3-7 skill, entity-merge | ⬜ |
| M4 | Встречи → отчёты | транскрипт встречи → отчёт под тип встречи | meeting-report-fast, type-*, system-summary, follow-up | ⬜ |
| **M5** | **Клоны и персоны** | знания + метод роли → исполняемый ролевой клон, отвечающий от лица должности | skill-trait-detect, value-motivation-detect, role-principle-synthesize, executable-persona-compile, clone-respond, knowledge-clone-extract | ✅ описан ниже |
| M6 | Операции и пульс | сигналы → настроение/риски/ROI/дашборды/признание | checkin-sentiment, meeting-roi, decision-hygiene, recognition, digest | ⬜ |
| M7 | Умные таблицы | NL → схема/строки/семантический фильтр таблиц | table-architect, table-auto-fill, table-semantic-filter | ⬜ |
| M8 | Документы | загруженный документ → разбор в граф | document-attribution, structured-document-compiler | ⬜ |
| M9 | Спринты | данные спринта → подсказки/сводка ретро | sprint-helper-suggest, sprint-review-summary | ⬜ |
| MX | Probe (проактивные уточнения) | поймать пробел → задать вопрос человеку | probe-formulate, probe-question | ⬜ (сквозной механизм, не отдельная фича) |

---

## M1 — Помощник и общение с сотрудниками ✅

### Назначение
Единая точка, через которую сотрудник общается с Корой в живом диалоге — из любого
окна (кабинет, Telegram, скоро MAX). Закрывает четыре вещи:
1. **Вопрос к памяти компании** — «что решили / обсуждали / почему / сколько».
2. **Действие/просмотр** — поставить задачу, создать встречу/событие, найти слот,
   показать мои задачи/календарь.
3. **Утверждение для памяти** — идея, предложение, наблюдение, факт о клиенте →
   занести в граф знаний.
4. **Ежедневные план/отчёт** — структурный чек-ин сотрудника.

### Граница
**Входит:** понимание запроса, развилка (вопрос / действие / память / уточнение /
отказ), синтез ответа из памяти, разбор чек-ина, доставка ответа в канал-источник.
**НЕ входит:** само наполнение графа специалистами (это M2/M3), аналитика пульса и
дашборды (M6), отчёты встреч (M4). Модуль их ПОРОЖДАЕТ события/заметки, но не считает.

### Вход → выход (проверенная цепочка)
```
Сообщение сотрудника (Telegram / кабинет)
  │
  ├─ Telegram/боты: КЛАССИФИКАТОР канала (dialog-classify)
  │     ├─ план/отчёт дня → структурный чек-ин (checkin-parse → DailyCheckIn
  │     │                    + «отчёт принят» + мост в граф)   ← отдельная ветка
  │     └─ всё остальное → ПОМОЩНИК
  │
  ├─ Кабинет: сразу ПОМОЩНИК (классификатора нет — он бот-штука)
  │
  └─ ПОМОЩНИК (concierge-respond, native-инструменты):
        • вопрос → ask_chat_v2 (терминально)
        • утверждение/идея → ingest_note → граф
        • действие → create_event / find_free_slot / create_meeting / delete_event
        • задача → create_task; «мои задачи» → list_tasks; найти задачу → search_tasks
        • человек → get_person_pulse; сомнение → один уточняющий вопрос
        • не про компанию → вежливый отказ
              │
              └─ ask_chat_v2 → CHAT-V2 (умный ответ):
                    понимание ОДИН раз (3 формулировки + план) →
                    параллельный поиск граф + умные таблицы →
                    один синтез с цитатами → ответ напрямую
  ▼
Выход: ответ / действие сделано / заметка сохранена / уточнение / отказ
```

### Состав (агенты и компоненты)
| Роль в модуле | Агент / `taskType` | Файл | Промпт |
|---|---|---|---|
| Классификатор намерения канала | `dialog-classify` | `dialog-layer/services/query-classifier.service.ts` | `classify.prompt.ts` |
| Понимание запроса (3 формулировки) | `dialog-multi-query` → `query-understand` | `dialog-layer/services/multi-query-expansion.service.ts` | ТЗ dialog-layer Прил. A |
| Извлекатель плана-фильтра | `dialog-extract-plan` | `dialog-layer/services/query-plan-extractor.service.ts` | ТЗ dialog-layer Прил. B |
| Помощник (развилка + руки) | `concierge-respond` | `concierge/services/concierge.service.ts` | ТЗ помощника Прил. A |
| Умный ответ из памяти | chat-v2 synthesize | `knowledge-core/services/chat-v2.service.ts` | ТЗ chat-v2 Прил. A |
| Заголовок диалога | `chat-v2-conversation-title` | `chat-v2/prompts/chat-v2-conversation-title.prompt.ts` | там же |
| Разбор чек-ина | `checkin-parse` | `operations/services/checkin-parser.service.ts` | `checkin-*.prompt.ts` |
| Доставка/окна | — (адаптеры) | `conversational/adapters/{telegram-bot,max-bot}/*`, `conversational.service.ts` | — |
| Инструменты помощника | реестр | `concierge/services/service-map-generator.service.ts` | — |

**Смежные (вызываются, но живут в других модулях):** `ask_role_clone`/clone-respond
(M5, доступен как инструмент), `checkin-sentiment` (M6), `probe-formulate` (MX).

### Инварианты модуля
1. **Вопрос → помощнику; утверждение → в граф.** Заметка/идея/проблема никогда не
   «отвечается», а сохраняется. (Проверено `smoke-dialog-classify-battery.ts`: 0 утечек.)
2. **Понимание и синтез — по одному разу,** внутри chat-v2 (не дублируются в помощнике).
3. **Чек-ины остаются структурными** (не уходят в `ingest_note`) — иначе теряется
   дашборд и «отчёт принят».
4. **Границы:** только дела компании; код/отвлечённое — вежливый отказ.
5. **Сомневаешься — уточни** (крен «лучше спросить»; порог-крутилка `CONCIERGE_CLARIFY_MIN_CONFIDENCE`).
6. **Каналы не получают своей бизнес-логики** — вносим в помощника один раз, работает везде.

### ТЗ переработки (2026-06) и тесты
- [dialog-layer](../../plans/archive/2026-06-14-dialog-layer-unified-query-understanding.md) — понимание (3 формулировки + план).
- [chat-v2](../../plans/archive/2026-06-15-chat-v2-unified-answer-prompt.md) — единый ответ + таблицы.
- [помощник](../../plans/archive/2026-06-14-assistant-router-dedup-and-prompt.md) — дедуп + ingest_note + уточнение.
- [channels](../../plans/archive/2026-06-11-assistant-channels-telegram-max.md) — труба Telegram→помощник.
- Порядок реализации: dialog-layer → chat-v2 → помощник → channels.
- Полевые тесты (реальная модель): `backend/scripts/eval/smoke-{dialog-classify,concierge-routing,query-understanding}-battery.ts`.

### Открытое / на тюнинг
- План иногда ставит «посчитать=true» на «сколько стоит» (цена ≠ количество) — мелкий тюнинг.
- Второй отчёт-дополнение днём классифицируется как note (в граф), но не дописывается
  в структурный отчёт — приемлемо, но знать.

---

## M5 — Клоны и персоны ✅

### Назначение
Превратить накопленную в графе память о том, как работает носитель должности, в
**исполняемого ролевого клона** — артефакт «думай как роль X», который умеет
отвечать от лица должности, опираясь только на память роли. Клон **ролевой, не
персональный**: строится по должности, переживает ротацию людей (см.
[[../01_projects/skill-and-clone]], memory `project_clones_are_role_based`). Две
половины:
1. **Что роль ЗНАЕТ** (Специалист 3.2) — профиль знаний `Person.knowledgeProfile`
   (факты, опыт, экспертиза). Отвечает на «кто разбирается в X». См. [[../01_projects/knowledge-clone]].
2. **Как роль ДУМАЕТ/РЕШАЕТ** (Специалист 3.7) — наблюдаемый МЕТОД работы: черты
   подхода (`SkillTrait`), ценности/мотивация из выбора-в-ущерб, принципы роли
   (`RolePrinciple`), маркеры процесса, типовые «ситуация→ход» (`PracticeSkill`).
   Отвечает на «что бы роль X сделала в этой ситуации».

Над ними — сборка `ExecutablePersona`, ответ от лица клона (`clone-respond`) и
контроль качества. **Смежная под-область — голос бренда** (`brand-voice`, модуль
`backend/src/modules/brand-voice/`): персона КОМПАНИИ для маркетинга, не клон
человека — здесь только указатель, разбирается отдельно.

### Граница
**Входит:** профиль знаний роли, детекторы черт/ценностей/принципов/маркеров,
верификация и дедуп черт, сборка и версионирование персоны, ответ от лица клона,
расширение запроса к клону, валидация качества, CDM-интервью.
**НЕ входит:** наполнение графа (M2), типизация блоков в общие сущности (M3),
общий поиск/чат компании (M1/chat-v2). Модуль **ЧИТАЕТ** граф как сырьё, но сам в
общий граф (`IdeaBlock`/`Entity`/`Theme`/`Decision`) ничего не пишет — кроме
3 «общих» агентов (метка 🔵 ниже).

### Связь с общей памятью (ключевое для модульности)
- 🟣 **только клон** — пишет лишь в артефакты клона (`SkillProfile`/`SkillTrait`/
  `RolePrinciple`/`ExecutablePersona`); общий граф только читает.
- 🔵 **общий + клон** — ОДИН агент пишет и в общую память, и в клон. Это
  `knowledge-clone-extract`/`-merge` (профиль знаний = и фундамент клона, и общий
  поиск «кто знает X» через `Specialist32CardHandler` в chat-v2) и
  `knowledge-specialists-combined` (один LLM-вызов → 8 типов сущностей сразу).
- ⚪ **кормит клон** — агент общей памяти (модули M2/M3), его выход — сырьё;
  разбирается в своём модуле, здесь только указатель: `block-ingest`
  (subject-атрибуция «кто сказал»), `role-profile-build` (карта должности),
  `decision-extract`/`-supersede`, `process-template-extract`.

### Вход → выход (проверенная цепочка)
```
события компании (встречи / чаты / решения)
  │
  ⚪ block-ingest → общий граф: IdeaBlock + Entity + subject-атрибуция «кто сказал»
  │                                  │
  │   ┌──────────────────────────────┴───────────────────────────┐
  ▼   ▼ (3.2)                                                       ▼ (3.7 — ядро клона)
⚪ role-profile  🔵 knowledge-clone-extract/merge          🟣 skill-trait-detect → merge → verify
  (карта роли)     («что знает» → knowledgeProfile;            🟣 value-motivation-detect
  │                 ОН ЖЕ — поиск «кто знает X»)               🟣 process-marker-detect
  │                                                            🟣 role-principle-synthesize
  │                                                            🟣 cdm-case-interview (probe носителю)
  │                                                            🟣 skill-trait-concept-name (нормализация)
  └─────────────────────────────┬─────────────────────────────────┘
                                ▼
              🟣 executable-persona-compile → ExecutablePersona («думай как роль X»)
                                │  (+ role-clone-persona-versioning при смене носителя)
                                ▼
              🟣 clone-respond  ◄── 🟣 dialog-multi-query-clone (расширение вопроса)
                                │   анти-дипфейк: topic-density ДО LLM + grounding ПОСЛЕ
                                ▼
              🟣 persona-behavior-judge (еженедельно: v1 vs v2 на реальном кейсе → метрики)
  ▼
Выход: ExecutablePersona (артефакт клона) · ответ от лица роли с цитатами или честный отказ
```

### Состав (агенты и компоненты)
| Роль в модуле | Агент / `taskType` | Файл промпта | Метка |
|---|---|---|---|
| Профиль знаний роли (извлечение) | `knowledge-clone-extract` | `prompts/knowledge-clone-extract.prompt.ts` | 🔵 |
| Профиль знаний роли (слияние+decay) | `knowledge-clone-merge` | `prompts/knowledge-clone-merge.prompt.ts` | 🔵 |
| Черта подхода (извлечение) | `skill-trait-detect` | `prompts/skill-trait-detect.prompt.ts` | 🟣 |
| Арбитр дублей черт | `skill-trait-merge` | `prompts/skill-trait-merge.prompt.ts` | 🟣 |
| Grounding-верификатор черты | `skill-trait-verify` | `prompts/skill-trait-verify.prompt.ts` | 🟣 |
| Каноническое имя концепта навыка | `skill-trait-concept-name` | `prompts/skill-trait-concept-name.prompt.ts` | 🟣 |
| Ценности/мотивация (из trade-off) | `value-motivation-detect` | `prompts/value-motivation-detect.prompt.ts` | 🟣 |
| Маркеры процесса | `process-marker-detect` | `prompts/process-marker-detect.prompt.ts` | 🟣 |
| Принципы роли (Reflection) | `role-principle-synthesize` | `prompts/role-principle-synthesize.prompt.ts` | 🟣 |
| CDM-интервью носителя | `cdm-case-interview` | `prompts/cdm-case-interview.prompt.ts` | 🟣 |
| Сборка исполняемого клона | `executable-persona-compile` | `prompts/executable-persona-compile.prompt.ts` | 🟣 |
| Версионирование клона роли | — (event `role.bearer_changed`) | `services/role-clone-persona-versioning.handler.ts` | 🟣 |
| Ответ от лица клона | `clone-respond` | `prompts/clone-respond.prompt.ts` | 🟣 |
| Расширение запроса к клону | `dialog-multi-query-clone` | `dialog-layer/prompts/multi-query-clone.prompt.ts` | 🟣 |
| Валидация качества клона | `persona-behavior-judge` | `prompts/persona-behavior-judge.prompt.ts` | 🟣 |
| Объединённый специалист (rollout) | `knowledge-specialists-combined` | `prompts/specialists-combined.prompt.ts` | 🔵 |

> Все пути без префикса — относительно `backend/src/modules/knowledge-core/`.
> Голос бренда (`brand-voice`) — смежная персона компании, разбирается отдельно.

### Инварианты модуля
1. **Клон ролевой, не персональный** — `scope='role'`, `publicName='Клон <Role> vN'`;
   персональные доступы открываются через `CloneAccessGrant`. **С 2026-06-16 (Раздел 7):
   один человек = один клон должности** — клон роли = снимок ОДНОГО текущего носителя
   (без агрегации нескольких людей). Прошлый носитель замораживается
   (`PersonaStatus.frozen`, read-only, доступен навсегда), не удаляется. ФИО в выводе
   клона и истории НЕ хранится — только ярлык «должность + версия».
2. **Только наблюдаемый МЕТОД, не психотип** (Personality Illusion): каждый слой —
   правило процесса с якорем-цитатой, никогда ярлык. MBTI/DISC/OCEAN — анти-scope.
3. **Ценность — только из выбора-в-ущерб** (revealed preference), не из деклараций.
4. **Анти-дипфейк двойной:** topic-density ДО LLM (≥2 блока, cosine ≥ 0.70) +
   grounding ПОСЛЕ LLM; нет опоры → честный отказ (`refusalReason='ungrounded'`), не выдумка.
5. **Черта в персону — только после grounding-верификации** (`skill-trait-verify`);
   при сбое LLM — fail-open (не блокируем профиль из-за сбоя).
6. **Auto-canonical без human-approval** — только kill-switch + `mark_as_misleading`
   постфактум (memory `feedback_no_human_in_loop_for_clone_learning`).
7. **152-ФЗ к модели клона НЕ применяем (решение владельца 2026-06-16, И8)** — клон —
   артефакт памяти компании, а не персональные данные носителя: ФИО не хранится в выводе,
   владелец Org не управляет хранением/удалением клонов бывших. (Прежняя оговорка
   «single-incumbent = риск 152-ФЗ» снята явным решением.)

### ТЗ/статус
- База γ-1: [[../01_projects/skill-and-clone]], [[../01_projects/knowledge-clone]].
- [clone-reliability-hardening](../../plans/archive/2026-05-25-clone-reliability-hardening.md) (2026-05-25).
- [clone-quality-improvements](../../plans/tz/2026-06-08-clone-quality-improvements.md) (2026-06-08, 8 фаз).
- [clone-persona-method-layer](../../plans/archive/2026-06-11-clone-persona-method-layer.md) (2026-06-12, метод-слой, +5 `taskType`).
- [clone-agents-prompt-revision](../../plans/tz/2026-06-16-clone-agents-prompt-revision.md) (2026-06-16, ветка `devsv`): Раздел 7 «один человек = один клон должности» (`PersonaStatus += frozen`, snapshot одного носителя, freeze бывших, ask-all-formers, анонимизация) + Раздел 8 (21 баг конвейера) + Приложения A–D (ревизия 12 промптов клона: якорь смысла + few-shot + self-check). См. [[../01_projects/skill-and-clone]] §«Доработки 2026-06-16».
- **Ревизия промптов по методологии** — [docs/methodology/prompts/upgrade-progress.md](../../docs/methodology/prompts/upgrade-progress.md),
  группа «Клоны/персоны». 12/12 🟣 clone-only промптов закрыты (пачки 1–4, 2026-06-16); общие 🔵-агенты — в сессии по общей памяти.

### Открытое / на тюнинг
- `skill-trait-merge`/`-verify` работают на дешёвой модели (flash) и являются
  гейтами/классификаторами — кандидаты на few-shot + перенос порога в код (см. ревизию).
- `dialog-multi-query-clone` — из «3 потерянных» в реестре `taskType` (нет в
  админке/сиде → DEFAULT-цепочка), см. memory `project_llm_tasktypes_missing_from_registry`.
- `knowledge-specialists-combined` за rollout-флагом `SPECIALISTS_COMBINED_ENABLED`
  (default OFF) — формально расходится с Ship-On, это переходный rollout.
