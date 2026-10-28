import net from 'node:net';
import { fastEncrypt } from '../src/crypto/des.js';
import { encodeMessage, decodeMessage } from '../src/protocol/wire.js';

const EOF_MARKER = '<EOF>';
const TRANSFER_TYPE = 'Cadre.CommandControlTransferFile';
const READ_ACTIONS = new Set(['GetThumbnailsList', 'GetThumbnails', 'GetAlbums', 'ReadFile']);
const WRITE_ACTIONS = new Set(['WriteFile', 'SendAlbums']);

// handlers.onGetConfig() -> config object; handlers.replyDelayMs delays every reply;
// handlers.ignoreDisconnect also drops the Disconnect reply; handlers.silent swallows everything except the Disconnect that connect() sends first.
// `events` interleaves 'recv:<id>', 'reply:<id>', 'wire:<m_Action>', 'file:connect' and 'file:data' (first byte of each upload) so tests can assert ordering across both sockets.
//
// The 2018 listener mirrors the live frame's FileServer (sw 6.02): every transfer runs over the FIRST file
// socket accepted in the session, which must already be connected when the transfer command arrives.
// Transfer replies carry the real size only inside the DES-encrypted m_Data JSON; m_FileSize is always 0.
// handlers.file:
//   serve: { [readAction]: Buffer | (payload) => Buffer | null } - null replies <Action>Failed
//   stall: true - accept the file socket but never read it, so an upload backpressures and hangs
//   misroute: n - stream the first n downloads to nowhere, as when the frame adopted a stale queued 2018 socket
// Uploads (WriteFile/SendAlbums) are captured as { action, name, size, bytes, ok }: the <Action>Ended reply waits for
// the announced byte count, then answers Succeeded only if the Ended command repeats the same name and size.
export async function mockFrame(handlers = {}) {
  const received = [];
  const events = [];
  const sockets = new Set();
  const cmdSockets = new Set();
  const fileSockets = [];
  let cmdConnections = 0;
  let fileConnections = 0;
  const fileCfg = handlers.file ?? {};

  const uploads = [];
  const uploadWaiters = [];
  const checkUploadWaiters = () => {
    for (let i = uploadWaiters.length - 1; i >= 0; i--) {
      if (uploads.length >= uploadWaiters[i].n) {
        uploadWaiters[i].resolve([...uploads]);
        uploadWaiters.splice(i, 1);
      }
    }
  };
  let pendingWrite = null;
  let misrouted = 0;

  const server = net.createServer((socket) => {
    cmdConnections += 1;
    sockets.add(socket);
    cmdSockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); cmdSockets.delete(socket); });
    socket.on('error', () => {});
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('ascii');
      let idx;
      while ((idx = buf.indexOf(EOF_MARKER)) >= 0) {
        const raw = buf.slice(0, idx + EOF_MARKER.length);
        buf = buf.slice(idx + EOF_MARKER.length);
        received.push(raw);
        handle(socket, raw);
      }
    });
  });

  const sessionFileSocket = () => fileSockets.find((s) => !s.destroyed) ?? null;

  const started = (action, name, size) => ({
    m_Action: `${action}Started`,
    m_Data: fastEncrypt(JSON.stringify({ srcfilename: '', dstfilename: name, filesize: String(size) })),
    m_FileSize: 0,
  });

  function transferReply(payload) {
    const action = payload.m_Action;
    if (READ_ACTIONS.has(action)) {
      const source = fileCfg.serve?.[action];
      const bytes = typeof source === 'function' ? source(payload) : source;
      if (!bytes) return { m_Action: `${action}Failed` };
      // Like the frame, start streaming before the 2017 reply; nothing flows without a session file socket.
      if (misrouted < (fileCfg.misroute ?? 0)) misrouted += 1;
      else sessionFileSocket()?.write(bytes);
      return started(action, payload.m_DestinationFileName ?? '', bytes.length);
    }
    if (WRITE_ACTIONS.has(action)) {
      const socket = sessionFileSocket();
      let resolve;
      const done = new Promise((r) => (resolve = r));
      pendingWrite = { action, name: payload.m_DestinationFileName, size: payload.m_FileSize, chunks: [], got: 0, armed: Boolean(socket), done, resolve };
      if (!socket || payload.m_FileSize <= 0) resolve();
      return started(action, payload.m_DestinationFileName, payload.m_FileSize);
    }
    const ended = /^(.*)Ended$/.exec(action)?.[1];
    if (ended && READ_ACTIONS.has(ended)) return { m_Action: `${ended}Succeeded` };
    if (ended && WRITE_ACTIONS.has(ended) && pendingWrite?.action === ended) {
      const w = pendingWrite;
      return w.done.then(() => {
        pendingWrite = null;
        const ok = w.armed && w.got === w.size && payload.m_FileSize === w.size && payload.m_DestinationFileName === w.name;
        uploads.push({ action: w.action, name: w.name, size: w.size, bytes: Buffer.concat(w.chunks), ok });
        checkUploadWaiters();
        return { m_Action: `${ended}${ok ? 'Succeeded' : 'Failed'}` };
      });
    }
    return { m_Action: `${action}Failed` };
  }

  function handle(socket, raw) {
    const { type, payload, id } = decodeMessage(raw);
    events.push(`recv:${id}`);
    events.push(`wire:${payload.m_Action}`);
    const isDisconnect = payload.m_Action === 'Disconnect';
    if (handlers.silent && !isDisconnect) return;
    if (isDisconnect && handlers.ignoreDisconnect) return;

    let reply = { m_Action: `${payload.m_Action}Done` };
    if (payload.m_Action === 'GetConfig' && handlers.onGetConfig) {
      reply = { m_Action: 'GetConfigDone', sData: fastEncrypt(JSON.stringify(handlers.onGetConfig())) };
    } else if (type === TRANSFER_TYPE) {
      reply = transferReply(payload);
    }
    Promise.resolve(reply).then((replyPayload) =>
      setTimeout(() => {
        events.push(`reply:${id}`);
        socket.write(encodeMessage(type, replyPayload, id));
      }, isDisconnect ? 0 : handlers.replyDelayMs ?? 0),
    );
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const fileServer = net.createServer((socket) => {
    fileConnections += 1;
    sockets.add(socket);
    fileSockets.push(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    events.push('file:connect');
    if (fileCfg.stall) {
      socket.pause();
      return;
    }
    socket.on('data', (c) => {
      const w = pendingWrite;
      if (!w || !w.armed || w.got >= w.size || socket !== sessionFileSocket()) return;
      if (w.got === 0) events.push('file:data');
      const take = c.subarray(0, w.size - w.got);
      w.chunks.push(take);
      w.got += take.length;
      if (w.got === w.size) w.resolve();
    });
  });
  await new Promise((resolve) => fileServer.listen(0, '127.0.0.1', resolve));

  const waitForUploads = (n) =>
    new Promise((resolve) => { uploadWaiters.push({ n, resolve }); checkUploadWaiters(); });

  return {
    port: server.address().port,
    filePort: fileServer.address().port,
    received,
    events,
    uploaded: () => waitForUploads(1).then((u) => u[0]),
    waitForUploads,
    acceptedCommandConnections: () => cmdConnections,
    acceptedFileConnections: () => fileConnections,
    push: (payload, { type = 'Cadre.CommandControlFlow', id = 999 } = {}) => {
      for (const s of cmdSockets) s.write(encodeMessage(type, payload, id));
    },
    // The frame's idle watchdog ends a session by closing both sockets.
    dropSession: () => {
      for (const s of cmdSockets) s.destroy();
      for (const s of fileSockets) s.destroy();
      fileSockets.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        const closeFile = new Promise((r) => fileServer.close(() => r()));
        server.close(() => closeFile.then(resolve));
      }),
  };
}
