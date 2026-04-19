const DEMO_ITEMS = [
  { name: 'MacBook Pro 16"', cat: 'Electronics', val: 1850, conf: 94, emoji: '💻', quantity: 1 },
  { name: 'Sony 65" 4K TV', cat: 'Electronics', val: 680, conf: 88, emoji: '📺', quantity: 1 },
  { name: 'Herman Miller Aeron', cat: 'Furniture', val: 760, conf: 91, emoji: '🪑', quantity: 1 },
  { name: 'Dyson V15', cat: 'Appliances', val: 380, conf: 85, emoji: '🌀', quantity: 1 },
];

let _previewObjectURL = null;
let _scanSaveInFlight = false;

function initScanScreen() {
  const photoInput = document.getElementById('input-photo');
  document.getElementById('btn-photo-choose').addEventListener('click', (event) => {
    event.stopPropagation();
    photoInput.click();
  });
  document.getElementById('drop-zone-photo').addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', (event) => {
    if (event.target.files[0]) handlePhotoFile(event.target.files[0]);
  });

  setupDragDrop('drop-zone-photo', (file) => {
    if (file.type.startsWith('image/')) handlePhotoFile(file);
  });

  const demoContainer = document.getElementById('demo-buttons');
  demoContainer.innerHTML = DEMO_ITEMS.map((demo) =>
    `<button class="btn btn-secondary btn-sm demo-btn" data-demo='${JSON.stringify(demo)}'>${demo.emoji} ${demo.name}</button>`
  ).join('');
  demoContainer.querySelectorAll('.demo-btn').forEach((btn) => {
    btn.addEventListener('click', () => runDemoScan(JSON.parse(btn.dataset.demo)));
  });

  document.getElementById('btn-save-item').addEventListener('click', saveItem);
  document.getElementById('btn-scan-again').addEventListener('click', () => resetScan());
}

