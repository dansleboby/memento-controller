import { useState } from 'react';
import * as api from '../api/client.js';
import DangerConfirm from '../components/DangerConfirm.jsx';
import { useT } from '../i18n/index.jsx';

function ChangeWifi() {
  const t = useT();
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  return (
    <DangerConfirm
      label={t('advanced.wifi')}
      warning={t('advanced.wifiWarning')}
      ready={ssid.trim() !== ''}
      // ssid is sent untrimmed on purpose (SSIDs may have edge spaces); only the enable-guard trims.
      onConfirm={() => api.advanced('changeWifi', { ssid, password })}
    >
      <label htmlFor="wifi-ssid">{t('advanced.ssid')}</label>
      <input id="wifi-ssid" value={ssid} autoComplete="off" onChange={(e) => setSsid(e.target.value)} />
      <label htmlFor="wifi-password">{t('advanced.password')}</label>
      <input id="wifi-password" type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} />
    </DangerConfirm>
  );
}

export default function Advanced() {
  const t = useT();
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h2>{t('advanced.title')}</h2>
          <p>{t('advanced.lede')}</p>
        </div>
      </div>
      <ChangeWifi />
      <DangerConfirm
        label={t('advanced.forget')}
        warning={t('advanced.forgetWarning')}
        onConfirm={() => api.advanced('forgetNetwork')}
      />
      <DangerConfirm
        label={t('advanced.reset')}
        warning={t('advanced.resetWarning')}
        onConfirm={() => api.advanced('factoryReset')}
      />
    </div>
  );
}
