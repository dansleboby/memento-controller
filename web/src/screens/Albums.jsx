import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ImagesSquare, Lock, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import * as api from '../api/client.js';
import { RESERVED_ALBUMS, albumLabel } from '../constants.js';

function AlbumCover({ image }) {
  return (
    <div className="album-cover framed" aria-hidden="true">
      <div className="framed-mat">
        {image ? (
          <img src={api.thumbnailUrl(image)} alt="" loading="lazy" />
        ) : (
          <span className="album-cover-empty">
            <ImagesSquare size={20} weight="light" />
          </span>
        )}
      </div>
    </div>
  );
}

export default function Albums() {
  const [albums, setAlbums] = useState([]);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null); // { from, to }
  const [assigning, setAssigning] = useState(null); // { album, images, selected }

  useEffect(() => {
    let alive = true;
    api
      .getAlbums()
      .then((data) => alive && setAlbums(data.albums))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  // One PUT per action. Resolves true on success; on failure the error is shown
  // and all local state (list, inputs) is left untouched.
  async function send(edit) {
    setError('');
    try {
      const data = await api.putAlbum(edit);
      setAlbums(data.albums);
      return true;
    } catch (err) {
      setError(err.message || 'Erreur');
      return false;
    }
  }

  async function create(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await send({ type: 'createAlbum', name })) setNewName('');
  }

  async function submitRename(e) {
    e.preventDefault();
    const to = renaming.to.trim();
    if (!to) return;
    if (await send({ type: 'renameAlbum', from: renaming.from, to })) setRenaming(null);
  }

  function move(index, delta) {
    const order = albums.map((a) => a.name);
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    send({ type: 'reorderAlbums', order });
  }

  async function openAssign(album) {
    setError('');
    try {
      const images = await api.getThumbnails();
      setAssigning({ album: album.name, images, selected: new Set(album.images) });
    } catch (err) {
      setError(err.message || 'Erreur');
    }
  }

  function toggleImage(name) {
    setAssigning((s) => {
      const selected = new Set(s.selected);
      if (selected.has(name)) selected.delete(name);
      else selected.add(name);
      return { ...s, selected };
    });
  }

  async function applyAssign() {
    const current = albums.find((a) => a.name === assigning.album)?.images || [];
    const add = assigning.images.filter((n) => assigning.selected.has(n) && !current.includes(n));
    const remove = current.filter((n) => !assigning.selected.has(n));
    if (await send({ type: 'assignImages', album: assigning.album, add, remove })) {
      setAssigning(null);
    }
  }

  return (
    <section aria-label="Albums" className="screen">
      <div className="screen-head">
        <h2>Albums</h2>
        <form onSubmit={create} className="create-form">
          <label>
            Nouvel album
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary">
            <Plus size={18} weight="light" aria-hidden="true" />
            Créer
          </button>
        </form>
      </div>

      {error && <p role="alert">{error}</p>}

      <ul className="album-list">
        {albums.map((album, i) => {
          const reserved = RESERVED_ALBUMS.includes(album.name);
          return (
            <li key={album.name} className="album-row">
              <AlbumCover image={album.images[0]} />
              <div>
                <span className="album-name">{albumLabel(album.name)}</span>
                <div className="album-meta">
                  <small className="badge">
                    {album.images.length} photo{album.images.length > 1 ? 's' : ''}
                  </small>
                  {reserved && (
                    <em className="badge">
                      <Lock size={14} weight="light" aria-hidden="true" /> Album réservé
                    </em>
                  )}
                </div>
              </div>
              <div className="album-actions">
                <button
                  type="button"
                  className="btn-icon btn-sm"
                  aria-label="Monter"
                  title="Monter"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={16} weight="light" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-icon btn-sm"
                  aria-label="Descendre"
                  title="Descendre"
                  disabled={i === albums.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={16} weight="light" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  disabled={reserved}
                  onClick={() => setRenaming({ from: album.name, to: album.name })}
                >
                  <PencilSimple size={16} weight="light" aria-hidden="true" />
                  Renommer
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  disabled={reserved}
                  onClick={() => send({ type: 'deleteAlbum', name: album.name })}
                >
                  <Trash size={16} weight="light" aria-hidden="true" />
                  Supprimer
                </button>
                <button type="button" className="btn-sm" onClick={() => openAssign(album)}>
                  <ImagesSquare size={16} weight="light" aria-hidden="true" />
                  Assigner des images
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {renaming && (
        <form onSubmit={submitRename} className="inline-form panel panel-padded">
          <label>
            Nouveau nom
            <input
              value={renaming.to}
              onChange={(e) => setRenaming({ ...renaming, to: e.target.value })}
            />
          </label>
          <div className="button-row">
            <button type="submit" className="btn-primary">
              Valider
            </button>
            <button type="button" onClick={() => setRenaming(null)}>
              Annuler
            </button>
          </div>
        </form>
      )}

      {assigning && (
        <fieldset className="assign-panel">
          <legend>Assigner des images : {albumLabel(assigning.album)}</legend>
          <div className="assign-grid">
            {assigning.images.map((name) => (
              <label key={name} className="assign-item">
                <img src={api.thumbnailUrl(name)} alt="" loading="lazy" />
                <input
                  type="checkbox"
                  checked={assigning.selected.has(name)}
                  onChange={() => toggleImage(name)}
                />
                {name}
              </label>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="btn-primary" onClick={applyAssign}>
              Appliquer
            </button>
            <button type="button" onClick={() => setAssigning(null)}>
              Annuler
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
