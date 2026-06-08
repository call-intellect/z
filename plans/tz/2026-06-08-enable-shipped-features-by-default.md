# ТЗ: Включить готовый функционал по умолчанию (Ship-On на деплое)

> **Дата:** 2026-06-08 · **Тип:** процессно-технический фикс · **Основание:** CLAUDE.md принцип 8 (Ship-On), реестр `docs/operations/feature-flags.md`
> **Цель одной фразой:** чтобы после обычного `docker compose up -d --build` весь готовый функционал заработал в боевом режиме САМ — без ручного хождения по админке и щёлканья тумблеров.

## 0. Контекст и проблема

Владелец тестирует прод и обнаружил: куча готовых фич выкачены, но лежат выключенными за флагами (наследие старого правила «дефолт OFF, включим потом»). Это противоречит принятому принципу Ship-On. Нужно перевести дефолты в код так, чтобы при заливке всё включалось автоматически.

**Механизм авто-включения уже есть** (проверено): migrate-контейнер при каждом `docker compose up` гоняет `apply-prod-deploy.ts --mode update --with-schema` (`docker-compose.yml:106-114`), а это запускает фазы `patch` + `seed` + `backfill`. Значит:
- **ENV-флаги** — меняем code-дефолт в `typed-config.service.ts` → включится при старте backend.
- **AdminSetting-флаги** (хранятся в БД, уже засеяны `false`) — простой правки seed-дефолта НЕДОСТАТОЧНО для существующего прода (seed идемпотентен, не перезатирает существующие значения). Нужен **patch-скрипт** в `STEPS`, который выставит `true` — он прогонится автоматически на деплое.

## 1. Принцип классификации (что включаем, что нет)

| Класс | Решение | Почему |
|---|---|---|
| Готовая фича, низкий риск, есть fallback | **Включаем дефолтом** | Ship-On: готова → в бой |
| Изменение, которому нужен бизнес-параметр владельца (лимит, матрица) | **НЕ включаем** — оставляем «решение владельца» | Включение вслепую сломает прод (отрежет доступ / заблокирует ИИ) |
| Экспериментальное/незрелое | **НЕ включаем** | Не готово к выкату |

## 2. Что ВКЛЮЧАЕМ по умолчанию (скоуп ТЗ)

| # | Флаг | Тип | Сейчас | Делаем | Риск | Откат |
|---|---|---|---|---|---|---|
| 1 | `knowledge.meetingTasksToTrackerOnly` | AdminSetting | false | **true** | Низкий: поля `assigneeRaw`/`sourceQuote` в карточке задачи встречи станут `null` (Issue их не хранит) | AdminSetting → false, без редеплоя |
| 2 | `CONCIERGE_DIALOG_LAYER_ENABLED` | ENV (code-default) | false | **true** | Низкий: +неск. дешёвых LLM-вызовов на cache-miss; защита `@Optional()`+try/catch+fallback на legacy | ENV=false + рестарт |
| 3 | `curation.autotuneEnabled` | AdminSetting (CurationSettings) | false | **true** | Низкий: базовый kill-switch порогов и так активен; добавляется лишь авто-подстройка по override-rate | AdminSetting → false |
| 4 | `feature.tables_text_to_schema` | AdminSetting | false | **true** | Средний (галлюцинация схемы), НО **смягчён human-gate**: Кора показывает превью схемы, пользователь жмёт «Подтвердить» перед созданием — кривое не создаётся молча | AdminSetting → false |

**Решение по #4 (развилка владельца, рекомендация принята как дефолт):** включаем сразу. Обоснование — eval ≥0.85 ни разу не прогонялся (нет `reports/`), НО фича не создаёт мусор автоматически: между LLM-выводом и созданием таблицы стоит подтверждение человека (превью). Это снимает главный риск галлюцинаций. Если владелец хочет перестраховаться — опционально один раз прогнать `docker compose exec backend bun run scripts/eval/run-text-to-schema-eval.ts` (F1≥0.85, hallucination≤0.05), но это НЕ блокер включения. _Совместимо с памятью `feedback_no_golden_ship_and_observe_prod`._

## 3. Что НЕ включаем по умолчанию (и почему — для владельца)

