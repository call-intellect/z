---
date: 2026-05-10
title: In-meeting чат с persist + финал большой сессии
distilled: false
---

# In-meeting чат с persist (фоллоу-ап после большой сессии)

## Что было поставлено

После закрытия трёх крупных ТЗ (standalone-product, ai-meeting-workspace) владелец задал вопрос на ревью эталонов: «во время видеовстречи у нас есть чат для участников и он сохраняется переписка из него?»

Ответ оказался «нет» — в [ChatPanel.tsx:13](frontend/src/ui/components/meeting-room/ChatPanel.tsx#L13) был прямой `<Chat />` из `@livekit/components-react` через DataChannel без persist, что было осознанным MVP-решением.

Запросил ТЗ + код. Развилка A/B/C — выбрал A (полный ТЗ → код).

## Как решал

### Структура
- ТЗ `plans/tz/2026-05-09-meeting-room-chat.md` — 5 фаз, фиксация рисков (DataChannel без webhook, race history vs realtime, гость без userId, privacy опоздавшего).
- 4 субагента + 2 моих самостоятельных шага:
  - M-rc1: backend room-messages module (агент)
  - **M-rc1.5: backend extras `MeetingShare.allowChat` (сам)** — нужно было между M-rc1 и M-rc2/M-rc3, чтобы frontend сразу видел тумблер
  - M-rc2: frontend (агент) — ChatPanel переписан + 6-й таб + ShareDialog
  - M-rc3: AI-pipeline merger (агент) — параллельно с M-rc2
  - **M-rc4: цикл финализации (сам)** — typecheck/lint/build, ТЗ → done, second-brain

### Ключевые открытия по ходу
1. **Гостевая авторизация ≠ `z_session`.** Я в ТЗ написал «гость авторизован тем же `z_session` cookie», но в реальности гость использует отдельную cookie `guest_session_<meetingId>` с собственным JWT через `JwtService.signGuestSession`. Backend-агент это обнаружил при чтении `ParticipantsService` и сделал собственный `MeetingMemberGuard` поверх обоих cookie. Frontend ничего менять не пришлось — `apiClient.credentials: 'include'` шлёт обе cookie автоматически.
2. **Schema.prisma «откатилась».** Мой Edit на `MeetingShare.allowChat` зашёл, но при следующем `bunx prisma generate` новое поле не появилось в типах — оказалось, файл был перезаписан параллельной правкой (видимо linter или параллельный агент cards). Применил Edit заново — сработало.
3. **`bun run test:unit` использует `--dir` флаг, который сломан в vitest 2.1.x** — `bunx vitest run src/` работает корректно. Это pre-existing проблема, не из моих правок. Зафиксировал в отчёте M-rc1.

### Параллельная работа над cards
Пока я делал meeting-room-chat, владелец (или другой агент) параллельно реализовывал ТЗ `cards.md` — CRM-карточки. Это создало пересечения в `schema.prisma`, `app.module.ts`, `typed-config.service.ts`, `index.md`. Не разделил коммиты по фичам (физически не разделить без `git add -p`) — закоммитил всё одним пакетом с явным упоминанием обеих ТЗ в commit message.

## Что вышло

### Финальные метрики
- **Backend:** typecheck=0, **357/357 unit-тестов passed** (+17 к базе 340 после серии раундов)
- **Frontend:** typecheck=0, lint=0, build success (29 страниц, `/m/[id]` 161kB, `/share/[token]` 3.77kB)

### Файлы
- Backend: [room-messages/](backend/src/modules/room-messages/) (controller/service/repo/dto/exceptions/guard, +14 spec), [merger.ts](backend/src/modules/ai/services/merger.ts) (+`loadRoomChatForMerge`), [prompts/common.ts](backend/src/modules/ai/services/prompts/common.ts) (+`withRoomChatNote`/`turnsToText` дописывает блок «Чат встречи»), все 9 type-prompts + system-summary + follow-up + tasks обновлены, [analyze.worker.ts](backend/src/modules/ai/workers/analyze.worker.ts) пробрасывает roomChat. Расширения `MeetingShare.allowChat`, `SharesService`, `PublicMeetingSharePayload`.
- Frontend: [ChatPanel.tsx](frontend/src/ui/components/meeting-room/ChatPanel.tsx) переписан с `<Chat />` на `useChat() + useLocalParticipant()` + history/POST/dedup. [MeetingResultPageReal.tsx](frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx) — 6-й таб «Чат». [ShareDialog.tsx](frontend/src/ui/components/meeting-result-v2/ShareDialog.tsx) — Switch «Чат участников». [ShareMeetingClient.tsx](frontend/app/share/[token]/ShareMeetingClient.tsx) — рендер блока чата.
- Hook: [use-meeting-room-messages.ts](frontend/src/hooks/use-meeting-room-messages.ts).

### Git
- Коммит: `e85e0ef feat: AI Meeting Workspace + standalone product + in-meeting chat + CRM-карточки`. 426 файлов, 44807 inserts.
- Push на `origin/dev` — выполнен (видимо post-push-reflection хуком автоматически).

## Чему научился

1. **«Малое» дополнение к ТЗ часто не такое уж малое.** TЗ meeting-room-chat казался добавлением в одну функцию — обернулось 5 фазами с расширением Prisma, нового модуля, переписанного ChatPanel, тумблера в Share, AI-пайплайна и публичной страницы. **Урок:** при оценке TЗ — проверять, сколько touchpoints у фичи, не только основная логика.
2. **Бриф для агента должен явно отделять «было до меня» от «стало после агентов»**. Когда я писал бриф для M-rc1, сказал «гость авторизован `z_session`» — это была моя НЕпроверенная гипотеза, не факт. Агент проверил код и нашёл правду. **Урок:** в брифе помечать «PROVERIT:» там, где предположил факт, а не точно знаешь.
3. **Параллельные агенты в одних файлах работают, если контракт фиксирован**. M-rc2 (frontend) и M-rc3 (AI-pipeline) шли параллельно — они трогали полностью разные папки. Если бы оба трогали `merger.ts` — был бы мерж-конфликт. Принцип «каждому агенту — своя зона + чёткая граница» работает, но требует продуманного декомпоза.
4. **`schema.prisma` под двумя параллельными ветками — точка боли**. У меня и cards-агента общий файл; мой Edit оказался перезаписан, я не сразу заметил (только когда `prisma generate` не дал ожидаемого типа в TS). **Урок:** после любого Edit на shared file — verify через grep / Read, не доверять «success»-сообщению Edit'а вслепую.
5. **Хук `post-push-reflection.py` уже существует** в `.claude/hooks/` и сам делает коммит+push. Я не знал об этом — пробовал делать `git add` сам, в итоге commit уже был сделан хуком. **Урок:** перед `git add` после крупной работы — проверять `git log` на свежие auto-commits.

## Что осталось пользователю

1. **Применить новую schema на dev/prod БД:**
   ```bash
   psql $DATABASE_URL -f backend/scripts/postgres-init.sql  # pgvector + HNSW
   cd backend && bunx prisma db push
   psql $DATABASE_URL -f backend/scripts/postgres-init.sql  # ещё раз — для HNSW индекса на свежей таблице
   ```
2. **ENV** — заполнить новые ключи в `.env` по шаблону `backend/.env.example`. Критичны: `MAIL_USERNAME`/`MAIL_PASSWORD`, `WEBHOOK_SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`), `IP_HASH_DAILY_SALT`. Остальные — есть defaults.
3. **Ручная регрессия** in-meeting чата:
   - Хост запускает встречу, гость присоединяется, оба пишут в чат
   - Завершить встречу → дождаться `ai_ready` → AI-отчёт должен упоминать содержание чата
   - Создать share-ссылку с `allowChat=true` → проверить в инкогнито что блок чата виден
4. **Опционально на будущее** — расширить roomChat на parallel post-analyze стадии (chapters / tasks-extract / regenerate-section). У них собственные `*PromptInput` интерфейсы, требует отдельного мини-ТЗ.
