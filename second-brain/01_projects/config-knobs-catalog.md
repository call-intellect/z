# Каталог крутилок (AdminSetting) — что включено и за что отвечает

> **Простыми словами, ёмко.** Все настройки, которыми можно управлять из админки (super_admin). Колонка «Дефолт»: для рубильников — **вкл/выкл**, для чисел — значение. Менять можно в админке без выката кода.
>
> **Известный долг (Ф3):** часть `limits.*` сейчас засеяна в двух наборах с разными значениями (старый `MAX_*` и новый `limits.*camelCase`) — консолидируется по `plans/tz/2026-06-21-config-knobs-remaining-waves.md`. Ниже приведён **новый** набор как канонический. Ещё ~240 ENV-крутилок и хардкодов пока НЕ в админке (тот же ТЗ, волны W1-W6).
>
> Дата среза: 2026-06-21. Источник — сиды `backend/scripts/seed-admin-setting*.ts`.

## Лимиты и квоты
| Ключ | Что делает | Дефолт |
|---|---|---|
| limits.maxApiKeysPerUser | Макс. API-ключей на пользователя | 10 |
| limits.maxWebhookSubscriptionsPerUser | Макс. подписок на вебхуки | 20 |
| limits.maxDestinationsPerUser | Макс. адресов прямой доставки | 20 |
| limits.maxTagsPerUser | Макс. тегов на пользователя | 50 |
| limits.maxUserTemplatesPerUser | Макс. своих шаблонов встреч | 20 |
| limits.maxChatRequestsPerDay | Запросов в AI-чат в сутки | 200 |
| limits.maxChatTokensPerDay | Токенов AI-чата в сутки | 2 000 000 |
| limits.maxRenderJobsPerHour | Задач рендера в час | 10 |
| limits.maxBulkExportsPerDay | Массовых экспортов в сутки | 5 |
| limits.maxRegeneratePerMeetingPerDay | Перегенераций отчёта встречи в сутки | 5 |
| limits.maxMeetingsCreatedPerDayViaApi | Встреч через API в сутки | 100 |
| limits.maxEmbeddingTokensPerMonthPerUser | Токенов эмбеддингов в месяц | 10 000 000 |
| limits.maxHighlightsPerMeeting | Хайлайтов на встречу | 50 |
| limits.maxBulkOperationIds | ID в одной массовой операции | 200 |
| limits.maxChatMessageChars | Символов в сообщении AI-чата | 8000 |
| limits.maxRoomMessageChars | Символов в сообщении комнаты встречи | 2000 |
| limits.maxCardsPerUser | Карточек на пользователя | 500 |
| limits.maxCardRollupsPerDay | Сборок карточек в сутки | 100 |
| limits.maxGoalRecomputePerDay | Пересчётов целей в сутки | 5 |
| limits.maxParticipantsPerMeeting | Участников на встрече | 10 |
| limits.maxMeetingDurationHours | Макс. длина встречи | 8 ч |
| limits.clipMaxDurationSeconds | Макс. длина клипа | 300 сек |
| limits.exportZipMaxMeetings | Встреч в одном ZIP | 100 |
| limits.exportZipMaxBytes | Размер ZIP-экспорта | 20 ГБ |
| share.tokenLengthBytes | Длина токена публичной ссылки | 24 байта |
| share.defaultExpirationDays | Срок жизни ссылки по умолчанию | 7 дней |
| share.allowedExpirationDays | Допустимые сроки жизни ссылки | 1, 7, 14 дней |
| aiChatQuota.dailyLimitAdmin | Суточная квота AI-чата для админов | 50 |
| aiChatQuota.dailyLimitMember | Суточная квота AI-чата для участников | 20 |
| aiChatQuota.adminRoles | Роли с админской квотой | owner,admin,coo |
| smartTables.maxRowsPerTable | Макс. строк в таблице | 100 000 |
| smartTables.maxPropsPerTable | Макс. колонок в таблице | 200 |
| smartTables.maxTablesPerOrg | Макс. таблиц на компанию | 1000 |
| smartTables.maxCellSizeBytes | Макс. размер ячейки | 1 МБ |
| smartTables.importMaxFileMb | Макс. размер файла импорта | 25 МБ |
| smartTables.importMaxRows | Макс. строк за импорт | 5000 |

