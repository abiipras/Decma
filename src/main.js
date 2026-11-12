import { isSupabaseConfigured, supabase, verifySupabaseConnection } from './lib/supabase.js';
import { calculateInsights, formatPercent, formatRating, periodOptions, qualityRatingLabels } from './lib/analytics.js';
import { fetchInsightsData } from './lib/insights-data.js';
import { completeReviewDraft, deleteDecisionRecord, fetchDecisionReviews, fetchDecisions, fetchReviews, saveDecisionRecord, saveReviewDraft } from './lib/journal-data.js';

const decisions = [];

const categories = ['Career', 'Finance', 'Personal', 'Education', 'Health', 'Business', 'Other'];
let activePage = 'Overview';
let query = '';
let categoryFilter = 'All categories';
let menuOpen = false;
let flashMessage = '';
let flashType = 'success';
let editingDecisionId = null;
let currentSession = null;
let authLoading = true;
let authMode = 'login';
let authMessage = '';
let authMessageType = 'error';
let authBusy = false;
let insightsPeriod = 'all';
let insightsStatus = 'idle';
let insightsResult = null;
let insightsError = '';
let insightsRequestId = 0;
let decisionsStatus = 'loading';
let decisionsError = '';
let reviewDraftId = null;
let decisionReviews = [];
let reviewsStatus = 'idle';
let reviewsError = '';

const icon = (name) => ({
  grid: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 4.8A2.8 2.8 0 0 1 7.8 2H20v18H7.8A2.8 2.8 0 0 0 5 22z"/><path d="M5 5v14a2 2 0 0 1 2-2h13M9 7h7M9 11h7"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 19V5m0 14h17M8 15l4-4 3 2 5-7"/><path d="M17 6h3v3"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2A1.7 1.7 0 0 0 5.4 8l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.2a1.7 1.7 0 0 1 3.4 0v.2A1.7 1.7 0 0 0 17 5.6l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2.7Z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
}[name] || '');

function mapDecisionRow(row) {
  const appearance = ({ Career: ['lavender', '↗'], Finance: ['mint', '◒'], Personal: ['blue', '☼'], Education: ['peach', '⌁'], Health: ['mint', '✳'], Business: ['lavender', '↗'], Other: ['blue', '✳'] })[row.category] || ['lavender', '✳'];
  const date = row.created_at ? new Date(row.created_at).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : '';
  const labels = { in_progress: 'In progress', decided: 'Decided', review_due: 'Review due', completed: 'Review complete', archived: 'Archived' };
  return { ...row, title: row.title, category: row.category, date, status: labels[row.status] || row.status, confidence: row.confidence, reviewDate: row.review_date || '', outcome: row.expected_outcome || '', chosenDecision: row.chosen_decision || '', tone: appearance[0], icon: appearance[1] };
}

async function loadJournalDecisions() {
  decisionsStatus = 'loading';
  decisionsError = '';
  render();
  try {
    const rows = await fetchDecisions();
    decisions.splice(0, decisions.length, ...rows.map(mapDecisionRow));
    decisionsStatus = 'ready';
  } catch (error) {
    decisionsError = readableInsightsError(error);
    decisionsStatus = 'error';
    decisions.splice(0, decisions.length);
  }
  render();
  if (activePage === 'Reviews' && decisionsStatus === 'ready') void loadReviews();
}

async function loadReviews() {
  reviewsStatus = 'loading';
  reviewsError = '';
  render();
  try {
    const rows = await fetchReviews();
    const decisionById = new Map(decisions.map((decision) => [decision.id, decision]));
    decisionReviews = rows.map((row) => ({ ...row, decision: decisionById.get(row.decision_id) }));
    reviewsStatus = 'ready';
  } catch (error) {
    reviewsError = readableInsightsError(error);
    reviewsStatus = 'error';
  }
  render();
}

function journalLoadingState() {
  return '<div class="insight-loading" role="status"><span class="loading-dot"></span>Loading your decisions from Supabase...</div>';
}

function journalErrorState() {
  return `<section class="insight-state error" role="alert"><h2>Your decisions could not be loaded</h2><p>${escapeAttr(decisionsError)}</p><button type="button" class="button-primary" data-journal-retry>Try again</button></section>`;
}

function decisionCard(item, showReviewAction = false) {
  return `<article class="decision-card" data-decision-card="${escapeAttr(item.id)}">
    <div class="decision-top"><span class="decision-icon ${item.tone}">${item.icon}</span><span class="status ${item.status === 'Review due' ? 'status-due' : ''}"><i></i>${escapeAttr(item.status)}</span><button class="more" aria-label="More options for ${escapeAttr(item.title)}" data-action-menu="${escapeAttr(item.title)}">···</button></div>
    <div class="decision-menu" data-menu-for="${escapeAttr(item.id)}" hidden><button data-card-action="review" data-id="${escapeAttr(item.id)}">New review</button><button data-card-action="edit" data-id="${escapeAttr(item.id)}">Edit decision</button><button data-card-action="details" data-id="${escapeAttr(item.id)}">View details</button><button class="danger-action" data-card-action="delete" data-id="${escapeAttr(item.id)}">Delete decision</button></div>
    <p class="category-label">${escapeAttr(item.category)} <span>·</span> ${escapeAttr(item.date)}</p>
    <h3>${escapeAttr(item.title)}</h3><p class="outcome">${escapeAttr(item.outcome)}</p>
    <div class="card-bottom"><div class="confidence"><span>Confidence</span><strong>${item.confidence}%</strong></div><div class="confidence-track"><span style="width:${item.confidence}%"></span></div>${showReviewAction ? `<button class="review-card-action" data-start-review="${escapeAttr(item.id)}">New review</button>` : `<button class="round-arrow" aria-label="Open decision">${icon('arrow')}</button>`}</div>
  </article>`;
}

function renderAuthLoading() {
  document.querySelector('#app').innerHTML = '<main class="auth-screen"><div class="auth-card auth-loading"><span class="brand-mark">d<span>.</span></span><p>Checking your session…</p></div></main>';
}

function renderAuthPage() {
  const registering = authMode === 'register';
  const configMessage = isSupabaseConfigured ? '' : 'Supabase is not configured. Add the project URL and publishable key to the local environment, then restart the app.';
  const message = configMessage || authMessage;
  const messageClass = configMessage || authMessageType === 'error' ? 'error' : 'success';
  document.querySelector('#app').innerHTML = `
    <main class="auth-screen">
      <section class="auth-card" aria-labelledby="auth-title">
        <a class="brand auth-brand" href="#" aria-label="Decision Journal"><span class="brand-mark">d<span>.</span></span><span class="brand-name">decision<span>journal</span></span></a>
        <div class="eyebrow">YOUR PERSONAL SPACE</div>
        <h1 id="auth-title">${registering ? 'Create your account' : 'Welcome back'}<span class="heading-period">.</span></h1>
        <p class="auth-intro">${registering ? 'Start a private journal for thoughtful decisions.' : 'Sign in to continue to your Decision Journal.'}</p>
        <form id="auth-form" class="auth-form">
          <label>Email address<input type="email" name="email" autocomplete="email" required placeholder="you@example.com" ${isSupabaseConfigured ? '' : 'disabled'}></label>
          <label>Password<input type="password" name="password" autocomplete="${registering ? 'new-password' : 'current-password'}" required placeholder="Enter your password" ${isSupabaseConfigured ? '' : 'disabled'}></label>
          <div class="auth-message ${messageClass}" role="${messageClass === 'error' ? 'alert' : 'status'}" aria-live="polite" ${message ? '' : 'hidden'}>${escapeAttr(message)}</div>
          <button class="button-primary auth-submit" type="submit" ${isSupabaseConfigured ? '' : 'disabled'}>${registering ? 'Create account' : 'Sign in'}</button>
        </form>
        <p class="auth-switch">${registering ? 'Already have an account?' : 'New to Decision Journal?'} <button type="button" data-auth-mode="${registering ? 'login' : 'register'}">${registering ? 'Sign in' : 'Create an account'}</button></p>
      </section>
      <p class="auth-footer">A calm space to think clearly and learn over time.</p>
    </main>`;

  document.querySelector('#auth-form')?.addEventListener('submit', submitAuthForm);
  document.querySelector('[data-auth-mode]')?.addEventListener('click', (event) => {
    authMode = event.currentTarget.dataset.authMode;
    authMessage = '';
    renderAuthPage();
    document.querySelector('[name="email"]')?.focus();
  });
}

