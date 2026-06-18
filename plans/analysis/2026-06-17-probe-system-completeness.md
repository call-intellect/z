---
type: analysis
status: research-complete
feature: probe-system-completeness
date: 2026-06-17
snapshot_date: 2026-06-17
owner: sergrv80 (владелец Z)
relates_to:
  - plans/tz/2026-06-17-probe-system-phase2-completeness.md
  - plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md
  - plans/tz/2026-06-11-probe-system-upgrade-phase1.md
  - plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md
  - second-brain/03_processes/probe-question-flow.md
  - second-brain/01_projects/probe-agent.md
---

# Уточняющие вопросы Коры — как, когда и на основании чего формируются (и что доделать)

> Цель документа — ответить на запрос владельца: «надо разобраться плотнее, как формируется,
> на основании чего и когда формируется этот вопрос», и из этого вывести scope ТЗ на доведение
> probe-системы до полноценного состояния. Решение «искать ответ в графе перед вопросом»
> (answer-first) **исключено по прямому указанию владельца**: вопрос задаётся именно потому,
> что граф чего-то не знает (прошла встреча/пришли данные/поставлена задача) или не знает,
> к чему привязать; ответ человека должен ДОСТРАИВАТЬ граф, а не подтверждать уже известное.

## 1. Как сейчас устроен конвейер (факт по коду)

Два агента, не путать:
- **Привратник `ProbeService`** (`backend/src/modules/probe/probe.service.ts`) — детерминированная логика:
  topic-cooldown → dedup по content-hash (Redis) → rate-limit per-user (+ adaptive fatigue) →
  cold-start (routed_to_digest) → гейт ценности по priority (`dropped_low_value`) →
  NUDGE-реклассификация (routed_to_digest) → `ProbeEvent(status='pending')` + enqueue.
- **Формулировщик** `ProbeDispatcherWorker` (`probe-dispatcher.worker.ts`) — на каждый event:
  re-check rate-limit → гейт немедленного пуша по priority (иначе `queued_digest`) →
  выбор получателя `candidates[0]` → recheck повода (`suppressed_stale`) →
  LLM `probe-formulate` (`knowledge-core/prompts/probe-formulate.prompt.ts`) → отправка
  `ConversationalService.sendNotification(eventType='probe.question')`.
- **Закрытие петли** `ProbeResponseHandler` (`probe-response.handler.ts`): ответ → классификатор
  `probe-response-classify` → `RawEvent(kind='notification_response')` обратно в граф → ack
  «ваш ответ записан».

Полная карта шагов и метрик — `second-brain/03_processes/probe-question-flow.md`.

## 2. На основании чего и когда формируется вопрос (каталог источников)

Probe рождается в специалистах Слоя 3 вызовом `probeService.suggest({ reason, payload, recipientCandidates, priorityHint })`.
Два класса триггеров:

**Класс A — ingest (новые знания, прошла встреча/пришли данные):** повод вычисляется сразу после
разбора нового IdeaBlock / создания карточки. Это и есть «уточнение входящих знаний» по словам владельца.

**Класс B — cron (по уже существующим карточкам):** периодический проход ищет протухшее/просроченное/застрявшее.

