import { useState } from 'react';
import * as api from '../api/client.js';
import DangerConfirm from '../components/DangerConfirm.jsx';

function ChangeWifi() {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  return (
    <DangerConfirm
      label="Changer le Wi-Fi"
      warning="Attention : changer le Wi-Fi peut couper la connexion avec le cadre. Si les identifiants sont erronés, il faudra le reconfigurer sur place."
      ready={ssid.trim() !== ''}
      // ssid is sent untrimmed on purpose (SSIDs may have edge spaces); only the enable-guard trims.
      onConfirm={() => api.advanced('changeWifi', { ssid, password })}
    >
      <label htmlFor="wifi-ssid">Nom du réseau (SSID)</label>
      <input id="wifi-ssid" value={ssid} autoComplete="off" onChange={(e) => setSsid(e.target.value)} />
      <label htmlFor="wifi-password">Mot de passe</label>
      <input id="wifi-password" type="password" value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} />
    </DangerConfirm>
  );
}

export default function Advanced() {
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h2>Avancé</h2>
          <p>Zone dangereuse : chaque action demande une double confirmation.</p>
        </div>
      </div>
      <ChangeWifi />
      <DangerConfirm
        label="Oublier le réseau"
        warning="Attention : oublier le réseau peut couper la connexion avec le cadre, qui ne sera plus joignable sur le réseau local."
        onConfirm={() => api.advanced('forgetNetwork')}
      />
      <DangerConfirm
        label="Réinitialisation d'usine"
        warning="Attention : la réinitialisation d'usine est irréversible. Les réglages et le contenu du cadre seront effacés."
        onConfirm={() => api.advanced('factoryReset')}
      />
    </div>
  );
}
