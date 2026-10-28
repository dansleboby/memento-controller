import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { useConfig, useWriter } from './settingsHooks.js';
import { FRAME_TIME_ZONES } from '../timeZones.js';

// frameTime is the frame's own wall clock, zone-less: show its digits as-is.
function formatFrameTime(frameTime) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(frameTime ?? '');
  return m ? `${m[4]}:${m[5]}, le ${m[3]}/${m[2]}/${m[1]}` : null;
}

function Form({ config }) {
  const { write, error } = useWriter();
  const [zone, setZone] = useState(config.TimeZoneName ?? '');
  const [status, setStatus] = useState(null);
  const [clockError, setClockError] = useState(null);
  const [frameTime, setFrameTime] = useState(null);

  const readFrameTime = useCallback(async () => {
    try {
      setFrameTime(formatFrameTime((await api.getFrameTime())?.frameTime));
    } catch {
      setFrameTime(null);
    }
  }, []);

  useEffect(() => {
    readFrameTime();
  }, [readFrameTime]);

  async function syncClock() {
    setStatus(null);
    setClockError(null);
    try {
      await api.setTime(new Date().toISOString());
      setStatus('Horloge réglée.');
      await readFrameTime();
    } catch (e) {
      setClockError(`Échec du réglage de l'horloge : ${e.message}`);
    }
  }

  return (
    <>
      {(error || clockError) && <p role="alert">{error || clockError}</p>}
      <div className="panel">
        <div className="field-row">
          <label htmlFor="timezone">Fuseau horaire</label>
          <select
            id="timezone"
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              write('ChangeTimeZone', e.target.value);
            }}
          >
            {FRAME_TIME_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <span className="field-label">Heure du cadre</span>
          <div className="button-row clock-row">
            {frameTime && <span className="clock-value">{frameTime}</span>}
            <button type="button" className="btn-primary" onClick={syncClock}>
              <ArrowsClockwise size={18} weight="light" aria-hidden="true" />
              Régler l'horloge
            </button>
          </div>
        </div>
      </div>
      {status && <p role="status">{status}</p>}
    </>
  );
}

export default function Clock() {
  const { config, error } = useConfig();
  return (
    <section aria-label="Horloge" className="screen">
      <div className="screen-head">
        <div>
          <h2>Horloge</h2>
          <p>Le cadre règle l'heure d'après l'heure de cet appareil.</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {config || error ? <Form config={config || {}} /> : <p className="muted">Chargement...</p>}
    </section>
  );
}
