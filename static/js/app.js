const State = {
  inventory: [],
  currentScreen: 'dashboard',
  detailItemId: null,
  scanData: null,
  user: null,
  authMode: 'login',
};
const CLAIM_VALUE_CONFIDENCE_THRESHOLD = 80;

function itemQuantity(item) {
  return Number(item?.quantity || 1);
}

function itemTotalValue(item) {
  return Number(item?.val || 0) * itemQuantity(item);
}

function isTrackedItem(item) {
  return item?.coverage_status !== 'excluded' && Number(item?.val || 0) > 0;
}

function isClaimEligible(item) {
  return isTrackedItem(item) && item?.coverage_status !== 'review' && Number(item?.conf || 0) >= CLAIM_VALUE_CONFIDENCE_THRESHOLD;
}

function claimEligibleItems() {
  return State.inventory.filter(isClaimEligible);
}

function trackedItems() {
  return State.inventory.filter(isTrackedItem);
}

function fmt(v) {
  return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function totalVal() {
  return claimEligibleItems().reduce((sum, item) => sum + itemTotalValue(item), 0);
}

function latestInventoryTimestamp() {
  const stamps = trackedItems()
    .map((item) => item.updated_at || item.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  return stamps.length ? new Date(Math.max(...stamps)) : null;
}

function relativeTimeFrom(date) {
  if (!date) return '0 items tracked';

  const diffMs = Math.max(0, Date.now() - date.getTime());
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'Updated just now';
  if (diffMin < 60) return `Updated ${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Updated ${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `Updated ${diffDay}d ago`;
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function itemThumbHTML(item, className = 'item-thumb') {
  if (item.image_url) {
    return `<div class="${className}"><img src="${escapeHTML(item.image_url)}" alt="${escapeHTML(item.name)}" class="thumb-image"/></div>`;
  }
  return `<div class="${className}">${escapeHTML(item.emoji || '📦')}</div>`;
}

function itemRowHTML(item) {
  const qty = itemQuantity(item);
  const estimateOnly = !isClaimEligible(item);
  const reviewBadge = estimateOnly
    ? '<span class="tag tag-amber">Estimate only *</span>'
    : '';
  return `
    <div class="item-row" data-id="${item.id}">
      ${itemThumbHTML(item)}
      <div class="item-info">
        <div class="item-name">${escapeHTML(item.name)}${estimateOnly ? ' *' : ''}</div>
        <div class="item-meta">
          <span class="cat-badge ${catClass(item.cat)}">${escapeHTML(item.cat)}</span>
          ${qty > 1 ? `<span class="tag tag-blue">Qty ${qty}</span>` : ''}
          ${reviewBadge}
          <span style="font-size:11px;color:var(--text3)">${escapeHTML(item.date)}</span>
        </div>
      </div>
      <div class="item-val">
        <div class="item-price">${fmt(itemTotalValue(item))}</div>
        <div class="item-range">${qty > 1 ? `${qty} item total` : 'Estimated value'}</div>
      </div>
    </div>`;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;

  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || 'Request failed.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function setAuthStatus(message = '', type = 'neutral') {
  const el = document.getElementById('auth-status');
  if (!el) return;

  if (!message) {
    el.style.display = 'none';
    el.textContent = '';
    el.className = 'auth-status';
    return;
  }

  el.style.display = 'block';
  el.textContent = message;
  el.className = `auth-status auth-status-${type}`;
}

function updateAccountUI() {
  const emailEl = document.getElementById('account-email');
  const metaEl = document.getElementById('account-meta');
  const authBtn = document.getElementById('btn-account-auth');
  const logoutBtn = document.getElementById('btn-account-logout');

  if (!emailEl || !metaEl || !authBtn || !logoutBtn) return;

  if (State.user) {
    emailEl.textContent = 'Signed in';
    metaEl.textContent = State.user.email;
    authBtn.textContent = 'Change Account';
    logoutBtn.style.display = 'inline-flex';
  } else {
    emailEl.textContent = 'Not signed in';
    metaEl.textContent = 'Create an account to keep your inventory and images across logins.';
    authBtn.textContent = 'Sign In';
    logoutBtn.style.display = 'none';
  }
}

function totalTrackedUnits() {
  return trackedItems().reduce((sum, item) => sum + itemQuantity(item), 0);
}

function catClass(cat) {
  const map = {
    Electronics: 'cat-electronics',
    Furniture: 'cat-furniture',
    Appliances: 'cat-appliances',
  };
  return map[cat] || 'cat-other';
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function updateAuthModal() {
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const confirmWrap = document.getElementById('auth-confirm-wrap');
  const submitBtn = document.getElementById('btn-auth-submit');
  const passwordInput = document.getElementById('auth-password');

  document.querySelectorAll('.auth-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.authMode === State.authMode);
  });

  if (State.authMode === 'register') {
    title.textContent = 'Create Account';
    subtitle.textContent = 'Use your email to keep saved items, images, and valuations tied to your account.';
    confirmWrap.style.display = 'block';
    submitBtn.textContent = 'Create Account';
    passwordInput.autocomplete = 'new-password';
  } else {
    title.textContent = 'Sign In';
    subtitle.textContent = 'Sign back in to restore your saved inventory, images, and valuation history.';
    confirmWrap.style.display = 'none';
    submitBtn.textContent = 'Sign In';
    passwordInput.autocomplete = 'current-password';
  }
}

function openAuthModal(mode = 'login') {
  State.authMode = mode;
  updateAuthModal();
  setAuthStatus('');
  document.getElementById('auth-modal').style.display = 'flex';
}

function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
  setAuthStatus('');
}

async function loadInventory() {
  if (!State.user) {
    State.inventory = [];
    return [];
  }

  const data = await apiFetch('/api/items');
  State.inventory = data.items || [];
  return State.inventory;
}

async function hydrateSession() {
  try {
    const data = await apiFetch('/api/auth/me');
    State.user = data.user;
    updateAccountUI();
    if (State.user) {
      await loadInventory();
    }
  } catch (error) {
    console.error('Session restore failed:', error);
    State.user = null;
  }

  refreshCurrentScreen();
}

async function submitAuthForm(event) {
  event.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const confirm = document.getElementById('auth-confirm').value;
  const submitBtn = document.getElementById('btn-auth-submit');

  if (State.authMode === 'register' && password !== confirm) {
    setAuthStatus('Passwords do not match.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = State.authMode === 'register' ? 'Creating...' : 'Signing in...';
  setAuthStatus(State.authMode === 'register' ? 'Creating your account...' : 'Signing you in...', 'neutral');

  try {
    const endpoint = State.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const data = await apiFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    State.user = data.user;
    updateAccountUI();
    await loadInventory();
    closeAuthModal();
    document.getElementById('auth-form').reset();
    refreshCurrentScreen();
  } catch (error) {
    setAuthStatus(error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = State.authMode === 'register' ? 'Create Account' : 'Sign In';
  }
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('Logout failed:', error);
  }

  State.user = null;
  State.inventory = [];
  State.detailItemId = null;
  updateAccountUI();
  closeAuthModal();
  goTo('dashboard');
}

function goTo(screen) {
  document.querySelectorAll('.screen').forEach((section) => section.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.remove('active'));

  const section = document.getElementById(`screen-${screen}`);
  if (section) section.classList.add('active');

  const nav = document.querySelector(`.nav-item[data-screen="${screen}"]`);
  if (nav) nav.classList.add('active');

  State.currentScreen = screen;
  refreshCurrentScreen();
}

function refreshCurrentScreen() {
  if (State.currentScreen === 'dashboard') renderDashboard();
  if (State.currentScreen === 'inventory') renderInventory();
  if (State.currentScreen === 'analytics') renderAnalytics();
  if (State.currentScreen === 'report') renderReport();
  if (State.currentScreen === 'scan' && typeof syncScanScreen === 'function') syncScanScreen();
}

async function deleteCurrentItem() {
  if (!State.detailItemId || !State.user) return;

  try {
    await apiFetch(`/api/items/${State.detailItemId}`, { method: 'DELETE' });
    State.inventory = State.inventory.filter((item) => item.id !== State.detailItemId);
    State.detailItemId = null;
    goTo('inventory');
  } catch (error) {
    alert(`Delete failed: ${error.message}`);
  }
}

async function saveCondition(itemId, condition) {
  if (!State.user) return;

  try {
    const data = await apiFetch(`/api/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition }),
    });

    State.inventory = State.inventory.map((item) => (item.id === itemId ? data.item : item));
  } catch (error) {
    console.error('Condition update failed:', error);
  }
}

