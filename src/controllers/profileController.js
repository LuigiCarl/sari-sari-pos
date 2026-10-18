const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { setFlash } = require('../middleware/flash');

const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

async function showProfile(req, res, next) {
  try {
    const { rows } = await query(
      'SELECT id, username, full_name, role, created_at FROM users WHERE id = $1 AND active = TRUE',
      [req.session.user.id]
    );
    if (!rows[0]) {
      req.session = null;
      return res.redirect('/login');
    }
    res.render('profile', { title: 'My Profile', profile: rows[0] });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  const username = String(req.body.username || '').trim();
  const fullName = String(req.body.full_name || '').trim().replace(/\s+/g, ' ');

  if (username.length < 3 || username.length > 50 || !USERNAME_PATTERN.test(username)) {
    setFlash(req, 'error', 'Username must be 3–50 characters and use only letters, numbers, dots, underscores, or hyphens.');
    return res.redirect('/profile');
  }
  if (fullName.length < 2 || fullName.length > 100) {
    setFlash(req, 'error', 'Full name must be between 2 and 100 characters.');
    return res.redirect('/profile');
  }

  try {
    const { rows: existing } = await query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2',
      [username, req.session.user.id]
    );
    if (existing.length) {
      setFlash(req, 'error', 'That username is already taken.');
      return res.redirect('/profile');
    }

    const { rows } = await query(
      'UPDATE users SET username = $1, full_name = $2 WHERE id = $3 RETURNING username, full_name',
      [username, fullName, req.session.user.id]
    );
    req.session.user.username = rows[0].username;
    req.session.user.fullName = rows[0].full_name;
    setFlash(req, 'success', 'Profile updated successfully.');
    return res.redirect('/profile');
  } catch (error) {
    if (error.code === '23505') {
      setFlash(req, 'error', 'That username is already taken.');
      return res.redirect('/profile');
    }
    return next(error);
  }
}

async function changePassword(req, res, next) {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (newPassword.length < 8 || newPassword.length > 128) {
    setFlash(req, 'error', 'New password must be between 8 and 128 characters.');
    return res.redirect('/profile');
  }
  if (newPassword !== confirmPassword) {
    setFlash(req, 'error', 'New passwords do not match.');
    return res.redirect('/profile');
  }

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1 AND active = TRUE', [req.session.user.id]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      setFlash(req, 'error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      setFlash(req, 'error', 'New password must be different from your current password.');
      return res.redirect('/profile');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.session.user.id]);
    req.session = { flash: { success: 'Password updated. Please sign in again.' } };
    return res.redirect('/login');
  } catch (error) {
    return next(error);
  }
}

module.exports = { showProfile, updateProfile, changePassword };
