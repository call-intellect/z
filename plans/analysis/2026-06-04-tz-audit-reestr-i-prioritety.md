# Аудит ТЗ Z — реестр статусов, противоречия и приоритеты

> Технический документ. Простым языком для владельца — рядом: [2026-06-04-tz-razbor-prostym-yazykom.md](2026-06-04-tz-razbor-prostym-yazykom.md).

**Дата:** 2026-06-04 · **Объём:** 104 ТЗ из `plans/tz/` за 2026-05-20…2026-06-03 (по запросу «с 15 мая»).
**Метод:** 170 суб-агентов. На каждое ТЗ — отдельный агент сверял обещания с РЕАЛЬНЫМ кодом (`backend/src`, `frontend/`, `schema.prisma`, `scripts`), НЕ доверяя галочкам в самом ТЗ. Кандидатов «в архив» дополнительно перепроверял состязательный скептик-агент (нашёл 37 завышенных «готово»). Итоговую раскладку свёл архитектор-агент. Решения по архиву консервативные: архивируется только подтверждённое в коде или заменённое более новым ТЗ; всё реально незакрытое вынесено в приоритеты и backlog ниже.

## Сводка цифрами

- **Готово (по коду):** 63  ·  **почти готово:** 19  ·  **частично:** 3  ·  **не начато:** 19
- **Решение:** в архив — **66** ТЗ (реализовано/заменено) · оставить активными — **38** ТЗ.
- **Завышенных «готово»** (галочка [x] стоит, но скептик нашёл дыру): **37** из проверенных. Подтверждает правило: галочкам в ТЗ доверять нельзя, проверять по коду.

---
## 🔥 Что делать первым (приоритеты)

Порядок по бизнес-важности: 🔴 горит → 🟠 важно → ⚪ терпит. S/M/L/XL — оценка трудозатрат.

**#1. 🔴 ГОРИТ · S — 2026-06-02-smart-tables-auto-creation-finishing (Фаза B: ThrottlerGuard как APP_GUARD)**  
Все @Throttle инертны — login/register/дорогие LLM-эндпоинты без защиты от брутфорса; дыра безопасности на проде, фикс ~часы.

**#2. 🔴 ГОРИТ · S — 2026-05-28-paywall-no-trial (фикс 403-кодов фронт↔бэк)**  
PaywallModal не открывается на реальные subscription_demo/expired — прямая потеря конверсии demo→paid (деньги).

**#3. 🔴 ГОРИТ · M — 2026-06-03-action-center-remaining + 2026-06-02-action-center-pending-confirmations (мерж ветки feature/action-center-trust-ladder в dev + prisma db push)**  
Готовая работа (часть B + весь C-блок) застряла на невлитой ветке, БД-схема не применена — фича невыпускаема, риск конфликтов накапливается.

**#4. 🟠 важно · S — 2026-05-29-commercial-reliability-package (call-site'ы billing-метрик + оживить алёрт webhook-sig-failures)**  
Критический алёрт мошенничества по webhook'ам мёртв, billing-панели Grafana пустые — деньги без наблюдаемости.

**#5. 🟠 важно · S — 2026-05-27-tracker-boards (смонтировать ProjectBoardsSidebar в ProjectViewShell)**  
Центральный UX фичи мёртв: пользователь не может переключаться между несколькими досками, новые board-маршруты orphan; backend готов, нужен только монтаж UI.

**#6. 🟠 важно · M — Клоны: фикс доступа /admin/clones для owner/admin Org + Фаза 6 chat-v2 clone_style (role-scope) — 2026-05-26-clones-marketplace-frontend, 2026-05-25-clones-role-based-rebrand**  
Единственный UI выдачи грантов заблокирован для целевой аудитории (super_admin-only); chat-v2 всё ещё отвечает от лица человека, не роли — ядро Clones=Roles не доведено.

**#7. 🟠 важно · M — 2026-05-25-admin-redesign-tz (домигрировать knowledge-core пороги на getDynamic, флагман THEME_COSINE_THRESHOLD)**  
Флагманский DoD провален: настройки из админки не доходят до воркеров (theme-clusterer читает статику) — обещанные 'крутилки' не работают, нарушает правило admin_settings_not_env_or_code.

**#8. 🟠 важно · L — 2026-06-02-main-screen-umbrella-tails-finalization (9 хвостов, в т.ч. probe-фильтр эталона demo, people-at-risk endpoint, listMembers demo_observer-фильтр, switchOrg stub)**  
Несколько утечек/заглушек в проде: эталон-демо жжёт LLM на probe (деньги), demo_observer виден в списках, switchOrg — stub; объединяет хвосты pulse-full и demo-shared-org.

**#9. 🟠 важно · S — 2026-06-03-meeting-recording-reliability (боевой тест 3уч+reconnect, включить RECORDING_FASTSTART после ffprobe)**  
Прод-надёжность ядра продукта (запись = источник графа); код готов, нужна боевая верификация + включение faststart-флага.

**#10. 🟠 важно · S — 2026-05-26-telegram-via-crossmark-proxy + 2026-05-27-billing-tochka prod-выкат (операторские шаги)**  
Код готов, но транспорт Telegram и боевой биллинг Точки не активированы на проде (регистрация аккаунта, ключи, patch-скрипт, канарейка 1₽) — блокер коммерческого запуска.

**#11. 🟠 важно · S — 2026-05-25-minimax-cache-control-on-user**  
Дешёвый кэш user-сообщений (>3000 символов) на MiniMax/Anthropic-формате — экономия LLM-расходов, фикс точечный (cacheControl в dispatch+fallback).

**#12. 🟠 важно · S — 2026-05-23-tracker-phase-4-rf-musthave (безопасность email-to-task: allowedEmails-доверие + спам-фильтр)**  
Открытый ящик приёма задач без дифференциации доверия и без анти-спама — вектор для мусора/инъекций в трекер.

**#13. ⚪ терпит · S — 2026-05-23-specialist-3-8-helpfulness-agent (реализовать 7 Prometheus-метрик helpfulness_*, помечены [x] но отсутствуют)**  
Метрики заявлены done, но grep=0 — закрыть честно, иначе наблюдаемость агента фиктивна.

**#14. ⚪ терпит · S — gamification v1 хвосты (смонтировать 3 виджета на дашборды + реальный опт-аут уведомлений) — 2026-05-23-gamification-and-motivation**  
Виджеты написаны но orphan, опт-аут — noop-stub; либо доделать, либо дождаться gamification-v2 (который их перепишет) — решить до старта v2.

**#15. ⚪ терпит · S — 2026-05-25-calendar-mvp хвосты (ICS-feed subscription UI + участники в edit-режиме EventForm)**  
Backend ICS готов но UI-кнопки нет (импорт в Я.Календарь/Google недостижим); правка события затирает участников — два заметных UX-дефекта.

**#16. ⚪ терпит · M — 2026-05-24-prompts-hardening (F3 prompt caching в knowledge-core/quality/chat-v2/dialog-layer + F6 tool_use)**  
Заявлено P1, но caching только в analyze.worker — упущенная экономия LLM; сверить overlap с cache-prefix (вытеснен) перед работой.

**#17. ⚪ терпит · S — 2026-05-29-unified-login (Фаза 3 ручная проверка + Фаза 4 cleanup legacy-форм/эндпоинтов)**  
Функция работает, остался cleanup deprecated accounts/login, admin-login, AdminLoginForm — техдолг, не горит.

**#18. ⚪ терпит · S — Telegram self-initiated checkins хвост (source-бейдж в operations-дашборде) — 2026-05-29-telegram-self-initiated-checkins**  
Руководитель в operations-дашборде не видит источник чек-ина (бейдж только на /me/check-ins) — мелкий UX-долг.

**#19. ⚪ терпит · XL — Крупные новые фичи (XL/L): 2026-06-02-brain-visualization-people, 2026-06-03-team-section-and-employee-access, 2026-05-31-document-ingest-universal, 2026-05-31-smart-tables (отложенные фазы)**  
Большой продуктовый объём без срочности; стартовать после закрытия burning/important долгов и стабилизации запуска.

**#20. ⚪ терпит · XL — Заморожено/блокеры команд: 2026-05-24-supervised-prompt-optimization (SPO, не поднимать), 2026-05-25-simulation-harness-tz, 2026-06-02-gepa-port-to-node, 2026-05-23-tracker-mobile-native, 2026-06-02-expert-clones-creation, 2026-05-25-calendar-external-sync, 2026-05-29-gamification-v2-soft-medium**  
Либо заморожены правилом (SPO), либо требуют отдельной команды/инфры/исследования; держать в backlog, не трогать без явной команды.

---
## 🔁 Цепочки замены (новое отменяет старое)

Где более новое ТЗ заменило старое — старое уходит в архив как «заменено». При расхождениях правее то, что новее.

