---
type: tz
status: ready-to-implement
feature: probe-clarify-dialog
date: 2026-06-27
owner: владелец Z (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-27-probe-clarify-dialog-reliability.md
  - second-brain/01_projects/probe-agent.md
  - second-brain/01_projects/probe-observers-catalog.md
---
> Анализ: `plans/analysis/2026-06-27-probe-clarify-dialog-reliability.md` · Статус согласования: 2026-06-27 (4 развилки §9 сняты по рекомендациям)

# ТЗ: Надёжное диалоговое уточнение probe-ответов с детерминированным применением

## Принцип
**LLM решает, ЧТО человек имел в виду. Код решает, КАК это записать. Человек подтверждает echo-back перед записью.** Диалог только собирает намерение, запись делает существующий детерминированный идемпотентный apply-слой. Один путь записи. Ни одно изменение данных — не «втихую необратимо».

## Цель + Зачем
Сегодня петля проактивного вопроса (probe) односторонняя и однократная: Кора спросила → человек ответил один раз → код применил. **Болезненное состояние (verified по коду):**
- Непонятный ответ — тупик: `ProbeResponseHandler` ставит `notification_response_unclear=true` и метрику, но встречного вопроса нет (`requiresFollowup` модель возвращает — поле не используется). Человек не может переспросить.
- Даже «понятный» ответ разбирается хрупко: дизамбигуация «удалить/уточнить» по подстроке `удал`; нераспознанный человек/дата молча теряются (`apply` делает `return`); `unclear`-ответ всё равно пишется в данные; урок эксперимента/описание задачи дублируются при повторе; `decision.overdue`/`companyprofile.*` перезаписывают без guard; `approve_with_edits` теряет значение «переименовать в X».

Решение делает петлю надёжной на масштабе сотен компаний: типизированный разбор намерения, эскалация в один уточняющий ход при сомнении, echo-back подтверждение перед записью, детерминированное идемпотентное применение, честные терминалы и наблюдаемость. Доказательство выбора (две независимых проработки + red-team) — в анализе §6–§8.

## REALITY-CHECK (фактический статус по коду, 2026-06-27)
- **Apply-слой готов и идемпотентен** — `backend/src/modules/probe/probe-response.handler.ts`. Узкие `updateMany` с условием «поле пустое», best-effort. **Переиспользуем, не дублируем.** НО содержит хрупкости §4 анализа — их чиним (Ф1), сам каркаc событий не ломаем.
- **Точка финализации/эмиссии** — `ConversationalService.respondToProbe` (`conversational.service.ts`): проверяет адресность (`not_recipient`), идемпотентность (`responseStatus==='answered'` → ранний возврат), эмитит `notification.responded`. Это **единственная** точка входа в применение. Диалоговый слой встаёт ПЕРЕД эмиссией.
- **LLM-классификатор ответа уже есть** — `tryClassifyResponse` (taskType `probe-response-classify`, промпт `probe/prompts/probe-response-classify.prompt.ts`, возвращает `{answer, confidence, requiresFollowup}`). Расширяем его схему до типизированного намерения, а не вводим новый.
- **Распознавание свободного текста как probe-ответа** — `query-classifier.service.ts` (`openProbeQuestion` → интент `probe_reply`) + бот-адаптеры `telegram-bot.adapter.ts`/`max-bot.adapter.ts` (`findOpenProbe`). **Барьер:** имплицитный probe-ответ из ботов (`InboundMessage {type:'response'}`) **не имеет подписчика** (`subscribeInbound('response')` отсутствует) — доходит до применения только через REST. Чиним в Ф5.
- **Дайджест** агрегирует несколько probe в одно уведомление; `findOpenProbe` берёт один `findFirst` по `createdAt desc` — для дайджеста **некорректно** (не знает, на какой из пачки отвечают). Чиним в Ф5.
- **Полноценный движок Мастера (concierge) НЕ подключается в этой итерации** (развилка 1 — «минимальный шов»). Эта итерация добавляет ОДИН ход в саму probe-петлю. Программный старт `concierge.process` от probe — vNext.
- `ProbeStatus` enum (`schema.prisma:6486`) расширяется **аддитивно** (безопасно). `cfg.probe.*` — через `resolveSync` (`typed-config.service.ts`), пороги-крутилки регистрируются в `admin-setting-schema-registry.ts` форматом `['probe.key', zodSchema]`.

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| В1 | **Минимальный шов:** добавить ОДИН уточняющий/подтверждающий ход в probe-петлю; полноценный диалоговый Мастер — vNext, точечно | Координационный шов — топ-класс отказов мульти-агентных систем (анализ §6, MAST 41–86.7% fail). Один ход даёт основную пользу при минимуме fail-surface |
| В2 | **Echo-back для ВСЕХ структурных применений** («Понял так: …. Применить?»); жёсткое обязательное подтверждение — для необратимых (удаление/закрытие) | Multi-turn модели завершают преждевременно и уверенно (анализ §6, arXiv 2505.06120); echo-back снимает это, а не только защищает удаление |
| В3 | **Починку хрупкостей применения (§4) — ПЕРВОЙ фазой** | Надёжностный фундамент; любой путь (one-shot/диалог) наследует те же дыры |
| В4 | **НЕ расширять на домены без apply** (цели/карточки/темпоральные/идеи/навыки) | Онтологический долг растёт O(домены) (анализ §6, 2507.23358); довести 5 существующих доменов надёжно |
| В5 | LLM **не пишет в данные**; confidence только для маршрутизации, не авто-коммита; порог — AdminSetting per-tenant; reason-then-constrain; идемпотентный ключ финализации; graceful degradation к one-shot; адресность/tenant/dataClass сохранить | Red-team устоявшее ядро (анализ §6) |

## Доказательство выбора
Полная состязательная матрица A (слои) / B (всё через Мастера) / C (one-shot+1 ход) с источниками и red-team-проходом — анализ §7–§8. Кратко: B отвергнут (агент пишет в данные → надёжность записи низкая, инциденты); итог — синтез C→A с жёсткими границами, где red-team убрал два слабых звена (детерминизм-по-форме завершения и confidence-gate на мутацию), заменив на echo-back и «confidence только маршрутизация».

## Scope

### Входит
- Типизированный разбор ответа (намерение вместо строкового матча) для 5 доменов: **решения, задачи (Issue/IntakeIssue), регламент-существование, эксперимент-урок, профиль компании**.
- Эскалация в ОДИН уточняющий ход при низкой уверенности ИЛИ встречном вопросе.
- Echo-back подтверждение перед применением (жёсткое — для необратимого).
- Персистентное состояние «намерение + ожидание подтверждения/уточнения».
- Подписчик `subscribeInbound('response')` + адресность ответа в дайджесте.
- Терминалы исходов + метрики переходов + graceful degradation.

### Не входит (vNext — отдельные ТЗ)
- **Полноценный диалоговый Мастер (concierge) от probe** (многоходовый, с инструментами) → `plans/tz/vNext-probe-master-full-dialog.md` (заглушка). Причина: развилка В1.
- **Применение для доменов без apply** (цели, карточки, темпоральные, идеи, навыки, инсайты, атрибуция, регламент-владелец/шаги, consistency) → `plans/tz/vNext-probe-apply-remaining-domains.md`. Причина: В4.
- Inline-кнопки в probe — запрещены (только свободный текст/голос-ASR), это инвариант, не scope.

### Граничные контракты с другими ТЗ
- `ProbeResponseHandler` apply-методы — **реальные здесь** (чиним и переиспользуем).
- `concierge.service.ts` — **не трогаем** в этой итерации (мок не нужен, просто вне scope).
- `ingestNotificationResponse` (запись ответа в граф) и Subject Memory — **остаются как есть**, вызываются после успешного применения.

## Контракт-first

### Б1. Расширение схемы классификатора ответа (reason-then-constrain)
Расширить `probe-response-classify` — типизированное намерение вместо `{answer, confidence, requiresFollowup}`. Модель сперва свободно рассуждает (reasoning-поле), затем заполняет typed-исход. Дословный контракт (новый `PROBE_RESPONSE_INTENT_JSON_SCHEMA`, заменяет `probe_response_classify_v1` → `probe_response_intent_v1`):
```jsonc
{
  "type": "object", "additionalProperties": false,
  "required": ["reasoning", "outcome", "confidence"],
  "properties": {
    "reasoning": { "type": "string", "maxLength": 600 },   // свободное рассуждение ДО типизации
    "outcome": {
      "type": "string",
      "enum": ["apply", "delete", "refine", "counter_question", "unclear"]
      // apply — понятный ответ по сути; delete — «не задача/не решение/удалить»;
      // refine — содержательное уточнение текста (не команда удаления);
      // counter_question — человек задал встречный вопрос вместо ответа;
      // unclear — невозможно разобрать
    },
    "value": { "type": "string", "maxLength": 1000 },       // извлечённое значение (имя/дата-текст/итог/описание)
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
```
**Почему:** разводит «удалить» от «полезный текст» типом `outcome`, а не подстрокой `удал` (фикс §4.1); `counter_question` даёт явный триггер эскалации; `value` несёт извлечённое значение для `approve_with_edits` (фикс §4.5). Прежний `mapExistenceConfirmAnswer` строковый матч **удаляется** из пути применения (остаётся только как deterministic-fallback при деградации LLM, Ф6).

### Б2. Persisted-состояние диалога — новая модель `ProbeDialogState`
Хранить собранное намерение и фазу между ходами **в БД** (не только Redis — для надёжности на масштабе и аудита; Redis — кэш быстрого доступа в каналах, как `channelClarifyKey`). Дословный Prisma-сниппет (добавить в `schema.prisma`):
```prisma
/// Состояние одного диалогового probe-уточнения: собранное намерение + фаза.
/// Один ProbeEvent → не более одной активной строки (phase != resolved).
model ProbeDialogState {
  id             String              @id @default(cuid())
  tenantId       String
  probeEventId   String
  recipientUserId String
  phase          ProbeDialogPhase    @default(awaiting_answer)
  outcome        String?             // последний outcome из Б1 (apply/delete/refine/...)
  collectedValue String?             // извлечённое значение намерения
  confidence     Float?
  turnCount      Int                 @default(0)   // защита от бесконечного диалога
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt
  probeEvent     ProbeEvent          @relation(fields: [probeEventId], references: [id], onDelete: Cascade)

  @@index([tenantId, probeEventId])
  @@index([tenantId, recipientUserId, phase])
}

enum ProbeDialogPhase {
  awaiting_answer        // ждём первый ответ (= нынешний one-shot)
  awaiting_clarification // задали уточняющий ход, ждём доответ
  awaiting_confirmation  // показали echo-back, ждём «да/поправку»
  resolved               // финализировано (применено/отклонено/эскалировано/брошено)
}
```
**Почему БД, не Redis:** критерий — надёжность на масштабе; Redis-TTL теряет состояние при рестарте/истечении, а собранное намерение перед записью терять нельзя. `turnCount` — детерминированный предохранитель от зацикливания (макс. число ходов — крутилка Б6).

### Б3. Новые ProbeStatus + терминалы (аддитивная миграция)
```prisma
// добавить значения в enum ProbeStatus:
  /// Диалог: задан уточняющий/подтверждающий ход, ждём ответ человека.
  awaiting_dialog
  /// Диалог: ответ применён в данные после подтверждения.
  applied
  /// Диалог: не удалось доразобрать за лимит ходов → отдано человеку (владелец/админ).
  escalated_to_human
  /// Диалог: человек не довёл уточнение до конца (истёк/бросил).
  abandoned
```
**Почему явные терминалы:** «ушёл молча» не считать успехом (анти-паттерн Fin, анализ §5). Метрика на каждый переход — иначе слёты невидимы.

### Б4. Новые eventType для echo-back
- `probe.confirm` — вопрос-подтверждение echo-back («Понял так: …. Применить? Ответьте „да" или поправьте.»). Канал-политика как у `probe.question`. Только текст (без inline-кнопок).
- `probe.clarify` — уточняющий ход при `counter_question`/нераспознанном значении.
Оба регистрируются в `event-payload.registry.ts` (Zod) + рендер в telegram/max-bot адаптерах + фронт-label (русский). Ответ на них ловится тем же `findOpenProbe` (расширить список eventType) → `respondToProbe`.

### Б5. ASCII-поток (целевой)
```
Probe-вопрос задан (как сейчас) → ProbeDialogState(awaiting_answer)
        │ человек ответил (REST или бот type:'response')
        ▼
classify (Б1) → outcome + confidence
        │
        ├─ outcome=apply & confidence ≥ порог ───────► echo-back (Б2 awaiting_confirmation, eventType probe.confirm)
        │                                                     │ «да» ──► APPLY (детерминир. слой) → applied
        │                                                     │ поправка ──► повторный classify (turnCount++)
        ├─ outcome=delete ──► echo-back ЖЁСТКИЙ ──────────────┤        (необратимое — подтверждение обязательно)
        │                                                     │ «да» ──► softDelete → applied
        ├─ outcome=refine/counter_question
        │     ИЛИ confidence < порог ─────────────────► clarify-ход (awaiting_clarification, probe.clarify)
        │                                                     │ доответ ──► повторный classify (turnCount++)
        ├─ outcome=unclear ─────────────────────────────► clarify-ход (НЕ мутировать!)
        │
        └─ turnCount > лимит ──► escalated_to_human (owner/admin) + ingest в память
APPLY всегда: идемпотентный ключ финализации(probeEventId) → один раз → ingest в граф + SubjectMemory + ack
LLM недоступен ──► graceful degradation: нынешний детерминированный one-shot путь (Ф6)
```

### Б6. Новые крутилки (AdminSetting, секция `probe`)
Регистрировать в `admin-setting-schema-registry.ts` + сид `seed-admin-settings.ts` (формат `['probe.key', zod]`):
```
['probe.dialogEnabled', z.boolean()]              // kill-switch, ON
['probe.dialogEscalateMaxConfidence', UNIT_INTERVAL] // ниже порога → clarify (дефолт 0.6); per-tenant
['probe.dialogMaxTurns', POSITIVE_INT]            // лимит ходов до escalated_to_human (дефолт 2)
['probe.dialogConfirmTtlHours', POSITIVE_INT]     // TTL ожидания подтверждения до abandoned (дефолт 48)
```
**Почему AdminSetting per-tenant:** калибровка LLM-уверенности уезжает между компаниями (анализ §6) — единый зашитый порог невозможен (инвариант проекта: пороги — крутилки, не код).

## Границы фичи
- ✅ Always: писать в данные только через детерминированный apply-слой; идемпотентно; echo-back перед записью; tenant/dataClass/адресность из `ProbeEvent`/`Notification`.
- ⚠️ Ask first: добавление нового домена применения (вне 5); изменение формата существующего eventType.
- 🚫 Never: давать LLM/Мастеру write-tools на probe-домены (двойное применение); inline-кнопки в probe; мутировать данные при `outcome=unclear`; авто-коммит по confidence без echo-back; терять ответ молча.

## Фазы

### Граф зависимостей
```
Ф1 (фундамент apply) ─► Ф2 (intent-контракт + ProbeDialogState) ─► Ф3 (эскалация clarify) ─► Ф4 (echo-back)
                                                                          └─► Ф5 (мост ботов + дайджест) ─┘
Ф6 (терминалы + метрики + degradation) — после Ф3–Ф5 (финал)
```
Ф1 независима (можно начинать сразу). Ф2 зависит Ф1. Ф3 и Ф5 — после Ф2 (Ф5 частично параллельна Ф3/Ф4 по коду ботов). Ф4 после Ф3. Ф6 — финал.

---

### Ф1 — Фундамент: типизированный разбор + надёжное применение `[x]`
**Цель:** убрать хрупкости §4 независимо от диалога. Чисто бэкенд.
**Файлы:** `probe/probe-response.handler.ts`, `probe/prompts/probe-response-classify.prompt.ts`, `probe/existence-confirm.util.ts`, `prisma/schema.prisma` (если нужно поле — нет на этой фазе).
**Что входит:**
- Расширить промпт/схему классификатора до `probe_response_intent_v1` (Б1) с `outcome`/`value`/`reasoning`.
- В `ProbeResponseHandler`: ветвление по `outcome` (а не по `mapExistenceConfirmAnswer`). `outcome=delete` → softDelete-ветка; `refine`/`apply` → запись значения; `unclear` → **НЕ мутировать** (вернуть без записи, лог + метрика).
- Явные исходы «человек не распознан»/«дата не распознана»: если резолв (`assigneeResolver`/`resolveDeciderPersonId`/`parseRussianDueDate`) дал null — НЕ молчаливый `return`, а пометить состояние «нужно доуточнить» (потребитель — Ф3).
- Идемпотентность set-once: `decision.overdue` — добавить условие на перезапись только пустого срока ИЛИ явный echo-back (увязать с Ф4); `companyprofile.*` — guard от затирания ручной правки; append-исходы (`experiment.lessonsJson`, `appendTaskDescription`) — дедуп по содержимому или ключу хода.
- `approve_with_edits` — извлечь `value` (новое имя / personId) и передать в `curation.decide`.
**Что НЕ входит:** диалоговые ходы, echo-back, ProbeDialogState (Ф2+).
**Acceptance:**
- `grep -n "probe_response_intent_v1" probe/prompts/probe-response-classify.prompt.ts` — найдено.
- `grep -n "mapExistenceConfirmAnswer" probe/probe-response.handler.ts` — НЕ в пути применения (только fallback-функция, если оставлена для Ф6).
- Unit: `outcome=unclear` → ни один `prisma.*.updateMany` не вызван (мок prisma, проверить 0 мутаций).
- Unit: повторный `apply` того же намерения на `experiment.result_without_lesson` не добавляет второй элемент в `lessonsJson` (идемпотентно).
- Unit: ответ «удалить упоминание про дедлайн» при `outcome=refine` НЕ удаляет задачу (фикс §4.1).
- `bun run typecheck && bun run lint && bunx vitest run src/modules/probe/probe-response.handler.spec.ts`.
**Закрывает:** R1, R2, R3, R8.

### Ф2 — Контракт намерения + персистентное состояние `[x]`
**Цель:** хранить собранное намерение и фазу между ходами.
**Файлы:** `prisma/schema.prisma` (`ProbeDialogState` + `ProbeDialogPhase`, Б2; новые `ProbeStatus`, Б3), миграция-файл, `probe/probe-response.handler.ts`, новый `probe/probe-dialog.service.ts`.
**Что входит:**
- Миграция: модель `ProbeDialogState`, enum `ProbeDialogPhase`, аддитивные `ProbeStatus`. `bun run prisma:migrate -- --name probe_dialog_state` + ревью SQL.
- `ProbeDialogService`: создать/прочитать/обновить состояние по `probeEventId` (идемпотентно — одна активная строка). `turnCount++` на каждом ходе.
- Связать: первый ответ создаёт/находит `ProbeDialogState(awaiting_answer)`; результат classify пишется в состояние.
**Что НЕ входит:** сама отправка clarify/confirm-ходов (Ф3/Ф4).
**Acceptance:**
- Миграция применяется и повторно — no-op; `bun run prisma:generate` без ошибок.
- Unit: два параллельных ответа на один `probeEventId` не создают две активные `ProbeDialogState` (уникальность активной).
- `grep -n "ProbeDialogState" prisma/schema.prisma` + `@@index([tenantId, probeEventId])` присутствует.
**Закрывает:** R4, R9.

### Ф3 — Эскалация в один уточняющий ход `[x]`
**Цель:** при сомнении/встречном вопросе/нераспознанном значении — задать ОДИН уточняющий вопрос, не терять и не угадывать.
**Файлы:** `probe/probe-response.handler.ts`, `probe/probe-dialog.service.ts`, `conversational.service.ts` (отправка `probe.clarify`), `event-payload.registry.ts`, `typed-config.service.ts` + `admin-setting-schema-registry.ts` + `seed-admin-settings.ts` (крутилки Б6).
**Что входит:**
- Триггер clarify: `outcome ∈ {refine, counter_question, unclear}` ИЛИ `confidence < probe.dialogEscalateMaxConfidence` ИЛИ резолв человека/даты дал null.
- Отправить `probe.clarify` (текст, без кнопок), `phase=awaiting_clarification`, `turnCount++`.
- Доответ ловится → повторный classify. Если `turnCount > probe.dialogMaxTurns` → `escalated_to_human` (owner/admin), ingest в память.
- **confidence только для маршрутизации**, никогда для авто-записи.
**Что НЕ входит:** echo-back подтверждение (Ф4), полноценный concierge.
**Acceptance:**
- Unit: `confidence=0.4` (< дефолт 0.6) → отправлен `probe.clarify`, ноль мутаций данных.
- Unit: `outcome=counter_question` → `probe.clarify`, не применение.
- Unit: `turnCount=3 > dialogMaxTurns=2` → `ProbeStatus=escalated_to_human`, отправлено owner/admin.
- `grep -n "probe.dialogEscalateMaxConfidence" admin-setting-schema-registry.ts` найдено; порог читается per-tenant через `getDynamic`.
- `bunx vitest run src/modules/probe/probe-dialog.service.spec.ts`.
**Закрывает:** R5, R6, R10.

### Ф4 — Echo-back подтверждение перед применением `[x]`
**Цель:** перед любой записью — «Понял так: …. Применить?»; для необратимого — обязательное подтверждение.
**Файлы:** `probe/probe-response.handler.ts`, `probe/probe-dialog.service.ts`, `conversational.service.ts` (`probe.confirm`), `event-payload.registry.ts`, адаптеры ботов (рендер).
**Что входит:**
- При `outcome ∈ {apply, delete}` с достаточной уверенностью → НЕ применять сразу, а отправить `probe.confirm` с человекочитаемым превью намерения, `phase=awaiting_confirmation`.
- Ответ «да/подтверждаю» → применение через детерминированный слой (идемпотентный ключ финализации по `probeEventId` — применить РОВНО один раз). Поправка → повторный classify (`turnCount++`).
- `outcome=delete` (необратимое) — echo-back **обязателен** всегда (нет авто-применения даже при высокой уверенности).
- После применения: `ProbeStatus=applied`, ingest в граф + SubjectMemory + `probe.answer_acknowledged` (как сейчас).
**Что НЕ входит:** домены вне 5.
**Acceptance:**
- Unit: `outcome=apply, confidence=0.95` → сперва `probe.confirm`, мутация только ПОСЛЕ ответа «да».
- Unit: `outcome=delete` при любой уверенности → echo-back, без авто-удаления.
- Unit: двойной ответ «да» на один `probeEventId` → применение РОВНО один раз (идемпотентный ключ).
- Unit: ответ-поправка на `probe.confirm` → повторный classify, `turnCount++`, не применение.
**Закрывает:** R7, R11, R12.

### Ф5 — Подписчик ботов + адресность дайджеста `[ ]`
**Цель:** имплицитный probe-ответ из ботов доходит до диалога; в дайджесте понятно, на какой вопрос отвечают.
**Файлы:** `conversational/*` (где `subscribeInbound`), `telegram-bot.adapter.ts`, `max-bot.adapter.ts`, `query-classifier.service.ts`, `channel.types.ts`.
**Что входит:**
- Завести обработчик `subscribeInbound('response')` (сейчас отсутствует) → маршрутизирует в probe-диалог (`respondToProbe`/`ProbeDialogService`), а не в тупик.
- Дайджест: при ответе на `probe.digest` определить конкретный `probeEventId` из пачки (reply-на-сообщение / явная привязка), а не `findFirst by createdAt`.
**Что НЕ входит:** новые каналы.
**Acceptance:**
- `grep -n "subscribeInbound('response'" conversational/` — найден обработчик (раньше отсутствовал).
- Unit: имплицитный `type:'response'` из Telegram доходит до `ProbeDialogService`, не логируется «нет handlers».
- Unit: ответ на дайджест из 3 вопросов привязывается к правильному `probeEventId`.
**Закрывает:** R13, R14.

### Ф6 — Терминалы, наблюдаемость, деградация `[ ]`
**Цель:** честные исходы, метрики переходов, отказоустойчивость.
**Файлы:** `probe/probe-dialog.service.ts`, `probe/probe-response.handler.ts`, `business-metrics.service.ts`, cron очистки (TTL `awaiting_*` → `abandoned`).
**Что входит:**
- Метрики: `probe_dialog_transition_total{from,to}`, `probe_dialog_outcome_total{outcome}` (applied/escalated_to_human/abandoned).
- TTL: `awaiting_clarification`/`awaiting_confirmation` старше `probe.dialogConfirmTtlHours` → `abandoned` (cron, идемпотентно).
- Graceful degradation: при недоступности LLM-классификатора (`probe-response-classify` упал) → откат к нынешнему детерминированному one-shot пути (старый `mapExistenceConfirmAnswer` + прямое применение), с метрикой `probe_dialog_degraded_total`.
**Что НЕ входит:** дашборд.
**Acceptance:**
- Unit: LLM-classify бросает → применён детерминированный fallback, инкремент `probe_dialog_degraded_total`.
- Unit: `awaiting_confirmation` старше TTL → cron переводит в `abandoned` (повторный прогон — no-op).
- `grep -n "probe_dialog_transition_total" business-metrics.service.ts` найдено.
**Закрывает:** R15, R16, R17.

## Требования (EARS, трассировка)
- **R1** Когда ответ на probe разобран, система shall классифицировать его в типизированный `outcome ∈ {apply,delete,refine,counter_question,unclear}`, а не строковым матчем.
- **R2** Если `outcome=unclear`, then система shall НЕ изменять структурные данные.
- **R3** Если резолв человека/даты вернул null, then система shall пометить состояние «нужно доуточнить», а не молча завершить.
- **R4** Система shall хранить собранное намерение и фазу в `ProbeDialogState` (БД), переживая рестарт.
- **R5** Если `confidence < probe.dialogEscalateMaxConfidence` (per-tenant), then система shall задать один уточняющий ход, а не применить.
- **R6** Когда `turnCount > probe.dialogMaxTurns`, система shall перевести probe в `escalated_to_human` и уведомить owner/admin.
- **R7** Когда `outcome ∈ {apply,delete}`, система shall отправить echo-back и применить ТОЛЬКО после подтверждения человеком.
- **R8** Применение каждого намерения shall быть идемпотентным (повтор = no-op): set-once поля, дедуп append.
- **R9** Система shall расширять `ProbeStatus` аддитивно (`awaiting_dialog`/`applied`/`escalated_to_human`/`abandoned`).
- **R10** Confidence shall использоваться только для маршрутизации (one-shot/clarify/human), не для авто-записи.
- **R11** Для `outcome=delete` (необратимое) echo-back shall быть обязательным при любой уверенности.
- **R12** Финализация применения shall идти ровно один раз на `probeEventId` (идемпотентный ключ).
- **R13** Имплицитный probe-ответ из ботов (`type:'response'`) shall доходить до probe-диалога, а не теряться.
- **R14** При ответе на дайджест система shall привязывать ответ к конкретному `probeEventId` из пачки.
- **R15** Система shall эмитить метрику на каждый переход фазы и каждый терминал.
- **R16** Когда LLM-классификатор недоступен, система shall откатываться к детерминированному one-shot пути с метрикой деградации.
- **R17** Состояние `awaiting_*` старше `probe.dialogConfirmTtlHours` shall переводиться в `abandoned`.

## Pre-mortem / Риски + ревью-аспекты
- **Двойное применение** (R8/R12): один ответ → две записи. Ревью: идемпотентный ключ финализации; ни одного write вне детерминированного слоя.
- **Преждевременное завершение модели** (В2): echo-back обязателен — ревью: нет авто-применения без `awaiting_confirmation → да`.
- **Утечка dataClass**: `probe.confirm`/`probe.clarify` уходят в канал с `maxDataClass` ниже класса probe. Ревью: класс сообщений = класс `ProbeEvent`.
- **Адресность**: ответить может только получатель (`respondToProbe` `not_recipient`). Ревью: clarify/confirm не открывают ответ другому.
- **Зацикливание диалога**: `turnCount`/`dialogMaxTurns` предохранитель. Ревью: лимит соблюдён, есть терминал.
- Ревью-гейт: `strict-production-review-gate` — FSM фаз `ProbeDialogState`, идемпотентность, отсутствие auth-обхода адресности, отсутствие мутации при unclear.

## Idempotency / feature-flag / prod-deploy
- **Флаг** `probe.dialogEnabled` — **kill-switch (тип А, ON)**: фича выкатывается включённой (Ship-On), рубильник лишь для экстренного выключения → откат к one-shot. Строка в `docs/operations/feature-flags.md`.
- **Миграция** `probe_dialog_state` (Ф2) → `prod-deploy-log.md` Шаг 4; новые `ProbeStatus`/`ProbeDialogPhase` — аддитивны.
- **Сид крутилок** `seed-admin-settings.ts` (Б6) → Шаг 7; идемпотентен (уважает admin-override).
- Новые eventType (`probe.confirm`/`probe.clarify`) → Шаг 12 (Swagger/registry smoke).
- Новые метрики (Ф6) → Шаг 12 (grep `/metrics`).

## DoD
- `bun run typecheck` (вкл. `.spec`) · `lint` · `build` — зелёные; vitest по затронутым файлам зелёный.
- second-brain обновлён: `01_projects/probe-agent.md` (диалоговый слой), `01_projects/probe-observers-catalog.md` (раздел «после ответа» — добавить ветку диалога), `02_architecture/data-model.md` (`ProbeDialogState`), `feature-flags.md` (`probe.dialogEnabled`).
- `prod-deploy-log.md` обновлён (Шаги 4/7/12).
- Реестр не-сделанного: снять строку про тупик one-shot (если есть), добавить vNext-заглушки (полный Мастер, домены без apply).
- Рефлексия в `05_история/`.

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось.)_
