---
type: tz
phase: alpha-2
status: in_progress
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-2
  - plans/tz/2026-05-22-final-roadmap.md
date: 2026-05-23
---

# SBA α-2 — расширение Layer 1 разметки на 19 новых signalType

> Закрытие части §α-2 в `final-roadmap.md`: добавить недостающие signalType для β-6 / β-7 / β-8 / γ-1 / γ-3 / δ-2. Bug-fix `ENTITY_TYPE_VALUES` уже сделан в CRIT-1.

## Scope

- Добавить 19 значений в `SignalType` enum в `schema.prisma`.
- Расширить `SIGNAL_TYPE_VALUES` в `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`.
- Описать каждый новый тип в SYSTEM_PROMPT.
- Снести TODO «согласовать описания» (delta §α-2 п.3) — описания пройдены и зафиксированы.
- `bun run prisma:generate` + `bun run typecheck` зелёные.

## Новые 19 signalType

Для каждого — кто потребитель, кратко смысл, маркеры-фразы.

| signalType | Потребитель | Смысл | Маркер-фразы |
|---|---|---|---|
| `expertise` | γ-1 SkillProfile | Профессиональное знание/навык, продемонстрированное в разговоре | «я знаю», «у меня опыт в X», «обычно делается так» |
| `experience` | γ-1 SkillProfile | Конкретный кейс из прошлого, на котором учился | «однажды у нас», «в проекте Y», «в прошлый раз» |
| `competence` | γ-1 SkillProfile | Самооценка способности («могу/не могу делать Z») | «я умею», «я не справлюсь с», «я разбираюсь в» |
| `methodology_step` | γ-1, α-7 | Конкретный шаг авторской методологии (не process_step организации) | «я обычно сначала…», «мой алгоритм» |
| `hypothesis` | β-6 Experiment Tracker | Гипотеза для проверки | «гипотеза», «возможно X даст Y», «предположим что» |
| `result` | β-6 Experiment Tracker | Измеримый результат эксперимента | «получили N%», «эксперимент показал», «итог замера» |
| `lesson` | β-6 Experiment Tracker, γ-1 | Урок/вывод из эксперимента или провала | «вывод», «теперь знаем», «больше так не делаем» |
| `brand_principle` | β-7 Brand Voice | Принцип бренда / голос / запрет | «у нас в бренде принято», «никогда не используем», «наш тон» |
| `content_artifact` | β-7 Brand Voice | Существующий контент-артефакт как пример (пост, лендинг, ролик) | «как в посте X», «по образцу», «было в кампании» |
| `commitment_status` | β-8 PersonalRelation, COO | Статус ранее данного обязательства (done/in-progress/dropped) | «сделал», «ещё не успел», «отказался от» |
| `plan_item` | β-8 COO, δ-2 ProactiveWatcher | Пункт плана на период | «на эту неделю», «в ближайший спринт», «план дня» |
| `done_item` | β-8 DailyCheckIn | Закрытый пункт чек-листа | «сделано», «закрыл», «отгрузили» |
| `blocker` | β-8 DailyCheckIn, γ-3 | Блокер прогресса | «не могу из-за X», «ждём Y», «стопор» |
| `team_friction` | β-8 PersonalRelation | Конфликт/трение между людьми | «не сошлись», «постоянно спорим», «холодно с X» |
| `process_friction` | γ-3 CrossFunctional, β-8 COO | Трение между процессами/отделами | «между X и Y зависает», «handoff не работает» |
| `resource_gap` | γ-3, β-8 COO | Нехватка ресурса (человек/бюджет/инструмент) | «не хватает X», «нет рук», «бюджета мало» |
| `suggestion` | δ-2 ProactiveWatcher, γ-2 Concierge | Предложение/совет (отдельно от idea — без целевого продукта) | «советую», «предлагаю», «попробуй» |
| `client_request` | β-8 COO, sales | Прямой запрос от клиента (отдельно от feature_request — у нас) | «клиент попросил», «они хотят чтобы мы» |
| `question` | δ-2 ProactiveWatcher | Вопрос без ответа в разговоре | «а как мы будем…», «что если» (без ответа в окне) |

## DoD

- [x] schema.prisma `enum SignalType` содержит 19 + 14 + 5 = 38 значений.
- [x] `SIGNAL_TYPE_VALUES` в `block-ingest.prompt.ts` синхронизирован (38 значений).
- [x] SYSTEM_PROMPT содержит описание каждого нового типа.
- [x] TODO про «согласовать описания» снесено.
- [x] `bun run prisma:generate` без ошибок.
- [x] `bun run typecheck` без ошибок.
- [x] `prompts.spec.ts` — не затрагивается (это другой набор тестов).

## Связанные правки

- **Не трогать** multi-target extraction (block + processes + decisions + regulations + policies + metrics + tools в одном проходе) — это работающий contract.
- LLM-провайдер ничего не знает про значения signalType — он получает enum в JSON-schema и описание в SYSTEM_PROMPT. Расширение enum — backward-compat для существующих блоков.
