import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api/client.js';

export const DEBOUNCE_MS = 400;

// Loads the config once on mount; a failure is reported but never blocks the screen.
export function useConfig() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    api
      .getConfig()
      .then((c) => alive && setConfig(c || {}))
      .catch((e) => alive && setError(`Impossible de lire la configuration : ${e.message}`));
    return () => {
      alive = false;
    };
  }, []);
  return { config, error };
}

// One granular write per call. Debounced writes are keyed by action so
// controls never cancel each other; the pending timer is dropped on unmount.
export function useWriter() {
  const [error, setError] = useState(null);
  const timers = useRef({});
  const failed = useRef(false);

  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);

  const write = useCallback(async (action, value) => {
    try {
      await api.setSetting(action, value);
      if (failed.current) {
        failed.current = false;
        setError(null);
      }
    } catch (e) {
      failed.current = true;
      setError(`Échec de l'enregistrement : ${e.message}`);
    }
  }, []);

  const writeDebounced = useCallback(
    (action, value) => {
      clearTimeout(timers.current[action]);
      timers.current[action] = setTimeout(() => write(action, value), DEBOUNCE_MS);
    },
    [write],
  );

  return { write, writeDebounced, error };
}
