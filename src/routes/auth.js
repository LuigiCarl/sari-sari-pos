const express = require('express');
const { requireAuth, redirectIfAuthed } = require('../middleware/auth');
const auth = require('../controllers/authController');
const profile = require('../controllers/profileController');

const router = express.Router();

router.get('/login', redirectIfAuthed, auth.showLogin);
router.post('/login', auth.login);
router.get('/register', redirectIfAuthed, auth.showRegister);
router.post('/register', auth.register);
router.post('/logout', auth.logout);

router.get('/profile', requireAuth, profile.showProfile);
router.post('/profile', requireAuth, profile.updateProfile);
router.post('/profile/password', requireAuth, profile.changePassword);

module.exports = router;
