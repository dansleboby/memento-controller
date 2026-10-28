import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { FileChannel } from './fileChannel.js';

let server;
const sockets = new Set();
const channels = [];

function listen(onConnection) {
  return new Promise((resolve) => {
    server = net.createServer((s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      onConnection(s);
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function open(port) {
  const ch = new FileChannel();
  channels.push(ch);
  await ch.connect('127.0.0.1', port);
  return ch;
}

function patterned(size) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 31 + (i >> 8)) & 0xff;
  return buf;
}

afterEach(async () => {
  while (channels.length) channels.pop().close();
  for (const s of sockets) s.destroy();
  if (server) await new Promise((r) => server.close(r));
  server = undefined;
});

describe('FileChannel.write', () => {
  it('delivers the exact bytes with progress ending at total, without closing the socket', async () => {
    const payload = patterned(4 * 1024 * 1024 + 123);
    const chunks = [];
    let peerSawEnd = false;
    let peer;
    const port = await listen((s) => {
      peer = s;
      s.on('data', (c) => chunks.push(c));
      s.on('end', () => (peerSawEnd = true));
    });
    const ch = await open(port);
    const calls = [];
    await ch.write(payload, { onProgress: (sent, total) => calls.push([sent, total]) });
    await new Promise((r) => setTimeout(r, 50));

    expect(calls[calls.length - 1]).toEqual([payload.length, payload.length]);
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
    expect(peerSawEnd).toBe(false);
    expect(ch.closed).toBe(false);

    // The same socket carries the next transfer in the other direction.
    peer.write(Buffer.from('next'));
    expect((await ch.read(4)).toString()).toBe('next');
  });
});

describe('FileChannel.read', () => {
  it('returns exactly size bytes, keeping data that arrived before the read', async () => {
    const data = patterned(1024 * 1024);
    const port = await listen((s) => s.write(data));
    const ch = await open(port);
    await new Promise((r) => setTimeout(r, 50)); // bytes land before anyone reads
    const calls = [];
    const out = await ch.read(data.length, { onProgress: (r, t) => calls.push([r, t]) });
    expect(out.equals(data)).toBe(true);
    expect(calls[calls.length - 1]).toEqual([data.length, data.length]);
  });

  it('serves consecutive reads from one stream without losing bytes', async () => {
    const data = patterned(5000);
    const port = await listen((s) => s.write(data));
    const ch = await open(port);
    const a = await ch.read(1234);
    const b = await ch.read(5000 - 1234);
    expect(Buffer.concat([a, b]).equals(data)).toBe(true);
  });

  it('rejects when the stream ends early', async () => {
    const port = await listen((s) => s.end(Buffer.alloc(10)));
    const ch = await open(port);
    await expect(ch.read(100)).rejects.toThrow(/ended after 10 of 100/);
    expect(ch.closed).toBe(true);
  });

  it('rejects promptly on abort', async () => {
    const port = await listen(() => {});
    const ch = await open(port);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('transfer timed out')), 20);
    await expect(ch.read(100, { signal: controller.signal })).rejects.toThrow(/timed out/);
  });
});
