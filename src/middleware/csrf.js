const crypto = require('node:crypto');

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function verifyCsrfToken(req, res, next) {
  const expected = req.session.csrfToken;
  const received = req.body && req.body._csrf;
  if (!expected || !received) return res.status(403).render('error', {
    title: 'Invalid Request',
    message: 'This form has expired. Please go back, refresh the page, and try again.',
  });

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(403).render('error', {
      title: 'Invalid Request',
      message: 'This form has expired. Please go back, refresh the page, and try again.',
    });
  }
  next();
}

module.exports = { ensureCsrfToken, verifyCsrfToken };
