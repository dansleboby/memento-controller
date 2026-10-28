import { useState } from 'react';
import { SignOut } from '@phosphor-icons/react';
import * as api from './api/client.js';
import ThemeToggle from './components/ThemeToggle.jsx';
import Connect from './screens/Connect.jsx';
import Library from './screens/Library.jsx';
import Albums from './screens/Albums.jsx';
import ImageSettings from './screens/ImageSettings.jsx';
import DisplaySchedule from './screens/DisplaySchedule.jsx';
import Clock from './screens/Clock.jsx';
import FrameInfo from './screens/FrameInfo.jsx';
import Advanced from './screens/Advanced.jsx';

// Add further screens as new entries here.
const TABS = [
  { key: 'library', label: 'Bibliothèque', element: <Library /> },
  { key: 'albums', label: 'Albums', element: <Albums /> },
  { key: 'image', label: 'Image', element: <ImageSettings /> },
  { key: 'display', label: 'Affichage', element: <DisplaySchedule /> },
  { key: 'clock', label: 'Horloge', element: <Clock /> },
  { key: 'info', label: 'Infos', element: <FrameInfo /> },
  { key: 'advanced', label: 'Avancé', element: <Advanced /> },
];

export default function App() {
  const [config, setConfig] = useState(null);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(TABS[0].key);

  function handleConnected(cfg) {
    setConfig(cfg || null);
    setConnected(true);
  }

  async function handleDisconnect() {
    try {
      await api.disconnect();
    } catch {
      /* backend already disconnected or unreachable: leave the session anyway */
    } finally {
      setConnected(false);
      setConfig(null);
    }
  }

  if (!connected) return <Connect onConnected={handleConnected} />;

  const tab = TABS.find((t) => t.key === active) || TABS[0];

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <strong className="brand-name script">{config?.Name || 'Connecté'}</strong>
            <small>Memento</small>
          </div>
          <nav className="main-nav" aria-label="Navigation principale">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className="nav-tab"
                aria-current={key === tab.key ? 'page' : undefined}
                onClick={() => setActive(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <button type="button" className="btn-ghost btn-sm" onClick={handleDisconnect}>
              <SignOut size={18} weight="light" aria-hidden="true" />
              Se déconnecter
            </button>
          </div>
        </div>
      </header>
      <main className="app-main">{tab.element}</main>
    </div>
  );
}