function setupDragDrop(zoneId, onFile) {
  const zone = document.getElementById(zoneId);
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('drag');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('drag');
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

function setSaveButtonState() {
  const saveBtn = document.getElementById('btn-save-item');
  if (!saveBtn) return;

  if (!saveBtn.dataset.defaultHtml) {
    saveBtn.dataset.defaultHtml = saveBtn.innerHTML;
  }

  const isDemo = Boolean(State.scanData?.isDemo);
  const hasSavableItems = Boolean(savableDetectedItems(State.scanData).length);
  saveBtn.disabled = isDemo || !hasSavableItems || _scanSaveInFlight;
  saveBtn.style.display = isDemo || !hasSavableItems ? 'none' : 'inline-flex';
  saveBtn.innerHTML = _scanSaveInFlight ? 'Saving...' : saveBtn.dataset.defaultHtml;
}

function resetScan(clearData = true) {
  if (_previewObjectURL) {
    URL.revokeObjectURL(_previewObjectURL);
    _previewObjectURL = null;
  }

  if (clearData) State.scanData = null;
  document.getElementById('scan-upload').style.display = 'block';
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('scan-result').style.display = 'none';
  document.getElementById('input-photo').value = '';
  setSaveButtonState();
}

function syncScanScreen() {
  if (State.scanData) {
    document.getElementById('scan-upload').style.display = 'none';
    document.getElementById('scan-progress').style.display = 'none';
    document.getElementById('scan-result').style.display = 'block';
    showScanResult();
    return;
  }

  document.getElementById('scan-upload').style.display = 'block';
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('scan-result').style.display = 'none';
  setSaveButtonState();
}

async function handlePhotoFile(file) {
  State.scanData = null;
  _previewObjectURL = URL.createObjectURL(file);
  showProgress(_previewObjectURL);

  try {
    const imageB64 = await fileToBase64(file);
    const mimeType = file.type || 'image/jpeg';
    const imageHash = await fileToAverageHash(file);
    advanceStage(1);

    const identified = await callIdentify(imageB64, mimeType);
    advanceStage(2);

    const excludedItems = identified.items.filter((item) => item.coverage_status === 'excluded');
    const eligibleDetections = identified.items.filter((item) => item.coverage_status !== 'excluded');
    const items = await Promise.all(
      eligibleDetections.map(async (item, index) => {
        const pricing = await fetchMarketPrice(item.name, item.category);
        const soldPrice = Number(pricing.avg || 0);
        const confidenceCap = Number(pricing.confidence_ceiling || 100);
        const adjustedConfidence = soldPrice > 0
          ? Math.min(Number(item.confidence || 0), confidenceCap)
          : Math.min(Number(item.confidence || 0), confidenceCap || 35);
        return {
          id: `${Date.now()}-${index}`,
          name: item.name,
          cat: item.category,
          conf: adjustedConfidence,
          quantity: Number(item.quantity || 1),
          emoji: item.emoji,
          val: soldPrice,
          low: Number(pricing.low || soldPrice || 0),
          high: Number(pricing.high || soldPrice || 0),
          listing_count: Number(pricing.listing_count || 0),
          active_listing_count: Number(pricing.active_listing_count || 0),
          price_source: pricing.source || (soldPrice ? 'eBay sold listings' : 'No matched sold listings'),
          coverage_status: item.coverage_status || 'standard',
          coverage_note: item.coverage_note || pricing.coverage_note || null,
        };
      })
    );
    advanceStage(3);

    State.scanData = {
      imageB64,
      mimeType,
      imageHash,
      imageUrl: _previewObjectURL,
      isDemo: false,
      items,
      excludedItems,
    };
    showScanResult();
  } catch (error) {
    console.error('Scan error:', error);
    showScanError(error.message);
  }
}

function runDemoScan(demo) {
  showProgress(null);
  const delays = [700, 1400, 2100];
  delays.forEach((delay, index) => setTimeout(() => advanceStage(index + 1), delay));
  setTimeout(() => {
    State.scanData = {
      imageB64: null,
      mimeType: null,
      imageHash: null,
      imageUrl: null,
      isDemo: true,
      items: [{
        ...demo,
        low: Math.round(demo.val * 0.8),
        high: Math.round(demo.val * 1.2),
        price_source: 'Demo preview',
        coverage_status: 'standard',
        coverage_note: null,
      }],
      excludedItems: [],
    };
    showScanResult();
  }, 2400);
}

function showProgress(imgUrl) {
  document.getElementById('scan-upload').style.display = 'none';
  document.getElementById('scan-progress').style.display = 'block';
  document.getElementById('scan-result').style.display = 'none';

  const preview = document.getElementById('preview-img');
  if (imgUrl) {
    preview.src = imgUrl;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }

  document.getElementById('stages').innerHTML = [
    { title: 'Preparing image', sub: 'Compression and fingerprinting' },
    { title: 'Identifying items', sub: 'OpenAI Vision and quantity detection' },
    { title: 'Fetching market prices', sub: 'eBay sold listings' },
  ].map((stage, index) => `
    <div class="stage" id="stage-${index + 1}">
      <div class="stage-icon" id="si-${index + 1}">
        <div style="width:12px;height:12px;border-radius:50%;background:var(--surface2)"></div>
      </div>
      <div>
        <div class="stage-title">${stage.title}</div>
        <div class="stage-sub">${stage.sub}</div>
      </div>
    </div>
  `).join('');

  const firstStage = document.getElementById('stage-1');
  firstStage.classList.add('active');
  document.getElementById('si-1').innerHTML = '<div class="spinner"></div>';
}

function advanceStage(completedStage) {
  const doneEl = document.getElementById(`stage-${completedStage}`);
  const doneIcon = document.getElementById(`si-${completedStage}`);
  if (doneEl) doneEl.className = 'stage done';
  if (doneIcon) {
    doneIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  }

  const next = completedStage + 1;
  const nextEl = document.getElementById(`stage-${next}`);
  const nextIcon = document.getElementById(`si-${next}`);
  if (nextEl) nextEl.classList.add('active');
  if (nextIcon) nextIcon.innerHTML = '<div class="spinner"></div>';
}

function renderCoverageNote(item) {
  if (!item.coverage_note) return '';
  return `<div class="coverage-note">${escapeHTML(item.coverage_note)}</div>`;
}

function visibleDetectedTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
}

