---
type: tz
feature: freenote-null-source-no-tasks
title: "ТЗ — Чистые free-notes (sourceExternalId=null) не создают задач (block-distill не ставит specialists-combined)"
status: draft-awaiting-owner
date: 2026-07-07
owner: владелец (sergrv80@gmail.com)
trigger: "Стенд task-stand цикл 2: ingestFreeNote кладёт sourceExternalId=null → resolveSourceDescriptorForBlock=null → specialists-combined не ставится → задача не создаётся. Реальные каналы (chat 'msg:<id>', bitrix) кладут непустой externalId и работают (после фикса jobId)."
depends_on: null
---

# ТЗ — free-notes без sourceExternalId не порождают задач

## Проблема
`BlockDistillWorker.resolveSourceDescriptorForBlock` возвращает `null`, если у RawEvent пустой
`sourceExternalId` → ветка enqueue specialists-combined пропускается → блок не превращается в задачу.
`ConversationalIngestAdapter.ingestFreeNote` по умолчанию кладёт `sourceExternalId: null`. Значит **любая
«свободная заметка» без явного externalId никогда не станет задачей**, хотя блок `action_item` извлекается.
Реальные каналы (chat=`msg:<id>`, bitrix=`sessionId`) кладут непустой → у них работает (после фикса jobId `:`).

## Вопрос владельцу (продуктовое решение)
Должны ли **чистые внутренние заметки** («надо сделать X») авто-порождать задачу-кандидат? Варианты:
1. **Да, всегда** — тогда `resolveSourceDescriptorForBlock` при пустом sourceExternalId фолбэчит на
   `externalId = rawEventId` (уникально), а combined-воркер `specialists-combined.worker.ts:111` учит искать
   блоки и по rawEventId (сейчас строго `sourceExternalId: externalId`). Правка в 2 точках + тест.
2. **Нет** — оставить как есть (заметки не создают задач без явного канала); задокументировать намеренно.
3. **Только при явном маркере** (заметка помечена как задача) — доп. сигнал.

## Границы
- Не трогать рабочие каналы (chat/telegram/email/bitrix/meeting) — у них непустой externalId.
- R13: только кандидат + подтверждение, без авто-создания «на всё подряд» (иначе болтовня → задачи).

## Итог
Не реализовано — ждёт решения владельца (вариант 1/2/3). Диагностика и точки правки зафиксированы выше.
