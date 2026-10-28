import { CommandChannel } from './commandChannel.js';
import { FileChannel } from './fileChannel.js';
import { encrypt as aesEncrypt, decrypt as aesDecrypt } from '../crypto/aes.js';
import { parseAlbumBlob, serializeAlbumBlob, normalizeFilename } from './albums.js';

// fastJSON type names the frame resolves via Type.GetType inside CadreAndroid.
const CHANGE_SETUP = 'Cadre.CommandChangeSetup';
const CONTROL_FLOW = 'Cadre.CommandControlFlow';
const TRANSFER_FILE = 'Cadre.CommandControlTransferFile';
const DEFAULT_COMMAND_PORT = 2017;
const DEFAULT_FILE_PORT = 2018;
const ALBUM_FILE = 'AlbumData.json';
const THUMB_SUFFIX = '.thumb.png';

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// MementoClient is the single frame-facing facade the HTTP layer calls. A
// session is one control connection (2017) plus one file connection (2018).
//
// Serialization: CommandChannel only serializes 2017 sends, which does NOT
// cover a transfer's 2018 stream or a lazy connect(). This facade adds a
// client-level single-flight queue so each WHOLE operation - its 2017 commands
// and its 2018 stream together - runs with exclusive access to the frame; the
// frame accepts one controller, so nothing else may interleave.
//
// Session discipline (verified live against frame "Salon", sw 6.02):
//  - connect() does NOT send Disconnect first. The real frame treats Disconnect
//    as "controller done" and then ignores every further command on that
//    socket, so Disconnect is only ever sent LAST, from disconnect().
//  - The frame serves one controller and leaves a newcomer's socket queued,
//    unread, until the current session ends (it drops an idle one after ~20 s).
//    connect() waits that out: a queued socket abandoned on timeout stays in the
//    frame's backlog and later holds the frame for another 20 s.
//  - The 2018 socket is opened only once the frame answers on 2017, and kept for
//    the whole session: the frame transfers only over the first file socket it
//    accepted, and tearing down the previous session closes every file socket.
//  - The frame accepts a single controller and closes the session after ~20 s
//    without a command. A closed or dead session is detected here and the next
//    call reconnects on fresh sockets.
//  - Every session starts by sending the time, like the official client. The
//    maker's time server (builds.mementosmartframe.com) is gone, so after a boot
//    the frame's UTC clock stays at DateTime.MinValue until a controller sets it,
//    and a ChangeTimeZone to a negative offset then throws inside the frame,
//    killing the session without applying the change.
//
// Transfer handshake: replies carry the real size and file name only inside the
// DES-encrypted m_Data JSON ({ dstfilename, filesize }); m_FileSize is always 0.
// Every transfer is closed with "<Action>Ended", answered "<Action>Succeeded".
export class MementoClient {
  #host;
  #softver;
  #commandPort;
  #filePort;
  #commandTimeoutMs;
  #connectTimeoutMs;
  #transferTimeoutMs;
  #transferIdleMs;
  #now;
  #channel = null;
  #files = null;
  #connected = false;
  #connectPromise = null;
  #tail = Promise.resolve();

  constructor(host, {
    softver,
    commandPort = DEFAULT_COMMAND_PORT,
    filePort = DEFAULT_FILE_PORT,
    commandTimeoutMs = 8000,
    connectTimeoutMs = 30000,
    transferTimeoutMs = 120000,
    transferIdleMs = 10000,
    now = () => new Date(),
  } = {}) {
    this.#host = host;
    this.#softver = softver;
    this.#commandPort = commandPort;
    this.#filePort = filePort;
    this.#commandTimeoutMs = commandTimeoutMs;
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#transferTimeoutMs = transferTimeoutMs;
    this.#transferIdleMs = transferIdleMs;
    this.#now = now;
  }

  // Reported as frame info; it does not gate behavior. sData/album encryption is
  // unconditional because the only supported frames are software version >= 5
  // (ENCRYPT_VERSION), where the command channel is always obfuscated.
  get softver() {
    return this.#softver;
  }

