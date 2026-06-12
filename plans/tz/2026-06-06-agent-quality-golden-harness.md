---
type: tz
status: ready-to-implement
feature: agent-quality-golden-harness
date: 2026-06-06
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-06-handoff-brief-all-prod-fixes.md
  - plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md
  - plans/tz/2026-06-04-combat-test-harness.md
  - plans/tz/2026-06-06-meeting-tasks-quality-dedup-asr.md
---

> Анализ-источник: `deep-root-cause-analysis-prod-issues.md` §5, §11.5 · бриф §ТЗ-6 · Статус согласования: decisive.
> Цель в одну строку: дать **регрессионный замер качества извлечения** — прогонять эталонные транскрипты (чистые + с ошибками распознавания) через реальные промпты и мерить полноту/точность/дубли **ДО и ПОСЛЕ** правок промптов и моделей (в частности, приёмка ТЗ-4).

---

## 1. Цель и зачем (человеческим языком)

**Проблема.** Сейчас качество извлечения задач/решений проверяется только глазами на живых встречах — нельзя померить, стало ли лучше после правки промпта/модели. Когда ТЗ-4 добавит ASR-ноту и дедуп, нужен **числовой** ответ «стало лучше или хуже», а не «вроде получше».

**Что делаем.** Набор эталонных транскриптов с **golden-ожиданиями** (какие задачи/решения там объективно есть) + прогон через **реальные** промпты агентов + скоринг: **полнота** (сколько golden-пунктов извлечено), **точность** (сколько извлечённого верно), **доля дублей**. Два варианта каждого транскрипта: **чистый** и **с ошибками распознавания** (ASR-гарблед) — чтобы мерить устойчивость к кривому ASR (то, что лечит ASR-нота ТЗ-4).

**Чем решение лучше.** Это **измеритель**, не фикс. Он строится на готовом `combat-test-harness` (инжект синтетики → пайплайн → чтение результата), добавляя слой golden-скоринга. Запустил до ТЗ-4 → baseline; после ТЗ-4 → дельта. То же — для смены модели (ТЗ-4 Ф4, ТЗ-3, ТЗ-7).

> Это **регрессионный тест-харнесс качества** (golden-тесты на синтетике), локальный инструмент QA. Не CI-по-умолчанию (нужны БД+Redis+LLM-ключи+запущенный backend).

---

## 2. REALITY-CHECK (что по факту / на чём строим)

| Проверено | Факт | Источник |
|---|---|---|
| База-харнесс — реализован (Ф1-3) | `combat-test-harness`: env-driven инжектор+поллер, `createPrismaClient`, prod-guard, teardown, `injectMeetingDirect` (Meeting+Transcript(turns)→RawEvent→пайплайн), `pollUntil`, матрица | [combat-test-harness.md](2026-06-04-combat-test-harness.md), `backend/scripts/smoke-pipeline-e2e.ts`, `backend/scripts/_lib/combat-harness.ts` |
| Воркеры — в одном процессе | харнесс НЕ поднимает свой Nest-контекст (двойная регистрация воркеров); инжектит в Redis/Prisma, обрабатывает запущенный backend | combat-test-harness §2 |
| Дедуп-нормализация (для скоринга) | `normTaskTitle` — frontend (ТЗ-4 Ф1); в харнессе реплицировать (числа/скобки) для матчинга golden↔extracted | [task.ts](../../frontend/src/domain/task.ts) (после ТЗ-4) |
| Что читать как результат | `Task` (по `meetingId`) + `AiResult.structuredData.tasks/decisions` после `ai_ready` | combat-harness verify-слой §4 |
| 2 реальных эталона | встречи владельца «тестоая»/«тест сте» с разобранными golden и ASR-искажениями («стопящих»=100 платящих, «10 минусов»=10 месяцев) | анализ §5, §11.1-11.3 |
| combat-harness Ф4 не прогнан | прогоны на стенде — открыты; ТЗ-6 это НЕ блокирует (другой слой — скоринг) | combat-test-harness §7 Ф4 |

**Следствие:** инфраструктуру инжекта/поллинга/teardown НЕ пишем заново — реюз `_lib/combat-harness.ts`. Новое: golden-фикстуры + слой скоринга качества (полнота/точность/дубли).

---

## 3. Доказательство выбора (кратко, challenge-loop)

