import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import * as api from '../api/client.js';
import Connect from './Connect.jsx';

vi.mock('../api/client.js');

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe('Connect', () => {
  it('keeps the manual IP field and connects to the typed IP when discovery is empty', async () => {
    api.discover.mockResolvedValue([]);
    api.connect.mockResolvedValue({ config: { name: 'F' } });
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(<Connect onConnected={onConnected} />);
    expect(screen.getByLabelText(/adresse ip/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /rechercher/i }));
    await screen.findByText(/aucun cadre trouvé/i);

    const field = screen.getByLabelText(/adresse ip/i);
    await user.type(field, '192.168.0.50');
    await user.click(screen.getByRole('button', { name: /se connecter/i }));

    await waitFor(() => expect(api.connect).toHaveBeenCalledWith('192.168.0.50'));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith({ name: 'F' }));
    expect(localStorage.getItem('memento.lastIp')).toBe('192.168.0.50');
  });

  it('connects to a discovered frame IP when clicked', async () => {
    api.discover.mockResolvedValue([{ ip: '192.168.0.128', name: 'Salon' }]);
    api.connect.mockResolvedValue({ config: {} });
    const user = userEvent.setup();
    render(<Connect onConnected={() => {}} />);

    await user.click(screen.getByRole('button', { name: /rechercher/i }));
    await user.click(await screen.findByRole('button', { name: /salon/i }));
    expect(screen.getByLabelText(/adresse ip/i)).toBeInTheDocument();

    await waitFor(() => expect(api.connect).toHaveBeenCalledWith('192.168.0.128'));
  });

  it('prefills the remembered IP and shows connect errors without crashing', async () => {
    localStorage.setItem('memento.lastIp', '10.0.0.7');
    api.connect.mockRejectedValue(Object.assign(new Error('frame unreachable'), { status: 502 }));
    const user = userEvent.setup();
    render(<Connect onConnected={() => {}} />);

    expect(screen.getByLabelText(/adresse ip/i)).toHaveValue('10.0.0.7');
    await user.click(screen.getByRole('button', { name: /se connecter/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/frame unreachable/);
    expect(screen.getByLabelText(/adresse ip/i)).toBeInTheDocument();
  });
});