| Флаг | Почему нельзя «просто включить» | Что нужно от владельца |
|---|---|---|
| `llm.budget.enforce_enabled` | Реализована ТОЛЬКО жёсткая блокировка (вариант А развилки Р-1; деградации на дешёвую модель в коде НЕТ). Без заданных hard-лимитов по компаниям эффект нулевой; с лимитами — режет ВЕСЬ ИИ компании разом при превышении. | (1) выбрать поведение А/Б/В; (2) задать hard-лимиты в `/admin/economics/orgs/[id]`. Отдельная задача. |
| `KNOWLEDGE_ACCESS_ENFORCEMENT` (`off`→`enforce`) | Матрица доступа засеяна ПУСТОЙ → при enforce отделы перестанут видеть знания друг друга по новым встречам. + 4 enforce-бага (RetrievalCache-ключ, пагинация total, under-fill, fail-open проекций — low/info). | Настроить матрицу в `/company-admin/access-groups`, затем путь `off → shadow` (наблюдать `kc_access_shadow_diff_total`) → `enforce`. Отдельная задача. |
| `DATACLASS_POLICY_ENFORCEMENT` (`shadow`) | Приватность LLM осознанно отложена владельцем (`feedback_privacy_deprioritized_now`). | Снять отсрочку, когда вернётся к приватности. |
| `goals.pulse.deliver_to_telegram` | Внешне-наблюдаемое действие — рассылка людям в Telegram. Включать молча = риск спама сотрудникам. **Рекомендую оставить OFF**, включать осознанно. | Явное «да» на рассылку пульса целей в ТГ. |
| `feature.chatbox` (тариф) | Per-org, включается продажами по клиенту. Не дефолт. | — |
| `MAIL_INBOX_ENABLED`, `CLONE_V2_ENABLED`, `SPECIALISTS_COMBINED_ENABLED`, `BITEMPORAL_ENABLED`, `PROMPT_EVOLUTION_ENABLED` | Незрелые/экспериментальные. Дозреют → выкатятся включёнными отдельно. | — |

## 4. ⚠️ Связанный критичный фикс — вынесен в ЧАСТЬ B (полноценное ТЗ ниже)

**HIGH-баг chatbox cross-attribution** — факты, сказанные КЛИЕНТОМ в переписке, записываются как знание МЕНЕДЖЕРА и втекают в его knowledge-клон. Активен СЕЙЧАС, не зависит ни от одного флага из Части A — портит граф уже сегодня. Раз владелец тестирует клонов в бою, это критично. Полноценное ТЗ на фикс (анализ цепочки, варианты, дизайн, фазы, backfill-очистка уже отравленных данных) — **Часть B** в конце документа.

## 5. Фазы реализации

### Фаза 1 — ENV-дефолт Concierge dialog-layer `[x]`
- `backend/src/common/config/typed-config.service.ts:2044-2045` — дефолт при отсутствии `CONCIERGE_DIALOG_LAYER_ENABLED` сменить `false → true` (включён, если в `.env` явно не задан `false`). Kill-switch сохраняется: `CONCIERGE_DIALOG_LAYER_ENABLED=false` в `.env` всё ещё выключает.
- **Acceptance:** `getDynamic`/`concierge` геттер возвращает `dialogLayerEnabled=true` без ENV; при `=false` в env — `false`. typecheck зелёный.

### Фаза 2 — seed-дефолты AdminSetting (для будущих чистых стартов) `[x]`
- `backend/scripts/seed-admin-settings.ts:280` — дефолт `knowledge.meetingTasksToTrackerOnly`: `envBool(..., false)` → `envBool(..., true)`.
- Аналогично выставить дефолт `true` для `feature.tables_text_to_schema` и `curation.autotuneEnabled` в их сидерах (найти точные строки в `seed-admin-settings.ts` / профильном сидере курации).
- **safe-seed:** сидеры остаются create-only/идемпотентными — существующие admin-edited значения НЕ трогают. Эта фаза влияет только на чистый старт (Сценарий B).
- **Acceptance:** на свежей БД (bootstrap) три ключа создаются со значением `true`.