## Граф знаний: разбор, дистилляция, сущности, темы
| Ключ | Что делает | Дефолт |
|---|---|---|
| knowledge.v2AgentsEnabled | Главный рубильник новых агентов знаний | вкл |
| knowledge.distillMergeThreshold | Порог схожести для слияния блоков | 0.85 ⚠️Ф3 |
| knowledge.reportBlockConfidenceCap | Потолок доверия блокам из отчёта встречи | 0.6 |
| knowledge.distillDebounceMs | Задержка запуска дистилляции | 30000 мс |
| knowledge.distillKnnTopK | Сколько похожих блоков искать при дистилляции | 10 |
| knowledge.entityMergeThreshold | Порог схожести для слияния сущностей | 0.9 |
| knowledge.blockIngestWindowSegments | Окно сегментов при разборе | 5 |
| knowledge.blockIngestMaxTokensPerSegment | Макс. токенов на сегмент | 1500 |
| knowledge.searchCosineWeight | Вес смыслового поиска (гибрид) | 0.7 |
| knowledge.searchBm25Weight | Вес поиска по словам (гибрид) | 0.3 |
| knowledge.linkMinConfidence | Мин. уверенность связи для сохранения | 0.5 |
| knowledge.linkerMinBlocks | Сколько блоков нужно для связывания | 3 |
| knowledge.linkKnnTopK | Сколько похожих блоков смотреть при связывании | 20 |
| knowledge.blockDynamicScoreDecayDays | За сколько дней затухает вес блока | 30 дн |
| knowledge.entityGraphMinComentions | Мин. совместных упоминаний для связи сущностей | 2 |
| knowledge.themeClusteringMinBlocks | Мин. блоков для кластеризации тем | 10 |
| knowledge.themeClusterMinSize | Мин. блоков в одной теме | 3 |
| knowledge.themeCosineThreshold | Порог отнесения блока к теме | 0.75 |
| knowledge.cardRollupV2DebounceMs | Задержка сборки карточек | 60000 мс |
| knowledge.meetingAnalyzeV2DebounceMs | Задержка анализа встречи | 5000 мс |
| knowledge.axisClassifyEnabled | Классификатор осей блока графа | вкл |
| graph.ageEnabled | Писать в графовую базу AGE | вкл |
| roleProfiles.minBlocks | Мин. блоков для профиля роли | 5 |

## Инсайты, идеи, навыки, портреты ролей
| Ключ | Что делает | Дефолт |
|---|---|---|
| knowledge.insightClusterThreshold | Порог группировки инсайтов | 0.8 |
| knowledge.insightFrequencyWindowDays | Окно подсчёта частоты инсайтов | 30 дн |
| knowledge.insightSpikeRatio | Во сколько раз рост = всплеск | 2.0 |
| insight.recheck_days | Через сколько перепроверять инсайт | 14 дн |
| insights.recheck.enabled | Рубильник перепроверки инсайтов | вкл |
| knowledge.ideaClusterThreshold | Порог дедупа идей | 0.85 |
| knowledge.ideaMinSupportersForCluster | Мин. сторонников для кластера идеи | 3 |
| knowledge.ideaDirectPathEnabled | Создавать идеи напрямую из блока встречи | вкл |
| ideas.feed.enabled | Рубильник ленты идей и авто-статуса | вкл |
| ideas.feed.rerank.weight | Вклад веса идеи в ранжирование ленты | 1 |
| ideas.feed.rerank.freshness | Вклад свежести в ленту | 0.5 |
| ideas.feed.rerank.goal_link | Бонус идее за привязку к цели | 0.75 |
| ideas.feed.freshness_days | Окно свежести идеи | 30 дн |
| knowledge.skillMinObservations | Мин. наблюдений для навыка | 3 |
| knowledge.skillTraitSimilarityThreshold | Порог слияния активных навыков | 0.85 |
| knowledge.skillLookbackMonths | Окно сбора данных по навыкам | 6 мес |
| knowledge.skillDecayMonths | Через сколько навык устаревает | 3 мес |
| knowledge.skillArchiveMonths | Через сколько навык в архив | 12 мес |
| knowledge.personaMinTraits | Мин. навыков для сборки портрета роли | 5 |
| knowledge.personaRoleAggMinPersons | Мин. людей для усреднения роли | 2 |
| knowledge.executablePersonaThresholdTraitsCount | Порог навыков для пересборки клона роли | 10 |
| knowledge.subjectAttributionEnabled | Проставлять автора блока знания | вкл |
| knowledge.subjectAttributionAllTypes | Автора — на все типы знания | вкл |

