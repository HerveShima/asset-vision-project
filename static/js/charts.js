let _donutChart = null;
let _lineChart = null;
let _barChart = null;

const CHART_COLORS = ['#4f8ef7', '#fbbf24', '#34d399', '#7dd3fc'];

function destroyChart(chart) {
  if (chart) chart.destroy();
}

function chartShell(canvas) {
  return canvas?.parentElement || null;
}

function setChartPlaceholder(canvas, message = '') {
  const shell = chartShell(canvas);
  if (!shell) return;

  let placeholder = shell.querySelector('.chart-placeholder');
  if (!placeholder && message) {
    placeholder = document.createElement('div');
    placeholder.className = 'chart-placeholder';
    shell.appendChild(placeholder);
  }

  if (placeholder) {
    if (message) {
      placeholder.textContent = message;
      placeholder.style.display = 'flex';
    } else {
      placeholder.style.display = 'none';
      placeholder.textContent = '';
    }
  }

  canvas.style.visibility = message ? 'hidden' : 'visible';
}

function renderDonut() {
  const canvas = document.getElementById('donutChart');
  if (!canvas) return;

  const eligibleItems = claimEligibleItems();
  const categories = {};
  eligibleItems.forEach((item) => {
    categories[item.cat] = (categories[item.cat] || 0) + itemTotalValue(item);
  });
  const labels = Object.keys(categories);
  const values = Object.values(categories);
  const total = values.reduce((sum, value) => sum + value, 0);

  destroyChart(_donutChart);
  const legend = document.getElementById('donut-legend');

  if (!labels.length) {
    setChartPlaceholder(canvas, 'No category data yet');
    legend.innerHTML = '';
    _donutChart = null;
    return;
  }

  setChartPlaceholder(canvas, '');
  _donutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)} (${Math.round((ctx.raw / total) * 100)}%)`,
          },
        },
      },
    },
  });

  legend.innerHTML = labels.map((label, index) => `
    <span>
      <span class="legend-dot" style="background:${CHART_COLORS[index]}"></span>
      ${escapeHTML(label)} ${Math.round((values[index] / total) * 100)}%
    </span>`).join('');
}

function buildGrowthSeries() {
  const sorted = [...claimEligibleItems()].sort((a, b) => {
    const left = new Date(a.created_at || a.updated_at || a.date).getTime();
    const right = new Date(b.created_at || b.updated_at || b.date).getTime();
    return left - right || a.id - b.id;
  });

  let running = 0;
  const points = sorted.map((item) => {
    running += itemTotalValue(item);
    const stamp = new Date(item.created_at || item.updated_at || item.date);
    return {
      rawDate: item.created_at || item.updated_at || item.date,
      label: `${stamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${stamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      value: running,
    };
  });

  const collapsed = [];
  points.forEach((point) => {
    const last = collapsed[collapsed.length - 1];
    if (last && last.rawDate === point.rawDate) {
      last.value = point.value;
      return;
    }
    collapsed.push({ rawDate: point.rawDate, label: point.label, value: point.value });
  });

  return collapsed;
}

function renderLine() {
  const canvas = document.getElementById('lineChart');
  if (!canvas) return;

  destroyChart(_lineChart);

  if (!claimEligibleItems().length) {
    setChartPlaceholder(canvas, 'Portfolio growth will appear after your first saved item');
    _lineChart = null;
    return;
  }

  setChartPlaceholder(canvas, '');
  const growth = buildGrowthSeries();
  _lineChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: growth.map((point) => point.label),
      datasets: [{
        data: growth.map((point) => point.value),
        borderColor: '#4f8ef7',
        backgroundColor: 'rgba(79,142,247,0.08)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#4f8ef7',
        pointRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 8, right: 16, top: 8, bottom: 4 } },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#5a5a72', font: { size: 11 } },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#5a5a72',
            font: { size: 11 },
            callback: (value) => '$' + Math.round(value / 1000) + 'k',
          },
        },
      },
    },
  });
}

function renderBar() {
  const canvas = document.getElementById('barChart');
  if (!canvas) return;

  const eligibleItems = claimEligibleItems();
  const categories = {};
  eligibleItems.forEach((item) => {
    categories[item.cat] = (categories[item.cat] || 0) + itemTotalValue(item);
  });
  const labels = Object.keys(categories);
  const values = Object.values(categories);

  destroyChart(_barChart);

  if (!labels.length) {
    setChartPlaceholder(canvas, 'Category value will appear after your first saved item');
    _barChart = null;
    return;
  }

  setChartPlaceholder(canvas, '');
  _barChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 8, right: 16, top: 8, bottom: 4 } },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#5a5a72', font: { size: 11 } },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#5a5a72',
            font: { size: 11 },
            callback: (value) => '$' + Math.round(value / 1000) + 'k',
          },
        },
      },
    },
  });
}
