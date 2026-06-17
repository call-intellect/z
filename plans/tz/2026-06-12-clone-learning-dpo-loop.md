---
type: tz
status: draft-stub
feature: clone-learning-dpo-loop
date: 2026-06-12
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/archive/2026-06-11-clone-persona-method-layer.md
  - plans/analysis/2026-06-11-clone-depth-and-persona-method.md
---

# ТЗ-заглушка (vNext) — Обучающий мост фидбека клона → DPO/LoRA + заполнение SkillUsage.outcome/editDistance

> **Статус: draft-stub.** Это НЕ готовое ТЗ — vNext-заглушка из анти-scope основного ТЗ
> [`2026-06-11-clone-persona-method-layer.md`](2026-06-11-clone-persona-method-layer.md) (§«Не входит»).
> До явного «начни» владельца — не реализовывать.

## Что это

Замкнуть петлю обучения клона на реальном фидбеке:

1. **Сбор фидбека на ответы клона** — пользовательский сигнал («полезно / неверно / поправил так») на ответах
   `clone-respond` (UI + Telegram), привязанный к записи `CloneQueryLog`.
2. **Заполнение `SkillUsage.outcome` / `editDistance`** — известный разрыв: композитный evaluator `PracticeSkill`
   спроектирован на три компоненты (editDistance + outcome + adversarial), но `outcome`/`editDistance` сегодня
   НИКТО не пишет — петля фактически работает только на adversarial-компоненте (разрыв описан в практике
   PracticeSkill). Нужен производитель сигнала: исход применения процедуры + дистанция правки человеком.
3. **Мост в DPO/LoRA** — пары «черновик клона → правка человека» (по образцу `SupportDraftOutcome`
   и `preference-dataset.service.ts`) → preference-датасет → офлайн-дообучение тонального/методного адаптера.

## Почему отложено

- Обучающий фреймворк (DPO/LoRA) — не в прод-пути Z (Bun+TS); офлайн-контур требует отдельного решения.
- Сначала нужен ДАТАСЕТ: фидбек на ответы клона пока не собирается — без него мост учить не на чем.
- Самообучение — строго без human-approval-гейта (только kill-switch), но качество-гейт против
  само-отравления (по образцу support-контура) надо спроектировать отдельно.

## Что нужно для старта

- [ ] Накопленный `CloneQueryLog` (выкат основного ТЗ) — оценить трафик вопросов к клонам.
- [ ] Решение владельца по месту фидбека в UI (кнопки «полезно/неверно» в чате клона — CRUD-кнопки разрешены).
- [ ] Дизайн производителя `SkillUsage.outcome`/`editDistance` (когда процедура «применена» и кем меряется правка).
- [ ] Выбор офлайн-инфраструктуры дообучения (вне `backend/`, см. CLAUDE.md §7 — без Python в прод-пути).

## Каркас будущих фаз (черновой)

- Ф1 — фидбек на ответы клона (UI/Telegram) + привязка к `CloneQueryLog`.
- Ф2 — запись `SkillUsage.outcome`/`editDistance` → evaluator работает всеми тремя компонентами.
- Ф3 — preference-датасет пар (reuse `preference-dataset.service.ts`) + гейт качества против само-отравления.
- Ф4 — DPO/LoRA-адаптер (офлайн) + A/B через `PersonaLayerValidationCron`.
