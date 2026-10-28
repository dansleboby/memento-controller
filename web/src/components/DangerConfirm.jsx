import { useState } from 'react';
import { Warning } from '@phosphor-icons/react';

const WORD = 'CONFIRMER';

// Arm, then require typing WORD, then an explicit confirm click.
// onConfirm only ever runs from the final button; `ready` lets the parent add its own preconditions.
export default function DangerConfirm({ label, warning, ready = true, onConfirm, children }) {
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
    if (typed !== WORD || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setDone(true);
      disarm();
    } catch (e) {
      setError(e.message || 'Échec de l\'opération.');
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
      {done && <p role="status">Opération envoyée.</p>}
      {!armed ? (
        <div>
          <button type="button" onClick={() => { setDone(false); setError(null); setArmed(true); }}>
            {label}
          </button>
        </div>
      ) : (
        <div className="danger-form">
          {children}
          <label htmlFor={inputId}>Saisissez {WORD} pour confirmer</label>
          <input id={inputId} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          <div className="button-row">
            <button type="button" className="btn-danger" disabled={typed !== WORD || !ready || busy} onClick={confirm}>
              Confirmer : {label}
            </button>
            <button type="button" onClick={disarm} disabled={busy}>Annuler</button>
          </div>
        </div>
      )}
    </section>
  );
}
