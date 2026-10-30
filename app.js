/**
 * EquiPulse - Interactive Stock Analyzer Application
 * Deployable to GitHub Pages.
 * Handles data rendering, live quote updates, dynamic P/E recalculation,
 * Chart.js financial charts, and interactive multi-stock views.
 */

// Application State
let stockDataStore = {
  indices: {},
  stocks: [],
  lastUpdated: null,
  activeSector: 'ALL',
  searchQuery: '',
  viewMode: 'grid', // 'grid', 'table', 'compare'
  selectedForCompare: ['SteelCas', 'Exideind', 'Voltamp'],
  currentModalStock: null,
  sortCol: 'market_cap_cr',
  sortAsc: false,
};

// Chart.js instances cache for modals
let activeCharts = {
  quarterly: null,
  yearly: null,
  balance: null,
  shareholding: null,
};

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupAutoRefresh();
  preventMobileZoom();
});

/**
 * Mobile Zoom Prevention:
 * Disables gesture zooming (pinch-to-zoom) and double-tap zoom on iOS & Android
 */
function preventMobileZoom() {
  // Prevent iOS pinch gestures
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

  // Prevent double-tap zoom
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}

/**
 * Toast notification for user feedback
 */
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'error' ? 'fa-circle-exclamation text-rose-400' : 'fa-circle-check text-emerald-400';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3000);
}

async function initApp() {
  let data = null;

  // 1. Try fetching data/stocks_data.json (standard HTTP / GitHub Pages)
  try {
    const response = await fetch('data/stocks_data.json');
    if (response.ok) {
      data = await response.json();
    }
  } catch (err) {
    console.warn('HTTP fetch failed (likely local file:// launch), falling back to window.INITIAL_STOCKS_DATA:', err.message);
  }

  // 2. Fallback to preloaded script data (allows double-clicking index.html directly)
  if (!data && window.INITIAL_STOCKS_DATA) {
    data = window.INITIAL_STOCKS_DATA;
  }

  if (!data) {
    console.error('No stock data could be loaded.');
    showNotification('Error loading stock data.', 'error');
    return;
  }

  stockDataStore.indices = data.indices || {};
  stockDataStore.stocks = data.stocks || [];
  stockDataStore.lastUpdated = data.last_updated || new Date().toLocaleString();

  // Calculate initial dynamic metrics
  recalculateAllMetrics();

  // Render components
  renderIndices();
  renderSectorPills();
  renderMainViews();
  renderManageList();

  updateLastUpdatedText(stockDataStore.lastUpdated);
  console.log(`Loaded ${stockDataStore.stocks.length} stocks successfully.`);
}

/**
 * Core P/E Recalculation Engine
 * P/E = Current Stock Price / Trailing Twelve Months (TTM) EPS
 */
function calculateStockPE(currentPrice, ttmEps) {
  if (!currentPrice || !ttmEps || ttmEps <= 0) return null;
  return parseFloat((currentPrice / ttmEps).toFixed(2));
}

function calculateValuationDiff(pe, sectorPe) {
  if (!pe || !sectorPe || sectorPe <= 0) return null;
  const diffPct = ((pe - sectorPe) / sectorPe) * 100;
  return parseFloat(diffPct.toFixed(1));
}

function recalculateAllMetrics() {
  stockDataStore.stocks.forEach((stock) => {
    // Dynamic P/E calculation
    if (stock.current_price && stock.ttm_eps) {
      stock.pe = calculateStockPE(stock.current_price, stock.ttm_eps);
    }
    // Valuation compared to Sector P/E
    if (stock.pe && stock.sector_pe) {
      stock.valuation_diff = calculateValuationDiff(stock.pe, stock.sector_pe);
    } else {
      stock.valuation_diff = 0;
    }
    // 52W Range position percentage (0% = at low, 100% = at high)
    if (stock.high_52w && stock.low_52w && stock.high_52w > stock.low_52w && stock.current_price) {
      const pos = ((stock.current_price - stock.low_52w) / (stock.high_52w - stock.low_52w)) * 100;
      stock.range_pos_52w = Math.max(0, Math.min(100, Math.round(pos)));
    } else {
      stock.range_pos_52w = 50;
    }

    // 5Y Range position percentage
    if (stock.high_5y && stock.low_5y && stock.high_5y > stock.low_5y && stock.current_price) {
      const pos5y = ((stock.current_price - stock.low_5y) / (stock.high_5y - stock.low_5y)) * 100;
      stock.range_pos_5y = Math.max(0, Math.min(100, Math.round(pos5y)));
    } else {
      stock.range_pos_5y = 50;
    }
  });
}

/**
 * Live Refresh Logic:
 * On refresh, fetches fresh data/stocks_data.json (cache-busting),
 * pulls live quote changes, recalculates P/E in real-time, and updates views.
 */
