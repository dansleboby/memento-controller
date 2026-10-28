import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { useConfig, useWriter } from './settingsHooks.js';
import { FRAME_TIME_ZONES } from '../timeZones.js';
import { useT } from '../i18n/index.jsx';

// frameTime is the frame's own wall clock, zone-less: its digits are shown as-is.
function parseFrameTime(frameTime) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(frameTime ?? '');
  return m ? { year: m[1], month: m[2], day: m[3], hour: m[4], minute: m[5] } : null;
}

function Form({ config }) {
  const t = useT();
  const { write, error } = useWriter();
  const [zone, setZone] = useState(config.TimeZoneName ?? '');
  const [status, setStatus] = useState(null);
  const [clockError, setClockError] = useState(null);
  const [frameTime, setFrameTime] = useState(null);

  const readFrameTime = useCallback(async () => {
    try {
      setFrameTime(parseFrameTime((await api.getFrameTime())?.frameTime));
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
      setStatus(t('clock.synced'));
      await readFrameTime();
    } catch (e) {
      setClockError(t('clock.syncFailed', e.message));
    }
  }

  return (
    <>
      {(error || clockError) && <p role="alert">{error || clockError}</p>}
      <div className="panel">
        <div className="field-row">
          <label htmlFor="timezone">{t('clock.zone')}</label>
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
          <span className="field-label">{t('clock.frameTime')}</span>
          <div className="button-row clock-row">
            {frameTime && <span className="clock-value">{t('clock.format', frameTime)}</span>}
            <button type="button" className="btn-primary" onClick={syncClock}>
              <ArrowsClockwise size={18} weight="light" aria-hidden="true" />
              {t('clock.sync')}
            </button>
          </div>
        </div>
      </div>
      {status && <p role="status">{status}</p>}
    </>
  );
}

export default function Clock() {
  const t = useT();
  const { config, error } = useConfig();
  return (
    <section aria-label={t('clock.title')} className="screen">
      <div className="screen-head">
        <div>
          <h2>{t('clock.title')}</h2>
          <p>{t('clock.lede')}</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {config || error ? <Form config={config || {}} /> : <p className="muted">{t('common.loading')}</p>}
    </section>
  );
}