### Фаза 3 — patch-скрипт для существующего прода `[x]`
- Новый `backend/scripts/patch-enable-shipped-flags.ts` (`createPrismaClient()` из `_lib/prisma`):
  - Для ключей `knowledge.meetingTasksToTrackerOnly`, `feature.tables_text_to_schema`, `curation.autotuneEnabled`: если запись отсутствует → создать `true`; если существует со значением `false` И **`updatedBy IS NULL`** (никто из админов не трогал — только seed) → обновить на `true`. Если `updatedBy != NULL` (ручная правка админа) → **no-op** (уважаем admin-override, `safe-seed-rules`).
  - Идемпотентно: повторный прогон = no-op (значение уже `true`).
  - Логировать каждое изменение (ключ, было→стало).
- Зарегистрировать в `backend/scripts/apply-prod-deploy.ts` массив `STEPS`: `{ phase: 'patch', script: 'scripts/patch-enable-shipped-flags.ts', skipBootstrap: true, hint: 'Ship-On: включить готовые фичи (meetingTasksToTrackerOnly, tables_text_to_schema, autotune)' }`.
- **Acceptance:** на копии прод-БД (ключи=false, updatedBy=null) после прогона все три = `true`; повторный прогон ничего не меняет; ключ с updatedBy≠null не трогается.

### Фаза 4 — документация `[ ]`
- `docs/operations/feature-flags.md` — перенести флаги #1–#4 из «Долг прошлого» в раздел «работает по умолчанию»; обновить состояния.
- `docs/operations/prod-deploy-log.md` — Шаг 1 (ENV: новый дефолт concierge) + Шаг 6 (новый patch-скрипт) + Шаг 7 (изменённые seed-дефолты).
- `second-brain/04_не-сделано/README.md` — строкой зафиксировать два отложенных «решения владельца» (budget enforce, knowledge-access enforce) + связанный HIGH-баг chatbox.

## 6. Прод-выкат (как это «само включится»)

После мержа и `docker compose up -d --build`:
1. migrate-контейнер автоматически: `prisma migrate deploy` → `apply-prod-deploy.ts --mode update` → фаза `patch` прогонит `patch-enable-shipped-flags.ts` → три AdminSetting-флага станут `true`.
2. backend стартует с новым ENV-дефолтом → Concierge dialog-layer включён.
3. **Никаких ручных действий в админке не требуется.** Всё в бою.

**Прод-операции:** только пересборка (`docker compose up -d --build backend frontend`). Patch применяется сам. Отдельных команд нет.

## 7. Совместимость с prompt caching
Не релевантно — ТЗ меняет дефолты флагов, не трогает SYSTEM-промпты.

## 8. Acceptance (итог) и Rollback
- **Acceptance:** на проде после деплоя без единого клика: задача из встречи = одна (Issue); Concierge кэширует ответы и контекстуализирует; «создай таблицу фразой» работает (превью→подтверждение); автоподстройка порогов курации активна. Budget/Access enforcement остаются выключенными (как и задумано).
- **Rollback каждого:** AdminSetting-флаги → вернуть `false` в админке (мгновенно, без редеплоя); concierge → `CONCIERGE_DIALOG_LAYER_ENABLED=false` в `.env` + рестарт. Полный откат — `git revert` + дефолты вернутся, но БД-значения останутся `true` (при нужде — обратный patch).

## 9. Итог Части A
Реализовано: **да (2026-06-08, коммит `bb7701dc`).** 4 флага включаются дефолтом (concierge code-default ON; seed-дефолты true для `meetingTasksToTrackerOnly`/`tables_text_to_schema`; code-fallback `curationAutotuneEnabled` true) + `patch-enable-shipped-flags.ts` (уважает `updatedBy`) в STEPS. Вне скоупа (решение владельца, зафиксировано в `04_не-сделано`): budget enforce, knowledge-access enforce, telegram-пульс. Связанный фикс — Часть B (реализована).

---

# ЧАСТЬ B — Фикс бага chatbox cross-attribution (полноценное ТЗ)

> **Тип:** баг-фикс HIGH · **Связь:** активен независимо от Части A, но обязателен к выкату вместе с ней (раз клонов тестируют в бою). Источник разбора: `plans/analysis/2026-06-07-clone-quality-and-knowledge-access-verification.md` §2 + сверка кода 2026-06-08 (ниже — по факту, с файл:строка).