## Курация знаний (проверка/канонизация)
| Ключ | Что делает | Дефолт |
|---|---|---|
| knowledge.curationAutoThresholdDefault | Порог авто-канонизации знания | 0.85 |
| knowledge.curationDeepReviewThresholdDefault | Порог отправки на глубокую проверку | 0.6 |
| knowledge.curationProvisionalThresholdDefault | Порог предварительной AI-канонизации | 0.8 |
| knowledge.curationItemExpiryDays | Срок жизни элемента в очереди проверки | 30 дн |
| knowledge.curationStaleMonthsThreshold | Через сколько карточка устарела | 6 мес |
| knowledge.curationStaleDynamicScoreThreshold | Балл, ниже которого карточка устарела | 0.3 |
| knowledge.curationAiVerifierEnabled | AI-судья для важных типов знания | вкл |
| knowledge.curationAuditSampleRate | Доля авто-решений в аудит | 0.01 |
| knowledge.curationAutotuneEnabled | Самонастройка порогов по числу правок | вкл |
| knowledge.curationThresholdMin / Max | Границы самонастройки порога | 0.6 / 0.97 |
| knowledge.curationAutotuneStep | Шаг изменения порога | 0.02 |
| knowledge.curationMinDecisionsForAutotune | Мин. решений до самонастройки | 20 |
| knowledge.curationMaxProvisionalOverride | Порог правок, выключающий предв. уровень | 0.2 |
| knowledge.curationConflictArbiterEnabled | AI-арбитр авто-разрешения конфликтов | вкл |
| knowledge.curationConflictArbiterMinConfidence | Мин. уверенность для авто-резолва конфликта | 0.7 |
| knowledge.curationConflictArbiterBatchSize | Конфликтов за ночь | 20 |

## AI-чат и поиск
| Ключ | Что делает | Дефолт |
|---|---|---|
| knowledge.chatV2Enabled | Главный рубильник нового AI-чата | вкл |
| knowledge.chatV2TopBlocks | Сколько блоков подтягивать в чат | 20 |
| knowledge.chatV2GraphHops | Глубина обхода графа в чате | 2 |
| chat_v2.table_context_max_rows | Строк таблиц в контекст чата | 20 |
| chat_v2.table_context_max_tables | Таблиц максимум в контекст | 2 |
| chat_v2.feedback.enabled | Оценки ответов (палец вверх/вниз) | вкл |
| chat_v2.feedback.min_rated | Мин. оценок, ниже — helped-rate скрыт | 10 |
| chat_v2.feedback.retry_dedup_seconds | Окно склейки повторных вопросов | 30 сек |
| ai.answerCacheTtlSeconds | Срок кэша готовых ответов | 300 сек |
| ai.retrievalCacheTtlSeconds | Срок кэша результатов поиска | 60 сек |
| ai.multiQueryExpansionEnabled | Расширять запрос несколькими формулировками | вкл |
| ai.summarizerMessageThreshold | Со скольких сообщений сжимать диалог | 20 |
| ai.dialogSummarizerKeepLast | Сколько последних сообщений хранить | 10 |
| ai.dialogSummarizerStalenessHours | Через сколько диалог устарел | 24 ч |
| dialog_layer.query_history_pairs | Глубина истории для follow-up | 4 пары |

