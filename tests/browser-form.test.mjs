import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function browserFixture(fetch, files = []) {
  const elements = new Map();
  let submit;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: false, disabled: false,
      textContent: '', files: [], addEventListener(event, fn) { if (id === 'estimate-form' && event === 'submit') submit = fn; },
      querySelector() { return element('submit-button'); }, reset() { element('type').value = 'Roofing'; } });
    return elements.get(id);
  };
  element('type').value = 'Roofing';
  element('photos').files = files;
  class TestFormData {
    constructor(form) { this.values = new Map(form ? [['name','Synthetic'],['phone','555-0100'],['city','Piqua'],
      ['job_type',element('type').value],['details','Two rooms'],['square_footage','Under 500']] : []); }
    append(k,v) { this.values.set(k,v); }
    [Symbol.iterator]() { return this.values[Symbol.iterator](); }
  }
  const context = vm.createContext({ document: { getElementById: element }, fetch,
    FormData: TestFormData, AbortSignal, console: { error() {} },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Image: class { set src(_) { this.onerror(); } } });
  vm.runInContext(source, context);
  return { context, element, submit: () => submit({ preventDefault() {} }) };
}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('one failed upload preserves the other photos and continues with later files', async () => {
  let count = 0;
  const fixture = browserFixture(async url => {
    if (url === '/api/sign-upload') return response({ cloudName: 'test', apiKey: 'test', signature: 'test', timestamp: 1, folder: 'test' });
    count++;
    return count === 2 ? response({}, 503) : response({ secure_url: `https://res.cloudinary.com/test/image/upload/${count}.jpg` });
  }, [{}, {}, {}]);
  const result = await vm.runInContext('uploadPhotos()', fixture.context);
  assert.equal(count, 3);
  assert.equal(result.failed, 1);
  assert.deepEqual(Array.from(result.urls), ['https://res.cloudinary.com/test/image/upload/1.jpg', 'https://res.cloudinary.com/test/image/upload/3.jpg']);
});
test('failed photo signing still submits the lead and leaves a visible missing-photo warning', async () => {
  let payload;
  const fixture = browserFixture(async (url, options) => {
    if (url === '/api/sign-upload') return response({}, 503);
    assert.equal(url, '/api/submit');
    payload = JSON.parse(options.body);
    return response({ ok: true });
  }, [{}]);
  await fixture.submit();
  assert.equal(payload.details, 'Two rooms');
  assert.deepEqual(payload.photos, []);
  assert.match(fixture.element('photo-status').textContent, /1 photo didn't upload/);
  assert.match(fixture.element('photo-status').textContent, /Your request was received/);
  assert.equal(fixture.element('submit-button').disabled, false);
});
test('painting hides and disables square footage and shows the room/surface prompt', () => {
  const fixture = browserFixture(() => { throw new Error('No network expected'); });
  fixture.element('type').value = 'Painting';
  vm.runInContext('syncSqft()', fixture.context);
  assert.equal(fixture.element('sqft-field').hidden, true);
  assert.equal(fixture.element('square_footage').disabled, true);
  assert.equal(fixture.element('painting-hint').hidden, false);
});
