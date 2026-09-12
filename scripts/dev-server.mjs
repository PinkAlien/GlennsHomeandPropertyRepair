// Local browser verification only. All provider calls are simulated in this
// process, so a browser submission cannot send email or write to Airtable.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import submit from '../api/submit.js';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 4173);
const scenario = process.env.TEST_RECEIPT || 'success';
Object.assign(process.env, { VERCEL_ENV: 'development', AIRTABLE_TOKEN: 'local-test-only',
  AIRTABLE_BASE_ID: 'appLocalTest', AIRTABLE_TABLE: 'Requests', RESEND_API_KEY: 'local-test-only',
  NOTIFY_TO: 'test-operator@example.test', ALERT_TO: 'test-alert@example.test',
  MAIL_FROM: 'Local test <test@example.test>' });
globalThis.fetch = async (url, options) => {
  if (!['https://api.airtable.com/', 'https://api.resend.com/'].some(prefix => String(url).startsWith(prefix))) {
    throw new Error('External network calls are disabled in the local test server');
  }
  const body = JSON.parse(options.body);
  const alert = body.subject?.startsWith('Intake problem');
  const code = scenario === 'both-fail' && !alert ? 503 : 200;
  console.log(JSON.stringify({ simulated: true, provider: url.includes('airtable') ? 'airtable' : 'email', status: code }));
  return new Response(JSON.stringify({ id: 'local-test-result' }), { status: code });
};
http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/submit' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new Error('Request too large'); }
      req.body = JSON.parse(raw);
      res.status = code => { res.statusCode = code; return res; };
      res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      return await submit(req, res);
    }
    if (pathname === '/api/sign-upload') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Uploads intentionally unavailable in local verification' }));
    }
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'styles.css', 'favicon.ico'].includes(file) && !/^images\/[a-zA-Z0-9.-]+$/.test(file)) {
      res.writeHead(404); return res.end('Not found');
    }
    const mime = { '.html': 'text/html', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
    const content = await fs.readFile(path.join(root, file));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch { res.writeHead(400); res.end('Bad request'); }
}).listen(port, '127.0.0.1', () => console.log(`Local verification: http://127.0.0.1:${port} (${scenario}; providers simulated)`));