## Помощник (Concierge)
| Ключ | Что делает | Дефолт |
|---|---|---|
| concierge.enabled | Рубильник помощника | вкл |
| concierge.dialogLayerEnabled | Слой понимания/синтеза запроса | вкл |
| concierge.nativeToolsEnabled | Нативный вызов инструментов вместо regex | вкл |
| concierge.clarify_min_confidence | Ниже порога понимания — переспрашивает | 80 |
| concierge.history_pairs | Глубина истории диалога | 4 пары |
| concierge.prmEnabled | Боевой PRM-реранкер кандидатов | выкл |
| concierge.prmShadowEnabled | Теневой PRM (считает, не влияет) | выкл |
| concierge.prmTopK | Сколько верхних кандидатов берёт PRM | 3 |
| concierge.prmShadowSampleRate | Доля запросов под теневой PRM | 1.0 |
| concierge.dailyMessagesLimit | Дневной лимит сообщений | 100 |
| concierge.monthlyMessagesLimit | Месячный лимит сообщений | 3000 |
| concierge.sseHeartbeatSeconds | Интервал heartbeat потока | 15 сек |
| concierge.preRetrievalTopK | Блоков тянет pre-retrieval | 12 |
| concierge.preRetrievalTimeoutMs | Таймаут pre-retrieval | 3000 мс |

## Модели LLM, эмбеддинги, кэш
| Ключ | Что делает | Дефолт |
|---|---|---|
| ai.anthropic.model | LLM-модель Anthropic | claude-sonnet-4-6 |
| ai.vox.model | Модель распознавания речи (ASR) | v3_rnnt |
| ai.deepseek.defaultModel | LLM-модель DeepSeek по умолчанию | deepseek-v4-flash |
| ai.mainReport.primary | Провайдер главного отчёта встречи | deepseek |
| gepa.reflectionLm | LLM для рефлексии при эволюции промптов | deepseek-v4-pro |
| gepa.taskLm | LLM для исполнения задачи при эволюции промптов | deepseek-v4-pro |
| embeddings.provider | Поставщик векторизации | openai-proxy |
| embeddings.model | Модель векторизации | embeddinggemma:latest |
| embeddings.dimensions | Размерность вектора (менять с пересчётом) | 768 |
| embeddings.batchSize | Размер пачки на векторизацию | 32 |
| embeddings.chunkTargetTokens | Целевой размер куска текста | 600 |
| embeddings.chunkOverlapTokens | Перекрытие кусков | 80 |
| llm.cacheSmokeEnabled | Следить за долей попаданий в кэш промптов | вкл |
| llm.cacheHitRatioWarnThreshold | Ниже доли попаданий — предупреждение | 0.6 |
| ai.routerDispatchConcurrency | Параллельность раздачи задач по моделям | 5 |
| ai.routerMaxSpecialistsPerBlock | Макс. специалистов-агентов на блок | 4 |
| router.llmFallbackEnabled | LLM-фолбэк роутера специалистов | выкл |
| router.fallbackNegativeTtlSeconds | Сколько помнить, что провайдер упал | 60 сек |
| router.fallbackCacheTtlSeconds | Срок хранения решений фолбэка | 86400 сек |

## AI-функции анализа встречи и защита
| Ключ | Что делает | Дефолт |
|---|---|---|
| aiFeatures.includeRoomChat | Учитывать чат комнаты в анализе | вкл |
| aiFeatures.transcriptCleaningLlmRefine | Дочищать расшифровку через LLM | вкл |
| aiFeatures.behaviorMetricsLlmRefine | Уточнять метрики поведения через LLM | выкл |
| aiFeatures.summaryAgentEnabled | Старый агент сводки | вкл |
| aiFeatures.promptInjectionGuardEnabled / ai.promptInjectionGuardEnabled | Защита от инъекций в промпт | вкл |
| ai.extractionEnableTopLevel | Авто-извлечение миссии/видения/стратегии | выкл |
| ai.extractionTypedEntityMinConfidence | Нижний порог уверенности извлечения сущностей | 0.6 |
| ai.contextualizerConfidenceMin | Нижний порог уверенности контекстуализатора | 0.6 |