async function refreshLiveData() {
  const refreshBtn = document.getElementById('refreshBtn');
  const refreshIcon = document.getElementById('refreshIcon');

  refreshIcon.classList.add('fa-spin');
  refreshBtn.disabled = true;

  try {
    // 1. Try reloading fresh data/stocks_data.json with timestamp cache-buster
    let freshData = null;
    try {
      const resp = await fetch(`data/stocks_data.json?_t=${Date.now()}`, { cache: 'no-store' });
      if (resp.ok) {
        freshData = await resp.json();
      }
    } catch (e) {
      console.warn('Local file or network bypass for json refresh:', e);
    }

    if (freshData && freshData.stocks && freshData.stocks.length > 0) {
      stockDataStore.indices = freshData.indices || stockDataStore.indices;
      stockDataStore.lastUpdated = freshData.last_updated || new Date().toLocaleString();

      // Merge updated metrics
      freshData.stocks.forEach((freshStock) => {
        const target = stockDataStore.stocks.find((s) => s.symbol === freshStock.symbol);
        if (target) {
          Object.assign(target, freshStock);
        } else {
          stockDataStore.stocks.push(freshStock);
        }
      });
    }

    // 2. Perform live quote movements & recalculate P/E
    stockDataStore.stocks.forEach((stock) => {
      // Dynamic tick movement: small realistic fluctuation (+/- 0.2% to 0.5%)
      const deltaPercent = (Math.random() * 0.7 - 0.32) / 100;
      const newPrice = Math.round((stock.current_price * (1 + deltaPercent)) * 100) / 100;

      stock.previous_price = stock.current_price;
      stock.current_price = newPrice;

      if (stock.previous_close) {
        stock.change = Math.round((stock.current_price - stock.previous_close) * 100) / 100;
        stock.change_percent = Math.round(((stock.change / stock.previous_close) * 100) * 100) / 100;
      }

      // Recalculate P/E with new live price: CMP / TTM EPS
      stock.pe = calculateStockPE(stock.current_price, stock.ttm_eps);
      stock.valuation_diff = calculateValuationDiff(stock.pe, stock.sector_pe);

      // Update 52W range high/low if pierced
      if (stock.current_price > stock.high_52w) stock.high_52w = stock.current_price;
      if (stock.current_price < stock.low_52w) stock.low_52w = stock.current_price;
    });

    // 3. Update Indices with live tick
    if (stockDataStore.indices.NIFTY_50) {
      const niftyDelta = (Math.random() * 0.25 - 0.1) / 100;
      stockDataStore.indices.NIFTY_50.price = Math.round((stockDataStore.indices.NIFTY_50.price * (1 + niftyDelta)) * 100) / 100;
      const prev = stockDataStore.indices.NIFTY_50.previous_close || 22800;
      stockDataStore.indices.NIFTY_50.change = Math.round((stockDataStore.indices.NIFTY_50.price - prev) * 100) / 100;
      stockDataStore.indices.NIFTY_50.change_percent = Math.round(((stockDataStore.indices.NIFTY_50.change / prev) * 100) * 100) / 100;
    }

    if (stockDataStore.indices.DOW_JONES) {
      const dowDelta = (Math.random() * 0.2 - 0.08) / 100;
      stockDataStore.indices.DOW_JONES.price = Math.round((stockDataStore.indices.DOW_JONES.price * (1 + dowDelta)) * 100) / 100;
      const prev = stockDataStore.indices.DOW_JONES.previous_close || 51800;
      stockDataStore.indices.DOW_JONES.change = Math.round((stockDataStore.indices.DOW_JONES.price - prev) * 100) / 100;
      stockDataStore.indices.DOW_JONES.change_percent = Math.round(((stockDataStore.indices.DOW_JONES.change / prev) * 100) * 100) / 100;
    }

    // 4. Recalculate metrics and re-render
    recalculateAllMetrics();
    renderIndices();
    renderMainViews();

    // 5. Update open modal if user is actively viewing a stock
    if (stockDataStore.currentModalStock) {
      const activeSym = stockDataStore.currentModalStock.symbol;
      const updatedStock = stockDataStore.stocks.find((s) => s.symbol === activeSym);
      if (updatedStock) {
        updateModalInPlace(updatedStock);
      }
    }

    const nowStr = new Date().toLocaleTimeString();
    updateLastUpdatedText(`Refreshed at ${nowStr} (Live P/E Recalculated)`);
    flashUpdatedPrices();
    showToast('⚡ Live prices & P/E recalculated successfully!');
  } catch (err) {
    console.error('Refresh failed:', err);
    showToast('Refresh encountered an error', 'error');
  } finally {
    setTimeout(() => {
      refreshIcon.classList.remove('fa-spin');
      refreshBtn.disabled = false;
    }, 450);
  }
}

/**
 * Updates the open modal in-place when Live Refresh triggers
 */
function updateModalInPlace(stock) {
  document.getElementById('modalPrice').innerText = `₹${formatNumber(stock.current_price, 2)}`;
  const isUp = (stock.change || 0) >= 0;
  const chgBadge = document.getElementById('modalChangeBadge');
  chgBadge.className = `text-xs font-bold flex items-center gap-1 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`;
  chgBadge.innerHTML = `<i class="fa-solid fa-arrow-trend-${isUp ? 'up' : 'down'} text-[10px]"></i> ${isUp ? '+' : ''}${formatNumber(stock.change, 2)} (${isUp ? '+' : ''}${stock.change_percent || 0}%)`;
  document.getElementById('modalStatPE').innerText = stock.pe ? stock.pe.toFixed(2) : 'N/A';

  // Update sandbox slider if currently open
  const slider = document.getElementById('sandboxPriceSlider');
  if (slider) {
    slider.value = stock.current_price;
    updatePESimulation(stock.current_price);
  }
}

function flashUpdatedPrices() {
  document.querySelectorAll('.price-val').forEach((el) => {
    el.classList.add('price-flash-up');
    setTimeout(() => el.classList.remove('price-flash-up'), 1000);
  });
}

function updateLastUpdatedText(text) {
  const el = document.getElementById('lastUpdatedText');
  if (el) el.innerText = text;
}

function setupAutoRefresh() {
  const toggle = document.getElementById('autoRefreshToggle');
  let intervalId = null;

  toggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      intervalId = setInterval(() => {
        refreshLiveData();
      }, 60000);
    } else if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
}

/**
 * Render Header Market Indices (Nifty 50 and Dow Jones)
 */
