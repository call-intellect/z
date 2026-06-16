"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { VisibilityControl } from "./VisibilityControl";
import type { VisibilityScope } from "@/domain/meeting";

export type VisibilityDialogProps = {
  meetingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (scope: VisibilityScope) => void;
};

export function VisibilityDialog({
  meetingId,
  open,
  onOpenChange,
  onSaved,
}: VisibilityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Кому видно</DialogTitle>
          <DialogDescription>
            Выберите, кто увидит знания этой встречи в памяти компании.
          </DialogDescription>
        </DialogHeader>
        {}
        {open && (
          <VisibilityControl
            key={meetingId}
            meetingId={meetingId}
            onSaved={(scope) => {
              onSaved?.(scope);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
