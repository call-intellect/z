export const ISSUE_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'checkbox',
  'status',
  'selectSingle',
  'selectMulti',
  'person',
  'url',
] as const;

export type IssueFieldType = (typeof ISSUE_FIELD_TYPES)[number];

export interface IssueFieldOption {
  id: string;
  name: string;
  color?: string;
}

export interface IssueFieldConfig {
  options?: IssueFieldOption[];
}

export interface FieldValueValidationResult {
  ok: boolean;
  reason?: string;
  normalized?: unknown;
}

export function isIssueFieldType(value: string): value is IssueFieldType {
  return (ISSUE_FIELD_TYPES as readonly string[]).includes(value);
}

function optionIds(config: IssueFieldConfig): Set<string> {
  return new Set((config.options ?? []).map((o) => o.id));
}

const URL_RE = /^https?:\/\/[^\s]+$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export function validateIssueFieldValue(
  type: IssueFieldType,
  config: IssueFieldConfig,
  value: unknown,
): FieldValueValidationResult {
  if (value === null || value === undefined) {
    return { ok: true, normalized: null };
  }

  switch (type) {
    case 'text':
    case 'url': {
      if (typeof value !== 'string') {
        return { ok: false, reason: 'expected_string' };
      }
      if (type === 'url' && value.length > 0 && !URL_RE.test(value)) {
        return { ok: false, reason: 'invalid_url' };
      }
      return { ok: true, normalized: value };
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return { ok: false, reason: 'expected_number' };
      }
      return { ok: true, normalized: value };
    }
    case 'checkbox': {
      if (typeof value !== 'boolean') {
        return { ok: false, reason: 'expected_boolean' };
      }
      return { ok: true, normalized: value };
    }
    case 'date': {
      if (typeof value !== 'string') {
        return { ok: false, reason: 'expected_iso_date' };
      }
      if (!ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
        return { ok: false, reason: 'invalid_date' };
      }
      return { ok: true, normalized: value };
    }
    case 'person': {
      if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, reason: 'expected_person_id' };
      }
      return { ok: true, normalized: value };
    }
    case 'status':
    case 'selectSingle': {
      if (typeof value !== 'string') {
        return { ok: false, reason: 'expected_option_id' };
      }
      if (!optionIds(config).has(value)) {
        return { ok: false, reason: 'option_not_in_config' };
      }
      return { ok: true, normalized: value };
    }
    case 'selectMulti': {
      if (!Array.isArray(value)) {
        return { ok: false, reason: 'expected_option_id_array' };
      }
      const allowed = optionIds(config);
      for (const item of value) {
        if (typeof item !== 'string' || !allowed.has(item)) {
          return { ok: false, reason: 'option_not_in_config' };
        }
      }
      return { ok: true, normalized: value };
    }
    default: {
      return { ok: false, reason: 'unknown_type' };
    }
  }
}
