import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import submit from '../api/submit.js';
import cleanup from '../api/cleanup.js';
import signUpload from '../api/sign-upload.js';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalError = console.error;
let calls;
let behavior;
beforeEach(() => {
  process.env = { ...originalEnv, VERCEL_ENV: 'development', AIRTABLE_TOKEN: 'test-only',
    AIRTABLE_BASE_ID: 'appTestOnly', AIRTABLE_TABLE: 'Requests', RESEND_API_KEY: 'test-only',
    MAIL_FROM: 'Test <sender@example.test>', NOTIFY_TO: 'jesse@example.test,operator@example.test',
    ALERT_TO: 'operator@example.test', CRON_SECRET: 'test-only', PHOTO_RETENTION_DAYS: '90' };
  calls = [];
  behavior = { airtable: 200, notify: 200, customer: 200, alert: 200 };
  console.error = () => {};
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    const kind = url.startsWith('https://api.airtable.com/') ? 'airtable'
      : body.subject?.startsWith('Intake problem') ? 'alert'
      : body.to?.includes('customer@example.test') ? 'customer' : 'notify';
    calls.push({ url, kind, body, options });
    if (behavior[kind] === 'throw') throw new Error('Simulated provider timeout');
    return new Response(JSON.stringify({ id: 'test-result' }), { status: behavior[kind] });
  };
});
afterEach(() => { process.env = { ...originalEnv }; globalThis.fetch = originalFetch; console.error = originalError; });
const lead = (extra = {}) => ({ name: 'Example Customer', phone: '555-0100', email: 'customer@example.test',
  city: 'Piqua', job_type: 'Painting', details: 'Paint two rooms', ...extra });
async function invoke(handler = submit, body = lead(), method = 'POST', headers = {}) {
  const response = { code: null, body: null, status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; } };
  await handler({ method, body, headers }, response);
  return response;
}

test('a saved request notifies Jesse and acknowledges the customer with honest timing', async () => {
  const result = await invoke();
  assert.equal(result.code, 200);
  assert.deepEqual(calls.map(c => c.kind), ['airtable', 'notify', 'customer']);
  assert.equal(calls[0].body.fields['Job Type'], 'Painting');
  assert.equal(calls[0].body.fields.Source, 'Website form');
  assert.equal(calls[0].body.fields['Hired by'], undefined);
  assert.match(calls[2].body.text, /usually respond within two business days/);
  assert.match(calls[2].body.text, /after a site visit/);
  assert.equal(calls[2].body.reply_to, 'jesse@example.test');
  assert.equal(calls[1].body.reply_to, 'customer@example.test');
});
test('total receipt failure sends no customer acknowledgement, even if the operator alert succeeds', async () => {
  behavior.airtable = 503; behavior.notify = 503;
  const result = await invoke();
  assert.equal(result.code, 500);
  assert.deepEqual(calls.map(c => c.kind), ['airtable', 'notify', 'alert']);
});
test('Airtable failure keeps the complete request in the notification fallback', async () => {
  behavior.airtable = 422;
  const result = await invoke(submit, lead({ photos: ['https://res.cloudinary.com/test/image/upload/photo.jpg'] }));
  assert.equal(result.code, 200);
  const notify = calls.find(c => c.kind === 'notify').body;
  assert.match(notify.subject, /^\[NOT SAVED\]/);
  assert.match(notify.text, /Paint two rooms/);
  assert.match(notify.text, /photo.jpg/);
  assert.equal(calls.filter(c => c.kind === 'customer').length, 1);
});
test('notification failure still acknowledges a successfully saved record', async () => {
  behavior.notify = 503;
  assert.equal((await invoke()).code, 200);
  assert.equal(calls.filter(c => c.kind === 'customer').length, 1);
  assert.equal(calls.filter(c => c.kind === 'alert').length, 1);
});
test('acknowledgement failure does not tell the customer to resubmit a saved lead', async () => {
  behavior.customer = 503;
  assert.equal((await invoke()).code, 200);
  assert.equal(calls.filter(c => c.kind === 'airtable').length, 1);
  assert.equal(calls.filter(c => c.kind === 'alert').length, 1);
});
test('provider exceptions preserve fallback and use bounded requests', async () => {
  behavior.airtable = 'throw';
  assert.equal((await invoke()).code, 200);
  assert.equal(calls.filter(c => c.kind === 'customer').length, 1);
  assert.ok(calls.every(c => c.options.signal instanceof AbortSignal));
});
test('missing optional email preserves the lead without a customer email', async () => {
  assert.equal((await invoke(submit, lead({ email: '' }))).code, 200);
  assert.deepEqual(calls.map(c => c.kind), ['airtable', 'notify']);
});
test('required input and malformed email fail before side effects', async () => {
  assert.equal((await invoke(submit, lead({ details: '' }))).code, 400);
  assert.equal((await invoke(submit, lead({ email: 'bad\naddress' }))).code, 400);
  assert.equal(calls.length, 0);
});
test('honeypot and wrong method do not reach providers', async () => {
  assert.equal((await invoke(submit, lead({ website: 'bot' }))).code, 200);
  assert.equal((await invoke(submit, lead(), 'GET')).code, 405);
  assert.equal(calls.length, 0);
});
test('painting drops stale square footage but preserves materials and room details', async () => {
  await invoke(submit, lead({ square_footage: 'Under 500', material_tier: 'Basic' }));
  assert.equal(calls[0].body.fields['Square footage'], '');
  assert.equal(calls[0].body.fields['Material tier'], 'Basic');
  assert.equal(calls[0].body.fields.Details, 'Paint two rooms');
});
test('roofing retains the approximate size and filters untrusted photo URLs', async () => {
  await invoke(submit, lead({ job_type: 'Roofing', square_footage: '500 to 1,000',
    photos: ['https://example.test/photo.jpg', 'https://res.cloudinary.com/test/image/upload/photo.jpg'] }));
  assert.equal(calls[0].body.fields['Square footage'], '500 to 1,000');
  assert.equal(calls[0].body.fields.Photos.length, 1);
});
test('preview handlers do not send, store, sign uploads, or delete', async () => {
  process.env.VERCEL_ENV = 'preview';
  assert.equal((await invoke()).code, 503);
  assert.equal((await invoke(signUpload)).code, 503);
  assert.equal((await invoke(cleanup, {}, 'GET', { authorization: 'Bearer test-only' })).code, 503);
  assert.equal(calls.length, 0);
});
test('cleanup fails closed without its secret and rejects unauthorized callers', async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await invoke(cleanup, {}, 'GET')).code, 503);
  process.env.CRON_SECRET = 'test-only';
  assert.equal((await invoke(cleanup, {}, 'GET')).code, 401);
  assert.equal(calls.length, 0);
});
test('cleanup rejects invalid retention settings and methods before any deletion', async () => {
  const headers = { authorization: 'Bearer test-only' };
  assert.equal((await invoke(cleanup, {}, 'POST', headers)).code, 405);
  for (const value of ['0', '-1', 'abc', '1.5']) {
    process.env.PHOTO_RETENTION_DAYS = value;
    assert.equal((await invoke(cleanup, {}, 'GET', headers)).code, 503);
  }
  assert.equal(calls.length, 0);
});