## Probe (проактивные уточняющие вопросы)
| Ключ | Что делает | Дефолт |
|---|---|---|
| probe.digestEnabled | Рубильник ежедневной сводки вопросов | вкл |
| probe.digestHourUtc | Час отправки сводки (UTC) | 9 |
| probe.digestTouchCap | Макс. вопросов в одной сводке | 5 |
| probe.digestFormulateEnabled | Формулировать вопросы через LLM | вкл |
| probe.valueGateEnabled | LLM-гейт «стоит ли вообще спрашивать» | вкл |
| probe.minValuePriority | Ниже порога ценности вопрос не задаётся | 30 |
| probe.immediatePushMinPriority | Порог важности для немедленного пуша | 70 |
| probe.qualityJudgeEnabled | LLM-судья качества формулировки | вкл |
| probe.engagementRoutingEnabled | Слать самому отзывчивому из кандидатов | вкл |
| probe.adaptiveFatigueEnabled | Реже спрашивать тех, кто не отвечает | вкл |
| probe.topicCooldownHours | Пауза перед повтором темы | 48 ч |
| probe.semanticDedupEnabled | Смысловой дедуп похожих вопросов | вкл |
| probe.semanticDedupThreshold | Порог смыслового дедупа | 0.92 |
| probe.semanticDedupWindowHours | Окно поиска похожих вопросов | 72 ч |
| probe.dedupTtlHours | Не повторять тот же вопрос раньше срока | 72 ч |
| probe.reaskEnabled | Один переспрос перед закрытием | вкл |
| probe.responseClassifyEnabled | Распознавать свободный ответ | вкл |
| probe.responseClassifyMinConfidence | Порог распознавания ответа | 0.5 |
| probe.subjectAddressingEnabled | Спрашивать про сотрудника его самого | вкл |
| probe.voiceInputEnabled | Голосовой ввод ответа | вкл |
| probe.rateLimitPerHour / PerDay | Лимит вопросов человеку в час / сутки | 5 / 20 |
| probe.expiryDays | Срок жизни неотвеченного вопроса | 14 дн |
| probe.coldStartModeHours | Щадящий режим для новичка | 24 ч |
| probe.quietHoursDefaultTzOffsetMin | Часовой пояс тихих часов по умолчанию | 180 (UTC+3) |

## Операционные агенты (COO-слой) — рубильники и пороги
| Ключ | Что делает | Дефолт |
|---|---|---|
| operations.daily_digest.enabled | Дневной отчёт операционного директора | вкл |
| betaOps.monthlyDigestEnabled | «Месяц компании» — месячный отчёт владельца (kill-switch) | вкл |
| betaOps.monthlyDigestLocalHour | Час доставки месячного отчёта (1-е число, МСК) | 6 |
| operations.report_archive.recent_limit | Размер архива «Недавние отчёты» в навигаторе периодов | 12 |
| operations.daily_digest.deliver_to_webpush | Утренний web-push «Требует тебя сегодня» | вкл |
| operations.dashboard_rework.enabled | Новая раскладка COO-дашборда | вкл |
| operations.per_person_self_view.enabled | Self-просмотр своего план-факта | вкл |
| operations.blocker_synthesis.enabled | Дневной синтез блокеров | вкл |
| operations.decision_controller.enabled | Контролёр внедрения решений | вкл |
| operations.promise_cascade.enabled | Дневной каскад обещаний | вкл |
| operations.knowledge_at_risk.enabled | Синтез «знание под риском» | вкл |
| operations.team_capacity.enabled | Агрегат загрузки команд | вкл |
| operations.onboarding_ramp.enabled | Дневной онбординг новичка | вкл |
| operations.customer_risk_radar.enabled | Радар клиентов под риском | вкл |
| operations.portfolio_health.enabled | Здоровье портфеля целей | вкл |
| operations.value_recap.enabled | Месячная витрина пользы | вкл |
| operations.personal_daily_brief.enabled | Дневной бриф «Твой день» | вкл |
| operations.personal_daily_brief.morning_hour | Час отправки брифа | 9 |
| operations.knows_who.enabled | Помощник «кто знает X» | вкл |
| knows_who.min_confidence | Порог похожести для носителя знания | 0.5 |
| decision.stale_days | Дней без движения → решение «не двигается» | 21 |
| blocker_synthesis.lookback_days | Окно поиска повторов блокеров | 7 дн |
| blocker_synthesis.recurring_days | С какого дня кластер блокеров хронический | 2 дн |
| team_capacity.overload_percent / underload_percent | Пороги пере-/недозагрузки отдела | 120% / 50% |
| onboarding.silent_days | Дней молчания новичка до «застрял» | 5 |
| goals.author_coverage_min | Доля обещаний с автором, иначе атрибуция на адресата | 0.6 |
| reliability.min_denominator | Сколько обещаний нужно, иначе «мало данных» | 3 |

