---
type: reflection
date: 2026-07-07
feature: task-tracking-stand + task-text-reformulation
distilled: false
---

# Стенд качества трекинга задач + фикс текста задач (Т11)

## Что было поставлено
Оркестратор-промпт `plans/tz/2026-07-03-task-tracking-stand.orchestrator-prompt.md`: (1) построить раннер стенда
`task-stand` и снять baseline 5 механизмов трекинга; (2) реализовать owner-confirmed фикс «структурное описание
задач» (Т11, кейс MTG-14) и доказать стендом было→стало. Владелец по ходу: не ждать подтверждений, делать полный
цикл автономно батчами; можно оформить ТЗ и второй цикл.

## Как решал (файлы, коммиты)
- **Стенд** (коммит `0862de79`): 7 скриптов `backend/scripts/task-stand/` силами 4 суб-кодеров (types+dispatcher+
  seed; inject; assert; judge+report), диспетчер довязал сам. Клонировал паттерны clone-stand/probe-stand + `_lib/
  combat-harness`. Сид создаёт СВЕЖИЙ тенант на каждый прогон (чистый замер).
- **Ф5 текст-фикс** (коммит `a3c35c19`): `description` в `specialists-combined.prompt.ts` (схема/тулза/промпт) →
  map в сервисе → `resolvedDescription` в `task-draft-materializer.service.ts` (в дедуп И extractedDescription).
  32 юнита. Провенанс в rawContent сохранён.
- **Цикл 2** (коммит `f460d478`): ТЗ `2026-07-07-issue-embedding-worker-registration.md` по находке.

## Что вышло (верификация)
- **Т11 доказан было→стало на meetings:** K-03 «Пете надо договор с этими… на три с половиной» → «Пете поручено
  оформить договор с Логистик Плюс на 3,5 млн рублей. Срок — до 15 июля 2026.» `descriptionClean` false→true.
  K-10 PASS. Заголовок не менялся, факты целы, провенанс сохранён.
- **Т1 худший сценарий опровергнут:** SpecialistsCombined создаёт задачи из встречи/чата; легаси
  TaskExtractionService работает в изоляции, но дормантен (`t1Isolation` в raw.json).
- **Находка:** IssueEmbedWorker не зарегистрирован → embedding задач не считается (ТЗ цикла 2).
- typecheck/lint/32 теста зелёные; INV-1 (R13) соблюдён.

## Чему научился (грабли — кандидаты в дистилляцию)
1. **Конвейер knowledge-core АСИНХРОННЫЙ и МЕДЛЕННЫЙ, стадий много.** Задача из встречи дозревает >5 мин через
   `raw-events → block-distill → block-linker → entity-resolver → specialist-routing → specialists-combined →
   materialize → intake-auto-triage`. Ожидание «конвейер устоялся» ОБЯЗАНО смотреть ВСЕ очереди (не 4) —
   иначе после дренажа raw-events работа уходит в невидимый block-distill, backlog читается 0 → ложное
   «устаканилось» → creation-сценарии дают ложный «nothing». Замер per-scenario окнами хрупок; для медленных
   сущностей нужна атрибуция по durable-тегу (`meetingId`), не по временному окну.
2. **`materializer` идемпотентен по `externalId=sha1(channel:sourceId:quote|title)`** — повтор той же встречи на
   том же тенанте СКИПАЕТСЯ. Значит для сравнимых прогонов — свежий тенант каждый раз (prepare создаёт новые org).
3. **IssueEmbedWorker дормантен** (не в провайдерах, `ai/workers.module.ts:200` — только комментарий; зеркало
   GoalEmbedWorker зарегистрирован). `enqueueEmbed` при `!embedQueue` — тихий no-op. → `Issue.embedding` не
   считается; KNN-дедуп/закрытие против AI-задач не работают.
4. **block-extraction (deepseek-v4-flash) не принимает `tool_choice` через прокси** → откат на auto → invalid
   JSON → ретрай. Замедляет конвейер, кандидат в находку надёжности.
5. **Параллельная сессия в том же рабочем каталоге** двигала HEAD каждые минуты (правила CLAUDE: worktree на
   сессию). Мои файлы (task-stand/, Ф5) не пересеклись с её (linkage/progress-draft); штамповал headCommit в
   каждый прогон, узкое окно до→после для доказательства.
6. **Суб-агенты-кодеры «армят монитор» и выходят, не дождавшись** длинного прогона — не верить их отчёту про
   прогон; запускать верификацию самому.

## Ограничения стенда (честно, не доведено)
- freeNote (chat/telegram/email) атрибуция несовершенна (meeting — точная); content-reconcile матчит setup-задачи
  (не исключает их id); последовательный прогон 110 = часы. Регрессия дедупа (ось D) чисто не замерена. Полный
  прогон 110 + петля — follow-up. См. `docs/testing/task-stand-report.md` §3.
