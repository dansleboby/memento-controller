import { useCallback, useEffect, useState } from 'react';
import { CaretLeft, CaretRight, Trash } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { FINISHES, applyFinish, readFinish } from '../finish.js';
import ThumbGrid, { ThumbGridPlaceholder } from '../components/ThumbGrid.jsx';
import UploadDropzone from '../components/UploadDropzone.jsx';

const STATE_LABELS = {
  transcoding: 'Conversion',
  uploading: 'Envoi au cadre',
  done: 'Terminé',
  error: 'Erreur',
};

export default function Library() {
  const [names, setNames] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [finish, setFinish] = useState(readFinish);

  // The frame owns album/current-image consistency: always re-read after a mutation.
  const refresh = useCallback(async () => {
    try {
      const list = await api.getThumbnails();
      setNames(list);
      setSelected((sel) => sel.filter((n) => list.includes(n)));
    } catch {
      setError('Impossible de charger les images.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubscribe = api.subscribeEvents({ onUpload: setProgress });
    return () => unsubscribe?.();
  }, []);

  async function handleFiles(files) {
    setError(null);
    setUploading(true);
    setProgress(null);
    try {
      await api.upload(files, { onProgress: () => {} });
      await refresh();
    } catch {
      setError("Échec de l'import des images.");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function handleDelete() {
    setConfirming(false);
    setError(null);
    try {
      await api.deleteImages(selected);
      setSelected([]);
    } catch {
      setError('Échec de la suppression.');
    }
    await refresh();
  }

  async function control(action, ...args) {
    setError(null);
    try {
      await api.control(action, ...args);
    } catch {
      setError("Échec de la commande envoyée au cadre.");
    }
  }

  const toggle = (name) =>
    setSelected((sel) => (sel.includes(name) ? sel.filter((n) => n !== name) : [...sel, name]));

  const percent = progress ? Math.round((progress.fraction || 0) * 100) : 0;

  return (
    <section className="screen">
      <div className="screen-head">
        <div>
          <h2>Bibliothèque</h2>
          {names.length > 0 && <p>{names.length} photos sur le cadre</p>}
        </div>
        <div className="library-tools">
          <fieldset className="finish-picker">
            <legend className="tool-label">Cadre</legend>
            {FINISHES.map(([key, label]) => (
              <label key={key} className="finish-swatch" title={label}>
                <input
                  type="radio"
                  name="finish"
                  value={key}
                  checked={finish === key}
                  aria-label={label}
                  onChange={() => {
                    setFinish(key);
                    applyFinish(key);
                  }}
                />
                <span data-finish={key} />
              </label>
            ))}
          </fieldset>
          <div className="remote">
            <span className="tool-label">Sur le cadre</span>
            <button
              type="button"
              className="btn-icon"
              aria-label="Image précédente"
              title="Image précédente"
              onClick={() => control('previousFrame')}
            >
              <CaretLeft size={18} weight="light" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon"
              aria-label="Image suivante"
              title="Image suivante"
              onClick={() => control('nextFrame')}
            >
              <CaretRight size={18} weight="light" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <UploadDropzone onFiles={handleFiles} disabled={uploading} />

      {progress && (
        <div className="upload-progress">
          <p>
            {progress.name} ({progress.index}/{progress.total}) - {STATE_LABELS[progress.state] || progress.state}
          </p>
          <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="loading">
          <p className="loading-note" aria-live="polite">
            Chargement des photos...
          </p>
          <ThumbGridPlaceholder />
        </div>
      ) : names.length === 0 ? (
        <div className="empty">
          <div className="framed" aria-hidden="true">
            <div className="framed-mat" />
          </div>
          <p>Aucune image sur le cadre.</p>
        </div>
      ) : (
        <ThumbGrid
          names={names}
          selected={selected}
          onToggle={toggle}
          onSetCurrent={(name) => control('displayImage', name)}
        />
      )}

      {(selected.length > 0 || confirming) && (
        <div className="selection-bar">
          {!confirming ? (
            <>
              <span>
                {selected.length} sélectionnée{selected.length > 1 ? 's' : ''}
              </span>
              <button type="button" className="btn-danger btn-sm" onClick={() => setConfirming(true)}>
                <Trash size={16} weight="light" aria-hidden="true" />
                Supprimer la sélection ({selected.length})
              </button>
            </>
          ) : (
            <div role="group" aria-label="Confirmation de suppression" className="button-row">
              <p>Supprimer définitivement {selected.length} image(s) du cadre ?</p>
              <button type="button" className="btn-danger btn-sm" onClick={handleDelete}>
                Confirmer la suppression
              </button>
              <button type="button" className="btn-sm" onClick={() => setConfirming(false)}>
                Annuler
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
