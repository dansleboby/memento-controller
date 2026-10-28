import sharp from 'sharp';

const CANVAS_WIDTH = 3240;
const CANVAS_HEIGHT = 2160;
// The frame decodes, composes (crop, or blurred backdrop for portrait/panorama) and re-encodes
// every upload at quality 80 itself; a near-lossless upload avoids compounding two q80 passes.
const UPLOAD_QUALITY = 92;

// HEIC decode needs a libvips built with libheif + an HEVC decoder; prebuilt
// sharp binaries ship AV1 (AVIF) only, so HEIC needs a system libvips.
const HEIF_LOADER = Boolean(sharp.format.heif?.input?.buffer);

// ISO-BMFF major brands that mean HEVC-coded HEIF (AVIF uses 'avif'/'avis').
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

export class HeicUnsupportedError extends Error {
  constructor(reason) {
    super(
      `HEIC/HEIF image could not be decoded (${reason}). ` +
        'Install a libvips built with libheif and an HEVC decoder, or convert the photo to JPEG/PNG before uploading.',
    );
    this.name = 'HeicUnsupportedError';
  }
}

function isHeic(buf) {
  return (
    buf.length >= 12 &&
    buf.toString('ascii', 4, 8) === 'ftyp' &&
    HEIC_BRANDS.has(buf.toString('ascii', 8, 12))
  );
}

export async function transcodeForFrame(input) {
  const heic = isHeic(input);
  if (heic && !HEIF_LOADER) throw new HeicUnsupportedError('no HEIF loader in this libvips');

  try {
    return await sharp(input)
      .rotate() // bakes EXIF orientation into pixels and resets the tag
      .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: UPLOAD_QUALITY })
      .toBuffer();
  } catch (err) {
    // libvips reports missing HEVC as an opaque load error; translate it.
    if (heic) throw new HeicUnsupportedError(err.message);
    throw err;
  }
}