## B.0 Суть бага в одну фразу

Переписка «клиент ↔ менеджер» грузится одним событием с единственным «автором = менеджер», поэтому **факты и рассуждения, высказанные КЛИЕНТОМ, записываются в граф как знание МЕНЕДЖЕРА** и втекают в его knowledge-клон. Серьёзность **HIGH**: клоны менеджеров отравляются приписанными чужими фактами; утечка видна через AI-чат, поиск, дашборды. Баг **включён по умолчанию и пишет «грязь» в граф прямо сейчас**, при `KNOWLEDGE_ACCESS_ENFORCEMENT=off`.

## B.1 Корневая цепочка (сверено по коду)

1. **Один RawEvent на всю сессию с единым ответственным.** `chatbox-ingest.service.ts:249-289`: закрытая сессия → `RawEvent(sourceType='chatbox')`; `responsible = { personId: linkedPersonId менеджера }` (`:259-261`). Авторство по репликам В payload ЕСТЬ — `messages[].from = 'client'|'manager'` (`:281-286`), но извлечение блоков идёт из склеенного `fullText` (`:270,288`), где авторство реплик не сохраняется на уровне блока.
2. **Адаптер отдаёт session-level автора = менеджер.** `block-ingest.worker.ts:906-913` (`tryGetActorIdentity`): для chatbox возвращает `authorPersonId = responsible.personId` — ОДИН на весь RawEvent, без оглядки на `messages[].from`.
3. **Атрибуция расширена на ВСЕ типы знания.** `block-ingest.worker.ts:271-273`: флаг `knowledge.subjectAttributionAllTypes` (code-fallback **true**) → `subjectAllTypes=true` → subject-атрибуция применяется не только к `reasoning`, а ко всем `signalType`.
4. **Каждый блок получает автора-менеджера.** `block-ingest.worker.ts:350-361`: `persistBlock(... authorPersonId: authorIdentity.authorPersonId ...)` ставится на КАЖДЫЙ извлечённый блок, включая блоки из реплик клиента.
5. **Резолвер отдаёт высший приоритет authorPersonId.** `entity-resolution.service.ts:928-935` (`resolveSubjectEntityId`, шаг 0): `authorPersonId` → `IdeaBlockEntity{ role='subject', entityId = Entity менеджера }`. Спикер-реплики не смотрится вообще.
6. **Клон менеджера тянет subject без фильтра типа.** `specialist-3-2-knowledge-clone.service.ts:504-517`: выбирает `IdeaBlockEntity role IN ('subject','mentioned')` БЕЗ фильтра `signalType` → клиентские факты попадают в клон как знание менеджера.
7. **Скилл-клон (3-7) частично защищён, но не полностью.** Он фильтрует `signalType` (reasoning/rationale/decision_basis), но клиентский *reasoning*-блок («я выбрал X, потому что Y») всё равно уйдёт как `subject=менеджер`.

**Ключевая трудность:** блоки извлекаются LLM из общего `fullText`, и block-extraction на выходе НЕ знает, из чьей реплики извлечён каждый блок. Поэтому «правильная» пер-блочная атрибуция требует менять контракт извлечения (дорого, ломает prompt-caching).

## B.2 Варианты решения и выбор

**Цель — НЕ «перестать брать из переписок», а атрибутировать по говорящему:** навыки/черты менеджера (как ведёт переговоры, закрывает возражения, предлагает) брать из ЕГО реплик; слова клиента — не приписывать менеджеру как его черту.

| Вариант | Суть | Плюс | Минус | Вердикт |
|---|---|---|---|---|
| A. Fail-closed на смешанных сессиях | В смешанной сессии не атрибутировать менеджеру вообще ничего | Дёшево, локально | **Выкидывает И навыки менеджера тоже** — теряем главную ценность (как менеджер работает с возражениями) | ❌ отклонён — слишком груб |
| **B. Атрибуция по говорящему** | Разнести реплики по ролям (`manager`/`client`): черты менеджера ← его реплики (берём); клиент ← НЕ менеджер. Переиспользовать механизм сегментов-спикеров, как у звонков | Сохраняет навыки менеджера, убирает приписывание чужого, использует уже проверенный путь встреч, не трогает общий промпт извлечения | Сложнее A: chatbox должен строить сегменты с говорящим | ✅ **ВЫБРАН** |
| C. Фильтр на чтении (specialist-3-2) | Не чинить запись, а фильтровать в клоне | — | Грязные `subject`-строки остаются в графе → утечка через /search, /chat, дашборды; лечит симптом, не корень | ❌ |

