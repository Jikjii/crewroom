(() => {
  'use strict';

  // Email tokens live only in memory; remove them from the address bar immediately.
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  let actionToken = fragment.get('confirm') || fragment.get('unsubscribe') || '';
  const action = fragment.has('confirm') ? 'confirm' : fragment.has('unsubscribe') ? 'unsubscribe' : null;
  if (action) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  window.addEventListener('hashchange', () => {
    const nextFragment = new URLSearchParams(window.location.hash.slice(1));
    if (nextFragment.has('confirm') || nextFragment.has('unsubscribe')) window.location.reload();
  });

  const $ = (selector, root = document) => root.querySelector(selector);
  const setText = (element, text) => { element.textContent = text; };
  const showError = (element, message) => { setText(element, message); element.hidden = false; };
  const hideError = (element) => { setText(element, ''); element.hidden = true; };
  let available = false;
  let receiptToken = '';
  let manageToken = '';

  async function request(path, data) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {
        method: data === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: data === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(typeof result?.error === 'string' ? result.error : typeof result?.message === 'string' ? result.message : response.status === 429 ? 'Too many requests. Please wait a little and try again.' : 'That didn’t go through. Please try again.');
        error.status = response.status;
        throw error;
      }
      if (!result || typeof result !== 'object') throw new Error('We couldn’t read the response. Please try again.');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The request took too long. Please try again.');
      if (error instanceof TypeError) throw new Error('We couldn’t connect. Check your connection and try again.');
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  // Appearance is session-only. No email, signup answers, or tokens are stored locally.
  const themeButton = $('.theme-toggle');
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const darkNow = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : systemTheme.matches;
  function updateThemeButton() {
    themeButton.setAttribute('aria-label', darkNow() ? 'Use light appearance' : 'Use dark appearance');
    $('meta[name="theme-color"]').setAttribute('content', darkNow() ? '#111721' : '#f6f5f0');
  }
  themeButton.hidden = false;
  themeButton.addEventListener('click', () => {
    document.documentElement.dataset.theme = darkNow() ? 'light' : 'dark';
    updateThemeButton();
  });
  systemTheme.addEventListener?.('change', updateThemeButton);
  updateThemeButton();

  // This is a local illustrated walkthrough, not a live crew or account.
  const tabs = [...document.querySelectorAll('.demo-tabs [role="tab"]')];
  function chooseTab(tab, focus = false) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => chooseTab(tab));
    tab.addEventListener('keydown', (event) => {
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== null) { event.preventDefault(); chooseTab(tabs[next], true); }
    });
  });
  $('#demo-task').addEventListener('change', (event) => {
    setText($('#demo-progress'), event.target.checked ? '3 of 3 ready' : '2 of 3 ready');
  });

  function addDetails(slot, mode, updatesConsent = false, initialDetails = {}) {
    // Only one details form may exist, keeping labels and focus targets unambiguous.
    document.querySelectorAll('.details-form').forEach((form) => form.remove());
    slot.append($('#details-template').content.cloneNode(true));
    const form = $('.details-form', slot);
    const error = $('.details-error', form);
    const status = $('.details-status', form);
    const submit = $('button[type="submit"]', form);
    const skip = $('.skip-details', form);
    const updates = $('[name="updatesConsent"]', form);
    if (typeof initialDetails.role === 'string') $('[name="role"]', form).value = initialDetails.role;
    if (typeof initialDetails.nextShoot === 'string') $('[name="nextShoot"]', form).value = initialDetails.nextShoot.slice(0, 300);
    if (mode === 'preferences') {
      $('.preferences-updates', form).hidden = false;
      updates.checked = updatesConsent;
    }
    skip.addEventListener('click', () => {
      form.replaceChildren();
      const message = document.createElement('p');
      message.className = 'status-message';
      message.setAttribute('role', 'status');
      message.textContent = mode === 'preferences' ? 'You’re all set. We’ll be in touch about beta access.' : 'You can skip the details. Please confirm your email to complete your request.';
      form.append(message);
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity() || submit.disabled) return;
      hideError(error);
      status.hidden = true;
      submit.disabled = true;
      skip.disabled = true;
      form.setAttribute('aria-busy', 'true');
      const originalLabel = submit.textContent;
      setText(submit, 'Saving…');
      const details = { role: $('[name="role"]', form).value, nextShoot: $('[name="nextShoot"]', form).value.trim() };
      const submittedUpdates = updates.checked;
      try {
        if (mode === 'preferences') await request('/api/beta/preferences', { token: manageToken, ...details, updatesConsent: submittedUpdates });
        else await request('/api/beta/details', { receiptToken, ...details });
        if (mode === 'preferences') updateConsentSummary(submittedUpdates);
        setText(status, mode === 'preferences' ? 'Saved. Thank you for helping shape Crewroom.' : 'Saved. Now confirm your email to complete your request.');
        status.hidden = false;
      } catch (problem) {
        showError(error, problem.message);
      } finally {
        submit.disabled = false;
        skip.disabled = false;
        form.removeAttribute('aria-busy');
        setText(submit, originalLabel);
      }
    });
  }

  const signupForm = $('#signup-form');
  const signupSubmit = $('#signup-submit');
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!available || signupSubmit.disabled || !signupForm.reportValidity()) return;
    const error = $('#signup-error');
    hideError(error);
    signupSubmit.disabled = true;
    signupForm.setAttribute('aria-busy', 'true');
    setText(signupSubmit, 'Sending confirmation…');
    const source = {};
    const query = new URLSearchParams(window.location.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      const value = query.get(key)?.trim();
      if (value) source[key] = value.slice(0, 120);
    }
    try {
      const result = await request('/api/beta/signup', {
        email: $('#signup-email').value.trim(),
        device: $('[name="device"]:checked', signupForm).value,
        ageConfirmed: $('#signup-age').checked,
        updatesConsent: $('#signup-updates').checked,
        website: $('#signup-website').value,
        source,
      });
      receiptToken = typeof result.receiptToken === 'string' ? result.receiptToken : '';
      $('#signup-content').hidden = true;
      $('#signup-success').hidden = false;
      if (receiptToken) addDetails($('#signup-details-slot'), 'receipt');
      $('#success-title').focus();
    } catch (problem) {
      showError(error, problem.message);
    } finally {
      signupSubmit.disabled = false;
      signupForm.removeAttribute('aria-busy');
      setText(signupSubmit, 'Request beta access ↗');
    }
  });

  $('#signup-again').addEventListener('click', () => {
    receiptToken = '';
    $('#signup-details-slot').replaceChildren();
    $('#signup-success').hidden = true;
    $('#signup-content').hidden = false;
    $('#signup-email').focus();
  });

  if (action) {
    $('#marketing-view').hidden = true;
    $('#email-action-view').hidden = false;
    const title = $('#email-action-title');
    const description = $('#email-action-description');
    const button = $('#email-action-button');
    const error = $('#email-action-error');
    const resultMessage = $('#email-action-result');
    if (action === 'unsubscribe') {
      setText(title, 'Remove your beta request?');
      setText(description, 'This removes your Crewroom beta request and stops launch updates for this email. It does not delete an existing Crewroom app account.');
      setText(button, 'Remove my request and stop updates');
    }
    if (!actionToken || actionToken.length > 2048) {
      actionToken = '';
      button.hidden = true;
      showError(error, 'This email link is incomplete. Return to beta signup to request a new confirmation email.');
    }
    button.addEventListener('click', async () => {
      if (!actionToken || button.disabled) return;
      hideError(error);
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      const originalLabel = button.textContent;
      setText(button, action === 'confirm' ? 'Confirming…' : 'Removing…');
      try {
        const result = await request(`/api/beta/${action}`, { token: actionToken });
        button.hidden = true;
        actionToken = '';
        if (action === 'confirm') {
          setText(title, 'You’re on the list.');
          setText(description, 'Your email is confirmed. An iPhone beta invitation, when available, will arrive separately. Android requests help us plan what comes next.');
          manageToken = typeof result.manageToken === 'string' ? result.manageToken : '';
          if (manageToken) addDetails($('#confirmed-details-slot'), 'preferences', result.updatesConsent === true, result);
          updateConsentSummary(result.updatesConsent === true);
        } else {
          manageToken = '';
          receiptToken = '';
          setText(title, 'Your request is removed.');
          setText(description, 'Your beta request and launch update subscription have been removed. You can request access again whenever you like.');
          setText(resultMessage, 'You won’t receive further launch updates from this list.');
        }
        resultMessage.hidden = false;
        title.focus();
      } catch (problem) {
        showError(error, problem.status === 400 || problem.status === 404 || problem.status === 410 ? 'This link is invalid or has expired. Return to beta signup to request a fresh confirmation email, or contact support for help.' : problem.message);
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        setText(button, originalLabel);
      }
    });
    title.focus();
  }

  request('/api/beta/config').then((config) => {
    if (typeof config.supportEmail === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.supportEmail)) {
      document.querySelectorAll('.support-link').forEach((link) => { link.href = `mailto:${config.supportEmail}`; });
    }
    available = config.available === true && config.minimumAge === 18;
    $('#signup-fields').disabled = !available;
    if (available) $('#availability-status').hidden = true;
    else showUnavailable('Beta requests are temporarily unavailable. Please try again later or');
  }).catch(() => {
    showUnavailable('We couldn’t check signup availability. Refresh to try again, or');
  });

  function showUnavailable(message) {
    const status = $('#availability-status');
    status.replaceChildren(document.createTextNode(`${message} `));
    const support = document.createElement('a');
    support.href = $('.support-link').href;
    support.textContent = 'contact us for help';
    status.append(support, document.createTextNode('.'));
    status.hidden = false;
  }

  function updateConsentSummary(updatesConsent) {
    const summary = $('#email-action-result');
    setText(summary, updatesConsent ? 'You’ve also opted in to Crewroom progress and launch updates.' : 'You’ll receive emails about your beta request. You have not subscribed to general launch updates.');
    summary.hidden = false;
  }
})();
