import express from 'express';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { MementoClient } from '../protocol/mementoClient.js';
import { discover as realDiscover } from '../protocol/discovery.js';
import { transcodeForFrame } from '../image/transcode.js';
import { createRoutes, HttpError } from './routes.js';

const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/dist');

/**
 * Builds the Express app around ONE shared MementoClient (it serializes frame
 * access internally). All collaborators are injectable for tests.
 */
export function createApp({
  client = null,
  createClient = (ip) => new MementoClient(ip),
  transcode = transcodeForFrame,
  discover = realDiscover,
  webDist = DEFAULT_WEB_DIST,
} = {}) {
  const bus = new EventEmitter();
  let current = client;
  let ip = null;

  const ctx = {
    bus,
    createClient,
    transcode,
    discover,
    getClient: () => current,
    setClient: (c, newIp) => {
      current = c;
      ip = newIp;
      bus.emit('status', ctx.status());
    },
    status: () => ({ connected: Boolean(current), ip }),
  };

  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createRoutes(ctx));

  // The UI build is optional: the API must boot without it.
  const indexHtml = path.join(webDist, 'index.html');
  if (existsSync(indexHtml)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(indexHtml));
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = err.status;
    if (err instanceof multer.MulterError) status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    else if (err.type === 'entity.parse.failed') status = 400;
    if (!status) {
      status = 502; // frame/transport failure, not a server bug
      console.error('frame error:', err);
    }
    res.status(status).json({ error: err instanceof HttpError || status < 500 ? err.message : `frame error: ${err.message}` });
  });

  app.ctx = ctx;
  return app;
}
