import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { applyAlbumEdit, normalizeFilename } from '../protocol/albums.js';
import { HeicUnsupportedError } from '../image/transcode.js';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const CONTROL_ACTIONS = new Set(['nextFrame', 'previousFrame', 'displayImage']);
// Action -> inner-payload key, as read by the frame's SetupData.Change*() (decompiled sw 6.02).
// The frame silently ignores any other key and still replies Done. Values go out as strings.
const SETTING_KEYS = {
  ChangeContrast: 'Contrast',
  // A relative nudge at the current ambient-light level, not an absolute level; 305419896 resets.
  ChangeBrightness: 'UserBrightnessOffset',
  ChangeExposure: 'Exposure',
  ChangeSaturation: 'Saturation',
  ChangeTemperature: 'Temperature',
  ChangeThreshold: 'Threshold',
  ChangeCalibration: 'CalibrationTableName',
  ChangeOrientation: 'PortraitMode',
  ChangePower: 'Power',
  ChangeShuffle: 'Shuffle',
  ChangePictureDuration: 'PictureDuration',
  ChangeTimeZone: 'TimeZone',
  ChangeEvening: 'Evening',
};
// The frame's discovery listener is bound to 255.255.255.255:2015 (ReceiveBroadcastThread), so a subnet
// broadcast or a unicast probe never reaches it. Its reply comes back to UDP 2016 from an ephemeral port,
// which a host firewall treats as new inbound traffic.
const DISCOVERY_BROADCAST = '255.255.255.255';
// The frame parses the offset out of this prefix and resets anything else to "(UTC+00:00) Casablanca".
const FRAME_TIME_ZONE = /^\(UTC[+-]\d{2}:\d{2}\) /;
const ALBUM_EDITS = new Set(['createAlbum', 'renameAlbum', 'deleteAlbum', 'reorderAlbums', 'assignImages']);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

/**
 * API router. `ctx` supplies the shared frame state so tests can inject mocks:
 * { getClient, setClient, createClient, transcode, discover, bus }.
 */
