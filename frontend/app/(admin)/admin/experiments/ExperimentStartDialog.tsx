"use client";

import { useState } from "react";

import { ApiError } from "@/api/api-error";
import { adminExperimentsApi } from "@/api/admin-experiments.api";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";

const PROVIDER_MODEL_RE = /^[a-z][a-z0-9-]*:[A-Za-z0-9-_.]+$/;

export function ExperimentStartDialog({
  taskType,
  onClose,
  onStarted,
}: {
  taskType: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [modelB, setModelB] = useState("anthropic:claude-3-5-sonnet-20241022");
  const [splitPercent, setSplitPercent] = useState(50);
  const [durationDays, setDurationDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!PROVIDER_MODEL_RE.test(modelB)) {
      toast.error("modelB должен быть формата `<provider>:<model>`");
      return;
    }
    if (splitPercent < 1 || splitPercent > 99) {
      toast.error("split должен быть 1..99");
      return;
    }
    if (durationDays < 1 || durationDays > 30) {
      toast.error("продолжительность 1..30 дней");
      return;
    }
    setSubmitting(true);
    try {
      await adminExperimentsApi.start({
        taskType,
        modelB,
        splitPercent,
        durationDays,
      });
      toast.success("Эксперимент запущен");
      onStarted();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось запустить");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Запуск A/B на {taskType}</DialogTitle>
          <DialogDescription>
            Текущая модель станет «A». Введите кандидата «B» в формате{" "}
            <code className="font-mono text-xs">provider:model</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Model B</Label>
            <Input
              value={modelB}
              onChange={(e) => setModelB(e.target.value)}
              placeholder="anthropic:claude-3-5-sonnet-20241022"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Split B (%)</Label>
              <Input
                type="number"
                value={splitPercent}
                min={1}
                max={99}
                onChange={(e) => setSplitPercent(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Длительность (дней)</Label>
              <Input
                type="number"
                value={durationDays}
                min={1}
                max={30}
                onChange={(e) => setDurationDays(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? "Запускаем…" : "Запустить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
