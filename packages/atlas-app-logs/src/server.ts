import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { formatLogEntry, type LogEntry } from './format.js';
import { LogWriter } from './writer.js';

export function startLogServer(port: number = 8787): ReturnType<typeof createServer> {
  const writer = new LogWriter();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/logs') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const entry: LogEntry = JSON.parse(body);
          const formatted = formatLogEntry(entry);
          writer.write(formatted);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"invalid JSON"}');
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    console.log(`codelink-app-logs listening on port ${port}`);
  });

  return server;
}
