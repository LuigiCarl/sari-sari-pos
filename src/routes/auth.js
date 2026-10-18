const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { requireAuth, redirectIfAuthed } = require('../middleware/auth');
const { setFlash } = require('../middleware/flash');
const { ensureCsrfToken, verifyCsrfToken } = require('../middleware/csrf');
const profile = require('../controllers/profileController');

const router = express.Router();

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('login', { title: 'Login' });
});

router.post('/login', async (req, res, next) => {
  const { username, password } = req.body;
  try {
    const { rows } = await query('SELECT * FROM users WHERE username = $1 AND active = TRUE', [username]);
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      setFlash(req, 'error', 'Invalid username or password.');
      return res.redirect('/login');
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    };

    res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/pos');
  } catch (err) {
    next(err);
  }
});

router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('register', {
    title: 'Register',
    adminSignupEnabled: Boolean(process.env.ADMIN_SIGNUP_CODE),
  });
});

router.post('/register', async (req, res, next) => {
  const { username, full_name, password, confirm_password, role, admin_code } = req.body;
  try {
    if (!username || !full_name || !password) {
      setFlash(req, 'error', 'Please fill in all required fields.');
      return res.redirect('/register');
    }
    if (password.length < 6) {
      setFlash(req, 'error', 'Password must be at least 6 characters.');
      return res.redirect('/register');
    }
    if (password !== confirm_password) {
      setFlash(req, 'error', 'Passwords do not match.');
      return res.redirect('/register');
    }

    let finalRole = 'sales_rep';
    if (role === 'admin') {
      const signupCode = process.env.ADMIN_SIGNUP_CODE;
      if (!signupCode || admin_code !== signupCode) {
        setFlash(req, 'error', 'Incorrect (or disabled) admin setup code.');
        return res.redirect('/register');
      }
      finalRole = 'admin';
    }

    const { rows: existing } = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.length) {
      setFlash(req, 'error', 'That username is already taken.');
      return res.redirect('/register');
    }

    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role',
      [username, hash, full_name, finalRole]
    );
    const user = rows[0];

    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    };
    res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/pos');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

router.get('/profile', requireAuth, ensureCsrfToken, profile.showProfile);
router.post('/profile', requireAuth, ensureCsrfToken, verifyCsrfToken, profile.updateProfile);
router.post('/profile/password', requireAuth, ensureCsrfToken, verifyCsrfToken, profile.changePassword);

module.exports = router;
