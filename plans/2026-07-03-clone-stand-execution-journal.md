---
type: execution-journal
feature: employee-clone-quality
status: in-progress
date_started: 2026-07-03
owner: владелец (sergrv80@gmail.com)
entrypoint: plans/2026-07-03-employee-clone-quality-HANDOFF.md
tz0: plans/tz/2026-07-03-clone-stand-and-baseline.md
project: plans/architecture/2026-07-03-clone-quality-stand.md
---

# Журнал исполнения: клон-стенд качества — стенд, baseline, петля

> **Что это.** Живая хроника работы над «идеальным клоном сотрудника». Пополняется в конце
> каждой фазы. Для каждого этапа фиксируется: что было поставлено · как делал (файлы/команды) ·
> что вышло (числа/артефакты) · **косяки и находки** · ссылки на артефакты · статус. Всегда можно
> вернуться к любому этапу и понять «что и почему получилось».
>
> **Не путать с:** ТЗ-контрактом (`plans/tz/*` — что нужно сделать) и рефлексией
> (`second-brain/05_история/*` — уроки по триггеру push). Журнал — операционная хроника «как шло».

## Модель работы (согласована с владельцем 2026-07-03, уточнена)

- **Автономно иду ПЕРВЫЙ КРУГ до baseline:** ТЗ-0 → стенд фаза за фазой → наполнение → Слой-0 →
  раннер → судьи → **baseline-прогон**. Без остановок за подтверждением внутри этого круга.
- **⛔ ЖЁСТКИЙ ЧЕК-ПОЙНТ после baseline (уточнение владельца 2026-07-03):** снял точку отсчёта →
  **ОСТАНАВЛИВАЮСЬ**, прихожу к владельцу **как аналитик** с разбором (scorecard + оси + воронка +
  Слой-0 + диагнозы с атрибуцией по слою + «что работает / что нет / где корень»). Дальше — **ТЗ-1
  разворот + петля фиксов — ТОЛЬКО после одобрения владельца.**
- **ОБНОВЛЕНИЕ автономии (владелец 2026-07-03, вечер):** владелец расширил доверие — иду сам
  **фикс построения → baseline → ТЗ-1 → код по ТЗ-1 → перепрогон**, без остановки на чек-пойнте;
  на каждом рубеже кладу сюда сводку «было→стало» + сводку в чат, чтобы владелец мог вмешаться.
  Стоп-точки прежние: «решения владельца» (деньги/доступ/прод) и перед `git push`.
- **РЕШЕНИЕ по развилке порогов (владелец 2026-07-03): вариант А — чиним ядро СЕЙЧАС** (провод +
  порог-крутилка + одиночная роль), ДО baseline. Разрыв про refusal-политику остаётся в ТЗ-1.
- **Останавливаюсь и спрашиваю также** на «решениях владельца» (необратимое: деньги/доступы/прод)
  и **перед `git push`** (правило репо; рефлексия пушится авто).
- **Каждый этап фиксируется здесь** — постановка, ход, результат, косяки, артефакты.
- Правила репо соблюдаю: план до кода · крутилки в AdminSetting · коммит только своего ·
  прод read-only · вопросы владельцу на русском с рекомендацией.

## Планка (цель петли, из проекта §4.3)

EXPERT_PASS ≥95% на отвечаемых (96/110) И ≥90% на свежем банке · **инварианты:** FABRICATED=0 ·
BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

## Сводная таблица этапов

| Этап | Что | Статус | Артефакт(ы) | Дата |
|---|---|---|---|---|
| Чтение | handoff + 5 доков + схема банка | ✅ done | — | 2026-07-03 |
| Картография | свежая карта кода по якорям (fan-out 10+синтез) | ✅ done | [код-картография](analysis/2026-07-03-clone-stand-code-cartography.md) | 2026-07-03 |
| ТЗ-0 | оформить контракт «Стенд + baseline» | ✅ done | [ТЗ-0](tz/2026-07-03-clone-stand-and-baseline.md) | 2026-07-03 |
| **Фикс построения (вар. А)** | провод + порог-крутилка + одиночная роль | ✅ done (коммит `fc095555`) | [ТЗ](tz/2026-07-03-clone-construction-fixes.md) · [анализ](analysis/2026-07-03-clone-construction-fragility.md) | 2026-07-03 |
| Фаза 0а | наполнение/пере-сев + манифест | ⏳ | `docs/testing/clone-feed-manifest.json` | — |
| Фаза 0б | Канал Б: 60 задач → probe → воронка | ⏳ | воронка в `status` | — |
| Фаза 0в | Слой 0 фиделити построения | ⏳ | манифест черт + сверялка | — |
| Фаза 1 | раннер run + трасса llmMeta (ось L) | ⏳ | `clone-stand-results.json` | — |
| Фаза 2 | судьи (3 линзы) + report | ⏳ | `judge.ts`, `report.ts` | — |
| Фаза 3 | BASELINE-прогон + отчёт владельцу | ⏳ | `docs/testing/clone-stand-report.md` | — |
| ТЗ-1 | разворот на «лестницу опоры» (по диагнозам) | ⏳ (после baseline) | `plans/tz/2026-MM-DD-clone-ladder-turn.md` | — |
| Петля | фикс → перепрогон → до планки | ⏳ | отчёты по прогонам | — |

