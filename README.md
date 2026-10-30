# 📈 EquiPulse | Live Stock Fundamentals & Multi-Share Valuation Dashboard

A responsive, modern financial website built for static deployment on **GitHub Pages**. EquiPulse enables investors to track, analyze, and compare 5–10 stocks in one go across their fundamental metrics, valuation ratios, balance sheets, and historical earnings.

---

## 🌟 Key Features & Metrics Displayed

For every stock configured in `stocks_list.json`, EquiPulse extracts, calculates, and interactively displays:

1. **Current Stock Price (CMP)**: Real-time price tracking with daily point change and percentage gain/loss.
2. **Dynamic P/E & Sector P/E**:
   - **Dynamic Recalculation Engine**: Computes $P/E = \frac{\text{Current Stock Price}}{\text{TTM EPS}}$ live on page load, refresh, or slider simulation.
   - **Sector P/E Benchmark**: Compares stock P/E against the industry median, showing whether the stock is trading at a discount or premium.
3. **ROCE & ROE**: Return on Capital Employed (ROCE) and Return on Equity (ROE) profitability indicators.
4. **1-Year & 5-Year High/Low**: Visual position bars showing where the current price sits between 52-week High/Low and 5-Year High/Low.
5. **Last 5 Quarterly Profits**: Interactive Chart.js bar chart and table covering Sales, Operating Profit, Operating Margin (OPM %), Net Profit, and Quarterly EPS.
6. **Last 5 Yearly Profits**: Historical 5-year financial trajectory with annual Sales, Operating Profit, Net Profit, and Annual EPS.
7. **Reserves & Borrowings (Balance Sheet Trend)**: Interactive debt-to-equity trend chart comparing corporate reserves vs total borrowings over time.
8. **Shareholding Pattern (Last 5–10 Quarters)**: Stacked bar chart showing the historical evolution of Promoters, FIIs, DIIs, Government, and Public ownership.
9. **Market Benchmark Tickers**: Live quotes for **NIFTY 50** and **DOW JONES** at the top of the screen.

---

## 🖥️ Interactive Viewing Modes

Designed so you can **view and compare 5 to 10 shares in one go**:

- **Multi-Card Grid View**: Comprehensive, glanceable cards for all 10 shares side-by-side with mini profit trend bars, high/low range meters, and debt status.
- **Master Comparison Table**: Sortable financial table comparing all 10 stocks on any column (sort by P/E, ROCE, ROE, CMP, Debt/Equity, or Promoter holding).
- **Head-to-Head Compare**: Pick any 2 to 4 stocks and compare their balance sheet and valuation metrics side-by-side.
- **Deep-Dive Analysis Modal**: Tabbed view with full interactive Chart.js charts and an **Interactive P/E Simulator Sandbox** (drag the slider to see how P/E shifts with hypothetical price movements).

---

## 🚀 How to Deploy to GitHub Pages

Because EquiPulse is built with pure static web standards (HTML5, Tailwind CSS, Chart.js, ES6 modules), it requires **no Node.js build step** and deploys to GitHub Pages in seconds:

### Option A: Using the Automated GitHub Actions Workflow (Recommended)

1. Create a repository on GitHub (e.g., `stock_analyser`).
2. Push this project to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of EquiPulse Stock Analyzer"
   git branch -M main
   git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
   git push -u origin main
   ```
3. Go to **Settings** → **Pages** in your GitHub repository.
4. Under **Build and deployment** → **Source**, select **GitHub Actions**.
5. The included workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) will automatically:
   - Extract the latest stock and index data via Python.
   - Deploy your site to `https://<YOUR_USERNAME>.github.io/<REPO_NAME>/`.
   - Re-run automatically every weekday after market hours (or on demand via the "Run workflow" button).

### Option B: Deploy from Branch

1. In GitHub **Settings** → **Pages**, select **Deploy from a branch**.
2. Select the `main` branch and `/ (root)` folder, then click **Save**.
3. Your site will be live within 1–2 minutes!

---

## 🛠️ Data Extraction Logic (`scripts/extract_data.py`)

EquiPulse includes a data extraction script that uses standard Python libraries (zero external dependencies required):

```bash
# Run anytime to fetch fresh fundamentals and live index quotes
python3 scripts/extract_data.py
```

### Extraction Workflow:
1. Reads the list of stocks from [`stocks_list.json`](stocks_list.json).
2. Queries the Yahoo Finance quote endpoint to fetch **NIFTY 50 (`^NSEI`)**, **DOW JONES (`^DJI`)**, and 5-year historical prices.
3. Scrapes consolidated fundamental financial statements from Screener.in:
   - Top ratios (ROCE, ROE, Market Cap, 52W High/Low).
   - Peer comparison table (calculates the median Sector P/E).
   - Last 5 quarters of profit & loss statements.
   - Last 5 years of annual financial statements.
   - Balance sheet reserves and borrowings.
   - 5 to 10 quarters of shareholding patterns.
4. Calculates Trailing Twelve Months (TTM) EPS and writes a structured JSON payload to [`data/stocks_data.json`](data/stocks_data.json).

---

## ⚙️ Customizing the Stock List

To track different stocks, edit [`stocks_list.json`](stocks_list.json):

```json
[
  {
    "symbol": "RELIANCE",
    "yahoo_symbol": "RELIANCE.NS",
    "name": "Reliance Industries Ltd",
    "sector": "Energy & Petrochemicals"
  },
  {
    "symbol": "TCS",
    "yahoo_symbol": "TCS.NS",
    "name": "Tata Consultancy Services",
    "sector": "IT Services"
  }
]
```

After modifying the file, run `python3 scripts/extract_data.py` to fetch their complete fundamentals!

---

## 🧮 Live P/E Calculation Formula

On page refresh and in the interactive simulator, the P/E ratio is dynamically computed in client-side JavaScript:

$$\text{P/E Ratio} = \frac{\text{Live Stock Price (CMP)}}{\text{TTM EPS}}$$

$$\text{Valuation Discount / Premium \%} = \frac{\text{Stock P/E} - \text{Sector P/E}}{\text{Sector P/E}} \times 100$$

- **Discount (Undervalued)**: Displayed with an emerald badge when Stock P/E < Sector P/E.
- **Premium (Overvalued)**: Displayed with an amber badge when Stock P/E > Sector P/E.

---

## 🧪 Local Testing

To test locally in your browser:
```bash
# Start a local web server
python3 -m http.server 8000
```
Then open `http://localhost:8000` in any web browser!
