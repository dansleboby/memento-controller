// Mirror of the server constant. server/src/protocol/albums.js is the source of
// truth and ENFORCES these via 409; this copy only drives UX (disabled controls).
export const RESERVED_ALBUMS = ['Photos_$%^&(*@#!', 'Evening_$%^&(*@#!', 'Remote_$%^&(*@#!'];

// Photos holds every uploaded photo; the frame plays Evening while night mode is on.
const RESERVED_LABEL_KEYS = {
  'Photos_$%^&(*@#!': 'album.all',
  'Evening_$%^&(*@#!': 'album.evening',
  'Remote_$%^&(*@#!': 'album.remote',
};

export const albumLabel = (name, t) => (RESERVED_LABEL_KEYS[name] ? t(RESERVED_LABEL_KEYS[name]) : name);
