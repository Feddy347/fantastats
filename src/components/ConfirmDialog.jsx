import { useEffect } from 'react'
import './ConfirmDialog.css'

export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div className="confirm-dialog card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {title && <h2>{title}</h2>}
        <div className="confirm-body">{children}</div>
        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