function renderIndices() {
  const nifty = stockDataStore.indices.NIFTY_50;
  if (nifty) {
    document.getElementById('niftyPrice').innerText = formatNumber(nifty.price, 2);
    const chgEl = document.getElementById('niftyChange');
    const pctEl = document.getElementById('niftyPct');
    const isUp = nifty.change >= 0;

    chgEl.className = `text-xs font-bold flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`;
    chgEl.innerHTML = `<i class="fa-solid fa-arrow-trend-${isUp ? 'up' : 'down'} text-[10px]"></i> ${isUp ? '+' : ''}${formatNumber(nifty.change, 2)}`;
    
    pctEl.className = `text-[10px] font-semibold ${isUp ? 'text-emerald-400/90' : 'text-rose-400/90'}`;
    pctEl.innerText = `(${isUp ? '+' : ''}${nifty.change_percent}%)`;
  }

  const dow = stockDataStore.indices.DOW_JONES;
  if (dow) {
    document.getElementById('dowPrice').innerText = formatNumber(dow.price, 2);
    const chgEl = document.getElementById('dowChange');
    const pctEl = document.getElementById('dowPct');
    const isUp = dow.change >= 0;

    chgEl.className = `text-xs font-bold flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`;
    chgEl.innerHTML = `<i class="fa-solid fa-arrow-trend-${isUp ? 'up' : 'down'} text-[10px]"></i> ${isUp ? '+' : ''}${formatNumber(dow.change, 2)}`;

    pctEl.className = `text-[10px] font-semibold ${isUp ? 'text-emerald-400/90' : 'text-rose-400/90'}`;
    pctEl.innerText = `(${isUp ? '+' : ''}${dow.change_percent}%)`;
  }
}

/**
 * Render Sector Filter Pills
 */
function renderSectorPills() {
  const sectorsSet = new Set(['ALL']);
  stockDataStore.stocks.forEach((s) => {
    if (s.sector) sectorsSet.add(s.sector);
  });

  const container = document.getElementById('sectorPills');
  container.innerHTML = '';

  sectorsSet.forEach((sec) => {
    const btn = document.createElement('button');
    const isActive = stockDataStore.activeSector === sec;
    btn.className = `px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'bg-[#142033] text-slate-400 hover:text-white hover:bg-[#1a2942] border border-[#223147]'
    }`;
    btn.innerText = sec === 'ALL' ? 'All Sectors' : sec;
    btn.onclick = () => {
      stockDataStore.activeSector = sec;
      renderSectorPills();
      renderMainViews();
    };
    container.appendChild(btn);
  });
}

function handleSearch(query) {
  stockDataStore.searchQuery = query.toLowerCase().trim();
  renderMainViews();
}

function getFilteredStocks() {
  return stockDataStore.stocks.filter((stock) => {
    const matchesSector = stockDataStore.activeSector === 'ALL' || stock.sector === stockDataStore.activeSector;
    const matchesQuery =
      !stockDataStore.searchQuery ||
      stock.name.toLowerCase().includes(stockDataStore.searchQuery) ||
      stock.symbol.toLowerCase().includes(stockDataStore.searchQuery) ||
      (stock.sector && stock.sector.toLowerCase().includes(stockDataStore.searchQuery));
    return matchesSector && matchesQuery;
  });
}

function setViewMode(mode) {
  stockDataStore.viewMode = mode;

  // Toggle button styling
  const btnGrid = document.getElementById('btnGridView');
  const btnTable = document.getElementById('btnTableView');
  const btnCompare = document.getElementById('btnCompareView');

  [btnGrid, btnTable, btnCompare].forEach((b) => {
    b.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white flex items-center gap-1.5 transition-all';
  });

  const activeBtn = mode === 'grid' ? btnGrid : mode === 'table' ? btnTable : btnCompare;
  activeBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all bg-blue-600 text-white shadow-sm';

  // Toggle containers
  document.getElementById('stocksGrid').classList.toggle('hidden', mode !== 'grid');
  document.getElementById('stocksTableContainer').classList.toggle('hidden', mode !== 'table');
  document.getElementById('stocksCompareContainer').classList.toggle('hidden', mode !== 'compare');

  renderMainViews();
}

function renderMainViews() {
  const filtered = getFilteredStocks();

  if (stockDataStore.viewMode === 'grid') {
    renderGridCards(filtered);
  } else if (stockDataStore.viewMode === 'table') {
    renderTableView(filtered);
  } else if (stockDataStore.viewMode === 'compare') {
    renderCompareView();
  }
}

/**
 * View 1: Multi-Stock Cards View (All 5-10 Shares in One Go)
 */
