import net from 'node:net';
import { fastEncrypt, fastDecrypt } from '../crypto/des.js';
import { encodeMessage, decodeMessage } from './wire.js';

const EOF_MARKER = '<EOF>';
const CONTROL_TYPE = 'Cadre.CommandControlFlow';
const PUSH_ACTION = 'SendCurrentImageName';

export class CommandChannel {
  #socket = null;
  #buffer = '';
  #nextId = 1;
  #tail = Promise.resolve();
  #pending = null; // { resolve, reject } of the single in-flight request
  #staleIds = new Set(); // best-effort requests that timed out; their late echo is dropped
  #timeoutMs;
  #graceMs;
  #clearStaleSession;

  constructor({ timeoutMs = 8000, disconnectGraceMs = 300, clearStaleSession = true } = {}) {
    this.#timeoutMs = timeoutMs;
    this.#graceMs = disconnectGraceMs;
    this.#clearStaleSession = clearStaleSession;
  }

  async connect(host, port = 2017) {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      socket.setEncoding('ascii');
      socket.once('connect', () => {
        socket.off('error', reject);
        resolve();
      });
      socket.once('error', reject);
      socket.on('data', (chunk) => this.#onData(chunk));
      socket.on('error', (err) => this.#fail(err));
      socket.on('close', () => this.#fail(new Error('Socket closed')));
      this.#socket = socket;
    });
    // Clear a session a previous run left behind. The real frame (verified live)
    // treats Disconnect as "this controller is done" and then ignores every
    // further command on the SAME socket, so a caller that must keep using this
    // connection (MementoClient) opts out and instead sends Disconnect last;
    // the frame frees an abandoned controller via its own idle watchdog.
    if (this.#clearStaleSession) await this.#bestEffortDisconnect();
  }

  send(type, payload, { encryptStrings = [], timeoutMs } = {}) {
    return this.#enqueue(() => this.#exchange(type, payload, encryptStrings, { timeoutMs }));
  }

  get connected() {
    return Boolean(this.#socket) && !this.#socket.destroyed;
  }

  async disconnect() {
    if (!this.#socket || this.#socket.destroyed) return;
    await this.#bestEffortDisconnect();
    const socket = this.#socket;
    this.#socket = null;
    if (!socket || socket.destroyed) return;
    await new Promise((resolve) => {
      socket.once('close', resolve);
      socket.destroy();
    });
  }

  // The frame may close or ignore a Disconnect rather than echo it: wait only a short grace
  // window and keep the socket usable if nothing comes back.
  #bestEffortDisconnect() {
    return this.#enqueue(() =>
      this.#exchange(CONTROL_TYPE, { m_Action: 'Disconnect' }, [], { timeoutMs: this.#graceMs, bestEffort: true }),
    ).catch(() => {});
  }

  // The frame handles one request at a time: chain on the previous one, whatever its outcome.
  #enqueue(run) {
    const result = this.#tail.then(run, run);
    this.#tail = result.catch(() => {});
    return result;
  }

  #exchange(type, payload, encryptStrings, { timeoutMs, bestEffort = false } = {}) {
    timeoutMs ??= this.#timeoutMs;
    const socket = this.#socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error('Not connected'));

    const body = { ...payload };
    for (const field of encryptStrings) {
      if (typeof body[field] === 'string' && body[field] !== '') body[field] = fastEncrypt(body[field]);
    }
    const id = this.#nextId++;
    // Encode before arming the timer / #pending so a serialization error leaves no state behind.
    let bytes;
    try {
      bytes = encodeMessage(type, body, id);
    } catch (err) {
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      const entry = {
        encryptStrings,
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      const timer = setTimeout(() => {
        if (this.#pending !== entry) return;
        this.#pending = null;
        if (bestEffort) {
          // A late echo must not be taken for the next request's reply.
          this.#staleIds.add(id);
        } else {
          // A late reply would be mistaken for the next request's, so the stream is unusable.
          socket.destroy();
        }
        reject(new Error(`Timeout waiting for reply to ${type} #${id}`));
      }, timeoutMs);
      this.#pending = entry;
      socket.write(bytes, (err) => err && this.#fail(err));
    });
  }

  #onData(chunk) {
    this.#buffer += chunk;
    let idx;
    while ((idx = this.#buffer.indexOf(EOF_MARKER)) >= 0) {
      const raw = this.#buffer.slice(0, idx + EOF_MARKER.length);
      this.#buffer = this.#buffer.slice(idx + EOF_MARKER.length);
      let message;
      try {
        message = decodeMessage(raw);
      } catch (err) {
        this.#fail(err);
        continue;
      }
      if (this.#staleIds.delete(message.id)) continue;
      // The frame's only push: it announces every slideshow change, even while a
      // request is in flight, under its own message id (it never echoes ours), so
      // it can only be told apart by action. We never send this action.
      if (message.payload?.m_Action === PUSH_ACTION) continue;
      const pending = this.#pending;
      // Drop anything else that arrives with no request in flight.
      if (!pending) continue;
      this.#pending = null;
      try {
        pending.resolve(this.#decodeReply(message.payload, pending.encryptStrings));
      } catch (err) {
        pending.reject(err);
      }
    }
  }

  #decodeReply(payload, encryptStrings) {
    for (const field of encryptStrings) {
      const value = payload[field];
      if (typeof value !== 'string' || value === '') continue;
      const plain = fastDecrypt(value);
      try {
        payload[`${field}Decoded`] = JSON.parse(plain);
      } catch {
        payload[`${field}Decoded`] = plain;
      }
    }
    return payload;
  }

  #fail(err) {
    const pending = this.#pending;
    this.#pending = null;
    pending?.reject(err);
  }
}