**Почему B:** для **звонков** атрибуция по говорящему УЖЕ работает — каждый участник в своей аудиодорожке (`speakerParticipantId` на сегменте → `resolveSubjectEntityId` шаг 2), поэтому навыки менеджера со звонка берутся корректно. Баг — только в **chatbox**, где реплики склеены в `fullText`, хотя авторство `messages[].from` известно (`chatbox-ingest.service.ts:281-286`). Правильный фикс — научить chatbox строить сегменты с говорящим так же, как встречи, и атрибутировать subject по говорящему сегмента, а не по session-level «ответственному менеджеру».

## B.3 Дизайн фикса (по говорящему)

### B.3.1 chatbox строит сегменты с ролью говорящего
- `chatbox-ingest.service.ts`: при формировании payload отдавать не только `fullText`, но и **сегменты с привязкой к говорящему** (из `messages[].from`):
  - реплики `from='manager'` → speaker = Person менеджера (`responsible.personId`);
  - реплики `from='client'` → speaker = клиент-сущность (customer) либо «внешний», но **НЕ менеджер**.
- Формат сегментов — тот же контракт, что уже читает `segment-builder`/`block-ingest` для встреч (speaker identity на сегменте), чтобы переиспользовать существующий путь атрибуции, а НЕ изобретать новый.

### B.3.2 block-ingest атрибутирует chatbox по говорящему сегмента
- Убрать короткое замыкание «chatbox → session-level `responsible.personId` как авто-subject на ВСЕ блоки» (`tryGetActorIdentity:906-913`).
- subject определять **по говорящему сегмента**, из которого извлечён блок (тот же механизм, что для встреч):
  - блок из менеджерских сегментов → `subject = менеджер` (его навыки/черты/рассуждения — **БЕРЁМ**, это и была цель);
  - блок из клиентских сегментов → `subject ≠ менеджер` (клиент-сущность, либо без subject-менеджера);
  - блок неоднозначного происхождения → fail-closed (не subject менеджера).
- `subjectAttributionAllTypes` остаётся включённым — но теперь атрибуция корректна по источнику реплики, а не сваливает всё на менеджера.

### B.3.3 Backfill-очистка уже отравленных данных (обязательно)
Баг активен → в графе уже лежат ложные `IdeaBlockEntity{role='subject', entity=менеджер}` от клиентских реплик. Новый `backend/scripts/backfill-chatbox-subject-cleanup.ts`:
- Снять ложные `subject`-связи от chatbox, происходящие НЕ от менеджерских реплик (для смешанных сессий; неразличимое историческое — консервативно снять chatbox `subject`-менеджер, `mentioned` не трогать).
- Идемпотентно, `--dry-run`/`--apply`, `createPrismaClient()` из `_lib/prisma`, регистрация в `apply-prod-deploy.ts` `STEPS`: `{ phase: 'backfill', script: 'scripts/backfill-chatbox-subject-cleanup.ts', skipBootstrap: true, hint: 'очистка ложных subject=менеджер от chatbox (cross-attribution)' }`.
- **Историческое переизвлечение** навыков менеджера из старых чатов (reingest с новым кодом) — опционально, vNext. Главное: остановить загрязнение (новый код) + снять ложное (backfill); НОВЫЕ чаты атрибутируются правильно сразу.

### B.3.4 Пересборка клонов
После очистки knowledge-клоны менеджеров пересобираются автоматически (`specialist-3-2` cron вс 06:00 + watcher). Навыки менеджера из новых чатов попадут корректно. Acceptance — клон менеджера не содержит черт, высказанных клиентом, но содержит навыки переговоров менеджера.

## B.4 Фазы реализации

