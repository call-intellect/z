---
date: 2026-05-24
type: reflection
session: ревизия 64 ТЗ vs реальный код — 8 параллельных агентов + handoff full-close
distilled: false
commits:
  - cfe36b6 docs(plans): ревизия 60 ТЗ vs реальный код + архивация закрытых
  - 72eb044 docs(plans): handoff full-close — 9 тикетов до полного закрытия Кора v2
---

# Ревизия plans/tz/ vs реальный код — 8 параллельных агентов, архивация 60 ТЗ

## Что было поставлено

Владелец: «ну ты запусти несколько агентов, чтобы они шли в код. Возможно, что-то в коде уже реализовано, а просто в TZ не отмечено, поэтому давай наведем порядок.»

После — серия уточнений: «то, что сделано — в архив», «полноценный пакет на закрытие всего», «Concierge отвечает только текстом», «комит и пуш».

Контекст: в `plans/tz/` накопилось ~65 ТЗ. Большинство в статусе `draft`, но по факту 60-70% уже реализовано (это было известно из `plans/analysis/2026-05-22-code-reality-deltas.md` и `plans/analysis/2026-05-23-kora-v2-shipping-report.md`). Нужна валидация vs код + чистка.

## Как решал

### Шаг 1 — разведка scope

`ls plans/tz/` + `awk` frontmatter status → выяснил что 64 ТЗ:
- ~5 done в шапке
- ~50 draft (большинство — устарело, по факту сделано)
- 9 ready-for-code (wave3/wave4 — по shipping-report should be done)
- 1 approved umbrella (final-roadmap)
- 1 in_progress (sba-alpha-2-19-signal-types)
- 1 planned

### Шаг 2 — параллельная оркестрация 8 агентов

Разделил 64 ТЗ на 8 пакетов по логическим группам:

| Agent | Пакет | Кол-во |
|---|---|---|
| A1 | Phase 0 серия (онбординг/роли/wizard) | 5 |
| A2 | Phase 7/8/9 + A-E (admin/dashboard/goals + post-meeting) | 8 |
| A3 | SBA alpha-1..7 + competitor-parity (старые от 21.05) | 8 |
| A4 | SBA beta-2..5 + gamma-1 (старые от 21.05) | 5 |
| A5 | SBA wave3/wave4 (23.05) | 12 |
| A6 | SBA delta + продуктовые (Activity/Gamification/Helpfulness) | 12 |
| A7 | Tracker phase 1-5 + mobile + новые 24.05 + umbrella | 9 |
| A8 | Старые черновики 06-10.05 | 5 |

Все 8 запущены в фоне через `Agent({run_in_background: true})` одним блоком tool_use.

**Промпт-шаблон для всех:** калибровка через прочтение shipping-report + delta + рефлексий; обязательная разведка через `run_pipeline` (vexp); обновление frontmatter `status:` + добавление блока «Ревизия от 2026-05-24» в конец каждого ТЗ; проставление `[x]` по реально готовым чекбоксам; отчёт-1-строка-на-ТЗ в конце.

### Шаг 3 — мониторинг + сводка по мере поступления

Получал task-notification по каждому агенту, обновлял TodoWrite, отображал прогресс владельцу. Параллельно делал расчёты:
- A1: 5 done.
- A2: 8 done.
- A3: 3 done + 5 superseded (5 layer-ТЗ заменены wave-вариантами).
- A4: 5 done.
- A5: 11 done + 1 superseded (axis-classifier короткий → -full).
- A6: 9 done + 3 partial (δ-3 нет WS; Gamification frontend; Helpfulness frontend).
- A7: 4 done + 2 partial + 2 draft + 1 superseded.
- A8: 5 done.

**Итог 64 ТЗ:** 50 done + 7 superseded + 5 partial + 2 draft.

### Шаг 4 — архивация 57 закрытых

`git mv` циклом через bash массив для 54 файлов. 3 файла оказались untracked (создавались после последнего git commit) — переехали обычным `mv`. Остались в `plans/tz/` 14 файлов:
- 7 реально открытых (5 partial + 2 draft)
- 5 непроверенных служебных (claude-code-infrastructure, cards, meeting-room-chat, deploy-cleanup, docker-deploy)
- 1 final-roadmap umbrella
- 1 _template

### Шаг 5 — handoff full-close

Прочитал существующий `plans/sprints/2026-05-25-handoff-after-wave3-complete.md`. Обнаружил: **4 из 7 его тикетов уже done** (α-10 frontend, α-7 ProcessTemplate, α-3 AxisClassifier, β-1 rip-out) — handoff устарел опять, как и предупреждал сам автор.

Создал новый `plans/sprints/2026-05-25-handoff-full-close.md` (~800 строк):
- TL;DR + регламент работы + актуальный inventory.
- 9 копи-паст-готовых промптов (P0/P1/P2/P3) с pre-разведкой через `run_pipeline`, DoD-чек-листами, запретами (не stash, не commit).
- Workflow оркестрации + параллелизация waves.
- Prod-операции после закрытия.

Старый handoff помечен `status: superseded` + `supersededBy: 2026-05-25-handoff-full-close.md`.

