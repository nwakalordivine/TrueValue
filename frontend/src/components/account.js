// Everything in the shell that depends on being signed in: the Account card (sign-in screens or the
// profile), the account area at the bottom of the sidebar, and the avatar buttons.
import '../styles/account.css';
import { icon } from './icons.js';
import { esc } from './views.js';
import { codeEntry } from './codeEntry.js';
import { initials } from '../services/teamService.js';
import { resizeImage } from '../services/imageResize.js';
import * as auth from '../services/auth.js';
import * as profile from '../services/profile.js';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const USERNAME_RE = /^[\p{L}\p{N}_ .-]+$/u; // same rule as the server (schemas.py)
const HOME_SECONDS = 5;

const avatarInner = user => (user.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="">` : esc(initials(user.username)));

function usernameError(name) {
  if (name.length < 2 || name.length > 30) return 'Username must be 2 to 30 characters.';
  if (!USERNAME_RE.test(name)) return 'Username can use letters, numbers, spaces, _, . and - only.';
  return '';
}

export function mountAccount({ panelBody, accountArea, avatars, isPanelOpen, closePanel }) {
  let draft = { email: '', username: '' }; // kept between the two sign-in screens
  let notice = '';
  let shownId = null; // the user the profile screens belong to (null while the sign-in screens show)
  let screen = 'signin'; // signin | account | email | code

  // Move focus into the card after a screen change, but only when the card is open
  const focusPanel = (selector = '[data-autofocus]') => {
    if (!isPanelOpen()) return;
    (panelBody.querySelector(selector) || panelBody.querySelector('[data-autofocus]') || panelBody.querySelector('input, button'))?.focus();
  };

  function renderChrome(user) {
    avatars.forEach(a => {
      a.innerHTML = user ? avatarInner(user) : icon('user', 18);
      a.closest('button')?.setAttribute('aria-label', user ? `Open your account (${user.username})` : 'Open your profile');
    });
    accountArea.innerHTML = user
      ? `<p class="account-who">${esc(user.username)}</p>
         <p class="muted">Your values are saved to your account.</p>
         <button type="button" class="button secondary" data-open-profile aria-controls="profilePanel">${icon('user')}Account</button>`
      : `<p class="muted">Your values are saved in this browser.</p>
         <button type="button" class="button secondary" data-open-profile aria-controls="profilePanel">${icon('login')}Sign in</button>`;
  }

  // ----- Signed out -----

  // Screen 1: email and username
  function emailScreen(message = '') {
    shownId = null;
    screen = 'signin';
    panelBody.innerHTML = `
      <form class="signin-form" novalidate>
        <h3 class="panel-heading" tabindex="-1" data-autofocus>Sign in</h3>
        <p>Sign in to save your values on any device. No password needed.</p>
        ${message ? `<p class="account-notice" role="status">${esc(message)}</p>` : ''}
        <label>Email
          <input type="email" name="email" required maxlength="254" autocomplete="email" inputmode="email" value="${esc(draft.email)}">
        </label>
        <label>Username <span class="field-hint">Only needed the first time</span>
          <input type="text" name="username" minlength="2" maxlength="30" autocomplete="nickname" value="${esc(draft.username)}">
        </label>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="button">${icon('send')}Send code</button>
      </form>`;
    const form = panelBody.querySelector('form'), error = form.querySelector('.form-error');
    const email = form.elements.email, username = form.elements.username, submit = form.querySelector('[type=submit]');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      error.textContent = '';
      if (!email.value.trim() || !email.checkValidity()) {
        error.textContent = 'Enter a valid email address.';
        email.focus();
        return;
      }
      draft = { email: email.value.trim().toLowerCase(), username: username.value.trim() };
      submit.disabled = true;
      submit.lastChild.textContent = 'Sending...';
      try {
        await auth.login(draft.email, draft.username);
        codeScreen();
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
        submit.lastChild.textContent = 'Send code';
        (/username/i.test(err.message) ? username : email).focus();
      }
    });
    focusPanel();
  }

  // Screen 2: the 6-digit code
  function codeScreen() {
    codeEntry(panelBody, {
      email: draft.email,
      onSubmit: async code => {
        const result = await auth.verify(draft.email, code, draft.username);
        notice = result.notice || "You're signed in.";
        renderPanel(auth.currentUser());
      },
      onResend: () => auth.login(draft.email, draft.username),
      onBack: () => emailScreen(),
    });
  }

  // ----- Signed in: the profile -----

  // focus: which control gets focus afterwards (after an edit, the button that started it)
  function signedIn(user, { focus } = {}) {
    shownId = user.id;
    screen = 'account';
    panelBody.innerHTML = `
      <div class="account-view">
        <h3 class="panel-heading" tabindex="-1" data-autofocus>Your account</h3>
        <div class="profile-photo">
          <div class="profile-avatar" data-photo-wrap>
            <span class="avatar avatar-xl" data-photo>${avatarInner(user)}</span>
            <button type="button" class="avatar-edit" data-edit-photo aria-label="Change profile picture">${icon('edit', 16)}</button>
          </div>
          <input type="file" accept="${PHOTO_TYPES.join(',')}" data-file hidden>
          <div class="profile-photo-side">
            <p class="muted" data-photo-status role="status"></p>
            ${user.avatar_url ? '<button type="button" class="link" data-remove-photo>Remove photo</button>' : ''}
          </div>
        </div>
        <p class="form-error" role="alert" data-photo-error></p>

        <div class="profile-field" data-name-field>
          <span class="field-label" id="nameLabel">Username</span>
          <div class="field-row">
            <span class="account-name">${esc(user.username)}</span>
            <button type="button" class="icon-button" data-edit-name aria-label="Edit username">${icon('edit', 16)}</button>
          </div>
        </div>

        <div class="profile-field">
          <span class="field-label">Email</span>
          <p class="field-value">${esc(user.email)}</p>
          <button type="button" class="button secondary small" data-change-email>Change email</button>
        </div>

        ${notice ? `<p class="account-notice" role="status">${esc(notice)}</p>` : ''}
        <p class="muted">Your values are saved to your account and load on any device where you sign in.</p>
        <button type="button" class="button secondary" data-logout>${icon('login')}Log out</button>
      </div>`;

    const $ = sel => panelBody.querySelector(sel);
    const file = $('[data-file]'), wrap = $('[data-photo-wrap]'), photo = $('[data-photo]');
    const status = $('[data-photo-status]'), photoError = $('[data-photo-error]');
    const photoButtons = () => panelBody.querySelectorAll('[data-edit-photo], [data-remove-photo]');
    const setPhotoBusy = (on, text = '') => {
      wrap.classList.toggle('is-uploading', on);
      photoButtons().forEach(b => { b.disabled = on; });
      status.textContent = text;
    };

    // Profile picture: pick, shrink, show the preview at once, upload
    $('[data-edit-photo]').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const picked = file.files[0];
      file.value = ''; // picking the same file again still fires change
      if (!picked) return;
      photoError.textContent = '';
      if (!PHOTO_TYPES.includes(picked.type)) { photoError.textContent = 'Use a JPEG, PNG or WebP picture.'; return; }
      const before = photo.innerHTML;
      let preview = '';
      setPhotoBusy(true, 'Uploading...');
      try {
        const blob = await resizeImage(picked);
        preview = URL.createObjectURL(blob);
        photo.innerHTML = `<img src="${preview}" alt="">`;
        const updated = await profile.uploadAvatar(blob);
        notice = 'Profile picture updated.';
        signedIn(updated, { focus: '[data-edit-photo]' });
      } catch (err) {
        if (!panelBody.contains(photo)) return; // the card moved on while uploading
        photo.innerHTML = before;
        setPhotoBusy(false);
        photoError.textContent = err.message || 'Could not upload the picture.';
      } finally {
        if (preview) URL.revokeObjectURL(preview);
      }
    });

    $('[data-remove-photo]')?.addEventListener('click', async () => {
      photoError.textContent = '';
      setPhotoBusy(true, 'Removing...');
      try {
        const updated = await profile.removeAvatar();
        notice = 'Profile picture removed.';
        signedIn(updated, { focus: '[data-edit-photo]' });
      } catch (err) {
        setPhotoBusy(false);
        photoError.textContent = err.message || 'Could not remove the picture.';
      }
    });

    $('[data-edit-name]').addEventListener('click', () => editName(user));
    $('[data-change-email]').addEventListener('click', () => changeEmailScreen());
    $('[data-logout]').addEventListener('click', async () => {
      notice = '';
      await auth.logout();
      emailScreen('You are signed out. Your values stay in this browser.');
    });
    focusPanel(focus);
  }

  // Username, edited in place: Save or Cancel (Escape cancels without closing the card)
  function editName(user) {
    const field = panelBody.querySelector('[data-name-field]');
    field.innerHTML = `
      <form class="name-edit" novalidate>
        <label class="field-label" for="nameInput">Username</label>
        <input type="text" id="nameInput" name="username" maxlength="30" autocomplete="nickname" value="${esc(user.username)}">
        <p class="form-error" role="alert"></p>
        <div class="name-actions">
          <button type="submit" class="button small">Save</button>
          <button type="button" class="button secondary small" data-cancel>Cancel</button>
        </div>
      </form>`;
    const form = field.querySelector('form'), input = form.elements.username, error = form.querySelector('.form-error');
    const cancel = () => signedIn(auth.currentUser() || user, { focus: '[data-edit-name]' });
    form.querySelector('[data-cancel]').addEventListener('click', cancel);
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = input.value.trim();
      if (name === user.username) { cancel(); return; }
      error.textContent = usernameError(name);
      if (error.textContent) { input.focus(); return; }
      form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
      try {
        const updated = await profile.renameUser(name);
        notice = 'Username saved.';
        signedIn(updated, { focus: '[data-edit-name]' });
      } catch (err) {
        form.querySelectorAll('input, button').forEach(el => { el.disabled = false; });
        error.textContent = err.message || 'Could not save the username.';
        input.focus();
      }
    });
    input.focus();
    input.select();
  }

  // Change email, step 1: the new address. A 409 means another account has it: say so, then go home.
  function changeEmailScreen(value = '') {
    screen = 'email';
    panelBody.innerHTML = `
      <form class="signin-form" novalidate>
        <h3 class="panel-heading" tabindex="-1" data-autofocus>Change email</h3>
        <p>We will send a 6-digit code to the new address to check that it is yours.</p>
        <label>New email
          <input type="email" name="email" required maxlength="254" autocomplete="email" inputmode="email" value="${esc(value)}">
        </label>
        <p class="form-error" role="alert"></p>
        <p class="muted" role="status" data-countdown></p>
        <div class="code-actions">
          <button type="submit" class="button">${icon('send')}Send code</button>
          <button type="button" class="link" data-back>Back</button>
        </div>
      </form>`;
    const form = panelBody.querySelector('form'), error = form.querySelector('.form-error');
    const email = form.elements.email, submit = form.querySelector('[type=submit]');
    const countdownText = form.querySelector('[data-countdown]');
    let timer = null;
    const stop = () => { clearInterval(timer); timer = null; };
    const back = () => { stop(); signedIn(auth.currentUser(), { focus: '[data-change-email]' }); };

    form.querySelector('[data-back]').addEventListener('click', back);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (timer) return;
      error.textContent = '';
      const newEmail = email.value.trim().toLowerCase();
      if (!newEmail || !email.checkValidity()) {
        error.textContent = 'Enter a valid email address.';
        email.focus();
        return;
      }
      submit.disabled = true;
      submit.lastChild.textContent = 'Sending...';
      try {
        await profile.requestEmailChange(newEmail);
        emailCodeScreen(newEmail);
      } catch (err) {
        error.textContent = err.message;
        submit.lastChild.textContent = 'Send code';
        if (err.status === 409) { goHomeAfterCountdown(); return; }
        submit.disabled = false;
        email.focus();
      }
    });

    function goHomeAfterCountdown() {
      email.disabled = true;
      let left = HOME_SECONDS;
      const tick = () => {
        // Closing the card or leaving this screen cancels the trip home
        if (!panelBody.contains(form) || !isPanelOpen()) { stop(); return; }
        if (left > 0) { countdownText.textContent = `Taking you back to the home page in ${left}...`; left--; return; }
        stop();
        closePanel();
        signedIn(auth.currentUser()); // the card shows the profile next time it opens
        const home = location.pathname === '/' || location.pathname.endsWith('/index.html');
        if (home) window.scrollTo(0, 0); else location.assign('/');
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    focusPanel('input');
  }

  // Change email, step 2: the code sent to the new address
  function emailCodeScreen(newEmail) {
    screen = 'code';
    codeEntry(panelBody, {
      email: newEmail,
      onSubmit: async code => {
        const updated = await profile.confirmEmailChange(newEmail, code);
        notice = 'Email updated.';
        signedIn(updated, { focus: '[data-change-email]' });
      },
      onResend: () => profile.requestEmailChange(newEmail),
      onBack: () => changeEmailScreen(newEmail),
    });
  }

  const renderPanel = user => (user ? signedIn(user) : emailScreen());

  auth.onAuthChange(user => {
    renderChrome(user);
    if (user && user.id === shownId) {
      // Same person with new details. While the card is open, each screen redraws itself after its own
      // change, so an open edit is never wiped; a closed card just shows the latest details next time.
      if (!isPanelOpen() && screen === 'account') signedIn(user);
      return;
    }
    // While the sign-in code screen is waiting for verify(), let it finish; otherwise redraw for the new state
    if (user && panelBody.querySelector('.code-screen')) return;
    if (!user) notice = '';
    renderPanel(user);
  });
  const user = auth.currentUser();
  renderChrome(user);
  renderPanel(user);
}
