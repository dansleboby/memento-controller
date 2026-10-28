import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import * as api from '../api/client.js';
import ImageSettings from './ImageSettings.jsx';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ApiError: actual.ApiError, getConfig: vi.fn(), setSetting: vi.fn() };
});

const CONFIG = {
  Brightness: [140, 105, 65, 50, 32, 21, 6, -40, -140, -210, -255],
  ContrastOffset: 5,
  ExposureOffset: -3,
  SaturationOffset: 7,
  TemperatureOffset: -9,
  OffThresholdOffset: 12,
  CalibrationTableName: 'Bright',
};

const SLIDERS = [
  ['Contraste', 'ChangeContrast', 5],
  ['Exposition', 'ChangeExposure', -3],
  ['Saturation', 'ChangeSaturation', 7],
  ['Température', 'ChangeTemperature', -9],
  ["Seuil d'extinction", 'ChangeThreshold', 12],
];

beforeEach(() => {
  vi.resetAllMocks();
  api.getConfig.mockResolvedValue(CONFIG);
  api.setSetting.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderScreen() {
  render(<ImageSettings />);
  await screen.findByLabelText('Contraste');
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

describe('ImageSettings', () => {
  it.each(SLIDERS)('loads %s from config', async (label, _action, initial) => {
    await renderScreen();
    expect(screen.getByLabelText(label)).toHaveValue(String(initial));
  });

  it('loads the calibration select from config', async () => {
    await renderScreen();
    expect(screen.getByLabelText('Table de calibration')).toHaveValue('Bright');
  });

  // The frame sends only the current name; these are its SetupData.ms_Calibration* constants.
  it("offers the frame's six calibration tables", async () => {
    await renderScreen();
    const values = within(screen.getByLabelText('Table de calibration')).getAllByRole('option').map((o) => o.value);
    expect(values).toEqual(['Darker', 'Dark', 'Standard', 'Bright', 'Brighter', 'Vivid']);
  });

  it.each(SLIDERS)('%s posts exactly one write with its own action', async (label, action) => {
    await renderScreen();
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText(label), { target: { value: '33' } });
    await settle();
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith(action, 33);
  });

  it('collapses a drag into a single write with the final value', async () => {
    await renderScreen();
    vi.useFakeTimers();
    const slider = screen.getByLabelText('Contraste');
    for (const v of ['10', '20', '30', '45']) {
      fireEvent.change(slider, { target: { value: v } });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    expect(api.setSetting).not.toHaveBeenCalled();
    await settle();
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith('ChangeContrast', 45);
  });

  it('writes calibration immediately as a string', async () => {
    await renderScreen();
    fireEvent.change(screen.getByLabelText('Table de calibration'), { target: { value: 'Vivid' } });
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith('ChangeCalibration', 'Vivid');
  });

  it('shows an error when a write fails and stays usable', async () => {
    api.setSetting.mockRejectedValue(new api.ApiError(502, 'frame unreachable'));
    await renderScreen();
    fireEvent.change(screen.getByLabelText('Table de calibration'), { target: { value: 'Vivid' } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraste')).toBeInTheDocument();
  });

  it('shows an error when config fails to load but keeps the screen', async () => {
    api.getConfig.mockRejectedValue(new api.ApiError(502, 'down'));
    render(<ImageSettings />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraste')).toBeInTheDocument();
  });

  it('never renders NaN for the brightness curve', async () => {
    await renderScreen();
    expect(document.body).not.toHaveTextContent('NaN');
  });

  it.each([
    ['Moins lumineux', -10],
    ['Plus lumineux', 10],
    ['Luminosité par défaut', 305419896],
  ])('%s posts one relative ChangeBrightness write', async (label, value) => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith('ChangeBrightness', value);
  });
});