## Здоровье портфеля целей · Риск клиентов
| Ключ | Что делает | Дефолт |
|---|---|---|
| portfolio.health.threshold_healthy / _warning | Границы «здоров» / «внимание» | 60 / 40 |
| portfolio.health.weight_achieved / on_track / at_risk / stalled / dropped | Баллы статусов цели | 100 / 80 / 40 / 0 / 0 |
| customer_risk.window_days | Окно накопления клиентских сигналов | 14 дн |
| customer_risk.weight.churn_risk / objection / pain / feature_request | Веса сигналов риска | 5 / 3 / 2 / 1 |
| customer_risk.threshold.critical / warning | Пороги «критический» / «повышенный» | 10 / 4 |

## Цели и трекер задач
| Ключ | Что делает | Дефолт |
|---|---|---|
| tracker.autoAcceptConfidenceThreshold | Порог авто-создания задачи из встречи | 0.75 |
| tracker.goalAlignmentLowEnabled | Детектор слабой связи задач с целями | вкл |
| meetings.taskDedupeEnabled | Удалять черновую задачу-дубль | выкл |
| meetings.taskDedupeThreshold | Порог схожести заголовков задач | 0.85 |
| knowledge.meetingTasksToTrackerOnly | Задача из встречи только в трекер | вкл |
| goals.themeAutolinkMinWeight | Порог авто-привязки темы к цели | 0.15 |
| goals.themeAutolinkLlmEnabled | LLM-проверка спорной привязки тем | выкл |
| goals.goalTaskLinkEnabled | LLM-привязка задач встречи к цели | выкл |
| goals.pulse.enabled | Еженедельный пульс целей | вкл |
| goals.pulse.deliver_to_telegram | Слать пульс целей в Telegram | выкл |

## Курация/таблицы (умные таблицы — агент)
| Ключ | Что делает | Дефолт |
|---|---|---|
| feature.tables_text_to_schema | Создание таблиц по текстовому описанию | вкл |
| table.agent.confirmation_threshold | Порог авто-заполнения пустой ячейки | 0.85 |
| table.agent.max_concurrent_enrich_jobs_per_org | Лимит задач агента таблиц на компанию | 100 |
| table.agent.max_daily_tokens | Дневной бюджет токенов агента таблиц | 1 000 000 |
| table.import.dedup_threshold | Порог слияния схем при импорте | 0.85 |

