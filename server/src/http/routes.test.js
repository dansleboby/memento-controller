import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { createApp } from './server.js';
import { HeicUnsupportedError } from '../image/transcode.js';
import { RESERVED_ALBUMS } from '../protocol/albums.js';

const CONFIG = { Name: 'Frame', Brightness: 50, GUID: 'g-1' };

function makeClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue(CONFIG),
    getThumbnailsList: vi.fn().mockResolvedValue(['a.jpg', 'b.jpg']),
    getThumbnail: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    getAlbums: vi.fn().mockResolvedValue({
      albums: [
        ...RESERVED_ALBUMS.map((name) => ({ name, images: ['a.jpg'] })),
        { name: 'Trip', images: [] },
      ],
    }),
    sendAlbums: vi.fn().mockResolvedValue(undefined),
    changeSetting: vi.fn().mockResolvedValue(undefined),
    sendAwaySchedule: vi.fn().mockResolvedValue(undefined),
    sendTime: vi.fn().mockResolvedValue(undefined),
    getFrameTime: vi.fn().mockResolvedValue(new Date(2026, 9, 27, 18, 30, 5)),
    nextFrame: vi.fn().mockResolvedValue(undefined),
    previousFrame: vi.fn().mockResolvedValue(undefined),
    displayImage: vi.fn().mockResolvedValue(undefined),
    deleteImages: vi.fn().mockResolvedValue(undefined),
    forgetNetwork: vi.fn().mockResolvedValue(undefined),
    factoryReset: vi.fn().mockResolvedValue(undefined),
    uploadImage: vi.fn().mockResolvedValue(undefined),
  };
}

let client;
let transcode;
let app;
beforeEach(() => {
  client = makeClient();
  transcode = vi.fn(async (b) => Buffer.concat([Buffer.from('JPG:'), b]));
  app = createApp({ client, transcode, webDist: '/nonexistent-web-dist' });
});

describe('config & connection', () => {
  it('GET /api/config returns the mocked config', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CONFIG);
  });

  it('409 when no frame is connected', async () => {
    const res = await request(createApp({ webDist: '/nonexistent' })).get('/api/config');
    expect(res.status).toBe(409);
  });

  it('POST /api/connect builds a client for the ip and returns config', async () => {
    const created = makeClient();
    const createClient = vi.fn(() => created);
    const a = createApp({ createClient, webDist: '/nonexistent' });
    const res = await request(a).post('/api/connect').send({ ip: '192.168.0.50' });
    expect(res.status).toBe(200);
    expect(createClient).toHaveBeenCalledWith('192.168.0.50');
    expect(created.connect).toHaveBeenCalled();
    expect(res.body).toEqual({ config: CONFIG });
  });

  // The frame serves one controller: a second session to it would sit unanswered in its queue.
  it('POST /api/connect to the already-connected frame reuses the session', async () => {
    const created = makeClient();
    const createClient = vi.fn(() => created);
    const a = createApp({ createClient, webDist: '/nonexistent' });
    await request(a).post('/api/connect').send({ ip: '192.168.0.50' });

    const res = await request(a).post('/api/connect').send({ ip: '192.168.0.50' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ config: CONFIG });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(created.disconnect).not.toHaveBeenCalled();
  });

  it('POST /api/connect to another frame replaces the session', async () => {
    const first = makeClient();
    const second = makeClient();
    const createClient = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const a = createApp({ createClient, webDist: '/nonexistent' });
    await request(a).post('/api/connect').send({ ip: '192.168.0.50' });

    expect((await request(a).post('/api/connect').send({ ip: '192.168.0.51' })).status).toBe(200);
    expect(createClient).toHaveBeenLastCalledWith('192.168.0.51');
    expect(first.disconnect).toHaveBeenCalled();
  });

  it('POST /api/connect rejects a non-IPv4 host', async () => {
    const res = await request(app).post('/api/connect').send({ ip: 'evil.example.com' });
    expect(res.status).toBe(400);
  });

  it('POST /api/disconnect disconnects and drops the client', async () => {
    expect((await request(app).post('/api/disconnect')).status).toBe(204);
    expect(client.disconnect).toHaveBeenCalled();
    expect((await request(app).get('/api/config')).status).toBe(409);
  });
});