---

## Этап Фикс построения клонов — вариант А (2026-07-03)

### Постановка
Владелец выбрал вариант А: чинить ядро построения клонов СЕЙЧАС (до baseline). Три разрыва из
[анализа хрупкости](analysis/2026-07-03-clone-construction-fragility.md): (1) провод `role.bearer_changed`
не эмитится из `PersonsService`; (2) порог склейки блоков в трейт захардкожен 0.78 → клоны пустые;
(3) `roleAggMinPersons=2` → одиночная должность не получает клон роли. ТЗ:
[clone-construction-fixes](tz/2026-07-03-clone-construction-fixes.md).

### Как делал
Правки (коммит `fc095555`, локально в `work/2026-07-02`, БЕЗ push):
- `persons.service.ts` — `EventEmitter2` + `maybeEmitBearerChanged` (копия из `AppointmentsService`), эмит
  пост-commit в `create`/`update` (обе смены носителя).
- `specialist-3-7-skill.service.ts` + `role-principle-synthesis.service.ts` — порог склейки вынесен в
  крутилку `knowledge.skillClusterSimilarityThreshold` (getDynamic, дефолт 0.72), удалены оба хардкода 0.78.
- `executable-persona-build.service.ts` — `roleAggMinPersons` через getDynamic.
- Реестр +1 ключ; seed-скрипт `seed-admin-setting-clone-construction.ts` (0.72 / 1); FE-поле; STEPS;
  prod-deploy-log Шаг 7.
- Стенд `seed-clone-feed.ts` `modeBuild` переведён на СИНХРОННЫЙ `rebuildProfile` (обход флейки-очереди).

### Что вышло (было → стало, тот же корм, тот же тенант «Стрела»)
| Носитель | было (active черт, порог 0.78) | стало (active черт, порог 0.72) |
|---|---|---|
| Сергей | 1 | 3 |
| Михаил | 2 | 4 |
| Дарья | 3 | 7 |
| **Игорь** | **0** | **4** |
| **Елена** | **0** | **5** |
| **Итого** | **6** | **23** |

**Три фикса доказаны на прогоне:**
1. **Порог 0.72** — Игорь/Елена (были 0 черт, 0 кластеров ≥3 при 0.78) собрали 4/5 черт. Диаг кластеров на
   живых эмбеддингах: кластеров ≥3 у Елены `0→2`, Игоря `0→1`, Сергея `2→4`, Михаила `1→5`. Все 5 клонов ≥3
   черт → проходят гейт ответа `MIN_TRAITS_FOR_ANSWER=3`.
2. **`roleAggMinPersons=1`** — роль-клон `integrator` собрался с ОДНОГО носителя (`v1/active(4черт)`).
3. **Провод** — изолированный тест: `persons.create({roleId})` → лог
   `RoleClonePersonaVersioningHandler: role.bearer_changed: создана новая версия клона роли` → создана
   `v1/pending_rebuild` (bearer=новый человек). Назначение из кабинета теперь поднимает клон роли сразу.

### Косяки / находки (для baseline — Слой 0)
- **Очередь BullMQ в dev не довела rebuild за 60с** (poll `modeBuild` ломался на «стабильных» СТАРЫХ 6 черт).
  Не связано с фиксом — это dev-флейки очереди/воркера (два app-контекста). Обход: синхронный `rebuildProfile`
  в стенде. В проде (docker, один воркер) риска нет, но **poll-условие `stable≥2 && cnt>0` порочно** (ловит
  старую стабильность) — код-грабля для будущего.
