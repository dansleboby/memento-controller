import { test, expect } from 'vitest';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { encrypt, decrypt } from './aes.js';

test('AES round-trip', () => {
  const s = '{"AlbumName_0":"Photos_$%^&(*@#!","ImageName_0":["café.jpg"]}';
  expect(decrypt(encrypt(s))).toBe(s);
});

// The frame encrypts .NET Encoding.Unicode bytes (verified on a live album blob):
// a UTF-8 plaintext would decrypt on the frame as garbage.
test('plaintext is UTF-16LE on the wire', () => {
  const s = '{"AlbumName_0":"Trip"}';
  const derived = pbkdf2Sync('otnemeM', Buffer.from('emarftramS', 'ascii'), 1000, 48, 'sha1');
  const decipher = createDecipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48));
  const raw = Buffer.concat([decipher.update(Buffer.from(encrypt(s), 'base64')), decipher.final()]);
  expect(raw.equals(Buffer.from(s, 'utf16le'))).toBe(true);
});
