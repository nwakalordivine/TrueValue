// "Enter the 6-digit code" screen: six boxes with paste, auto-advance and backspace, a Resend button
// with a 60-second countdown, and a way back. Used for sign-in now and for changing email in Phase 5.
import { esc } from './views.js';

const RESEND_SECONDS = 60; // matches the server's limit of one code per email per minute

// onSubmit(code) and onResend() return promises; a rejected promise's message is shown to the user.
export function codeEntry(container, { email, onSubmit, onResend, onBack, backLabel = 'Use a different email' }) {
  container.innerHTML = `
    <div class="code-screen">
      <p class="code-lead" id="codeLead" tabindex="-1">Enter the 6-digit code we sent to <strong>${esc(email)}</strong></p>
      <fieldset class="code-boxes" aria-describedby="codeLead">
        <legend class="sr-only">6-digit code</legend>
        ${Array.from({ length: 6 }, (_, i) => `<input class="code-box" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1"
          autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1} of 6">`).join('')}
      </fieldset>
      <p class="form-error" role="alert"></p>
      <p class="code-hint muted">The code expires in 10 minutes. Check your spam folder if it does not arrive.</p>
      <div class="code-actions">
        <button type="button" class="button secondary" data-resend disabled></button>
        <button type="button" class="link" data-back>${esc(backLabel)}</button>
      </div>
    </div>`;

  const boxes = [...container.querySelectorAll('.code-box')];
  const error = container.querySelector('.form-error');
  const resend = container.querySelector('[data-resend]');
  let busy = false, countdown = null;

  const code = () => boxes.map(b => b.value).join('');
  const setBusy = on => { busy = on; boxes.forEach(b => { b.disabled = on; }); };
  const clear = () => { boxes.forEach(b => { b.value = ''; }); boxes[0].focus(); };

  function fill(digits, from = 0) {
    [...digits].slice(0, 6 - from).forEach((d, i) => { boxes[from + i].value = d; });
    const next = boxes.find(b => !b.value);
    (next || boxes[5]).focus();
    maybeSubmit();
  }

  async function maybeSubmit() {
    if (busy || code().length !== 6) return;
    error.textContent = '';
    setBusy(true);
    try {
      await onSubmit(code());
    } catch (e) {
      error.textContent = e.message || 'Something went wrong. Try again.';
      setBusy(false);
      clear();
    }
  }

  function startCountdown() {
    let left = RESEND_SECONDS;
    clearInterval(countdown);
    resend.disabled = true;
    const tick = () => {
      if (!container.isConnected) { clearInterval(countdown); return; }
      resend.textContent = left > 0 ? `Resend code (${left}s)` : 'Resend code';
      resend.disabled = left > 0;
      if (left-- <= 0) clearInterval(countdown);
    };
    tick();
    countdown = setInterval(tick, 1000);
  }

  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      const digits = box.value.replace(/\D/g, '');
      box.value = '';
      if (digits) fill(digits, i); // typing one digit, or a phone's one-time-code autofill of all six
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ''; boxes[i - 1].focus(); }
      else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
      else if (e.key === 'ArrowRight' && i < 5) { e.preventDefault(); boxes[i + 1].focus(); }
    });
    box.addEventListener('paste', e => {
      const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '');
      if (!digits) return;
      e.preventDefault();
      boxes.forEach(b => { b.value = ''; });
      fill(digits, 0);
    });
    box.addEventListener('focus', () => box.select());
  });

  resend.addEventListener('click', async () => {
    error.textContent = '';
    resend.disabled = true;
    try {
      await onResend();
      startCountdown();
      clear();
    } catch (e) {
      error.textContent = e.message || 'Could not send a new code.';
      resend.disabled = false;
    }
  });
  container.querySelector('[data-back]').addEventListener('click', () => { clearInterval(countdown); onBack(); });

  startCountdown();
  boxes[0].focus();
}
