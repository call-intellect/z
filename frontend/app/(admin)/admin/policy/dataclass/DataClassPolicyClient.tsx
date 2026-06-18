"use client";

import useSWR from "swr";

import { adminSettingsApi } from "@/api/admin-settings.api";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function DataClassPolicyClient() {
  const { data: floorsRow, isLoading: lFloors } = useSWR(
    ["admin-settings", "dataclass_policy:floors"],
    () =>
      adminSettingsApi.get<Record<string, string>>("dataclass_policy:floors"),
  );
  const { data: chanRow, isLoading: lChan } = useSWR(
    ["admin-settings", "dataclass_policy:channel_defaults"],
    () =>
      adminSettingsApi.get<Record<string, string>>(
        "dataclass_policy:channel_defaults",
      ),
  );

  return (
    <section className="container mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Политика DataClass</h1>
        <p className="text-sm text-muted-foreground">
          W4.3 KC-Temporal — централизованные правила класса данных и outbound
          gating. Только владелец / главный администратор.
        </p>
      </header>

      {}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Минимальный уровень по типу результата (floors)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lFloors ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <FloorsTable value={floorsRow?.value ?? {}} />
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Поле задаёт минимум: фактический уровень результата всегда не ниже
            этого значения. Override этой настройки делается через раздел{" "}
            «Настройки» (ключ <code>dataclass_policy:floors</code>).
          </p>
        </CardContent>
      </Card>

      {}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Потолок чувствительности по типу канала
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lChan ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <ChannelDefaultsTable value={chanRow?.value ?? {}} />
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Применяется при создании канала. Пользователь может опустить ниже в
            «Мои каналы», но не поднять выше.
          </p>
        </CardContent>
      </Card>

      {}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">История нарушений</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Счётчик <code>kc_dataclass_violation_blocked_total</code> в
            Prometheus собирает все случаи, когда outbound-канал отказался
            принять payload по причине превышения потолка. Алерт на{" "}
            <code>{"> 0"}</code> за 5 минут — page on-call.
          </p>
          <p className="text-muted-foreground">
            Также события <code>ProbeStatus = dropped_dataclass_gate</code> в
            таблице <code>probe_events</code> за последние 7 дней — для аудита
            доставок вопросов от специалистов Слоя&nbsp;3.
          </p>
          <p className="text-xs text-muted-foreground">
            См. <code>docs/policies/outbound-gating-runbook.md</code> — как
            разобрать инцидент и поднять потолок при необходимости.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

const KIND_LABELS_RU: Record<string, string> = {
  idea_block: "Блок идеи (источник)",
  insight: "Инсайт",
  decision: "Решение",
  card_rollup: "Карточка-агрегат",
  executable_persona: "Исполнимая роль (клон)",
  skill_profile: "Профиль навыков",
  skill_trait: "Признак навыка",
  idea: "Идея",
  regulation: "Регламент",
  process: "Процесс",
  policy: "Политика",
  chat_context: "Контекст AI-чата",
  ai_usage_log: "Лог AI-вызова",
  conflict_item: "Конфликт-инцидент",
  probe_event: "Probe-событие",
};

const CHANNEL_LABELS_RU: Record<string, string> = {
  in_app: "Личный кабинет",
  telegram_dm: "Telegram (личка)",
  telegram_group: "Telegram (группа)",
  email: "Электронная почта",
  public_link: "Публичная ссылка",
};

const DATA_CLASS_LABELS_RU: Record<string, string> = {
  public: "публичный",
  internal: "внутренний",
  sensitive: "чувствительный",
  private: "личный",
};

function FloorsTable({ value }: { value: Record<string, string> }) {
  const rows = Object.entries(value);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Floors не настроены — используются значения по умолчанию из кода
        DataClassPolicyService.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-1">Тип результата</th>
          <th className="py-1">Минимальный уровень</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t">
            <td className="py-1">{KIND_LABELS_RU[k] ?? k}</td>
            <td className="py-1 font-mono">{DATA_CLASS_LABELS_RU[v] ?? v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChannelDefaultsTable({ value }: { value: Record<string, string> }) {
  const rows = Object.entries(value);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Channel defaults не настроены — используются значения по умолчанию.
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-1">Тип канала</th>
          <th className="py-1">Потолок по умолчанию</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t">
            <td className="py-1">{CHANNEL_LABELS_RU[k] ?? k}</td>
            <td className="py-1 font-mono">{DATA_CLASS_LABELS_RU[v] ?? v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
