function analyticsTrendSummary() {
  const claimableItems = claimEligibleItems();
  if (!claimableItems.length) {
    return {
      newestLabel: 'No claim-ready scan data',
      newestValue: '0',
      coverageWarnings: 0,
      avgConfidence: 0,
    };
  }

  const sorted = [...claimableItems].sort((a, b) => new Date(a.date) - new Date(b.date));
  const newest = sorted[sorted.length - 1];
  const avgConfidence = Math.round(sorted.reduce((sum, item) => sum + item.conf, 0) / sorted.length);
  const coverageWarnings = sorted.filter((item) => item.coverage_status === 'review').length;

  return {
    newestLabel: newest.name,
    newestValue: newest.date,
    coverageWarnings,
    avgConfidence,
  };
}

function renderAnalytics() {
  const allTrackedItems = trackedItems();
  const eligibleItems = claimEligibleItems();
  const totalValue = eligibleItems.reduce((sum, item) => sum + itemTotalValue(item), 0);
  const categories = {};
  eligibleItems.forEach((item) => {
    categories[item.cat] = (categories[item.cat] || 0) + itemTotalValue(item);
  });

  const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  const topPct = topCategory && totalValue ? Math.round((topCategory[1] / totalValue) * 100) : 0;
  const trend = analyticsTrendSummary();

  document.getElementById('analytics-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Claimable Value</div>
      <div class="stat-val">${fmt(totalValue)}</div>
      <div class="stat-sub">${eligibleItems.reduce((sum, item) => sum + itemQuantity(item), 0)} claim-ready item${eligibleItems.reduce((sum, item) => sum + itemQuantity(item), 0) === 1 ? '' : 's'} included in total</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">${topCategory ? escapeHTML(topCategory[0]) : 'Top Category'}</div>
      <div class="stat-val">${topCategory ? `${topPct}%` : '0%'}</div>
      <div class="stat-sub">share of total value</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Average Confidence</div>
      <div class="stat-val">${trend.avgConfidence}%</div>
      <div class="stat-sub">${trend.coverageWarnings ? 'Some items still need insurer review' : 'Claim-ready coverage looks clear'}</div>
    </div>
  `;

  const topItems = [...allTrackedItems].sort((a, b) => itemTotalValue(b) - itemTotalValue(a)).slice(0, 5);
  document.getElementById('top-items').innerHTML = topItems.length
    ? topItems.map((item) => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
          ${itemThumbHTML(item)}
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500">${escapeHTML(item.name)}${isClaimEligible(item) ? '' : ' *'}</div>
            <div style="font-size:11px;color:var(--text3)">${escapeHTML(item.cat)}${itemQuantity(item) > 1 ? ` · Qty ${itemQuantity(item)}` : ''}</div>
          </div>
          <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:600">${fmt(itemTotalValue(item))}</div>
        </div>`).join('')
    : `<div class="empty-state compact">
        <div class="empty-state-copy">Scan an image to start generating trend insights.</div>
      </div>`;

  const coverageWarnings = allTrackedItems.filter((item) => item.coverage_status === 'review' || Number(item.conf || 0) < CLAIM_VALUE_CONFIDENCE_THRESHOLD);
  const recentCount = eligibleItems.filter((item) => {
    const stamp = new Date(item.updated_at || item.created_at || item.date);
    return Date.now() - stamp.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).reduce((sum, item) => sum + itemQuantity(item), 0);

  const totalSoldSamples = eligibleItems.reduce((sum, item) => sum + Number(item.listing_count || 0), 0);
  const totalActiveListings = eligibleItems.reduce((sum, item) => sum + Number(item.active_listing_count || 0), 0);
  const avgRangeWidth = eligibleItems.length
    ? Math.round(eligibleItems.reduce((sum, item) => sum + ((Number(item.high || 0) - Number(item.low || 0)) / Math.max(Number(item.val || 1), 1)), 0) / eligibleItems.length * 100)
    : 0;
  const forecastChangePct = eligibleItems.length
    ? Math.round(eligibleItems.reduce((sum, item) => {
        const rates = { Electronics: -6, Furniture: -2, Appliances: -3, Other: -4 };
        return sum + (rates[item.cat] || -3.5) * itemTotalValue(item);
      }, 0) / Math.max(totalValue, 1))
    : 0;
  const fastDepCategory = Object.entries(categories).sort((a, b) => {
    const rates = { Electronics: 6, Furniture: 2, Appliances: 3, Other: 4 };
    return (rates[b[0]] || 4) - (rates[a[0]] || 4);
  })[0];

  document.getElementById('analytics-insights').innerHTML = [
    { icon: '📈', text: eligibleItems.length ? `Estimated 30-day portfolio change: <strong style="color:var(--text)">${forecastChangePct}%</strong> based on current category mix and resale behavior.` : 'Your 30-day value trend will appear after the first claim-eligible item.' },
    { icon: '📦', text: eligibleItems.length ? `Market activity shows <strong style="color:var(--text)">${totalSoldSamples}</strong> matched recent sales and about <strong style="color:var(--text)">${totalActiveListings}</strong> active listings across your tracked items.` : 'Market activity will appear after pricing data is available.' },
    { icon: '🛡️', text: eligibleItems.length ? `${fastDepCategory ? `${escapeHTML(fastDepCategory[0])} appears to depreciate fastest in your portfolio.` : 'Category depreciation will appear soon.'} Average market spread is <strong style="color:var(--text)">${avgRangeWidth}%</strong>, which helps flag volatility and underinsured risk.` : 'Risk and depreciation insight will appear after the first claim-eligible item.' },
    { icon: '🧾', text: coverageWarnings.length ? `${coverageWarnings.length} tracked item${coverageWarnings.length === 1 ? '' : 's'} are marked estimate-only and shown with an asterisk. Their estimated value is excluded from the claimable total.` : `Latest claim-ready item: <strong style="color:var(--text)">${escapeHTML(trend.newestLabel)}</strong>${trend.newestValue !== '0' ? ` on ${escapeHTML(trend.newestValue)}` : ''}.` },
  ].map((insight) => `
    <div class="insight" style="align-items:flex-start">
      <span style="font-size:16px;flex-shrink:0">${insight.icon}</span>
      <span style="font-size:13px">${insight.text}</span>
    </div>`).join('');

  setTimeout(() => renderBar(), 50);
}

function renderReport() {
  const now = new Date();
  const reportItems = trackedItems();
  const claimableItems = claimEligibleItems();
  const totalValue = claimableItems.reduce((sum, item) => sum + itemTotalValue(item), 0);
  const estimateOnlyCount = reportItems.filter((item) => !isClaimEligible(item)).length;

  document.getElementById('report-summary').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
      <div>
        <div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Report Generated</div>
        <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:600">
          ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Total Valuation</div>
        <div style="font-family:'Syne',sans-serif;font-size:24px;font-weight:700;color:var(--blue)">${fmt(totalValue)}</div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Data Source</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="color:var(--green)">●</span>
          <span style="font-size:14px;font-weight:500">eBay Sold Listings</span>
        </div>
      </div>
      <span class="tag tag-green">Claimable Total</span>
    </div>
    ${estimateOnlyCount ? `<div class="coverage-note" style="margin-top:16px">${estimateOnlyCount} item${estimateOnlyCount === 1 ? '' : 's'} are marked with an asterisk and excluded from the claimable total because their estimates still need insurer review.</div>` : ''}
  `;

  document.getElementById('report-body').innerHTML = reportItems.length
    ? reportItems.map((item) => {
        const estimateOnly = !isClaimEligible(item);
        const confColor = item.conf >= 90 ? 'var(--green)' : item.conf >= 75 ? 'var(--amber)' : 'var(--red)';
        return `
          <tr>
            <td style="display:flex;align-items:center;gap:8px">
              <span>${escapeHTML(item.emoji)}</span><span style="font-weight:500">${escapeHTML(item.name)}${estimateOnly ? ' *' : ''}</span>
            </td>
            <td><span class="cat-badge ${catClass(item.cat)}">${escapeHTML(item.cat)}</span></td>
            <td style="text-align:right">${itemQuantity(item)}</td>
            <td style="text-align:right;font-family:'Syne',sans-serif;font-weight:600">${fmt(itemTotalValue(item))}</td>
            <td style="text-align:right;color:${confColor};font-weight:500">${item.conf}%</td>
            <td style="text-align:right;color:var(--text3);font-size:12px">${escapeHTML(item.date)}</td>
          </tr>
          ${item.coverage_note ? `<tr><td colspan="6" style="color:var(--amber);font-size:12px;padding-top:0">${escapeHTML(item.coverage_note)}</td></tr>` : ''}`;
      }).join('')
    : `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:28px">No claim-eligible items yet. Scan and save an eligible item to generate an insurance report.</td></tr>`;
}
