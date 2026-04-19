function renderDashboard() {
  const allTrackedItems = trackedItems();
  const eligibleItems = claimEligibleItems();
  const totalValue = eligibleItems.reduce((sum, item) => sum + itemTotalValue(item), 0);
  const trackedUnits = allTrackedItems.reduce((sum, item) => sum + itemQuantity(item), 0);
  const claimableUnits = eligibleItems.reduce((sum, item) => sum + itemQuantity(item), 0);
  const avgValue = claimableUnits ? Math.round(totalValue / claimableUnits) : 0;
  const categories = {};
  eligibleItems.forEach((item) => {
    categories[item.cat] = (categories[item.cat] || 0) + itemTotalValue(item);
  });
  const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  const topPct = topCategory && totalValue ? Math.round((topCategory[1] / totalValue) * 100) : 0;

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Home Value</div>
      <div class="stat-val" id="total-val">${fmt(totalValue)}</div>
      <div class="stat-sub">${claimableUnits ? 'Claimable total excludes estimate-only items' : 'No claimable items yet'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Items Tracked</div>
      <div class="stat-val">${trackedUnits}</div>
      <div class="stat-sub">${claimableUnits} count toward claimable value</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Average Item Value</div>
      <div class="stat-val">${fmt(avgValue)}</div>
      <div class="stat-sub">${claimableUnits ? 'Based on claimable items only' : 'No data yet'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Data Source</div>
      <div class="stat-val" style="font-size:16px;margin-top:6px">
        <span style="color:var(--green)">●</span> eBay Live
      </div>
      <div class="stat-sub">Sold listings</div>
    </div>
  `;

  const updateLabel = trackedUnits
    ? `${relativeTimeFrom(latestInventoryTimestamp())} · ${trackedUnits} item${trackedUnits === 1 ? '' : 's'} tracked`
    : '0 items tracked';
  document.getElementById('dash-sub').textContent = updateLabel;

  document.getElementById('dash-insight').innerHTML = `
    <svg class="insight-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>${topCategory
      ? `<strong style="color:var(--text)">${escapeHTML(topCategory[0])}</strong> makes up <strong style="color:var(--text)">${topPct}%</strong> of your current tracked value.`
      : 'Start by clicking "Scan New Item".'
    }</span>
  `;

  const recent = [...allTrackedItems].slice(0, 4);
  document.getElementById('recent-items').innerHTML = recent.length
    ? recent.map(itemRowHTML).join('')
    : `<div class="empty-state">
        <div class="empty-state-copy">Upload a photo to start building your inventory.</div>
        <button class="btn btn-primary" type="button" onclick="goTo('scan')">Scan New Item</button>
      </div>`;

  renderDonut();
  renderLine();
}
