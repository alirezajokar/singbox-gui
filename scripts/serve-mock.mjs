// Serve the frontend in a normal browser with the in-memory mock backend:
//   node scripts/serve-mock.mjs [port]   ->  http://127.0.0.1:5173/?mock=running
// Mock states: running | stopped | failed | nounit | nofile
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/frontend');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const port = Number(process.argv[2]) || 5173;

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const file = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/?mock=running`));