function savableDetectedItems(scanData) {
  const items = scanData?.items || [];
  return items.filter((item) => Number(item.val || 0) > 0);
}

function claimReadyDetectedItems(scanData) {
  return savableDetectedItems(scanData).filter((item) => item.coverage_status !== 'review' && Number(item.conf || 0) >= CLAIM_VALUE_CONFIDENCE_THRESHOLD);
}

function renderScanValue(item) {
  if (Number(item.val || 0) <= 0) {
    return '<div class="scan-value-unavailable">Unavailable</div>';
  }
  return `<div class="price-hero" style="font-size:34px">${fmt(Number(item.val || 0) * Number(item.quantity || 1))}</div>`;
}

function showScanResult() {
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('scan-result').style.display = 'block';
  setSaveButtonState();

  const data = State.scanData;
  const eligibleItems = data.items || [];
  const savableItems = savableDetectedItems(data);
  const claimReadyItems = claimReadyDetectedItems(data);
  const excludedItems = data.excludedItems || [];
  const totalVisible = visibleDetectedTotal(claimReadyItems);
  const preview = data.imageUrl
    ? `<div class="scan-summary-thumb"><img src="${escapeHTML(data.imageUrl)}" alt="Scan preview" class="thumb-image"/></div>`
    : '<div class="scan-summary-thumb">📷</div>';

  const cards = eligibleItems.map((item) => `
      <div class="scan-detected-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <div style="font-size:12px;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Detected Item</div>
            <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700">${escapeHTML(item.emoji)} ${escapeHTML(item.name)}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              <span class="cat-badge ${catClass(item.cat)}">${escapeHTML(item.cat)}</span>
              <span class="tag tag-blue">Confidence ${item.conf}%</span>
              ${item.quantity > 1 ? `<span class="tag tag-blue">Qty ${item.quantity}</span>` : ''}
              ${item.coverage_status === 'review' ? '<span class="tag tag-amber">Needs review</span>' : ''}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:12px;color:var(--text3);margin-bottom:4px">Estimated Value</div>
            ${renderScanValue(item)}
            <div style="font-size:12px;color:var(--text3);margin-top:4px">${escapeHTML(item.price_source || 'eBay sold listings')}</div>
          </div>
        </div>
        ${renderCoverageNote(item)}
      </div>
    `).join('');

  const excludedUnits = visibleDetectedTotal(excludedItems);
  const excludedCopy = excludedItems.length
    ? `<div class="coverage-note" style="margin-top:16px">${excludedUnits} detected item${excludedUnits === 1 ? '' : 's'} were skipped because they are not claim-eligible household assets and will not be valued, saved, or added to the insurance report.</div>`
    : '';

  if (!savableItems.length) {
    document.getElementById('result-card').innerHTML = `
      <div class="scan-summary">
        ${preview}
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin-bottom:4px">No recognizable claim-ready item found</div>
          <div style="font-size:13px;color:var(--text3);max-width:560px">Retake the photo with the full item visible. For electronics, try to make the brand or model readable. For same-type items, keep them together in one clear frame.</div>
        </div>
      </div>
      ${eligibleItems.length ? `<div class="scan-detected-list">${cards}</div>` : ''}
      ${excludedCopy}
    `;
    return;
  }

  if (!claimReadyItems.length) {
    document.getElementById('result-card').innerHTML = `
      <div class="scan-summary">
        ${preview}
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin-bottom:4px">No recognizable claim-ready item found</div>
          <div style="font-size:13px;color:var(--text3);max-width:560px">HomeVault found items, but they still need review before they count toward the claimable total. You can save them with an asterisk and rescan later with a clearer photo.</div>
        </div>
      </div>
      ${excludedCopy}
      <div class="scan-detected-list">${cards}</div>
    `;
    return;
  }

  document.getElementById('result-card').innerHTML = `
    <div class="scan-summary">
      ${preview}
      <div>
        <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin-bottom:4px">${totalVisible} claim-ready item${totalVisible === 1 ? '' : 's'} across ${claimReadyItems.length} detection${claimReadyItems.length === 1 ? '' : 's'}</div>
        ${data.isDemo ? '<div style="font-size:13px;color:var(--text3)">Demo results are preview-only and cannot be added to inventory.</div>' : ''}
      </div>
    </div>
    ${excludedCopy}
    <div class="scan-detected-list">${cards}</div>
  `;
}

