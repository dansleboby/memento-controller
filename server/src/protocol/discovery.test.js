import { describe, it, expect, afterEach } from 'vitest';
import dgram from 'node:dgram';
import { discover } from './discovery.js';

const REQUEST_PORT = 42015;
const RESPONSE_PORT = 42016;

const FRAME = {
  name: 'Salon',
  utf8_name: 'Salon',
  softver: '1.2.3',
  hardver: 'A1',
  size: '10.1',
  orientation: 0,
  ip: '127.0.0.1',
  mac: 'AA:BB:CC:DD:EE:FF',
  guid: 'guid-1234',
  hasInternet: false,
  IsConnected: false,
};

let responder;

function startResponder(reply, { ignoreFirst = 0 } = {}) {
  let seen = 0;
  return new Promise((resolve) => {
    responder = dgram.createSocket('udp4');
    responder.on('message', (msg, rinfo) => {
      if (msg.toString('ascii') !== 'MEMENTO_SMARTFRAME|MementoWeb') return;
      if (seen++ < ignoreFirst) return;
      // The real frame ignores the source port and always answers on the fixed reply port.
      for (const payload of reply) {
        responder.send(payload, RESPONSE_PORT, rinfo.address);
      }
    });
    responder.bind(REQUEST_PORT, '127.0.0.1', resolve);
  });
}

afterEach(() => {
  responder?.close();
  responder = null;
});

describe('discover', () => {
  it('returns parsed FrameInfo from a plaintext reply, de-duplicated by guid', async () => {
    const payload = `MEMENTO_SMARTFRAME|${JSON.stringify(FRAME)}|<EOF>`;
    await startResponder([payload, payload]);

    const frames = await discover({
      unicastIp: '127.0.0.1',
      timeoutMs: 400,
      requestPort: REQUEST_PORT,
      responsePort: RESPONSE_PORT,
    });

    expect(frames).toHaveLength(1);
    expect(frames[0].name).toBe('Salon');
    expect(frames[0].guid).toBe('guid-1234');
  });

  // Live, the frame answered only ~40% of broadcasts over Wi-Fi, so one probe misses it half the time.
  it('repeats the probe within the window so a lost request is not fatal', async () => {
    await startResponder([`MEMENTO_SMARTFRAME|${JSON.stringify(FRAME)}|<EOF>`], { ignoreFirst: 2 });

    const frames = await discover({
      unicastIp: '127.0.0.1',
      timeoutMs: 600,
      retryMs: 100,
      requestPort: REQUEST_PORT,
      responsePort: RESPONSE_PORT,
    });

    expect(frames.map((f) => f.guid)).toEqual(['guid-1234']);
  });

  it('settles shortly after the first answer instead of waiting out the whole window', async () => {
    await startResponder([`MEMENTO_SMARTFRAME|${JSON.stringify(FRAME)}|<EOF>`]);
    const started = Date.now();

    const frames = await discover({
      unicastIp: '127.0.0.1',
      timeoutMs: 3000,
      settleMs: 200,
      requestPort: REQUEST_PORT,
      responsePort: RESPONSE_PORT,
    });

    expect(frames).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('resolves [] when nobody answers', async () => {
    const started = Date.now();
    const frames = await discover({
      unicastIp: '127.0.0.1',
      timeoutMs: 300,
      requestPort: REQUEST_PORT,
      responsePort: RESPONSE_PORT,
    });

    expect(frames).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
