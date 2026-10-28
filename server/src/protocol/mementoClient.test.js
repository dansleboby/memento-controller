import { afterEach, describe, expect, test } from 'vitest';
import { MementoClient } from './mementoClient.js';
import { mockFrame } from '../../test/mockFrame.js';
import { encrypt as aesEncrypt, decrypt as aesDecrypt } from '../crypto/aes.js';
import { serializeAlbumBlob } from './albums.js';
import { fastDecrypt } from '../crypto/des.js';
import { decodeMessage } from './wire.js';

describe('MementoClient', () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()();
  });

  async function setup(handlers = {}, options = {}) {
    const frame = await mockFrame(handlers);
    const client = new MementoClient('127.0.0.1', { commandPort: frame.port, filePort: frame.filePort, ...options });
    cleanups.push(() => frame.close(), () => client.disconnect());
    await client.connect();
    return { frame, client };
  }

  const LIST = Buffer.from('Memento Version 6.02\r\ndsc_0810.thumb.png|8ad05dc5\r\nmy_trip.thumb.png|a45b78ce\r\n', 'utf8');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  test('getConfig decodes an encrypted config reply', async () => {
    const { client } = await setup({ onGetConfig: () => ({ Name: 'Salon', SoftwareVersion: 6.02 }) });
    const config = await client.getConfig();
    expect(config.Name).toBe('Salon');
    expect(config.SoftwareVersion).toBe(6.02);
  });

  test('getThumbnailsList sizes the pull from the encrypted m_Data and returns photo names', async () => {
    const { frame, client } = await setup({ file: { serve: { GetThumbnailsList: LIST } } });

    expect(await client.getThumbnailsList()).toEqual(['dsc_0810.jpg', 'my_trip.jpg']);
    // The file socket must exist before the command, and the transfer is acknowledged.
    expect(frame.events.indexOf('file:connect')).toBeLessThan(frame.events.indexOf('wire:GetThumbnailsList'));
    expect(frame.events).toContain('wire:GetThumbnailsListEnded');
  });

  test('getThumbnail names the photo in m_DestinationFileName and returns the PNG', async () => {
    const { client } = await setup({
      file: { serve: { GetThumbnails: (p) => (p.m_DestinationFileName === 'dsc_0810.jpg' ? PNG : null) } },
    });
    expect((await client.getThumbnail('DSC_0810.jpg')).equals(PNG)).toBe(true);
  });

  test('getThumbnail rejects when the frame has no such thumbnail', async () => {
    const { client } = await setup({ file: { serve: { GetThumbnails: () => null } } });
    await expect(client.getThumbnail('missing.jpg')).rejects.toThrow(/GetThumbnailsFailed/);
  });

  test('consecutive pulls reuse one persistent file socket', async () => {
    const albumData = { albums: [{ name: 'Photos_$%^&(*@#!', images: ['dsc_0810.jpg'] }] };
    const { frame, client } = await setup({
      file: {
        serve: {
          GetThumbnailsList: LIST,
          GetThumbnails: () => PNG,
          GetAlbums: Buffer.from(aesEncrypt(serializeAlbumBlob(albumData)), 'ascii'),
        },
      },
    });

    await client.getThumbnailsList();
    await client.getThumbnail('dsc_0810.jpg');
    await client.getThumbnail('my_trip.jpg');
    expect(await client.getAlbums()).toEqual(albumData);
    expect(frame.acceptedFileConnections()).toBe(1);
  });

  test('getAlbums pulls the blob, AES-decrypts and parses it', async () => {
    const albumData = { albums: [{ name: 'Photos_$%^&(*@#!', images: ['a.jpg'] }, { name: 'Été', images: [] }] };
    const blobBytes = Buffer.from(aesEncrypt(serializeAlbumBlob(albumData)), 'ascii');
    const { client } = await setup({ file: { serve: { GetAlbums: blobBytes } } });

    expect(await client.getAlbums()).toEqual(albumData);
  });

  test('uploadImage streams on the session socket, then Ended confirms name and size', async () => {
    const { frame, client } = await setup();
    const payload = Buffer.from('pretend-jpeg-bytes-0123456789', 'utf8');
    const progress = [];

    await client.uploadImage('MyPhoto.JPG', payload, { orientation: 90 }, { onProgress: (f) => progress.push(f) });

    const [upload] = await frame.waitForUploads(1);
    expect(upload).toMatchObject({ action: 'WriteFile', name: 'myphoto.jpg', size: payload.length, ok: true });
    expect(upload.bytes.equals(payload)).toBe(true);
    expect(frame.events.indexOf('wire:WriteFile')).toBeLessThan(frame.events.indexOf('file:data'));
    expect(frame.events.indexOf('file:data')).toBeLessThan(frame.events.indexOf('wire:WriteFileEnded'));
    expect(progress[progress.length - 1]).toBe(1);
  });

  test('a stalled 2018 peer makes uploadImage reject within the override, not hang', async () => {
    const { client } = await setup({ file: { stall: true } });
    // Comfortably above the loopback send/recv buffer (~2.7MB here), so a
    // non-reading peer forces backpressure and the write cannot complete.
    const big = Buffer.alloc(16 * 1024 * 1024, 7);
    const start = Date.now();
    await expect(client.uploadImage('big.jpg', big, {}, { timeoutMs: 200 })).rejects.toThrow(/timed out|abort/i);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('two concurrent uploads each deliver their own bytes over one socket', async () => {
    const { frame, client } = await setup();
    const payloadA = Buffer.alloc(100 * 1024, 0xaa);
    const payloadB = Buffer.alloc(120 * 1024, 0xbb);

    await Promise.all([
      client.uploadImage('a.jpg', payloadA, {}),
      client.uploadImage('b.jpg', payloadB, {}),
    ]);

    const got = await frame.waitForUploads(2);
    expect(got.every((u) => u.ok)).toBe(true);
    expect(got.find((u) => u.name === 'a.jpg').bytes.equals(payloadA)).toBe(true);
    expect(got.find((u) => u.name === 'b.jpg').bytes.equals(payloadB)).toBe(true);
    expect(frame.acceptedFileConnections()).toBe(1);
  });

  test('sendAlbums writes AlbumData.json as an AES blob the frame accepts', async () => {
    const { frame, client } = await setup();
    const albumData = { albums: [{ name: 'Photos_$%^&(*@#!', images: ['a.jpg'] }, { name: 'Noël', images: [] }] };

    await client.sendAlbums(albumData);

    const [upload] = await frame.waitForUploads(1);
    expect(upload).toMatchObject({ action: 'SendAlbums', name: 'AlbumData.json', ok: true });
    expect(aesDecrypt(upload.bytes.toString('ascii'))).toBe(serializeAlbumBlob(albumData));
  });

  test('a download that never arrives fails within the idle window, and the next call starts a fresh session', async () => {
    const { frame, client } = await setup({ file: { misroute: 1, serve: { GetThumbnailsList: LIST } } }, { transferIdleMs: 150 });

    const start = Date.now();
    await expect(client.getThumbnailsList()).rejects.toThrow(/no data for 150ms/);
    expect(Date.now() - start).toBeLessThan(2000);

    expect(await client.getThumbnailsList()).toEqual(['dsc_0810.jpg', 'my_trip.jpg']);
    expect(frame.acceptedCommandConnections()).toBe(2);
    expect(frame.acceptedFileConnections()).toBe(2);
  });

  test('sendAwaySchedule sends a SendConfig carrying only the away keys', async () => {
    const { frame, client } = await setup();

    await client.sendAwaySchedule([{ day: 8, off: 3, on: 8 }, { day: 7, off: 23, on: 9 }]);

    const raw = frame.received.find((r) => r.includes('"m_Action":"SendConfig"'));
    const inner = JSON.parse(fastDecrypt(decodeMessage(raw).payload.sData));
    expect(inner).toEqual({ AwayDay: [8, 7], AwayOffTime: [3, 23], AwayOnTime: [8, 9], AwayEnable: [true, true] });
  });

  const innerOf = (frame, action) =>
    JSON.parse(fastDecrypt(decodeMessage(frame.received.findLast((r) => r.includes(`"m_Action":"${action}"`))).payload.sData));

  // The frame stores SendTime as its UTC clock and adds its own zone offset on top.
  test('sendTime sends the instant as UTC wall time', async () => {
    const { frame, client } = await setup();
    await client.sendTime(new Date('2026-01-02T03:04:05Z'));
    expect(innerOf(frame, 'SendTime')).toEqual({ DateTime: '01/02/2026 03:04:05' });
  });

  // Without the maker's time server the frame boots with no clock, and ChangeTimeZone to a negative
  // offset then throws inside the frame; the official client also sends the time first thing.
  test('connect sends the current time right after the Beacon', async () => {
    const { frame } = await setup({}, { now: () => new Date('2026-10-27T22:30:00Z') });
    const actions = frame.events.filter((e) => e.startsWith('wire:'));
    expect(actions.slice(0, 2)).toEqual(['wire:Beacon', 'wire:SendTime']);
    expect(innerOf(frame, 'SendTime')).toEqual({ DateTime: '10/27/2026 22:30:00' });
  });

  test('after the frame drops an idle session, the next calls reconnect transparently', async () => {
    const { frame, client } = await setup({
      onGetConfig: () => ({ Name: 'Salon' }),
      file: { serve: { GetThumbnailsList: LIST } },
    });
    await client.getConfig();

    frame.dropSession();
    await new Promise((r) => setTimeout(r, 50));

    expect((await client.getConfig()).Name).toBe('Salon');
    expect(await client.getThumbnailsList()).toEqual(['dsc_0810.jpg', 'my_trip.jpg']);
    expect(frame.acceptedCommandConnections()).toBe(2);
    expect(frame.acceptedFileConnections()).toBe(2);
  });

  test('connect waits in the frame queue past the command timeout, then opens 2018', async () => {
    // The frame leaves a newcomer unread until the current controller's session ends.
    const { frame } = await setup({ replyDelayMs: 300 }, { commandTimeoutMs: 100, connectTimeoutMs: 2000 });

    const beacon = frame.events.indexOf('wire:Beacon');
    expect(beacon).toBeGreaterThanOrEqual(0);
    const beaconReply = frame.events.indexOf(`reply:${frame.events[beacon - 1].split(':')[1]}`);
    expect(beaconReply).toBeLessThan(frame.events.indexOf('file:connect'));
  });

  test('concurrent first calls build exactly one session (idempotent connect)', async () => {
    const frame = await mockFrame({ onGetConfig: () => ({ Name: 'Salon' }) });
    const client = new MementoClient('127.0.0.1', { commandPort: frame.port, filePort: frame.filePort });
    cleanups.push(() => frame.close(), () => client.disconnect());

    // Race the lazy connect: direct connect() calls and first commands together.
    const [, , a, b] = await Promise.all([
      client.connect(),
      client.connect(),
      client.getConfig(),
      client.getConfig(),
    ]);

    expect(a.Name).toBe('Salon');
    expect(b.Name).toBe('Salon');
    expect(frame.acceptedCommandConnections()).toBe(1);
    expect(frame.acceptedFileConnections()).toBe(1);
  });

  test('an unsolicited frame on an idle channel is dropped; the next send still gets its own reply', async () => {
    const { frame, client } = await setup({ onGetConfig: () => ({ Name: 'Salon' }) });

    // Frame pushes an unsolicited message while no request is in flight.
    frame.push({ m_Action: 'SendCurrentImageName', m_SourceFileName: 'ghost.jpg' });
    await new Promise((r) => setTimeout(r, 50));

    const config = await client.getConfig();
    expect(config.Name).toBe('Salon');
  });
});