| Решение | A | B | Выбор · почему |
|---|---|---|---|
| Как прогонять промпты | **e2e: инжект transcript → реальный пайплайн → читать Task/structuredData** | изолированно звать prompt-builder + LlmRouter в скрипте | **A** — реюз combat-harness; тестирует РЕАЛЬНОСТЬ (промпт+модель+пайплайн = что видит юзер); B требует поднять LlmRouter с DI вне Nest (тяжело) |
| Матчинг golden↔extracted | **нормализованный заголовок (реюз `normTaskTitle`) + опц. LLM-judge для fuzzy** | только LLM-judge | **A** — детерминированный, дешёвый, воспроизводимый baseline; LLM-judge опц. для «почти совпало» |
| Где живёт | **`backend/scripts/` (как combat-harness), `bun run`** | в `*.spec` vitest | **A** — нужен живой backend+LLM, не юнит; vitest не гоняет реальные модели |

- *Корень?* Да — даёт числовой регресс-замер, которого нет; ловит класс «правка промпта молча ухудшила извлечение».
- *Эффективнее?* Да — реюз combat-harness инфры; детерминированный матчинг вместо дорогого судьи по умолчанию.
- *Кода ради кода?* Нет — измеритель напрямую используется приёмкой ТЗ-4 (и будущих правок модели).

---

## 4. Принятые решения (decisive)

| # | Решение | Почему |
|---|---|---|
| Р1 | **e2e-режим:** инжект transcript через `injectMeetingDirect` (combat-harness) → ждать `ai_ready` → читать `Task`+`structuredData`. | Реюз готовой инфры; тестирует реальный путь (промпт+модель+пайплайн). |
| Р2 | **Golden-фикстуры** `backend/scripts/fixtures/agent-golden/*.json`: `{id, variant:'clean'|'asr_garbled', transcript:{turns}, golden:{tasks:[{title, keyFacts:[...]}], decisions:[...]}}`. Сидим 2 реальных эталона + их ASR-гарблед-вариант. | Чистый vs гарблед измеряет устойчивость к ASR (то, что лечит ASR-нота ТЗ-4). `keyFacts` («200 встреч», «50 сделок», «100 платящих») — для проверки потери конкретики. |
| Р3 | **Скоринг:** полнота=matched/`golden`; точность=matched/`extracted`; доля-дублей=dupes/`extracted`. Матчинг — нормализованный заголовок (реюз логики `normTaskTitle`) + проверка `keyFacts` подстрокой/числом. | Числовой воспроизводимый baseline. keyFacts ловит «задача извлечена, но число потеряно/искажено». |
| Р4 | **baseline-JSON + дельта:** прогон пишет `agent-golden-baseline.json`; повторный прогон печатает дельту ДО/ПОСЛЕ. | Это и есть «мерить ДО/ПОСЛЕ правок» (приёмка ТЗ-4). |
| Р5 | **Безопасность как combat-harness:** env-driven, prod-guard (`ALLOW_PROD`), синтетический тенант + teardown, `createPrismaClient`, не CI-по-умолчанию. | Реальные LLM-вызовы стоят денег; синтетика не должна течь в прод. |

> Развилок нет. LLM-judge для fuzzy-матча — опц. (Р3), по умолчанию детерминированный матчинг.

---

## 5. Scope
**Входит:** golden-фикстуры (Р2); расширение харнесса режимом quality (Р1); слой скоринга + baseline/дельта (Р3, Р4); реюз combat-harness инфры (Р5).
**Не входит (vNext):**
- Изолированный prompt-only режим (без пайплайна) — если e2e окажется слишком медленным (числовой триггер: >5 мин/фикстура).
- LLM-judge fuzzy-матчинг по умолчанию (опц. флаг).
- CI-интеграция (нужен стенд с LLM-ключами) — отдельное решение.
- Расширение combat-harness Ф4-прогонов (другой слой, другое ТЗ).
- **НЕ** «eval-система/авто-тюнинг промптов» — только замер; правки промптов остаются за ТЗ-4 и владельцем.

---

## 6. Контракт (что именно сделать)