- **verify падает в fail-open** — `verifyPendingTraits`: LLM верификации локально отдаёт не-JSON (Anthropic 401
  invalid key, Ollama 401) → `verify упал — fail-open promote в active` (17/17 промоутнуто без реальной
  проверки). Это ИНФРА (битые ключи локально), не фикс. Для baseline: верификация черт сейчас НЕ гейтит —
  учесть при разборе качества.
- **Роль-клоны собрались не у всех → РАЗОБРАНО и починено (Ф4/Ф5, вопрос владельца про состав клона).**
  Клон в промпт собирает 7 компонентов (skill/value/motivation/process_marker + RolePrinciple + PracticeSkill +
  регламенты), НО гейт `minTraits` считал ТОЛЬКО слой `skill` (`buildForProfile:123`/`buildForRole:352`). Дарья
  2 skill + 3 value + 2 process = 7 черт, но роль-клон не собрала (2<3 skill). **Фикс Ф4:** гейт считает все 4
  слоя метода. **Фикс Ф5 (фантомный порог):** `personaMinTraits` в админке = **5**, а потребитель читал ENV `3`
  МИМО — эффективный порог в проде всегда был 3; перевод на getDynamic без сида поднял бы 3→5 (регресс). Сид=3
  выравнивает. **Результат:** все 4 роль-клона собрались (Ген.дир/интегратор/маркетолог/поддержка ✓), person 4/5.
- **compile-LLM флейки (Михаил person null иногда) → ПОЧИНЕНО (Ф6, владелец: «1 из 5 упал — на 500 пачка»).**
  Сначала списал на «инфра, в проде не воспроизведётся» — владелец справедливо не дал замять: в проде это тихая
  ДЕГРАДАЦИЯ (primary flash падает → фолбэк на модель хуже), а на масштабе — десятки клонов на деградированном
  фолбэке/пустых. Корень: `executable-persona-compile` primary `deepseek-v4-flash` спотыкается на structured/thinking
  (`Thinking mode does not support tool_choice`). **Фикс:** (1) primary flash→**pro** (та же capable-модель, что у
  detect), прод-путь через `patch-mass-migrate-to-deepseek-pro.ts` (everyDeploy `--update-existing`); (2) ретрай до
  3 попыток в `compilePersonaPrompt`. **Результат:** 9/9 клонов (5 person + 4 role) собираются стабильно (2+ прогона).
- **Маршрут LLM (вопрос владельца «почему Anthropic») — проверено:** маршрут всех клон-задач
  (detect/verify/compile/respond) = primary `deepseek` → secondary `openai-via-proxy` → tertiary `ollama`.
  **Anthropic в цепочке НЕТ.** 401 от Anthropic в логах — фон другой задачи. По клонам мы и правда только на
  DeepSeek (+2 фолбэка). Реальный локальный пробел — битые ключи openai-proxy/ollama на этой Mac.
- **verify падает в fail-open** (тот же корень: deepseek-flash structured-output + битые локальные фолбэки) —
  17/17 промоутнуто без реальной проверки. ИНФРА, для baseline учесть что verify локально не гейтит.
- Апач-AGE `Entity failed to be updated: 3` при rebuild Михаила — не фатально, известная флейки графа.

### Артефакты
- Коммит `fc095555` (Ф1–3, 11 файлов) + коммит Ф4/Ф5/Ф6 (executable-persona-build: гейт+ретрай; seed 3-й ключ;
  маршрут compile flash→pro; patch-mass-migrate +compile; FE; ТЗ; deploy-log; snapshot).
- ТЗ [clone-construction-fixes](tz/2026-07-03-clone-construction-fixes.md) (§2–§4б: Ф1–Ф6).
- Стенд-тулинг `backend/scripts/clone-stand/*` — untracked WIP (не коммитил; продуктовый фикс отдельно).

### Статус
✅ 6 фиксов доказаны: было→стало 6→23 черт + провод + одиночная роль + все 4 роль-клона + **надёжность 9/9
(5 person + 4 role) стабильно**. Клоны наполняются и собираются просто, состав клона (7 слоёв) объяснён владельцу.
→ Дальше по автономии: Фаза 0б (Канал Б воронка) → Слой 0 → раннер → судьи → **baseline**.

---

## Этап Фаза 0а — Наполнение / пере-сев (2026-07-03, в работе)

