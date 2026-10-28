import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import * as api from '../api/client.js';
import Clock from './Clock.jsx';
import { FRAME_TIME_ZONES } from '../timeZones.js';

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ApiError: actual.ApiError, getConfig: vi.fn(), setSetting: vi.fn(), setTime: vi.fn(), getFrameTime: vi.fn() };
});

const EASTERN = '(UTC-05:00) Eastern Time (US & Canada)';
const PARIS = '(UTC+01:00) Brussels, Copenhagen, Madrid, Paris';

beforeEach(() => {
  vi.resetAllMocks();
  api.getConfig.mockResolvedValue({ TimeZoneName: EASTERN });
  api.setSetting.mockResolvedValue(undefined);
  api.setTime.mockResolvedValue(undefined);
  api.getFrameTime.mockResolvedValue({ frameTime: '2026-10-27T18:30:05' });
});

describe('Clock', () => {
  it('loads the time zone and writes a change as ChangeTimeZone', async () => {
    render(<Clock />);
    const tz = await screen.findByLabelText('Fuseau horaire');
    expect(tz).toHaveValue(EASTERN);
    fireEvent.change(tz, { target: { value: PARIS } });
    expect(api.setSetting).toHaveBeenCalledTimes(1);
    expect(api.setSetting).toHaveBeenCalledWith('ChangeTimeZone', PARIS);
  });

  it("offers only the frame's own time zone names", async () => {
    render(<Clock />);
    const tz = await screen.findByLabelText('Fuseau horaire');
    const values = within(tz).getAllByRole('option').map((o) => o.value);
    expect(values).toEqual(FRAME_TIME_ZONES);
    expect(values).not.toContain('America/Toronto');
  });

  it("shows the frame's own clock and re-reads it after a sync", async () => {
    render(<Clock />);
    expect(await screen.findByText('18:30, le 27/10/2026')).toBeInTheDocument();
    api.getFrameTime.mockResolvedValue({ frameTime: '2026-10-27T22:31:00' });
    fireEvent.click(screen.getByRole('button', { name: /régler l'horloge/i }));
    expect(await screen.findByText('22:31, le 27/10/2026')).toBeInTheDocument();
  });

  it("sets the clock via setTime with an ISO string, not setSetting", async () => {
    render(<Clock />);
    await screen.findByLabelText('Fuseau horaire');
    fireEvent.click(screen.getByRole('button', { name: /régler l'horloge/i }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(api.setTime).toHaveBeenCalledTimes(1);
    expect(api.setTime.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(api.setSetting).not.toHaveBeenCalled();
  });
});