function userEmail() {
  return currentSession?.user?.email || 'Account';
}

function userInitials() {
  return userEmail().trim().charAt(0).toUpperCase() || 'A';
}

function showAuthMessage(message, type = 'error') {
  authMessage = message;
  authMessageType = type;
  const output = document.querySelector('.auth-message');
  if (output) {
    if (!message) {
      output.textContent = '';
      output.hidden = true;
      return;
    }
    output.textContent = message;
    output.className = `auth-message ${type}`;
    output.setAttribute('role', type === 'error' ? 'alert' : 'status');
    output.hidden = false;
  }
}

function readableAuthError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code.includes('email_exists') || code.includes('user_already_exists') || message.includes('already registered') || message.includes('already been registered')) {
    return 'An account with this email already exists. Sign in instead, or use a different email.';
  }
  if (code.includes('email_not_confirmed') || message.includes('email not confirmed')) {
    return 'Your email has not been verified yet. Check your inbox for the confirmation link, then sign in.';
  }
  if (code.includes('weak_password') || message.includes('password should be at least') || message.includes('password is too short')) {
    return error.message || 'Choose a stronger password that meets the project requirements.';
  }
  if (code.includes('invalid_credentials') || message.includes('invalid login credentials')) {
    return 'The email or password is incorrect. Check both and try again.';
  }
  if (error?.name === 'AuthRetryableFetchError' || message.includes('fetch')) {
    return 'Could not reach Supabase. Check your internet connection and try again.';
  }
  return error?.message || 'Authentication failed. Please try again.';
}

async function submitAuthForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !supabase || authBusy) return;

  const data = new FormData(form);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  const submit = form.querySelector('[type="submit"]');
  authBusy = true;
  submit.disabled = true;
  submit.textContent = authMode === 'register' ? 'Creating account…' : 'Signing in…';
  showAuthMessage('', 'success');

  try {
    if (authMode === 'register') {
      const { data: result, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (result.session) {
        currentSession = result.session;
        authLoading = false;
        authMessage = '';
        render();
      } else {
        authMode = 'login';
        renderAuthPage();
        showAuthMessage('Account created. Check your email for a verification link before signing in.', 'success');
      }
    } else {
      const { data: result, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentSession = result.session;
      authLoading = false;
      authMessage = '';
      render();
    }
  } catch (error) {
    showAuthMessage(readableAuthError(error));
  } finally {
    authBusy = false;
    if (submit.isConnected) {
      submit.disabled = false;
      submit.textContent = authMode === 'register' ? 'Create account' : 'Sign in';
    }
  }
}

async function initializeAuthentication() {
  if (!supabase) {
    authLoading = false;
    decisionsStatus = 'error';
    decisionsError = 'Supabase is not configured.';
    render();
    return;
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    currentSession = data.session;
  } catch (error) {
    authMessage = readableAuthError(error);
  }
  authLoading = false;
  render();
  if (currentSession) await loadJournalDecisions();

  supabase.auth.onAuthStateChange((event, session) => {
    const previousUserId = currentSession?.user?.id;
    currentSession = session;
    if (previousUserId !== session?.user?.id) {
      insightsRequestId += 1;
      insightsResult = null;
      insightsStatus = 'idle';
      insightsError = '';
      decisionReviews = [];
      reviewsStatus = 'idle';
      reviewsError = '';
      if (!session) {
        decisions.splice(0, decisions.length);
        decisionsStatus = 'loading';
        decisionsError = '';
      }
    }
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || previousUserId !== session?.user?.id) {
      authBusy = false;
      render();
      if (session && previousUserId !== session.user.id) void loadJournalDecisions();
    }
  });
}

