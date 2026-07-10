export interface ProxyConnectionConfig {
  baseUrl: string;
  prefix: string;
}

export interface EffectiveConnectionInput {
  baseUrl: string;
  apiKey: string | null;
  useProxy: boolean;
  proxyPath: string | null;
  protocolKind?: string;
}

export interface EffectiveConnection {
  baseUrl: string;
  apiKey: string | null;
}

export const PROTOCOLS_APPENDING_OWN_PATH = new Set(['anthropic-messages', 'kie-native']);

export function proxyRootUrl(proxy: ProxyConnectionConfig): string {
  return proxy.baseUrl.replace(/\/v1\/?$/, '');
}

export function resolveEffectiveConnection(
  input: EffectiveConnectionInput,
  proxy: ProxyConnectionConfig,
): EffectiveConnection {
  if (!input.useProxy) {
    return { baseUrl: input.baseUrl, apiKey: input.apiKey };
  }
  const apiKey = input.apiKey ? `${proxy.prefix}:${input.apiKey}` : input.apiKey;
  const root = proxyRootUrl(proxy);
  if (input.protocolKind && PROTOCOLS_APPENDING_OWN_PATH.has(input.protocolKind)) {
    return {
      baseUrl: input.proxyPath ? `${root}/${input.proxyPath}` : root,
      apiKey,
    };
  }
  return {
    baseUrl: input.proxyPath ? `${root}/${input.proxyPath}/v1` : proxy.baseUrl,
    apiKey,
  };
}
