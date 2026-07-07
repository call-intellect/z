---
type: analysis
feature: probe-noise-prod-reality
date: 2026-07-06
source: прод-БД korateam.ru (read-only SSH, probe_events за 7 дней)
supersedes: docs/testing/probe-stand-report.md (стенд-baseline не отражал прод)
---

# Реальный шум уточняющих вопросов Коры — прод за 7 дней (не стенд)

Снято прямым read-only запросом к прод-БД (`probe_events`, окно 7 дней). `n` — создано, `dispatched` — реально ушло пользователю push-ом (остальное — в дайджест «Кора собрала N вопросов» или отброшено политикой).

| reason | инспектор | n | dispatched | комментарий |
|---|---|---:|---:|---|
| consistency_violation.R3 | consistency_checker | **199** | 0 | шаг процесса без ответственного |
| consistency_violation.R2 | consistency_checker | **141** | 0 | шаг без результата (выхода) |
| consistency_violation.R1 | consistency_checker | **118** | 12 | документ без процесса |
| attribution.unresolved_at_ingest | ingest-attribution | **91** | 10 | «к чему отнести X» |
| consistency_violation.R6 | consistency_checker | 40 | 19 | профиль: миссия/видение/стратегия |
| experiment.no_owner | 3-9-experiments | 29 | 5 | эксперимент без владельца |
| task.assignee_unresolved (sweep) | specialist-3-15 | 26 | 11 | ← моя итерация 1 целила сюда |
| **insight.no_mitigation_plan** | 3-5-insights | 21 | **20** | «сигнал без плана реагирования» — доходит! |
| companyprofile.missing_mission | company-profile | 17 | 14 | доходит |
| companyprofile.missing_strategy | company-profile | 17 | 14 | доходит |
| companyprofile.missing_vision | company-profile | 16 | 13 | доходит |
| **commitment.followup** | 3-9-promise-keeper | 11 | **10** | «просроченное обещание» — доходит! |
| strategic_misalignment_high | goals | 5 | 4 | |
| knowledge.new_expertise_detected | 3-2-knowledge-clone | 4 | 2 | |
| task.due_date_missing | specialist-3-15 | 2 | 2 | |
| task.assignee_unresolved (ingest) | specialist-3-15 | 2 | 2 | |
| process_template.missing_input_artifact | 3-1-process-detector | 1 | 0 | |
| process_template.step_without_owner | 3-1-process-detector | 1 | 0 | |
| process_template.missing_output_artifact | 3-1-process-detector | 1 | 0 | |

**Итого ~660 событий/неделя.**

## Выводы

1. **#1 источник шума с колоссальным отрывом — `consistency-checker` (инспектор порядка): R1+R2+R3+R6 = 498 событий.** Это ровно «странные вопросы про шаги» из жалобы владельца: у шага нет ответственного (R3=199), нет результата (R2=141), документ без процесса (R1=118). Хоть R3/R2 и `dispatched=0` — они **набивают дайджест** «Кора собрала N вопросов», который владелец и видит.
2. **Задачи — мелочь.** `task.*` ≈ 30 событий (моя итерация 1). Она корректна, но это НЕ фронт. Стенд ввёл в заблуждение: в синтетической Стреле task-вопросы доминировали, в проде — почти нет.
3. **Стенд низкой верности к проду:** в 18 типах стенда НЕ БЫЛО `insight.no_mitigation_plan` и `commitment.followup` — а они реально доходят до людей (20 и 10 push-ей). Это те самые «обещание» и «сигнал без плана» из вырезки владельца. Стенд надо пополнить реальными типами.
4. **attribution.unresolved_at_ingest = 91** — второй по объёму, судья ранее пометил automate (P2/P4).

## Приоритет переработки (по реальному весу)

1. **Инспектор порядка (consistency-checker R1/R2/R3)** → из пулемёта вопросов в **одну аналитическую сводку зрелости процессов/данных** (P8). Это ровно черновой блюпринт `plans/architecture/2026-07-03-consistency-checker-probe-noise.md`.
2. **companyprofile.missing_* + R6** (дубль про миссию/видение/стратегию) → индикатор полноты профиля, не push (drop, P8/P6).
3. **attribution.unresolved_at_ingest** → авто-атрибуция + индикатор (automate, P2).
4. **Новые типы на суд владельца:** `insight.no_mitigation_plan`, `commitment.followup` — валидны как вопросы или тоже в анализ? Их нет в поле правильности — решает владелец.
5. task.* / experiment.no_owner — уже закрыты/мелкие.