### Фаза B1 — chatbox строит сегменты с говорящим `[x]` (реализовано в clone-quality Ф1)
- `chatbox-ingest.service.ts`: добавить в payload сегменты с ролью говорящего (manager→personId менеджера; client→customer/внешний), в формате, совместимом с путём встреч.
- **Acceptance (unit):** payload содержит сегменты; manager-реплики помечены менеджером, client-реплики — нет; `fullText` сохранён (обратная совместимость generic-пути).

### Фаза B2 — block-ingest: subject по говорящему сегмента `[x]` (реализовано в clone-quality Ф1)
- Убрать session-level `responsible.personId`→авто-subject для chatbox; атрибутировать subject по говорящему сегмента (переиспользуя механизм `speakerParticipantId`-пути встреч).
- **Acceptance (unit):** блок из менеджерского сегмента → `subject=менеджер`; блок из клиентского сегмента → `subject ≠ менеджер`; встречи (`speakerParticipantId`) и одно-авторные источники (`free_note`/`dump`/`email`/`tracker`) — без изменений (регрессия-гард).

### Фаза B3 — backfill-очистка `[x]`
- `backend/scripts/backfill-chatbox-subject-cleanup.ts` (`--dry-run`/`--apply`, идемпотентно) + регистрация в `STEPS` (phase `backfill`, `skipBootstrap`).
- **Acceptance:** `--dry-run` считает ложные subject-строки; `--apply` снимает их; повтор = no-op; `mentioned`-связи и не-chatbox `subject` нетронуты.

### Фаза B4 — тесты и документация `[ ]`
- Спеки B1/B2 (атрибуция по говорящему) + регрессия встреч/одно-авторных.
- `typecheck`/`lint`/`build` зелёные; затронутые knowledge-core/clones тесты проходят.
- `docs/operations/prod-deploy-log.md` Шаг 8 (backfill) + Шаг 11 (rebuild backend); `second-brain` профильная + `04_не-сделано/README.md` (закрыть строку про HIGH cross-attribution); `plans/analysis/2026-06-07-...` — пометить фикс A реализованным.

## B.5 Прод-выкат Части B
- `docker compose up -d --build backend` — worker с атрибуцией по говорящему; backfill-очистка прогоняется автоматически migrate-контейнером (`--mode update`, фаза `backfill`). Сначала `--dry-run` на проде (либо довериться идемпотентности + авто-бэкап БД агрегатора).
- Прод-операции: пересборка backend + авто-backfill. Отдельных ручных команд нет.

## B.6 Риски и инварианты
- **Не регрессировать встречи** — chatbox-сегменты используют тот же путь спикеров; проверить, что встречи (`speakerParticipantId`) и одно-авторные источники не затронуты.
- **Резолв клиент-сущности** — если customer не резолвится в Entity, клиентские блоки идут без subject-менеджера (безопасный fallback, не утечка).
- **Backfill удаляет данные** — только ложные `subject`-связи (не блоки, не `mentioned`); агрегатор делает авто-бэкап БД; `--dry-run` первым.
- **Совместимость с prompt caching:** общий промпт извлечения НЕ трогаем (атрибуция идёт через сегменты-спикеры, не через изменение промпта) — кэш сохранён. В этом преимущество B перед «переписать промпт извлечения».

## B.7 Итог Части B
Реализовано: **да (2026-06-08).** B1+B2 (chatbox сегменты с говорящим + block-ingest атрибуция subject по говорящему) сделаны в ТЗ clone-quality Ф1(A), коммит `dbf9b0d4`; B3 backfill-очистка (`backfill-chatbox-subject-cleanup.ts`, в STEPS `--apply`) + B4 тесты/доки — коммит `bb7701dc`. Навыки менеджера из переписок берутся корректно; слова клиента менеджеру не приписываются; отравленные данные вычищаются backfill'ом; клоны пересобираются кронами сами. ВАЖНО (отклонение от буквы ТЗ, обосновано): chatbox не имеет записей `Participant`, поэтому identity несётся per-segment как `Person.id` (`Segment.authorPersonId`), а не `speakerParticipantId` — это корректная адаптация механизма сегментов под модель идентичности chatbox.