describe('discover', () => {
  it('returns frames', async () => {
    const discover = vi.fn().mockResolvedValue([{ ip: '1.2.3.4' }]);
    const a = createApp({ client, discover, webDist: '/nonexistent' });
    const res = await request(a).get('/api/discover');
    expect(res.body).toEqual([{ ip: '1.2.3.4' }]);
  });

  // The frame's listener is bound to 255.255.255.255:2015, so subnet broadcast and unicast never reach it.
  it('scans with the limited broadcast address', async () => {
    const discover = vi.fn().mockResolvedValue([]);
    const a = createApp({ client, discover, webDist: '/nonexistent' });
    await request(a).get('/api/discover');
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ broadcast: '255.255.255.255' }));
  });

  it('surfaces a UDP bind failure as 500, distinct from an empty scan', async () => {
    const discover = vi.fn(async ({ onError }) => {
      onError(Object.assign(new Error('bind EADDRINUSE'), { code: 'EADDRINUSE' }));
      return [];
    });
    const a = createApp({ client, discover, webDist: '/nonexistent' });
    const res = await request(a).get('/api/discover');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/EADDRINUSE/);
  });

  it('empty scan is a plain 200 []', async () => {
    const a = createApp({ client, discover: async () => [], webDist: '/nonexistent' });
    const res = await request(a).get('/api/discover');
    expect([res.status, res.body]).toEqual([200, []]);
  });
});

describe('settings, time, control', () => {
  it('POST /api/settings keys the inner payload by setting name with a string value', async () => {
    const res = await request(app).post('/api/settings').send({ action: 'ChangeContrast', value: 10 });
    expect(res.status).toBe(204);
    expect(client.changeSetting).toHaveBeenCalledWith('ChangeContrast', { Contrast: '10' });
  });

  it('POST /api/settings stringifies booleans', async () => {
    const res = await request(app).post('/api/settings').send({ action: 'ChangeOrientation', value: true });
    expect(res.status).toBe(204);
    expect(client.changeSetting).toHaveBeenCalledWith('ChangeOrientation', { PortraitMode: 'true' });
  });

  // Keys are the ones SetupData.Change*() reads on the frame (decompiled sw 6.02); any other key is silently ignored.
  it.each([
    ['ChangeBrightness', -10, { UserBrightnessOffset: '-10' }],
    ['ChangePower', false, { Power: 'false' }],
    ['ChangeShuffle', true, { Shuffle: 'true' }],
    ['ChangeEvening', true, { Evening: 'true' }],
    ['ChangeThreshold', 4, { Threshold: '4' }],
    ['ChangePictureDuration', 60, { PictureDuration: '60' }],
  ])('POST /api/settings sends %s under the key the frame reads', async (action, value, inner) => {
    const res = await request(app).post('/api/settings').send({ action, value });
    expect(res.status).toBe(204);
    expect(client.changeSetting).toHaveBeenCalledWith(action, inner);
  });

  it('PUT /api/away forwards validated slots', async () => {
    const slots = [{ day: 8, off: 3, on: 8 }, { day: 0, off: 22, on: 9 }];
    const res = await request(app).put('/api/away').send({ slots });
    expect(res.status).toBe(204);
    expect(client.sendAwaySchedule).toHaveBeenCalledWith(slots);
  });

  it('PUT /api/away accepts an empty list (clears the schedule)', async () => {
    expect((await request(app).put('/api/away').send({ slots: [] })).status).toBe(204);
    expect(client.sendAwaySchedule).toHaveBeenCalledWith([]);
  });

  it.each([
    ['missing slots', {}],
    ['more than 7 slots', { slots: Array.from({ length: 8 }, () => ({ day: 9, off: 1, on: 2 })) }],
    ['day out of range', { slots: [{ day: 10, off: 1, on: 2 }] }],
    ['hour out of range', { slots: [{ day: 9, off: 24, on: 2 }] }],
    ['non-integer hour', { slots: [{ day: 9, off: 1.5, on: 2 }] }],
  ])('PUT /api/away rejects %s', async (_label, body) => {
    expect((await request(app).put('/api/away').send(body)).status).toBe(400);
    expect(client.sendAwaySchedule).not.toHaveBeenCalled();
  });

  it.each(['SendConfig', 'TriggerUpdate'])('POST /api/settings rejects %s', async (action) => {
    const res = await request(app).post('/api/settings').send({ action, value: 1 });
    expect(res.status).toBe(400);
    expect(client.changeSetting).not.toHaveBeenCalled();
  });

  it('POST /api/settings forwards a frame time zone display name', async () => {
    const res = await request(app).post('/api/settings').send({ action: 'ChangeTimeZone', value: '(UTC-05:00) Eastern Time (US & Canada)' });
    expect(res.status).toBe(204);
    expect(client.changeSetting).toHaveBeenCalledWith('ChangeTimeZone', { TimeZone: '(UTC-05:00) Eastern Time (US & Canada)' });
  });

  it('POST /api/settings rejects a time zone the frame would reset to Casablanca', async () => {
    const res = await request(app).post('/api/settings').send({ action: 'ChangeTimeZone', value: 'America/Toronto' });
    expect(res.status).toBe(400);
    expect(client.changeSetting).not.toHaveBeenCalled();
  });

  it('POST /api/settings requires an action', async () => {
    expect((await request(app).post('/api/settings').send({ value: 1 })).status).toBe(400);
  });

  it('GET /api/time returns the frame wall clock as a zone-less ISO string', async () => {
    const res = await request(app).get('/api/time');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frameTime: '2026-10-27T18:30:05' });
  });

  it('POST /api/time sends the given instant', async () => {
    const res = await request(app).post('/api/time').send({ iso: '2026-01-02T03:04:05Z' });
    expect(res.status).toBe(204);
    expect(client.sendTime).toHaveBeenCalledWith(new Date('2026-01-02T03:04:05Z'));
    expect((await request(app).post('/api/time').send({ iso: 'nope' })).status).toBe(400);
  });

  it('POST /api/control dispatches only known actions', async () => {
    expect((await request(app).post('/api/control').send({ action: 'nextFrame' })).status).toBe(204);
    expect(client.nextFrame).toHaveBeenCalled();
    await request(app).post('/api/control').send({ action: 'displayImage', name: 'a.jpg' });
    expect(client.displayImage).toHaveBeenCalledWith('a.jpg');
    expect((await request(app).post('/api/control').send({ action: 'factoryReset' })).status).toBe(400);
    expect(client.factoryReset).not.toHaveBeenCalled();
  });

  it('POST /api/images/delete', async () => {
    const res = await request(app).post('/api/images/delete').send({ names: ['a.jpg'] });
    expect(res.status).toBe(204);
    expect(client.deleteImages).toHaveBeenCalledWith(['a.jpg']);
    expect((await request(app).post('/api/images/delete').send({ names: [] })).status).toBe(400);
  });
});

