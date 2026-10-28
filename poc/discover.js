#!/usr/bin/env node
// Throwaway PoC: discover a Memento Smart Frame on the LAN.
//
// Protocol (recovered from Cadre.apk -> Cadre.ReceiveBroadcastThread):
//   - Frame listens for UDP broadcasts on port 2015.
//   - Payload is '|'-separated; field[0] must start with "MEMENTO_SMARTFRAME".
//   - Frame replies to the SENDER's IP on the fixed port 2016 with
//     "<tag>|<json>|<EOF>". The reply is AES-encrypted ONLY when the request
//     carried >= 3 fields, so we send exactly 2 fields to get plaintext JSON.
//
// We bind our socket to 2016 (the frame always answers there, ignoring our
// source port). The frame's listener is bound to 255.255.255.255:2015, so only
// the limited broadcast reaches it; subnet broadcast and unicast are ignored.

const dgram = require('dgram');

const FRAME_IP = process.argv[2] || '192.168.0.128';
const BCAST = process.argv[3] || '255.255.255.255';
const REQ_PORT = 2015;   // msi_BroadcastPort
const RESP_PORT = 2016;  // msi_ResponseBroadcastPort
const REQUEST = 'MEMENTO_SMARTFRAME|MementoWeb'; // 2 fields -> plaintext reply

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

sock.on('message', (msg, rinfo) => {
  const raw = msg.toString('utf8');
  console.log(`\n<-- reply from ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
  const parts = raw.split('|');
  const tag = parts[0];
  const jsonText = parts.slice(1).join('|').replace(/<EOF>\s*$/, '');
  console.log('tag:', tag);
  try {
    const info = JSON.parse(jsonText);
    console.log('frame info:');
    for (const [k, v] of Object.entries(info)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    console.log('\nPoC OK: live frame speaks the reverse-engineered protocol.');
  } catch (e) {
    console.log('raw payload (not plain JSON -> maybe encrypted / >=3 fields):');
    console.log(jsonText);
  }
  process.exit(0);
});

sock.on('error', (e) => { console.error('socket error:', e.message); process.exit(1); });

sock.bind(RESP_PORT, () => {
  sock.setBroadcast(true);
  const buf = Buffer.from(REQUEST, 'ascii');
  const fire = () => {
    sock.send(buf, 0, buf.length, REQ_PORT, BCAST);
    sock.send(buf, 0, buf.length, REQ_PORT, FRAME_IP);
    console.log(`--> sent "${REQUEST}" to ${BCAST}:${REQ_PORT} and ${FRAME_IP}:${REQ_PORT}`);
  };
  fire();
  let tries = 0;
  const timer = setInterval(() => {
    if (++tries >= 6) {
      clearInterval(timer);
      console.error('\nNo reply after 6 tries. Frame may be off, on another subnet, or the app not running.');
      process.exit(2);
    }
    fire();
  }, 1500);
});