### Постановка
Свежий тенант «Стрела» с 4 клонами-целями, роли назначены, Елена→Игорь, регламенты, манифест ground truth.

### Предусловия (проверено read-only)
- dev-БД (Postgres :55435 `z_main`), Redis :56381, MinIO — **healthy** (compose up 4-5 дней).
- backend :3000 — реальный `bun.exe` PID 42784, health OK, `.env`→локальная БД (не прод). Воркеры in-process живут.
- `STRELA_ORG` в `.env` **не задан** → падал на старый дефолт `cmr1qbvpx…`.

### Замер клон-готовности (подтверждает необходимость пере-сева)
| org | employee | roles | prof active | traits active | personas | role_prof | regs | клон-блоки |
|---|---|---|---|---|---|---|---|---|
| cmr1qbvpx (07-01, recall) | 7 | 1 | 3 | 3 | **0** | 0 | 12 | 10 |
| cmr3a12ib (07-02) | 7 | 0 | 0 | 0 | **0** | 0 | 19 | 7 |
→ Обе клон-пусты (персон 0, черт ≤3 на тенант, роли не назначены) — ни один клон не ответит. Пере-сев обязателен.

### Решение (автономно)
Сею **свежий** org через `seed-synthetic-company` + weeks; старые Стрелы **не трогаю** (`cmr1qbvpx` занят
recall-стендом — хардкод в `batch-recall-trace.ts`; `cmr3a12ib` — чужая, 07-02). 3-й org в dev-БД допустим.

### Ход (шаг 1 — пере-сев базы)
- Прочитал шаблоны: `seed-synthetic-company.ts` (`void main()` авто-запуск, печатает `✓ ORG_ID=`, полл до
  canonical≥20; регламент = external-док owner Елена scope роль поддержки) и `clone-build-harness.ts`
  (паттерн `injectReasoningMeeting`: встреча = вопрос менеджера + reasoning-реплики сотрудника, эпизоды
  по датам, ≥3 формулировки; но бутстрапит СВОЙ тенант — для стенда переиспользую паттерн под STRELA_ORG).
- Прогнал `bun scripts/seed-synthetic-company.ts` → **свежий org `cmr4ztnfj0001hgbwuij7xc3n`**.
- Прописал `STRELA_ORG=cmr4ztnfj0001hgbwuij7xc3n` в `backend/.env`.

### Косяк / находка (важно для планирования времени)
- **Конвейер LLM-тяжёлый и медленный локально.** Полл сева (90с) истёк: переварилось `1/12` событий,
  `canonical=0`. Но воркеры ЖИВЫ (очередь `core.raw-events`: 2 active, 9 wait, 63 completed, 3 failed) —
  просто каждое событие идёт через сегментацию→block-ingest→специалистов (все LLM). Не затык — нужна
  **выдержка** (ждать «конвейер устоялся», `received=0`). → Запущен фоновый монитор дренажа `bvyce8vgm`.
- **Вывод для оценки времени первого круга:** наполнение (Канал А ~30 встреч + Канал Б ~60 ответов +
  weeks) даст ~100+ событий × минуты LLM-обработки = наполнение займёт часы фоновой обработки, не минуты.
  Это ожидаемо (стенд строит корпус через реальный конвейер), но baseline будет не «сегодня к обеду».

### Косяк №2 — конвейер СТОЯЛ (не просто медленный), диагноз + фикс
- Монитор показал **стоп**: 7+ мин `active=2, wait=10`, `canonical` застыл на 8. Не выдержка — залипание.
- Диагноз: очередь `core.raw-events` — джобы `job stalled more than allowable limit`; в failed —
  `Invalid prisma.rawEvent.update() в block-ingest.worker.ts:783` (но текущая 783 = `logger.error`).
- LLM-эндпоинты живы (proxy 404 / deepseek 401 на корне — норма). Причина — **процессы backend**:
  висели ДВА `bun run dev` — основной `42781→42784 (bun --watch)` на :3000 + **осиротевший `39584`**
  (watch-ребёнок умер). Орфан/замёрзший воркер разбирал джобы и стопорил их (stall-петля).
- **Фикс:** убил оба `bun run dev` + `bun --watch`, поднял ОДИН свежий backend (PID 76941, лог `backend/dev.log`).
  Свежий воркер пересоберёт залипшие джобы. Перезапуск dev-backend — в рамках автономии (обратимо, не прод).

