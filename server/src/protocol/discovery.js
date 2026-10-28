import dgram from 'node:dgram';

const MAGIC = 'MEMENTO_SMARTFRAME';
// Exactly 2 fields: with 3+ the frame AES-encrypts its reply, which we avoid.
const REQUEST = Buffer.from(`${MAGIC}|MementoWeb`, 'ascii');
const EOF_MARKER = '<EOF>';

function parseReply(buf) {
  const text = buf.toString('utf8');
  if (!text.startsWith(`${MAGIC}|`)) return null;
  const json = text.slice(MAGIC.length + 1).replace(EOF_MARKER, '').replace(/\|\s*$/, '');
  try {
    const info = JSON.parse(json);
    return info && typeof info === 'object' ? info : null;
  } catch {
    return null;
  }
}

/**
 * Finds frames on the LAN. Never rejects on "nothing found": resolves [] so the
 * caller can fall back to a manually entered IP.
 */
export function discover({
  broadcast,
  unicastIp,
  // Wi-Fi broadcasts go out unacknowledged at the base rate; live, the frame answered ~40% of probes,
  // with misses in runs of a few seconds. Probe for a long window, but settle soon after an answer.
  timeoutMs = 5000,
  retryMs = 400,
  settleMs = 800,
  requestPort = 2015,
  responsePort = 2016,
  onError,
} = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();
    let done = false;
    let resend = null;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(resend);
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve([...found.values()]);
    };

    // Replies go to the fixed response port regardless of our source port, so we must own it.
    const deadline = Date.now() + timeoutMs;
    let timer = setTimeout(finish, timeoutMs);

    // Still resolves what was found; onError lets the caller tell a failed bind from an empty scan.
    socket.on('error', (err) => {
      try {
        onError?.(err);
      } catch {
        // a throwing callback must not skip finish()
      }
      finish();
    });
    socket.on('message', (msg) => {
      const info = parseReply(msg);
      if (!info) return;
      const key = info.guid || info.ip;
      if (!key || found.has(key)) return;
      if (found.size === 0) {
        clearTimeout(timer);
        timer = setTimeout(finish, Math.min(settleMs, deadline - Date.now()));
      }
      found.set(key, info);
    });

    socket.bind(responsePort, () => {
      if (done) return;
      if (broadcast) socket.setBroadcast(true);
      const probe = () => {
        for (const target of [broadcast, unicastIp]) {
          if (target) socket.send(REQUEST, requestPort, target, () => {});
        }
      };
      probe();
      resend = setInterval(probe, retryMs);
    });
  });
}