  // Idempotent under concurrency: callers racing the first command all await the
  // same connect and exactly one session (one 2017 + one 2018 socket) is built. A
  // failed attempt clears the in-progress promise so a later call can retry.
  async connect() {
    if (this.#connected) return;
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = (async () => {
      const channel = new CommandChannel({ timeoutMs: this.#commandTimeoutMs, clearStaleSession: false });
      await channel.connect(this.#host, this.#commandPort);
      const files = new FileChannel();
      try {
        await channel.send(CONTROL_FLOW, { m_Action: 'Beacon' }, { timeoutMs: this.#connectTimeoutMs });
        await files.connect(this.#host, this.#filePort);
        await channel.send(
          CHANGE_SETUP,
          { m_Action: 'SendTime', sData: JSON.stringify({ DateTime: formatFrameDateTime(this.#now()) }) },
          { encryptStrings: ['sData'], timeoutMs: this.#connectTimeoutMs },
        );
      } catch (err) {
        files.close();
        await channel.disconnect().catch(() => {});
        throw err;
      }
      this.#channel = channel;
      this.#files = files;
      this.#connected = true;
    })();
    try {
      await this.#connectPromise;
    } finally {
      this.#connectPromise = null;
    }
  }

  // Tear down and reconnect on a fresh socket, e.g. after a dead channel.
  async reconnect() {
    await this.disconnect();
    await this.connect();
  }

  async disconnect() {
    this.#connected = false;
    this.#connectPromise = null;
    const channel = this.#channel;
    const files = this.#files;
    this.#channel = null;
    this.#files = null;
    // channel.disconnect() sends Disconnect (best-effort) then closes the socket.
    if (channel) await channel.disconnect().catch(() => {});
    files?.close();
  }

  // ---- Reads ----

  getConfig() {
    return this.#runExclusive(async () => {
      const reply = await this.#command(CHANGE_SETUP, { m_Action: 'GetConfig', sData: '' }, { encryptStrings: ['sData'] });
      return this.#asObject(reply.sDataDecoded);
    });
  }

  getFrameTime() {
    return this.#runExclusive(async () => {
      const reply = await this.#command(CHANGE_SETUP, { m_Action: 'GetFrameTime', sData: '' }, { encryptStrings: ['sData'] });
      const decoded = reply.sDataDecoded;
      const raw = decoded && typeof decoded === 'object' ? decoded.DateTime : decoded;
      return parseFrameDateTime(raw);
    });
  }

  getCurrentImageName() {
    return this.#runExclusive(async () => {
      const reply = await this.#command(CONTROL_FLOW, { m_Action: 'GetCurrentImageName' });
      // Live frame returns the name in m_SourceFileName (empty when nothing is shown).
      return typeof reply.m_SourceFileName === 'string' ? reply.m_SourceFileName : '';
    });
  }

  // Photo names ("<name>.jpg"), the form every other frame command accepts.
  getThumbnailsList() {
    return this.#runExclusive(async () => parseThumbnailsList((await this.#pull('GetThumbnailsList')).toString('utf8')));
  }

  // The frame looks the thumbnail up by m_DestinationFileName, ignoring its extension.
  getThumbnail(name) {
    return this.#runExclusive(() => this.#pull('GetThumbnails', { m_DestinationFileName: normalizeFilename(name) }));
  }

  getAlbums() {
    return this.#runExclusive(async () => {
      const bytes = await this.#pull('GetAlbums');
      if (bytes.length === 0) return { albums: [] };
      return parseAlbumBlob(aesDecrypt(bytes.toString('ascii')));
    });
  }

  // ---- Settings (granular: one key per call, never a whole-object SendConfig) ----

  changeSetting(action, inner) {
    return this.#runExclusive(() =>
      this.#command(CHANGE_SETUP, { m_Action: action, sData: JSON.stringify(inner) }, { encryptStrings: ['sData'] }),
    );
  }

  // SendConfig applies only the keys it receives (each is ContainsKey-guarded on the
  // frame, sw 6.02), so this rewrites the away schedule and nothing else - never Wi-Fi.
  // The arrays are indexed in parallel and must stay the same length. sw 6.02 ignores
  // AwayEnable (every listed slot applies), so it is always true.
  sendAwaySchedule(slots) {
    return this.changeSetting('SendConfig', {
      AwayDay: slots.map((s) => s.day),
      AwayOffTime: slots.map((s) => s.off),
      AwayOnTime: slots.map((s) => s.on),
      AwayEnable: slots.map(() => true),
    });
  }

  // { DateTime: "MM/dd/yyyy HH:mm:ss" } in UTC: the frame stores it as its UTC clock and applies its own zone.
  sendTime(date) {
    return this.changeSetting('SendTime', { DateTime: formatFrameDateTime(date) });
  }

  // ---- Control flow ----

  nextFrame() {
    return this.#runExclusive(() => this.#command(CONTROL_FLOW, { m_Action: 'NextFrame' }));
  }

  previousFrame() {
    return this.#runExclusive(() => this.#command(CONTROL_FLOW, { m_Action: 'PreviousFrame' }));
  }

  displayImage(name) {
    return this.#runExclusive(() =>
      this.#command(CONTROL_FLOW, { m_Action: 'DisplayImage', m_SourceFileName: normalizeFilename(name) }),
    );
  }

  deleteImages(names) {
    return this.#runExclusive(() =>
      this.#command(CONTROL_FLOW, { m_Action: 'DeleteImage', m_Filenames: names.map(normalizeFilename) }),
    );
  }

  forgetNetwork() {
    return this.#runExclusive(() => this.#command(CONTROL_FLOW, { m_Action: 'ForgetNetwork' }));
  }

  factoryReset() {
    return this.#runExclusive(() => this.#command(CONTROL_FLOW, { m_Action: 'FactoryReset' }));
  }

  // ---- Transfers ----

  // Thin pass-through: the frame owns album/current-image consistency on upload.
  // Resolves once the frame has stored, re-encoded and thumbnailed the photo.
  // onProgress receives the sent fraction (0..1).
  uploadImage(name, bytes, info, { onProgress, timeoutMs = this.#transferTimeoutMs } = {}) {
    return this.#runExclusive(() =>
      this.#push('WriteFile', normalizeFilename(name), bytes, { info: JSON.stringify(info ?? {}), onProgress, timeoutMs }),
    );
  }

  // The only place the AES album blob is rewritten; callers compose the new
  // AlbumData through albums.applyAlbumEdit so the reserved-album guards hold.
  sendAlbums(albumData) {
    return this.#runExclusive(() =>
      this.#push('SendAlbums', ALBUM_FILE, Buffer.from(aesEncrypt(serializeAlbumBlob(albumData)), 'ascii')),
    );
  }