function render() {
  if (authLoading) {
    renderAuthLoading();
    return;
  }
  if (!currentSession) {
    renderAuthPage();
    return;
  }

  const visible = decisions.filter((d) => (categoryFilter === 'All categories' || d.category === categoryFilter) && `${d.title} ${d.category} ${d.outcome}`.toLowerCase().includes(query.toLowerCase()));
  const nav = [['Overview','grid'],['Decisions','book'],['Reviews','calendar'],['Insights','chart']];
  const pageContent = activePage === 'Insights'
    ? listPage(visible)
    : decisionsStatus === 'loading'
      ? journalLoadingState()
      : decisionsStatus === 'error'
        ? journalErrorState()
        : activePage === 'Overview' ? overview(visible) : listPage(visible);
  document.querySelector('#app').innerHTML = `
    <div class="app-shell ${menuOpen ? 'menu-open' : ''}">
      <aside class="sidebar">
        <a class="brand" href="#" aria-label="Decision Journal home"><span class="brand-mark">d<span>.</span></span><span class="brand-name">decision<span>journal</span></span></a>
        <div class="workspace-label">WORKSPACE</div>
        <nav class="primary-nav" aria-label="Main navigation">${nav.map(([label, glyph]) => `<button class="nav-link ${activePage === label ? 'active' : ''}" data-page="${label}">${icon(glyph)}<span>${label}</span>${label === 'Reviews' && decisions.some(d=>d.status==='Review due') ? `<b class="nav-count">${decisions.filter(d=>d.status==='Review due').length}</b>` : ''}</button>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="sidebar-tip"><span class="tip-spark" aria-hidden="true">✳</span><p><b>A little reflection<br>goes a long way.</b><small>Your next review is a chance to learn, not to judge.</small></p></div><button class="nav-link settings" data-action="settings">${icon('settings')}<span>Settings</span></button><button class="user-profile profile-button" data-action="profile"><span class="avatar">${escapeAttr(userInitials())}</span><span class="profile-identity"><b>${escapeAttr(userEmail())}</b><small>Signed in</small></span><span class="profile-menu">⌄</span></button></div>
      </aside>
      <main class="main-content">
        <header class="topbar"><button class="menu-toggle" aria-label="Toggle navigation">☰</button><div class="breadcrumb">Workspace <span>/</span> <b>${activePage}</b></div><div class="top-actions"><button class="icon-button" aria-label="Search decisions" data-action="global-search">${icon('search')}</button><span class="top-divider"></span><button class="help-button" data-action="help">? <span>Help</span></button><button class="avatar small-avatar profile-top" aria-label="Open profile" data-action="profile">${escapeAttr(userInitials())}</button></div></header>
        <div class="page-wrap">
          ${flashMessage ? `<div class="app-notice ${flashType}" role="status">${escapeAttr(flashMessage)}</div>` : ''}
          ${pageContent}
        </div>
      </main>
      <nav class="bottom-nav" aria-label="Mobile navigation">${nav.slice(0,4).map(([label,glyph])=>`<button class="${activePage===label?'active':''}" data-page="${label}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>
    </div>
    <div class="modal-backdrop" id="modal" aria-hidden="true"><section class="decision-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" aria-label="Close">×</button><div class="eyebrow">A MOMENT TO THINK</div><h2 id="modal-title">New decision</h2><p class="modal-intro">Capture the choice and what you expect to happen.</p><form id="decision-form"><label>Decision title<input name="title" required placeholder="e.g. Take the new role" maxlength="120"></label><label>Category<select name="category" required>${categories.map(c=>`<option>${c}</option>`).join('')}</select></label><label>Context<textarea name="context" rows="2" placeholder="What is happening?"></textarea></label><label>Problem to solve<textarea name="problem" rows="2" placeholder="What do you need to decide?"></textarea></label><label>Alternatives considered<textarea name="options" rows="2" placeholder="What options did you consider?"></textarea></label><label>Chosen decision<input name="chosenDecision" required placeholder="What did you choose?"></label><label>Reasoning<textarea name="reasoning" required rows="2" placeholder="Why did you choose it?"></textarea></label><label>Expected outcome<textarea name="outcome" required rows="2" placeholder="What do you expect to happen?"></textarea></label><label>Confidence <output id="confidence-value" for="confidence">50% · Moderately confident</output><input id="confidence" name="confidence" type="range" min="0" max="100" step="1" value="50" aria-describedby="confidence-hint"><span id="confidence-hint" class="range-hint"><span>0% · Not confident</span><span>100% · Very confident</span></span></label><label>Review date<input name="reviewDate" type="date" required></label><p class="form-message" id="form-message" role="alert" hidden></p><div class="modal-actions"><button type="button" class="button-quiet modal-cancel">Cancel</button><button class="button-primary" type="submit"><span id="save-label">Save decision</span> <span>→</span></button></div></form></section></div>`;

  document.querySelectorAll('[data-page]').forEach((el) => el.addEventListener('click', () => { activePage = el.dataset.page; menuOpen = false; render(); if (activePage === 'Reviews' && reviewsStatus !== 'loading') void loadReviews(); }));
  document.querySelector('.menu-toggle')?.addEventListener('click', () => { menuOpen = !menuOpen; render(); });
  document.querySelector('[data-action="settings"]')?.addEventListener('click', openSettings);
  document.querySelectorAll('[data-action="profile"]').forEach((el) => el.addEventListener('click', openProfile));
  document.querySelector('[data-action="help"]')?.addEventListener('click', openHelp);
  document.querySelector('[data-action="global-search"]')?.addEventListener('click', openGlobalSearch);
  document.querySelectorAll('[data-action-menu]').forEach((el) => el.addEventListener('click', () => {
    const menu = document.querySelector(`[data-menu-for="${CSS.escape(el.closest('[data-decision-card]').dataset.decisionCard)}"]`);
    if (menu) menu.hidden = !menu.hidden;
  }));
  document.querySelectorAll('[data-card-action]').forEach((el) => el.addEventListener('click', () => handleCardAction(el.dataset.cardAction, el.dataset.id)));
  document.querySelectorAll('[data-start-review]').forEach((el) => el.addEventListener('click', () => openReviewForm(el.dataset.startReview)));
  document.querySelectorAll('.round-arrow').forEach((el) => el.addEventListener('click', () => {
    const id = el.closest('[data-decision-card]')?.dataset.decisionCard;
    const item = decisions.find((decision) => decision.id === id);
    if (item) showPanel(item.title, `<p class="panel-copy"><b>Category:</b> ${escapeAttr(item.category)}</p><p class="panel-copy"><b>Status:</b> ${escapeAttr(item.status)}</p><p class="panel-copy"><b>Expected outcome:</b> ${escapeAttr(item.outcome)}</p><p class="panel-copy"><b>Confidence:</b> ${item.confidence}%</p>`);
  }));
  document.querySelectorAll('.new-decision').forEach((button) => button.addEventListener('click', () => openModal()));
  document.querySelector('.modal-close')?.addEventListener('click', closeModal);
  document.querySelector('.modal-cancel')?.addEventListener('click', closeModal);
  document.querySelector('#modal')?.addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.querySelector('#decision-form')?.addEventListener('submit', saveDecision);
  document.querySelector('#confidence')?.addEventListener('input', updateConfidenceLabel);
  document.querySelector('#review-form')?.addEventListener('submit', saveReview);
  document.querySelectorAll('[data-review-rating]').forEach((input) => input.addEventListener('change', updateReviewScore));
  document.querySelector('#search-input')?.addEventListener('input', (e) => { query = e.target.value; render(); const input = document.querySelector('#search-input'); input.focus(); input.setSelectionRange(query.length, query.length); });
  document.querySelector('#category-filter')?.addEventListener('change', (e) => { categoryFilter = e.target.value; render(); });
  document.querySelector('.filter-button')?.addEventListener('click', () => document.querySelector('#category-filter')?.focus());
  document.querySelector('[data-theme]')?.addEventListener('click', (e) => setTheme(e.currentTarget.dataset.theme));
  document.querySelector('#insights-period')?.addEventListener('change', (event) => {
    insightsPeriod = event.currentTarget.value;
    insightsResult = null;
    insightsStatus = 'idle';
    render();
  });
  document.querySelector('[data-insights-retry]')?.addEventListener('click', () => {
    insightsStatus = 'idle';
    render();
  });
  document.querySelector('[data-journal-retry]')?.addEventListener('click', loadJournalDecisions);
  document.querySelector('[data-reviews-retry]')?.addEventListener('click', loadReviews);
  document.querySelector('[data-insights-refresh]')?.addEventListener('click', () => {
    insightsStatus = 'idle';
    render();
  });
  if (activePage === 'Insights' && insightsStatus === 'idle') loadInsights();
}

async function loadInsights() {
  if (insightsStatus === 'loading') return;
  const requestId = ++insightsRequestId;
  insightsStatus = 'loading';
  insightsError = '';
  render();
  try {
    const rows = await fetchInsightsData(insightsPeriod);
    if (requestId !== insightsRequestId) return;
    insightsResult = calculateInsights(rows, insightsPeriod);
    insightsStatus = 'ready';
  } catch (error) {
    if (requestId !== insightsRequestId) return;
    insightsError = readableInsightsError(error);
    insightsStatus = 'error';
  }
  render();
}

function readableInsightsError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || 'Unexpected error.');
  if (code === 'PGRST205' || message.toLowerCase().includes('could not find the table')) {
    return 'Supabase could not find an analytics table. Confirm that both migrations were applied to the public schema.';
  }
  if (code === 'PGRST204' || message.toLowerCase().includes('column')) {
    return 'Supabase returned a schema mismatch. Check that the local migrations match the tables in your project.';
  }
  if (error?.name === 'AuthSessionMissingError') return 'Your login session is missing. Sign in again to load your private insights.';
  return `Could not load insights${code ? ` (${code})` : ''}: ${message}`;
}

