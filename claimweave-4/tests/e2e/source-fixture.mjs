import { createServer } from 'node:http';

const port = Number(process.env.SOURCE_FIXTURE_PORT ?? 3300);
const pages = new Map([
  ['/one', 'Fixture source one contains enough readable evidence for extraction.'],
  ['/two', 'Fixture source two contains enough readable evidence for extraction.'],
  ['/three', 'Fixture source three contains enough readable evidence for extraction.'],
  [
    '/citation/located',
    'Fixture citation source contains the exact located passage for browser highlighting.',
  ],
  ['/citation/stale', 'Fixture citation source does not contain the persisted stale passage.'],
]);
const attempts = new Map();

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url?.startsWith('/retry-')) {
    const attempt = (attempts.get(request.url) ?? 0) + 1;
    attempts.set(request.url, attempt);
    if (attempt === 1) {
      response.writeHead(503).end();
      return;
    }
  }
  const text =
    pages.get(request.url ?? '') ??
    (request.url?.startsWith('/citation/located')
      ? pages.get('/citation/located')
      : request.url?.startsWith('/citation/stale')
        ? pages.get('/citation/stale')
        : undefined) ??
    (request.url?.startsWith('/retry-')
      ? 'Fixture source retry contains enough readable evidence for extraction.'
      : undefined);
  if (request.method !== 'GET' || !text) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end(text);
});

server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
