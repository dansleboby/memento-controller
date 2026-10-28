import net from 'node:net';

// Port 2018 is a raw byte stream with no framing: the 2017 channel announces
// direction and size, and this channel only moves the bytes.
const FILE_PORT = 2018;
const CHUNK = 64 * 1024;

// One persistent 2018 connection per controller session (verified live, sw 6.02):
// the frame routes every transfer through the FIRST file socket it accepted in
// the session and accepts no other until the session ends. So the socket must be
// open before the first transfer command and must never be half-closed.
//
// The frame starts streaming a download before its 2017 reply, so incoming bytes
// are buffered until read() claims them. One transfer at a time (the caller
// serializes). read()/write() have no deadline of their own: the caller passes an
// AbortSignal. After an abort or error the stream position is unknown, so the
// caller must drop the channel rather than reuse it.
export class FileChannel {
  #socket = null;
  #chunks = [];
  #buffered = 0;
  #closed = false;
  #onChange = null;

  connect(host, port = FILE_PORT) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => {
        socket.off('error', reject);
        resolve();
      });
      socket.once('error', reject);
      socket.on('error', () => {}); // 'close' follows and carries the state change
      socket.on('data', (chunk) => {
        this.#chunks.push(chunk);
        this.#buffered += chunk.length;
        this.#onChange?.();
      });
      socket.on('close', () => {
        this.#closed = true;
        this.#onChange?.();
      });
      this.#socket = socket;
    });
  }

  get closed() {
    return this.#closed || !this.#socket;
  }

  read(size, { onProgress, signal } = {}) {
    return this.#run(signal, (done) => () => {
      onProgress?.(Math.min(this.#buffered, size), size);
      if (this.#buffered >= size) done(null, this.#take(size));
      else if (this.#closed) done(new Error(`stream ended after ${this.#buffered} of ${size} bytes`));
    });
  }

  write(bytes, { onProgress, signal } = {}) {
    return this.#run(signal, (done) => {
      const socket = this.#socket;
      const total = bytes.length;
      let offset = 0;
      const pump = () => {
        while (offset < total) {
          const end = Math.min(offset + CHUNK, total);
          const ok = socket.write(bytes.subarray(offset, end), (err) => {
            if (err) return done(err);
            onProgress?.(end, total);
            if (end === total) done(null);
          });
          offset = end;
          if (!ok) {
            socket.once('drain', pump);
            return;
          }
        }
      };
      if (total === 0) {
        onProgress?.(0, 0);
        done(null);
      } else {
        pump();
      }
      return () => {
        if (this.#closed) done(new Error('connection closed before transfer completed'));
      };
    });
  }

  close() {
    this.#closed = true;
    this.#socket?.destroy();
  }

  // start(done) runs once and returns the check invoked on every data/close event.
  #run(signal, start) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new Error('transfer aborted'));
      if (this.closed) return reject(new Error('file channel not connected'));
      let settled = false;
      const onAbort = () => done(signal.reason ?? new Error('transfer aborted'));
      const done = (err, value) => {
        if (settled) return;
        settled = true;
        this.#onChange = null;
        signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(value);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const check = start(done);
      if (!settled) {
        this.#onChange = check;
        check();
      }
    });
  }

  #take(size) {
    const all = this.#chunks.length === 1 ? this.#chunks[0] : Buffer.concat(this.#chunks);
    const out = all.subarray(0, size);
    const rest = all.subarray(size);
    this.#chunks = rest.length ? [rest] : [];
    this.#buffered = rest.length;
    return out;
  }
}
