const { test, beforeEach, after } = require('node:test');
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

const auth = require('../src/controllers/authController');
const { requireAuth, requireRole, redirectIfAuthed } = require('../src/middleware/auth');
const originalAdminCode = process.env.ADMIN_SIGNUP_CODE;

function request(body = {}, user = null) {
  return {
    body,
    session: user ? { user } : {},
    get() { return 'text/html'; },
  };
}

function response() {
  return {
    locals: {},
    statusCode: 200,
    redirectPath: null,
    rendered: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    redirect(path) { this.redirectPath = path; },
    render(view, data) { this.rendered = { view, data }; },
    json(data) { this.jsonBody = data; },
  };
}

beforeEach(() => {
  calls = [];
  responses = [];
  delete process.env.ADMIN_SIGNUP_CODE;
});

after(() => {
  if (originalAdminCode === undefined) delete process.env.ADMIN_SIGNUP_CODE;
  else process.env.ADMIN_SIGNUP_CODE = originalAdminCode;
});

test('login accepts a case-insensitive username and creates the session', async () => {
  const passwordHash = await bcrypt.hash('correct-password', 4);
  responses.push({ rows: [{ id: 2, username: 'Cashier1', full_name: 'Cashier One', role: 'sales_rep', password_hash: passwordHash }] });
  const req = request({ username: '  CASHIER1 ', password: 'correct-password' });
  const res = response();

  await auth.login(req, res, assert.fail);

  assert.equal(res.redirectPath, '/pos');
  assert.equal(req.session.user.username, 'Cashier1');
  assert.match(calls[0].sql, /LOWER\(username\)/);
  assert.deepEqual(calls[0].params, ['CASHIER1']);
});

test('login rejects wrong credentials and inactive users without creating a session', async () => {
  for (const rows of [[], [{ password_hash: await bcrypt.hash('correct-password', 4) }]]) {
    responses.push({ rows });
    const req = request({ username: 'cashier', password: 'wrong-password' });
    const res = response();
    await auth.login(req, res, assert.fail);
    assert.equal(res.redirectPath, '/login');
    assert.equal(req.session.user, undefined);
    assert.match(req.session.flash.error, /Invalid username or password/);
  }
});

test('admin registration requires the configured setup code', async () => {
  process.env.ADMIN_SIGNUP_CODE = 'store-secret';
  const req = request({ username: 'admin2', full_name: 'Admin Two', password: 'password', confirm_password: 'password', role: 'admin', admin_code: 'wrong' });
  const res = response();

  await auth.register(req, res, assert.fail);

  assert.equal(res.redirectPath, '/register');
  assert.match(req.session.flash.error, /setup code/);
  assert.equal(calls.length, 0);
});

test('registration rejects case-insensitive duplicate usernames', async () => {
  responses.push({ rows: [{ id: 4 }] });
  const req = request({ username: 'IAN', full_name: 'Ian Fortes', password: 'password', confirm_password: 'password', role: 'sales_rep' });
  const res = response();

  await auth.register(req, res, assert.fail);

  assert.equal(res.redirectPath, '/register');
  assert.match(req.session.flash.error, /already taken/);
  assert.match(calls[0].sql, /LOWER\(username\)/);
});

test('valid registration hashes the password and assigns only an allowed role', async () => {
  responses.push({ rows: [] }, { rows: [{ id: 8, username: 'ian', full_name: 'Ian Fortes', role: 'sales_rep' }] });
  const req = request({ username: ' ian ', full_name: ' Ian Fortes ', password: 'password', confirm_password: 'password', role: 'owner' });
  const res = response();

  await auth.register(req, res, assert.fail);

  assert.equal(res.redirectPath, '/pos');
  const insert = calls[1];
  assert.deepEqual(insert.params.slice(0, 1), ['ian']);
  assert.equal(insert.params[2], 'Ian Fortes');
  assert.equal(insert.params[3], 'sales_rep');
  assert.notEqual(insert.params[1], 'password');
  assert(await bcrypt.compare('password', insert.params[1]));
});

test('authentication and role middleware block unauthorized access', async () => {
  const anonymousReq = request();
  const anonymousRes = response();
  await requireAuth(anonymousReq, anonymousRes, assert.fail);
  assert.equal(anonymousRes.redirectPath, '/login');

  const cashier = { id: 3, username: 'cashier', fullName: 'Cashier', role: 'sales_rep' };
  const roleReq = request({}, cashier);
  const roleRes = response();
  requireRole('admin')(roleReq, roleRes, assert.fail);
  assert.equal(roleRes.statusCode, 403);
  assert.equal(roleRes.rendered.view, 'error');

  const authedRes = response();
  redirectIfAuthed(roleReq, authedRes, assert.fail);
  assert.equal(authedRes.redirectPath, '/pos');
});

test('requireAuth signs out a user deactivated after login', async () => {
  responses.push({ rows: [] });
  const req = request({}, { id: 3, username: 'cashier', fullName: 'Cashier', role: 'sales_rep' });
  const res = response();

  await requireAuth(req, res, assert.fail);

  assert.equal(req.session.user, undefined);
  assert.equal(res.redirectPath, '/login');
  assert.match(req.session.flash.error, /inactive/);
});