function overview(visible) {
  const cards = visible.map(decisionCard).join('') || '<div class="empty-state">No decisions match. Try a different search or category.</div>';
  return `<section class="welcome-row"><div><div class="eyebrow">TUESDAY, NOVEMBER 10, 2026 <span class="sun">✳</span></div><h1>Good morning, Jamie<span class="heading-period">.</span></h1><p class="welcome-copy">A clearer mind starts with a moment of reflection.</p></div><button class="button-primary new-decision">${icon('plus')}<span>New decision</span></button></section>
    <section class="stats-grid" aria-label="Decision summary"><article class="stat-card"><div class="stat-heading">Total decisions <span class="stat-icon lavender">${icon('book')}</span></div><div class="stat-value">${decisions.length} <span class="trend positive">in this journal</span></div><div class="stat-note">Decisions you’ve captured</div></article><article class="stat-card"><div class="stat-heading">Active decisions <span class="stat-icon mint">◷</span></div><div class="stat-value">${decisions.filter(d=>d.status==='In progress').length} <span class="trend neutral">in progress</span></div><div class="stat-note">Still unfolding</div></article><article class="stat-card"><div class="stat-heading">Ready to review <span class="stat-icon peach">✳</span></div><div class="stat-value">${decisions.filter(d=>d.status==='Review due').length} <span class="trend attention">needs a moment</span></div><div class="stat-note">Good time to reflect</div></article><article class="stat-card"><div class="stat-heading">Reviews completed <span class="stat-icon blue">✓</span></div><div class="stat-value">${decisions.filter(d=>d.status==='Review complete').length} <span class="trend positive">completed</span></div><div class="stat-note">Of decisions reviewed</div></article></section>
    <section class="review-banner"><div class="review-symbol">✳</div><div class="review-copy"><span class="review-kicker">A MOMENT TO LOOK BACK</span><h2>${decisions.filter(d=>d.status==='Review due').length} decision${decisions.filter(d=>d.status==='Review due').length===1?' is':'s are'} ready for a review.</h2><p>Take a few minutes to see what happened and what you’ve learned.</p></div><button class="button-light" data-page="Reviews">Start a review <span>→</span></button><div class="banner-art"><span class="orb orb-one"></span><span class="orb orb-two"></span><span class="arc"></span></div></section>
    <section class="decisions-section"><div class="section-heading"><div><div class="eyebrow">YOUR THINKING, IN ONE PLACE</div><h2>Recent decisions</h2></div><button class="text-link" data-page="Decisions">View all <span>→</span></button></div>
      <div class="filter-row"><label class="search-box">${icon('search')}<input id="search-input" type="search" value="${escapeAttr(query)}" placeholder="Search your decisions..."></label><select id="category-filter" aria-label="Filter by category"><option>All categories</option>${categories.map(c=>`<option ${categoryFilter===c?'selected':''}>${c}</option>`).join('')}</select><button class="filter-button">⌘ <span>Filter</span></button></div>
      <div class="decision-grid">${cards}</div></section>
    <footer class="page-footer"><span>Small steps. Better decisions.</span><span>Made for a more thoughtful you <b>✳</b></span></footer>`;
}

