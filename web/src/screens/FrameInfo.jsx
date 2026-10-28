import { useEffect, useState } from 'react';
import * as api from '../api/client.js';
import { useT } from '../i18n/index.jsx';

// Labels come from the `info.<field>` translations.
const FIELDS = ['Name', 'SoftwareVersion', 'HardwareVersion', 'ScreenSize', 'Orientation', 'GUID'];

export default function FrameInfo() {
  const t = useT();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getConfig().then(
      (c) => alive && setConfig(c),
      (e) => alive && setError(e.message || t('info.loadFailed')),
    );
    return () => { alive = false; };
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!config) return <p className="muted">{t('common.loading')}</p>;
  return (
    <div className="screen">
      <div className="screen-head">
        <h2>{t('info.title')}</h2>
      </div>
      <dl className="panel info-list">
        {FIELDS.filter((k) => config[k] != null && config[k] !== '').map((k) => (
          <div key={k}>
            <dt>{t(`info.${k}`)}</dt>
            <dd>{String(config[k])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
