import 'reflect-metadata';

export interface ConciergeToolOptions {
  description?: string;
  undoableVia?: string;
  rbacHint?: string;
  mutating?: boolean;
}

export const CONCIERGE_TOOL_METADATA_KEY = Symbol('CONCIERGE_TOOL');

export function ConciergeTool(options: ConciergeToolOptions = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(CONCIERGE_TOOL_METADATA_KEY, options, target, propertyKey);
  };
}
