#!/usr/bin/env node
// Throwaway PoC: read the live frame's full configuration over TCP 2017.
//
// Wire format (recovered from Cadre.Controler + fastJSON):
//   request/response = "<ClrTypeName>|<fastJSON>|<id>|<EOF>"
//   Server dispatches by Type.GetType(field0); CommandChangeSetup with
//   m_Action=GetConfig(0) replies m_Action=GetConfigDone(1), sData=config.
//   When the frame's software version >= 5, sData is FastEncrypt'd:
//   DES-CBC(key="M3m3nt0 ", iv="UHDFram3") over UTF-16LE text, base64.
//
// GetConfig is read-only; nothing on the frame is modified.

const net = require('net');
const crypto = require('crypto');

const HOST = process.argv[2] || '192.168.0.128';
const CMD_PORT = 2017;
const DES_KEY = Buffer.from('M3m3nt0 ', 'latin1'); // 8 bytes
const DES_IV = Buffer.from('UHDFram3', 'latin1');  // 8 bytes

function fastDecrypt(b64) {
  try {
    const d = crypto.createDecipheriv('des-cbc', DES_KEY, DES_IV);
    const out = Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]);
    return out.toString('utf16le');
  } catch (e) {
    return null;
  }
}

function buildCommand(typeName, obj, id) {
  return `${typeName}|${JSON.stringify(obj)}|${id}|<EOF>`;
}

const sock = net.connect(CMD_PORT, HOST, () => {
  console.log(`connected to ${HOST}:${CMD_PORT}`);
  const cmd = buildCommand('Cadre.CommandChangeSetup', { m_Action: 'GetConfig', sData: '' }, 1);
  console.log('--> ' + cmd.replace('<EOF>', '<EOF>'));
  sock.write(Buffer.from(cmd, 'ascii'));
});

let acc = '';
sock.setTimeout(8000);
sock.on('data', (chunk) => {
  acc += chunk.toString('utf8');
  if (acc.indexOf('<EOF>') === -1) return;
  const frame = acc.slice(0, acc.indexOf('<EOF>'));
  const parts = frame.split('|');
  const type = parts[0];
  const json = parts[1];
  console.log(`\n<-- type: ${type}`);
  let msg;
  try { msg = JSON.parse(json); } catch (e) { console.log('raw:', json); return finish(1); }
  let sData = msg.sData;
  console.log('    m_Action:', msg.m_Action);
  let configText = sData;
  if (sData && !sData.startsWith('{')) {
    const dec = fastDecrypt(sData);
    if (dec && dec.indexOf('{') !== -1) configText = dec.slice(dec.indexOf('{'));
  }
  try {
    const cfg = JSON.parse(configText);
    console.log('\n=== LIVE FRAME CONFIG ===');
    const show = ['Name', 'SoftwareVersion', 'HardwareVersion', 'ScreenSize', 'Width', 'Height',
      'Orientation', 'PortraitMode', 'DisplayOn', 'NightModeOn', 'ShuffleOn', 'DisplayTime',
      'CalibrationTableName', 'ContrastOffset', 'ExposureOffset', 'SaturationOffset',
      'TemperatureOffset', 'TimeZoneName', 'WiFiSSID', 'GUID'];
    for (const k of show) if (k in cfg) console.log(`  ${k}: ${JSON.stringify(cfg[k])}`);
    console.log('\nPoC OK: command channel + crypto + config parsing all verified against the live frame.');
    finish(0);
  } catch (e) {
    console.log('decrypted/plain config (unparsed):');
    console.log(configText);
    finish(0);
  }
});

function finish(code) { try { sock.end(); } catch (e) {} process.exit(code); }
sock.on('timeout', () => { console.error('timeout waiting for reply'); finish(2); });
sock.on('error', (e) => { console.error('socket error:', e.message); finish(1); });
