import { Inject, Injectable } from '@nestjs/common';

import { KieService } from '../../kie.service';
import type { LlmCompleteInput, LlmCompleteOutput } from '../../llm.types';
import { LlmError } from '../../llm.types';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

@Injectable()
export class KieProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'kie-native';

  constructor(@Inject(KieService) private readonly kie: KieService) {}

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    try {
      return await this.kie.complete(input, {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        defaultHeaders: provider.defaultHeaders,
        timeoutMs: provider.timeoutMs,
      });
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LlmError(`kie-native ${provider.name}: ${message}`, undefined, err);
    }
  }
}
