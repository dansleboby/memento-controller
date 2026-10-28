import { describe, expect, test } from 'vitest';
import { fastDecrypt, fastEncrypt } from './des.js';

// Pinned once with an external OpenSSL oracle (legacy provider), never at runtime:
//   printf 'test' | iconv -t UTF-16LE | openssl enc -provider legacy -provider default \
//     -des-cbc -K 4d336d336e743020 -iv 5548444672616d33 -base64 -A
const GOLDEN_B64 = 'O2LfRX0N2grR9E/c1/ntsg==';

describe('FastEncrypt/FastDecrypt', () => {
  test('fastEncrypt/fastDecrypt round-trip', () => {
    const s = '{"Contrast":"10"}';
    expect(fastDecrypt(fastEncrypt(s))).toBe(s);
  });

  test('golden vector matches OpenSSL DES-CBC over UTF-16LE', () => {
    expect(fastEncrypt('test')).toBe(GOLDEN_B64);
    expect(fastDecrypt(GOLDEN_B64)).toBe('test');
  });
});
