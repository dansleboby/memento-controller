import { useState } from 'react';
import { MagnifyingGlass, WifiHigh } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { useT } from '../i18n/index.jsx';
import LanguageToggle from '../components/LanguageToggle.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const LAST_IP_KEY = 'memento.lastIp';

function readLastIp() {
  try {
    return localStorage.getItem(LAST_IP_KEY) || '';
  } catch {
    return '';
  }
}

export default function Connect({ onConnected }) {
  const t = useT();
  const [ip, setIp] = useState(readLastIp);
  const [frames, setFrames] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      setFrames(await api.discover());
    } catch (e) {
      setFrames(null);
      setError(t('connect.scanFailed', e.message));
    } finally {
      setScanning(false);
    }
  }

  async function connectTo(target) {
    const addr = target.trim();
    if (!addr) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await api.connect(addr);
      try {
        localStorage.setItem(LAST_IP_KEY, addr);
      } catch {
        /* storage unavailable */
      }
      onConnected(res?.config);
    } catch (e) {
      setError(t('connect.failed', addr, e.message));
      setConnecting(false);
    }
  }

  return (
    <main className="connect">
      <div className="connect-tools">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="connect-inner">
        <div className="wordmark" aria-hidden="true">
          <span className="script">Memento</span>
          <small>Smart frame</small>
        </div>
        <h1>{t('connect.title')}</h1>
        <div className="framed">
          <div className="framed-mat">
            <section className="scan">
              <button type="button" onClick={scan} disabled={scanning || connecting}>
                <MagnifyingGlass size={18} weight="light" aria-hidden="true" />
                {scanning ? t('connect.scanning') : t('connect.scan')}
              </button>
              {frames && frames.length === 0 && <p className="muted">{t('connect.none')}</p>}
              {frames && frames.length > 0 && (
                <ul className="frame-list">
                  {frames.map((f) => (
                    <li key={f.guid || f.ip}>
                      <button type="button" className="frame-chip" onClick={() => connectTo(f.ip)} disabled={connecting}>
                        <WifiHigh size={18} weight="light" aria-hidden="true" />
                        {f.name || f.ip}
                        {f.name ? <span className="frame-ip"> ({f.ip})</span> : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="or-divider">{t('connect.or')}</div>

            <form
              className="ip-form"
              onSubmit={(e) => {
                e.preventDefault();
                connectTo(ip);
              }}
            >
              <label>
                {t('connect.ip')}
                <input
                  type="text"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.168.0.128"
                  inputMode="decimal"
                />
              </label>
              <button type="submit" className="btn-primary" disabled={connecting || !ip.trim()}>
                {t('connect.submit')}
              </button>
            </form>

            {error && <p role="alert">{error}</p>}
          </div>
        </div>
      </div>
    </main>
  );
}
