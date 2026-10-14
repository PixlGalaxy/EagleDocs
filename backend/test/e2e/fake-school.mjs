// A fake school for the school e2e: a Microsoft-style sign-in with Duo, Outlook Web and Degree Works.
// The sandbox browser reaches it at http://host.docker.internal:<port>.
//   POST /__approve   approves the pending Duo push (the test plays the student's phone)
//   GET  /__sent      what was "sent", as JSON
//   POST /__expire    ends every session; the next mail visit lands on a dead-end "Sign out" page (like Microsoft)
// Password: correct-horse. Anything else is rejected.
import http from 'http';

const port = Number(process.argv[2] || 4997);
const PASSWORD = 'correct-horse';
const sessions = new Set();
let signOutNext = false;
const pending = new Map(); // sid -> { approved, next }
const sent = [];
const inbox = [
  { id: 'msg-1', from: 'Prof. Martinez', subject: 'ACG 2021 exam 2 moved to Thursday', body: 'Hello class, exam 2 is now on Thursday at 9:00 AM in Lutgert 2201. Bring a calculator.', unread: true },
  { id: 'msg-2', from: 'FGCU Bookstore', subject: 'Your First Day Ready access code', body: 'Your McGraw Hill Connect access code is ready in Canvas under First Day Ready.', unread: false },
  { id: 'msg-3', from: 'Advising', subject: 'Registration opens Nov 3', body: 'Spring registration opens November 3. Meet your advisor before then.', unread: false },
];

