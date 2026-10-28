import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import * as api from '../api/client.js';
import Advanced from './Advanced.jsx';
import FrameInfo from './FrameInfo.jsx';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ApiError: actual.ApiError, getConfig: vi.fn(), advanced: vi.fn() };
});

const ALLOWED = ['forgetNetwork', 'factoryReset', 'changeWifi'];

beforeEach(() => {
  vi.resetAllMocks();
  api.advanced.mockResolvedValue(undefined);
});

async function arm(name) {
  fireEvent.click(screen.getByRole('button', { name }));
  const input = await screen.findByLabelText(/pour confirmer/i);
  return input;
}

describe('FrameInfo', () => {
  it('shows the frame identity from config', async () => {
    api.getConfig.mockResolvedValue({
      Name: 'Salon', SoftwareVersion: '3.1.4', HardwareVersion: 'HW-2', ScreenSize: '10.1',
      Orientation: 'Landscape', GUID: 'abc-123-guid',
    });
    render(<FrameInfo />);
    for (const v of ['Salon', '3.1.4', 'HW-2', '10.1', 'Landscape', 'abc-123-guid']) {
      expect(await screen.findByText(v)).toBeInTheDocument();
    }
  });

  it('reports a load failure without crashing', async () => {
    api.getConfig.mockRejectedValue(new api.ApiError('boom', 500));
    render(<FrameInfo />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
  });
});

describe('Advanced danger area', () => {
  it('forgetNetwork: first click and typing do not fire; final confirm does', async () => {
    render(<Advanced />);
    const input = await arm('Oublier le réseau');
    expect(api.advanced).not.toHaveBeenCalled();
    const final = screen.getByRole('button', { name: /^confirmer/i });
    expect(final).toBeDisabled();
    fireEvent.click(final);
    expect(api.advanced).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'CONFIRMER' } });
    expect(api.advanced).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^confirmer/i }));
    await waitFor(() => expect(api.advanced).toHaveBeenCalledTimes(1));
    expect(api.advanced).toHaveBeenCalledWith('forgetNetwork');
  });

  it('factoryReset: needs both steps, warns it is irreversible', async () => {
    render(<Advanced />);
    expect(screen.getByText(/irréversible/i)).toBeInTheDocument();
    const input = await arm("Réinitialisation d'usine");
    expect(api.advanced).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'wrong' } });
    expect(screen.getByRole('button', { name: /^confirmer/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'CONFIRMER' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirmer/i }));
    await waitFor(() => expect(api.advanced).toHaveBeenCalledWith('factoryReset'));
    expect(api.advanced).toHaveBeenCalledTimes(1);
  });

  it('changeWifi: sends ssid and password only after the double confirmation', async () => {
    render(<Advanced />);
    const input = await arm('Changer le Wi-Fi');
    fireEvent.change(screen.getByLabelText('Nom du réseau (SSID)'), { target: { value: 'Maison' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret42' } });
    expect(api.advanced).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^confirmer/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'CONFIRMER' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirmer/i }));
    await waitFor(() => expect(api.advanced).toHaveBeenCalledTimes(1));
    expect(api.advanced).toHaveBeenCalledWith('changeWifi', { ssid: 'Maison', password: 'secret42' });
  });

  it('changeWifi stays blocked while the SSID is empty', async () => {
    render(<Advanced />);
    const input = await arm('Changer le Wi-Fi');
    fireEvent.change(input, { target: { value: 'CONFIRMER' } });
    expect(screen.getByRole('button', { name: /^confirmer/i })).toBeDisabled();
    expect(api.advanced).not.toHaveBeenCalled();
  });

  it('cancel disarms without calling the api', async () => {
    render(<Advanced />);
    await arm('Oublier le réseau');
    fireEvent.click(screen.getByRole('button', { name: /annuler/i }));
    expect(screen.queryByLabelText(/pour confirmer/i)).toBeNull();
    expect(api.advanced).not.toHaveBeenCalled();
  });

  it('shows the error when the call fails', async () => {
    api.advanced.mockRejectedValue(new api.ApiError('refusé', 500));
    render(<Advanced />);
    const input = await arm('Oublier le réseau');
    fireEvent.change(input, { target: { value: 'CONFIRMER' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirmer/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/refusé/);
  });

  it('warns that Wi-Fi changes can sever the connection', () => {
    render(<Advanced />);
    expect(screen.getAllByText(/couper la connexion/i).length).toBeGreaterThan(0);
  });

  it('has no update/OTA control and fires nothing on render', () => {
    render(<Advanced />);
    expect(screen.queryByRole('button', { name: /mise à jour|update|ota|firmware/i })).toBeNull();
    expect(screen.queryByText(/firmware|ota\b|TriggerUpdate/i)).toBeNull();
    expect(api.advanced).not.toHaveBeenCalled();
  });

  it('completing all three gates calls exactly the three allowed actions, once each', async () => {
    render(<Advanced />);
    const steps = [
      ['Changer le Wi-Fi', 'changeWifi'],
      ['Oublier le réseau', 'forgetNetwork'],
      ["Réinitialisation d'usine", 'factoryReset'],
    ];
    for (const [i, [name, action]] of steps.entries()) {
      const input = await arm(name);
      if (action === 'changeWifi') {
        fireEvent.change(screen.getByLabelText('Nom du réseau (SSID)'), { target: { value: 'Maison' } });
        fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret42' } });
      }
      fireEvent.change(input, { target: { value: 'CONFIRMER' } });
      fireEvent.click(screen.getByRole('button', { name: /^confirmer/i }));
      await waitFor(() => expect(api.advanced).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(i + 1));
    }
    expect(api.advanced.mock.calls.map((c) => c[0])).toEqual(['changeWifi', 'forgetNetwork', 'factoryReset']);
  });
});
