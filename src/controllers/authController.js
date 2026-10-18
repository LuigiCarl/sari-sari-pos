const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { setFlash } = require('../middleware/flash');

function showLogin(req, res) {
  res.render('login', { title: 'Login' });
}

async function login(req, res, next) {
  const username = String(req.body.username || '').trim();
  const password = req.body.password || '';
  try {
    const { rows } = await query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND active = TRUE',
      [username]
    );
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      setFlash(req, 'error', 'Invalid username or password.');
      return res.redirect('/login');
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    };
    return res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/pos');
  } catch (err) {
    return next(err);
  }
}

function showRegister(req, res) {
  res.render('register', {
    title: 'Register',
    adminSignupEnabled: Boolean(process.env.ADMIN_SIGNUP_CODE),
  });
}

async function register(req, res, next) {
  const username = String(req.body.username || '').trim();
  const fullName = String(req.body.full_name || '').trim();
  const { password, confirm_password: confirmPassword, role, admin_code: adminCode } = req.body;
  try {
    if (!username || !fullName || !password) {
      setFlash(req, 'error', 'Please fill in all required fields.');
      return res.redirect('/register');
    }
    if (password.length < 6) {
      setFlash(req, 'error', 'Password must be at least 6 characters.');
      return res.redirect('/register');
    }
    if (password !== confirmPassword) {
      setFlash(req, 'error', 'Passwords do not match.');
      return res.redirect('/register');
    }

    let finalRole = 'sales_rep';
    if (role === 'admin') {
      const signupCode = process.env.ADMIN_SIGNUP_CODE;
      if (!signupCode || adminCode !== signupCode) {
        setFlash(req, 'error', 'Incorrect (or disabled) admin setup code.');
        return res.redirect('/register');
      }
      finalRole = 'admin';
    }

    const { rows: existing } = await query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (existing.length) {
      setFlash(req, 'error', 'That username is already taken.');
      return res.redirect('/register');
    }

    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role',
      [username, hash, fullName, finalRole]
    );
    const user = rows[0];

    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    };
    return res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/pos');
  } catch (err) {
    return next(err);
  }
}

function logout(req, res) {
  req.session = null;
  res.redirect('/login');
}

module.exports = { showLogin, login, showRegister, register, logout };
