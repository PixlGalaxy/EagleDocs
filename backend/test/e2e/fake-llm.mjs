// A fake OpenAI-compatible server for end-to-end tests. Behaviour by keyword in the last user message:
//   [time]   -> calls time_now, then answers with what the tool said
//   [memory] -> calls memory_add
//   [canvas] -> calls canvas_briefing
//   [pages]  -> calls canvas_save_pages for course 101
//   [slow]   -> streams 40 words, 120 ms apart (for steer/cancel tests)
//   a steer (OUT-OF-BAND marker) as the last user turn -> "corrected: <text>"
//   otherwise -> "echo: <text>"
import http from 'http';

const port = Number(process.argv[2] || 4999);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'fake-smart' }, { id: 'fake-mini' }] }));
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || '{}');
  const messages = request.messages ?? [];
  const last = messages[messages.length - 1] ?? {};
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const text = (t) => send({ choices: [{ delta: { content: t } }] });
  const done = () => {
    send({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } });
    res.write('data: [DONE]\n\n');
    res.end();
  };
  const call = (name, args) => {
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${Date.now()}`, function: { name, arguments: '' } }] } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] });
    done();
  };

  if (last.role === 'tool') {
    text(`tool said: ${String(last.content).slice(0, 80)}`);
    return done();
  }
  if (lastUser.includes('OUT-OF-BAND')) {
    const steer = lastUser.split('\n')[1] ?? '';
    text(`corrected: ${steer}`);
    return done();
  }
  if (lastUser.includes('[time]') && request.tools) return call('time_now', {});
  if (lastUser.includes('[canvas]') && request.tools) return call('canvas_briefing', { days: 7 });
  if (lastUser.includes('[pages]') && request.tools) return call('canvas_save_pages', { course_id: 101 });
  if (lastUser.includes('[memory]') && request.tools) return call('memory_add', { content: 'Likes end-to-end tests' });
  // Sandbox: [code] runs Python that prints and writes a file; [browse URL] opens it; [click REF] / [type REF] act on it.
  if (lastUser.includes('[code]') && request.tools) {
    return call('code_run', { language: 'python', code: "open('e2e-out.txt','w').write('made in the sandbox')\nprint(6 * 7)" });
  }
  // Web: [search words...] and [fetch URL].
  const search = /\[search ([^\]]+)\]/.exec(lastUser);
  if (search && request.tools) return call('web_search', { query: search[1] });
  const fetchUrl = /\[fetch (\S+)\]/.exec(lastUser);
  if (fetchUrl && request.tools) return call('web_fetch', { url: fetchUrl[1] });
  const browse = /\[browse (\S+)\]/.exec(lastUser);
  if (browse && request.tools) return call('browser_open', { url: browse[1] });
  const click = /\[click (@e\d+)\]/.exec(lastUser);
  if (click && request.tools) return call('browser_click', { ref: click[1] });
  if (lastUser.includes('[slow]')) {
    let closed = false;
    req.on('close', () => (closed = true));
    for (let i = 0; i < 40 && !closed; i++) {
      text(`word${i} `);
      await sleep(lastUser.includes('[veryslow]') ? 1000 : 120);
    }
    return closed ? undefined : done();
  }
  if (lastUser.includes('[SILENT]')) {
    text('[SILENT]');
    return done();
  }
  text(`echo: ${lastUser.slice(0, 100)}`);
  return done();
});
server.listen(port, () => console.log(`fake llm on ${port}`));
