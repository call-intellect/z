SET search_path TO public;

-- Deferred-retry для BlockIngestWorker: когда LlmRouter бросает
-- NoEligibleProviderError / LlmRouterDefaultChainInvalidError (провайдеров нет
-- в llm_providers или defaultChain не настроен) — RawEvent уходит в
-- `deferred` вместо `failed`. Когда провайдер появляется в БД — новый
-- RawEventDeferredRecoveryService re-енкеит отложенные в очередь.
--
-- Аддитивное изменение enum: ADD VALUE не требует USING, существующие
-- записи со статусом received/ingested/failed остаются валидными.
ALTER TYPE "RawEventProcessingStatus" ADD VALUE 'deferred';
