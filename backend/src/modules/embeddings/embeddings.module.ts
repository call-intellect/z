import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { S3Service } from '../recordings/s3.service';

import { EmbeddingFallbackService } from './services/embedding-fallback.service';
import { LocalEmbeddingService } from './services/local-embedding.service';
import { OpenAiProxyEmbeddingService } from './services/openai-proxy-embedding.service';
import { TranscriptIndexerService } from './services/transcript-indexer.service';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    S3Service,
    OpenAiProxyEmbeddingService,
    LocalEmbeddingService,
    EmbeddingFallbackService,
    TranscriptIndexerService,
  ],
  exports: [
    OpenAiProxyEmbeddingService,
    LocalEmbeddingService,
    EmbeddingFallbackService,
    TranscriptIndexerService,
  ],
})
export class EmbeddingsModule {}
