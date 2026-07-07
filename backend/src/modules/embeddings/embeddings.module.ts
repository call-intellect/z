import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { S3Service } from '../recordings/s3.service';

import { EmbeddingFallbackService } from './services/embedding-fallback.service';
import { EmbeddingProviderResolverService } from './services/embedding-provider-resolver.service';
import { LocalEmbeddingService } from './services/local-embedding.service';
import { OpenAiProxyEmbeddingService } from './services/openai-proxy-embedding.service';
import { TranscriptIndexerService } from './services/transcript-indexer.service';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule, CryptoModule],
  providers: [
    S3Service,
    OpenAiProxyEmbeddingService,
    LocalEmbeddingService,
    EmbeddingProviderResolverService,
    EmbeddingFallbackService,
    TranscriptIndexerService,
  ],
  exports: [
    OpenAiProxyEmbeddingService,
    LocalEmbeddingService,
    EmbeddingProviderResolverService,
    EmbeddingFallbackService,
    TranscriptIndexerService,
  ],
})
export class EmbeddingsModule {}