### Урок (в код-граблю потом)
Перед прогоном стенда/наполнения — убедиться, что backend ОДИН и свежий (нет орфанов `bun run dev`);
залипшая очередь `core.raw-events` (active стоит, wait не тает) = мёртвый/двойной воркер, а не медленный LLM.

### Фикс подтверждён
Свежий backend `76943` встал за ~секунды: «Nest application successfully started», воркеры подняты
(BlockIngestWorker пишет `[PIPE] block-ingest START`), AdminSettings hydrated 573 keys. **Конвейер ожил** —
raw_ingested 1→5, canonical-блоки нового org растут. Дренаж идёт сам на свежем воркере.

### Находка №3 — у сотрудников нет userId (влияет на Канал Б)
Замер persons нового org: **только Сергей (владелец) имеет `userId`**; Михаил/Дарья/Игорь/Елена — `userId=NULL`.
- Канал А (reasoning-встречи) — работает через `authorPersonId`, userId не нужен. ОК для всех 4.
- **Канал Б** (задача→probe→ответ) — probe адресуется на `issue.assignees.userId`, `respondToProbe` требует
  `userId`. → В `seed-clone-feed` **создать User+Membership+link `person.userId`** для 4 носителей клонов.

### Решение по weeks 2/3/4 (оптимизация, не удаление)
**Пропускаю недельную ленту (week2/3/4) для baseline-наполнения.** Причина: клон ингестит ТОЛЬКО
subject-reasoning-блоки (`SKILL_SUBJECT_SIGNAL_TYPES`); weeks доливают company-факты (decisions/tasks/facts),
которые кормят ГРАФ (chat-v2 recall), а НЕ клона. Для клон-baseline они низкоценны и стоят часов LLM-обработки.
Базовый сев уже дал ключевые company-факты (Ромашка, Логистик Плюс, backoff/429, retention, регламент);
stale-эпизоды и клон-корм даёт `seed-clone-feed`. Если baseline покажет провал company-context вопросов из-за
пустого графа — доолью weeks тогда. (Ревизия ТЗ-0 §4.1: weeks → опционально, по показаниям.)

### Ход (шаг 2 — seed-clone-feed)
- Разведка сигнатур (`a4af6828c2…`) вернула точный build-spec. Ключевые уточнения к коду:
  роль — `RolesDomainService.create` (не голый prisma — иначе нет RoleProfile); носитель — `PersonsService.update({roleId})`
  (пишет и PersonRole, и Appointment); после смены — вручную `RoleClonePersonaVersioningHandler.handle`;
  задача — `ProjectsService.ensureInboxProjectId` + `IssuesService.create` (assignee=**User.id**); сборка —
  `enqueueRebuildSkillProfile` → `verifyPendingTraits` → `buildForProfile`/`buildForRole`.
- Написал **`backend/scripts/clone-stand/seed-clone-feed.ts`** (режимы `prepare|channelA|build|status|manifest|all`),
  с ground-truth методами 4 клонов (по проекту §5, ≥3 формулировки/метод, эпизоды разнесены по датам, часть stale ≥40д),
  statusFacts, absentFacts. Косяки поймал ДО прогона: `MembershipRole` без `member` (→ `manager`);
  `Regulation` — `contentMd`/`category`/дефолты (не `fullText`/`kind`). **typecheck зелёный (0 ошибок).**
- Прогнал `prepare`: 4 учётки (Михаил/Дарья/Игорь/Елена +membership+link person.userId), 4 роли + назначение
  (Сергей/Михаил/Дарья/Елена), 4 регламента (+blocking/advisory), гранты владельцу. ✓
- Прогнал `channelA`: **18 reasoning-встреч** вброшено (Сергей 4, Михаил 4, Дарья 4, Елена 3, Игорь 3).

### Косяк №4 — Канал А через встречи: атрибуция плывёт + мало формулировок
Первый дренаж Канала А (18 reasoning-встреч) вскрыл ДВА дефекта:
1. **Subject-атрибуция синтетических встреч ненадёжна:** из 18 клон-блоков **10 без subject-сущности**, к
   сотрудникам привязано лишь 8 (Михаил 3, Дарья 2, Сергей 2, Елена 1, **Игорь 0**). Причина: встреча резолвит
   speaker→person по имени/участникам, и в мульти-сотрудничьем org на Стреле резолв плывёт (clone-build-harness
   работает, т.к. там один сотрудник = владелец тенанта).