const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
  });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (status, html, headers = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      res.end(html);
    };
    const redirect = (to, headers = {}) => {
      res.writeHead(302, { location: to, ...headers });
      res.end();
    };
    const sid = cookies(req).sid;

    // ---------------------------------------------------------------- test hooks
    if (url.pathname === '/__approve') {
      for (const p of pending.values()) p.approved = true;
      res.end('{"approved":true}');
      return;
    }
    if (url.pathname === '/__expire') {
      sessions.clear();
      signOutNext = true;
      res.end('{"expired":true}');
      return;
    }
    if (signOutNext && url.pathname.startsWith('/mail')) {
      signOutNext = false;
      return send(200, page('Sign out', '<p>You signed out of your account. It is a good idea to close all browser windows.</p>'));
    }
    if (url.pathname === '/__sent') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(sent));
      return;
    }

    // ---------------------------------------------------------------- sign-in (Microsoft-like)
    if (url.pathname === '/login') {
      if (req.method === 'POST') {
        const form = await readBody(req);
        return redirect(`/login/password?next=${encodeURIComponent(url.searchParams.get('next') ?? '/')}&user=${encodeURIComponent(form.loginfmt ?? '')}`);
      }
      return send(200, page('Sign in to your account', `<form method="post"><div>Sign in</div><input type="email" name="loginfmt" placeholder="Email"><input type="submit" id="idSIButton9" value="Next"></form>`));
    }
    if (url.pathname === '/login/password') {
      const next = url.searchParams.get('next') ?? '/';
      if (req.method === 'POST') {
        const form = await readBody(req);
        if (form.passwd !== PASSWORD) {
          return send(200, page('Sign in to your account', `<form method="post"><div id="passwordError">Your account or password is incorrect.</div><input type="password" name="passwd"><input type="submit" id="idSIButton9" value="Sign in"></form>`));
        }
        const id = Math.random().toString(36).slice(2);
        pending.set(id, { approved: false, next });
        return redirect(`/duo?tx=${id}`);
      }
      return send(200, page('Enter password', `<form method="post"><div>Enter password</div><input type="password" name="passwd"><input type="submit" id="idSIButton9" value="Sign in"></form>`));
    }
    if (url.pathname === '/duo') {
      const tx = pending.get(url.searchParams.get('tx'));
      if (!tx) return send(400, page('Duo Security', 'Expired'));
      if (!tx.approved) {
        // Refreshes like the real prompt while it waits for the phone.
        return send(200, page('Duo Security', `<h1>Check for a Duo Push</h1><p>Sent to "iOS" (***-***-1234)</p><script>setTimeout(() => location.reload(), 1500)</script>`));
      }
      return send(200, page('Duo Security', `<h1>Is this your device?</h1><button id="trust-browser-button" onclick="location='/kmsi?next=${encodeURIComponent(tx.next)}'">Yes, this is my device</button>`));
    }
    if (url.pathname === '/kmsi') {
      const next = url.searchParams.get('next') ?? '/';
      if (req.method === 'POST') {
        const id = Math.random().toString(36).slice(2);
        sessions.add(id);
        return redirect(next, { 'set-cookie': `sid=${id}; Path=/; HttpOnly` });
      }
      return send(200, page('Stay signed in?', `<form method="post"><div>Stay signed in?</div><input type="checkbox" id="KmsiCheckboxField"><input type="submit" id="idSIButton9" value="Yes"></form>`));
    }

    if (!sessions.has(sid)) return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);

    // ---------------------------------------------------------------- Outlook
    if (url.pathname === '/mail/' || url.pathname === '/mail') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const read = inbox.find((m) => m.id === url.searchParams.get('read'));
      const list = inbox.filter((m) => !q || `${m.from} ${m.subject} ${m.body}`.toLowerCase().includes(q));
      const rows = list
        .map((m) => `<div role="option" data-convid="${m.id}" aria-label="${m.unread ? 'Unread ' : ''}${esc(m.from)} ${esc(m.subject)}" onclick="location='/mail/?read=${m.id}'"><span>${esc(m.from)}</span><br><span>${esc(m.subject)}</span><br><span>${esc(m.body.slice(0, 40))}</span></div>`)
        .join('');
      // Outlook repeats rows in accessibility wrappers: the tool must dedupe.
      const dupe = list[0] ? `<div data-convid="${list[0].id}" aria-hidden="false"></div>` : '';
      const pane = read ? `<div aria-label="Reading Pane"><h2>${esc(read.subject)}</h2><p>From: ${esc(read.from)}</p><p>${esc(read.body)}</p></div>` : '';
      return send(200, page('Mail - Outlook', `<form action="/mail/"><input id="topSearchInput" name="q" aria-label="Search"></form><button aria-label="New mail" onclick="location='/mail/compose'">New mail</button><div role="listbox">${rows}${dupe}</div>${pane}`));
    }
    if (url.pathname === '/mail/compose') {
      if (req.method === 'POST') {
        sent.push(await readBody(req));
        return redirect('/mail/');
      }
      return send(
        200,
        page(
          'Mail - Outlook',
          `<input aria-label="To"><input aria-label="Add a subject"><div aria-label="Message body" contenteditable="true"></div>
           <button aria-label="Send" onclick="fetch('/mail/compose',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({to:document.querySelector('[aria-label=To]').value,subject:document.querySelector('[aria-label=\\'Add a subject\\']').value,body:document.querySelector('[aria-label=\\'Message body\\']').innerText})}).then(()=>location='/mail/')">Send</button>`,
        ),
      );
    }
    if (url.pathname === '/mail/sentitems') {
      const rows = sent.map((m, i) => `<div role="option" data-convid="sent-${i}"><span>To: ${esc(m.to)}</span><br><span>${esc(m.subject)}</span></div>`).join('');
      return send(200, page('Sent Items - Outlook', `<div role="listbox">${rows}</div>`));
    }

    // ---------------------------------------------------------------- Degree Works
    if (url.pathname.startsWith('/dw')) {
      const expanded = url.searchParams.has('all');
      const detail = expanded
        ? `<ul><li>ACG 2021 Principles of Financial Accounting - IN PROGRESS (Fall 2026)</li><li>ACG 2071 Managerial Accounting - STILL NEEDED</li><li>Choose 2 from: FIN 3403, MAN 3025, MAR 3023</li></ul>`
        : '';
      return send(
        200,
        page(
          'Degree Works - Student View',
          `<main><h1>Degree Works</h1><p>Student: Dev Student - Bachelor of Science in Accounting</p><p>Overall GPA 3.42 - Credits required 120 - Credits applied 64</p>
           <h2>Business Core - 70% complete</h2><button onclick="location='/dw/?all=1'">Expand all</button>${detail}</main>`,
        ),
      );
    }
    send(404, page('Not found', 'Not found'));
  })
  .listen(port, () => console.log(`fake school on ${port}`));
