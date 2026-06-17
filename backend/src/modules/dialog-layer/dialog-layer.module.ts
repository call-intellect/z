import { Global, Module } from '@nestjs/common';

import { AnswerCacheService } from './services/answer-cache.service';
import { CacheInvalidationService } from './services/cache-invalidation.service';
import { DialogService } from './services/dialog.service';
import { MultiQueryExpansionService } from './services/multi-query-expansion.service';
import { QueryClassifierService } from './services/query-classifier.service';
import { QueryPlanExtractorService } from './services/query-plan-extractor.service';
import { RetrievalCacheService } from './services/retrieval-cache.service';
import { ConversationSummarizerCron } from './workers/conversation-summarizer.cron';

@Global()
@Module({
  providers: [
    QueryClassifierService,
    QueryPlanExtractorService,
    MultiQueryExpansionService,
    AnswerCacheService,
    RetrievalCacheService,
    DialogService,
    CacheInvalidationService,
    ConversationSummarizerCron,
  ],
  exports: [
    DialogService,
    AnswerCacheService,
    RetrievalCacheService,
    CacheInvalidationService,
    QueryClassifierService,
    QueryPlanExtractorService,
  ],
})
export class DialogLayerModule {}