- **Оставляем:** `2026-05-20-deploy-single-compose-cleanup`  ←  заменяет: `2026-05-20-docker-deploy-bun-runtime-deps-upgrade`  
  Единый корневой docker-compose (postgres+redis+migrate+gepa+backend+frontend) заменил split-compose + systemd-фронт из старого ТЗ. Старое сознательно отброшено (pivot зафиксирован в его шапке).
- **Оставляем:** `2026-06-01-logging-module`  ←  заменяет: `2026-05-25-admin-operations-log`  
  operations-log (OperationLog + 7 source-readers + /admin/logs/*) НИКОГДА не писался; вместо него реализована единая SystemLog + LoggingModule + /platform/logs/*. Код старого ТЗ не существует.
- **Оставляем:** `2026-06-01-demo-shared-org-model`  ←  заменяет: `2026-05-25-demo-mode-tz`, `2026-05-28-demo-cabinet`, `2026-05-28-demo-workspace`, `2026-05-31-demo-auto-seed-and-cleanup`  
  Финальная модель — единая эталонная shared demo-Org + роль demo_observer (read-only доступ). Per-Org isDemo-флаг, per-user копии и auto-seed/cleanup КОПИЙ архитектурно отменены (DemoSeedQueue/Worker удалены). demo-shared-org прямо указывает supersedes auto-seed.
- **Оставляем:** `2026-05-27-billing-tochka-referral-dadata-z`  ←  заменяет: `2026-05-25-billing-and-referrals-tz`, `2026-05-25-inn-lookup-tz`  
  Биллинг переработан под провайдера Точка (OAuth+webhook+recurring), реф-программа фикс 20000₽, ИНН через Точку+DaData (tochka_then_dadata) вместо Dadata+Контур. Контракты эндпоинтов и enum провайдеров эволюционировали.
- **Оставляем:** `2026-05-29-gamification-v2-soft-medium`  ←  заменяет: `2026-05-23-gamification-and-motivation`  
  v2 (Зёрна/уровни/лиги/категориальные топ-3) переопределяет анти-паттерн v1 «никаких баллов/рейтингов» на основе deep-research. v1 backend остаётся базой, но курс пересмотрен. ВНИМАНИЕ: v1 при этом сам не доделан (виджеты не смонтированы) — v2 не начат, поэтому v1 ещё держит активную работу.
- **Оставляем:** `2026-05-31-z-admin-standalone-route-group`  ←  заменяет: `2026-05-25-admin-redesign-tz`  
  Z-Admin вынесен в отдельную route-группу (admin)/admin/* со своим layout/guard. admin-redesign (двухуровневый сайдбар) реализован, но его расположение и часть scope перекрыты. ОДНАКО admin-redesign держит незакрытое ядро (ENV→DB getDynamic) — не архивировать целиком.
- **Оставляем:** `2026-05-26-clones-marketplace-frontend`  ←  заменяет: `2026-05-25-clones-role-based-rebrand`  
  Маркетплейс перенёс канонический URL клонов /roles/[id]/clone → /clones/[roleId] и ввёл доступ через CloneAccessGrant вместо RBAC-read для всех member. ОБА держат незакрытую Фазу 6 (chat-v2 clone_style person→role) — оставить активными.
- **Оставляем:** `2026-06-03-action-center-remaining`  ←  заменяет: `2026-06-02-action-center-pending-confirmations`  
  remaining-ТЗ — достройка (C1/C2/C3) поверх A/B базы; переиграл развилку Telegram one-tap-кнопок на zero-button (в приложении). НО оба не доставлены в dev — supersede не означает done.
- **Оставляем:** `2026-06-02-smart-tables-auto-creation`  ←  заменяет: `2026-05-31-smart-tables`  
  Реальная реализация пошла по auto-creation (autoprovision over graph), а не по старому 15-фазному smart-tables (канбан/gantt/realtime и т.д. отложены). Номера фаз между двумя ТЗ конфликтуют — старое нельзя мерить по auto-creation.
- **Оставляем:** `2026-06-02-gepa-port-to-node`  ←  заменяет: `2026-05-29-agents-v2-umbrella`  
  Только в части GEPA: раздел C2 зонтика (Python subprocess в backend) устарел — GEPA вынесен в контейнер z-gepa, а gepa-port ставит задачу порта на Node. agents-v2 в остальном держит активную работу.
- **Оставляем:** `2026-06-03-llm-pipeline-errors-fix`  ←  заменяет: `2026-05-25-deepseek-pro-output-format-fix`  
  pipeline-errors-fix расширил автоконвертацию json_schema→tools на ВСЕ deepseek-модели (не только Pro), т.к. прокси отдаёт 400 даже на flash. Старый ТЗ done и архивируется, новый — его расширение.
- **Оставляем:** `2026-06-01-dashboard-main-tabs-restructure`  ←  заменяет: `2026-05-30-pulse-full`  
  tabs-restructure перестроил главный экран (sticky Hero + 4 таба), заложенный pulse-full; dashboards-wow-polish отполировал. pulse-full держит долг (people-at-risk endpoint, chat-интеграция) — оба остаются активными.

---
## ⚠️ Противоречия (и как разрешить)

- **2026-05-28-paywall-no-trial  ⟷  2026-05-29-audit-fixes**  
  Суть: Рассинхрон кодов 403 фронт↔бэк: после audit-fixes guard бросает 'subscription_demo'/'subscription_expired' (subscription.guard.ts:111), но frontend interceptor (api-client.ts:178) и subscription-context слушают устаревший 'subscription_required'. PaywallModal НЕ открывается автоматически на реальные коды guard'а — пользователь не видит paywall.  
  Решение: Новее правее: обновить frontend interceptor и subscription-context на коды subscription_demo/subscription_expired (либо принимать оба). Burning — это деньги/конверсия. Привести в соответствие с реальным кодом guard.
- **2026-06-03-action-center-remaining  ⟷  2026-06-02-action-center-pending-confirmations**  
  Суть: Telegram-доставка подтверждений: pending-confirmations требует one-tap inline-кнопки ✅/🕒 через callback_query (B4); remaining + memory-правило feedback_probe_no_buttons сделали бот намеренно zero-button (inline/callback удалены), быстрое подтверждение перенесено в приложение.  
  Решение: Новее правее + memory-правило: zero-button победил. Часть B4 старого ТЗ официально переиграна. Закрыть пункт inline-кнопок как отменённый.
- **2026-05-25-admin-redesign-tz  ⟷  2026-05-25-env-to-admin-setting-call-sites-migration**  
  Суть: Флагманский DoD admin-redesign («оператор меняет THEME_COSINE_THRESHOLD через UI → воркер theme-clusterer использует новое значение») ПРОВАЛЕН: theme-clusterer.cron.ts:75 читает статический cfg.knowledgeCore.themeCosineThreshold, ни одного getDynamic. ENV→DB миграция дошла лишь до ~24% ключей (~34 из ~140).  
  Решение: Код правее (фича недоделана, не противоречие замысла). Это незакрытая работа: либо домигрировать ~40 порогов knowledge-core на getDynamic (минимум theme-clusterer как флагман), либо явно зафиксировать в ТЗ урезанный scope. Держать admin-redesign активным.
- **2026-05-29-commercial-reliability-package  ⟷  самого себя (метрики vs алёрты)**  
  Суть: 4 billing-метрики (incBillingWebhookReceived, observeBillingProviderRequest, incBillingInvoiceCreated, incBillingSubscriptionCancelled) зарегистрированы, но НЕ вызываются ни одним call-site → серии пусты, панели Grafana мёртвые, критический алёрт BillingWebhookSignatureFailures никогда не сработает (зависит от billing_webhook_received_total{status=sig_fail}).  
  Решение: Код правее: добавить call-site'ы в TochkaWebhookController/TochkaProvider/BillingService/BillingCycleCron. Important — без webhook-health-метрики деньги/мошенничество не мониторятся. Допилить, не архивировать как done.
- **2026-06-02-smart-tables-auto-creation-finishing  ⟷  реальная конфигурация ThrottlerGuard**  
  Суть: Преамбула считает точечный @Throttle(20/мин) на semantic-filter рабочим, но ThrottlerGuard НЕ зарегистрирован как APP_GUARD (app.module.ts:626-667 содержит Subscription/Entitlement/MustChangePassword/DemoObserver, но НЕ Throttler) → ВСЕ @Throttle инертны, login/register без защиты от брутфорса.  
  Решение: Код правее и это БАГ безопасности: зарегистрировать ThrottlerGuard как APP_GUARD + smoke на ложные 429. Burning.
- **2026-05-25-clones-role-based-rebrand  ⟷  2026-05-26-clones-marketplace-frontend**  
  Суть: Модель доступа /admin/clones: rebrand обещал read для всех member через RBAC; marketplace/access-grant требуют owner/admin Org. Фактический frontend кладёт страницу под (admin)/AdminAuthGuard = ТОЛЬКО super_admin платформы → owner/admin Org НЕ может открыть единственный UI выдачи грантов (backend ClonesAdminController допускает owner/admin/super_admin).  
  Решение: Новее правее (owner/admin Org). Перенести/продублировать grant-management UI под (authenticated) с OrgAdminGuard, либо сменить guard страницы. Сейчас целевая аудитория заблокирована.
- **2026-06-01-demo-shared-org-model  ⟷  probe-конвейер**  
  Суть: ТЗ требует НЕ создавать probe-event'ы для эталонной демо-Org/demo_observer (Q4, Фаза 4.6), но ProbeService.suggest, probe-dispatcher.worker и probe-эмиттеры (strategic-alignment, goal-alignment-low.cron и др.) НЕ фильтруют isReferenceDemo — паттерн применили к ProactiveWatcher, но забыли про probe-pipeline → эталон постоянно генерит probe + LLM-вызовы (стоимость+шум).  
  Решение: Код правее (gap): добавить where.isReferenceDemo=false / роль-фильтр в probe-эмиттеры и ProbeService.suggest. Это же — хвост #3 в main-screen-umbrella-tails. Объединить.
- **2026-05-23-tracker-mobile-native  ⟷  feedback_probe_no_buttons + APNs/RuStore решение**  
  Суть: mobile-ТЗ закладывает FCM-push (Android) и inline-кнопки в push/probe; продуктовые решения проекта — APNs+RuStore (не FCM) и probe без inline-кнопок (только текст/голос).  
  Решение: Новее правее: при старте RN-разработки переписать push на APNs+RuStore и убрать inline-кнопки из probe. Пока ТЗ не начат — зафиксировать правку в самом ТЗ, не реализовывать как написано.
- **2026-05-28-settings-templates-tz  ⟷  текущая навигация (Sidebar)**  
  Суть: ТЗ опирается на пункт сайдбара '/settings/templates', но слот 'Шаблоны' уже ведёт на /team-templates (шаблоны команд трекера) — другая фича. Премиса навигации устарела.  
  Решение: Новее правее: при реализации либо новый отдельный пункт навигации, либо переименование. Согласовать со settings/admin-разводкой (org-admin-cleanup) перед стартом.

---
## 🧷 Повисшие хвосты (отложенное «на потом» — не потерять)

Куски, которые осознанно оставили незакрытыми. Сгруппировано по срочности.

### 🔴 ГОРИТ
- ThrottlerGuard не зарегистрирован как APP_GUARD — все @Throttle инертны, login/register без анти-брутфорс  _(из `2026-06-02-smart-tables-auto-creation-finishing`)_
- Рассинхрон 403: frontend слушает subscription_required, guard бросает subscription_demo/subscription_expired — paywall не открывается  _(из `2026-05-28-paywall-no-trial`)_
- Часть B (модуль pending-actions, кроны, /actions, колокольчик) + весь C-блок Action Center НЕ влиты в dev (ветка feature/action-center-trust-ladder), prisma db push не применён  _(из `2026-06-03-action-center-remaining`)_

### 🟠 важно
- 4 billing-метрики/гистограмма зарегистрированы но без call-site'ов → критический алёрт BillingWebhookSignatureFailures мёртв, Grafana-панели пусты  _(из `2026-05-29-commercial-reliability-package`)_
- ProjectBoardsSidebar не смонтирован в ProjectViewShell — переключение между несколькими досками недоступно, board-маршруты orphan  _(из `2026-05-27-tracker-boards`)_
- /admin/clones доступен только super_admin (AdminAuthGuard), а owner/admin Org заблокированы от единственного UI выдачи грантов  _(из `2026-05-26-clones-marketplace-frontend`)_
- chat-v2 clone_style при scope=card отвечает от лица ЧЕЛОВЕКА, не роли — Фаза 6 Clones=Roles не мигрирована (synthesis.service.ts)  _(из `2026-05-25-clones-role-based-rebrand`)_
- ENV→DB getDynamic недоделан: theme-clusterer и ~40 порогов knowledge-core читают статический config — настройки из админки не доходят до воркеров  _(из `2026-05-25-admin-redesign-tz`)_
- Probe-конвейер не фильтрует эталонную демо-Org/demo_observer → постоянные probe-event'ы и LLM-вызовы на демо (стоимость+шум)  _(из `2026-06-01-demo-shared-org-model`)_
- GET /dashboard/people-at-risk endpoint отсутствует — PeopleAtRiskWidget всегда скрыт (виджет заявлен в приёмке)  _(из `2026-06-01-dashboard-main-tabs-restructure`)_
- switchOrg — STUB (todo: session update), preferredOrgId нет в схеме, getMe не доработан — мультиорг-переключение неполное  _(из `2026-06-02-main-screen-umbrella-tails-finalization`)_
- listMembers возвращает demo_observer без фильтра — служебная демо-роль протекает в списки участников  _(из `2026-06-02-main-screen-umbrella-tails-finalization`)_
- Безопасность email-to-task: авто-доверие по Org.allowedEmails и спам-фильтр НЕ реализованы (только per-project kill-switch + bounce-log)  _(из `2026-05-23-tracker-phase-4-rf-musthave`)_
- VOICE_WS_ENABLED — мёртвый kill-switch: gateway /ws/voice регистрируется всегда, флаг=false не отключает endpoint  _(из `2026-05-23-sba-delta-3-voice-channel-adapter`)_
- Telegram-proxy prod-выкат: регистрация на telegram.crossmark.ru, TELEGRAM_PROXY_ADMIN_* в .env, прогон patch-telegram-register-in-proxy.ts  _(из `2026-05-26-telegram-via-crossmark-proxy`)_
- Tochka prod-выкат + реальный DaData-ключ: OAuth-регистрация приложения, BILLING_PROVIDER=tochka, канарейка 1₽, INN_LOOKUP_PROVIDER=tochka_then_dadata  _(из `2026-05-27-billing-tochka-referral-dadata-z`)_
- minimax-cache-control на user-сообщение (>3000 символов) — не сделан, упущенная экономия LLM  _(из `2026-05-25-minimax-cache-control-on-user`)_

### ⚪ терпит
- channel-binding-inactivity.cron (30 дней bot_blocked → карточка inactive + уведомление директору) не реализован (ENV есть, потребителя нет)  _(из `2026-05-25-telegram-bot-global-and-invites`)_
- 7 Prometheus-метрик helpfulness_* помечены [x] в DoD, но НЕ существуют в коде (grep=0)  _(из `2026-05-23-specialist-3-8-helpfulness-agent`)_
- gamification v1: TeamSpotlight/MyContributions/RecognitionFeed виджеты написаны но не смонтированы на дашбордах; опт-аут уведомлений Recognition Agent — noop-stub (TODO sprint-4)  _(из `2026-05-23-gamification-and-motivation`)_
- ICS-feed subscription UI отсутствует (backend готов): нет /me/settings/calendar, кнопки 'Сгенерировать ссылку', методов feed/generate — импорт в Я.Календарь/Google недостижим из UI  _(из `2026-05-25-calendar-mvp`)_
- EventForm в edit-режиме затирает участников (participants=[], EventParticipantDto без name) — известный gap в calendar.md  _(из `2026-05-25-calendar-mvp-polish`)_
- F3 prompt caching не распространён (только analyze.worker; нет в knowledge-core/quality-score/chat-v2/dialog-layer) + F6 tool_use не сделан  _(из `2026-05-24-prompts-hardening`)_
- final-roadmap: единая кодовая точка правды цен LLM (§9.6 llm-models-catalog.ts/sync-llm-catalog.ts) отсутствует; tts-synthesize не в тройной цепочке провайдеров  _(из `2026-05-22-final-roadmap`)_
- KC-Temporal: golden-set 50 размеченных встреч = 0 (только каркас); CI-хуки (.github/workflows) отсутствуют целиком; W4.2 в shadow не enforce, calibratedConfidence не на 8 моделях  _(из `2026-05-25-knowledge-core-temporal-and-graph-quality`)_
- unified-login Фаза 4 cleanup: удалить legacy accounts.controller login, auth/admin-login, AdminLoginForm.tsx, loginStandalone  _(из `2026-05-29-unified-login`)_
- RebuildCloneButton ('Обновить клона') — orphan, нигде не отрендерен; 2 backfill-скрипта (skill-trait-concepts, person-knowledge-embeddings) не в apply-prod-deploy.ts  _(из `2026-05-25-clone-reliability-hardening`)_
- E2E/idempotency-тесты CloneAccessGrant и patch-migrate-clone-access не созданы (§8.3/§8.4) — самая рискованная прод-операция без автопроверки  _(из `2026-05-26-clone-access-grant-admin-api`)_
- demo-content: объёмы недозалиты — 100 чек-инов вместо 300, 3 weekly/5 daily digest вместо 12/15; 0 ClientReferralLink/выплат/feedback-topics → /referrals и feedback-кластеры пусты в демо  _(из `2026-05-31-demo-content-expansion-pulse`)_
- dashboards-wow-polish: MiniHeatCell в 0 виджетах, MiniStackedBar в 1 — Acceptance ≥3 виджета нарушен (BottleneckHeatmap не мигрировал на MiniHeatCell)  _(из `2026-06-01-dashboards-wow-polish`)_
- onboarding-туры: welcome-тур не автозапускается (заменён баннером), demo-тур dead-code (селекторы без якорей), meeting-тур шаг card-link сломан; E2E онбординга отсутствует  _(из `2026-05-27-tracker-onboarding-tour`)_
- ai-chat-quota: Concierge per-Org дефолты не подняты (100/3000 вместо 3000/60000), CLONE_ASK_PER_USER_PER_DAY не удалён, фронт-индикатор квоты не сделан; баг parseInt radix=100  _(из `2026-05-31-ai-chat-quota-unified-per-user`)_
- smoke-checklist: артефакты прогона миграции (run-all-smoke, smoke-chat-v2-via-router, SUMMARY-SMOKE-2.md) отсутствуют — пост-миграционный smoke 28 агентов не зафиксирован  _(из `2026-05-26-llm-migration-smoke-checklist`)_
- tracker subtasks: каскадный перенос boardId на потомков при смене доски родителя не реализован; badge N/M упрощён до ✓N (DTO без completedChildrenCount)  _(из `2026-05-27-tracker-subtasks-ui`)_
- meeting-recording: Фаза 4 HLS (SegmentedFileOutput) и Фаза 5 backfill-merged-json.ts (P2); @@unique([recordingId,livekitIdentity]) перед мультирепликой; стабильный guest identity  _(из `2026-06-03-meeting-recording-reliability`)_
- llm-pipeline-errors-fix: тест Ollama-downgrade json_schema→json_object не написан (ollama.service.spec.ts не существует) — прод-код корректен, deliverable-тест отсутствует  _(из `2026-06-03-llm-pipeline-errors-fix`)_
- inn-lookup frontend полностью отсутствует (InnInput/useInnLookup/api/domain) + валидация контрольной суммы ИНН по ФНС — автозаполнение реквизитов в UI не работает  _(из `2026-05-25-inn-lookup-tz`)_

---
## 📋 Полный реестр (104 ТЗ)

| Дата | ТЗ | Тема | Статус по коду | Решение |
|---|---|---|---|---|
| 2026-05-20 | Единый docker-compose деплой + чистка мусора + README | infra | ✅ готово 95% | → архив |
| 2026-05-20 | Docker-деплой (backend/frontend), полный переход на Bun и агрессивный апгрейд пакетов | infra | ✅ готово 95% | → архив |
| 2026-05-22 | Финальная программистская роадмапа Коры v2 (зонтик: 24 sub-ТЗ в 4 фазах α/β/γ/δ) | infra | 🟢 почти 88% | → архив |
| 2026-05-23 | Геймификация и мотивация — мягкое признание без рейтингов (благодарности, бейджи, стрики) | gamification | ✅ готово 98% | → архив |
| 2026-05-23 | δ-3 — Голосовой адаптер каналов: распознавание речи (ASR), синтез (TTS) и голосовой ввод в Concierge через WebSocket | conversational-channels/voice | ✅ готово 100% | → архив |
| 2026-05-23 | Специалист 3.8 — Агент-помощник (выявление людей-помощников и публичные «спасибо») | sba-agents | 🟢 почти 92% | 🛠 оставить |
| 2026-05-23 | Нативное мобильное приложение iPhone + Android (React Native + Expo) | tracker | ⬜ не начато 0% | 🛠 оставить |
| 2026-05-23 | Таск-трекер Кора — Фаза 4: РФ must-have (Telegram-бот задач, email-to-task, шаблоны команд, производственный календарь) | tracker | ✅ готово 95% | 🛠 оставить |
| 2026-05-24 | Интеграция провайдеров KIE и GRSAI в LlmRouter — выбор любой модели через админку | llm | ✅ готово 100% | → архив |
| 2026-05-24 | Hardening промптов Z — защита от инъекций, калибровка confidence, few-shot, дедуп, кеширование | llm | 🟢 почти 75% | 🛠 оставить |
| 2026-05-24 | SBA β-8.1 — Добивка панели операционного директора (настроение чек-инов + недельная сводка) | dashboards | ✅ готово 100% | → архив |
| 2026-05-24 | SBA β-8.2 — Хранитель обещаний (замыкание петли «обещал → сделал?») | operations/coo-agents | ✅ готово 97% | → архив |
| 2026-05-24 | Автооптимизация промптов AI-отчётов (SPO) | llm | ⬜ не начато 0% | 🛠 оставить |
| 2026-05-24 | Модернизация интерфейса: дизайн-система OKLCH + критическое покрытие API тестами | infra | ✅ готово 92% | → архив |
| 2026-05-25 | Админка: страница управления моделями LLM по типам задач (/admin/llm-routes) | admin | ✅ готово 100% | → архив |
| 2026-05-25 | Журнал операций (Operations Log) в Z-Admin | logging | ⬜ не начато 0% | → архив |
| 2026-05-25 | Редизайн глобальной админки Z-Admin (двухуровневый сайдбар + настройки в БД) | admin | 🟢 почти 92% | → архив |
| 2026-05-25 | Тестовый стенд AI-агентов на реальных вызовах (sales-merge эксперимент) | llm | ✅ готово 95% | → архив |
| 2026-05-25 | Очистка backend lint и типов (0 ошибок ESLint) | infra | 🟢 почти 90% | → архив |
| 2026-05-25 | Биллинг (единый тариф tier_standard), реферальная программа и накопительный баланс встреч | billing | ✅ готово 95% | → архив |
| 2026-05-25 | Двусторонняя синхронизация с внешними календарями и трекерами РФ (CalDAV / Google / Я.Трекер / Битрикс24) | calendar | ⬜ не начато 3% | 🛠 оставить |
| 2026-05-25 | Календарь MVP — расширение модуля Events + Concierge-инструменты | calendar | ✅ готово 100% | → архив |
| 2026-05-25 | Доработка календаря MVP — видеовстречи, email-напоминания, фильтр по проекту, выбор участников | calendar | ✅ готово 95% | → архив |
| 2026-05-25 | Усиление надёжности клона сотрудника | clones | ✅ готово 98% | → архив |
| 2026-05-25 | Клоны = Роли: ребрендинг клонов с персональных на ролевые | clones | ✅ готово 95% | → архив |
| 2026-05-25 | Автоконвертация json_schema → tools для DeepSeek-V4-Pro (формат вывода) | llm | ✅ готово 100% | → архив |
| 2026-05-25 | Демо-режим (демо-кабинет) для новых Org — ранний дизайн на isDemo-флаге и LLM-фикстуре | demo | ⬜ не начато 5% | → архив |
| 2026-05-25 | Реальный переезд ENV → AdminSetting через sync-cache (миграция call-sites) | admin | ✅ готово 100% | → архив |
| 2026-05-25 | Жёсткая идентификация участников встречи (User.id вместо сопоставления по имени) | knowledge-core | ✅ готово 95% | → архив |
| 2026-05-25 | Интеграция с API по ИНН (Dadata) — автозаполнение реквизитов компании и верификация реферала | billing | 🟡 частично 55% | 🛠 оставить |
| 2026-05-25 | Кора v3 / KC-Temporal — bitemporal-модель и качество графа знаний | knowledge-core | ✅ готово 95% | → архив |
| 2026-05-25 | Архитектурные изменения LLM-агентов по итогам экспериментов мая 2026 (миграция на DeepSeek-V4-Pro) | llm | ✅ готово 92% | → архив |
| 2026-05-25 | Общий кэшируемый префикс для всех LLM-цепочек (экономия 50-90%) | llm | ⬜ не начато 10% | → архив |
| 2026-05-25 | Разделение «быстрого отчёта пользователю» и «памяти компании» в pipeline встречи | llm | ✅ готово 98% | → архив |
| 2026-05-25 | Расширить cache_control ephemeral на user-сообщение для MiniMax / Anthropic-формата | llm | ⬜ не начато 10% | 🛠 оставить |
| 2026-05-25 | SBA β-8.3 — Доделка операционного директора: ежедневный отчёт COO + карта причин + виджет зрелости | dashboards | ✅ готово 98% | → архив |
| 2026-05-25 | Симулятор месяца работы компании (Simulation Harness) — внутренний QA-стенд на проде | infra | ⬜ не начато 0% | 🛠 оставить |
| 2026-05-25 | β-9 — Глобальный Telegram-бот + приглашения сотрудников в стиле GitHub | telegram | 🟢 почти 90% | 🛠 оставить |
| 2026-05-25 | «Ваши предложения» — пользовательский фидбэк с AI-кластеризацией в смысловые блоки | admin | ✅ готово 95% | → архив |
| 2026-05-26 | Unit-тесты для CheckinSentimentBatchCron и парсера настроения чек-инов | logging | ✅ готово 100% | → архив |
| 2026-05-26 | Admin CRUD для CloneAccessGrant + миграционный patch-скрипт | clones | ✅ готово 100% | → архив |
| 2026-05-26 | Маркетплейс клонов должностей — фронтенд (витрина + чат + админ-выдача доступов) | clones | ✅ готово 97% | → архив |
| 2026-05-26 | Smoke-проверка 28 LLM-агентов после миграции на DeepSeek-V4-Pro (операционный чек-лист) | llm | 🟡 частично 45% | 🛠 оставить |
| 2026-05-26 | Раздел «Память компании» — UI для регламентов, идей, сущностей, профиля знаний + разграничение доступа | smart-tables | ✅ готово 95% | → архив |
| 2026-05-26 | Перевод Telegram-канала на прокси telegram.crossmark.ru | telegram | ✅ готово 95% | 🛠 оставить |
| 2026-05-27 | Биллинг (Точка Банк) + реферальная программа (фикс 20 000 ₽) + автоподстановка по ИНН (DaData) | billing | 🟢 почти 90% | 🛠 оставить |
| 2026-05-27 | Concierge: подключение dialog-layer и суммаризации в контекст | llm | ✅ готово 95% | → архив |
| 2026-05-27 | Онбординг по приглашению: логин и пароль прямо в письме | onboarding | ✅ готово 97% | → архив |
| 2026-05-27 | Реструктуризация бокового меню на 6 смысловых слоёв | main-screen | ✅ готово 100% | → архив |
| 2026-05-27 | Спринты в Z — циклы работы команды + AI-помощник по спринтам | tracker | ✅ готово 95% | → архив |
| 2026-05-27 | Несколько досок внутри проекта трекера (модель Board + переключение) | tracker | 🟢 почти 80% | 🛠 оставить |
| 2026-05-27 | Чек-листы внутри задачи трекера (плоские пункты с галочками, прогресс «N/M») | tracker | ✅ готово 98% | → архив |
| 2026-05-27 | Onboarding-тур: всплывающие подсказки при первом входе | onboarding | ✅ готово 100% | → архив |
| 2026-05-27 | Трекер Z/Кора — паритет с Kaiten/Weeek/YouGile (зонтик 6 ТЗ) | tracker | ✅ готово 95% | → архив |
| 2026-05-27 | Вкладка «Документы» в проекте трекера (ProjectDocument + связанные карточки) | tracker | 🟢 почти 85% | 🛠 оставить |
| 2026-05-27 | Трекер: вкладки «Обзор», «Загруженность» и «Приложения» в проекте | tracker | 🟢 почти 90% | 🛠 оставить |
| 2026-05-27 | UI подзадач в карточке задачи трекера | tracker | ✅ готово 95% | → архив |
| 2026-05-28 | Исправление контрастности и дизайн-токенов (аудит P0-P1) | infra | ✅ готово 100% | → архив |
| 2026-05-28 | Демо-кабинет (черновик, заменён на «demo-workspace / ТехноСтрим») | demo | ✅ готово 90% | → архив |
| 2026-05-28 | Демо-кабинет «ТехноСтрим» (заполненный демо-воркспейс) | demo | ✅ готово 95% | → архив |
| 2026-05-28 | Лендинг «Кора» (янтарь/Fraunces) как главная страница | onboarding | ✅ готово 100% | → архив |
| 2026-05-28 | Paywall без trial — демо-режим (read-only) до оплаты подписки | billing | 🟢 почти 90% | 🛠 оставить |
| 2026-05-28 | Страница /settings/templates — шаблоны AI-отчётов встреч | templates | ⬜ не начато 3% | 🛠 оставить |
| 2026-05-28 | Спринты — master-detail список и расширенный мастер создания (6 scope-вариантов) | tracker | ✅ готово 97% | → архив |
| 2026-05-29 | Создание демо-кабинета «ТехноСтрим» из админки (Z-Admin) | demo | ✅ готово 100% | → архив |
| 2026-05-29 | Админка: единая карточка Org — табы «Тариф и лимиты» + «Подписка и счета» | admin | ✅ готово 98% | → архив |
| 2026-05-29 | Z Agents & Clones v2.0 — зонтичное ТЗ (самообучающиеся AI-агенты) | sba-agents | 🟢 почти 75% | 🛠 оставить |
| 2026-05-29 | Исправление находок аудита коммитов (биллинг, рефералы, demo-reset, credentials, трекер) | billing | ✅ готово 97% | → архив |
| 2026-05-29 | Пакет коммерческой надёжности Z — 4 фикса (free-note, first-touch, переименование гостя, метрики биллинга) | billing | ✅ готово 95% | 🛠 оставить |
| 2026-05-29 | Геймификация v2 «мягко-средняя» — Зёрна, уровни, лиги, AI-оценка признаний | gamification | ⬜ не начато 3% | 🛠 оставить |
| 2026-05-29 | Онбординг v2 — экраны знакомства, action-тур настройки, обзор сайдбара и hover-подсказки | onboarding | ✅ готово 95% | → архив |
| 2026-05-29 | Утренний план и вечерний отчёт по инициативе сотрудника в Telegram | telegram | ✅ готово 95% | 🛠 оставить |
| 2026-05-29 | Единый логин для пользователей и супер-админов (/login) | onboarding | 🟢 почти 90% | 🛠 оставить |
| 2026-05-30 | Пульс компании — полная реализация всех 6 волн дашбордов (v2) | dashboards | 🟢 почти 93% | 🛠 оставить |
| 2026-05-31 | Z-Admin: один тариф tier_standard, цена в AdminSetting вместо констант | billing | ✅ готово 95% | → архив |
| 2026-05-31 | Единая per-user квота на AI-общение (Concierge + клоны) | billing | 🟢 почти 90% | 🛠 оставить |
| 2026-05-31 | Авто-заливка демо-кабинета при регистрации и авто-стирание при первой оплате | demo | ⬜ не начато 10% | → архив |
| 2026-05-31 | Расширение контента демо-кабинета «ТехноСтрим» под Pulse v2 | demo | ✅ готово 95% | → архив |
| 2026-05-31 | Универсальный приём документов (любые форматы + парсинг сайта компании) | smart-tables | ⬜ не начато 8% | 🛠 оставить |
| 2026-05-31 | Партнёрский кабинет Коры — перестройка UX и расширение аналитики (первый запуск) | billing | ✅ готово 98% | → архив |
| 2026-05-31 | Умные таблицы Z (Smart Tables) — полный паритет с Teamly + 5 AI-киллер-фич (15 фаз) | smart-tables | 🟡 частично 40% | 🛠 оставить |
| 2026-05-31 | Вынос Z-Admin в отдельную route-группу (свой layout без пользовательского кабинета) | admin | ✅ готово 95% | → архив |
| 2026-06-01 | Главная страница: sticky Hero + 4 таба (реструктуризация дашборда CEO) | dashboards | 🟢 почти 85% | 🛠 оставить |
| 2026-06-01 | Полная полировка дашбордов Z — «вау-эффект» | dashboards | 🟢 почти 92% | → архив |
| 2026-06-01 | Единая эталонная демо-Org «ТехноСтрим» (shared demo) с ролью demo_observer | demo | ✅ готово 98% | → архив |
| 2026-06-01 | Модуль технического логирования в БД (LoggingModule) + админ-UI /admin/logs | logging | ✅ готово 100% | → архив |
| 2026-06-01 | Главная страница Кора — зонтик «Demo-Org + табы» | dashboards | ✅ готово 95% | → архив |
| 2026-06-02 | Подтверждения в Z: лестница доверия + Action Center (меньше подтверждений и невозможно пропустить) | smart-tables/curation/action-center | 🟢 почти 85% | 🛠 оставить |
| 2026-06-02 | Фиксы Z-Admin «Тенанты»: мёртвый дропдаун тарифа → статус подписки + краш Concierge-аналитики | admin | ✅ готово 100% | → архив |
| 2026-06-02 | Русификация админок — устранение английских слов и аббревиатур в UI | admin | ⬜ не начато 0% | 🛠 оставить |
| 2026-06-02 | Визуализация «Мозг компании» из людей (Карта + Структура) | dashboards | ⬜ не начато 0% | 🛠 оставить |
| 2026-06-02 | Экспертные клоны — рождение эксперта (кабинет, приём материалов, постройка мозга, продажа доступа) | clones | ⬜ не начато 0% | 🛠 оставить |
| 2026-06-02 | Перенос GEPA (эволюция промптов) с Python на чистый Node.js внутри backend | llm | ⬜ не начато 5% | 🛠 оставить |
| 2026-06-02 | Граф целей (Goals OKR v2) — цели из встреч + ручной контроль | goals | ✅ готово 97% | → архив |
| 2026-06-02 | Финализация главного экрана: закрытие 9 отложенных «хвостов» зонтика main-screen-umbrella | dashboards | ⬜ не начато 0% | 🛠 оставить |
| 2026-06-02 | Чистка «Админки компании»: убрать расходы из глаз владельца + развести с «Настройками» | admin | ✅ готово 98% | → архив |
| 2026-06-02 | Умные таблицы — автосоздание и автонаполнение (уход от ручного труда) | smart-tables | ✅ готово 95% | → архив |
| 2026-06-02 | Умные таблицы — добивание хвостов (eval, rate-limit, многолистовый импорт, auto-fill, серверный фильтр) | smart-tables | ⬜ не начато 12% | 🛠 оставить |
| 2026-06-03 | Action Center — остаток: метка доверия в UI, крутилки в админке, detail-страницы курации | knowledge-core/curation | ✅ готово 95% | 🛠 оставить |
| 2026-06-03 | Починка каскада ошибок AI-pipeline встречи (LLM-роутинг + логи транскрипции) | llm | ✅ готово 100% | → архив |
| 2026-06-03 | Процессные контуры (pipelines), сквозной traceId и полное покрытие логами | logging | ✅ готово 97% | → архив |
| 2026-06-03 | Сшивка graph-контура логов в единый traceId встречи (mtg_&lt;id&gt;) | logging | ✅ готово 100% | → архив |
| 2026-06-03 | Надёжность записи встреч: аудиодорожки, участники, видео (v2) | recording | 🟢 почти 90% | 🛠 оставить |
| 2026-06-03 | Раздел «Команда» и персональные доступы сотрудников | admin | ⬜ не начато 0% | 🛠 оставить |

---
## 📦 В архив (66)

- `2026-05-20-deploy-single-compose-cleanup` — Реализовано целиком и подтверждено фактическим кодом: единый root docker-compose.yml без профилей, порты через .env, dev-compose, медиа отдельным compose, 3 ngi
- `2026-05-20-docker-deploy-bun-runtime-deps-upgrade` — Все технические цели реализованы и проверены по коду: полный переход на Bun (Dockerfile-ы на oven/bun, tsx/ts-node удалены), агрессивный апгрейд пакетов (Next 1
- `2026-05-22-final-roadmap` — Зонтичный roadmap-контракт, чья работа на ~88% реализована через ~20+ дочерних dated sub-ТЗ (sba-alpha/beta/gamma/delta-*), каждый из которых отслеживается отде
- `2026-05-23-gamification-and-motivation` — Реализовано полностью: backend (модели, 4 cron'а, 5 контроллеров, воркер, seed, RBAC, prompt-key, тесты) + frontend (2 страницы вклада, 3 виджета, api/domain-сл
- `2026-05-23-sba-delta-3-voice-channel-adapter` — Реализовано полностью: ASR REST, TTS REST, VoiceChannelAdapter, RBAC, ENV, 4 метрики, фронт voice.api+ConciergeVoice, и единственный «отложенный» пункт (WebSock
- `2026-05-24-kie-grsai-llm-router-integration` — Реализовано полностью (100%): сервисы KieService/GrsaiService, регистрация в роутере и ai.module, enum/capability/dispatch, цены, seed провайдеров+моделей, A/B-
- `2026-05-24-sba-beta-8-1-coo-dobivka` — Реализовано полностью и подтверждено кодом: схема (4 поля DailyCheckIn + модель WeeklyOperationsDigest + индексы), воркер настроения, недельный cron с идемпотен
- `2026-05-24-sba-beta-8-2-promise-keeper` — ТЗ реализовано практически полностью (≈97%): схема БД, enum resolves, специалист, cron, handler, удалена заглушка router'а, оба контроллера и эндпоинты, RBAC, E
- `2026-05-24-ui-api-modernization` — ТЗ реализовано по всем 7 фазам (A-G), что подтверждено кодом: OKLCH-токены, все shared-компоненты, design-preview галереи, sonner-shim, полный набор backend-spe
- `2026-05-25-admin-llm-routes-frontend` — Реализовано полностью: все 6 фаз и все acceptance criteria подтверждены реальным кодом (страница, таблица, фильтры, модалка с тремя tier, защита super_admin на 
- `2026-05-25-admin-operations-log` — Функциональная цель (UI super_admin для просмотра сбоев фоновых процессов с фильтрами/поиском/экспортом) полностью закрыта более новым и более чистым ТЗ 2026-06
- `2026-05-25-admin-redesign-tz` — Реализовано по факту почти целиком: все 10 моделей БД, getDynamic, AdminSettingsService + bootstrap + pub/sub, CronManagerService через SchedulerRegistry, все 9
- `2026-05-25-ai-real-eval-harness` — Исследовательский эксперимент выполнен целиком: 3 фикстуры, 6 прогонов (A+Б), судья, SUMMARY-ALL с числовыми выводами. Гипотеза проверена (Б = -5% или лучше при
- `2026-05-25-backend-lint-cleanup` — Главная цель достигнута и верифицирована прогоном: `bun run lint` → 0 errors, exit 0 (было 112 errors), resolver и spec-override закоммичены в eslint.config.mjs
- `2026-05-25-billing-and-referrals-tz` — Реализовано практически целиком и подтверждено кодом: все 8 Prisma-моделей + 6 enum, три модуля (billing/referrals/meetings-balance) зарегистрированы в AppModul
- `2026-05-25-calendar-mvp` — Фазы 1 и 2 реализованы целиком и подтверждены кодом (Prisma-модели, 11 эндпоинтов, 5 Concierge-tools, cron+worker+очередь, ICS-feed, find-free-slot, frontend Da
- `2026-05-25-calendar-mvp-polish` — Все 4 фазы (P1 LiveKit auto-create/cancel, P2 email-напоминания, P3 серверный projectId-фильтр, P4 ParticipantPicker + org-members/search + persons/quick-create
- `2026-05-25-clone-reliability-hardening` — Все 6 фаз реализованы и подтверждены кодом (модели Prisma, сервисы, cron, бэкфиллы, admin API + UI, frontend-кнопки, seed моделей, golden-eval, snapshot-тесты).
- `2026-05-25-clones-role-based-rebrand` — Все 6 фаз реализованы и закоммичены (полный git-трейл b87a8691/9379fd8d/6a15b884/4cd9ef25/16ab67b5, рефлексия 93158cc8 «26/26 фаз»): Prisma versioning-поля, han
- `2026-05-25-deepseek-pro-output-format-fix` — Реализовано полностью (100%): автоконвертация в buildParams, восстановление text в mapResponse, метрика z_deepseek_schema_to_tool_conversion_total, логи, 8 unit
- `2026-05-25-demo-mode-tz` — Ранний черновик-дизайн (2026-05-25), полностью вытесненный более поздней линейкой демо-ТЗ (demo-cabinet, demo-workspace, paywall-no-trial, demo-auto-seed-and-cl
- `2026-05-25-env-to-admin-setting-call-sites-migration` — Реализовано полностью: каркас (resolveSync/hydrateSync/applySync/cacheMap), bootstrap-сервис, pub/sub {key,value}, 64 поля в 12 геттерах мигрированы, сидер со в
- `2026-05-25-hard-participant-identification` — Реализовано полностью: оба новых сервиса (ParticipantContextService, TaskAssigneeResolverService) созданы и покрыты тестами, метрика заведена, все три промпта п
- `2026-05-25-knowledge-core-temporal-and-graph-quality` — Зонтичное ТЗ реализовано фактически целиком: все 20 фаз (волны 1-4 + governance) подтверждены кодом — Prisma-поля, сервисы, воркеры/cron, скрипты backfill, ENV,
- `2026-05-25-llm-architecture-changes-from-experiments` — Все эмпирические секции (§1,§2,§3,§6,§8,§10) и §4-фундамент реализованы и закоммичены (серия feat-коммитов d1790cb7/3cba11d2/d50f0e3a/5cf6198e/f897d996/85b45a64
- `2026-05-25-llm-cache-prefix-everywhere` — Production-код по ТЗ не написан (нет cache-prefix-builder.ts, нет orchestrator, специалисты не отрефакторены, нет метрики ratio). Сделана только экспериментальн
- `2026-05-25-meeting-report-split-from-block-ingest` — Все 7 фаз реализованы и подтверждены кодом: промпт на 12 типов + тест, воркер + очередь + метрики, Prisma-поля, producer с ENV kill-switch, admin compare UI, fr
- `2026-05-25-sba-beta-8-3-coo-daily-and-doelka` — Все три фазы реализованы и подтверждены кодом (модель+миграция, cron, сервис, контроллер с 3 эндпоинтами, LLM taskType, 2 seed-скрипта, ENV, метрики, тесты, фро
- `2026-05-25-user-feedback-with-ai-clustering` — Функционал реализован полностью по коду: БД-модели, оба контроллера со всеми эндпоинтами, rate-limit guard, digest-сервис с Redis-lock/fallback/транзакцией, cro
- `2026-05-26-checkin-batch-cron-tests` — Реализовано полностью (done, 100%): оба spec-файла созданы и проходят (18 тестов зелёных), Вариант А с throw на дубликат checkInId реализован в парсере, reason=
- `2026-05-26-clone-access-grant-admin-api` — Реализовано полностью и сверх ТЗ (прошло дополнительный пост-аудит В15/В17/С25/С14). Все 6 эндпоинтов, схема, RBAC-фильтр, audit-mapping, уведомление, patch-скр
- `2026-05-26-clones-marketplace-frontend` — Все 5 фаз реализованы и подтверждены кодом: маркетплейс, карточка клона, чат с боковой панелью, admin CRUD грантов, in-app бейдж-точка; backend-зависимость (Зад
- `2026-05-26-memory-section-ui` — Реализовано полностью отдельным коммитом 8c35614c: все 6 задач (regulations/ideas/entities/skills-table/sidebar-subgroup/access-control) подтверждены в коде fro
- `2026-05-27-concierge-dialog-layer-integration` — Все code-фазы (1-6) полностью реализованы и подтверждены кодом: ENV-флаг, @Optional() DialogService, isDialogLayerEnabled(), preRetrieve(), summary-блок, cache 
- `2026-05-27-invitation-credentials-onboarding` — Все 8 фаз реализованы и подтверждены в production-коде (schema, сервисы, mail-шаблон, контроллер/эндпоинт, обе frontend-страницы), есть выделенный коммит 402ee5
- `2026-05-27-navigation-restructure` — Реализовано полностью: единственный затронутый файл Sidebar.tsx содержит все 6 групп в правильном порядке, условную «Управление» по роли coo, collapsible «Справ
- `2026-05-27-sprints` — Фича реализована полностью во всех 4 фазах и замержена 5 волнами коммитов (Волна 1-5) с последующими audit-фиксами и расширениями Pulse Wave 5. Backend (модели,
- `2026-05-27-tracker-checklists` — Фича реализована целиком и подключена в прод-путь: обе Prisma-модели + денормализованные счётчики, все 9 REST-эндпоинтов, DTO с .strict() и лимитом 50, WS-событ
- `2026-05-27-tracker-onboarding-tour` — Реализовано полностью: вся обещанная инфраструктура (User.tourProgress, REST GET/PATCH/reset, Zod-DTO, сервис+тесты, метрики Prometheus, TourProvider/Tooltip/Ba
- `2026-05-27-tracker-parity-with-competitors` — Зонтик фактически закрыт: все 6 подчинённых функций реализованы в коде (модели Board/ProjectDocument/IssueChecklist(+Item), контроллеры boards/checklists/projec
- `2026-05-27-tracker-subtasks-ui` — Функция реализована практически полностью: endpoint /issues/:id/children, includeChildrenCount, защита от циклов и глубины >2, verb parent_changed, метрика subt
- `2026-05-28-contrast-audit-fix` — Реализовано полностью и подтверждено кодом: конфиг-фиксы (shadcn-алиасы, bg-muted/hover, --text-disabled), mass-replace bg-white (37/38, 1 намеренный остаток), 
- `2026-05-28-demo-cabinet` — Это ранний оборванный черновик, который был заменён одноимённым sibling-ТЗ 2026-05-28-demo-workspace.md (полностью реализован) и развит цепочкой более новых дем
- `2026-05-28-demo-workspace` — Базовая функция реализована полностью (поле БД, оба эндпоинта, единый сидер из 23 модулей, reset, демо-тур, авто-очистка) и затем существенно расширена/перестро
- `2026-05-28-kora-landing-as-main-page` — Реализовано полностью (100%): главная страница / показывает лендинг Кора, auth-редирект на /dashboard работает, CTA ведут на /signup и /login, футер на /privacy
- `2026-05-28-sprints-master-detail-and-wizard` — Все 3 фазы реализованы и подтверждены кодом: backend (SprintsController/Service, VendorsService CRUD, translit-утилиты, RBAC, unit+integration тесты, расширенны
- `2026-05-29-admin-demo-workspace-creation` — Все Фазы 1-3 (backend-эндпоинты, frontend api-слой, страница /admin/demo, навигация) полностью реализованы и подтверждены кодом. Остаток Фазы 4 — лишь обновлени
- `2026-05-29-admin-subscription-ui-v2` — Все пункты Scope (A навигация, B рефакторинг заголовков, C новые UI-блоки InvoiceRowActions/AdjustSeatsDialog/ForceStatusDialog/SubscriptionEventsTimeline, D бе
- `2026-05-29-audit-fixes` — Реализовано практически полностью: все 15 блокеров + 17 высоких + 31 средний риск имеют отдельные fix(audit) коммиты, спот-проверка ~12 из них на уровне кода и 
- `2026-05-29-onboarding-v2` — Все ключевые артефакты ТЗ подтверждены кодом: Prisma-поля + enum, OnboardingModule с 4 эндпоинтами, side-effect'ы в 5 сервисах, backfill-скрипт в apply-prod-dep
- `2026-05-31-admin-plans-collapse-to-standard` — Реализовано целиком: registry-ключи billing.*, идемпотентный seed (зарегистрирован в apply-prod-deploy), SeatService и MeetingsBalanceService переведены на asyn
- `2026-05-31-demo-auto-seed-and-cleanup` — ТЗ полностью заменено более новым 2026-06-01-demo-shared-org-model.md (который явно объявляет supersedes). Реализация этого ТЗ (per-user seed-копия + cleanup 35
- `2026-05-31-demo-content-expansion-pulse` — ТЗ реализовано на ~95% и смержено в main через PR #7 (коммиты 985d802b + f0b28bd3). Все ключевые артефакты присутствуют в коде: 8 Pulse-snapshot-моделей, seedUs
- `2026-05-31-referrals-cabinet-revamp` — Реализовано полностью по всем фазам: backend (схема, create с contractAccepted, маскировка клиентов, расширенный getStats, getIncomeChart, getFunnel, promo-even
- `2026-05-31-z-admin-standalone-route-group` — Основная цель достигнута: вся админка (88 страниц + support-файлы) перенесена в route-группу (admin), создан AdminAuthGuard, новые layout'ы рендерят только Admi
- `2026-06-01-dashboards-wow-polish` — Все 12 фаз фактически реализованы и смержены в dev (ветка feature/dashboards-wow-polish, коммит 42462a17). По коду подтверждены: registry-док, закрытие всех 3 d
- `2026-06-01-demo-shared-org-model` — Реализовано целиком: все обещанные артефакты (schema-изменения, DemoObserverGuard, RBAC canMutate + policy.csv, ENV ZDEMO_ORG_ID, register/getMe, listener-detac
- `2026-06-01-logging-module` — Реализовано полностью и подтверждено кодом на 100%: Prisma-модели+enum+индексы, ENV LOG_DB_*, весь backend-модуль logging/, контроллер /api/v1/platform/logs под
- `2026-06-01-main-screen-umbrella` — Зонтик-координатор выполнил свою функцию: оба дочерних потока (А backend demo-shared-org + Б frontend tabs) и мини-фаза В (матрица 6 состояний в DirectorDashboa
- `2026-06-02-admin-tenants-tariff-and-concierge-fixes` — Все три фазы реализованы на 100% и подтверждены в коде (домен/компонент/сервис/DTO) + коммитами 1ae46fdb и 025a3ef5. Хвосты §6 (удаление legacy Org.tier и γ+ ме
- `2026-06-02-goals-okr-v2` — Все 5 фаз реализованы и слиты в dev (PR #16, коммиты 40d5ee30..f3f4b2de). Подтверждено по коду: модели+enum в schema.prisma, KR/supersede эндпоинты, специалист 
- `2026-06-02-org-admin-cleanup-no-costs-nav-split` — Реализовано полностью (verified по коду ~98%): новая route-группа /company-admin со своим сайдбаром и тремя вкладками создана, старые settings/admin/* → redirec
- `2026-06-02-smart-tables-auto-creation` — Все 6 фаз (0–5) + параллельные потоки (eval-harness, privacy-research) реализованы и закоммичены отдельными feature-коммитами; код подтверждён по schema.prisma,
- `2026-06-03-llm-pipeline-errors-fix` — Все запланированные фазы (1-4 код + патч, 6 логи) полностью реализованы и смержены в PR #15 (коммиты 2931749d, 85e5cd8e, 64738b49); даже сознательно отложенный 
- `2026-06-03-logging-pipelines-coverage` — Реализовано целиком и смержено в main (PR #14, коммиты db8abc33 + af2f30a2). Все ключевые артефакты подтверждены кодом: enum+поле+индексы в Prisma, DbLoggerBrid
- `2026-06-03-logging-trace-stitch-graph` — Реализовано полностью и подтверждено кодом: приоритет data.traceId в deriveTraceFromJob, auto-stamp через CoreQueueService.stamp() во всех q.add(), traceId? в 1

## 🛠 Оставить активными (38)

- `2026-05-23-specialist-3-8-helpfulness-agent` — 🟢 почти 92% · Основная функциональность работает и в проде используется (демо-данные, страницы, crons). Остаток — наблюдаемость (метрики) и шлифовка opt-o
- `2026-05-23-tracker-mobile-native` — ⬜ не начато 0% · Большой отдельный поток (10-12 человеко-недель), требует выделенной RN-команды и аккаунтов магазинов, которых у проекта нет. Не блокирует ве
- `2026-05-23-tracker-phase-4-rf-musthave` — ✅ готово 95% · Основной функционал (включая email-to-task, который числился невыполненным) подтверждён в коде. Невыполненного блокирующего нет — оставшееся
- `2026-05-24-prompts-hardening` — 🟢 почти 75% · Главный риск (prompt-injection) и калибровка уже закрыты — это снимает 'burning'. Остаток F3 (caching) — это деньги/latency на проде (эконом
- `2026-05-24-supervised-prompt-optimization` — ⬜ не начато 0% · Не блокер прода и не про деньги/надёжность напрямую. Это про измеримое улучшение качества промптов — важно стратегически, но требует 5 челов
- `2026-05-25-calendar-external-sync` — ⬜ не начато 3% · Полезная интеграция для удержания РФ-аудитории, но не блокер прода и не денежный риск прямо сейчас: базовый Calendar MVP и 1-way ICS-feed ра
- `2026-05-25-inn-lookup-tz` — 🟡 частично 55% · Ядро (backend lookup-сервис + verify-inn у рефералов) работает; недостающее — это UI-автозаполнение реквизитов и метрики, которые улучшают о
- `2026-05-25-minimax-cache-control-on-user` — ⬜ не начато 10% · Прямая экономия ~50% input-цены на MiniMax (primary-провайдер после вывода Anthropic) на больших user-промптах — деньги на каждом вызове AI-
- `2026-05-25-simulation-harness-tz` — ⬜ не начато 0% · Сильная QA- и unit-economics-ценность: даёт сквозную проверку ~70 cron'ов/воркеров и фактическую стоимость месяца на 20 человек — основу для
- `2026-05-25-telegram-bot-global-and-invites` — 🟢 почти 90% · Основная фича в проде и работает. Остаток невелик, но один хвост реально влияет на UX/надёжность: без channel-binding-inactivity.cron заблок
- `2026-05-26-llm-migration-smoke-checklist` — 🟡 частично 45% · Миграция на deepseek-v4-pro уже давно в проде (с 2026-05-26), последующие ТЗ (llm-pipeline-errors-fix от 2026-06-03 и др.) работают поверх н
- `2026-05-26-telegram-via-crossmark-proxy` — ✅ готово 95% · Код готов, но прод-канал к Telegram из Новосибирского ДЦ нестабилен — без операторской регистрации в прокси и прогона patch-скрипта глобальн
- `2026-05-27-billing-tochka-referral-dadata-z` — 🟢 почти 90% · Код готов на ~90%, остаток — это деньги в проде: реальная активация эквайринга Точки и реф-выплат. Не burning (manual-режим работает как заг
- `2026-05-27-tracker-boards` — 🟢 почти 80% · Не блокер прода и не деньги: трекер работает на легаси-маршруте одной доски, регрессии нет. Но это незакрытый разрыв «90% построено — 0% вид
- `2026-05-27-tracker-project-documents` — 🟢 почти 85% · Основная ценность (создание/хранение/редактирование документов проекта, связанные карточки, попадание в граф знаний) работает. Оставшееся — 
- `2026-05-27-tracker-project-overview` — 🟢 почти 90% · Основная ценность (три вкладки, дашборд, редирект) уже работает в проде-пути. Остаток — наблюдаемость (3 Prometheus-счётчика) и косметика (a
- `2026-05-28-paywall-no-trial` — 🟢 почти 90% · Сам paywall работает (403 блокирует мутации, баннер виден на всех страницах, страница оплаты есть), деньги защищены. Но рассинхрон кодов 403
- `2026-05-28-settings-templates-tz` — ⬜ не начато 3% · Не блокер прод-надёжности и не деньги: бэкенд UserTemplate/PromptTemplate API уже есть, кастомные шаблоны при необходимости управляются чере
- `2026-05-29-agents-v2-umbrella` — 🟢 почти 75% · Ядро (граф bi-temporal, debate, shadow-сбор, retrieval клонов) уже в коде за выключенными ENV-флагами — деньги/прод не горят. Невыполнен в о
- `2026-05-29-commercial-reliability-package` — ✅ готово 95% · Основное тело пакета done и закоммичено. Оставшийся хвост (подключение 3-4 billing-метрик к call-site'ам) — important-but-small для observab
- `2026-05-29-gamification-v2-soft-medium` — ⬜ не начато 3% · Не блокер прода, денег и надёжности. Сам ТЗ закладывает поэтапную валидацию гипотез на первых тенантах и допускает откат лиг — то есть это и
- `2026-05-29-telegram-self-initiated-checkins` — ✅ готово 95% · Основная ценность (самоинициированный чек-ин попадает в DailyCheckIn, закрывается pending-уведомление, бот подтверждает, метрики идут) уже р
- `2026-05-29-unified-login` — 🟢 почти 90% · Фича работает в коде, откат тривиален (старые пути живы). Остаток — это ручной smoke-тест (security-чувствительный, но не блокер прода) и ко
- `2026-05-30-pulse-full` — 🟢 почти 93% · Основная ценность (все дашборды и аналитика) уже в проде. Остаток — опциональная чат-интеграция (Волна 6.9), зависящая от отдельного направл
- `2026-05-31-ai-chat-quota-unified-per-user` — 🟢 почти 90% · Ядро (единый per-user счётчик, защита от обхода между каналами) уже работает в проде. Остаток — это UX-индикатор «осталось N сообщений» (не 
- `2026-05-31-document-ingest-universal` — ⬜ не начато 8% · Высокая продуктовая ценность для позиционирования «память компании» (Excel-выгрузки CRM в граф, сканы, парсинг сайта при онбординге = wow-эф
- `2026-05-31-smart-tables` — 🟡 частично 40% · MVP (Grid/карточка/срезы/импорт/семантический фильтр) уже даёт демонстрируемый продукт и частичный паритет с Teamly — горящего блокера нет. 
- `2026-06-01-dashboard-main-tabs-restructure` — 🟢 почти 85% · Костяк (главное UX-улучшение «пульт за 30 секунд») уже в проде. Остаток — это (1) косметика онбординг-блока для owner и (2) backend-endpoint
- `2026-06-02-action-center-pending-confirmations` — 🟢 почти 85% · Архитектурно почти всё сделано, но Часть B (Action Center: pending-actions, колокольчик, /actions, напоминания, lifecycle, requiresAction) и
- `2026-06-02-admin-ui-russian-localization` — ⬜ не начато 0% · Прямое нарушение жёсткого правила продукта feedback_admin_ui_russian_only: в админке владельца компании (НЕ разработчика) сейчас висят 'Bot 
- `2026-06-02-brain-visualization-people` — ⬜ не начато 0% · Это ключевой «вау»-экран после онбординга (эмоциональная демонстрация ценности продукта «память компании»), но не блокер прода и не денежный
- `2026-06-02-expert-clones-creation` — ⬜ не начато 0% · Новое продуктовое направление (маркетплейс готовых AI-экспертов), а не блокер прода/денег/надёжности. Зависит от завершённости document-inge
- `2026-06-02-gepa-port-to-node` — ⬜ не начато 5% · Острая боль (subprocess в API-процессе, +150 МБ pip в образе backend) уже снята контейнером z-gepa. Остаётся только оптимизация: prompt cach
- `2026-06-02-main-screen-umbrella-tails-finalization` — ⬜ не начато 0% · Не блокер и не прод-критика прямо сейчас (Q6 ТЗ: demo_observer'ов в проде пока 0, probe-events для эталона ещё не копятся). Но это закрытие 
- `2026-06-02-smart-tables-auto-creation-finishing` — ⬜ не начато 12% · Фаза B — реальная дыра безопасности на проде: ThrottlerGuard не зарегистрирован глобально, поэтому @Throttle на login/register инертны и под
- `2026-06-03-action-center-remaining` — ✅ готово 95% · Код всех фаз готов и закоммичен; остаётся только организационное действие — мерж ветки в dard/main (вопрос к владельцу, не разработка). Отло
- `2026-06-03-meeting-recording-reliability` — 🟢 почти 90% · Основная боль (потеря дорожек, фантомы, видео-крутилка) закрыта в коде и в проде — острого пожара нет. Остаток (HLS для длинных встреч, back
- `2026-06-03-team-section-and-employee-access` — ⬜ не начато 0% · Фаза 0.1 чинит реально сломанную кнопку «Пригласить» (владелец не может добавить сотрудника по карточке Person) и Фаза 0.2 устраняет 400 на 