function listPage(visible) {
  const title = activePage === 'Decisions' ? 'Your decisions' : activePage === 'Reviews' ? 'Review & reflect' : activePage === 'Insights' ? 'Your patterns, over time' : activePage;
  const intro = activePage === 'Decisions' ? 'A record of the choices that shape your life.' : activePage === 'Reviews' ? 'Look back with curiosity. Every outcome has something to teach.' : activePage === 'Insights' ? 'Notice what is working, and where your thinking can grow.' : '';
  if (activePage === 'Insights') return insightsPage();
  if (activePage === 'Decisions') return `<section class="welcome-row"><div><div class="eyebrow">YOUR PERSONAL SPACE</div><h1>${title}<span class="heading-period">.</span></h1><p class="welcome-copy">${intro}</p></div><button class="button-primary new-decision">${icon('plus')}<span>New decision</span></button></section><div class="filter-row"><label class="search-box">${icon('search')}<input id="search-input" type="search" value="${escapeAttr(query)}" placeholder="Search your decisions..."></label><select id="category-filter" aria-label="Filter by category"><option>All categories</option>${categories.map(c=>`<option ${categoryFilter===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="decision-grid">${visible.length ? visible.map(decisionCard).join('') : '<div class="empty-state">No decisions match your search.</div>'}</div>`;
  if (activePage === 'Reviews') return reviewsPage();
  return `<section class="welcome-row"><div><div class="eyebrow">YOUR PERSONAL SPACE</div><h1>${title}<span class="heading-period">.</span></h1><p class="welcome-copy">${intro}</p></div><button class="button-primary new-decision">${icon('plus')}<span>New decision</span></button></section><div class="placeholder-panel"><div class="placeholder-icon">${icon(activePage==='Reviews'?'calendar':activePage==='Insights'?'chart':'book')}</div><h2>${activePage==='Insights'?'Patterns will emerge as you reflect.':activePage==='Reviews'?'A good review starts with an open mind.':'Your journal is taking shape.'}</h2><p>${activePage==='Insights'?'Complete a few reviews to begin seeing your decision-making patterns.':'Capture a decision or explore the ones you have already recorded.'}</p>${activePage==='Reviews'&&visible.some(d=>d.status==='Review due')?`<div class="decision-grid review-list">${visible.filter(d=>d.status==='Review due').map(decisionCard).join('')}</div>`:`<button class="button-primary new-decision">${icon('plus')}<span>Capture a decision</span></button>`}</div>`;
}

function reviewsPage() {
  const heading = '<section class="welcome-row"><div><div class="eyebrow">YOUR PERSONAL SPACE</div><h1>Review & reflect<span class="heading-period">.</span></h1><p class="welcome-copy">Continue a draft or create a dated review. Completed reviews are permanent.</p></div></section>';
  if (reviewsStatus === 'loading' || decisionsStatus === 'loading') return `${heading}${journalLoadingState()}`;
  if (reviewsStatus === 'error') return `${heading}<section class="insight-state error" role="alert"><h2>Reviews could not be loaded</h2><p>${escapeAttr(reviewsError)}</p><button type="button" class="button-primary" data-reviews-retry>Try again</button></section>`;
  if (!decisions.length) return `${heading}<div class="empty-state">Create and save a decision before starting a review.</div>`;
  const decisionCards = decisions.map((item) => decisionCard(item, true)).join('');
  const history = decisionReviews.length
    ? `<section class="decisions-section review-history"><div class="section-heading"><div><div class="eyebrow">YOUR HISTORY</div><h2>Saved reviews</h2></div></div><div class="review-history-list">${decisionReviews.map((review) => `<article class="insight-panel"><div class="review-history-heading"><b>${escapeAttr(review.decision?.title || 'Decision')}</b><span class="status ${review.review_status === 'draft' ? 'status-due' : ''}"><i></i>${review.review_status === 'completed' ? 'Completed' : 'Draft'}</span></div><p>${escapeAttr(review.scheduled_for || review.created_at?.slice(0, 10) || 'Date not set')}</p>${review.review_status === 'draft' ? `<button class="button-quiet" data-start-review="${escapeAttr(review.decision_id)}">Continue draft</button>` : `<p>Decision Quality Score: ${review.decision_quality_score ?? '—'} / 100</p>`}</article>`).join('')}</div></section>`
    : '<div class="empty-state">No reviews saved yet. Choose a decision above to start one.</div>';
  return `${heading}<div class="decision-grid review-list">${decisionCards}</div>${history}`;
}

function insightsPage() {
  const periodSelect = `<label class="insight-period-label" for="insights-period">Period</label><select id="insights-period" class="insight-period">${periodOptions.map(([value, label]) => `<option value="${value}" ${value === insightsPeriod ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const title = `<section class="welcome-row insights-welcome"><div><div class="eyebrow">PERSONAL DECISION ANALYTICS</div><h1>Insights<span class="heading-period">.</span></h1><p class="welcome-copy">Understand your process with evidence from your own decision history.</p></div><div class="insight-controls">${periodSelect}<button type="button" class="button-quiet insight-refresh" data-insights-refresh ${insightsStatus === 'loading' ? 'disabled' : ''}>${insightsStatus === 'loading' ? 'Refreshing…' : 'Refresh data'}</button></div></section>`;
  if (insightsStatus === 'loading') return `${title}<div class="insight-loading" role="status"><span class="loading-dot"></span>Loading your private analytics from Supabase…</div><div class="insight-skeleton-grid" aria-hidden="true">${Array.from({ length: 5 }, () => '<div class="insight-skeleton"></div>').join('')}</div>`;
  if (insightsStatus === 'error') return `${title}<section class="insight-state error" role="alert"><h2>Insights could not be loaded</h2><p>${escapeAttr(insightsError)}</p><button type="button" class="button-primary" data-insights-retry>Try again</button></section>`;
  if (!insightsResult) return `${title}<section class="insight-state"><p>Sign in to load your personal analytics.</p></section>`;
  const stats = insightsResult.metrics;
  const overview = [
    ['Total Decisions', String(stats.total), 'Created during this period'],
    ['Completed Decisions', String(stats.completed), 'Status: Review complete'],
    ['Pending Reviews', String(stats.pending), 'Due and not yet reviewed, or a draft exists'],
    ['Review Completion Rate', formatPercent(stats.reviewCompletionRate), 'Of decisions with a review due'],
    ['Average Initial Confidence', stats.averageConfidence === null ? '—' : `${stats.averageConfidence.toFixed(0)}%`, `${stats.total} decision${stats.total === 1 ? '' : 's'} in this period`],
  ];
  return `${title}
    <section class="insight-section" aria-labelledby="insight-overview-title"><div class="insight-section-heading"><div><div class="eyebrow">A · OVERVIEW</div><h2 id="insight-overview-title">Decision overview</h2></div></div><div class="insight-metrics">${overview.map(([label, value, note]) => `<article class="insight-metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</div></section>
    <section class="insight-section" aria-labelledby="insight-distribution-title"><div class="insight-section-heading"><div><div class="eyebrow">B · DISTRIBUTION</div><h2 id="insight-distribution-title">Where your decisions happen</h2></div></div><div class="insight-grid-two"><article class="insight-panel"><h3>By category</h3>${renderBars(insightsResult.categoryDistribution, (item) => item.key, (item) => item.count, 'decisions', true)}</article><article class="insight-panel"><h3>By status</h3>${renderBars(insightsResult.statusDistribution.map((item) => ({ ...item, label: decisionStatusLabel(item.key) })), (item) => item.label, (item) => item.count, 'decisions')}</article></div><article class="insight-panel insight-trend-panel"><h3>Decisions over time</h3><p>Grouped by decision creation month.</p>${renderLineChart(insightsResult.decisionTrend, [{ label: 'Decisions', color: '#607d5d', value: (item) => item.count }], [0, null], 'decision count')}</article></section>
    <section class="insight-section" aria-labelledby="insight-quality-title"><div class="insight-section-heading"><div><div class="eyebrow">C · DECISION QUALITY</div><h2 id="insight-quality-title">How you evaluate decisions</h2><p>Completed reviews only. Missing ratings are excluded, never counted as zero.</p></div></div><div class="quality-summary">${insightsResult.aspectAverages.map((aspect) => `<article class="quality-metric"><span>${aspect.label}</span><strong>${formatRating(aspect.average)}</strong><small>${aspect.count} rating${aspect.count === 1 ? '' : 's'}</small></article>`).join('')}<article class="quality-metric quality-score-metric"><span>Decision Quality Score</span><strong>${insightsResult.metrics.averageDecisionQualityScore === null ? '—' : `${insightsResult.metrics.averageDecisionQualityScore.toFixed(0)} / 100`}</strong><small>Separate from outcome result</small></article></div>${insightsResult.strongest ? `<div class="insight-observation"><b>Current strength:</b> ${insightsResult.strongest.label} (${formatRating(insightsResult.strongest.average)}). <b>Possible growth area:</b> ${insightsResult.growthArea.label} (${formatRating(insightsResult.growthArea.average)}). These compare self-ratings, not outcomes.</div>` : ''}<article class="insight-panel insight-trend-panel"><h3>Quality ratings over review dates</h3><p>Uses each review’s scheduled date. Ratings are on a 1–5 scale.</p>${renderQualityTrend(insightsResult.qualityTrend)}</article></section>
    <section class="insight-section" aria-labelledby="insight-outcomes-title"><div class="insight-section-heading"><div><div class="eyebrow">D · CONFIDENCE & OUTCOMES</div><h2 id="insight-outcomes-title">Confidence beside reported outcomes</h2><p>Confidence is your initial confidence rating; it is not a probability of success.</p></div></div><div class="insight-grid-two"><article class="insight-panel"><h3>Initial confidence by reported outcome</h3>${renderBars(insightsResult.outcomeConfidence.map((item) => ({ ...item, value: item.averageConfidence, display: item.averageConfidence === null ? '—' : `${item.averageConfidence.toFixed(0)}%` })), (item) => item.label, (item) => item.value || 0, 'average confidence', false, (item) => item.display, 100)}<p class="insight-footnote">Outcome labels come from the user’s review reflection. They are not objective success measurements.</p></article><article class="insight-panel"><h3>Confidence distribution</h3>${renderBars(insightsResult.confidenceBuckets, (item) => item.label, (item) => item.count, 'decisions')}</article></div><article class="insight-panel insight-trend-panel"><h3>Reported outcome mix</h3>${renderBars(insightsResult.outcomeMix, (item) => item.label, (item) => item.count, 'completed reviews')}</article><article class="insight-panel insight-trend-panel"><h3>Confidence and outcome reports over time</h3><p>Confidence is the initial rating. Outcome share is self-reported “better than” or “as expected”; “too early” is excluded.</p>${renderLineChart(insightsResult.confidenceOutcomeTrend, [{ label: 'Average initial confidence (%)', color: '#607d5d', value: (item) => item.averageConfidence }, { label: 'Better/as expected reports (%)', color: '#c19968', value: (item) => item.reportedFavorableShare }], [0, 100], 'confidence and self-reported outcome share')}</article></section>
    <section class="insight-section" aria-labelledby="insight-profile-title"><div class="insight-section-heading"><div><div class="eyebrow">E · REFLECTION PROFILE</div><h2 id="insight-profile-title">My Decision Profile</h2><p>Observed tendencies require repeated, direct evidence. This is not a diagnosis or a permanent personality label.</p></div></div>${renderProfileEvidence(insightsResult.metrics.completedReviewCount)}</section>
    <section class="insight-section" aria-labelledby="insight-learning-title"><div class="insight-section-heading"><div><div class="eyebrow">F · LEARNING PATTERNS</div><h2 id="insight-learning-title">Personal Learning Patterns</h2><p>Patterns appear only when at least three completed reviews support them.</p></div></div>${renderLearningPatterns(insightsResult.learningPatterns)}</section>
    <p class="insight-data-note">Insights are calculated from your signed-in account’s Supabase rows. Decision metrics use created date; review charts use scheduled review date. Every statistic is recalculated when loaded.</p>`;
}

function decisionStatusLabel(status) {
  return ({ in_progress: 'In progress', decided: 'Decided', review_due: 'Review due', completed: 'Review complete', archived: 'Archived' })[status] || status;
}

function renderBars(items, labelFn, valueFn, unit, showZeros = false, displayFn = null, fixedMax = null) {
  if (!items.length || items.every((item) => !valueFn(item))) return '<div class="insight-empty">No records in this period yet.</div>';
  const rows = showZeros ? items : items.filter((item) => valueFn(item) > 0);
  const max = fixedMax || Math.max(1, ...rows.map(valueFn));
  return `<div class="insight-bars">${rows.map((item) => {
    const value = valueFn(item);
    const display = displayFn ? displayFn(item) : `${value} ${unit}`;
    return `<div class="insight-bar-row"><div class="insight-bar-label"><span>${escapeAttr(labelFn(item))}</span><b>${escapeAttr(display)}</b></div><div class="insight-bar-track" role="img" aria-label="${escapeAttr(labelFn(item))}: ${escapeAttr(display)}"><span style="width:${Math.max(0, Math.min(100, value / max * 100))}%"></span></div></div>`;
  }).join('')}</div>`;
}

function renderLineChart(rows, series, domain, axisLabel) {
  if (!rows.length) return '<div class="insight-empty">There is not enough dated data to draw this trend yet.</div>';
  const values = rows.flatMap((row) => series.map((item) => item.value(row))).filter((value) => Number.isFinite(value));
  if (!values.length) return '<div class="insight-empty">There is not enough rating data to draw this trend yet.</div>';
  const min = domain[0] === null ? Math.min(0, ...values) : domain[0];
  const max = domain[1] === null ? Math.max(min + 1, ...values) : domain[1];
  const width = 720, height = 250, left = 44, right = 14, top = 18, bottom = 205;
  const x = (index) => rows.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (rows.length - 1);
  const y = (value) => bottom - ((value - min) / (max - min || 1)) * (bottom - top);
  const grid = [0, 1, 2, 3].map((index) => {
    const value = min + (max - min) * index / 3;
    const pos = y(value);
    return `<line x1="${left}" y1="${pos}" x2="${width-right}" y2="${pos}" class="chart-gridline"/><text x="${left-8}" y="${pos+4}" text-anchor="end" class="chart-axis-label">${Number.isInteger(value) ? value : value.toFixed(1)}</text>`;
  }).join('');
  const paths = series.map((item) => {
    const coords = rows.map((row, index) => ({ x: x(index), y: item.value(row) === null ? null : y(item.value(row)), value: item.value(row) })).filter((point) => point.y !== null && Number.isFinite(point.y));
    if (!coords.length) return '';
    const path = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${coords.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="${item.color}"><title>${escapeAttr(item.label)}: ${point.value.toFixed(1)}</title></circle>`).join('')}`;
  }).join('');
  const labels = rows.map((row, index) => `<text x="${x(index)}" y="${bottom+22}" text-anchor="middle" class="chart-axis-label">${escapeAttr(row.label)}</text>`).join('');
  const legend = series.map((item) => `<span><i style="background:${item.color}"></i>${escapeAttr(item.label)}</span>`).join('');
  return `<div class="insight-chart-wrap"><svg class="insight-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(axisLabel)} line chart">${grid}${paths}${labels}</svg><div class="chart-legend">${legend}</div></div>`;
}

function renderQualityTrend(rows) {
  if (!rows.length) return '<div class="insight-empty">Completed reviews with dated ratings will appear here. No missing rating is treated as zero.</div>';
  const series = qualityRatingLabels.map(([field, label], index) => ({
    label,
    color: ['#607d5d', '#91a88c', '#c19968', '#7c8397', '#b47a6c'][index],
    value: (row) => row.values[index],
  }));
  return renderLineChart(rows, series, [1, 5], 'average quality rating');
}

function renderProfileEvidence(completedCount) {
  if (completedCount < 10) {
    return `<div class="profile-evidence-state"><span class="profile-count">${completedCount} / 10</span><div><b>More completed reviews are needed.</b><p>We require at least 10 completed reviews before showing observed tendencies. Current reviews record quality ratings and reflections, but do not directly measure all four profile dimensions.</p></div></div>`;
  }
  return '<div class="profile-evidence-state"><span class="profile-count">10+</span><div><b>The review count is sufficient, but the profile evidence is not.</b><p>The current schema does not directly record analytical versus intuitive style, risk preference, deliberation pace, or expectation style. Quality ratings cannot safely stand in for those traits, so this profile is withheld until direct evidence is collected.</p></div></div>';
}

function renderLearningPatterns(patterns) {
  if (!patterns.length) return '<div class="insight-empty">No repeatable pattern is supported yet. At least three completed reviews must support a pattern before it appears here.</div>';
  return `<div class="learning-patterns">${patterns.map((pattern) => `<article class="learning-pattern"><div class="pattern-evidence">${pattern.count}<small>supporting reviews</small></div><div><h3>${escapeAttr(pattern.title)}</h3><p>${escapeAttr(pattern.description)}</p></div></article>`).join('')}</div>`;
}

function escapeAttr(value) { return value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'); }
function openModal(id = null) {
  editingDecisionId = id;
  const item = id ? decisions.find((decision) => decision.id === id) : null;
  const modal = document.querySelector('#modal');
  modal.querySelector('#modal-title').textContent = item ? 'Edit decision' : 'New decision';
  modal.querySelector('.modal-intro').textContent = item ? 'Update your thinking. Your confidence can change as you learn.' : 'Capture the choice and what you expect to happen.';
  modal.querySelector('#save-label').textContent = item ? 'Save changes' : 'Save decision';
  const form = modal.querySelector('#decision-form');
  form.reset();
  const fields = ['title', 'category', 'context', 'problem', 'options', 'chosenDecision', 'reasoning', 'outcome'];
  fields.forEach((name) => { if (item) form.elements[name].value = item[name] || (name === 'category' ? categories[0] : ''); });
  form.elements.confidence.value = item ? item.confidence : 50;
  form.elements.reviewDate.value = item?.reviewDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  updateConfidenceLabel();
  const message = modal.querySelector('#form-message');
  message.hidden = true;
  message.textContent = '';
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  form.elements.title.focus();
}

function ratingSelect(name, label) {
  return `<label>${label}<select name="${name}" data-review-rating required><option value="">Choose a rating</option>${[1,2,3,4,5].map((score)=>`<option value="${score}">${score} / 5</option>`).join('')}</select></label>`;
}

async function openReviewForm(decisionId) {
  const decision = decisions.find((item) => item.id === decisionId);
  if (!decision) return;
  let existingDraft = null;
  try {
    const existingReviews = await fetchDecisionReviews(decisionId);
    existingDraft = existingReviews.find((review) => review.review_status === 'draft') || null;
  } catch (error) {
    showPanel('Could not open review', `<p class="panel-copy">${escapeAttr(readableInsightsError(error))}</p>`);
    return;
  }
  reviewDraftId = existingDraft?.id || null;
  const modal = document.querySelector('#modal');
  const panel = modal.querySelector('.decision-modal');
  const today = new Date().toISOString().slice(0, 10);
  panel.innerHTML = `<button class="modal-close" aria-label="Close">×</button><div class="eyebrow">REVIEWING A DECISION</div><h2 id="modal-title">${escapeAttr(decision.title)}</h2><p class="modal-intro">A review is a snapshot in time. Future reviews will be saved as separate history entries.</p><form id="review-form" data-decision-id="${escapeAttr(decision.id)}"><label>Review date<input name="scheduled_for" type="date" value="${today}" required></label>
    <fieldset class="review-fieldset"><legend>1. Expected vs actual outcome</legend><label>Expected outcome at this review<textarea name="expected_outcome_at_review" required rows="2">${escapeAttr(decision.outcome || '')}</textarea></label><label>What actually happened?<textarea name="actual_outcome" required rows="3" placeholder="Describe the outcome so far"></textarea></label><label>Outcome result<select name="outcome_result" required><option value="">Choose an outcome</option><option value="better_than_expected">Better than expected</option><option value="as_expected">As expected</option><option value="worse_than_expected">Worse than expected</option><option value="too_early_to_tell">Too early to tell</option></select></label><label>Reflection<textarea name="outcome_reflection" required rows="2" placeholder="What does the comparison tell you?"></textarea></label></fieldset>
    <fieldset class="review-fieldset"><legend>2. Decision quality assessment</legend><p class="rating-scale-hint">Rate each area from 1 (low) to 5 (high). This score is separate from the outcome result.</p>${ratingSelect('information_quality_rating','Information quality')}${ratingSelect('alternative_evaluation_rating','Alternative evaluation')}${ratingSelect('risk_assessment_rating','Risk assessment')}${ratingSelect('reasoning_quality_rating','Reasoning quality')}<label>Decision quality reflection<textarea name="decision_quality_reflection" required rows="2" placeholder="How sound was the thinking with the information available then?"></textarea></label><output id="review-score-preview" class="score-preview">Decision Quality Score: — / 100</output></fieldset>
    <fieldset class="review-fieldset"><legend>3. Execution evaluation</legend>${ratingSelect('execution_quality_rating','Execution quality')}<label>Execution reflection<textarea name="execution_reflection" required rows="2" placeholder="What helped or hindered the follow-through?"></textarea></label></fieldset>
    <fieldset class="review-fieldset"><legend>4. Biases & assumptions</legend><label>What assumptions or biases may have shaped the decision?<textarea name="bias_assumption_reflection" required rows="3" placeholder="What did you assume? What might you have overlooked?"></textarea></label></fieldset>
    <fieldset class="review-fieldset"><legend>5. Lessons learned</legend><label>What did you learn?<textarea name="lessons_learned" required rows="3" placeholder="Record a lesson you can use again"></textarea></label></fieldset>
    <fieldset class="review-fieldset"><legend>6. Next action</legend><label>Choose a next action<select name="next_action" required><option value="">Choose an action</option><option value="continue">Continue</option><option value="adjust">Adjust</option><option value="reverse">Reverse</option><option value="abandon">Abandon</option><option value="gather_more_information">Gather More Information</option></select></label><label>Why this action?<textarea name="next_action_notes" required rows="2" placeholder="What will you do next, and why?"></textarea></label></fieldset>
    <p class="form-message" id="review-form-message" role="alert" tabindex="-1" hidden></p><div class="modal-actions"><button type="button" class="button-quiet modal-cancel">Cancel</button><button type="button" class="button-quiet" data-save-review-draft>Save draft</button><button class="button-primary" type="submit">Complete review <span>→</span></button></div></form>`;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  panel.querySelectorAll('.modal-close, .modal-cancel').forEach((button) => button.addEventListener('click', closeModal));
  panel.querySelector('#review-form').addEventListener('submit', saveReview);
  panel.querySelector('[data-save-review-draft]')?.addEventListener('click', saveReviewDraftAction);
  panel.querySelectorAll('[data-review-rating]').forEach((input) => input.addEventListener('change', updateReviewScore));
  if (existingDraft) {
    const form = panel.querySelector('#review-form');
    for (const [name, value] of Object.entries(existingDraft)) {
      if (form.elements[name] && value !== null) form.elements[name].value = value;
    }
    updateReviewScore();
  }
  panel.querySelector('#review-form [name="scheduled_for"]').focus();
}

function updateReviewScore() {
  const form = document.querySelector('#review-form');
  const output = document.querySelector('#review-score-preview');
  if (!form || !output) return;
  const names = ['information_quality_rating','alternative_evaluation_rating','risk_assessment_rating','reasoning_quality_rating','execution_quality_rating'];
  const values = names.map((name) => Number(form.elements[name].value));
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) {
    output.textContent = 'Decision Quality Score: — / 100';
    return;
  }
  const score = Math.round(((values.reduce((sum, value) => sum + value, 0) / values.length - 1) / 4) * 100);
  output.textContent = `Decision Quality Score: ${score} / 100`;
}

function collectReviewPayload(form) {
  const data = new FormData(form);
  const textFields = [
    'expected_outcome_at_review', 'actual_outcome', 'outcome_reflection',
    'decision_quality_reflection', 'execution_reflection', 'bias_assumption_reflection',
    'lessons_learned', 'next_action_notes',
  ];
  const payload = Object.fromEntries(textFields.map((name) => [name, String(data.get(name) || '').trim()]));
  payload.scheduled_for = String(data.get('scheduled_for') || '') || null;
  payload.outcome_result = String(data.get('outcome_result') || '') || null;
  payload.next_action = String(data.get('next_action') || '') || null;
  for (const name of ['information_quality_rating', 'alternative_evaluation_rating', 'risk_assessment_rating', 'reasoning_quality_rating', 'execution_quality_rating']) {
    const value = String(data.get(name) || '');
    payload[name] = value ? Number(value) : null;
  }
  return payload;
}

async function saveReviewDraftAction(event) {
  const form = document.querySelector('#review-form');
  const message = document.querySelector('#review-form-message');
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Saving draft…';
  try {
    const row = await saveReviewDraft(form.dataset.decisionId, collectReviewPayload(form), reviewDraftId);
    reviewDraftId = row.id;
    const index = decisionReviews.findIndex((review) => review.id === row.id);
    if (index >= 0) decisionReviews[index] = { ...row, decision: decisions.find((decision) => decision.id === row.decision_id) };
    else decisionReviews.unshift({ ...row, decision: decisions.find((decision) => decision.id === row.decision_id) });
    message.textContent = 'Draft saved to Supabase. You can continue it from another device.';
    message.hidden = false;
  } catch (error) {
    message.textContent = `Could not save draft: ${readableInsightsError(error)}`;
    message.hidden = false;
    message.focus();
  } finally {
    button.disabled = false;
    button.textContent = 'Save draft';
  }
}

async function saveReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector('#review-form-message');
  const submit = form.querySelector('[type="submit"]');
  const ratings = [...form.querySelectorAll('[data-review-rating]')].map((input) => Number(input.value));
  const validRatings = ratings.length === 5 && ratings.every((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5);
  if (!form.reportValidity() || !validRatings) {
    message.textContent = 'Complete each section and choose a rating from 1 to 5 for every quality area.';
    message.hidden = false;
    message.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Completing review...';
  try {
    const draft = await saveReviewDraft(form.dataset.decisionId, collectReviewPayload(form), reviewDraftId);
    reviewDraftId = draft.id;
    await completeReviewDraft(draft.id);
    flashMessage = 'Review completed and saved to your account.';
    flashType = 'success';
    decisionReviews.unshift({ ...draft, review_status: 'completed', decision: decisions.find((decision) => decision.id === draft.decision_id) });
    closeModal();
    reviewsStatus = 'idle';
    if (activePage === 'Reviews') void loadReviews();
  } catch (error) {
    message.textContent = `Could not complete the review. Your draft may have been saved; you can reopen it and try again. ${readableInsightsError(error)}`;
    message.hidden = false;
    message.focus();
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      submit.innerHTML = 'Complete review <span>&rarr;</span>';
    }
  }
}
function closeModal() { const modal=document.querySelector('#modal'); modal.classList.remove('visible'); modal.setAttribute('aria-hidden','true'); render(); }
function updateConfidenceLabel() {
  const slider = document.querySelector('#confidence');
  const output = document.querySelector('#confidence-value');
  if (!slider || !output) return;
  const value = Number(slider.value);
  const description = value === 0 ? 'Not confident' : value === 100 ? 'Very confident' : value === 50 ? 'Moderately confident' : 'Confidence level';
  output.value = `${value}% · ${description}`;
  output.textContent = output.value;
}

function showFormError(message) {
  const output = document.querySelector('#form-message');
  output.textContent = message;
  output.hidden = false;
  output.focus?.();
}

async function saveDecision(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const confidence = Number(data.get('confidence'));
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    showFormError('Confidence must be a whole number from 0 to 100.');
    return;
  }
  const existing = decisions.find((decision) => decision.id === editingDecisionId);
  const payload = {
    title: String(data.get('title') || '').trim(),
    category: String(data.get('category') || ''),
    context: String(data.get('context') || '').trim(),
    problem: String(data.get('problem') || '').trim(),
    options: String(data.get('options') || '').trim(),
    chosen_decision: String(data.get('chosenDecision') || '').trim(),
    reasoning: String(data.get('reasoning') || '').trim(),
    expected_outcome: String(data.get('outcome') || '').trim(),
    confidence,
    review_date: String(data.get('reviewDate') || ''),
    status: ({ 'In progress': 'in_progress', 'Review due': 'review_due', 'Review complete': 'completed', Decided: 'decided', Archived: 'archived' })[existing?.status] || 'in_progress',
  };
  try {
    const saved = mapDecisionRow(await saveDecisionRecord(payload, existing?.id || null));
    const index = decisions.findIndex((decision) => decision.id === saved.id);
    if (index >= 0) decisions[index] = saved;
    else decisions.unshift(saved);
    editingDecisionId = null;
    activePage = 'Decisions';
    query = '';
    categoryFilter = 'All categories';
    flashType = 'success';
    flashMessage = 'Decision saved to your account.';
    decisionsStatus = 'ready';
    closeModal();
  } catch (error) {
    showFormError(`Could not save this decision: ${readableInsightsError(error)}`);
  }
}
function showPanel(title, content) {
  const modal = document.querySelector('#modal');
  const panel = modal.querySelector('.decision-modal');
  panel.innerHTML = `<button class="modal-close" aria-label="Close">×</button><div class="eyebrow">DECISION JOURNAL</div><h2 id="modal-title">${escapeAttr(title)}</h2><div class="panel-content">${content}</div><div class="modal-actions"><button class="button-primary modal-close-action">Done</button></div>`;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  panel.querySelectorAll('.modal-close, .modal-close-action').forEach((button) => button.addEventListener('click', closeModal));
}

function openHelp() {
  showPanel('A little help', '<p class="panel-copy">Create a decision and save it to your account. Your saved decisions and reviews are loaded from Supabase when you sign in. Choose <b>New review</b> to save a draft or complete a review.</p><p class="panel-copy">Completed reviews are permanent. Draft reviews can be continued later from another device.</p>');
}

function openSettings() {
  const theme = localStorage.getItem('decision-journal-theme') || 'light';
  const connectionStatus = isSupabaseConfigured ? 'Connection settings found. You can test the project endpoint below.' : 'Add the Supabase URL and publishable key to .env.local, then restart Vite.';
  showPanel('Settings', `<p class="panel-copy">Choose how the journal looks on this device.</p><div class="theme-options"><button class="theme-choice ${theme==='light'?'selected':''}" data-theme="light">☀ Light</button><button class="theme-choice ${theme==='dark'?'selected':''}" data-theme="dark">☾ Dark</button></div><p class="settings-note">Theme is saved in this browser.</p><hr class="settings-rule"><p class="settings-note" id="supabase-status">${connectionStatus}</p><button class="button-quiet connection-test" id="test-supabase-connection" ${isSupabaseConfigured ? '' : 'disabled'}>Test Supabase connection</button>`);
  document.querySelectorAll('[data-theme]').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.theme)));
  document.querySelector('#test-supabase-connection')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = document.querySelector('#supabase-status');
    button.disabled = true;
    button.textContent = 'Checking…';
    status.textContent = 'Checking the project endpoint…';
    try {
      await verifySupabaseConnection();
      status.textContent = 'Connected to Supabase Auth. This test checks API health, not database table access.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Test Supabase connection';
    }
  });
}

