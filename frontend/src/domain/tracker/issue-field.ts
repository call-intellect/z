export const ISSUE_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "checkbox",
  "status",
  "selectSingle",
  "selectMulti",
  "person",
  "url",
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

export interface IssueFieldDefApi {
  id: string;
  projectId: string | null;
  name: string;
  type: string;
  config: IssueFieldConfig;
  order: number;
  archivedAt: string | null;
  createdAt: string;
}

export interface IssueFieldValueApi {
  id: string;
  issueId: string;
  fieldId: string;
  value: unknown;
}

export interface IssueFieldDef {
  id: string;
  projectId: string | null;
  name: string;
  type: IssueFieldType;
  config: IssueFieldConfig;
  order: number;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface IssueFieldValue {
  id: string;
  issueId: string;
  fieldId: string;
  value: unknown;
}

export const ISSUE_FIELD_TYPE_LABELS: Record<IssueFieldType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  checkbox: "Флажок",
  status: "Статус",
  selectSingle: "Выбор (один)",
  selectMulti: "Выбор (несколько)",
  person: "Человек",
  url: "Ссылка",
};

function parseFieldType(value: string): IssueFieldType {
  return (ISSUE_FIELD_TYPES as readonly string[]).includes(value)
    ? (value as IssueFieldType)
    : "text";
}

export function issueFieldDefFromApi(api: IssueFieldDefApi): IssueFieldDef {
  return {
    id: api.id,
    projectId: api.projectId,
    name: api.name,
    type: parseFieldType(api.type),
    config: api.config ?? {},
    order: api.order,
    archivedAt: api.archivedAt ? new Date(api.archivedAt) : null,
    createdAt: new Date(api.createdAt),
  };
}

export function issueFieldValueFromApi(
  api: IssueFieldValueApi,
): IssueFieldValue {
  return {
    id: api.id,
    issueId: api.issueId,
    fieldId: api.fieldId,
    value: api.value,
  };
}

export function formatIssueFieldValue(
  def: IssueFieldDef,
  value: unknown,
): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (def.type) {
    case "checkbox":
      return value === true ? "Да" : "Нет";
    case "date":
      return typeof value === "string"
        ? new Date(value).toLocaleDateString("ru-RU")
        : "—";
    case "status":
    case "selectSingle": {
      const opt = def.config.options?.find((o) => o.id === value);
      return opt?.name ?? String(value);
    }
    case "selectMulti": {
      if (!Array.isArray(value)) return "—";
      const names = value.map((id) => {
        const opt = def.config.options?.find((o) => o.id === id);
        return opt?.name ?? String(id);
      });
      return names.length > 0 ? names.join(", ") : "—";
    }
    default:
      return String(value);
  }
}