describe('thumbnails', () => {
  it('lists and serves PNG bytes', async () => {
    expect((await request(app).get('/api/thumbnails')).body).toEqual(['a.jpg', 'b.jpg']);
    const res = await request(app).get('/api/thumbnails/a.jpg');
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(client.getThumbnail).toHaveBeenCalledWith('a.jpg');
  });
});

describe('upload', () => {
  it('transcodes then uploads each file', async () => {
    const res = await request(app)
      .post('/api/upload')
      .attach('files', Buffer.from('raw1'), 'Photo One.HEIC')
      .attach('files', Buffer.from('raw2'), 'two.png');
    expect(res.status).toBe(200);
    expect(transcode).toHaveBeenCalledTimes(2);
    expect(client.uploadImage).toHaveBeenCalledTimes(2);
    const [name, bytes, info, opts] = client.uploadImage.mock.calls[0];
    expect(name).toBe('photo one.jpg');
    expect(bytes.toString()).toBe('JPG:raw1');
    // Pixels are already upright; the key must be present for a portrait-mounted frame to remap it.
    expect(info).toEqual({ orientation: 0 });
    expect(typeof opts.onProgress).toBe('function');
    expect(transcode.mock.invocationCallOrder[0]).toBeLessThan(client.uploadImage.mock.invocationCallOrder[0]);
    expect(res.body.uploaded).toEqual(['photo one.jpg', 'two.jpg']);
  });

  it('HeicUnsupportedError -> 422 with the actionable message', async () => {
    transcode.mockRejectedValue(new HeicUnsupportedError('no HEIF loader'));
    const res = await request(app).post('/api/upload').attach('files', Buffer.from('x'), 'a.heic');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/HEIC/);
    expect(client.uploadImage).not.toHaveBeenCalled();
  });

  it('400 with no files', async () => {
    expect((await request(app).post('/api/upload')).status).toBe(400);
  });
});

