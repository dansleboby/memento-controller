import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { transcodeForFrame, HeicUnsupportedError } from './transcode.js';

const solid = (width, height, extra = {}) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } });

// Minimal ISO-BMFF header carrying a HEIC brand; enough for sniffing, not decodable.
const fakeHeic = () =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypheic', 'ascii'),
    Buffer.alloc(12),
  ]);

// sharp.format.heif only proves a libheif loader exists; HEVC (HEIC proper) is
// absent from prebuilt binaries, so probe a real decode via the module itself.
const canMakeHeic = await (async () => {
  try {
    await solid(64, 64).heif({ compression: 'hevc' }).toBuffer();
    return true;
  } catch {
    return false;
  }
})();

describe('transcodeForFrame', () => {
  it('downsizes an oversized PNG within the frame canvas and outputs JPEG', async () => {
    const png = await solid(6000, 4000).png().toBuffer();
    const meta = await sharp(await transcodeForFrame(png)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(3240);
    expect(meta.height).toBeLessThanOrEqual(2160);
  });

  // The frame re-encodes every upload at quality 80, so the upload itself must not be lossy at that level too.
  it('encodes above the frame quality to avoid a double q80 pass', async () => {
    const noise = Buffer.alloc(400 * 300 * 3);
    for (let i = 0, x = 7; i < noise.length; i++) noise[i] = x = (x * 1103515245 + 12345) & 0xff;
    const png = await sharp(noise, { raw: { width: 400, height: 300, channels: 3 } }).png().toBuffer();
    const q80 = await sharp(png).jpeg({ quality: 80 }).toBuffer();
    expect((await transcodeForFrame(png)).length).toBeGreaterThan(q80.length);
  });

  it('does not upscale images smaller than the canvas', async () => {
    const png = await solid(800, 600).png().toBuffer();
    const meta = await sharp(await transcodeForFrame(png)).metadata();
    expect([meta.width, meta.height]).toEqual([800, 600]);
  });

  it('applies EXIF orientation and normalizes it away', async () => {
    const jpeg = await solid(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);

    const meta = await sharp(await transcodeForFrame(jpeg)).metadata();
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
    expect([meta.width, meta.height]).toEqual([200, 400]);
  });

  it('surfaces a clear error for HEIC input the host cannot decode', async () => {
    await expect(transcodeForFrame(fakeHeic())).rejects.toBeInstanceOf(HeicUnsupportedError);
    await expect(transcodeForFrame(fakeHeic())).rejects.toThrow(/HEIC/);
  });

  (canMakeHeic ? it : it.skip)(
    'transcodes a HEIC input to JPEG within the canvas (skipped: host libvips has no HEVC codec)',
    async () => {
      const heic = await solid(4000, 3000).heif({ compression: 'hevc' }).toBuffer();
      const meta = await sharp(await transcodeForFrame(heic)).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBeLessThanOrEqual(3240);
      expect(meta.height).toBeLessThanOrEqual(2160);
    },
  );
});
