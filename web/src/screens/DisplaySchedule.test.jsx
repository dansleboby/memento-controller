import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import * as api from '../api/client.js';
import DisplaySchedule from './DisplaySchedule.jsx';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ApiError: actual.ApiError, getConfig: vi.fn(), setSetting: vi.fn(), setAwaySchedule: vi.fn() };
});

const CONFIG = {
  DisplayOn: true,
  ShuffleOn: false,
  DisplayTime: 30,
  PortraitMode: false,
  NightModeOn: true,
  AwayEnable: [true, false],
  AwayDay: [8, 7],
  AwayOffTime: [3, 22],
  AwayOnTime: [8, 9],
};

const ALLOWED = [
  'ChangeBrightness', 'ChangeContrast', 'ChangeExposure', 'ChangeSaturation',
  'ChangeTemperature', 'ChangeThreshold', 'ChangeCalibration', 'ChangePower',
  'ChangeShuffle', 'ChangePictureDuration', 'ChangeOrientation', 'ChangeEvening',
  'ChangeTimeZone',
];

beforeEach(() => {
  vi.resetAllMocks();
  api.getConfig.mockResolvedValue(CONFIG);
  api.setSetting.mockResolvedValue(undefined);
  api.setAwaySchedule.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderScreen() {
  render(<DisplaySchedule />);
  await screen.findByLabelText('Alimentation');
}

describe('DisplaySchedule', () => {
  it('loads controls from config', async () => {
    await renderScreen();
    expect(screen.getByLabelText('Alimentation')).toBeChecked();
    expect(screen.getByLabelText('Lecture aléatoire')).not.toBeChecked();
    expect(screen.getByLabelText('Durée par image (s)')).toHaveValue(30);
    expect(screen.getByLabelText('Mode portrait')).not.toBeChecked();
    expect(screen.getByLabelText('Mode nuit (soirée)')).toBeChecked();
  });

  it.each([
    ['Alimentation', 'ChangePower', false],
    ['Lecture aléatoire', 'ChangeShuffle', true],
    ['Mode portrait', 'ChangeOrientation', true],
    ['Mode nuit (soirée)', 'ChangeEvening', false],
  ])('toggling %s posts one %s write with boolean %s', async (label, action, value) => {
    await renderScreen();
    fireEvent.click(screen.getByLabelText(label));
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith(action, value);
  });

  it('debounces picture duration into one integer write', async () => {
    await renderScreen();
    vi.useFakeTimers();
    const input = screen.getByLabelText('Durée par image (s)');
    for (const v of ['4', '45', '450']) fireEvent.change(input, { target: { value: v } });
    expect(api.setSetting).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith('ChangePictureDuration', 450);
  });

  const away = () => within(screen.getByRole('region', { name: "Horaire d'absence" }));

  it('loads each away slot into its controls', async () => {
    await renderScreen();
    expect(away().getByLabelText('Jours (créneau 1)')).toHaveValue('8');
    expect(away().getByLabelText('Extinction (créneau 1)')).toHaveValue('3');
    expect(away().getByLabelText('Rallumage (créneau 1)')).toHaveValue('8');
    expect(away().getByLabelText('Jours (créneau 2)')).toHaveValue('7');
  });

  it('warns that a slot marked disabled still applies on this frame', async () => {
    await renderScreen();
    expect(away().getByText(/s'applique quand même/)).toBeInTheDocument();
  });

  it('saves the edited schedule in one away write, never through settings', async () => {
    await renderScreen();
    fireEvent.change(away().getByLabelText('Extinction (créneau 1)'), { target: { value: '23' } });
    fireEvent.click(away().getByRole('button', { name: 'Retirer le créneau 2' }));
    fireEvent.click(away().getByRole('button', { name: "Enregistrer l'horaire" }));
    await waitFor(() => expect(api.setAwaySchedule).toHaveBeenCalledTimes(1));
    expect(api.setAwaySchedule).toHaveBeenCalledWith([{ day: 8, off: 23, on: 8 }]);
    expect(api.setSetting).not.toHaveBeenCalled();
    expect(await away().findByText('Horaire enregistré.')).toBeInTheDocument();
  });

  it('adds slots up to the frame limit of 7', async () => {
    api.getConfig.mockResolvedValue({ ...CONFIG, AwayEnable: null, AwayDay: null, AwayOffTime: null, AwayOnTime: null });
    await renderScreen();
    expect(away().getByText(/Aucun créneau/)).toBeInTheDocument();
    const add = away().getByRole('button', { name: 'Ajouter un créneau' });
    for (let i = 0; i < 7; i++) fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(away().getByLabelText('Jours (créneau 7)')).toBeInTheDocument();
  });

  it('can clear the schedule', async () => {
    await renderScreen();
    fireEvent.click(away().getByRole('button', { name: 'Retirer le créneau 2' }));
    fireEvent.click(away().getByRole('button', { name: 'Retirer le créneau 1' }));
    fireEvent.click(away().getByRole('button', { name: "Enregistrer l'horaire" }));
    await waitFor(() => expect(api.setAwaySchedule).toHaveBeenCalledWith([]));
  });

  it('shows an error when saving the schedule fails', async () => {
    api.setAwaySchedule.mockRejectedValue(new api.ApiError('frame unreachable', 502));
    await renderScreen();
    fireEvent.click(away().getByRole('button', { name: "Enregistrer l'horaire" }));
    expect(await away().findByRole('alert')).toHaveTextContent(/frame unreachable/);
  });

  it('only ever posts allowed actions with scalar values', async () => {
    await renderScreen();
    fireEvent.click(screen.getByLabelText('Alimentation'));
    fireEvent.click(screen.getByLabelText('Mode portrait'));
    for (const [action, value] of api.setSetting.mock.calls) {
      expect(ALLOWED).toContain(action);
      expect(['boolean', 'number', 'string']).toContain(typeof value);
    }
  });

  it('shows an error when a write fails and stays usable', async () => {
    api.setSetting.mockRejectedValue(new api.ApiError(502, 'frame unreachable'));
    await renderScreen();
    fireEvent.click(screen.getByLabelText('Mode portrait'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Alimentation')).toBeInTheDocument();
  });

  it('shows an error when config fails to load but keeps the screen', async () => {
    api.getConfig.mockRejectedValue(new api.ApiError(502, 'down'));
    render(<DisplaySchedule />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Alimentation')).toBeInTheDocument();
  });
});
