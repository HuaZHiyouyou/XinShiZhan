import { useState } from 'react';
import { useUi } from '@/store/ui';

export function ConfirmHost() {
  const request = useUi((s) => s.confirm);
  const close = useUi((s) => s.closeConfirm);
  const [busy, setBusy] = useState(false);

  if (!request) return null;

  const run = async () => {
    setBusy(true);
    try {
      await request.onConfirm();
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal-card" style={{ maxWidth: 420 }}>
        <div className="card-head">
          <div className="card-title">{request.title}</div>
        </div>
        <div className="card-pad stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="muted" style={{ fontSize: 13 }}>
            {request.message}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className={request.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
              onClick={run}
              disabled={busy}
            >
              {busy ? '处理中…' : request.confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}