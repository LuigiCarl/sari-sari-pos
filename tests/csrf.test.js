const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ensureCsrfToken, verifyCsrfToken } = require('../src/middleware/csrf');

function response() {
  return {
    locals: {},
    statusCode: 200,
    rendered: null,
    status(code) { this.statusCode = code; return this; },
    render(view, data) { this.rendered = { view, data }; },
  };
}

test('CSRF tokens are session-bound and invalid submissions are rejected', () => {
  const req = { session: {}, body: {} };
  const res = response();
  ensureCsrfToken(req, res, () => {});

  assert.match(req.session.csrfToken, /^[a-f0-9]{64}$/);
  assert.equal(res.locals.csrfToken, req.session.csrfToken);

  let advanced = false;
  req.body._csrf = req.session.csrfToken;
  verifyCsrfToken(req, res, () => { advanced = true; });
  assert.equal(advanced, true);

  for (const received of [undefined, '', 'wrong-token']) {
    req.body._csrf = received;
    res.statusCode = 200;
    res.rendered = null;
    verifyCsrfToken(req, res, assert.fail);
    assert.equal(res.statusCode, 403);
    assert.equal(res.rendered.view, 'error');
  }
});

test('every POST form renders the session CSRF token', () => {
  const viewsRoot = path.join(__dirname, '..', 'src', 'views');
  const files = [];

  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(fullPath);
      else if (entry.name.endsWith('.ejs')) files.push(fullPath);
    }
  }

  collect(viewsRoot);
  let postForms = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const forms = source.match(/<form\b[\s\S]*?<\/form>/gi) || [];
    for (const form of forms.filter(markup => /method=["']POST["']/i.test(markup))) {
      postForms += 1;
      assert.match(form, /name=["']_csrf["'][^>]*value=["']<%= csrfToken %>["']/i, `${path.relative(viewsRoot, file)} has an unprotected POST form`);
    }
  }
  assert(postForms > 0);
});