| Специалист (файл) | reason | Когда (условие в коде) | Класс |
|---|---|---|---|
| 3-1 regulations | `regulation.missing_owner` · `regulation.process_no_steps` · `regulation.stale` · `regulation.scope_unclear` | регламент/процесс/политика без владельца/шагов/области, или устарел при свежем источнике | A |
| 3-1 process-template | `process_template.missing_input_artifact` · `…missing_output_artifact` · `…step_without_owner` | шаг процесса без вход/выход-артефакта или без ответственного | A |
| 3-2 knowledge-clone | `knowledge.new_expertise_detected` · `knowledge.contradiction_detected` | у роли всплыла новая экспертиза / противоречие в профиле | A |
| 3-3 decisions | `decision.missing_decider` · `decision.no_deadline_critical` · `decision.competing_versions` | решение одобрено без ответственного/срока, или дубли-версии | A |
| 3-3 decisions | `decision.overdue` · `decision.outcome_unknown` | просрочено / реализовано >3 мес без итога | B (cron 05:00) |
| 3-4 project/customer | `card.missing_owner` · `card.missing_deadline` · `card.merge_suggestion` · `card.outdated_summary` | карточка клиента/проекта без владельца/срока, дубли, протухла | A |
| 3-5 insights | `insight.escalation_suggested` · `insight.linked_decision_question` · `insight.recurring_after_mitigation` | сигнал требует внимания / связать с решением / всплыл после устранения | A |
| 3-5 insights | `insight.no_mitigation_plan` | high/critical без плана >7 дн | B (cron) |
| 3-6 ideas | `idea.support_request` · `idea.status_unclear` | новая идея ищет поддержку / висит >14 дн | A + B |
| 3-7 skill | `skill.profile_starved` · `skill.contradicting_traits` · `skill.cdm_interview` | мало reasoning-кейсов / противоречие трейтов / CDM-интервью носителя | A |
| 3-8 helpfulness | `helpfulness.*` (4) | новый эксперт / непризнанный вклад / ментор / цепочка без ответа | B (cron 10:00) |
| 3-9 experiments | `experiment.no_owner` · `experiment.running_too_long` · `experiment.result_without_lesson` | эксперимент без владельца/слишком долго/без урока | A + B |
| 3-9 promise-keeper | `commitment.followup` · `commitment.silence_escalation` | обещание просрочено / молчание после followup | B (cron) |
| goals-checkpoint | `goal.kr_checkpoint_suggested` | гипотеза отгружена и привязана к цели | event |
| temporal | `temporal.fact_stale_contradiction` (+ `.escalated`) | древний факт противоречит свежему | B (cron) |

Полный разбор условий и payload — в приложении А этого файла (ниже §7).

## 3. Что УЖЕ доведено (Фаза 1 + W0/W2 autonomy, 2026-06-12) — НЕ трогать

REALITY-CHECK по коду (расходится со старым описанием в second-brain, приоритет — код):

- ✅ Формулировка `probe-formulate` переписана: персона + few-shot + self-check, без машинных кодов,
  человеческий `reasonLabel`, cache-friendly. Без вариантов ответа (свободный текст/голос).
- ✅ Гейт ценности по priority: `dropped_low_value` (`probe.minValuePriority`, дефолт 30).
- ✅ Cold-start реально включён (`isColdStart` возвращает живой результат) → `routed_to_digest`.
- ✅ Recheck повода перед dispatch → `suppressed_stale` (повод закрылся сам).
- ✅ NUDGE-реклассификация → ежедневный дайджест; батч-дайджест отложенных (`queued_digest`).
- ✅ Adaptive fatigue (режет бюджет нереспондентам) + topic cooldown 48ч.
- ✅ Классификатор свободного ответа `probe-response-classify` + closing-loop + ack «ответ записан».
- ✅ Крутилки в AdminSetting (digest*, topicCooldownHours, adaptiveFatigueEnabled, minValuePriority, immediatePushMinPriority).

Старое «Фаза 2/3 ждут калибровочных данных» — **снято владельцем**: статистику не ждём, делаем сразу.

## 4. Что реально осталось (gap-таблица → scope ТЗ)

