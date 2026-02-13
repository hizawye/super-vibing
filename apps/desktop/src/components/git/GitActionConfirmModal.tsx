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
  if (!open) {
    return null;
  }

  return (
    <div className="workspace-modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="workspace-modal git-confirm-modal"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workspace-modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onCancel} disabled={busy}>
            x
          </button>
        </div>
        <div className="workspace-modal-section">
          <p className="settings-caption">{message}</p>
        </div>
        <div className="workspace-modal-actions">
          <button type="button" className="subtle-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-btn" onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