function showScanError(message) {
  State.scanData = null;
  document.getElementById('scan-progress').style.display = 'none';
  document.getElementById('scan-result').style.display = 'block';
  setSaveButtonState();
  document.getElementById('result-card').innerHTML = `
    <div style="text-align:center;padding:32px;color:var(--red)">
      <div style="font-size:24px;margin-bottom:12px">⚠️</div>
      <div style="font-size:15px;font-weight:500;margin-bottom:8px">Scan failed</div>
      <div style="font-size:13px;color:var(--text3)">${escapeHTML(message)}</div>
    </div>`;
}

async function saveItem() {
  if (!State.scanData || State.scanData.isDemo) return;
  if (!State.user) {
    openAuthModal('login');
    setAuthStatus('Sign in or create an account before saving items.', 'error');
    return;
  }
  const itemsToSave = savableDetectedItems(State.scanData);
  if (!itemsToSave.length) {
    alert('No claim-eligible items are available to save from this scan.');
    return;
  }

  const saved = [];
  const duplicates = [];
  const failed = [];
  _scanSaveInFlight = true;
  setSaveButtonState();

  try {
    for (const item of itemsToSave) {
      try {
        const result = await apiFetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...item,
            date: todayStr(),
            condition: 85,
            image_b64: State.scanData.imageB64,
            mime_type: State.scanData.mimeType,
            image_hash: State.scanData.imageHash,
            image_url: State.scanData.imageUrl,
          }),
        });
        saved.push(result.item);
      } catch (error) {
        if (error.status === 409) {
          duplicates.push(error.payload?.reason || `You cannot use the same image twice for ${item.name}.`);
        } else {
          failed.push(item.name);
        }
      }
    }
  } finally {
    _scanSaveInFlight = false;
    setSaveButtonState();
  }

  await loadInventory();

  const messages = [];
  const savedUnits = saved.reduce((sum, item) => sum + itemQuantity(item), 0);
  if (savedUnits) messages.push(`Saved ${savedUnits} item${savedUnits === 1 ? '' : 's'}.`);
  const needsDetailUnits = visibleDetectedTotal((State.scanData.items || []).filter((item) => Number(item.val || 0) <= 0));
  if (needsDetailUnits) messages.push(`${needsDetailUnits} item${needsDetailUnits === 1 ? '' : 's'} need a clearer photo before HomeVault can price them.`);
  const skippedUnits = visibleDetectedTotal(State.scanData.excludedItems || []);
  if (skippedUnits) messages.push(`${skippedUnits} non-claim-eligible item${skippedUnits === 1 ? '' : 's'} were skipped.`);
  if (duplicates.length) messages.push(duplicates.join(' '));
  if (failed.length) messages.push(`${failed.length} item${failed.length === 1 ? '' : 's'} could not be saved this time. Please rescan with a clearer photo.`);

  alert(messages.join(' ') || 'Nothing was saved.');
  if (saved.length) {
    State.scanData = null;
    resetScan();
    goTo('inventory');
  }
}

async function callIdentify(b64, mime) {
  return apiFetch('/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_b64: b64, mime_type: mime }),
  });
}

async function fetchMarketPrice(itemName, category) {
  return apiFetch('/api/market-price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_name: itemName, category }),
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('File read failed.'));
    reader.readAsDataURL(file);
  });
}

function fileToAverageHash(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = 8;
      canvas.height = 8;
      ctx.drawImage(img, 0, 0, 8, 8);
      const pixels = ctx.getImageData(0, 0, 8, 8).data;
      const values = [];
      for (let i = 0; i < pixels.length; i += 4) {
        values.push((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
      }
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      URL.revokeObjectURL(url);
      resolve(values.map((value) => (value >= avg ? '1' : '0')).join(''));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image hash generation failed.'));
    };
    img.src = url;
  });
}

document.addEventListener('DOMContentLoaded', initScanScreen);
