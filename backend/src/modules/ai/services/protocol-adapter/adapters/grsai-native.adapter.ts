import { Inject, Injectable } from '@nestjs/common';

import { GrsaiService } from '../../grsai.service';
import type { LlmCompleteInput, LlmCompleteOutput } from '../../llm.types';
import { LlmError } from '../../llm.types';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

@Injectable()
export class GrsaiProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'grsai-native';

  constructor(@Inject(GrsaiService) private readonly grsai: GrsaiService) {}

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    try {
      return await this.grsai.complete(input, {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        defaultHeaders: provider.defaultHeaders,
        timeoutMs: provider.timeoutMs,
      });
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(`grsai-native ${provider.name}: ${message}`, undefined, err);
    }
  }
}
