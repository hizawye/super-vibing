import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@supervibing/ui";

interface GitActionConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function GitActionConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: GitActionConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        onCancel();
      }
    }}
    >
      <DialogContent
        className="workspace-modal git-confirm-modal"
        aria-label={title}
      >
        <DialogHeader className="workspace-modal-head">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="workspace-modal-section">
          <DialogDescription className="settings-caption">{message}</DialogDescription>
        </div>
        <DialogFooter className="workspace-modal-actions">
          <Button type="button" variant="subtle" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
