---
status: in_progress
date: 2026-05-20
audience: virtual_ceo_team
---

# Дайджест: что реально есть в продукте Z

## 1. Технологический стек

Frontend: React/Next.js + LiveKit Components, домен meet.crossmark.ru
Backend: NestJS, PostgreSQL с pgvector, Redis, BullMQ
Медиа: LiveKit SFU, Egress (Composite+Track), TURN отдельно
Storage: Selectel S3 (prod), MinIO (dev)
AI: GigaAM Vox (ASR), Claude Sonnet 4.6 (LLM), text-embedding-3-small (embeddings)

## 2. Что работает в проде (MVP)

Встречи: 9 типов (team, standup, plan_fact, project, sales, custdev, partner, interview, customer_success)
Запись: общая (видео+звук) + отдельные дорожки на каждого участника
AI-pipeline: chapters, tasks, embeddings, RawEvent (для knowledge-core)
Knowledge Core Фазы 0-4 полностью в prod: IdeaBlock, Entity, Theme, граф связей, search API
CRM-карточки: client/deal/project/topic/custom с автоматическим rollup
Director Dashboard: 6 виджетов + AI-чат
Meeting Workspace: 9 cross-cutting модулей (chat, api-keys, webhooks, exports, quotas, security, audit)
Z-Admin: LLM-маршруты, аналитика, A/B-эксперименты
Тарифы: basic/pro/enterprise с гейтингом фич и квотами

## 3. Архитектурные моаты

LiveKit только медиа (токены от backend, гость без секретов)
Отдельные дорожки (спикер через participant_id)
Event Sourcing (история слияния блоков)
Per-Org Knowledge Graph (разделение по tenant)
Self-hosted опция (MinIO, Ollama, GigaAM)

## 4. AI-pipeline в деталях

ASR: GigaAM Vox (v3_rnnt, диаризация OFF, cost 0.002-0.004 USD/min)
LLM: Claude Sonnet 4.6 (prompt caching, контекст >=1M, cost $0.08-0.12 per meeting)
LlmRouter: DB-конфигурируемо, fallback chain, A/B-эксперименты, логирование (AiUsageLog)
Workers: 40+ taskType, concurrency 1-2, crons для async

## 5. Биллинг

Tiers: basic (50 встреч, 5k блоков, 30 чат/день), pro (500, 50k, 300), enterprise (5000, 500k, 3000)
Retention per-Org: 2555 дней (7 лет под 152-ФЗ), 90 дней для chat, 730 для audit
Потребление: встречи, чат, блоки, ingest-bytes

## 6. Security & Compliance

152-ФЗ: retention policies, right to erase (DELETE /api/v1/persons/:id/data)
DataClass routing: public < internal < sensitive < private
Encryption: AES-256-GCM для secrets
SSRF-Guard: private CIDR, link-local, cloud-metadata
Audit: SuperAdminAccessLog, BusinessMetrics (core_*)

## 7. Что НЕ готово на фронте (Ф5-12)

Themes (browse/manage), Graph (визуализация), Block-linker (ручное создание links)
Goals & Strategy UI, Sources CRUD (edit), Persons erase (152-ФЗ), Retention settings
Backend 100% готов, UI нет.

## 8. Топ-15 фишек

Специализированные отчёты (9 типов), отдельные дорожки (ASR), автотемы
Event Sourcing, Knowledge Graph, CRM-карточки+rollup, Director Dashboard
Public API+webhooks, self-hosted, prompt caching, AES-256-GCM
Per-Org tier, RBAC+Casbin, Strategic Alignment

## 9. Технический долг

Egress Feb 2026 может давать потрескивания (проверить WER)
host networking LiveKit (1 под/ноду), Egress НЕ с SFU (CPU)
Yandex SpeechKit округляет 15-сек блоки, LiveKit-вебхуки могут приходить дважды

## 10. Capacity & Infrastructure

64 ядра: 80-100 одновременных встреч (80-150 после тестов)
Monitoring: Prometheus+Grafana
Требование: разделять SFU/Egress/Backend/DB/Storage

## Финальный вывод

Готово к GTM (MVP): 9 типов встреч, Knowledge Core Ф0-4, CRM, Dashboard, API, Admin, Tariffs, 152-ФЗ
НЕ готово: фронт для Ф5-12 (но backend 100% готов)
На путь к 700 млн рублей: ценность есть, инфра готова, security готова, scale спроектирована

Дата: 20 мая 2026
