import { createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';

const PASSWORD = 'otnemeM';
// Raw bytes of ASCII "emarftramS".
const SALT = Buffer.from([101, 109, 97, 114, 102, 116, 114, 97, 109, 83]);

// .NET Rfc2898DeriveBytes default; confirmed by decrypting a live album blob.
const PBKDF2_ITERATIONS = 1000;

// Rfc2898DeriveBytes is HMAC-SHA1; 48 bytes = 32-byte key then 16-byte IV.
const derived = pbkdf2Sync(PASSWORD, SALT, PBKDF2_ITERATIONS, 48, 'sha1');
const KEY = derived.subarray(0, 32);
const IV = derived.subarray(32, 48);

// Plaintext is .NET Encoding.Unicode (UTF-16LE), not UTF-8 (verified live).
export function encrypt(plaintext) {
  const cipher = createCipheriv('aes-256-cbc', KEY, IV);
  return Buffer.concat([cipher.update(plaintext, 'utf16le'), cipher.final()]).toString('base64');
}

export function decrypt(b64) {
  const decipher = createDecipheriv('aes-256-cbc', KEY, IV);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf16le');
}