2. **Формулировок на метод было ~2, а кластер требует ≥3** → черты почти не рождались (только Михаил 2, Сергей 1).

**Разворот (оба дефекта):**
- Канал А переписан на **детерминированную атрибуцию через `ConversationalIngestAdapter.ingestNotificationResponse`**
  (`payload.userId`→person напрямую + принудительный `signalType='reasoning'`) — это штатный ingest-путь Канала Б,
  атрибуция гарантирована по userId, без резолва имён.
- Контент реструктурирован: **≥3 формулировки на каждый метод** (у поддержки раздельно Елена v1 / Игорь v2).
- Вброшено 55 reasoning-ответов (Сергей 13, Михаил 12, Дарья 12, Елена 9, Игорь 9). typecheck зелёный.
- Побочный косяк: `app.close()` на channelA завис на дренаже воркеров (процесс убит по таймауту, но 55 инъекций
  прошли ДО close). Урок: стендовым скриптам после работы делать `process.exit(0)` или не ждать close.
- Блоки старых встреч (Михаил 2 черты, Сергей 1) остаются бонус-кормом.

### Результат Канала А v2 (атрибуция ПОЧИНЕНА)
Дренаж завершён, **58 attributed клон-блоков**: Михаил 16, Сергей 14, Дарья 11, Елена 9, **Игорь 8** (был 0).
Все носители ≥8 блоков — детерминированная атрибуция через userId сработала, объёма хватает на кластеры ≥3.
Добавил force-exit (`process.exit(0)` + race close 5с) — стендовые скрипты больше не виснут на `app.close()`.

### 🔑 НАХОДКА (Слой 0) — клоны собираются плохо: КОРЕНЬ найден и записан
Отдельный анализ: [plans/analysis/2026-07-03-clone-construction-fragility.md](analysis/2026-07-03-clone-construction-fragility.md).
Владелец дважды указал: плохая сборка клонов — это находка для анализа, не «подкрутить порог». Разобрал по данным:
- **build v2:** профили создал всем 5 (`getOrCreateForPerson`), но черт всего **6** (Дарья 3, Михаил 2, Сергей 1,
  Елена 0, Игорь 0). Персоны не собрались (нужно ≥3 черты).
- **Корень (данные эмбеддингов):** порог кластера `GROUP_SIMILARITY_THRESHOLD=0.78` **ЗАХАРДКОЖЕН** + группа ≥3.
  Перефразировки одного метода садятся на cosine **0.72–0.85** — ровно на границе. Блоков с ≥2 соседями ≥0.78
  (минимум для кластера ≥3): Дарья 3, Елена **0**, Игорь 1, Михаил 1, Сергей 1 — при 8-16 блоках. Не объём — порог.
- **Прод-следствие:** живые говорят разнороднее моей чистой синтетики → в проде клоны ещё пустее (риск Т13).
- **Разрыв №1 (баг-провод, подтверждён и трассой, и моим seed):** назначение из кабинета (`PersonsService`)
  пишет Appointment напрямую, НЕ эмитит `role.bearer_changed` → клон роли не строится сразу (ждёт вс-крон).
  Чинибельно: эмитить событие из `PersonsService.create/update`.
- Отягчающие гейты: `MIN_TRAITS_FOR_ANSWER=3` хардкод, `PERSONA_ROLE_AGG_MIN_PERSONS=2` (одиночная должность
  не соберётся), `CLONE_V2=false`.

### Развилка (жду решения владельца — это влияет на характер baseline)
Для стенда: снизить пороги (cluster 0.78→0.72 / count 3→2, roleAggMinPersons→1), чтобы клоны собрались и можно
было мерить ПОЛИТИКУ ответа — НО зафиксировать в отчёте, что при прод-дефолтах клоны не собираются (это находка).
Baseline тогда разделит: отказы из-за непостроенной черты (Слой 0, порог кластера) vs из-за refusal-first (Слой 2/3).

### Статус
⏸ Пауза на решение владельца по развилке порогов + приоритету фиксов (Разрыв №1 / порог кластера). Технически
готов: снизить пороги стенда → добрать сборку клонов → Канал Б → Слой 0 → раннер → судьи → baseline.

---

## Этап ТЗ-0 — Оформление контракта (2026-07-03)

### Постановка
Оформить машинно-исполнимый контракт «Стенд + baseline» по §5 handoff + §7 проекта, с реальными якорями кода.

