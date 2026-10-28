import net from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { CommandChannel } from './commandChannel.js';
import { encodeMessage, decodeMessage } from './wire.js';
import { mockFrame } from '../../test/mockFrame.js';

describe('CommandChannel', () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()();
  });

  async function setup(handlers, options) {
    const frame = await mockFrame(handlers);
    const ch = new CommandChannel(options);
    cleanups.push(() => frame.close(), () => ch.disconnect());
    await ch.connect('127.0.0.1', frame.port);
    return { frame, ch };
  }

  test('send resolves with the matching reply payload', async () => {
    const { ch } = await setup({ onGetConfig: () => ({ Name: 'Salon', SoftwareVersion: 6.02 }) });
    const cfg = await ch.send('Cadre.CommandChangeSetup', { m_Action: 'GetConfig', sData: '' }, { encryptStrings: ['sData'] });
    expect(cfg.sDataDecoded.Name).toBe('Salon');
  });

  test('connect sends Disconnect first', async () => {
    const { frame } = await setup();
    expect(frame.received[0]).toMatch(/"m_Action":"Disconnect"/);
  });

  test('concurrent sends are serialized (ids never interleave on the wire)', async () => {
    const { frame, ch } = await setup({ replyDelayMs: 50 });
    const a = ch.send('Cadre.CommandChangeSetup', { m_Action: 'A' });
    const b = ch.send('Cadre.CommandChangeSetup', { m_Action: 'B' });
    await Promise.all([a, b]);
    const ids = frame.events.filter((e) => e.startsWith('recv:')).map((e) => Number(e.slice(5)));
    const [, first, second] = ids;
    expect(second).toBe(first + 1);
    expect(frame.events.indexOf(`reply:${first}`)).toBeLessThan(frame.events.indexOf(`recv:${second}`));
  });

  test('send rejects on timeout when the frame never replies', async () => {
    const { ch } = await setup({ silent: true }, { timeoutMs: 200 });
    const start = Date.now();
    await expect(ch.send('Cadre.CommandChangeSetup', { m_Action: 'GetConfig' })).rejects.toThrow(/timeout/i);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('disconnect resolves promptly after the socket was already destroyed', async () => {
    const { ch } = await setup({ silent: true }, { timeoutMs: 100 });
    await expect(ch.send('Cadre.CommandChangeSetup', { m_Action: 'GetConfig' })).rejects.toThrow(/timeout/i);
    const outcome = await Promise.race([ch.disconnect().then(() => 'done'), new Promise((r) => setTimeout(() => r('hung'), 500))]);
    expect(outcome).toBe('done');
  });

  test('an unserializable payload rejects at once and leaves the channel usable', async () => {
    const { ch } = await setup({}, { timeoutMs: 150 });
    await expect(ch.send('Cadre.CommandChangeSetup', { m_Action: 'X', big: 1n })).rejects.toThrow();
    // Outlive the timeout the failed send would have armed: it must not wipe state or kill the socket.
    await new Promise((r) => setTimeout(r, 250));
    await expect(ch.send('Cadre.CommandChangeSetup', { m_Action: 'Y' })).resolves.toMatchObject({ m_Action: 'YDone' });
  });

  test('connect resolves quickly and stays usable when the Disconnect is never answered', async () => {
    const frame = await mockFrame({ ignoreDisconnect: true });
    const ch = new CommandChannel({ disconnectGraceMs: 100 });
    cleanups.push(() => frame.close(), () => ch.disconnect());
    const start = Date.now();
    await ch.connect('127.0.0.1', frame.port);
    expect(Date.now() - start).toBeLessThan(1000);
    await expect(ch.send('Cadre.CommandChangeSetup', { m_Action: 'Z' })).resolves.toMatchObject({ m_Action: 'ZDone' });
  });

  describe('stream reassembly', () => {
    // Raw server whose per-message writes the test controls; `onMessage(socket, {type,payload,id}, n)`.
    async function rawServer(onMessage) {
      const sockets = new Set();
      const server = net.createServer((socket) => {
        sockets.add(socket);
        socket.setNoDelay(true);
        socket.on('error', () => {});
        let buf = '';
        let n = 0;
        socket.on('data', (d) => {
          buf += d.toString('ascii');
          let i;
          while ((i = buf.indexOf('<EOF>')) >= 0) {
            const raw = buf.slice(0, i + 5);
            buf = buf.slice(i + 5);
            onMessage(socket, decodeMessage(raw), n++);
          }
        });
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      cleanups.push(() => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); }));
      return server.address().port;
    }
    const reply = (msg, extra) => encodeMessage(msg.type, { m_Action: `${msg.payload.m_Action}Done`, ...extra }, msg.id);
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));

    test('a reply split across chunks, including inside <EOF>, is reassembled', async () => {
      const port = await rawServer(async (socket, msg) => {
        const bytes = reply(msg, { v: 'abc' }).toString('ascii');
        const cut = bytes.length - 3; // lands between "<E" and "OF>"
        socket.write(bytes.slice(0, 7));
        await pause(20);
        socket.write(bytes.slice(7, cut));
        await pause(20);
        socket.write(bytes.slice(cut));
      });
      const ch = new CommandChannel({ timeoutMs: 1000 });
      cleanups.push(() => ch.disconnect());
      await ch.connect('127.0.0.1', port);
      await expect(ch.send('Cadre.CommandChangeSetup', { m_Action: 'S' })).resolves.toEqual({ m_Action: 'SDone', v: 'abc' });
    });

    // The frame announces each slideshow change with its own message id, even mid-request.
    test('a SendCurrentImageName push during a request is not taken as its reply', async () => {
      const port = await rawServer(async (socket, msg) => {
        socket.write(encodeMessage('Cadre.CommandControlFlow', { m_Action: 'SendCurrentImageName', m_SourceFileName: 'x.jpg' }, 77));
        await pause(20);
        socket.write(reply(msg, { v: 'real' }));
      });
      const ch = new CommandChannel({ timeoutMs: 1000, clearStaleSession: false });
      cleanups.push(() => ch.disconnect());
      await ch.connect('127.0.0.1', port);
      await expect(ch.send('Cadre.CommandControlTransferFile', { m_Action: 'R' })).resolves.toEqual({ m_Action: 'RDone', v: 'real' });
    });

    test('a late Disconnect echo coalesced with the next reply is not misattributed', async () => {
      let held;
      const port = await rawServer((socket, msg, n) => {
        if (n === 0) held = reply(msg); // Disconnect: answer only after the grace window
        else socket.write(Buffer.concat([held, reply(msg, { v: 'real' })]));
      });
      const ch = new CommandChannel({ timeoutMs: 1000, disconnectGraceMs: 50 });
      cleanups.push(() => ch.disconnect());
      await ch.connect('127.0.0.1', port);
      await expect(ch.send('Cadre.CommandChangeSetup', { m_Action: 'C' })).resolves.toEqual({ m_Action: 'CDone', v: 'real' });
    });
  });
});