export function createRoutes(ctx) {
  const router = express.Router();
  ctx.bus.setMaxListeners(0); // one listener pair per SSE client
  router.use(express.json({ limit: '1mb' }));

  const frame = () => {
    const c = ctx.getClient();
    if (!c) throw new HttpError(409, 'No frame connected. POST /api/connect first.');
    return c;
  };

  // Live status channel: Server-Sent Events. Events: `status`, `upload`.
  router.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('status', ctx.status());
    const onStatus = (d) => send('status', d);
    const onUpload = (d) => send('upload', d);
    ctx.bus.on('status', onStatus);
    ctx.bus.on('upload', onUpload);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      ctx.bus.off('status', onStatus);
      ctx.bus.off('upload', onUpload);
    });
  });

  router.get('/discover', async (req, res) => {
    let bindError = null;
    const frames = await ctx.discover({ broadcast: DISCOVERY_BROADCAST, onError: (e) => (bindError = e) });
    if (bindError) {
      console.error('discovery failed to open UDP socket:', bindError);
      throw new HttpError(500, `Discovery could not open its UDP socket (${bindError.code ?? bindError.message}).`);
    }
    res.json(frames);
  });

  router.post('/connect', async (req, res) => {
    const ip = req.body?.ip;
    const m = typeof ip === 'string' && IPV4.exec(ip);
    if (!m || m.slice(1).some((o) => Number(o) > 255)) throw bad('ip must be an IPv4 address');
    const prev = ctx.getClient();
    // The frame serves one controller: a second session to it would only queue behind this one.
    if (prev && ctx.status().ip === ip) {
      res.json({ config: await prev.getConfig() });
      return;
    }
    const next = ctx.createClient(ip);
    try {
      await next.connect();
      const config = await next.getConfig();
      ctx.setClient(next, ip);
      // Old session is torn down only after the new one is proven.
      if (prev) await prev.disconnect().catch(() => {});
      res.json({ config });
    } catch (err) {
      await next.disconnect?.().catch(() => {});
      throw err;
    }
  });

  router.post('/disconnect', async (req, res) => {
    const c = ctx.getClient();
    ctx.setClient(null, null);
    if (c) await c.disconnect();
    res.status(204).end();
  });

  router.get('/config', async (req, res) => res.json(await frame().getConfig()));

  router.post('/settings', async (req, res) => {
    const { action, value } = req.body ?? {};
    if (!Object.hasOwn(SETTING_KEYS, action)) throw bad(`unsupported settings action: ${action}`);
    if (value === undefined) throw bad('value is required');
    if (action === 'ChangeTimeZone' && !FRAME_TIME_ZONE.test(String(value))) {
      throw bad('TimeZone must be one of the frame\'s "(UTC+hh:mm) ..." display names');
    }
    await frame().changeSetting(action, { [SETTING_KEYS[action]]: String(value) });
    res.status(204).end();
  });

  // Slots: { day: AwayDays index 0-9, off: hour 0-23, on: hour 0-23 }; the frame keeps at most 7.
  router.put('/away', async (req, res) => {
    const slots = req.body?.slots;
    const inRange = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
    if (!Array.isArray(slots) || slots.length > 7) throw bad('slots must be an array of at most 7 entries');
    if (!slots.every((s) => s && inRange(s.day, 9) && inRange(s.off, 23) && inRange(s.on, 23))) {
      throw bad('each slot needs day 0-9 and off/on hours 0-23');
    }
    await frame().sendAwaySchedule(slots.map(({ day, off, on }) => ({ day, off, on })));
    res.status(204).end();
  });

  // getFrameTime() maps the frame's local wall clock onto host-local Date fields; read them back unshifted.
  router.get('/time', async (req, res) => {
    const d = await frame().getFrameTime();
    const p = (n) => String(n).padStart(2, '0');
    const frameTime = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    res.json({ frameTime });
  });

  router.post('/time', async (req, res) => {
    const d = new Date(req.body?.iso);
    if (Number.isNaN(d.getTime())) throw bad('iso must be a valid date string');
    await frame().sendTime(d);
    res.status(204).end();
  });

  router.get('/thumbnails', async (req, res) => res.json(await frame().getThumbnailsList()));

  router.get('/thumbnails/:name', async (req, res) => {
    const png = await frame().getThumbnail(req.params.name);
    res.type('image/png').send(png);
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 50 },
  });

  router.post('/upload', upload.array('files'), async (req, res) => {
    const files = req.files ?? [];
    if (!files.length) throw bad('no files in multipart field "files"');
    const client = frame();
    const uploaded = [];
    for (const [index, file] of files.entries()) {
      const base = path.parse(path.basename(file.originalname)).name || 'image';
      const name = normalizeFilename(`${base}.jpg`);
      const emit = (fraction, state = 'uploading') =>
        ctx.bus.emit('upload', { name, index, total: files.length, fraction, state });
      emit(0, 'transcoding');
      let jpeg;
      try {
        jpeg = await ctx.transcode(file.buffer);
      } catch (err) {
        emit(0, 'error');
        if (err instanceof HeicUnsupportedError) throw new HttpError(422, err.message);
        throw new HttpError(400, `could not process ${file.originalname}: ${err.message}`);
      }
      try {
        // transcode() bakes EXIF rotation in; a portrait-mounted frame only remaps orientation when the key is present.
        await client.uploadImage(name, jpeg, { orientation: 0 }, { onProgress: (f) => emit(f) });
      } catch (err) {
        emit(0, 'error');
        throw err;
      }
      emit(1, 'done');
      uploaded.push(name);
    }
    res.json({ uploaded });
  });

  router.post('/images/delete', async (req, res) => {
    const names = req.body?.names;
    if (!Array.isArray(names) || !names.length || !names.every((n) => typeof n === 'string')) {
      throw bad('names must be a non-empty string array');
    }
    await frame().deleteImages(names);
    res.status(204).end();
  });

  router.post('/control', async (req, res) => {
    const { action, name } = req.body ?? {};
    if (!CONTROL_ACTIONS.has(action)) throw bad(`unsupported control action: ${action}`);
    const c = frame();
    if (action === 'displayImage') {
      if (typeof name !== 'string' || !name) throw bad('name is required');
      await c.displayImage(name);
    } else {
      await c[action]();
    }
    res.status(204).end();
  });

  router.get('/albums', async (req, res) => res.json(await frame().getAlbums()));

  router.put('/albums', async (req, res) => {
    const edit = req.body?.edit;
    if (!edit || !ALBUM_EDITS.has(edit.type)) throw bad('edit.type must be one of ' + [...ALBUM_EDITS].join(', '));
    const c = frame();
    const current = await c.getAlbums();
    let next;
    try {
      next = applyAlbumEdit(current, edit);
    } catch (err) {
      throw new HttpError(409, err.message);
    }
    await c.sendAlbums(next);
    res.json(next);
  });

  // Allowlist: anything else (including any firmware-update action) is rejected.
  router.post('/advanced', async (req, res) => {
    const { action, ssid, password } = req.body ?? {};
    const c = frame();
    if (action === 'forgetNetwork') await c.forgetNetwork();
    else if (action === 'factoryReset') await c.factoryReset();
    else if (action === 'changeWifi') {
      if (typeof ssid !== 'string' || !ssid || typeof password !== 'string') throw bad('ssid and password are required');
      await c.changeSetting('WiFi', { WiFiSSID: ssid, WiFiPSWD: password });
    } else throw bad(`unsupported advanced action: ${action}`);
    res.status(204).end();
  });

  router.use((req, res) => res.status(404).json({ error: 'not found' }));
  return router;
}
