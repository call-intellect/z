"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { adminEmailTemplatesApi } from "@/api/admin-email-templates.api";
import {
  type EmailTemplateItemDomain,
  type EmailTemplateVariablesMap,
  type UpdateEmailTemplateRequest,
} from "@/domain/admin-email-template";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Textarea } from "@/ui/shadcn/textarea";

type VariableRow = { id: string; key: string; hint: string };

type Props = {
  template: EmailTemplateItemDomain;
  onSaved: (updated: EmailTemplateItemDomain) => void;
};

export function EmailTemplateEditor({ template, onSaved }: Props) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [category, setCategory] = useState<string>(template.category);
  const [variables, setVariables] = useState<VariableRow[]>(
    variablesMapToRows(template.variables),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubject(template.subject);
    setBody(template.body);
    setCategory(template.category);
    setVariables(variablesMapToRows(template.variables));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.key, template.updatedAt]);

  const handleSave = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const varsMap: EmailTemplateVariablesMap = {};
      for (const row of variables) {
        const key = row.key.trim();
        if (!key) continue;
        varsMap[key] = row.hint;
      }
      const body_: UpdateEmailTemplateRequest = {
        subject: subject.trim(),
        body,
        category,
        variables: varsMap,
      };
      const res = await adminEmailTemplatesApi.update(template.key, body_);
      toast.success(`Шаблон «${template.key}» сохранён`);
      onSaved({
        ...template,
        subject: res.subject,
        body: res.body,
        htmlBody: res.htmlBody,
        category: res.category,
        variables: varsMap,
        updatedAt: new Date(res.updatedAt),
        updatedBy: res.updatedBy,
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    setVariables((prev) => [...prev, { id: cryptoId(), key: "", hint: "" }]);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-1">
          <Label htmlFor="tpl-subject">Тема</Label>
          <Input
            id="tpl-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Тема письма"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tpl-category">Категория</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="tpl-category">
              <SelectValue placeholder="Выберите категорию" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="transactional">Транзакционные</SelectItem>
              <SelectItem value="marketing">Маркетинг</SelectItem>
              <SelectItem value="system">Системные</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="tpl-body">Тело (Handlebars plain text)</Label>
        <Textarea
          id="tpl-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-fg-tertiary">
          Поддерживаются `{`{{var}}`}` и `{`{{{var}}}`}` (без escape).
          Helper-блоки (`#if`, `#each`) сохраняются как есть — превью покажет их
          сырыми.
        </p>
      </div>

      <section className="space-y-2 rounded-md border border-border-subtle p-4">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Переменные и подсказки</h3>
            <p className="text-xs text-fg-tertiary">
              Описание появляется в превью как placeholder. Не обязательно для
              работы шаблона.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus size={14} /> Добавить
          </Button>
        </header>
        {variables.length === 0 ? (
          <p className="text-xs text-fg-tertiary">Переменных не объявлено.</p>
        ) : (
          <div className="space-y-2">
            {variables.map((row, idx) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  value={row.key}
                  onChange={(e) =>
                    setVariables((prev) => {
                      const copy = [...prev];
                      copy[idx] = { ...row, key: e.target.value };
                      return copy;
                    })
                  }
                  placeholder="name"
                  className="max-w-[200px] font-mono text-xs"
                />
                <Input
                  value={row.hint}
                  onChange={(e) =>
                    setVariables((prev) => {
                      const copy = [...prev];
                      copy[idx] = { ...row, hint: e.target.value };
                      return copy;
                    })
                  }
                  placeholder="имя получателя"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setVariables((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="text-danger hover:bg-danger/10"
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && (
        <p
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          <Save size={14} />
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}

function variablesMapToRows(map: EmailTemplateVariablesMap): VariableRow[] {
  return Object.entries(map).map(([key, hint]) => ({
    id: cryptoId(),
    key,
    hint,
  }));
}

function cryptoId(): string {
  if (
    typeof globalThis !== "undefined" &&
    "crypto" in globalThis &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `row_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
