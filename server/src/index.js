import os from 'node:os';
import { createApp } from './http/server.js';

const port = Number(process.env.PORT) || 8080;
const app = createApp();

const server = app.listen(port, '0.0.0.0', () => {
  console.log('Memento controller is running. Open one of:');
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${port}`);
    }
  }
  console.log(`  http://localhost:${port}`);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PORT to another value.` : err.message);
  process.exit(1);
});

// Frame protocol requires Disconnect last, on teardown.
async function shutdown() {
  server.close();
  await app.ctx.getClient()?.disconnect().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
