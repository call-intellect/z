---
type: tz
status: blocked-on-owner
feature: probe-auto-drafts
date: 2026-06-12
relates_to:
  - plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md
---

# ТЗ-заглушка · W2-Ф2.4 — авто-черновики HYBRID и AUTO для skill/knowledge probe

> Вынесено из W2 autonomy (2026-06-12): фаза требует новых LLM-промптов, а ТЗ-родитель зарезервировал «тексты промптов дошлифовываем отдельным шагом вместе» за владельцем. Реализовано в W2 без этого пункта: гейт ценности, NUDGE→дайджест, OwnerResolver, cold-start.

## Что отложено (из Ф2.4 родительского ТЗ)

1. **Авто-черновик для HYBRID:** `regulation.process_no_steps`, `experiment.result_without_lesson` → LLM набрасывает черновик (шаги процесса / урок эксперимента) из контекста графа + post-hoc «проверьте», не блокируя. Нужны: 2 новых LLM taskType + промпты (шаг «улучшаем промпты») + безопасная запись черновика (definitionJson шагов — рискованная зона, см. решение W2 «JSON авто не пишем»).
2. **AUTO вместо probe:** `knowledge.new_expertise_detected`, `skill.profile_starved`, `skill.contradicting_traits` → тихо записать/прогнать judge, probe убрать. Зависит от семантики специалистов 3-2/3-7 и качества judge.

## Блокер

Шаг «улучшаем промпты» с владельцем (родительское ТЗ, преамбула «Прагматика»). Запуск — по явному «погнали Ф2.4».

## Фазы (после разблокировки)

- [ ] Ф-А: черновик урока эксперимента (запись в прямое поле — безопасно)
- [ ] Ф-Б: черновик шагов процесса (через CurationItem/предложение, НЕ прямая запись definitionJson)
- [ ] Ф-В: AUTO skill/knowledge (judge-гейт + метрика доли тихих записей)
