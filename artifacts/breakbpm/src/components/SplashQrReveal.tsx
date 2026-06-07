import { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Hidden easter egg: long-pressing the splash 8-ball art reveals this
 * overlay with a scannable QR code for breakbpm.com. Reuses the Lucky
 * Break overlay chrome (`.lb-overlay` + `.panel`/`.lb-card`) so it feels
 * native to the retro PC-98 theme. Dismissible via the backdrop, the
 * close button, or Escape.
 */

const SHARE_URL = 'https://breakbpm.com';

export default function SplashQrReveal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="lb-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Share BreakBPM"
      onClick={onClose}
    >
      <div className="panel lb-card" onClick={e => e.stopPropagation()}>
        <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span aria-hidden="true">🎱</span>Share BreakBPM
          </span>
          <button
            type="button"
            className="btn"
            aria-label="Close"
            onClick={onClose}
            style={{ cursor: 'pointer', minWidth: 28, minHeight: 24, padding: '0 6px', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
        <div className="lb-body">
          <div style={{ background: '#fff', padding: 10, border: '2px inset #c0c0c0' }}>
            <QRCodeSVG value={SHARE_URL} size={176} level="M" />
          </div>
          <div className="lb-headline" style={{ fontSize: 22 }}>breakbpm.com</div>
          <div className="lb-subtle">Scan to open BreakBPM on another device.</div>
          <button className="btn btn-primary btn-big w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
