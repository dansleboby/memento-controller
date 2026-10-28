import { useState } from 'react';
import { Moon, Sun } from '@phosphor-icons/react';
import { applyTheme, effectiveTheme } from '../theme.js';

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(effectiveTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Passer au thème sombre' : 'Passer au thème clair';
  const Icon = next === 'dark' ? Moon : Sun;

  return (
    <button
      type="button"
      className={`btn-ghost btn-icon btn-sm ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      <Icon size={18} weight="light" aria-hidden="true" />
    </button>
  );
}
