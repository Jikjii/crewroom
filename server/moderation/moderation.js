'use strict';
const $ = id => document.getElementById(id);
const state = { csrf: null, tab: 'queue', queue: [], reports: [], history: [], busy: false, selected: null };
function node(tag, text, className) { const item = document.createElement(tag); if (text !== undefined) item.textContent = String(text); if (className) item.className = className; return item; }
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function button(label, action, className) { const item = node('button', label, className); item.type = 'button'; item.addEventListener('click', action); return item; }
function badge(text, extra = '') { return node('span', text, `badge ${extra}`); }
function time(value) { return new Date(value).toLocaleString(); }
async function api(path, data) {
  const response = await fetch(`/api/moderation/${path}`, { credentials: 'same-origin', cache: 'no-store',
    ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || `Request failed (${response.status}).`);
  return result;
}
async function act(fn) {
  if (state.busy) return;
  state.busy = true; document.querySelectorAll('button').forEach(item => item.disabled = true);
  try { await fn(); } catch (error) { notice(error.message, true); }
  finally { state.busy = false; document.querySelectorAll('button').forEach(item => item.disabled = false); }
}
function meta(item, type) {
  return append(node('div', undefined, 'meta'), badge(type), item.priority === 'urgent' && badge('Urgent', 'urgent'),
    item.overdue && badge('Over 24h', 'overdue'), node('span', `${item.ageHours}h waiting`, 'small'));
}
function empty(text) { return append(node('div', undefined, 'panel empty'), node('span', '✓', 'empty-icon'), node('h2', text), node('p', 'Refresh to check for newly submitted work and reports.')); }
async function refresh() {
  const [queue, history] = await Promise.all([api('queue'), api('history')]);
  state.queue = queue.items; state.reports = queue.reports; state.history = history.items;
  $('queue-count').textContent = String(queue.totalQueue); $('report-count').textContent = String(queue.totalReports);
  state.totalQueue = queue.totalQueue; state.totalReports = queue.totalReports;
  renderList();
}
function historyEntry(item) {
  return append(node('article', undefined, 'history-entry'), node('strong', item.action.replaceAll('-', ' ')),
    node('p', item.reason), node('p', `${item.targetType} · ${item.targetId}`, 'small'), node('p', `${time(item.createdAt)} · Operator ${item.actorId}`, 'small'));
}
function renderList() {
  const list = $('list'); list.replaceChildren();
  document.querySelectorAll('[data-tab]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.tab === state.tab)));
  if (state.tab === 'history') {
    if (!state.history.length) list.append(empty('No operator decisions yet.'));
    else for (const item of state.history) list.append(append(node('div', undefined, 'item'), historyEntry(item)));
    return;
  }
  const items = state.tab === 'queue' ? state.queue : state.reports;
  if (!items.length) { list.append(empty(state.tab === 'queue' ? 'The review queue is clear.' : 'No open reports.')); return; }
  if ((state.tab === 'queue' ? state.totalQueue : state.totalReports) > items.length) list.append(node('p', `Showing ${items.length} highest-priority items. Complete these to reveal the next items.`, 'small'));
  for (const item of items) {
    const isReport = state.tab === 'reports', type = isReport ? item.targetType : item.type, id = isReport ? item.targetId : item.id;
    const card = append(node('article', undefined, 'item'), meta(item, type), node('h2', isReport ? item.reason.replaceAll('-', ' ') : item.title),
      node('p', isReport ? item.details || 'No additional details supplied.' : `${item.reportCount} open report${item.reportCount === 1 ? '' : 's'}`),
      node('p', `Received ${time(item.createdAt)}`, 'small'), button(isReport ? 'Review reported content' : 'Inspect submission', () => act(() => inspect(type, id))));
    if (isReport) card.append(button('Resolve this report', () => reportDetail(item)));
    list.append(card);
  }
}
function field(label, value) {
  if (value === undefined || value === null || value === '') return [];
  let display = String(value);
  if (['roles', 'fandoms', 'credits', 'opportunity'].includes(label)) { try { display = JSON.stringify(JSON.parse(display), null, 2); } catch { /* Still plain text. */ } }
  return [node('dt', label), node('dd', display)];
}
function checkbox(label) {
  const input = document.createElement('input'); input.type = 'checkbox';
  return { input, element: append(node('label', undefined, 'check'), input, node('span', label)) };
}
function reasonField(label, placeholder, max = 1000) {
  const id = `reason-${Math.random().toString(36).slice(2)}`, input = document.createElement('textarea');
  input.id = id; input.maxLength = max; input.placeholder = placeholder;
  const heading = node('label', label, 'field'); heading.htmlFor = id;
  return { input, elements: [heading, input] };
}
function selectedPanel(title, status) {
  const panel = $('detail'); panel.replaceChildren();
  panel.append(append(node('div', undefined, 'detail-head'), node('h2', title), badge(status, status)));
  return panel;
}
function focusDetail() { if (window.matchMedia('(max-width: 780px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
async function inspect(type, id) {
  const item = await api(`content/${type}/${encodeURIComponent(id)}`); state.selected = item;
  renderInspection(item); focusDetail(); notice();
}
function renderInspection(item) {
  const panel = selectedPanel(item.content.title || item.content.displayName || 'Comment', item.reviewStatus);
  panel.append(node('p', `${item.type} · @${item.author.handle}`, 'small'));
  if (item.screening) panel.append(append(node('div', undefined, 'report-note'), node('strong', `Automatic screening: ${item.screening.decision}`), node('p', item.screening.codes.length ? item.screening.codes.join(' · ') : 'No additional screening codes.'), node('p', `${item.screening.provider} · ${time(item.screening.createdAt)}`, 'small')));
  if (item.reviewReason) panel.append(node('p', item.reviewReason, 'report-note'));
  if (item.type !== 'profile' && item.author.reviewStatus !== 'approved') panel.append(append(node('div', undefined, 'report-note'), node('p', `This creator’s profile is ${item.author.reviewStatus}. Their work becomes visible only when their public profile is approved too.`), item.author.visibility === 'public' && button('Review creator profile', () => act(() => inspect('profile', item.author.userId)))));
  if (item.author.suspended) panel.append(node('p', 'This creator is suspended. Approving content does not restore their account.', 'report-note'));
  const fields = node('dl');
  for (const label of ['displayName', 'handle', 'bio', 'roles', 'fandoms', 'city', 'websiteUrl', 'instagramUrl', 'title', 'character', 'fandom', 'stage', 'body', 'credits', 'opportunity']) fields.append(...field(label, item.content[label]));
  panel.append(fields);
  for (const media of item.media) {
    const figure = node('figure', undefined, 'media'), visual = document.createElement(media.kind === 'video' ? 'video' : 'img');
    if (media.kind === 'video') { visual.controls = true; visual.playsInline = true; visual.preload = 'metadata'; visual.poster = media.posterUrl; }
    else { visual.alt = media.alt || 'Submitted cosplay photo'; visual.loading = 'lazy'; }
    visual.src = media.url;
    figure.append(visual, node('figcaption', `${media.alt || 'No image description'}${media.kind === 'video' ? ` · ${media.duration}s. Watch the entire clip with sound and inspect its poster.` : ''}`));
    panel.append(figure);
  }
  for (const report of item.reports.filter(report => report.status === 'pending')) panel.append(append(node('div', undefined, 'report-note'), node('strong', `Open report: ${report.reason}`), node('p', report.details || 'No additional details.'), button('Resolve report', () => reportDetail(report, item))));
  const checks = node('fieldset', undefined, 'review-checks'); checks.append(node('legend', 'Human review confirmation'));
  const textCheck = checkbox('I read all public text, links, and credits.'), imageCheck = checkbox('I opened and reviewed every photo.'), videoCheck = checkbox('I watched every complete video with sound and reviewed its poster.');
  checks.append(textCheck.element);
  if (item.media.some(media => media.kind !== 'video')) checks.append(imageCheck.element);
  if (item.media.some(media => media.kind === 'video')) checks.append(videoCheck.element);
  panel.append(checks);
  const reason = reasonField('Decision reason', 'Record why this content meets the rules, or what needs to change.'); panel.append(...reason.elements);
  const actions = node('div', undefined, 'actions');
  const choices = item.content.moderatedAt ? [['restore', 'Restore public content', 'primary']] : item.reviewStatus === 'pending' ? [['approve', 'Approve & publish', 'primary'], ['reject', 'Reject submission', 'danger']] :
    item.reviewStatus === 'approved' && !item.content.moderatedAt ? [['takedown', 'Take down content', 'danger']] : [['restore', 'Restore public content', 'primary']];
  for (const [action, label, className] of choices) actions.append(button(label, () => act(async () => {
    if (!reason.input.value.trim()) throw new Error('Add a decision reason before continuing.');
    if (!textCheck.input.checked) throw new Error('Confirm that you reviewed the public text.');
    const result = await api(`content/${item.type}/${encodeURIComponent(item.id)}/decision`, { action, version: item.version,
      reason: reason.input.value.trim(), textReviewed: textCheck.input.checked, imagesReviewed: imageCheck.input.checked, videosReviewed: videoCheck.input.checked });
    await refresh(); state.selected = result.inspection; renderInspection(result.inspection); notice('Decision saved. Public visibility also depends on the creator’s profile and account status.');
  }), className));
  if (item.retryAvailable) actions.append(button('Retry automatic screening', () => act(async () => {
    if (!reason.input.value.trim()) throw new Error('Add a retry reason before continuing.');
    await api(`content/${item.type}/${encodeURIComponent(item.id)}/retry`, { version: item.version, reason: reason.input.value.trim() });
    await refresh(); await inspect(item.type, item.id); notice('Automatic screening has been queued again.');
  })));
  if (item.type === 'profile') panel.append(node('p', 'A profile rejection allows its creator to revise and resubmit. Suspend the creator account below when an ongoing restriction is needed.', 'small'));
  panel.append(actions, node('p', 'Content decisions do not resolve reports automatically. Record each report’s outcome separately.', 'small'));
  const account = node('section', undefined, 'account'); account.append(node('h3', 'Creator account'), node('p', `${item.author.displayName} · ${item.author.suspended ? 'Suspended' : 'Active'}`));
  if (!item.author.protectedOperator) {
    const accountReason = reasonField('Account decision reason', 'Explain the suspension or why it can be lifted.'); account.append(...accountReason.elements);
    account.append(append(node('div', undefined, 'actions'), button(item.author.suspended ? 'Restore creator account' : 'Suspend creator account', () => act(async () => {
      if (!accountReason.input.value.trim()) throw new Error('Add an account decision reason.');
      const suspended = !item.author.suspended;
      if (!window.confirm(`${suspended ? 'Suspend' : 'Restore'} @${item.author.handle}? ${suspended ? 'Their public content and collaboration access will be hidden.' : 'Previously approved public content can become visible again.'}`)) return;
      await api(`users/${encodeURIComponent(item.author.userId)}/status`, { suspended, reason: accountReason.input.value.trim(), version: item.author.version });
      await refresh(); await inspect(item.type, item.id); notice('Account status updated.');
    }), item.author.suspended ? '' : 'danger')));
  } else account.append(node('p', 'Operator account: suspension is managed outside this dashboard.', 'small'));
  panel.append(account);
  const details = node('details'); details.append(node('summary', 'Decision fingerprint & history'), node('p', 'Decisions apply only to the exact content and report state inspected here.', 'small'), node('code', item.version));
  for (const entry of item.history) details.append(historyEntry(entry)); panel.append(details);
}
function reportDetail(report, source) {
  state.selected = null;
  const panel = selectedPanel('Resolve report', report.status || 'pending');
  panel.append(node('h3', report.reason.replaceAll('-', ' ')), node('p', report.details || 'No additional details were supplied.'), node('p', `Received ${time(report.createdAt)}`, 'small'),
    node('p', 'Resolve after taking the necessary action, or dismiss after finding no violation. Closing this report never restores or approves content.', 'report-note'));
  const reason = reasonField('Resolution notes', 'Record the investigation, action taken, and outcome.', 3000); panel.append(...reason.elements);
  const actions = node('div', undefined, 'actions');
  for (const [resolution, label] of [['resolved', 'Mark resolved'], ['dismissed', 'Dismiss report']]) actions.append(button(label, () => act(async () => {
    if (!reason.input.value.trim()) throw new Error('Add resolution notes.');
    await api(`reports/${encodeURIComponent(report.id)}/resolve`, { resolution, notes: reason.input.value.trim() });
    await refresh(); panel.replaceChildren(empty('Report outcome recorded.')); notice('Report closed. Its target’s visibility has not changed.');
  }), resolution === 'resolved' ? 'primary' : ''));
  panel.append(actions, button('Inspect reported content', () => act(() => inspect(source?.type || report.targetType, source?.id || report.targetId)))); focusDetail();
}
$('refresh').addEventListener('click', () => act(async () => { await refresh(); notice('Queue refreshed.'); }));
document.querySelectorAll('[data-tab]').forEach(item => item.addEventListener('click', () => { state.tab = item.dataset.tab; renderList(); }));
$('theme').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = current === 'dark' ? 'light' : 'dark';
});
act(async () => {
  const sessionResponse = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
  if (!sessionResponse.ok) throw new Error('Could not check your Crewroom session. Refresh to try again.');
  const session = await sessionResponse.json(); state.csrf = session.csrfToken;
  const me = await api('me');
  if (!me.allowed) {
    $('access').hidden = false;
    $('access-copy').textContent = me.signedIn ? `This account has no operator access. Operator permissions must be configured for your immutable account ID: ${me.userId}. Return here after signing in to the approved account.` : 'Sign in to Crewroom in this browser, then return here and refresh. Your TestFlight session is separate from this browser session.';
    notice(); return;
  }
  $('workspace').hidden = false; $('refresh').hidden = false;
  await refresh(); notice();
});
