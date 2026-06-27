import type { ContextHeaderInput } from './chunk-context.service';

const COMPANY_ENTITY_TYPES = new Set<string>([
  'customer',
  'vendor',
  'client',
  'market',
  'org_unit',
]);

export function isCompanyEntityType(type: string): boolean {
  return COMPANY_ENTITY_TYPES.has(type);
}

export function resolveContextHeaderTitle(args: {
  sourceTitle?: string | null;
  payloadTitle?: string | null;
  sourceExternalId?: string | null;
  fallback: string;
}): string {
  const fromEvent = args.sourceTitle?.trim();
  if (fromEvent && fromEvent.length > 0) return fromEvent.slice(0, 500);
  const fromPayload = args.payloadTitle?.trim();
  if (fromPayload && fromPayload.length > 0) return fromPayload.slice(0, 500);
  const ext = args.sourceExternalId?.trim();
  if (ext && ext.length > 0) return ext.slice(0, 500);
  return args.fallback.slice(0, 500);
}

export function makeContextHeaderInput(parts: {
  sourceTitle?: string | null;
  companies?: string[];
  participants?: string[];
  meetingType?: string | null;
  meetingDateIso?: string | null;
}): ContextHeaderInput {
  return {
    sourceTitle: parts.sourceTitle ?? null,
    companies: parts.companies ?? [],
    participants: parts.participants ?? [],
    meetingType: parts.meetingType ?? null,
    meetingDateIso: parts.meetingDateIso ?? null,
  };
}
