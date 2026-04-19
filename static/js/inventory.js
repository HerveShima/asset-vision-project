function renderInventory() {
  const visibleItems = trackedItems();
  const deleteAllBtn = document.getElementById('btn-delete-all-items');
  const sub = document.getElementById('inv-sub');
  if (sub) {
    sub.textContent = State.user
      ? `${totalTrackedUnits()} item${totalTrackedUnits() === 1 ? '' : 's'} - live eBay valuation`
      : 'Sign in to load your saved inventory';
  }
  if (deleteAllBtn) {
    deleteAllBtn.style.display = State.user && State.inventory.length ? 'inline-flex' : 'none';
  }

  const bar = document.getElementById('filter-bar');
  const categories = ['All', ...new Set(visibleItems.map((item) => item.cat))];
  bar.innerHTML = categories.map((category, index) =>
    `<button class="btn btn-secondary btn-sm filter-btn${index === 0 ? ' active' : ''}" data-cat="${category}">${category}</button>`
  ).join('');

  bar.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.filter-btn').forEach((button) => button.classList.remove('active'));
      btn.classList.add('active');
      renderInventoryItems(btn.dataset.cat);
    });
  });

  renderInventoryItems('All');
}

function renderInventoryItems(category) {
  const visibleItems = trackedItems();
  const items = category === 'All' ? visibleItems : visibleItems.filter((item) => item.cat === category);
  const el = document.getElementById('inventory-list');

  if (!State.user) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Sign in to see your saved items</div>
        <div class="empty-state-copy">Your inventory, uploaded images, and valuation history are tied to your email account.</div>
        <button class="btn btn-primary" type="button" onclick="openAuthModal('login')">Sign In</button>
      </div>`;
    return;
  }

  el.innerHTML = items.length
    ? items.map(itemRowHTML).join('')
    : `<div class="empty-state">
        <div class="empty-state-title">No items here yet</div>
        <div class="empty-state-copy">Scan a photo to add a new item. Duplicate image uploads are checked before save.</div>
        <button class="btn btn-primary" type="button" onclick="goTo('scan')">Scan New Item</button>
      </div>`;
}

function viewItem(id) {
  State.detailItemId = id;
  const item = trackedItems().find((entry) => entry.id === id);
  if (!item) return;
  const estimateOnly = !isClaimEligible(item);

  document.getElementById('detail-title').textContent = item.name;

  const dep1 = Math.round(itemTotalValue(item) * 0.88);
  const dep2 = Math.round(itemTotalValue(item) * 0.78);
  const adjustedValue = Math.round(itemTotalValue(item) * (item.condition / 100));
  const confColor = item.conf >= 90 ? 'var(--green)' : item.conf >= 75 ? 'var(--amber)' : 'var(--red)';
  const hashId = '#' + String(id * 13 + 4721).padStart(6, '0');

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-hero">
      ${itemThumbHTML(item, 'detail-img')}
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
          <span class="cat-badge ${catClass(item.cat)}">${escapeHTML(item.cat)}</span>
          ${itemQuantity(item) > 1 ? `<span class="tag tag-blue">Qty ${itemQuantity(item)}</span>` : ''}
          ${estimateOnly ? '<span class="tag tag-amber">Estimate only *</span>' : '<span class="tag tag-green">Ready for report</span>'}
        </div>
        <div style="font-family:'Syne',sans-serif;font-size:32px;font-weight:700;margin-bottom:4px">${fmt(itemTotalValue(item))}</div>
        <div style="font-size:13px;color:var(--text3)">${estimateOnly ? 'Estimated value shown for review only and excluded from the claimable total.' : `Estimated tracked value${itemQuantity(item) > 1 ? ` across ${itemQuantity(item)} similar items` : ''}`}</div>
        ${item.coverage_note ? `<div class="coverage-note" style="margin-top:14px">${escapeHTML(item.coverage_note)}</div>` : ''}
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">Condition Adjuster</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:13px;color:var(--text2)">Condition</span>
          <span style="font-size:13px;font-weight:600;color:var(--text)" id="cond-val">${item.condition}%</span>
        </div>
        <input type="range" min="10" max="100" step="1" value="${item.condition}" id="cond-slider" style="margin-bottom:16px"/>
        <div style="border-top:1px solid var(--border);padding-top:14px">
          <div style="font-size:12px;color:var(--text3);margin-bottom:6px">Adjusted Value</div>
          <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700" id="adj-val">${fmt(adjustedValue)}</div>
        </div>
      </div>

      <div class="card">
        <div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">Depreciation Forecast</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text2)">Current</span><span style="font-weight:500">${fmt(itemTotalValue(item))}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text2)">1 Year</span><span style="color:var(--amber)">${fmt(dep1)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:var(--text2)">2 Years</span><span style="color:var(--red)">${fmt(dep2)}</span>
          </div>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--text3)">
          Projected loss: <strong style="color:var(--red)">${fmt(itemTotalValue(item) - dep2)}</strong>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;display:flex;gap:24px;align-items:center;flex-wrap:wrap">
      <div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Confidence</div>
        <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:700;color:${confColor}">${item.conf}%</div>
      </div>
      <div style="height:40px;width:1px;background:var(--border)"></div>
      <div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Scan Date</div>
        <div style="font-size:15px;font-weight:500">${escapeHTML(item.date)}</div>
      </div>
      <div style="height:40px;width:1px;background:var(--border)"></div>
      <div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Source</div>
        <div style="font-size:15px;font-weight:500;color:var(--green)">${escapeHTML(item.price_source || 'eBay sold listings')}</div>
      </div>
      <div style="height:40px;width:1px;background:var(--border)"></div>
      <div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Hash ID</div>
        <div style="font-size:12px;font-family:monospace;color:var(--text3)">${hashId}</div>
      </div>
    </div>
  `;

  const slider = document.getElementById('cond-slider');
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    document.getElementById('cond-val').textContent = `${value}%`;
    document.getElementById('adj-val').textContent = fmt(Math.round(itemTotalValue(item) * (value / 100)));
  });
  slider.addEventListener('change', async () => {
    const value = Number(slider.value);
    await saveCondition(item.id, value);
    item.condition = value;
  });

  goTo('detail');
}

async function deleteAllInventory() {
  if (!State.user || !State.inventory.length) return;

  const confirmed = window.confirm('Delete all saved inventory items and images for this account? This cannot be undone.');
  if (!confirmed) return;

  const deleteAllBtn = document.getElementById('btn-delete-all-items');
  const originalLabel = deleteAllBtn ? deleteAllBtn.textContent : '';
  if (deleteAllBtn) {
    deleteAllBtn.disabled = true;
    deleteAllBtn.textContent = 'Deleting...';
  }

  try {
    const data = await apiFetch('/api/items', { method: 'DELETE' });
    State.inventory = [];
    State.detailItemId = null;
    refreshCurrentScreen();
    alert(`Deleted ${data.deleted_count || 0} saved item${data.deleted_count === 1 ? '' : 's'}.`);
  } catch (error) {
    alert(`Delete all failed: ${error.message}`);
  } finally {
    if (deleteAllBtn) {
      deleteAllBtn.disabled = false;
      deleteAllBtn.textContent = originalLabel || 'Delete All';
    }
  }
}
