import { useCallback, useEffect, useState } from 'react';
import { CaretLeft, CaretRight, Trash } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { FINISHES, applyFinish, readFinish } from '../finish.js';
import { useT } from '../i18n/index.jsx';
import ThumbGrid, { ThumbGridPlaceholder } from '../components/ThumbGrid.jsx';
import UploadDropzone from '../components/UploadDropzone.jsx';

const UPLOAD_STATES = new Set(['transcoding', 'uploading', 'done', 'error']);

export default function Library() {
  const t = useT();
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
      setError(t('library.loadFailed'));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    refresh();
    // Mount only: `refresh` changes identity with the language, which must not re-read the frame.
  }, []);

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
      setError(t('library.uploadFailed'));
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
      setError(t('library.deleteFailed'));
    }
    await refresh();
  }

  async function control(action, ...args) {
    setError(null);
    try {
      await api.control(action, ...args);
    } catch {
      setError(t('library.controlFailed'));
    }
  }

  const toggle = (name) =>
    setSelected((sel) => (sel.includes(name) ? sel.filter((n) => n !== name) : [...sel, name]));

  const percent = progress ? Math.round((progress.fraction || 0) * 100) : 0;

  return (
    <section className="screen">
      <div className="screen-head">
        <div>
          <h2>{t('library.title')}</h2>
          {names.length > 0 && <p>{t('library.count', names.length)}</p>}
        </div>
        <div className="library-tools">
          <fieldset className="finish-picker">
            <legend className="tool-label">{t('library.finish')}</legend>
            {FINISHES.map((key) => (
              <label key={key} className="finish-swatch" title={t(`finish.${key}`)}>
                <input
                  type="radio"
                  name="finish"
                  value={key}
                  checked={finish === key}
                  aria-label={t(`finish.${key}`)}
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
            <span className="tool-label">{t('library.onFrame')}</span>
            <button
              type="button"
              className="btn-icon"
              aria-label={t('library.previous')}
              title={t('library.previous')}
              onClick={() => control('previousFrame')}
            >
              <CaretLeft size={18} weight="light" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon"
              aria-label={t('library.next')}
              title={t('library.next')}
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
            {progress.name} ({progress.index}/{progress.total}) - {UPLOAD_STATES.has(progress.state) ? t(`upload.${progress.state}`) : progress.state}
          </p>
          <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="loading">
          <p className="loading-note" aria-live="polite">
            {t('library.loading')}
          </p>
          <ThumbGridPlaceholder />
        </div>
      ) : names.length === 0 ? (
        <div className="empty">
          <div className="framed" aria-hidden="true">
            <div className="framed-mat" />
          </div>
          <p>{t('library.empty')}</p>
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
              <span>{t('library.selected', selected.length)}</span>
              <button type="button" className="btn-danger btn-sm" onClick={() => setConfirming(true)}>
                <Trash size={16} weight="light" aria-hidden="true" />
                {t('library.deleteSelection', selected.length)}
              </button>
            </>
          ) : (
            <div role="group" aria-label={t('library.confirmGroup')} className="button-row">
              <p>{t('library.confirmText', selected.length)}</p>
              <button type="button" className="btn-danger btn-sm" onClick={handleDelete}>
                {t('library.confirmDelete')}
              </button>
              <button type="button" className="btn-sm" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