## Хранение данных и логи
| Ключ | Что делает | Дефолт |
|---|---|---|
| retention.defaultDays | Срок хранения данных по умолчанию | 30 дн |
| retention.softDeleteGraceDays | Льгота после мягкого удаления | 30 дн |
| retention.webhookDeliveryDays | Хранить журналы доставки вебхуков | 30 дн |
| retention.shareViewDays | Хранить просмотры публичных ссылок | 90 дн |
| retention.apiAccessLogDays | Хранить журнал доступа к API | 30 дн |
| retention.sweepBatchSize | Размер пачки очистки | 500 |
| retention.rawEventsEnabled | Удалять сырые события по сроку | выкл |
| retention.auditEnabled | Удалять аудит по сроку | выкл |
| retention.chatEnabled | Удалять историю чата по сроку | вкл |
| retention.blocksEnabled | Удалять блоки знаний по сроку | выкл |
| provenance.voiceNoteAudioRetentionDays | Хранить аудио голосовых в S3 | 90 дн |
| provenance.voiceNoteAudioPresignTtlSeconds | Срок ссылки на аудио в дровере | 600 сек |
| logging.dbLoggingEnabled | Писать логи приложения в базу | вкл |
| logging.minLevel | Мин. уровень логов в базу | INFO |
| logging.batchSize | Размер пачки записи логов | 50 |
| logging.flushIntervalMs | Интервал сброса буфера логов | 5000 мс |
| logging.maxBufferSize | Предел буфера логов | 5000 |
| logging.retentionDays | Срок хранения логов в базе | 30 дн |
| logging.logStackTraces | Сохранять стектрейсы | вкл |
| logging.requestBodyLogging | Логировать тело запросов (ПДн!) | выкл |
| logging.responseBodyLogging | Логировать тело ответов (ПДн!) | выкл |
| logging.logSuccessfulRequests | Логировать успешные запросы | выкл |
| logging.slowRequestThresholdMs | Порог «медленного запроса» | 2000 мс |

## Каналы общения (Telegram / MAX / email / chatbox)
| Ключ | Что делает | Дефолт |
|---|---|---|
| conversational.outboundConcurrency | Параллельность отправки в каналы | 5 |
| conversational.rateLimitDefaultPerHour | Лимит уведомлений человеку в час | 20 |
| conversational.maxDeliveryAttempts | Сколько раз пытаться доставить | 5 |
| conversational.quietHoursDefault | Окно тихих часов по умолчанию | 22:00–08:00 |
| conversational.linkCodeTtlSec | Срок жизни кода привязки канала | 900 сек |
| conversational.inactiveBindingDays | Через сколько привязка неактивна | 30 дн |
| conversational.botVoiceEnabled | Приём голосовых в бота | вкл |
| conversational.botDocumentEnabled | Приём документов в бота | вкл |
| conversational.botIntentClassifierEnabled | LLM-распознавание намерения в боте | вкл |
| conversational.telegramGlobalRps / maxBotGlobalRps | Лимит запросов/сек к Telegram / MAX | 25 / 25 |
| conversational.telegramDigestHourLocal | Час доставки Telegram-дайджеста | 9 |
| chatbox.enabled | Интеграция ChatBox | вкл |
| chatbox.session.idle_gap_hours | Пауза до новой сессии чата | 12 ч |
| notifications.daily_budget.enabled | Дневной лимит push | вкл |
| notifications.daily_budget.per_person | Push в день одному сотруднику | 5 |
| notifications.quiet_hours.start / end | Тихие часы push | 22 / 8 |
| notifications.binding_campaign.enabled | Кампания привязки Telegram | вкл |

## Документы, почта, вебхуки
| Ключ | Что делает | Дефолт |
|---|---|---|
| documents.parseTimeoutMs | Таймаут разбора документа | 30000 мс |
| documents.maxSizeMb | Макс. размер документа | 50 МБ |
| documents.maxFilesPerUpload | Файлов за одну загрузку | 20 |
| documents.acceptedFormats | Разрешённые форматы | pdf,docx,xlsx,… |
| documents.ai_attribution.enabled | LLM-подсказка типа и темы документа | вкл |
| mail.dryRun | Сухой прогон почты (только в лог) | выкл |
| mail.inboxEnabled | Опрос почтового ящика (IMAP) | выкл |
| emailFetch.enabled | Загрузка писем в граф | выкл |
| webhook.deliveryTimeoutMs | Таймаут доставки вебхука | 10000 мс |
| webhook.maxAttempts | Повторов доставки вебхука | 5 |
| webhook.retentionDays | Хранить журнал доставок | 14 дн |

