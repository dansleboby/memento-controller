import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import * as api from '../api/client.js';
import { RESERVED_ALBUMS } from '../constants.js';
import Albums from './Albums.jsx';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ApiError: actual.ApiError, getAlbums: vi.fn(), putAlbum: vi.fn(), getThumbnails: vi.fn(), thumbnailUrl: actual.thumbnailUrl };
});

const RESERVED = RESERVED_ALBUMS[0];
const DATA = {
  albums: [
    { name: RESERVED, images: ['a.png'] },
    { name: 'Trip', images: ['b.png'] },
    { name: 'Family', images: [] },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  api.getAlbums.mockResolvedValue(DATA);
  api.getThumbnails.mockResolvedValue(['a.png', 'b.png', 'c.png']);
  api.putAlbum.mockResolvedValue(DATA);
});

async function renderAlbums() {
  render(<Albums />);
  await screen.findByText('Trip');
}

const row = (name) => screen.getByText(name).closest('li');
const RESERVED_LABEL = 'Toutes les photos';

describe('Albums', () => {
  it('shows reserved albums by a readable label, never the internal name', async () => {
    await renderAlbums();
    expect(screen.getByText(RESERVED_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(RESERVED)).not.toBeInTheDocument();
  });

  it('disables rename and delete on reserved albums only', async () => {
    await renderAlbums();
    const reserved = within(row(RESERVED_LABEL));
    expect(reserved.getByRole('button', { name: /renommer/i })).toBeDisabled();
    expect(reserved.getByRole('button', { name: /supprimer/i })).toBeDisabled();
    const normal = within(row('Trip'));
    expect(normal.getByRole('button', { name: /renommer/i })).toBeEnabled();
    expect(normal.getByRole('button', { name: /supprimer/i })).toBeEnabled();
  });

  it('creates an album with one edit', async () => {
    await renderAlbums();
    await userEvent.type(screen.getByLabelText(/nouvel album/i), 'Summer');
    await userEvent.click(screen.getByRole('button', { name: /créer/i }));
    expect(api.putAlbum).toHaveBeenCalledTimes(1);
    expect(api.putAlbum).toHaveBeenCalledWith({ type: 'createAlbum', name: 'Summer' });
  });

  it('renames an album with one edit', async () => {
    await renderAlbums();
    await userEvent.click(within(row('Trip')).getByRole('button', { name: /renommer/i }));
    const input = screen.getByLabelText(/nouveau nom/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Holiday');
    await userEvent.click(screen.getByRole('button', { name: /valider/i }));
    expect(api.putAlbum).toHaveBeenCalledTimes(1);
    expect(api.putAlbum).toHaveBeenCalledWith({ type: 'renameAlbum', from: 'Trip', to: 'Holiday' });
  });

  it('deletes an album with one edit', async () => {
    await renderAlbums();
    await userEvent.click(within(row('Trip')).getByRole('button', { name: /supprimer/i }));
    expect(api.putAlbum).toHaveBeenCalledTimes(1);
    expect(api.putAlbum).toHaveBeenCalledWith({ type: 'deleteAlbum', name: 'Trip' });
  });

  it('reorders with the full permutation in one edit', async () => {
    await renderAlbums();
    await userEvent.click(within(row('Family')).getByRole('button', { name: /monter/i }));
    expect(api.putAlbum).toHaveBeenCalledTimes(1);
    expect(api.putAlbum).toHaveBeenCalledWith({
      type: 'reorderAlbums',
      order: [RESERVED, 'Family', 'Trip'],
    });
  });

  it('assigns and removes images in one edit', async () => {
    await renderAlbums();
    await userEvent.click(within(row('Trip')).getByRole('button', { name: /assigner des images/i }));
    await screen.findByLabelText('c.png');
    await userEvent.click(screen.getByLabelText('c.png'));
    await userEvent.click(screen.getByLabelText('b.png'));
    await userEvent.click(screen.getByRole('button', { name: /appliquer/i }));
    expect(api.putAlbum).toHaveBeenCalledTimes(1);
    expect(api.putAlbum).toHaveBeenCalledWith({
      type: 'assignImages',
      album: 'Trip',
      add: ['c.png'],
      remove: ['b.png'],
    });
  });

  it('shows the server error and keeps the list and input on 4xx', async () => {
    api.putAlbum.mockRejectedValue(new api.ApiError('Album réservé', 409));
    await renderAlbums();
    await userEvent.type(screen.getByLabelText(/nouvel album/i), 'Summer');
    await userEvent.click(screen.getByRole('button', { name: /créer/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Album réservé/);
    expect(screen.getByText('Trip')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();
    expect(screen.getByLabelText(/nouvel album/i)).toHaveValue('Summer');
  });
});