| # | Пробел | Факт по коду | Решение (в ТЗ) |
|---|---|---|---|
| G1 | Свободный ответ без Telegram-reply (и весь MAX) теряется | `tryMatchReplyToProbe` (`telegram-bot.adapter.ts:1230`) матчит только по `reply_to_message`; MAX вообще без reply; иначе → `free_note`/`assistant_turn` | Расширить входной классификатор `dialog-classify`: интент `probe_reply` с контекстом открытых probe пользователя (Q2 владельца) |
| G2 | Получатель = `candidates[0]` | `probe-dispatcher.worker.ts:202` хардкод; engagement-снимок есть (`probeEngagementRedisKey`), но в выбор не подключён | Engagement-weighted выбор получателя |
| G3 | Метрика канала фиктивна | `incProbeDispatched({ kind: 'in_app' })` хардкод (`worker.ts:291`) | Реальный `kind` после доставки (по `NotificationDelivery.channelBinding.channel.kind`) |
| G4 | Нет переспроса | при `expired` просто закрываем (cron) | 1 re-ask, переформулировав, со ссылкой на прошлый вопрос (Q3 владельца) |
| G5 | Дедуп только по точному content-hash | `computeContentHash` = sha256(reason+ids+message); переформулированный дубль проходит | Семантический дедуп по эмбеддингу вопроса (pgvector) против недавних probe |
| G6 | Качество формулировки не проверяется машинно | в `probe-formulate` есть self-check внутри SYSTEM, но нет внешнего гейта; плохой вопрос уходит как есть | LLM-судья качества вопроса: пустой/расплывчатый/с кодом/двойной → один регенерат |
| G7 | Нет повода «новые данные не удалось привязать к отделу/клиенту/сущности» | атрибуционные поводы есть для owner/merge/link, но generic-attribution при ингесте отсутствует | Новый ingest-повод атрибуции (узко, см. ТЗ Ф6) |
| — | Память тона получателя | отсутствует | **vNext** (решение владельца Q4) |
| — | answer-first поиск в графе | отсутствует | **Исключено** (решение владельца Q1) |

## 5. Доказательство ключевых решений (два прохода, кратко)

**G1 — привязка свободного ответа. Проход A:** Redis-окно «последний открытый probe userId» + время.
**Проход B:** расширить существующий LLM-классификатор `dialog-classify` интентом `probe_reply`,
подавая ему контекст открытых probe пользователя. **Выбор B** (указание владельца «классификатор на входе
должен это понимать»): один мозг понимания запроса, нет второй эвристики; ось различия — точка интеграции
(новый интент в существующем LLM vs отдельный Redis-механизм). Окно времени остаётся как дешёвый
pre-фильтр кандидатов перед LLM (не как решающий механизм).

**G6 — судья качества. Проход A:** усилить self-check внутри `probe-formulate` (одна LLM-итерация).
**Проход B:** отдельный дешёвый judge-tasktype, который оценивает уже сформулированный вопрос и при
браке запускает один регенерат. **Выбор B** — отделяет генерацию от приёмки (разные провайдеры/кэш),
не раздувает SYSTEM генератора (cache-friendly), даёт метрику качества. Дёшево: `deepseek-v4-flash`.

**G2 — выбор получателя.** Снимок engagement уже пишет `ProbePriorityCron` в Redis
(`probeEngagementRedisKey`). Переиспользуем его: вес = engagement_rate, tie-break — детерминированный
(сортировка userId), чтобы не зависеть от `Math.random()` (запрещён в воркфлоу/скриптах, и здесь не нужен).

## 6. Совместимость с prompt caching (инвариант LLM)

- `probe-formulate` уже cache-friendly — НЕ трогаем SYSTEM (переменные в конце USER).
- Новый judge (`probe-quality-judge`) и расширение `dialog-classify`: стабильный SYSTEM (правила+few-shot),
  переменные (вопрос/ответ/контекст открытых probe) — в конце USER. Провайдер дешёвый `deepseek-v4-flash`.

## 7. Приложение А — условия и payload по источникам

(Свод из картографии кода; используется как справочник при реализации Ф6 и при ревью формулировок.)
Стандартный payload `suggest`: `{ message, suggestedQuestion?, suggestedActions?, contextCardId?,
contextCardKind?, contextCardTitle?, contextBlockId?, contextIds?, actionUrl?, dataClass? }`.
Получатели выбираются специалистом: участники встречи-источника (decisions.missing_decider),
владелец/админы, глава отдела (`Person.primaryDepartmentId → Department.headPersonId`), сам субъект
(skill.cdm_interview). Лестница владельца (W2 OwnerResolver) уже резолвит однозначного владельца
автоматически, а при неоднозначности шлёт probe-выбор с именами.

> Вывод: система зрелая; «доведение до полноценного» = 7 точечных доработок (G1–G7), а не переписывание.
> Главная по приоритету владельца — G1 (ответы реально доходят) и G6 (формулировки полноценные/точные).
