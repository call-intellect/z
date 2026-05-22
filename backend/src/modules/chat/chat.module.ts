import { Module } from '@nestjs/common';

import { CardsModule } from '../cards/cards.module';

import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';

/**
 * AI-чат: single-meeting (context-stuffing) + cross-meeting (RAG) +
 * card-chat (RAG в рамках встреч одной карточки).
 *
 * Зависит от глобальных:
 *   - `LlmRouterService` (AiModule)
 *   - `EmbeddingFallbackService` (AiModule, реэкспорт из EmbeddingsModule)
 *   - `QuotaService`
 *   - `BusinessMetricsService`
 *   - `PrismaService`
 *   - `CardsService` (CardsModule) — для проверки ownership карточки.
 *
 * @deprecated SBA α-5 — используйте `ChatV2Module` (`POST /api/v1/chat-v2/messages`).
 *   Этот модуль остаётся для обратной совместимости с UI /chat и legacy API.
 *   Удаление — отдельный sub-TZ позже.
 */
@Module({
  imports: [CardsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatRepository],
  exports: [ChatService],
})
export class ChatModule {}
