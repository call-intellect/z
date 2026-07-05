# Промпт для агента: стенд качества агентов регламентов и инструкций

> Готовый брифинг для СВЕЖЕГО агента (новый контекст). Скопируй этот файл целиком как задачу.
> Корпус+эталон (509 сценариев) УЖЕ ГОТОВЫ. Твоя работа — **написать скрипты стенда и прогнать его батчами
> по 50 со стоп-гейтом, снять baseline** качества трёх LLM-агентов регламентов/инструкций.
> Прод не трогаешь: всё на throwaway-тенанте, read-only к прод-данным.

---

## 📌 Прямые пути ко всем артефактам (чтобы не потерять)

Всё лежит в репозитории `kora`. Пути — от корня репо:

| Артефакт | Путь |
|---|---|
| **Карта ситуаций 360°** (что покрываем) | `plans/analysis/2026-07-03-regulation-instruction-stand-situation-matrix.md` |
| **ТЗ стенда** (контракт: файлы/форматы/метрики/фазы) | `plans/tz/2026-07-03-regulation-instruction-stand.md` |
| **Этот хэндофф-промпт** | `docs/testing/regulation-stand-agent-prompt.md` |
| **Корпус** (509 сценариев, полное покрытие карты 360°) | `docs/testing/regulation-stand-corpus.json` |
| **Эталон** (509 эталонов 1:1 под корпус) | `docs/testing/regulation-stand-ruler.json` |
| **Методология линейки** | `docs/methodology/synthetic-fidelity-eval-method.md` |
| Скрипты стенда (СОЗДАТЬ) | `backend/scripts/regulation-stand/{stand,seed-reg-feed,annotate,match,judge,report}.ts` |
| README стенда (СОЗДАТЬ) | `docs/testing/regulation-stand.md` |
| Отчёт baseline (СГЕНЕРИТ report) | `docs/testing/regulation-stand-report.md` |

**Уже готово (не с нуля):** карта ситуаций, ТЗ, **полный корпус+эталон — 509 сценариев** с покрытием всех
ячеек карты (A1.*/A2.*/A3.*/СК1-9), провалидированы: id корпуса ↔ id эталона 1:1, 0 коллизий. Твоя работа —
дописать **скрипты стенда** (`backend/scripts/regulation-stand/*`), прогнать фазы (prepare→build→annotate→run→
judge→report) и снять baseline. Корпус можно точечно дополнять, но основное покрытие уже есть.

---

## Кто ты и что делаешь

Ты — инженер-верификатор в проекте «Кора» (память компании; ядро — knowledge-core). Тестируешь
**Специалист 3.1 (Регламенты)** — три LLM-агента, которые из блоков знания строят регламенты, инструкции,
процессы, политики, стандарты и **консолидируют** их (дубли/дополнения/противоречия):

1. **Экстрактор** `regulation-extract` — понимает вид (regulation/instruction/process/policy/standard) + суть + фильтры («наша норма?», «существенно?»).
2. **Арбитр** `regulation-dedupe` — судьба черновика: `new` / `merge` (дубль) / `extension` (дополнение) / `contradicts` (противоречие).
3. **Компилятор** `structured-document-compiler` — собирает и **дополняет** сам структурный текст документа (`contentMd` + `steps` для процесса), режимы СОЗДАНИЕ / ДОПОЛНЕНИЕ (без потери старого).

**+ ось A4 «Владение» (критично, проверять обязательно).** Регламент/инструкция/политика **всегда привязана к
человеку**: есть ответственный (`ownerPersonId`) и субъект(ы), к которым норма «растёт» (`personSubjectIds` →
γ-1 SkillProfile → **клон**). Юрист проговаривает юр-правила → растут к клону юриста; маркетолог про маркетинг →
к его клону. **Корень фабрикации `usedRegulationNames`** (диагноз владельца): при смене носителя/владельца привязка
рассинхронизируется — текущие правила нового владельца НЕ находятся, а имена регламентов **текут из старого снимка
клона → выдумка**. Дефект НЕ в «плохом поиске», а в **сломанном владении**. Стенд обязан это изолировать и мерить.

**Правило №1: честность важнее зелёного отчёта.** Если агент ошибается — фиксируй с примером и атрибуцией к
конкретному агенту (A1/A2/A3/A4), не сглаживай.

## Контекст — прочитай в этом порядке

