---
type: reflection
date: 2026-07-03
feature: clone-construction-fixes
commits: [fc095555, e47ac9b0, 86e40428]
branch: work/2026-07-02
distilled: false
---

# Рефлексия — фикс построения клонов (7 фиксов, клоны реально собираются)

## Что было поставлено

Задача «качество клонов сотрудников»: построить стенд + линейку, снять baseline, петлёй довести клона
до планки. На первом же шаге (наполнение «Стрелы» кормом) упёрся в то, что **клоны не собираются вообще** —
пустые. Владелец направил чинить ядро построения СЕЙЧАС (вариант А), до baseline. Дальше по ходу владелец
задал вопросы «из чего собирается клон», «почему не все роль-клоны», «почему Anthropic», «почему 1 из 5 падает»
— каждый вскрыл отдельный разрыв.

## Как решал (файлы, коммиты)

Диагностировал на живом прогоне стенда (`backend/scripts/clone-stand/seed-clone-feed.ts`, tenant «Стрела»
`STRELA_ORG=cmr4ztnfj0001hgbwuij7xc3n`), 7 фиксов в 3 коммитах:

- **Ф1 провод** ([persons.service.ts](../../backend/src/modules/persons/services/persons.service.ts)) — внедрил
  `EventEmitter2` + `maybeEmitBearerChanged` (копия из `AppointmentsService`), эмит `role.bearer_changed`
  пост-commit в `create`/`update`. Назначение из кабинета мимо `AppointmentsService` (напрямую `tx.appointment.create`)
  НЕ эмитило событие → клон роли ждал воскресного крона. `fc095555`.
- **Ф2 порог склейки** ([specialist-3-7-skill.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts) + [role-principle-synthesis.service.ts](../../backend/src/modules/knowledge-core/services/role-principle-synthesis.service.ts)) —
  захардкоженный `GROUP_SIMILARITY_THRESHOLD=0.78` вынес в крутилку `knowledge.skillClusterSimilarityThreshold`
  (getDynamic, дефолт 0.72). Живые перефразировки одного метода садятся на cosine 0.72–0.85; 0.78 резал посередине.
  `fc095555`.
- **Ф3 одиночная роль** ([executable-persona-build.service.ts](../../backend/src/modules/knowledge-core/services/executable-persona-build.service.ts)) —
  `roleAggMinPersons` (было ≥2) на getDynamic + сид 1. `fc095555`.
- **Ф4 гейт по слоям** — `buildForProfile`/`buildForRole` гейтили сборку по `minTraits`, считая ТОЛЬКО слой `skill`,
  хотя в промпт идут все 7 компонентов. Теперь считают все 4 слоя метода (skill+value+motivation+process_marker). `e47ac9b0`.
- **Ф5 фантомный порог** — `personaMinTraits` на getDynamic + сид 3. Админка была засеяна 5, а потребитель читал
  ENV=3 МИМО → перевод на getDynamic без выравнивания поднял бы 3→5 (регресс). `e47ac9b0`.
- **Ф6 надёжность compile** — `executable-persona-compile` primary `deepseek-v4-flash`→`deepseek-v4-pro` + ретрай×3
  в `compilePersonaPrompt`. Flash спотыкался на structured/thinking (`Thinking mode does not support tool_choice`).
  Прод-путь: +compile в `patch-mass-migrate-to-deepseek-pro.ts` (everyDeploy `--update-existing`). `e47ac9b0`.
- **Ф7 verify** — `skill-trait-verify` flash→pro (то же: fail-open промоутил черту без проверки). `86e40428`.

## Что вышло (верификация)

- **было→стало (тот же корм):** active-черты Сергей 1→3, Михаил 2→4, Дарья 3→7, **Игорь 0→4, Елена 0→5**; всего 6→23.
- Диаг кластеров на живых эмбеддингах: кластеров ≥3 у Елены 0→2, Игоря 0→1 при пороге 0.72.
- Провод: изолированный тест — `persons.create({roleId})` → лог `role.bearer_changed: создана новая версия` → версия роль-клона создана.
- **Все 4 роль-клона собрались** (было: только integrator); **9/9 клонов (5 person + 4 role) стабильно, 3 прогона подряд** после compile→pro+ретрай.
- typecheck backend+frontend зелёные; guard-спеки реестра/FE 16/16; snapshot маршрутов обновлён.
- Push `4effba7a..86e40428 → work/2026-07-02`.

## Чему научился

1. **Клон = 7 слоёв, не «три черты».** skill/value/motivation/process_marker (SkillTrait по layer) + RolePrinciple +
   PracticeSkill + регламенты должности → LLM `executable-persona-compile` склеивает в persona-промпт. Гейтить сборку
   по 1 слою из 7 — баг (см. [[clone-how-it-works]]).
2. **«getDynamic честнее статики» может стать регрессом.** Перевод потребителя со статичного ENV на getDynamic
   начинает честно читать админку — а если админка засеяна другим значением (фантом 5 vs ENV 3), эффективный порог
   молча меняется. При переводе на getDynamic — сверять админ-значение с ENV/кодом и выравнивать сидом.
3. **deepseek-v4-flash флейков на structured/thinking** (`Thinking mode does not support tool_choice`): для задач с
   JSON-выходом / ответственной сборкой — брать deepseek-v4-pro (как detect). Роутер пробует каждый провайдер ОДИН
   раз (per-provider ретрая нет) → на ответственных шагах добавлять ретрай на уровне вызова. Не списывать «падает
   1 из 5» на локальную инфру — на масштабе это тихая деградация на худший фолбэк.
4. **Стенд-очередь BullMQ в dev флейкует** (два app-контекста); для детерминизма стенда — синхронный `rebuildProfile`
   в обход очереди. Poll-условие `stable≥2 && cnt>0` порочно (ловит СТАРУЮ стабильность).
5. **Назначение человека идёт двумя путями** — `AppointmentsService` (эмитит события) и `PersonsService` напрямую
   (не эмитил). Событийные побочки надо дублировать в обоих или свести в один путь.

## Открыто (в baseline / ТЗ-1)

- Почему skill-слой недопроизводится (у Дарьи 2 skill из 7 кластеров, хотя корм — метод) — мульти-детектор
  (skill/value/process на одном кластере) забирает контент в другие слои. Разобрать в Слое 0.
- Политика ответа (refusal-first → «эксперт всегда») — ТЗ-1, после baseline (Р6).
