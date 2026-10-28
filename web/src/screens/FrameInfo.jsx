import { useEffect, useState } from 'react';
import * as api from '../api/client.js';

const FIELDS = [
  ['Name', 'Nom'],
  ['SoftwareVersion', 'Version logicielle'],
  ['HardwareVersion', 'Version matérielle'],
  ['ScreenSize', "Taille de l'écran"],
  ['Orientation', 'Orientation'],
  ['GUID', 'Identifiant (GUID)'],
];

export default function FrameInfo() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getConfig().then(
      (c) => alive && setConfig(c),
      (e) => alive && setError(e.message || 'Impossible de charger les informations.'),
    );
    return () => { alive = false; };
  }, []);

  if (error) return <p role="alert">{error}</p>;
  if (!config) return <p className="muted">Chargement...</p>;
  return (
    <div className="screen">
      <div className="screen-head">
        <h2>Informations</h2>
      </div>
      <dl className="panel info-list">
        {FIELDS.filter(([k]) => config[k] != null && config[k] !== '').map(([k, label]) => (
          <div key={k}>
            <dt>{label}</dt>
            <dd>{String(config[k])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