async function downloadPDF() {
  const reportItems = trackedItems();
  if (!reportItems.length) {
    alert('Add at least one item before downloading a report.');
    return;
  }

  document.getElementById('pdf-modal').style.display = 'none';

  try {
    const response = await fetch('/api/generate-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: reportItems,
        total: claimEligibleItems().reduce((sum, item) => sum + itemTotalValue(item), 0),
      }),
    });

    if (!response.ok) throw new Error('PDF generation failed.');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'homevault-report.pdf';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(`PDF download failed: ${error.message}`);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.nav-item[data-screen]').forEach((el) => {
    el.addEventListener('click', () => goTo(el.dataset.screen));
  });

  document.addEventListener('click', (event) => {
    const gotoBtn = event.target.closest('[data-goto]');
    if (gotoBtn) goTo(gotoBtn.dataset.goto);
  });

  document.addEventListener('click', (event) => {
    const row = event.target.closest('.item-row[data-id]');
    if (row) viewItem(Number(row.dataset.id));
  });

  document.getElementById('btn-download-pdf').addEventListener('click', () => {
    document.getElementById('pdf-modal').style.display = 'flex';
  });
  document.getElementById('btn-cancel-pdf').addEventListener('click', () => {
    document.getElementById('pdf-modal').style.display = 'none';
  });
  document.getElementById('pdf-modal').addEventListener('click', (event) => {
    if (event.target === document.getElementById('pdf-modal')) {
      document.getElementById('pdf-modal').style.display = 'none';
    }
  });
  document.getElementById('btn-confirm-pdf').addEventListener('click', downloadPDF);

  document.getElementById('btn-delete-item').addEventListener('click', deleteCurrentItem);
  document.getElementById('btn-delete-all-items').addEventListener('click', deleteAllInventory);

  document.getElementById('btn-account-auth').addEventListener('click', () => {
    openAuthModal(State.user ? 'login' : 'login');
  });
  document.getElementById('btn-account-logout').addEventListener('click', logout);
  document.getElementById('btn-auth-close').addEventListener('click', closeAuthModal);
  document.getElementById('auth-modal').addEventListener('click', (event) => {
    if (event.target === document.getElementById('auth-modal')) closeAuthModal();
  });
  document.getElementById('auth-form').addEventListener('submit', submitAuthForm);
  document.querySelectorAll('.auth-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      State.authMode = btn.dataset.authMode;
      updateAuthModal();
      setAuthStatus('');
    });
  });

  updateAccountUI();
  renderDashboard();
  await hydrateSession();

  window.setInterval(() => {
    if (State.currentScreen === 'dashboard') {
      renderDashboard();
    }
  }, 60000);
});
