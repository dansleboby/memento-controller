import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { useT } from '../i18n/index.jsx';

// Arm, then require typing the confirmation word, then an explicit confirm click.
// onConfirm only ever runs from the final button; `ready` lets the parent add its own preconditions.
export default function DangerConfirm({ label, warning, ready = true, onConfirm, children }) {
  const t = useT();
  const word = t('danger.word');
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const inputId = `danger-${label.replace(/\W+/g, '-')}`;

  function disarm() {
    setArmed(false);
    setTyped('');
  }

  async function confirm() {
    if (typed !== word || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setDone(true);
      disarm();
    } catch (e) {
      setError(e.message || t('danger.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="danger-card">
      <p>
        <Warning size={22} weight="light" aria-hidden="true" />
        {warning}
      </p>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{t('danger.sent')}</p>}
      {!armed ? (
        <div>
          <button type="button" onClick={() => { setDone(false); setError(null); setArmed(true); }}>
            {label}
          </button>
        </div>
      ) : (
        <div className="danger-form">
          {children}
          <label htmlFor={inputId}>{t('danger.type', word)}</label>
          <input id={inputId} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          <div className="button-row">
            <button type="button" className="btn-danger" disabled={typed !== word || !ready || busy} onClick={confirm}>
              {t('danger.confirm', label)}
            </button>
            <button type="button" onClick={disarm} disabled={busy}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
