import { createServer } from 'node:http';

const port = Number(process.env.AI_FIXTURE_PORT ?? 3200);

function groundedAnswerResponse(messages) {
  const userMessage = messages.find((message) => message.role === 'user')?.content ?? '';
  let prompt = {};
  try {
    prompt = JSON.parse(userMessage);
  } catch {
    prompt = {};
  }
  const firstClaim = prompt.eligibleClaims?.[0];
  return JSON.stringify({
    grounded: Boolean(firstClaim?.claimId),
    answer: firstClaim ? `The evidence supports ${firstClaim.claimText}` : null,
    claimIds: firstClaim ? [firstClaim.claimId] : [],
    reason: firstClaim ? null : 'insufficient-evidence',
  });
}

function responseFor(messages, task) {
  if (task === 'grounded-answer') return groundedAnswerResponse(messages);
  const userMessage = messages.find((message) => message.role === 'user')?.content ?? '';
  const sourceMatch = userMessage.match(/<source>\n([\s\S]*?)\n<\/source>/);
  const sourceText = sourceMatch?.[1] ?? '';
  const urlMatch = userMessage.match(/SOURCE URL:\n(https?:\/\/[^\n]+)/);
  const quote = sourceText.split(/(?<=[.!?])\s+/u)[0] || sourceText.slice(0, 60);
  const start = sourceText.indexOf(quote);
  const payload = {
    claims: [
      {
        text: quote,
        quote,
        start: Math.max(start, 0),
        end: Math.max(start, 0) + quote.length,
        citationLinks: urlMatch ? [urlMatch[1]] : [],
      },
    ],
  };
  return JSON.stringify(payload);
}

const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    let messages = [];
    let task;
    try {
      const parsed = JSON.parse(body);
      messages = parsed.messages ?? [];
      task = parsed.task;
    } catch {
      response.writeHead(400).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: responseFor(messages, task) } }],
      }),
    );
  });
});

server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