1. **[Карта ситуаций 360°](../../plans/analysis/2026-07-03-regulation-instruction-stand-situation-matrix.md)** — ЧТО покрываем (все ячейки A1/A2/A3 + сквозные СК + оси вариативности). Это твой чек-лист покрытия корпуса.
2. **[ТЗ стенда](../../plans/tz/2026-07-03-regulation-instruction-stand.md)** — файлы, формат корпуса/эталона, метрики, фазы, ловушки, acceptance. Твой контракт.
3. **[Методология линейки](../methodology/synthetic-fidelity-eval-method.md)** — слепые разметчики → сверка → сверялка + 3 правила против «зелёного вхолостую».
4. Образец готового стенда — `backend/scripts/clone-stand/stand.ts` (диспетчер, `assertNotProd`, бутстрап AppModule) + `_lib/{combat-harness,llm-direct,prisma}.ts`.

**Код агентов (досверяйся по символу — строки дрейфуют):**
- `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts` — оркестратор: `processRegulationBlock/processProcessStepBlock/processPolicyBlock` → `extractDraft` → `upsert{Regulation,Process,Policy,Instruction}` → `dedupeArbiter`/`tryCompileContent`/`reportContradiction`.
- `backend/src/modules/knowledge-core/prompts/regulation-extract.prompt.ts` — экстрактор (5 видов, фильтры, поля).
- `backend/src/modules/knowledge-core/prompts/regulation-dedupe.prompt.ts` — арбитр (4 исхода, асимметрия «при сомнении не сливай»).
- `backend/src/modules/knowledge-core/prompts/structured-document-compiler.prompt.ts` + `services/structured-document-compiler.service.ts` — компилятор (СОЗДАНИЕ/ДОПОЛНЕНИЕ).
- `backend/src/modules/knowledge-core/services/regulation-consolidator.service.ts` — свод `consolidateTenant` (крон/бэкфилл-путь, cosine 0.82).
- `backend/src/modules/knowledge-core/workers/specialist-routing-dispatcher.worker.ts` — как блок с `signalType` доходит до специалиста.

Модели (сущности): `Regulation` (category=regulation/standard), `Instruction`, `Policy` (severity), `Process`+`ProcessStep`, `CardVersion` (история), `ConflictItem` (противоречие) — в `backend/prisma/schema.prisma`.

## Доступ к стенду (у тебя он ЕСТЬ)

- Локальная dev-БД: `docker compose -f docker-compose.dev.yml up -d` (Postgres :55435 `z_main`, Redis :56381, MinIO).
- Живой backend с воркерами: `cd backend && bun run dev` (нужен для build через очередь; убедись что он ОДИН и свежий — орфаны `bun run dev` стопорят очередь).
- В `.env` реальные LLM-ключи (реальный LLM локально). Чтение БД — `createPrismaClient()` из `backend/scripts/_lib/prisma.ts`, запуск из `backend/` через `bun run <script>.ts`.
- vexp-демон жив → Grep/Glob заблокированы хуком; ищи через Bash `find/grep` + Read, или `run_pipeline`.
- **Тенант — новый throwaway** (создаёшь в prepare); НЕ трогай «Стрелу» `cmr1qbvpx…` (занята другими замерами). `assertNotProd` первым вызовом каждого скрипта.

## Что построить (по ТЗ §1)

**Корпус+эталон УЖЕ ГОТОВЫ** (509 сценариев, 1:1, покрытие карты 360°) — их НЕ надо генерить, только использовать
(можно точечно дополнить). Твоя работа — **скрипты стенда**:
```
backend/scripts/regulation-stand/{stand,seed-reg-feed,annotate,match,judge,report}.ts   # СОЗДАТЬ
docs/testing/regulation-stand-corpus.json    # ГОТОВ (509 сценариев)
docs/testing/regulation-stand-ruler.json     # ГОТОВ (509 эталонов 1:1)
docs/testing/regulation-stand.md             # README — СОЗДАТЬ
docs/testing/regulation-stand-report.md      # отчёт — СГЕНЕРИТ report
```

## Фазы (ТЗ §7) + прогон ПО 50 (ТЗ §7.1 — обязательно)

Фазы: `prepare` (тенант + **именованные Person**: Иван-юрист, Дарья-маркетолог, Елена/Игорь-поддержка,
Сергей-директор, Пётр-безопасник — для оси A4; + роли + конфиг) → `build` (посев блоков ПО ПОРЯДКУ → триггер
специалиста → `consolidateTenant`; для A4.4 провести `role.bearer_changed` Елена→Игорь между блоками) →
`annotate` (слепая разметка) → `run` (read-only сверялка БД↔эталон, вкл. `ownerPersonId`/`personSubjectIds`) →
`judge` (панель 3 судей) → `report` (scorecard). Сценарии оси A4 несут `requiresPersons`/`ownershipEvent`.

