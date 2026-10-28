// Pure album read-modify-write. No frame, no I/O: the MementoClient pulls the
// AES blob, these functions transform it, and only applyAlbumEdit is allowed to
// produce the object that gets re-encrypted and written back.

// Three album names the firmware owns; the frame breaks if any disappears, so
// every edit is validated to leave all three present and unrenamed.
export const RESERVED_ALBUMS = ['Photos_$%^&(*@#!', 'Evening_$%^&(*@#!', 'Remote_$%^&(*@#!'];
const MAX_ALBUMS = 67;
const MAX_IMAGES_PER_ALBUM = 3000;
const MAX_FILENAME = 64;

const isReserved = (name) => RESERVED_ALBUMS.includes(name);
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Parse the decrypted AlbumData blob (index-paired AlbumName_<i>/ImageName_<i>)
 * into { albums: [{ name, images }] }, preserving album order.
 */
export function parseAlbumBlob(decrypted) {
  const obj = JSON.parse(stripBom(decrypted));
  const albums = [];
  for (let i = 0; Object.prototype.hasOwnProperty.call(obj, `AlbumName_${i}`); i++) {
    const images = obj[`ImageName_${i}`];
    albums.push({ name: obj[`AlbumName_${i}`], images: Array.isArray(images) ? [...images] : [] });
  }
  return { albums };
}

/**
 * Inverse of parseAlbumBlob. Byte-identical to a canonical input: keys are
 * emitted interleaved (AlbumName_0, ImageName_0, AlbumName_1, ...) with no
 * whitespace, matching JSON.stringify.
 */
export function serializeAlbumBlob(data) {
  const obj = {};
  data.albums.forEach((album, i) => {
    obj[`AlbumName_${i}`] = album.name;
    obj[`ImageName_${i}`] = album.images;
  });
  return JSON.stringify(obj);
}

/** Frame stores uploads under /sdcard/Photos/<name> lowercased, 64 chars max. */
export function normalizeFilename(name) {
  return String(name).toLowerCase().slice(0, MAX_FILENAME);
}

/**
 * Apply one edit and return a NEW AlbumData (input is never mutated). Throws a
 * clear Error if the edit would drop/rename a reserved album, exceed 67 albums,
 * or push any album past 3000 images.
 */
export function applyAlbumEdit(data, edit) {
  const next = { albums: data.albums.map((a) => ({ name: a.name, images: [...a.images] })) };
  const find = (name) => next.albums.find((a) => a.name === name);

  switch (edit.type) {
    case 'createAlbum': {
      if (!edit.name || !String(edit.name).trim()) throw new Error('Album name is required');
      if (find(edit.name)) throw new Error(`Album "${edit.name}" already exists`);
      next.albums.push({ name: edit.name, images: [] });
      break;
    }
    case 'renameAlbum': {
      if (isReserved(edit.from)) throw new Error(`Reserved album "${edit.from}" cannot be renamed`);
      if (isReserved(edit.to)) throw new Error(`"${edit.to}" is a reserved album name`);
      const album = find(edit.from);
      if (!album) throw new Error(`Album "${edit.from}" not found`);
      if (find(edit.to)) throw new Error(`Album "${edit.to}" already exists`);
      album.name = edit.to;
      break;
    }
    case 'deleteAlbum': {
      if (isReserved(edit.name)) throw new Error(`Reserved album "${edit.name}" cannot be deleted`);
      const idx = next.albums.findIndex((a) => a.name === edit.name);
      if (idx < 0) throw new Error(`Album "${edit.name}" not found`);
      next.albums.splice(idx, 1);
      break;
    }
    case 'reorderAlbums': {
      const current = next.albums.map((a) => a.name);
      const requested = edit.order;
      // The new order must be a permutation of exactly the existing albums, so a
      // reserved album can never be silently dropped by omitting it.
      if (requested.length !== current.length || [...requested].sort().join('\0') !== [...current].sort().join('\0')) {
        throw new Error('reorderAlbums order must be a permutation of the existing albums');
      }
      next.albums = requested.map((name) => find(name));
      break;
    }
    case 'assignImages': {
      const album = find(edit.album);
      if (!album) throw new Error(`Album "${edit.album}" not found`);
      const remove = new Set(edit.remove ?? []);
      const kept = album.images.filter((img) => !remove.has(img));
      const existing = new Set(kept);
      for (const img of edit.add ?? []) {
        if (!existing.has(img)) { kept.push(img); existing.add(img); }
      }
      album.images = kept;
      break;
    }
    default:
      throw new Error(`Unknown album edit type: ${edit.type}`);
  }

  assertInvariants(next.albums);
  return next;
}

function assertInvariants(albums) {
  for (const reserved of RESERVED_ALBUMS) {
    if (!albums.some((a) => a.name === reserved)) {
      throw new Error(`Reserved album "${reserved}" must always be present`);
    }
  }
  if (albums.length > MAX_ALBUMS) {
    throw new Error(`Too many albums: ${albums.length} (max ${MAX_ALBUMS})`);
  }
  for (const album of albums) {
    if (album.images.length > MAX_IMAGES_PER_ALBUM) {
      throw new Error(`Album "${album.name}" has ${album.images.length} images (max ${MAX_IMAGES_PER_ALBUM})`);
    }
  }
}