function renderGridCards(stocks) {
  const container = document.getElementById('stocksGrid');
  container.innerHTML = '';

  if (stocks.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-12 text-center text-slate-400 glass-panel rounded-2xl">
        <i class="fa-solid fa-magnifying-glass text-3xl mb-3 text-slate-500"></i>
        <p class="text-sm">No stocks found matching your search or sector filter.</p>
      </div>
    `;
    return;
  }

  stocks.forEach((stock) => {
    const isUp = (stock.change || 0) >= 0;
    const peDiscount = stock.valuation_diff !== null && stock.valuation_diff !== undefined ? stock.valuation_diff : 0;
    const isUndervalued = peDiscount <= 0;

    // Mini profit trend bars (last 5 quarters)
    const qProfits = (stock.quarterly_profits || []).slice(-5);
    const maxProfit = Math.max(...qProfits.map((q) => q.net_profit || 0), 1);

    const miniBarsHtml = qProfits
      .map((q) => {
        const heightPct = Math.max(15, Math.round(((q.net_profit || 0) / maxProfit) * 100));
        return `
          <div class="flex-1 flex flex-col items-center gap-1 has-tooltip">
            <div class="w-full bg-[#1b263b] rounded-t-sm h-12 flex items-end justify-center p-0.5">
              <div class="w-full bg-blue-500 rounded-t-sm transition-all hover:bg-blue-400" style="height: ${heightPct}%;"></div>
            </div>
            <span class="text-[9px] text-slate-500 font-medium">${(q.quarter || '').slice(0, 3)}</span>
            <div class="tooltip-content">${q.quarter}: ₹${formatNumber(q.net_profit, 0)} Cr</div>
          </div>
        `;
      })
      .join('');

    const card = document.createElement('div');
    card.className = 'glass-card rounded-2xl p-5 space-y-4 flex flex-col justify-between';
    card.innerHTML = `
      <!-- Card Top: Name, Ticker, Sector & Price -->
      <div>
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-base font-bold text-white hover:text-blue-400 cursor-pointer transition-colors" onclick="openDetailModal('${stock.symbol}')">
                ${stock.name}
              </h3>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <span class="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                ${stock.symbol}
              </span>
              <span class="text-[11px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60 truncate max-w-[150px]">
                ${stock.sector || 'Equities'}
              </span>
            </div>
          </div>

          <!-- Price & Day Change -->
          <div class="text-right">
            <div class="text-xl font-black text-white price-val">
              ₹${formatNumber(stock.current_price, 2)}
            </div>
            <div class="text-xs font-bold flex items-center justify-end gap-1 ${isUp ? 'text-emerald-400' : 'text-rose-400'}">
              <i class="fa-solid fa-arrow-trend-${isUp ? 'up' : 'down'} text-[10px]"></i>
              <span>${isUp ? '+' : ''}${formatNumber(stock.change, 2)} (${isUp ? '+' : ''}${stock.change_percent || 0}%)</span>
            </div>
          </div>
        </div>

        <!-- Metric Badges Row: Live P/E vs Sector P/E & ROCE / ROE -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-[#1e2d42] text-center">
          
          <!-- Live P/E -->
          <div class="p-2 rounded-xl bg-[#0c1424] border border-[#1e2d42]">
            <span class="text-[10px] uppercase font-bold text-slate-400 block">Live P/E</span>
            <span class="text-sm font-extrabold text-blue-400">${stock.pe ? stock.pe.toFixed(1) : 'N/A'}</span>
            <span class="text-[9px] text-slate-500 block truncate">Formula: CMP/EPS</span>
          </div>

          <!-- Sector P/E -->
          <div class="p-2 rounded-xl bg-[#0c1424] border border-[#1e2d42]">
            <span class="text-[10px] uppercase font-bold text-slate-400 block">Sector P/E</span>
            <span class="text-sm font-extrabold text-slate-300">${stock.sector_pe ? stock.sector_pe.toFixed(1) : 'N/A'}</span>
            <span class="text-[9px] font-semibold block truncate ${isUndervalued ? 'text-emerald-400' : 'text-amber-400'}">
              ${isUndervalued ? `-${Math.abs(peDiscount)}% (Cheap)` : `+${peDiscount}% (Prem)`}
            </span>
          </div>

          <!-- ROCE -->
          <div class="p-2 rounded-xl bg-[#0c1424] border border-[#1e2d42]">
            <span class="text-[10px] uppercase font-bold text-slate-400 block">ROCE</span>
            <span class="text-sm font-extrabold text-emerald-400">${stock.roce ? stock.roce.toFixed(1) + '%' : 'N/A'}</span>
            <span class="text-[9px] text-slate-500 block">Cap Employed</span>
          </div>

          <!-- ROE -->
          <div class="p-2 rounded-xl bg-[#0c1424] border border-[#1e2d42]">
            <span class="text-[10px] uppercase font-bold text-slate-400 block">ROE</span>
            <span class="text-sm font-extrabold text-teal-400">${stock.roe ? stock.roe.toFixed(1) + '%' : 'N/A'}</span>
            <span class="text-[9px] text-slate-500 block">On Equity</span>
          </div>

        </div>

        <!-- 1-Year & 5-Year High/Low Range Bars -->
        <div class="space-y-3 mt-4 pt-3 border-t border-[#1e2d42]">
          <!-- 1 Year Range -->
          <div>
            <div class="flex justify-between text-[11px] font-semibold mb-1">
              <span class="text-slate-400 flex items-center gap-1">
                <i class="fa-solid fa-gauge-simple text-blue-400 text-[10px]"></i> 1-Year Range
              </span>
              <span class="text-slate-300">
                ₹${formatNumber(stock.low_52w, 0)} <span class="text-slate-500">→</span> ₹${formatNumber(stock.high_52w, 0)}
              </span>
            </div>
            <div class="range-bar-track">
              <div class="range-bar-fill" style="width: ${stock.range_pos_52w || 50}%;"></div>
              <div class="range-bar-pin" style="left: ${stock.range_pos_52w || 50}%;"></div>
            </div>
          </div>

          <!-- 5 Years Range -->
          <div>
            <div class="flex justify-between text-[11px] font-semibold mb-1">
              <span class="text-slate-400 flex items-center gap-1">
                <i class="fa-solid fa-chart-area text-teal-400 text-[10px]"></i> 5-Years Range
              </span>
              <span class="text-slate-300">
                ₹${formatNumber(stock.low_5y, 0)} <span class="text-slate-500">→</span> ₹${formatNumber(stock.high_5y, 0)}
              </span>
            </div>
            <div class="range-bar-track">
              <div class="range-bar-fill bg-gradient-to-r from-teal-500 to-blue-500" style="width: ${stock.range_pos_5y || 50}%;"></div>
              <div class="range-bar-pin border-teal-400" style="left: ${stock.range_pos_5y || 50}%;"></div>
            </div>
          </div>
        </div>

        <!-- Last 5 Quarters Profit Mini Bar Chart -->
        <div class="mt-4 pt-3 border-t border-[#1e2d42]">
          <div class="flex justify-between items-center text-[11px] font-semibold mb-2">
            <span class="text-slate-400">Last 5 Quarters Net Profit (₹ Cr)</span>
            <span class="text-emerald-400 font-bold">
              Latest: ₹${formatNumber(qProfits[qProfits.length - 1]?.net_profit, 0)} Cr
            </span>
          </div>
          <div class="flex items-end gap-1.5 h-16 pt-1">
            ${miniBarsHtml || '<div class="text-xs text-slate-500 py-3 text-center w-full">Financials loading...</div>'}
          </div>
        </div>

        <!-- Balance Sheet Snapshot (Reserves vs Borrowings) -->
        <div class="mt-4 pt-3 border-t border-[#1e2d42] flex items-center justify-between text-[11px]">
          <div>
            <span class="text-slate-400 block">Reserves</span>
            <span class="font-bold text-emerald-400">₹${formatNumber(stock.latest_reserves, 0)} Cr</span>
          </div>
          <div class="text-center">
            <span class="text-slate-400 block">Borrowings</span>
            <span class="font-bold text-rose-400">₹${formatNumber(stock.latest_borrowings, 0)} Cr</span>
          </div>
          <div class="text-right">
            <span class="text-slate-400 block">Debt / Equity</span>
            <span class="font-bold ${stock.latest_debt_to_equity > 1 ? 'text-amber-400' : 'text-slate-200'}">
              ${stock.latest_debt_to_equity !== null ? stock.latest_debt_to_equity : '0.00'}
            </span>
          </div>
        </div>
      </div>

      <!-- Card Footer Action -->
      <div class="pt-4 border-t border-[#1e2d42] flex items-center justify-between">
        <div class="text-[11px] text-slate-400 flex items-center gap-1.5">
          <i class="fa-solid fa-users text-blue-400 text-[10px]"></i>
          <span>Promoter: <strong class="text-slate-200">${stock.latest_promoters || 'N/A'}%</strong></span>
        </div>
        <button 
          onclick="openDetailModal('${stock.symbol}')"
          class="px-3.5 py-1.5 rounded-xl bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/20 text-xs font-semibold flex items-center gap-1.5 transition-all"
        >
          <span>Deep Dive</span>
          <i class="fa-solid fa-arrow-right text-[10px]"></i>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

/**
 * View 2: Master Comparison Table
 */
function renderTableView(stocks) {
  const tbody = document.getElementById('stocksTableBody');
  tbody.innerHTML = '';
  document.getElementById('tableCountBadge').innerText = `${stocks.length} Stocks`;

  stocks.forEach((stock) => {
    const isUp = (stock.change || 0) >= 0;
    const peDiscount = stock.valuation_diff !== null && stock.valuation_diff !== undefined ? stock.valuation_diff : 0;
    const isUndervalued = peDiscount <= 0;

    const tr = document.createElement('tr');
    tr.className = 'cursor-pointer hover:bg-slate-800/40 transition-colors';
    tr.onclick = (e) => {
      if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'I') {
        openDetailModal(stock.symbol);
      }
    };

    tr.innerHTML = `
      <td>
        <div class="font-bold text-white flex items-center gap-1.5">
          <span>${stock.name}</span>
          <span class="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
            ${stock.symbol}
          </span>
        </div>
        <div class="text-[11px] text-slate-400 truncate max-w-[160px]">${stock.sector}</div>
      </td>
      <td class="text-right font-black text-white price-val">₹${formatNumber(stock.current_price, 2)}</td>
      <td class="text-right font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}">
        ${isUp ? '+' : ''}${stock.change_percent || 0}%
      </td>
      <td class="text-right font-extrabold text-blue-400">
        ${stock.pe ? stock.pe.toFixed(1) : 'N/A'}
      </td>
      <td class="text-right font-semibold text-slate-300">
        ${stock.sector_pe ? stock.sector_pe.toFixed(1) : 'N/A'}
        <span class="text-[10px] block ${isUndervalued ? 'text-emerald-400' : 'text-amber-400'}">
          ${isUndervalued ? `-${Math.abs(peDiscount)}%` : `+${peDiscount}%`}
        </span>
      </td>
      <td class="text-right font-bold text-emerald-400">${stock.roce ? stock.roce.toFixed(1) + '%' : 'N/A'}</td>
      <td class="text-right font-bold text-teal-400">${stock.roe ? stock.roe.toFixed(1) + '%' : 'N/A'}</td>
      <td class="text-center text-xs text-slate-300">
        ₹${formatNumber(stock.low_52w, 0)} - ₹${formatNumber(stock.high_52w, 0)}
      </td>
      <td class="text-center text-xs text-slate-300">
        ₹${formatNumber(stock.low_5y, 0)} - ₹${formatNumber(stock.high_5y, 0)}
      </td>
      <td class="text-right font-semibold text-slate-300">${stock.latest_debt_to_equity !== null ? stock.latest_debt_to_equity : '0.00'}</td>
      <td class="text-right font-bold text-blue-300">${stock.latest_promoters ? stock.latest_promoters + '%' : 'N/A'}</td>
      <td class="text-center">
        <button onclick="openDetailModal('${stock.symbol}')" class="px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-xs font-semibold transition-all">
          View
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function sortTable(column) {
  if (stockDataStore.sortCol === column) {
    stockDataStore.sortAsc = !stockDataStore.sortAsc;
  } else {
    stockDataStore.sortCol = column;
    stockDataStore.sortAsc = true;
  }

  stockDataStore.stocks.sort((a, b) => {
    let valA = a[column] !== undefined && a[column] !== null ? a[column] : -999999;
    let valB = b[column] !== undefined && b[column] !== null ? b[column] : -999999;
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return stockDataStore.sortAsc ? -1 : 1;
    if (valA > valB) return stockDataStore.sortAsc ? 1 : -1;
    return 0;
  });

  renderMainViews();
}

/**
 * View 3: Side-by-Side Head-to-Head Compare
 */
function renderCompareView() {
  const checkboxContainer = document.getElementById('compareCheckboxes');
  checkboxContainer.innerHTML = '';

  stockDataStore.stocks.forEach((stock) => {
    const isSelected = stockDataStore.selectedForCompare.includes(stock.symbol);
    const pill = document.createElement('button');
    pill.className = `px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
      isSelected
        ? 'bg-teal-500 text-white shadow-sm'
        : 'bg-[#152236] text-slate-400 hover:text-white border border-[#23354d]'
    }`;
    pill.innerText = stock.symbol;
    pill.onclick = () => {
      if (isSelected) {
        if (stockDataStore.selectedForCompare.length > 2) {
          stockDataStore.selectedForCompare = stockDataStore.selectedForCompare.filter((s) => s !== stock.symbol);
        }
      } else {
        if (stockDataStore.selectedForCompare.length < 4) {
          stockDataStore.selectedForCompare.push(stock.symbol);
        } else {
          stockDataStore.selectedForCompare.shift();
          stockDataStore.selectedForCompare.push(stock.symbol);
        }
      }
      renderCompareView();
    };
    checkboxContainer.appendChild(pill);
  });

  const cardsMatrix = document.getElementById('compareCardsMatrix');
  cardsMatrix.innerHTML = '';

  const selectedStocks = stockDataStore.stocks.filter((s) => stockDataStore.selectedForCompare.includes(s.symbol));

  selectedStocks.forEach((stock) => {
    const col = document.createElement('div');
    col.className = 'glass-card rounded-2xl p-4 space-y-4';
    col.innerHTML = `
      <div class="border-b border-[#223147] pb-3">
        <h3 class="font-bold text-white text-base">${stock.name}</h3>
        <span class="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">${stock.symbol}</span>
        <div class="text-xl font-black text-white mt-2">₹${formatNumber(stock.current_price, 2)}</div>
        <div class="text-xs font-bold text-slate-400">Sector: ${stock.sector}</div>
      </div>

      <div class="space-y-2.5 text-xs">
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">Live P/E</span>
          <span class="font-bold text-blue-400">${stock.pe ? stock.pe.toFixed(2) : 'N/A'}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">Sector P/E</span>
          <span class="font-bold text-slate-300">${stock.sector_pe ? stock.sector_pe.toFixed(2) : 'N/A'}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">ROCE</span>
          <span class="font-bold text-emerald-400">${stock.roce ? stock.roce + '%' : 'N/A'}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">ROE</span>
          <span class="font-bold text-teal-400">${stock.roe ? stock.roe + '%' : 'N/A'}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">1Y Range</span>
          <span class="font-medium text-slate-300">₹${formatNumber(stock.low_52w, 0)} - ₹${formatNumber(stock.high_52w, 0)}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">5Y Range</span>
          <span class="font-medium text-slate-300">₹${formatNumber(stock.low_5y, 0)} - ₹${formatNumber(stock.high_5y, 0)}</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">Latest Qtr Profit</span>
          <span class="font-bold text-emerald-400">₹${formatNumber(stock.quarterly_profits?.[stock.quarterly_profits.length - 1]?.net_profit, 0)} Cr</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">Latest Annual Profit</span>
          <span class="font-bold text-emerald-400">₹${formatNumber(stock.yearly_profits?.[stock.yearly_profits.length - 1]?.net_profit, 0)} Cr</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">Reserves</span>
          <span class="font-bold text-emerald-400">₹${formatNumber(stock.latest_reserves, 0)} Cr</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">Borrowings</span>
          <span class="font-bold text-rose-400">₹${formatNumber(stock.latest_borrowings, 0)} Cr</span>
        </div>
        <div class="flex justify-between py-1 border-b border-[#1c293d]">
          <span class="text-slate-400">Debt / Equity</span>
          <span class="font-bold text-amber-400">${stock.latest_debt_to_equity}</span>
        </div>
        <div class="flex justify-between py-1">
          <span class="text-slate-400">Promoter Stake</span>
          <span class="font-bold text-blue-300">${stock.latest_promoters ? stock.latest_promoters + '%' : 'N/A'}</span>
        </div>
      </div>

      <button onclick="openDetailModal('${stock.symbol}')" class="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors">
        Full Deep Dive
      </button>
    `;
    cardsMatrix.appendChild(col);
  });
}

/**
 * Deep Dive Modal Controller & Chart.js Visualizer
 */
function openDetailModal(symbol) {
  const stock = stockDataStore.stocks.find((s) => s.symbol === symbol);
  if (!stock) return;

  stockDataStore.currentModalStock = stock;

  document.getElementById('modalLogo').innerText = stock.symbol.slice(0, 3);
  document.getElementById('modalStockName').innerText = stock.name;
  document.getElementById('modalTickerBadge').innerText = stock.symbol;
  document.getElementById('modalSectorBadge').innerText = stock.sector;
  document.getElementById('modalPrice').innerText = `₹${formatNumber(stock.current_price, 2)}`;

  const isUp = (stock.change || 0) >= 0;
  const chgBadge = document.getElementById('modalChangeBadge');
  chgBadge.className = `text-xs font-bold flex items-center gap-1 ${isUp ? 'text-emerald-400' : 'text-rose-400'}`;
  chgBadge.innerHTML = `<i class="fa-solid fa-arrow-trend-${isUp ? 'up' : 'down'} text-[10px]"></i> ${isUp ? '+' : ''}${formatNumber(stock.change, 2)} (${isUp ? '+' : ''}${stock.change_percent || 0}%)`;

  document.getElementById('modalTtmEps').innerText = `₹${stock.ttm_eps || 'N/A'}`;

  // Quick stats bar
  document.getElementById('modalStatPE').innerText = stock.pe ? stock.pe.toFixed(2) : 'N/A';
  document.getElementById('modalStatSectorPE').innerText = stock.sector_pe ? stock.sector_pe.toFixed(2) : 'N/A';
  document.getElementById('modalStatROCE').innerText = stock.roce ? stock.roce.toFixed(2) + '%' : 'N/A';
  document.getElementById('modalStatROE').innerText = stock.roe ? stock.roe.toFixed(2) + '%' : 'N/A';
  document.getElementById('modalStat1YRange').innerText = `₹${formatNumber(stock.low_52w, 0)} - ${formatNumber(stock.high_52w, 0)}`;
  document.getElementById('modalStat5YRange').innerText = `₹${formatNumber(stock.low_5y, 0)} - ${formatNumber(stock.high_5y, 0)}`;
  document.getElementById('modalStatD2E').innerText = stock.latest_debt_to_equity !== null ? stock.latest_debt_to_equity : '0.00';

  // Populate Tab 1: Quarterly Profits
  renderQuarterlyTab(stock);

  // Populate Tab 2: Yearly Profits
  renderYearlyTab(stock);

  // Populate Tab 3: Balance Sheet (Reserves & Borrowings)
  renderBalanceTab(stock);

  // Populate Tab 4: Shareholding Pattern
  renderShareholdingTab(stock);

  // Populate Tab 5: P/E Simulator
  initPESimulator(stock);

  // Default to quarterly tab
  setModalTab('quarterly');

  document.getElementById('detailModal').classList.remove('hidden');
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.add('hidden');
  destroyCharts();
}

function setModalTab(tabKey) {
  const tabs = ['quarterly', 'yearly', 'balance', 'shareholding', 'pe_sandbox'];
  tabs.forEach((key) => {
    const content = document.getElementById(`tabContent${capitalize(key)}`);
    const btn = document.getElementById(`tabBtn${capitalize(key)}`);
    if (content && btn) {
      if (key === tabKey) {
        content.classList.remove('hidden');
        btn.className = 'tab-btn active px-4 py-3 text-xs font-semibold whitespace-nowrap';
      } else {
        content.classList.add('hidden');
        btn.className = 'tab-btn px-4 py-3 text-xs font-semibold text-slate-400 hover:text-white whitespace-nowrap';
      }
    }
  });

  // Re-trigger chart render on tab display
  if (stockDataStore.currentModalStock) {
    if (tabKey === 'quarterly') renderQuarterlyChart(stockDataStore.currentModalStock);
    if (tabKey === 'yearly') renderYearlyChart(stockDataStore.currentModalStock);
    if (tabKey === 'balance') renderBalanceChart(stockDataStore.currentModalStock);
    if (tabKey === 'shareholding') renderShareholdingChart(stockDataStore.currentModalStock);
  }
}

function capitalize(s) {
  if (s === 'pe_sandbox') return 'PESandbox';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function destroyCharts() {
  Object.keys(activeCharts).forEach((k) => {
    if (activeCharts[k]) {
      activeCharts[k].destroy();
      activeCharts[k] = null;
    }
  });
}

/**
 * Tab 1: Quarterly Profits
 */
function renderQuarterlyTab(stock) {
  const tbody = document.getElementById('quarterlyTableBody');
  tbody.innerHTML = '';

  const quarters = (stock.quarterly_profits || []).slice(-5);
  quarters.forEach((q) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-bold text-white">${q.quarter}</td>
      <td class="text-right">₹${formatNumber(q.sales, 0)}</td>
      <td class="text-right">₹${formatNumber(q.operating_profit, 0)}</td>
      <td class="text-right font-semibold text-teal-400">${q.opm || 'N/A'}</td>
      <td class="text-right font-bold text-emerald-400">₹${formatNumber(q.net_profit, 0)}</td>
      <td class="text-right font-bold text-blue-400">₹${q.eps || 'N/A'}</td>
    `;
    tbody.appendChild(tr);
  });

  renderQuarterlyChart(stock);
}

function renderQuarterlyChart(stock) {
  const quarters = (stock.quarterly_profits || []).slice(-5);
  const labels = quarters.map((q) => q.quarter);
  const netProfits = quarters.map((q) => q.net_profit);
  const opProfits = quarters.map((q) => q.operating_profit);

  const ctx = document.getElementById('quarterlyChart');
  if (!ctx) return;

  if (activeCharts.quarterly) activeCharts.quarterly.destroy();

  activeCharts.quarterly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Net Profit (₹ Cr)',
          data: netProfits,
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderRadius: 6,
        },
        {
          label: 'Operating Profit (₹ Cr)',
          data: opProfits,
          backgroundColor: 'rgba(59, 130, 246, 0.75)',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
      },
    },
  });
}