### Как делал
Свёл проект + аудит + методологию + свежую картографию в [ТЗ-0](tz/2026-07-03-clone-stand-and-baseline.md):
файлы к созданию, конфиг окружения (ENV+AdminSetting таблицами), фазы 0а/0б/0в/1/2/3 с шагами и якорями,
acceptance по фазам и общий, ловушки.

### Проектные решения, принятые автономно (зафиксировать — владелец спрашивал)
1. **Baseline гоняется с `CLONE_V2_ENABLED=false`** (прод-верно = «как есть»). `false`=«выключено», не «падает».
   V1 = строгий справочник (нет факта → отказ); V2 = экспертный по аналогии, но заперт за выключателем.
   Меряем выключенную V2, потому что так на проде сегодня; иначе померим «как могло бы быть», а не боль.
   (askAllFormers всё равно идёт через V2 — отмечено.)
2. **Расширение трассы `llmMeta`** (ось L) — единственная правка «живого» кода, аддитивная/безопасная:
   дописываю в служебную запись ответа списки usedBlockIds/usedRegulationNames/usedSkillIds (на что оперся).
   Ответ пользователю не меняется; миграция Prisma не нужна (llmMeta — свободный JSON). Точки: `clones.service.ts`
   askPersonV2 ~773, askRoleV2 ~1006, + V1-ветки ~301/~550.

### Косяки / находки
- Принцип №9 (крутилки в AdminSetting): `CLONE_TOPIC_*`/`CLONE_V2`/`grounding` читаются плейн-ENV — нарушение,
  но это НЕ моя правка (существующий код); в ТЗ-0 их не переношу (границы: поведение не трогаем), для стенда
  ставлю через `.env`. Перенос в AdminSetting — кандидат для ТЗ-1 (H5).
- Стендовые скрипты `clone-stand/*` — НЕ прод → в `apply-prod-deploy.ts STEPS` и `prod-deploy-log` НЕ вносить.

### Артефакты
- [ТЗ-0](tz/2026-07-03-clone-stand-and-baseline.md).

### Статус
✅ ТЗ-0 готово → Фаза 0а (наполнение).

---

## Этап 0 — Чтение и картография (2026-07-03)

### Постановка
Войти в задачу через handoff, усвоить проект/аудит/методологию/банк, снять свежую карту кода
(строки в аудите дрейфуют — сверка по символам), затем писать ТЗ-0.

### Как делал
- Прочитал handoff + аудит (Т1–Т15, H1–H11) + проект стенда (оси E/M/G/L/P, вердикт, петля, §5/§7) +
  методологию стендов (+§1.5 слоистая модель) + метод Слоя 0 + карту банка + JSON-схему банка (110 объектов).
- Сверил наличие инфраструктуры-образцов на диске (probe-stand, _lib, eval/gold) и якорей сервисов.
- Запустил фоновый Workflow `clone-stand-cartography` (10 ридеров по подсистемам + синтез) —
  точные сигнатуры/якоря образцов и сервисов под точное ТЗ-0.

### Что вышло (факты на входе — сверка с аудитом)
- `backend/scripts/clone-stand/` **не существует** — создаём с нуля (контракт §7).
- Образцы на месте: `probe-stand/{stand,registry,seed-fixtures,judge}.ts`, `_lib/{combat-harness,llm-direct,prisma}.ts`,
  `eval/gold/strela-manifest.batch{1,2,3-rest}.json`, `eval/smoke-{skill-trait-merge,executable-persona-compile,role-profile-build,clone-respond}.ts`.
- Ключевые якоря: `src/modules/clones/services/clones.service.ts`,
  `src/modules/conversational/conversational.service.ts` (respondToProbe),
  `src/modules/probe/probe-response.handler.ts` (ingest), `src/modules/tracker/services/issues.service.ts` (гейты Канала Б),
  `src/common/config/env.schema.ts`, `src/modules/admin/settings/admin-setting-schema-registry.ts`.
- Схема банка: поля `id·category·clone(ceo/integrator/marketer/support)·question·expectedBehavior·expectedLayer[]·expectedIntent·groundTruth·forbidden·prediction{baseline,target}·targeted·trap·controlPair·variant·chain·turn` (+опц. `cloneScopeOverride`,`askVersion`).
  Категорий 13 (n=110). Распределение клонов: ceo 35 · integrator 26 · support 26 · marketer 23.

