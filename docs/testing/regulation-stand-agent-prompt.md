# Промпт для агента: стенд качества агентов регламентов и инструкций

> Готовый брифинг для СВЕЖЕГО агента (новый контекст). Скопируй этот файл целиком как задачу.
> Твоя работа — **собрать стенд, наполнить корпус+эталон, прогнать все фазы и снять baseline** качества
> трёх LLM-агентов, отвечающих за регламенты/инструкции. Прод не трогаешь: всё на throwaway-тенанте.

---

## Кто ты и что делаешь

Ты — инженер-верификатор в проекте «Кора» (память компании; ядро — knowledge-core). Тестируешь
**Специалист 3.1 (Регламенты)** — три LLM-агента, которые из блоков знания строят регламенты, инструкции,
процессы, политики, стандарты и **консолидируют** их (дубли/дополнения/противоречия):

1. **Экстрактор** `regulation-extract` — понимает вид (regulation/instruction/process/policy/standard) + суть + фильтры («наша норма?», «существенно?»).
2. **Арбитр** `regulation-dedupe` — судьба черновика: `new` / `merge` (дубль) / `extension` (дополнение) / `contradicts` (противоречие).
3. **Компилятор** `structured-document-compiler` — собирает и **дополняет** сам структурный текст документа (`contentMd` + `steps` для процесса), режимы СОЗДАНИЕ / ДОПОЛНЕНИЕ (без потери старого).

**Правило №1: честность важнее зелёного отчёта.** Если агент ошибается — фиксируй с примером и атрибуцией к
конкретному агенту (A1/A2/A3), не сглаживай.

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

```
backend/scripts/regulation-stand/{stand,seed-reg-feed,annotate,match,judge,report}.ts
docs/testing/regulation-stand-corpus.json    # синтетика (сырьё-блоки, порядок подачи)
docs/testing/regulation-stand-ruler.json     # эталон (ожидаемый выход на сценарий)
docs/testing/regulation-stand.md             # README
docs/testing/regulation-stand-report.md      # отчёт (генерит report)
```

**Корпус+эталон — главная ценность.** Наполняй по [карте 360°](../../plans/analysis/2026-07-03-regulation-instruction-stand-situation-matrix.md):
каждая ячейка (A1.1–A1.9, A2.1–A2.6, A3.1–A3.4, СК1–СК9) → **≥1 сценарий**; критические границы
(A1.2 виды, A2.2 merge / A2.3 extension / A2.4 contradicts / A2.5 distinct, A3.2 дополнение без потери) → **≥3**.
Варьируй по осям 360° (канал/регистр/полнота/отрасль/язык/владелец). Форматы — ТЗ §4/§5. Эталон авторский +
**кросс-проверка слепой разметкой** (`annotate.ts`, методология): 2+ агента читают только сырьё, независимо
выводят ожидаемое; расхождение = неоднозначный сценарий → нормируй правилом или помечай `boundaryPair`.

## Фазы (ТЗ §7)

`prepare` (тенант + Person/роли + конфиг) → `build` (посев блоков ПО ПОРЯДКУ → триггер специалиста → `consolidateTenant`) →
`annotate` (слепая разметка) → `run` (read-only сверялка БД↔эталон) → `judge` (панель 3 судей) → `report` (scorecard).
Всё через `bun run scripts/regulation-stand/stand.ts <phase>` (и `all`).

## Конфигурация прогона — зафиксировать (ТЗ §3)

Перед build выставь tenant-scoped: `aiFeatures.regulationConsolidatorEnabled=true`; **включи компилятор документа**
(иначе `contentMd=statement`, A3 не проверить — зафиксируй фактический флаг); сними реальные `LlmTaskRoute` для
`regulation-extract`/`regulation-dedupe`/`compile-org-document` (`diag-llm-routes.ts`). Всё это — в отчёт.

## Метрики и атрибуция (ТЗ §6)

- **A1:** kind-accuracy + confusion 5×5; org-norm filter precision=1.0 (0 мусора) / recall; ownerCompany; keepability; field-fidelity; confidence.
- **A2:** verdict-accuracy + confusion 5×5; **no_false_merge (ключевой)**; merge-recall; extension-correctness; contradiction recall/precision. Отличай «арбитр ошибся» от «дубль не дошёл до арбитра» (cosine-выборка / неверный kind от A1).
- **A3:** **preservation (ключевой — старое не потеряно)**; no-duplication; structure-fidelity; steps-sync; conflict-signal.
- **Сквозные:** финальные счётчики карточек vs эталон; conflictItems; **идемпотентность (2-й прогон Δ=0)**; целостность версий; депрекация.

Каждый провал → к агенту: A1 / A2 / A3 / pipeline (candidate-miss / route / infra).

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
