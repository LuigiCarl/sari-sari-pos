const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

let calls = [];
let responses = [];
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return responses.shift() || { rows: [] };
    },
  },
};
const profile = require('../src/controllers/profileController');
const { ensureCsrfToken, verifyCsrfToken } = require('../src/middleware/csrf');

function request(body = {}) {
  return { body, session: { user: { id: 7, username: 'old-name', fullName: 'Old Name', role: 'sales_rep' } } };
}

function response() {
  return {
    locals: {},
    statusCode: 200,
    redirectPath: null,
    rendered: null,
    status(code) { this.statusCode = code; return this; },
    redirect(path) { this.redirectPath = path; },
    render(view, data) { this.rendered = { view, data }; },
  };
}

beforeEach(() => { calls = []; responses = []; });

test('profile update validates fields before querying', async () => {
  const req = request({ username: 'bad name', full_name: 'A' });
  const res = response();
  await profile.updateProfile(req, res, assert.fail);
  assert.equal(res.redirectPath, '/profile');
  assert.match(req.session.flash.error, /Username/);
  assert.equal(calls.length, 0);
});

test('profile update rejects a case-insensitive duplicate username', async () => {
  responses.push({ rows: [{ id: 9 }] });
  const req = request({ username: 'Jerome', full_name: 'Jerome Bajaro' });
  const res = response();
  await profile.updateProfile(req, res, assert.fail);
  assert.equal(res.redirectPath, '/profile');
  assert.match(req.session.flash.error, /already taken/);
  assert.match(calls[0].sql, /LOWER\(username\)/);
});

test('profile update refreshes session identity', async () => {
  responses.push({ rows: [] }, { rows: [{ username: 'jerome', full_name: 'Jerome Bajaro' }] });
  const req = request({ username: 'jerome', full_name: '  Jerome   Bajaro ' });
  const res = response();
  await profile.updateProfile(req, res, assert.fail);
  assert.equal(res.redirectPath, '/profile');
  assert.equal(req.session.user.username, 'jerome');
  assert.equal(req.session.user.fullName, 'Jerome Bajaro');
  assert.equal(req.session.user.role, 'sales_rep');
  assert.deepEqual(calls[1].params, ['jerome', 'Jerome Bajaro', 7]);
});

test('password change rejects the wrong current password', async () => {
  responses.push({ rows: [{ password_hash: await bcrypt.hash('correct-password', 4) }] });
  const req = request({ current_password: 'wrong-password', new_password: 'new-password', confirm_password: 'new-password' });
  const res = response();
  await profile.changePassword(req, res, assert.fail);
  assert.equal(res.redirectPath, '/profile');
  assert.match(req.session.flash.error, /incorrect/);
  assert.equal(calls.length, 1);
});

test('password change stores a hash and signs the user out', async () => {
  responses.push({ rows: [{ password_hash: await bcrypt.hash('old-password', 4) }] }, { rows: [] });
  const req = request({ current_password: 'old-password', new_password: 'new-password', confirm_password: 'new-password' });
  const res = response();
  await profile.changePassword(req, res, assert.fail);
  assert.equal(res.redirectPath, '/login');
  assert.equal(req.session.user, undefined);
  assert.match(req.session.flash.success, /sign in again/);
  assert.notEqual(calls[1].params[0], 'new-password');
  assert(await bcrypt.compare('new-password', calls[1].params[0]));
});

test('CSRF middleware creates and validates a session-bound token', () => {
  const req = { session: {}, body: {} };
  const res = response();
  let advanced = false;
  ensureCsrfToken(req, res, () => { advanced = true; });
  assert(advanced);
  assert.equal(res.locals.csrfToken, req.session.csrfToken);

  req.body._csrf = req.session.csrfToken;
  advanced = false;
  verifyCsrfToken(req, res, () => { advanced = true; });
  assert(advanced);

  req.body._csrf = 'invalid';
  verifyCsrfToken(req, res, assert.fail);
  assert.equal(res.statusCode, 403);
  assert.equal(res.rendered.view, 'error');
});
