import { expect, test } from 'vitest';
import { decodeMessage, encodeMessage } from './wire.js';

test('encode then decode is identity', () => {
  const m = encodeMessage('Cadre.CommandChangeSetup', { m_Action: 'GetConfig', sData: '' }, 1);
  expect(m.toString('ascii')).toBe('Cadre.CommandChangeSetup|{"m_Action":"GetConfig","sData":""}|1|<EOF>');
  const d = decodeMessage(m.toString('ascii'));
  expect(d).toEqual({ type: 'Cadre.CommandChangeSetup', payload: { m_Action: 'GetConfig', sData: '' }, id: 1 });
});

test('decode tolerates a GetConfigDone reply with base64 sData', () => {
  const d = decodeMessage('Cadre.CommandChangeSetup|{"m_Action":"GetConfigDone","sData":"AAAA=="}|7|<EOF>');
  expect(d.payload.m_Action).toBe('GetConfigDone');
  expect(d.payload.sData).toBe('AAAA==');
  expect(d.id).toBe(7);
});