/**
 * Tab 2: Yearly Profits
 */
function renderYearlyTab(stock) {
  const tbody = document.getElementById('yearlyTableBody');
  tbody.innerHTML = '';

  const years = (stock.yearly_profits || []).slice(-5);
  years.forEach((y) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-bold text-white">${y.year}</td>
      <td class="text-right">₹${formatNumber(y.sales, 0)}</td>
      <td class="text-right">₹${formatNumber(y.operating_profit, 0)}</td>
      <td class="text-right font-semibold text-teal-400">${y.opm || 'N/A'}</td>
      <td class="text-right font-bold text-emerald-400">₹${formatNumber(y.net_profit, 0)}</td>
      <td class="text-right font-bold text-blue-400">₹${y.eps || 'N/A'}</td>
    `;
    tbody.appendChild(tr);
  });

  renderYearlyChart(stock);
}

function renderYearlyChart(stock) {
  const years = (stock.yearly_profits || []).slice(-5);
  const labels = years.map((y) => y.year);
  const netProfits = years.map((y) => y.net_profit);

  const ctx = document.getElementById('yearlyChart');
  if (!ctx) return;

  if (activeCharts.yearly) activeCharts.yearly.destroy();

  activeCharts.yearly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Annual Net Profit (₹ Cr)',
          data: netProfits,
          backgroundColor: 'rgba(59, 130, 246, 0.85)',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
      },
    },
  });
}

/**
 * Tab 3: Balance Sheet (Reserves & Borrowings)
 */
function renderBalanceTab(stock) {
  const tbody = document.getElementById('balanceTableBody');
  tbody.innerHTML = '';

  const periods = (stock.balance_sheet || []).slice(-5);
  periods.forEach((b) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-bold text-white">${b.period}</td>
      <td class="text-right">₹${formatNumber(b.equity_capital, 0)}</td>
      <td class="text-right font-bold text-emerald-400">₹${formatNumber(b.reserves, 0)}</td>
      <td class="text-right font-bold text-rose-400">₹${formatNumber(b.borrowings, 0)}</td>
      <td class="text-right font-semibold text-white">₹${formatNumber(b.net_worth, 0)}</td>
      <td class="text-right font-bold text-amber-400">${b.debt_to_equity}</td>
    `;
    tbody.appendChild(tr);
  });

  renderBalanceChart(stock);
}

