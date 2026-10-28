import { describe, expect, test } from 'vitest';
import { parseAlbumBlob, serializeAlbumBlob, applyAlbumEdit, normalizeFilename } from './albums.js';

const PHOTOS = 'Photos_$%^&(*@#!';
const EVENING = 'Evening_$%^&(*@#!';
const REMOTE = 'Remote_$%^&(*@#!';

// Canonical on-wire blob: interleaved AlbumName_<i>/ImageName_<i>, exactly as
// JSON.stringify emits it, so the round-trip must be byte-identical.
const sample = JSON.stringify({
  AlbumName_0: PHOTOS, ImageName_0: ['a.jpg', 'b.jpg'],
  AlbumName_1: EVENING, ImageName_1: [],
  AlbumName_2: REMOTE, ImageName_2: [],
  AlbumName_3: 'Vacances', ImageName_3: ['x.jpg'],
});

const images = (n) => Array.from({ length: n }, (_, i) => `img${i}.jpg`);

function dataWith(userNames = [], photoImages = []) {
  return {
    albums: [
      { name: PHOTOS, images: [...photoImages] },
      { name: EVENING, images: [] },
      { name: REMOTE, images: [] },
      ...userNames.map((name) => ({ name, images: [] })),
    ],
  };
}

describe('albums blob round-trip', () => {
  test('round-trip album blob preserves reserved albums byte-identically', () => {
    const data = parseAlbumBlob(sample);
    expect(data.albums.map((a) => a.name)).toEqual([PHOTOS, EVENING, REMOTE, 'Vacances']);
    expect(serializeAlbumBlob(data)).toBe(sample);
  });
});

describe('applyAlbumEdit guards', () => {
  const data = parseAlbumBlob(sample);

  test('refuses to delete a reserved album', () => {
    expect(() => applyAlbumEdit(data, { type: 'deleteAlbum', name: PHOTOS })).toThrow();
  });

  test('refuses to rename a reserved album', () => {
    expect(() => applyAlbumEdit(data, { type: 'renameAlbum', from: EVENING, to: 'Soir' })).toThrow();
  });

  test('refuses a reorder that drops a reserved album', () => {
    expect(() => applyAlbumEdit(data, { type: 'reorderAlbums', order: [PHOTOS, REMOTE, 'Vacances'] })).toThrow();
  });

  test('refuses to exceed 67 albums', () => {
    // 3 reserved + 64 user = 67; one more createAlbum would make 68.
    const full = dataWith(Array.from({ length: 64 }, (_, i) => `album${i}`));
    expect(full.albums).toHaveLength(67);
    expect(() => applyAlbumEdit(full, { type: 'createAlbum', name: 'overflow' })).toThrow();
  });

  test('refuses to exceed 3000 images in an album', () => {
    const full = dataWith([], images(3000));
    expect(() => applyAlbumEdit(full, { type: 'assignImages', album: PHOTOS, add: ['one-too-many.jpg'], remove: [] })).toThrow();
  });

  test('refuses to create an album with an empty or whitespace name', () => {
    expect(() => applyAlbumEdit(data, { type: 'createAlbum', name: '' })).toThrow();
    expect(() => applyAlbumEdit(data, { type: 'createAlbum', name: '   ' })).toThrow();
  });
});

describe('applyAlbumEdit happy path is immutable', () => {
  test('createAlbum then assignImages succeeds without mutating the input', () => {
    const data = dataWith(['Vacances']);
    const snapshot = JSON.parse(JSON.stringify(data));

    const created = applyAlbumEdit(data, { type: 'createAlbum', name: 'Noel' });
    const assigned = applyAlbumEdit(created, { type: 'assignImages', album: 'Noel', add: ['snow.jpg'], remove: [] });

    expect(assigned.albums.map((a) => a.name)).toContain('Noel');
    expect(assigned.albums.find((a) => a.name === 'Noel').images).toEqual(['snow.jpg']);
    // The three reserved albums survived every edit.
    expect(assigned.albums.map((a) => a.name)).toEqual(expect.arrayContaining([PHOTOS, EVENING, REMOTE]));
    // Inputs are untouched.
    expect(data).toEqual(snapshot);
    expect(created.albums.find((a) => a.name === 'Noel').images).toEqual([]);
  });
});

describe('normalizeFilename', () => {
  test('lowercases and caps at 64', () => {
    expect(normalizeFilename('MyPhoto.JPG')).toBe('myphoto.jpg');
    expect(normalizeFilename('MyPhoto.JPG').length).toBeLessThanOrEqual(64);
    expect(normalizeFilename('A'.repeat(100) + '.jpg').length).toBe(64);
  });
});
