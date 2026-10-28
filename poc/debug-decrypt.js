#!/usr/bin/env node
// Debug: grab live sData from GetConfig and try DES decode variants.
const net = require('net');
const crypto = require('crypto');
const HOST = process.argv[2] || '192.168.0.128';
const KEY = Buffer.from('M3m3nt0 ', 'latin1');
const IV = Buffer.from('UHDFram3', 'latin1');

const sock = net.connect(2017, HOST, () => {
  sock.write(Buffer.from(`Cadre.CommandChangeSetup|{"m_Action":"GetConfig","sData":""}|1|<EOF>`, 'ascii'));
});
let acc = '';
sock.on('data', (c) => {
  acc += c.toString('utf8');
  if (acc.indexOf('<EOF>') === -1) return;
  sock.end();
  const sData = acc.split('|')[1] ? JSON.parse(acc.slice(0, acc.indexOf('<EOF>')).split('|')[1]).sData : null;
  // Note: the reply is CommandChangeSetup; find sData robustly
  const frame = acc.slice(0, acc.indexOf('<EOF>'));
  const json = frame.substring(frame.indexOf('|') + 1, frame.lastIndexOf('|', frame.lastIndexOf('|') - 1));
  let msg; try { msg = JSON.parse(json); } catch (e) { console.log('json parse fail, frame=', frame.slice(0,200)); process.exit(1); }
  const b64 = msg.sData;
  const ct = Buffer.from(b64, 'base64');
  console.log('ciphertext bytes:', ct.length, '(mult of 8?', ct.length % 8 === 0, ')');
  console.log('head hex:', ct.slice(0, 16).toString('hex'));

  for (const algo of ['des-cbc', 'des-ecb']) {
    for (const pad of [true, false]) {
      try {
        const d = crypto.createDecipheriv(algo, KEY, algo === 'des-ecb' ? null : IV);
        d.setAutoPadding(pad);
        const out = Buffer.concat([d.update(ct), d.final()]);
        console.log(`\n[${algo} pad=${pad}] bytes=${out.length} head=${out.slice(0,16).toString('hex')}`);
        console.log('  utf16le:', JSON.stringify(out.slice(0, 48).toString('utf16le')));
        console.log('  utf8   :', JSON.stringify(out.slice(0, 48).toString('utf8')));
      } catch (e) {
        console.log(`\n[${algo} pad=${pad}] ERROR ${e.message}`);
      }
    }
  }
  process.exit(0);
});
sock.on('error', (e) => { console.error(e.message); process.exit(1); });