describe('albums', () => {
  it('GET returns AlbumData', async () => {
    expect((await request(app).get('/api/albums')).body.albums).toHaveLength(4);
  });

  it('PUT applies one edit then sendAlbums', async () => {
    const res = await request(app)
      .put('/api/albums')
      .send({ edit: { type: 'createAlbum', name: 'New' } });
    expect(res.status).toBe(200);
    expect(client.sendAlbums).toHaveBeenCalledTimes(1);
    expect(client.sendAlbums.mock.calls[0][0].albums.map((a) => a.name)).toContain('New');
  });

  it('PUT rejects reserved-album deletion with 4xx and sends nothing', async () => {
    const res = await request(app)
      .put('/api/albums')
      .send({ edit: { type: 'deleteAlbum', name: RESERVED_ALBUMS[0] } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(client.sendAlbums).not.toHaveBeenCalled();
  });

  it('PUT maps a limit violation (68th album) to 409 and sends nothing', async () => {
    const albums = [...RESERVED_ALBUMS, ...Array.from({ length: 64 }, (_, i) => `A${i}`)].map((name) => ({ name, images: [] }));
    client.getAlbums.mockResolvedValue({ albums });
    const res = await request(app).put('/api/albums').send({ edit: { type: 'createAlbum', name: 'Over' } });
    expect(res.status).toBe(409);
    expect(client.sendAlbums).not.toHaveBeenCalled();
  });

  it('PUT rejects an unknown edit type with 4xx', async () => {
    const res = await request(app).put('/api/albums').send({ edit: { type: 'wipe' } });
    expect(res.status).toBe(400);
  });
});

describe('advanced / TriggerUpdate exclusion', () => {
  it('forgetNetwork and factoryReset are dispatched', async () => {
    expect((await request(app).post('/api/advanced').send({ action: 'forgetNetwork' })).status).toBe(204);
    expect((await request(app).post('/api/advanced').send({ action: 'factoryReset' })).status).toBe(204);
    expect(client.forgetNetwork).toHaveBeenCalled();
    expect(client.factoryReset).toHaveBeenCalled();
  });

  it('wifi change maps to a granular changeSetting', async () => {
    const res = await request(app)
      .post('/api/advanced')
      .send({ action: 'changeWifi', ssid: 'Home', password: 'pw' });
    expect(res.status).toBe(204);
    expect(client.changeSetting).toHaveBeenCalledWith('WiFi', { WiFiSSID: 'Home', WiFiPSWD: 'pw' });
  });

  it.each(['triggerUpdate', 'TriggerUpdate', 'update', 'ota', ''])('rejects %j with 4xx', async (action) => {
    const res = await request(app).post('/api/advanced').send({ action });
    expect(res.status).toBe(400);
  });

  it('no route or source reaches TriggerUpdate', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
      expect(readFileSync(path.join(dir, f), 'utf8').toLowerCase()).not.toContain('triggerupdate');
    }
  });
});

describe('events (SSE) and static', () => {
  it('GET /api/events streams a status snapshot', async () => {
    const srv = await new Promise((r) => {
      const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    try {
      const { headers, body } = await new Promise((resolve, reject) => {
        http
          .get({ port: srv.address().port, path: '/api/events' }, (res) => {
            res.once('data', (chunk) => {
              resolve({ headers: res.headers, body: chunk.toString() });
              res.destroy();
            });
          })
          .on('error', reject);
      });
      expect(headers['content-type']).toMatch(/text\/event-stream/);
      expect(body).toMatch(/event: status\ndata: {"connected":true/);
    } finally {
      srv.closeAllConnections();
      srv.close();
    }
  });

  it('boots without web/dist: non-API GET is 404, API still works', async () => {
    expect((await request(app).get('/some/spa/route')).status).toBe(404);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});
