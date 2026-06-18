import { z, type ZodTypeAny } from "zod";

export type SecuritySpec = {
  key: string;
  label: string;
  description?: string;
  schema: ZodTypeAny;
  defaultValue: number;
};

const positiveInt = (def: number, min = 1, max?: number) => {
  let s = z.number().int().min(min);
  if (typeof max === "number") s = s.max(max);
  return s.default(def);
};

export const SECURITY_SETTINGS: SecuritySpec[] = [
  {
    key: "security.argon_memory_kb",
    label: "Argon2: память (КБ)",
    description:
      "Объём RAM для одного hash-вызова. Чем больше — тем дольше brute-force.",
    schema: positiveInt(65536, 1024, 2_097_152),
    defaultValue: 65536,
  },
  {
    key: "security.argon_iterations",
    label: "Argon2: итераций",
    description: "Количество проходов. Влияет на CPU-время.",
    schema: positiveInt(3, 1, 20),
    defaultValue: 3,
  },
  {
    key: "security.argon_parallelism",
    label: "Argon2: параллелизм",
    description:
      "Сколько потоков использовать. Должно соответствовать числу ядер.",
    schema: positiveInt(1, 1, 32),
    defaultValue: 1,
  },
  {
    key: "security.session_ttl_seconds",
    label: "TTL сессии (сек)",
    description:
      "Срок жизни access-cookie. После — пользователь идёт по refresh-flow.",
    schema: positiveInt(3600, 60, 60 * 60 * 24 * 30),
    defaultValue: 3600,
  },
  {
    key: "security.deep_link_ttl_seconds",
    label: "TTL deep-link (сек)",
    description: "Срок жизни одноразовой ссылки (magic-link, invite, share).",
    schema: positiveInt(600, 60, 60 * 60 * 24 * 7),
    defaultValue: 600,
  },
];
