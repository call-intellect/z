"use client";

import { useMemo, useState } from "react";
import { Eye, RefreshCw } from "lucide-react";

import {
  extractTemplateVariables,
  renderEmailPreview,
  type EmailTemplateItemDomain,
} from "@/domain/admin-email-template";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

type Props = {
  template: EmailTemplateItemDomain;
};

export function EmailPreviewPanel({ template }: Props) {
  const usedVars = useMemo(
    () => extractTemplateVariables(`${template.subject}\n${template.body}`),
    [template.subject, template.body],
  );

  const initialMockValues = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const k of usedVars) {
      const hint = template.variables[k];
      out[k] = hint && hint.length > 0 ? `[${hint}]` : `<${k}>`;
    }
    return out;
  }, [usedVars, template.variables]);

  const [mockValues, setMockValues] =
    useState<Record<string, string>>(initialMockValues);

  const renderedSubject = renderEmailPreview(template.subject, mockValues);
  const renderedBody = renderEmailPreview(template.body, mockValues);

  const resetMock = () => setMockValues(initialMockValues);

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-md border border-border-subtle p-4">
        <header className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Mock-значения переменных</h3>
          <Button type="button" variant="outline" size="sm" onClick={resetMock}>
            <RefreshCw size={14} /> Сбросить
          </Button>
        </header>
        {usedVars.length === 0 ? (
          <p className="text-xs text-fg-tertiary">
            В шаблоне нет переменных — превью покажет subject и body как есть.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {usedVars.map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`mock-${k}`} className="font-mono text-xs">
                  {`{{${k}}}`}
                </Label>
                <Input
                  id={`mock-${k}`}
                  value={mockValues[k] ?? ""}
                  onChange={(e) =>
                    setMockValues((prev) => ({ ...prev, [k]: e.target.value }))
                  }
                  placeholder={template.variables[k] ?? k}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border-subtle p-4">
        <header className="flex items-center gap-2">
          <Eye size={14} className="text-fg-tertiary" />
          <h3 className="text-sm font-medium">Превью</h3>
        </header>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-fg-tertiary">Тема</Label>
            <p className="mt-1 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 text-sm">
              {renderedSubject || "—"}
            </p>
          </div>
          <div>
            <Label className="text-xs text-fg-tertiary">Тело</Label>
            <pre className="mt-1 whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 font-sans text-sm">
              {renderedBody || "—"}
            </pre>
          </div>
        </div>
        <p className="text-[11px] text-fg-tertiary">
          Поддерживаются только `{`{{var}}`}` и `{`{{{var}}}`}`. Helper-блоки
          (`#if`, `#each`) показываются как есть — для них требуется полный
          Handlebars-runtime, которого нет на фронте.
        </p>
      </section>
    </div>
  );
}