function setTheme(theme) {
  document.body.classList.toggle('dark-theme', theme === 'dark');
  localStorage.setItem('decision-journal-theme', theme);
  openSettings();
}

function openProfile() {
  showPanel('Your account', `<div class="profile-summary"><span class="avatar">${escapeAttr(userInitials())}</span><div><b>${escapeAttr(userEmail())}</b><small>Signed in with Supabase Auth</small></div></div><p class="panel-copy">Your account session is saved in this browser so you can return without signing in again.</p><button class="button-quiet account-signout" type="button" id="account-signout">Sign out</button>`);
  document.querySelector('#account-signout')?.addEventListener('click', signOut);
}

async function signOut(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Signing out…';
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Sign out';
    showPanel('Sign out failed', `<p class="panel-copy">${escapeAttr(readableAuthError(error))}</p>`);
  }
}

function openGlobalSearch() {
  activePage = 'Decisions';
  render();
  const input = document.querySelector('#search-input');
  input?.focus();
  input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleCardAction(action, id) {
  const item = decisions.find((decision) => decision.id === id);
  if (!item) return;
  if (action === 'review') {
    openReviewForm(item.id);
  } else if (action === 'edit') {
    openModal(item.id);
  } else if (action === 'details') {
    showPanel(item.title, `<p class="panel-copy"><b>Category:</b> ${escapeAttr(item.category)}</p><p class="panel-copy"><b>Status:</b> ${escapeAttr(item.status)}</p><p class="panel-copy"><b>Expected outcome:</b> ${escapeAttr(item.outcome)}</p><p class="panel-copy"><b>Confidence:</b> ${item.confidence}%</p><p class="panel-copy"><b>Review date:</b> ${escapeAttr(item.reviewDate || 'Not set')}</p>`);
  } else if (action === 'delete' && window.confirm(`Delete “${item.title}” and its related reviews? This cannot be undone.`)) {
    try {
      await deleteDecisionRecord(item.id);
      decisions.splice(decisions.indexOf(item), 1);
      decisionReviews = decisionReviews.filter((review) => review.decision_id !== item.id);
      flashMessage = 'Decision and its reviews were deleted.';
      flashType = 'success';
      render();
    } catch (error) {
      flashMessage = `Could not delete decision: ${readableInsightsError(error)}`;
      flashType = 'error';
      render();
    }
  }
}

if (localStorage.getItem('decision-journal-theme') === 'dark') document.body.classList.add('dark-theme');
initializeAuthentication();