### Шаг 6 — продуктовое уточнение по δ-3 (от владельца «стоп!»)

Владелец остановил во время написания handoff: «нам не нужно, чтобы наша система отвечала голосом. Нет! Система отвечает только текстом.»

Действия:
- Memory: создал `feedback_concierge_text_only_output.md` + строка в `MEMORY.md`.
- Handoff: переписал Тикет 4 — убрал Часть 1 (TTS-в-Concierge / «🔊» / voiceMode toggle), оставил только WebSocket-стриминг голосового ВВОДА. Время 2-3 дня → 1.5-2 дня.
- ТЗ `2026-05-23-sba-delta-3-voice-channel-adapter.md` — в блок Ревизии добавил явную пометку (чтобы будущий оркестратор не предлагал TTS).

### Шаг 7 — 2 коммита + push

- `cfe36b6 docs(plans): ревизия 60 ТЗ vs реальный код + архивация закрытых` (65 файлов, +4599/-440)
- `72eb044 docs(plans): handoff full-close — 9 тикетов до полного закрытия Кора v2` (1 файл, +793)
- `git push origin dev` — успешно.

## Что вышло

- **64 ТЗ проверены против кода за ~50 минут параллельной работы** (агенты использовали `run_pipeline` + `get_skeleton` вместо ручного Grep).
- **57 закрытых ТЗ переехали в archive.** В `plans/tz/` остался реальный бэклог из 7 файлов + служебные.
- **Handoff обновлён** с правильным inventory — следующий оркестратор не будет тратить часы на дублирование уже сделанного.
- **Memory обновлена** правилом про текстовый-only Concierge.
- 2 коммита + push без проблем.

## Чему научился

1. **Параллельная ревизия 64 ТЗ через 8 агентов работает.** Каждый агент брал 5-12 ТЗ, на пакет тратил ~5 мин (run_pipeline + Read + Edit). Без параллелизации — был бы один день. С параллелью — час.

2. **Handoff'ы устаревают за день.** Старый handoff от 2026-05-25 (написан вчера ночью) уже на 4/7 тикетов устарел. Главный множитель скорости — обязательная разведка через `run_pipeline` за 30 сек перед каждым агентом. Это спасло часы работы каждый раз когда я делал это правило.

3. **Агенты могут ошибаться в подсчётах done/partial.** Например A7 в отчёте написал «5 done», по факту посчитал 4 done + 2 partial + 2 draft + 1 superseded = 9. Я зеркально продублировал ошибку в TodoWrite. Урок: при сводке отчётов от агентов — пересчитывать факты по списку, а не доверять их саммари.

4. **Untracked файлы в plans/tz/ — нормальное состояние** для активного проекта. Часть моих агентов работали с файлами которые НИКОГДА не были в git (созданы в текущей сессии другими процессами). git mv падал с «not under version control» — обходил обычным `mv`.

5. **При перемещении файла через `git mv` сразу с правкой** git показывает rename как modify (M) если файл уже редактировался. Чтобы разделить «переезд» и «правку» — нужно было бы делать их отдельными коммитами с `git mv` перед чтением кем-либо. Решение для будущего: ревизия → коммит, потом архивация → коммит. У меня они оказались в одном (cfe36b6) — приемлемо, в commit message обе вещи описаны.

6. **Продуктовые решения владельца — критично сохранять в memory.** Текстовый-only Concierge — это намеренное решение (тише в офисе, проще копировать), легко забыть и снова предложить TTS. Memory-файл с **Why:** и **How to apply:** — защита от рекурсивной ошибки.

7. **Координация между handoff'ами требует явных `supersededBy`** в frontmatter. Иначе будущий оркестратор может открыть оба и запутаться.

## Что НЕ сделано (осознанно)

- НЕ трогал untracked файлы, которые не входили в мою ревизию (`sba-beta-8-1-coo-dobivka`, `sba-beta-8-2-promise-keeper`, `ui-api-modernization`, аналитика 2026-05-23/24, `.claude/hooks/*`, `second-brain/06_marketing/*`). Это работа других сессий — не моя ответственность их коммитить.
- НЕ обновлял `second-brain/02_architecture/*` или `01_projects/*` — никаких изменений кода/моделей/модулей не было, только documentation work.
- НЕ запускал prod-инструкцию — в этой сессии нет ничего что нужно деплоить (ни новых seed, ни prisma, ни ENV).

## Файлы

- 60 ТЗ в plans/archive/ (54 git mv + 3 mv + 3 «modified» по факту переезда из tz).
- 7 open ТЗ в plans/tz/ (Gamification, Helpfulness, Tracker Phase 4, Mobile, kie-grsai, SPO, prompts-hardening — некоторые впервые попали в репо).
- plans/sprints/2026-05-25-handoff-full-close.md (новый, 793 строки).
- plans/sprints/2026-05-25-handoff-after-wave3-complete.md (помечен superseded).
- ~/.claude/projects/c--work-z/memory/feedback_concierge_text_only_output.md (новый).
- ~/.claude/projects/c--work-z/memory/MEMORY.md (+1 строка).