  // ---- internals ----

  // Single-flight queue: chain each operation on the previous one whatever its
  // outcome, so only one talks to the frame at a time.
  #runExclusive(run) {
    const result = this.#tail.then(run, run);
    this.#tail = result.then(() => {}, () => {});
    return result;
  }

  async #command(type, payload, options) {
    if (this.#connected && (!this.#channel.connected || this.#files.closed)) await this.disconnect();
    if (!this.#connected) await this.connect();
    try {
      return await this.#channel.send(type, payload, options);
    } catch (err) {
      // A command timeout or a closed socket leaves the session unusable; drop it
      // so the next call reconnects rather than writing into a dead socket.
      if (/not connected|socket closed|timeout/i.test(err.message)) await this.disconnect();
      throw err;
    }
  }

  async #transfer(action, fields, expected, timeoutMs) {
    const reply = await this.#command(TRANSFER_FILE, { m_Action: action, ...fields }, { encryptStrings: ['m_Data'], timeoutMs });
    if (reply.m_Action !== expected) throw new Error(`${action}: frame replied ${reply.m_Action}`);
    return reply;
  }

  // Aborts after timeoutMs overall, or after transferIdleMs without progress (e.g. the
  // frame streams to a stale queued 2018 socket it adopted instead of ours). After a
  // failed stream the 2018 position is unknown: never reuse the session.
  async #stream(run, timeoutMs) {
    const controller = new AbortController();
    const abort = (message) => controller.abort(new Error(message));
    const total = setTimeout(() => abort(`transfer timed out after ${timeoutMs}ms`), timeoutMs);
    let idle;
    const progressed = () => {
      clearTimeout(idle);
      idle = setTimeout(() => abort(`no data for ${this.#transferIdleMs}ms`), this.#transferIdleMs);
    };
    progressed();
    try {
      return await run(controller.signal, progressed);
    } catch (err) {
      await this.disconnect();
      throw err;
    } finally {
      clearTimeout(total);
      clearTimeout(idle);
    }
  }

  // Download: the frame streams on 2018 as it replies "<Action>Started".
  async #pull(action, fields = {}) {
    const reply = await this.#transfer(action, fields, `${action}Started`);
    const size = Number(reply.m_DataDecoded?.filesize) || 0;
    // A 0-byte send leaves the frame's transfer flag stuck so its Ended would
    // block forever; skip the Ended and let the next call start a fresh session.
    if (size <= 0) {
      await this.disconnect();
      return Buffer.alloc(0);
    }
    const bytes = await this.#stream(
      (signal, progressed) => this.#files.read(size, { signal, onProgress: progressed }),
      this.#transferTimeoutMs,
    );
    await this.#transfer(`${action}Ended`, {}, `${action}Succeeded`);
    return bytes;
  }

  // Upload: the Ended command must repeat name and size; the frame holds its reply
  // until the last byte lands and, for a photo, it is re-encoded and thumbnailed.
  async #push(action, name, bytes, { info = '', onProgress, timeoutMs = this.#transferTimeoutMs } = {}) {
    const fields = { m_DestinationFileName: name, m_SourceFileName: name, m_FileSize: bytes.length };
    await this.#transfer(action, { ...fields, m_FileInfoJSON: info }, `${action}Started`);
    await this.#stream(
      (signal, progressed) =>
        this.#files.write(bytes, {
          signal,
          onProgress: (sent, total) => {
            progressed();
            onProgress?.(total ? sent / total : 1);
          },
        }),
      timeoutMs,
    );
    await this.#transfer(`${action}Ended`, fields, `${action}Succeeded`, timeoutMs);
  }

  #asObject(decoded) {
    if (decoded && typeof decoded === 'object') return decoded;
    if (typeof decoded === 'string') {
      // Live sData decrypts to clean JSON, but tolerate a stray BOM/prefix.
      const start = decoded.indexOf('{');
      if (start >= 0) return JSON.parse(decoded.slice(start));
    }
    throw new Error('Expected a JSON object in the reply payload');
  }
}

// "Memento Version <v>" header, then one "<name>.thumb.png|<md5>" line per photo.
function parseThumbnailsList(text) {
  return stripBom(text)
    .split(/\r?\n/)
    .map((line) => line.split('|')[0].trim())
    .filter((name) => name.endsWith(THUMB_SUFFIX))
    .map((name) => `${name.slice(0, -THUMB_SUFFIX.length)}.jpg`);
}

// The frame speaks .NET DateTime strings "MM/dd/yyyy HH:mm:ss" (verified live).
function parseFrameDateTime(raw) {
  if (raw instanceof Date) return raw;
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, mo, d, y, h, mi, sec] = m.map(Number);
    return new Date(y, mo - 1, d, h, mi, sec);
  }
  return new Date(s);
}

function formatFrameDateTime(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(date.getUTCMonth() + 1)}/${p(date.getUTCDate())}/${p(date.getUTCFullYear(), 4)} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
}
