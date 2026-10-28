import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MementoClient } from '../src/protocol/mementoClient.js';

// Opt-in, READ-ONLY integration test against a real frame. Skipped by default:
// it never runs in the normal suite and only activates with MEMENTO_LIVE_IP set
//   cd server && MEMENTO_LIVE_IP=192.168.0.128 npx vitest run test/live.frame.test.js
// It issues only GetConfig / GetFrameTime / GetThumbnailsList / GetThumbnails /
// GetAlbums - no write, delete, upload, settings-change or control command
// touches the device, apart from the clock sync every session sends on connect.
const ip = process.env.MEMENTO_LIVE_IP;

describe.skipIf(!ip)('live frame read paths', () => {
  let client;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The frame allows a single controller and frees an abandoned one only via an
  // idle watchdog, so a quick reconnect after a prior run can be ignored; retry
  // through it rather than failing on a transient lock.
  beforeAll(async () => {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      client = new MementoClient(ip, { commandTimeoutMs: 8000 });
      try {
        await client.connect();
        await client.getConfig();
        return;
      } catch (err) {
        lastErr = err;
        await client.disconnect().catch(() => {});
        await sleep(20000);
      }
    }
    throw lastErr;
  }, 120000);

  afterAll(async () => {
    await client?.disconnect().catch(() => {});
  });

  it('GetConfig returns a named config', async () => {
    const config = await client.getConfig();
    expect(config && typeof config).toBe('object');
    expect(typeof config.Name).toBe('string');
    expect(config.Name.length).toBeGreaterThan(0);
  });

  it('GetFrameTime returns a valid Date', async () => {
    const time = await client.getFrameTime();
    expect(time instanceof Date).toBe(true);
    expect(Number.isNaN(time.getTime())).toBe(false);
  });

  let photos = [];

  it('GetThumbnailsList returns photo names', async () => {
    photos = await client.getThumbnailsList();
    expect(Array.isArray(photos)).toBe(true);
    for (const name of photos) expect(name).toMatch(/^[^|]+\.jpg$/);
  });

  it('GetThumbnails returns a PNG for the first photo', async ({ skip }) => {
    if (!photos.length) skip();
    const png = await client.getThumbnail(photos[0]);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('GetAlbums returns AlbumData with the reserved albums', async () => {
    const data = await client.getAlbums();
    expect(Array.isArray(data.albums)).toBe(true);
    if (data.albums.length) expect(data.albums[0].name).toBe('Photos_$%^&(*@#!');
  });
});
