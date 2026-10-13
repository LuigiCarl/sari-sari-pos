const { query } = require('../config/db');
const { setFlash } = require('./flash');

async function requireAuth(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!req.session.user) {
    if (req.get('Accept') && req.get('Accept').includes('application/json')) return res.status(401).json({ error: 'Session expired. Sign in again; your cart is saved.' });
    setFlash(req, 'error', 'Please sign in again. Your cart is saved in this browser tab.');
    return res.redirect('/login');
  }
  try {
    const { rows } = await query('SELECT id, full_name, role, active FROM users WHERE id = $1', [req.session.user.id]);
    if (!rows[0] || !rows[0].active) {
      delete req.session.user;
      setFlash(req, 'error', 'Your account is inactive. Contact your administrator.');
      if (req.get('Accept') && req.get('Accept').includes('application/json')) return res.status(401).json({ error: 'Account inactive.' });
      return res.redirect('/login');
    }
    req.session.user.role = rows[0].role;
    req.session.user.fullName = rows[0].full_name;
    res.locals.currentUser = req.session.user;
    next();
  } catch (error) { next(error); }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (req.session.user.role !== role) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: 'You do not have permission to view this page.',
      });
    }
    next();
  };
}

function redirectIfAuthed(req, res, next) {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/pos');
  }
  next();
}

module.exports = { requireAuth, requireRole, redirectIfAuthed };
