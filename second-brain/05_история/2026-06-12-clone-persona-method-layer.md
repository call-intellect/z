---
type: reflection
date: 2026-06-12
feature: clone-persona-method-layer
---

# Рефлексия — слой метода клона (clone-persona-method-layer), 8/8 фаз

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-06-11-clone-persona-method-layer.md` через tz-orchestrator: достроить клону Коры наблюдаемый МЕТОД работы — ценности из проявленного поведения (revealed preferences), принципы решений (Reflection-слой по Park 2023), методологию «ситуация→ход» (активация PracticeSkill = RPD), CDM-интервью носителя — и собрать всё в persona-compile v2 с валидацией по поведению. Главный инвариант: правила процесса с якорями, не ярлыки (Personality Illusion).

## Как решал

Оркестрация в отдельном git worktree `C:/work/z-clone-method` (ветка `feature/clone-persona-method-layer`), параллельные сессии работали в своих worktree. Старт — массовая картография: Workflow с 9 параллельными Explore-агентами по зонам (clones / prisma / специалист 3.7 / кроны+embeddings / PracticeSkill / persona / probe+ingest / LLM-инфра / анализ-вход), отчёты в temp-файлы, кодеры читали их сами. Затем 8 фаз строго последовательно, каждая — суб-агент-кодер с самодостаточным промптом (дословные сниппеты + path:line из картографии), независимая приёмка (греп маркеров → re-Read → свой typecheck/lint/build/vitest) и коммит явными путями.

| Фаза | Коммит |
|---|---|
| Э1.1 миграция (RolePrinciple + SkillTrait.layer + CloneQueryLog) | `6e8b470f` |
| Э0.1 clone-respond v2 (grounding-гейт + журнал + endpoint) | `0507a87a` |
| Э1.2 Reflection-cron (role-principle-synthesize) | `91d552a5` |
| Э1.3 детектор value/motivation (revealed preferences) | `f12eedba` |
| Э2.1 активация PracticeSkill + process-marker-detect | `f4bfa927` |
| Э3.1 CDM-интервью через probe + класс-фикс notification_response | `8fbb816d` |
| ИНТ.1 persona-compile v2 (5 секций) — KEYSTONE | `bae186a6` |
| ВАЛ.1 валидация по поведению (judge + A/B v1 vs v2) | `41289726` |
| docs (second-brain + prod-deploy-log + vNext) | `4fa5431f` |

Принятые мной решения (в рамках ТЗ): одна миграция включила и CloneQueryLog (Э0.1 без таблицы не собрать); Reflection-cron — по образцу practice-skill-evaluate (Redis-lock + прямые LLM-вызовы), без новой BullMQ-очереди; детекторы value/process-marker — вторым/третьим проходом внутри существующего `rebuildProfile` 3.7 с layer-фильтром в KNN-merge (не плодить воркеры); CDM-вопрос генерируется заранее (`cdm-case-interview`) и НЕ переформулируется probe-formulate (сохранение методики).

## Что вышло (верификация)

- Полная регрессия unit-тестов backend: **606 файлов, 4746 passed, 0 failed**.
- typecheck (вкл. .spec) / lint (0 errors) / build — зелёные после каждой фазы и в финале.
- ~50 новых тестов по фазам (grounding-гейт, дедуп принципов, layer-фильтр merge, CDM-лимиты, секции persona v2, judge без побочных записей) + 6 snapshot-спеков новых промптов.
- Найдены и закрыты на ревью два реальных бага ДО коммита: (1) ungrounded-гейт давал бы ложный отказ на каждый judgmental-ответ (его SYSTEM запрещает цитаты в тексте) — гейт ограничен factual; (2) ответы на probe уходили в LLM-извлечение как JSON.stringify-шум (нет ветки в SegmentBuilder) — починен весь класс, не только CDM.

## Чему научился

1. **Картография одним Workflow-фан-аутом + temp-отчёты для кодеров** — кодеры получают дословные сниппеты и не тратят контекст на поиск; 8 фаз прошли без единого «агент не нашёл файл».
2. **TaskStop теряет журнал result'ов Workflow** — после остановки агенты первой волны продолжали писать в journal.jsonl, а resume перезапустил их заново; забирать результаты надёжнее напрямую из journal, а не через notification/писарей.
3. **Vitest на Windows переписывает CRLF→LF в чужих `.snap`** — после каждого прогона `git checkout --` непричастных снапшотов, иначе коммит зацепит шум.
4. **Грабля judgmental-режима**: пост-обработка, завязанная на цитаты в тексте, обязана учитывать режимы, где SYSTEM сам запрещает цитаты. Проверять контракт промпта перед программным гейтом на его выход.
5. **Фоновые Bash-задачи обрезают вывод** — exit-код через `echo EXIT=$?` в той же команде и полный вывод в файл с последующим чтением, иначе «зелёный» прогон недоказуем.
