import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import * as api from '../api/client.js';
import Library from './Library.jsx';

vi.mock('../api/client.js');

let handlers;
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  handlers = {};
  api.getThumbnails.mockResolvedValue(['a.png', 'b.png']);
  api.thumbnailUrl.mockImplementation((n) => `/thumb/${n}`);
  api.subscribeEvents.mockImplementation((h) => {
    handlers = h;
    return unsubscribe;
  });
  api.control.mockResolvedValue();
  api.deleteImages.mockResolvedValue();
  api.upload.mockResolvedValue({ uploaded: ['c.png'] });
});

async function renderLibrary() {
  render(<Library />);
  await screen.findAllByRole('img');
}

describe('Library', () => {
  it('renders a tile per thumbnail and an empty state', async () => {
    await renderLibrary();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', '/thumb/a.png');
  });

  it('shows placeholder frames while the photo list is loading', async () => {
    let resolve;
    api.getThumbnails.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Library />);
    expect(screen.getByText('Chargement des photos...')).toBeInTheDocument();
    expect(screen.queryByText(/aucune image/i)).not.toBeInTheDocument();
    await act(async () => resolve(['a.png']));
    expect(screen.queryByText('Chargement des photos...')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('marks each thumbnail as loading until its image arrives', async () => {
    await renderLibrary();
    const [first] = screen.getAllByRole('img');
    expect(first.closest('.thumb-tile')).toHaveAttribute('aria-busy', 'true');
    await act(async () => first.dispatchEvent(new Event('load')));
    expect(first.closest('.thumb-tile')).toHaveAttribute('aria-busy', 'false');
  });

  it('shows an empty state when there are no images', async () => {
    api.getThumbnails.mockResolvedValue([]);
    render(<Library />);
    expect(await screen.findByText(/aucune image/i)).toBeInTheDocument();
  });

  it('uploads picked files, shows SSE progress, then refetches', async () => {
    await renderLibrary();
    const user = userEvent.setup();
    let resolveUpload;
    api.upload.mockReturnValue(new Promise((r) => (resolveUpload = r)));
    const file = new File(['x'], 'c.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/importer des images/i), file);
    expect(api.upload).toHaveBeenCalledWith([file], expect.objectContaining({ onProgress: expect.any(Function) }));

    act(() => handlers.onUpload({ name: 'c.png', index: 1, total: 1, fraction: 0.5, state: 'uploading' }));
    expect(screen.getByText(/c\.png/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');

    api.getThumbnails.mockResolvedValue(['a.png', 'b.png', 'c.png']);
    await act(async () => resolveUpload({ uploaded: ['c.png'] }));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3));
  });

  it('shows an error when upload fails', async () => {
    await renderLibrary();
    const user = userEvent.setup();
    api.upload.mockRejectedValue(new Error('boom'));
    await user.upload(screen.getByLabelText(/importer des images/i), new File(['x'], 'c.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/échec de l.import/i);
  });

  it('deletes selected images after in-app confirmation, then refetches', async () => {
    await renderLibrary();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/sélectionner a\.png/i));
    await user.click(screen.getByLabelText(/sélectionner b\.png/i));
    await user.click(screen.getByRole('button', { name: /supprimer la sélection/i }));
    expect(api.deleteImages).not.toHaveBeenCalled();
    api.getThumbnails.mockClear();
    api.getThumbnails.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: /confirmer la suppression/i }));
    await waitFor(() => expect(api.deleteImages).toHaveBeenCalledWith(['a.png', 'b.png']));
    await waitFor(() => expect(api.getThumbnails).toHaveBeenCalled());
    expect(await screen.findByText(/aucune image/i)).toBeInTheDocument();
  });

  it('cancelling the confirmation does not delete', async () => {
    await renderLibrary();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/sélectionner a\.png/i));
    await user.click(screen.getByRole('button', { name: /supprimer la sélection/i }));
    await user.click(screen.getByRole('button', { name: /annuler/i }));
    expect(api.deleteImages).not.toHaveBeenCalled();
  });

  it('sets an image as current', async () => {
    await renderLibrary();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /définir comme image actuelle/i })[1]);
    expect(api.control).toHaveBeenCalledWith('displayImage', 'b.png');
  });

  it('next and previous call control', async () => {
    await renderLibrary();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /image suivante/i }));
    expect(api.control).toHaveBeenCalledWith('nextFrame');
    await user.click(screen.getByRole('button', { name: /image précédente/i }));
    expect(api.control).toHaveBeenCalledWith('previousFrame');
  });

  it('unsubscribes from events on unmount', async () => {
    const { unmount } = render(<Library />);
    await screen.findAllByRole('img');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
