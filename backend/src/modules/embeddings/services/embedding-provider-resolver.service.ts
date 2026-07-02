import { Inject, Injectable, Logger } from '@nestjs/common';

import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface ResolvedEmbeddingProvider {
  name: string;
  baseUrl: string;
  protocolKind: string;
  apiKey: string | null;
  model: string;
  dimensions: number;
}

@Injectable()
export class EmbeddingProviderResolverService {
  private readonly logger = new Logger(EmbeddingProviderResolverService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  async resolveChain(): Promise<ResolvedEmbeddingProvider[]> {
    const providers = await this.prisma.embeddingProvider.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { priority: 'asc' },
      include: {
        models: {
          where: { isActive: true, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const resolved: ResolvedEmbeddingProvider[] = [];
    for (const provider of providers) {
      const model = provider.models[0];
      if (!model) {
        this.logger.warn(`resolveChain: провайдер ${provider.name} без активных моделей — пропущен`);
        continue;
      }

      let apiKey: string | null = null;
      if (provider.apiKeyEncrypted) {
        try {
          apiKey = this.crypto.decrypt(provider.apiKeyEncrypted);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `resolveChain: не удалось расшифровать ключ провайдера ${provider.name} (${message}) — пропущен`,
          );
          continue;
        }
      }

      resolved.push({
        name: provider.name,
        baseUrl: provider.baseUrl,
        protocolKind: provider.protocolKind,
        apiKey,
        model: model.modelKey,
        dimensions: model.dimensions,
      });
    }

    return resolved;
  }
}