### 6.1 Golden-фикстуры (Фаза 1)
`backend/scripts/fixtures/agent-golden/*.json` — по файлу на эталон×вариант:
```json
{
  "id": "sales-kickoff",
  "variant": "asr_garbled",
  "transcript": { "turns": [ { "speaker": "Алексей", "text": "...выйти на стопящих клиентов...", "startSec": 0, "endSec": 12 } ] },
  "golden": {
    "tasks": [
      { "title": "Выйти на 100 платящих клиентов в месяц", "keyFacts": ["100"] },
      { "title": "Провести 10 встреч-презентаций", "keyFacts": ["10"] },
      { "title": "Сделать 500 рассылок", "keyFacts": ["500"] }
    ],
    "decisions": ["Ниша — консалтинговые компании"]
  }
}
```
Сид: 2 реальных эталона (анализ §5) × {clean, asr_garbled}. ASR-гарблед-вариант кодирует реальные искажения («стопящих»←100 платящих, «10 минусов»←10 месяцев), golden — ВЕРНАЯ интерпретация.

### 6.2 Runner (Фаза 2) — `backend/scripts/agent-quality-harness.ts`
Реюз `_lib/combat-harness.ts` (env, prod-guard, `createPrismaClient`, bootstrap/teardown синтетического тенанта, `injectMeetingDirect`, `pollUntil`). Цикл по фикстурам:
1. `injectMeetingDirect(tenant, fixture.transcript)` → `Meeting+Transcript(turns)` → пайплайн.
2. `pollUntil` `Meeting.status==='ai_ready'` (или таймаут).
3. Прочитать `Task` (по meetingId) + `AiResult.structuredData.tasks/decisions`.
4. `scoreExtraction(fixture.golden, extracted)` → метрики.
Env: как combat-harness + `FIXTURES_GLOB`, `BASELINE_PATH`, `JUDGE` (0/1, опц. LLM-judge). Без своего Nest-контекста.

### 6.3 Скоринг (Фаза 3) — `backend/scripts/_lib/agent-scoring.ts`
```ts
function normTitle(s: string): string { /* реплика normTaskTitle: lowercase, срезать (скобки), числа без пробелов, пунктуация */ }
function scoreExtraction(golden, extracted) {
  // matched: для каждого golden.task — есть ли extracted с нормализованным заголовком ~= И всеми keyFacts (число/подстрока) присутствуют
  // completeness = matched / golden.tasks.length
  // precision = matched / extracted.length   (extracted без соответствия golden → ложное)
  // dupeRate = (extracted.length - uniqueByNorm(extracted).length) / extracted.length
  return { completeness, precision, dupeRate, matched, missing, spurious };
}
```
Аналогично для `decisions`. Агрегат по `variant` (clean vs asr_garbled). Вывод — таблица в stdout + запись `BASELINE_PATH` (Р4); при существующем baseline — печать дельты (`Δcompleteness +0.2` и т.п.).

---

## 7. Фазы и Acceptance (машинно-проверяемо)

Граф: Ф1 (фикстуры) → Ф3 (скоринг, тестируется юнитом на фикстурах) → Ф2 (runner, связывает инжект+скоринг). Ф1 раньше; Ф2/Ф3 после.

### Фаза 1 — Golden-фикстуры
Файлы: `backend/scripts/fixtures/agent-golden/*.json`.
**Acceptance:** ≥4 файла (2 эталона × {clean, asr_garbled}); каждый валиден по схеме (`id/variant/transcript.turns/golden.tasks[].title+keyFacts/golden.decisions`); asr_garbled содержит искажённый текст, а golden — верную интерпретацию (грепом: в transcript «стопящих», в golden «100»).
Закрывает: R1.

### Фаза 2 — Runner на базе combat-harness
Файлы: `backend/scripts/agent-quality-harness.ts`.
**Не входит:** скоринг-математика (Ф3), новые фикстуры.
**Acceptance:** грепы: импорт из `_lib/combat-harness` (`injectMeetingDirect`, `pollUntil`, prod-guard, `createPrismaClient`); env-driven; teardown в `finally`. Запуск `bun run scripts/agent-quality-harness.ts` (при живом backend+LLM) на dev доходит до чтения `Task`+`structuredData` без падения; prod-guard блокирует не-localhost без `ALLOW_PROD=1`. Нет своего Nest-контекста (грепом: нет `NestFactory.create`).
Закрывает: R2.