**НЕ гони все 509 разом. Идём батчами по ~50 со стоп-гейтом:**
- Батч из 50 — **стратифицированный срез** по всем агентам/ячейкам (по полям `agentFocus`+`cell`), не 50 однотипных.
- Цикл на батч: `build` (сценарии батча) → `run` → `judge` → `report(batch)` → **ГЕЙТ РЕШЕНИЯ** (запиши явно):
  `stop-clear` (картина ясна — систематический провал класса воспроизвёлся ИЛИ всё ровно-зелёно → стоп),
  `continue` (сигнал шумный / новые классы → следующий батч),
  `fix-first` (вскрылся баг конвейера, блокирующий остальное → сначала фикс).
- **Изоляция сценариев:** консолидатор смотрит весь тенант того же вида → разные сценарии могут случайно слиться.
  Гони каждый сценарий в своём scope (отдельный тенант на батч / уникальный `scope`-тег / чистка между), КРОМЕ СК6
  (масштаб/шум — там несколько норм вместе по замыслу).
- Отчёт кумулятивный «было→стало» по батчам. Baseline снят при `stop-clear` ИЛИ пройдены все батчи.

## Конфигурация прогона — зафиксировать (ТЗ §3)

Перед build выставь tenant-scoped: `aiFeatures.regulationConsolidatorEnabled=true`; **включи компилятор документа**
(иначе `contentMd=statement`, A3 не проверить — зафиксируй фактический флаг); сними реальные `LlmTaskRoute` для
`regulation-extract`/`regulation-dedupe`/`compile-org-document` (`diag-llm-routes.ts`). Всё это — в отчёт.

## Метрики и атрибуция (ТЗ §6)

- **A1:** kind-accuracy + confusion 5×5; org-norm filter precision=1.0 (0 мусора) / recall; ownerCompany; keepability; field-fidelity; confidence.
- **A2:** verdict-accuracy + confusion 5×5; **no_false_merge (ключевой)**; merge-recall; extension-correctness; contradiction recall/precision. Отличай «арбитр ошибся» от «дубль не дошёл до арбитра» (cosine-выборка / неверный kind от A1).
- **A3:** **preservation (ключевой — старое не потеряно)**; no-duplication; structure-fidelity; steps-sync; conflict-signal.
- **A4 Владение:** owner_accuracy (роль-без-имени → null, не выдумка); subject_accuracy (растёт к правильному клону);
  **no_cross_clone_leak (ключевой)** — упоминание ≠ владение, не тащить норму в чужой клон; ownership_carry
  (владелец переносится при merge/extension/переназначении, депрекейт не тащит); **desync_no_fabrication (КОРЕНЬ)** —
  смена носителя/сирота → старый снимок клона НЕ называет регламент как свой; клон без привязанных правил даёт
  `usedRegulationNames=[]` честно, а не выдуманное имя. (A4.4 требует построить клон и снять трассу `usedRegulationNames` —
  мост к `clone-stand`; для A4.4/desync проведи `role.bearer_changed` Елена→Игорь как в clone-stand.)
- **Сквозные:** финальные счётчики карточек vs эталон; conflictItems; **идемпотентность (2-й прогон Δ=0)**; целостность версий; депрекация.

Каждый провал → к агенту: A1 / A2 / A3 / A4-владение / pipeline (candidate-miss / route / infra).

## Ловушки (ТЗ §8 — учесть обязательно)

Каскад A1→A2 (неверный kind → дубль в другой таблице → провал на A1, не A2); «дубль не дошёл до арбитра»
(cosine-порог); компилятор опционален (включить); строгий `order` подачи; резолв `ownerHint` требует
посеянных Person; не ставить `trustTier='human'` на стенд-карточки; throwaway-тенант не «Стрела»;
`createPrismaClient()` (не голый `new PrismaClient()`); стендовые скрипты — НЕ прод (в `apply-prod-deploy.ts`
и `prod-deploy-log` НЕ вносить).

## Что вернуть

Отчёт `docs/testing/regulation-stand-report.md` (человеческим языком + цифры): scorecard по A1/A2/A3 +
confusion-матрицы + разбор ловушек + финальные счётчики + идемпотентность + **таблица диагнозов с атрибуцией
к агенту** (что и почему провалилось, где корень). Обнови `plans/tz/2026-07-03-regulation-instruction-stand.md`
(статусы фаз) и реестр `second-brain/04_не-сделано/README.md`. Рефлексия — в `second-brain/05_история/`.
Коммить свою работу по фазам; **push — только по явному подтверждению владельца** (правило репо).

## Acceptance (ТЗ §9)

Стенд гоняется `stand.ts all`; корпус покрывает карту 360° (крит. ячейки ≥3); эталон кросс-проверен;
baseline снят с атрибуцией к агенту; конфигурация (флаги+модели) зафиксирована; `typecheck/lint/build`
зелёные; прод не тронут; README написан.
