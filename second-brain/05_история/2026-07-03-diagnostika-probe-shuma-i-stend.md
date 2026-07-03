---
date: 2026-07-03
tema: диагностика шума уточняющих вопросов (probe) + тестовый стенд
---

# Почему Кора всё ещё «мучает» вопросами по шагам/регламенту + стенд probe

## Что было поставлено
Владелец получил утром 5 уточняющих вопросов «по регламенту, по шагам», хотя переработка уточняющих вопросов (kora-clarify-questions-overhaul) должна была их урезать. Задача: найти коммит переработки, проверить прод (выкачено ли), понять какой агент инициирует вопросы. Параллельно сотруднице (Настя) пришёл «никчёмный» вопрос про сильные стороны. Затем — подготовить тестовый стенд уточняющих вопросов на локальной «Стреле».

## Как решал
- Прод read-only через SSH: `user@46.8.196.29` → `su root` → `docker compose exec postgres psql z_main`. Грабли (наступал уже 2-й агент): macOS без sshpass → `expect`; root по SSH запрещён; `su` спрашивает пароль ПО-РУССКИ «Пароль:» (regex `(assword|ароль):`); SQL через base64. Зафиксировал в `docs/operations/prod-ssh-access.md` + память `reference_prod-ssh-access.md`.
- Поднял `probe_events` орга владельца «Ооо луа» (`cmpndk2tw…`). Сырые тексты payload.message показали: 5 вопросов = дайджест выбрал 5 из **186 в очереди** и переформулировал LLM-ом.
- Построил стенд `backend/scripts/probe-stand/` (`registry.ts` карта типов, `judge.ts` LLM-судья DeepSeek-v4-pro по API, `stand.ts` раннер) + README `docs/testing/probe-stand.md`. Механизм триггера — Nest-контекст (`createApplicationContext(AppModule)`, как в `backfill-*`).

## Что вышло
- Переработка **выкачена и работает**: инспекторы решений/обещаний/регламентов молчат (промис последний раз 30.06).
- Реальный шум — **`curation.consistency_checker`** (`consistency-checker.cron.ts`): крон `@Cron('0 */4 * * *')`, dedup TTL 14400с = интервалу → перевыпуск нарушения 6×/сутки, отдельный probe на КАЖДЫЙ шаг процесса. У «Ооо луа» ≈87% шума, 186 в `queued_digest` (бэклог ~37 дней).
- Дубль-баг: `consistency_violation.R6` == `companyprofile.missing_*` (два агента, один вопрос).
- Вопрос Насте = `3-2-knowledge-clone` (`knowledge.new_expertise_detected`) — строитель клона.
- Стенд: typecheck 0, режим `catalog` прогнан. Коммиты `c42da3c7` (стенд), `eaceb6d0` (SSH-док).

## Чему научился
- **Диагностировать probe по `probe_events.reason`, а НЕ по тексту вопроса.** Дайджест переформулирует LLM-ом → мой первичный код-маппинг (process_template/insight) частично не совпал: реально это `consistency_violation.R2/R3`. Reason в БД — источник правды.
- **`consistency_checker` — главный источник шума**, а не тронутые переработкой инспекторы. Урезали 3 категории, но дневной шум сместился на consistency + company-profile + attribution + experiment + clone.
- **`task.method_capture` уходит исполнителю (assignee), НЕ владельцу**, и только при complexity ≥ `tracker.methodCaptureMinComplexity` (0.5).
- **SSH-`su` на проде спрашивает пароль по-русски** — expect должен ловить `Пароль:`.

## Открыто / дальше
- Стенд запускает другой агент (тяжёлые режимы + LLM не гонял — только typecheck/catalog).
- Отдельным шагом — ТЗ на починку `consistency_checker` (агрегация по процессу, снос дубля R6↔company-profile, dedup TTL >> интервала, machine-fillable гейт, дренаж бэклога).
- Возможна доп. синтетика в «Стрелу» под покрытие всех probe-типов (фикстуры).
- Сменить прод-пароль (прислан открытым текстом).