### Фаза 3 — Скоринг + baseline/дельта
Файлы: `backend/scripts/_lib/agent-scoring.ts` (+`.spec.ts`).
**Не входит:** инжект/пайплайн.
**Acceptance:** юнит `agent-scoring.spec`: golden 3 задачи, extracted 3 верных → completeness=1.0, precision=1.0; extracted с дублем «2000»/«2 000» → dupeRate>0; extracted потерял число (keyFact «100» нет) → этот golden НЕ matched (completeness<1); **negative:** extracted с лишней выдуманной задачей → precision<1. `normTitle` совпадает по поведению с `normTaskTitle` (числа/скобки). Запись/чтение baseline + печать дельты. `bun run typecheck`(вкл `.spec`)`/lint` зелёные.
Закрывает: R3, R4.

### Фаза 4 — Прогон baseline (владелец/разработчик)
**Acceptance:** прогон на dev → `agent-golden-baseline.json` записан; таблица показывает completeness/precision/dupeRate по clean и asr_garbled; на asr_garbled completeness заметно ниже (демонстрирует проблему, которую лечит ASR-нота ТЗ-4). После выката ТЗ-4 — повторный прогон показывает рост completeness на asr_garbled и падение dupeRate (это и есть приёмка ТЗ-4).

**Требования (EARS):**
- R1: Система shall иметь ≥4 golden-фикстуры (2 эталона × clean/asr_garbled) с верными golden-ожиданиями.
- R2: Когда запущен runner при живом backend, система shall инжектить каждый transcript через combat-harness, дождаться `ai_ready` и прочитать `Task`+`structuredData` (без своего Nest-контекста, с prod-guard).
- R3: Система shall считать полноту/точность/долю-дублей по нормализованному матчингу заголовков + проверке keyFacts.
- R4: Система shall писать baseline и при повторном прогоне печатать дельту ДО/ПОСЛЕ.

---

## 8. Границы фичи
- ✅ Always: реюз `_lib/combat-harness` (инжект/поллинг/guard/teardown); `createPrismaClient`; синтетический тенант; детерминированный матчинг.
- ⚠️ Ask first: LLM-judge по умолчанию (стоит денег); CI-интеграция; prod-прогон (`ALLOW_PROD`).
- 🚫 Never: `new PrismaClient()`; писать в чужой тенант; поднимать второй Nest-контекст (двойная регистрация воркеров); называть это «eval-системой»/авто-тюнингом промптов.

## 9. Совместимость с prompt caching
Не релевантно напрямую (харнесс гоняет существующие промпты как есть). Замер cachedTokens — опц. метрика baseline (vNext).

## 10. Риски / pre-mortem
| Риск | Митигация |
|---|---|
| e2e медленный (полный пайплайн × N фикстур) | `VERIFY_TIMEOUT_MS`; малый набор (4-8); опц. prompt-only режим (vNext-триггер >5мин/фикстура) |
| Нормализованный матчинг ложно «не совпал» (синонимы) | keyFacts по числам надёжны; опц. LLM-judge для fuzzy (Р3) |
| Реальные LLM-вызовы — деньги/недетерминизм | малый набор; не CI; baseline усредняет; temperature низкая на extract-промптах |
| Двойная регистрация воркеров | НЕ поднимаем Nest (грепом в acceptance Ф2) |
| Прогон в прод по ошибке | prod-guard combat-harness (`ALLOW_PROD`) |

## 11. Idempotency / feature-flag / prod-deploy
- Только `backend/scripts/*` + фикстуры. **НЕ продакшен-путь** (инструмент QA, `bun run` локально). В `apply-prod-deploy.ts` STEPS **НЕ регистрируется** (не seed/patch/migrate — диагностический харнесс, как combat-harness). prod-deploy-log не затрагивается.
- Feature-flag не нужен. Идемпотентность — синтетический тенант + teardown (как combat-harness).

## 12. DoD
- `bun run typecheck`(вкл `.spec`)`/lint` зелёные; юнит `agent-scoring.spec` (вкл negative).
- Фикстуры валидны; runner запускается на dev (ручная проверка) с prod-guard.
- second-brain: `01_projects/ai-jobs.md` (регрессионный харнесс качества извлечения); ссылка из `combat-test-harness.md` (смежный слой).
- Реестр `04_не-сделано/` — строка «baseline качества извлечения снят / не снят» при сдаче.
- Рефлексия в `05_история/`.
- В коде: 0 `process.env.*` вне харнесс-env-слоя, 0 `new PrismaClient(` (только `createPrismaClient`).

## Итог
_(заполнит tz-orchestrator: фикстуры готовы? runner проходит на dev? baseline снят? дельта после ТЗ-4 положительная?)_