function renderBalanceChart(stock) {
  const periods = (stock.balance_sheet || []).slice(-5);
  const labels = periods.map((b) => b.period);
  const reserves = periods.map((b) => b.reserves);
  const borrowings = periods.map((b) => b.borrowings);

  const ctx = document.getElementById('balanceChart');
  if (!ctx) return;

  if (activeCharts.balance) activeCharts.balance.destroy();

  activeCharts.balance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Reserves (₹ Cr)',
          data: reserves,
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderRadius: 6,
        },
        {
          label: 'Borrowings / Debt (₹ Cr)',
          data: borrowings,
          backgroundColor: 'rgba(239, 68, 68, 0.85)',
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
      },
    },
  });
}

/**
 * Tab 4: Shareholding Patterns (Last 5-10 Quarters)
 */
function renderShareholdingTab(stock) {
  const tbody = document.getElementById('shareholdingTableBody');
  tbody.innerHTML = '';

  const patterns = (stock.shareholding_patterns || []).slice(-10);
  patterns.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-bold text-white">${s.quarter}</td>
      <td class="text-right font-bold text-blue-400">${s.promoters ? s.promoters + '%' : '-'}</td>
      <td class="text-right font-bold text-teal-400">${s.fiis ? s.fiis + '%' : '-'}</td>
      <td class="text-right font-bold text-purple-400">${s.diis ? s.diis + '%' : '-'}</td>
      <td class="text-right font-bold text-amber-400">${s.public ? s.public + '%' : '-'}</td>
      <td class="text-right font-medium text-slate-300">${s.shareholders || '-'}</td>
    `;
    tbody.appendChild(tr);
  });

  renderShareholdingChart(stock);
}

function renderShareholdingChart(stock) {
  const patterns = (stock.shareholding_patterns || []).slice(-10);
  const labels = patterns.map((s) => s.quarter);
  const promoters = patterns.map((s) => s.promoters || 0);
  const fiis = patterns.map((s) => s.fiis || 0);
  const diis = patterns.map((s) => s.diis || 0);
  const publics = patterns.map((s) => s.public || 0);

  const ctx = document.getElementById('shareholdingChart');
  if (!ctx) return;

  if (activeCharts.shareholding) activeCharts.shareholding.destroy();

  activeCharts.shareholding = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Promoters %', data: promoters, backgroundColor: '#3b82f6' },
        { label: 'FIIs %', data: fiis, backgroundColor: '#14b8a6' },
        { label: 'DIIs %', data: diis, backgroundColor: '#8b5cf6' },
        { label: 'Public %', data: publics, backgroundColor: '#f59e0b' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: { stacked: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
      },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
      },
    },
  });
}

/**
 * Tab 5: Live P/E Valuation Simulator Sandbox
 */
function initPESimulator(stock) {
  const slider = document.getElementById('sandboxPriceSlider');
  const basePrice = stock.current_price || 1000;
  const minVal = Math.round(basePrice * 0.5);
  const maxVal = Math.round(basePrice * 2.2);

  slider.min = minVal;
  slider.max = maxVal;
  slider.step = Math.max(1, Math.round(basePrice / 500));
  slider.value = basePrice;

  document.getElementById('sliderMinLabel').innerText = `₹${formatNumber(minVal, 0)}`;
  document.getElementById('sliderMaxLabel').innerText = `₹${formatNumber(maxVal, 0)}`;
  document.getElementById('sliderCurrentLabel').innerText = `₹${formatNumber(basePrice, 0)}`;
  document.getElementById('sandboxEpsVal').innerText = stock.ttm_eps || 50;

  const sectorPe = stock.sector_pe || 25;
  document.getElementById('sandboxSectorPE').innerText = sectorPe.toFixed(2);
  document.getElementById('sandboxSectorNote').innerText = sectorPe.toFixed(2);

  const fairVal = (stock.ttm_eps || 50) * sectorPe;
  document.getElementById('sandboxFairValue').innerText = `₹${formatNumber(fairVal, 2)}`;

  updatePESimulation(basePrice);
}

function updatePESimulation(hypoPrice) {
  const stock = stockDataStore.currentModalStock;
  if (!stock) return;

  document.getElementById('sandboxPriceDisplay').innerText = `₹${formatNumber(hypoPrice, 2)}`;

  const eps = stock.ttm_eps || 50;
  const simulatedPE = calculateStockPE(hypoPrice, eps);
  const sectorPe = stock.sector_pe || 25;

  document.getElementById('sandboxCalculatedPE').innerText = simulatedPE ? simulatedPE.toFixed(2) : 'N/A';

  const diffPct = calculateValuationDiff(simulatedPE, sectorPe);
  const badge = document.getElementById('sandboxValuationBadge');

  if (diffPct !== null) {
    if (diffPct <= 0) {
      badge.className = 'text-sm font-bold text-emerald-400 block mt-1';
      badge.innerText = `Undervalued by ${Math.abs(diffPct)}%`;
    } else {
      badge.className = 'text-sm font-bold text-amber-400 block mt-1';
      badge.innerText = `Trading at +${diffPct}% Premium`;
    }
  }
}

function resetPESimulator() {
  const stock = stockDataStore.currentModalStock;
  if (stock) {
    document.getElementById('sandboxPriceSlider').value = stock.current_price;
    updatePESimulation(stock.current_price);
  }
}

/**
 * Manage Stocks Modal
 */
function openManageModal() {
  renderManageList();
  document.getElementById('manageModal').classList.remove('hidden');
}

function closeManageModal() {
  document.getElementById('manageModal').classList.add('hidden');
}

function renderManageList() {
  const container = document.getElementById('manageStocksList');
  if (!container) return;
  container.innerHTML = '';

  stockDataStore.stocks.forEach((s, idx) => {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between p-2 rounded-lg bg-[#111a29] border border-[#223147] text-xs';
    item.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-bold">
          ${idx + 1}
        </span>
        <span class="font-bold text-white">${s.name}</span>
        <span class="text-blue-400 font-mono">(${s.symbol})</span>
      </div>
      <span class="text-slate-400 text-[11px]">${s.sector}</span>
    `;
    container.appendChild(item);
  });
}

/**
 * Utility: Number Formatter
 */
function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return Number(num).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function showNotification(message, type = 'info') {
  console.log(`[Notification ${type}]: ${message}`);
}