## Безопасность и сессии
| Ключ | Что делает | Дефолт |
|---|---|---|
| security.magicLinkTtlMinutes | Срок ссылки для входа | 15 мин |
| security.magicLinkRateLimitPerHour | Лимит запросов ссылки на email в час | 5 |
| security.inviteTtlDays | Срок жизни приглашения | 14 дн |
| security.inviteReminderDays | На какой день напомнить о приглашении | 7 |
| security.sessionTtlSeconds | Срок жизни сессии | 30 дн |
| security.adminSessionTtlSeconds | Срок админской сессии | 4 ч |
| security.deepLinkTtlSeconds | Срок глубокой ссылки | 24 ч |
| security.cryptoMasterKeyRotationDays | Период смены мастер-ключа шифрования | 365 дн |
| security.argonMemoryKb / Iterations / Parallelism | Параметры хеширования паролей | 65536 / 3 / 1 |

## Биллинг (тариф «Стандарт»)
| Ключ | Что делает | Дефолт |
|---|---|---|
| billing.baseMonthlyKopecks | Базовая цена тарифа в месяц | 60 000 ₽ |
| billing.baseSeatsIncluded | Мест в базовом тарифе | 31 |
| billing.perExtraSeatKopecks | Цена доп. места в месяц | 1 000 ₽ |
| billing.baseMeetingsGrant | Грант встреч в месяц на компанию | 150 |
| billing.perExtraSeatMeetingsGrant | Доп. встреч за доп. место | 5 |
| billing.meetingUploadsPerMonth | Лимит ручных загрузок встреч в месяц | 20 |
| billing.yearlyDiscountRate | Скидка при годовой оплате | −20% |

## Рабочие часы и время
| Ключ | Что делает | Дефолт |
|---|---|---|
| work_hours_default_start / end | Рабочий день по умолчанию | 9 / 18 |
| work_days_default | Рабочие дни недели | Пн–Пт |
| default_timezone | Таймзона по умолчанию | Europe/Moscow |
| betaOps.morningLocalHour / eveningLocalHour | Часы утреннего / вечернего чек-ина | 9 / 18 |
| betaOps.weeklyDigestLocalHour / LocalDay | Час и день недельного COO-дайджеста | 8 / Пн |
| betaOps.dailyDigestHourUtc | Час дневного COO-дайджеста (UTC) | 22 |
| betaOps.commitmentFollowupLocalHour | Час напоминания о коммитментах | 9 |

## Прочие рубильники интерфейса
| Ключ | Что делает | Дефолт |
|---|---|---|
| dashboard.main_rework.enabled | Новая компоновка главной директора | вкл |
| knowledge_base.redesign.enabled | Новая раскладка раздела «База знаний» | вкл |
| me.daily_value_widgets.enabled | Виджеты ценности в разделе «Я» | вкл |
| support_critic_min_groundedness | Порог обоснованности черновика клона поддержки | 0.6 |
| support_promote_min_csat | Мин. оценка клиента для обучения клона поддержки | 4/5 |

---

## Чего ЕЩЁ нет в админке (долг Ф3)
~240 ENV-крутилок (читаются из `env.schema`, не редактируются из админки) + 60-90 хардкод-констант: домены skill/clone/persona, betaOps-остаток, tracker/governance, dialog-layer/insights/budget/recording, пороги в SQL knowledge-core, dashboard-пороги. Перенос — `plans/tz/2026-06-21-config-knobs-remaining-waves.md` (волны W1-W6, после решения владельца по Фазе 0). Расписания `*_CRON` и concurrency **намеренно остаются в ENV**.

> ⚠️Ф3 — у ключа известно расхождение сид vs env.schema (`distillMergeThreshold` 0.85/0.92); каноническое значение определяется в Фазе 0 ТЗ. Пояснение простыми словами — `plans/analysis/2026-06-21-config-knobs-divergence-PLAIN.md`.