### Косяки / находки
- **Находка:** `STRELA_ORG`, `PERSONA_ROLE_AGG_MIN_PERSONS`, `CLONE_TOPIC_*` в локальном `.env` **не заданы** —
  конфиг окружения стенда придётся выставить явно (Фаза 0а). `CLONE_V2_ENABLED`, `AI_CHAT_DAILY_LIMIT_*` в `.env` есть.
- vexp-демон жив → Grep/Glob заблокированы хуком; картография идёт через Read по точным путям (+run_pipeline при нужде).

### Артефакты
- Картография: [plans/analysis/2026-07-03-clone-stand-code-cartography.md](analysis/2026-07-03-clone-stand-code-cartography.md) (55.7k, 342 стр., из workflow `wf_7906505a-30d`).
- Этот журнал.

### Констатация дрейфа (код ≠ аудит — важно для ТЗ-0)
1. **combat-harness (`_lib`) НЕ поднимает NestJS AppModule** — `injectRawEventDirect` только кладёт RawEvent в БД+очередь; обработку делает ЖИВОЙ backend (`bun run dev`, воркеры in-process). → Каналы А/Б наполнения требуют запущенного backend. Раннеры `run` сами бутстрапят AppModule (`NestFactory.createApplicationContext`).
2. **Елена/Игорь — отдельные employee** (`seed-synthetic-company.ts:185`), слияния в коде НЕТ (аудит/память говорили «слита»). Пере-сев с нуля устраняет.
3. **`orgId` из seed отдаётся ТОЛЬКО через stdout `ORG_ID=<id>`** — раннер обязан спарсить и экспортнуть в `STRELA_ORG` (в env не пишется; `STRELA_ORG` вообще НЕ в env.schema — плейн `process.env` с хардкод-фолбэком).
4. **`majority-of-3` судья НЕ реализован** — `probe-stand/judge.ts:127 llmJson` это retry×3 до первой валидной схемы, не голосование. Строю надстройку над `directLlmCall`.
5. **`llmMeta` успешного пути НЕ содержит** `usedBlockIds/usedRegulationNames/usedSkillIds/topicMatchedBlocks` (topic* пишутся ТОЛЬКО при отказе). Точки вставки оси L: `clones.service.ts:773` (person V2), `:1006` (role V2). Свободный JSON — миграция Prisma не нужна.
6. **`clone-respond` primary задан ДВАЖДЫ** конфликтующими seed: pro (clone-v2) vs FLASH (skill-and-clone). Кто применён последним — победил. → Baseline обязан зафиксировать реально применённую модель.
7. **Моделей `KnowledgeProfile`/`RoleClone` в schema.prisma НЕТ** (устаревшие имена аудита). Клон человека = `SkillProfile(1:1 Person)+SkillTrait+ExecutablePersona(scope=person)`; клон роли = `+RoleProfile+RolePrinciple(+PracticeSkill)`. Слой 0 читает именно их (фильтр `status='active'`).
8. **`assertNotProd` ОТСУТСТВУЕТ** в probe-stand и batch-recall-trace — беру из `combat-harness.ts:91`, вызываю первым в каждом скрипте стенда.
9. **`CLONE_V2_ENABLED=false` — единственный OFF-флаг**; `askPerson/askRole` идут V1 (mode всегда factual, без dialog-layer). `askAllFormers` ВСЕГДА зовёт V2. Пороги `CLONE_TOPIC_*`/`CLONE_V2`/`grounding` читаются плейн-ENV (нарушение принципа №9) → меняются только через `.env`+рестарт.
10. **Атрибуция автора клона в Канале Б — через `RawEvent.payload.userId=recipientUserId`** (`tryGetActorIdentity`), поля `ProbeEvent.subjectPersonId` НЕТ. `respondToProbe({notificationId,userId,payload})` — ровно 3 поля; `signalTypeHint='reasoning'` привязан к reason ∈ {`task.method_capture`,`skill.cdm_interview`}.
11. **Стенд, создающий ProbeEvent+Notification вручную, обязан связать их** (`dispatchedNotificationId=Notification.id`, `status='dispatched'`) — иначе `ProbeResponseHandler` молча пропустит. Формула complexity точная: `0.4·(descr/280)+0.3·(activ/8)+0.2·(days/7)+0.1·prio`, порог 0.5; `assignees` обязателен.

### Статус
✅ картография снята и сохранена → пишу ТЗ-0.
