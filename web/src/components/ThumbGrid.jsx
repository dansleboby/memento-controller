import { useState } from 'react';
import { MonitorPlay } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { useT } from '../i18n/index.jsx';

const baseName = (name) => name.replace(/\.[^.]+$/, '');

// The frame streams thumbnails one at a time, so each tile shows its own loading state.
function Thumb({ name, checked, onToggle, onSetCurrent }) {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  return (
    <li className="thumb-tile" aria-busy={!loaded}>
      <div className="framed">
        <div className="framed-mat">
          <img
            src={api.thumbnailUrl(name)}
            alt={name}
            loading="lazy"
            className={loaded ? 'is-loaded' : undefined}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
          <label className="thumb-select">
            <input type="checkbox" checked={checked} onChange={() => onToggle(name)} aria-label={t('thumb.select', name)} />
          </label>
        </div>
      </div>
      <div className="thumb-caption">
        <span className="thumb-name" title={name}>
          {baseName(name)}
        </span>
        <button
          type="button"
          className="thumb-play btn-icon btn-sm"
          aria-label={t('thumb.setCurrent')}
          title={t('thumb.showTitle')}
          onClick={() => onSetCurrent(name)}
        >
          <MonitorPlay size={18} weight="light" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export default function ThumbGrid({ names, selected, onToggle, onSetCurrent }) {
  return (
    <ul className="thumb-grid">
      {names.map((name) => (
        <Thumb
          key={name}
          name={name}
          checked={selected.includes(name)}
          onToggle={onToggle}
          onSetCurrent={onSetCurrent}
        />
      ))}
    </ul>
  );
}

export function ThumbGridPlaceholder({ count = 10 }) {
  return (
    <ul className="thumb-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="thumb-tile is-placeholder">
          <div className="framed">
            <div className="framed-mat">
              <span className="shimmer" />
            </div>
          </div>
          <div className="thumb-caption">
            <span className="shimmer-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}
