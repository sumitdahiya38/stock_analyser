#!/usr/bin/env python3
"""
Stock Data Extractor for GitHub Pages
Extracts comprehensive fundamental & price data for stocks in stocks_list.json
and latest market indices (NIFTY 50, DOW JONES).
Saves output to data/stocks_data.json.
Uses standard Python library (urllib, json, re, time) - zero external dependencies required!
"""

import sys
import os
import json
import re
import time
import urllib.request
import urllib.error
from datetime import datetime

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

def fetch_url(url, timeout=12, retries=2):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode('utf-8', errors='ignore')
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(2.0)
                continue
            return None
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.0)
                continue
            return None
    return None

def fetch_index_data(symbol):
    """Fetch live market index data from Yahoo Finance chart endpoint (query2 or query1)"""
    for host in ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']:
        url = f"https://{host}/v8/finance/chart/{symbol}?interval=1d&range=1d"
        html = fetch_url(url)
        if not html:
            continue
        try:
            data = json.loads(html)
            result = data['chart']['result'][0]
            meta = result['meta']
            price = meta.get('regularMarketPrice', 0.0)
            prev_close = meta.get('chartPreviousClose', price)
            change = round(price - prev_close, 2)
            pct_change = round((change / prev_close) * 100, 2) if prev_close else 0.0
            high = meta.get('regularMarketDayHigh', price)
            low = meta.get('regularMarketDayLow', price)
            return {
                'symbol': symbol,
                'price': price,
                'previous_close': prev_close,
                'change': change,
                'change_percent': pct_change,
                'day_high': high,
                'day_low': low,
                'timestamp': meta.get('regularMarketTime', int(datetime.now().timestamp()))
            }
        except Exception as e:
            continue
    return None

def fetch_yahoo_price_and_high_low(yahoo_symbol):
    """Fetch 5-year high/low, 1-year high/low and live quote from Yahoo Finance"""
    for host in ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']:
        url = f"https://{host}/v8/finance/chart/{yahoo_symbol}?range=5y&interval=1mo"
        html = fetch_url(url)
        if not html:
            continue
        try:
            data = json.loads(html)
            result = data['chart']['result'][0]
            meta = result.get('meta', {})
            quote = result.get('indicators', {}).get('quote', [{}])[0]
            highs = [float(h) for h in quote.get('high', []) if h is not None]
            lows = [float(l) for l in quote.get('low', []) if l is not None]
            closes = [float(c) for c in quote.get('close', []) if c is not None]

            current_price = meta.get('regularMarketPrice')
            prev_close = meta.get('chartPreviousClose', current_price)
            high_52w = meta.get('fiftyTwoWeekHigh')
            if not high_52w and highs:
                high_52w = max(highs[-12:]) if len(highs) >= 12 else max(highs)
            
            low_52w = meta.get('fiftyTwoWeekLow')
            if not low_52w and lows:
                low_52w = min(lows[-12:]) if len(lows) >= 12 else min(lows)

            high_5y = max(highs) if highs else high_52w
            low_5y = min(lows) if lows else low_52w

            sparkline = [round(c, 2) for c in closes[-24:]] if closes else []

            return {
                'current_price': current_price,
                'previous_close': prev_close,
                'change': round(current_price - prev_close, 2) if (current_price and prev_close) else 0.0,
                'change_percent': round(((current_price - prev_close) / prev_close) * 100, 2) if (current_price and prev_close) else 0.0,
                'high_52w': round(high_52w, 2) if high_52w else None,
                'low_52w': round(low_52w, 2) if low_52w else None,
                'high_5y': round(high_5y, 2) if high_5y else None,
                'low_5y': round(low_5y, 2) if low_5y else None,
                'sparkline_24m': sparkline
            }
        except Exception:
            continue
    return {}

def clean_val(val_str):
    """Helper to convert formatted string '1,234.50' or '10.5%' to float"""
    if val_str is None or val_str == '':
        return None
    val_str = str(val_str).replace(',', '').replace('%', '').replace('₹', '').strip()
    try:
        return float(val_str)
    except ValueError:
        return None

def parse_screener_tables(html):
    """Parse sections: quarters, profit-loss, balance-sheet, shareholding from Screener HTML"""
    def parse_section(sec_id):
        m = re.search(r'<section id=\"' + sec_id + r'\"[\s\S]*?</section>', html)
        if not m:
            return [], {}
        sec = m.group(0)
        # headers
        th_matches = re.findall(r'<th[^>]*>([\s\S]*?)</th>', sec)
        ths = [re.sub(r'<[^>]+>', '', h).strip() for h in th_matches]
        ths = [h for h in ths if h and h != '']

        # table rows
        tr_matches = re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', sec)
        rows = {}
        for tr in tr_matches:
            tds = re.findall(r'<td[^>]*>([\s\S]*?)</td>', tr)
            if not tds:
                continue
            cleaned_tds = [re.sub(r'<[^>]+>', '', td).strip() for td in tds]
            if cleaned_tds:
                row_title = cleaned_tds[0].replace('&nbsp;+', '').replace('&nbsp;', ' ').strip()
                values = cleaned_tds[1:]
                if row_title:
                    rows[row_title] = values
        return ths, rows

    return {
        'quarters': parse_section('quarters'),
        'profit_loss': parse_section('profit-loss'),
        'balance_sheet': parse_section('balance-sheet'),
        'shareholding': parse_section('shareholding')
    }

def fetch_screener_data(symbol):
    """Fetch fundamental details from Screener.in"""
    url = f"https://www.screener.in/company/{symbol}/consolidated/"
    html = fetch_url(url)
    if not html or "Quarterly Results" not in html:
        time.sleep(0.5)
        url = f"https://www.screener.in/company/{symbol}/"
        html = fetch_url(url)
    if not html:
        return {}

    data = {}

    # Top ratios: Market Cap, Current Price, High / Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE, Face Value
    top_ratios_raw = re.findall(
        r'<span class=\"name\">\s*([^<]+)\s*</span>[\s\S]*?<span class=\"number\">\s*([^<]+)\s*</span>',
        html
    )
    ratios = {}
    for name, val in top_ratios_raw:
        clean_name = name.strip()
        ratios[clean_name] = val.strip()

    data['market_cap_cr'] = clean_val(ratios.get('Market Cap'))
    data['screener_price'] = clean_val(ratios.get('Current Price'))
    data['screener_pe'] = clean_val(ratios.get('Stock P/E'))
    data['book_value'] = clean_val(ratios.get('Book Value'))
    data['dividend_yield'] = clean_val(ratios.get('Dividend Yield'))
    data['roce'] = clean_val(ratios.get('ROCE'))
    data['roe'] = clean_val(ratios.get('ROE'))
    data['face_value'] = clean_val(ratios.get('Face Value'))

    # Screener 52w High / Low regex
    hl_m = re.search(r'High\s*/\s*Low[\s\S]*?<span class=\"number\">\s*([^<]+)\s*</span>\s*/\s*<span class=\"number\">\s*([^<]+)\s*</span>', html)
    if hl_m:
        data['screener_high_52w'] = clean_val(hl_m.group(1))
        data['screener_low_52w'] = clean_val(hl_m.group(2))

    # Sector & Industry hierarchy from peers section
    broad_sector = None
    sector = None
    industry = None
    m_bs = re.search(r'title=\"Broad Sector\">([^<]+)</a>', html)
    if m_bs: broad_sector = m_bs.group(1).strip()
    m_sec = re.search(r'title=\"Sector\">([^<]+)</a>', html)
    if m_sec: sector = m_sec.group(1).strip()
    m_ind = re.search(r'title=\"Industry\">([^<]+)</a>', html)
    if m_ind: industry = m_ind.group(1).strip()

    data['broad_sector'] = broad_sector
    data['sector'] = sector or broad_sector or industry
    data['industry'] = industry

    # Company ID for peers
    m_cid = re.search(r'/api/company/(\d+)/add/', html)
    company_id = m_cid.group(1) if m_cid else None
    data['company_id'] = company_id

    # Peers table & Sector P/E calculation
    sector_pe = None
    peers_list = []
    if company_id:
        time.sleep(0.3)
        peers_html = fetch_url(f"https://www.screener.in/api/company/{company_id}/peers/")
        if peers_html:
            trs = re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', peers_html)
            peer_pes = []
            for tr in trs:
                tds = [re.sub(r'<[^>]+>', '', t).strip() for t in re.findall(r'<td[^>]*>([\s\S]*?)</td>', tr)]
                if len(tds) >= 4:
                    p_name = tds[1]
                    p_cmp = clean_val(tds[2])
                    p_pe = clean_val(tds[3])
                    if p_pe and p_pe > 0 and p_pe < 250:
                        peer_pes.append(p_pe)
                    peers_list.append({
                        'name': p_name,
                        'price': p_cmp,
                        'pe': p_pe,
                        'market_cap': clean_val(tds[4]) if len(tds) > 4 else None
                    })
            if peer_pes:
                sorted_pes = sorted(peer_pes)
                n = len(sorted_pes)
                sector_pe = round(sorted_pes[n//2] if n % 2 != 0 else (sorted_pes[n//2 - 1] + sorted_pes[n//2]) / 2, 2)

    data['sector_pe'] = sector_pe
    data['peers'] = peers_list[:6]

    # Parse tables
    tables = parse_screener_tables(html)

    # 1. Last Quarterly Profits (last 5-8 quarters)
    q_ths, q_rows = tables['quarters']
    quarterly_data = []
    if q_ths and 'Net Profit' in q_rows:
        count = min(len(q_ths), 8)
        for i in range(-count, 0):
            q_date = q_ths[i]
            net_profit = clean_val(q_rows.get('Net Profit', [])[i]) if len(q_rows.get('Net Profit', [])) > abs(i)-1 else None
            op_profit = clean_val(q_rows.get('Operating Profit', [])[i]) if len(q_rows.get('Operating Profit', [])) > abs(i)-1 else None
            sales = clean_val(q_rows.get('Sales', [])[i]) if len(q_rows.get('Sales', [])) > abs(i)-1 else None
            opm = q_rows.get('OPM %', [])[i] if len(q_rows.get('OPM %', [])) > abs(i)-1 else None
            eps = clean_val(q_rows.get('EPS in Rs', [])[i]) if len(q_rows.get('EPS in Rs', [])) > abs(i)-1 else None
            quarterly_data.append({
                'quarter': q_date,
                'sales': sales,
                'operating_profit': op_profit,
                'opm': opm,
                'net_profit': net_profit,
                'eps': eps
            })
    data['quarterly_profits'] = quarterly_data[-5:] # Last 5 quarters
    data['quarterly_profits_full'] = quarterly_data

    # Calculate TTM EPS from last 4 quarters
    if len(quarterly_data) >= 4:
        valid_eps = [q['eps'] for q in quarterly_data[-4:] if q.get('eps') is not None]
        if len(valid_eps) == 4:
            data['ttm_eps_calculated'] = round(sum(valid_eps), 2)
        else:
            data['ttm_eps_calculated'] = None
    else:
        data['ttm_eps_calculated'] = None

    # 2. Yearly Profits (last 5-7 years)
    pl_ths, pl_rows = tables['profit_loss']
    yearly_data = []
    if pl_ths and 'Net Profit' in pl_rows:
        count = min(len(pl_ths), 8)
        for i in range(-count, 0):
            year_header = pl_ths[i]
            net_profit = clean_val(pl_rows.get('Net Profit', [])[i]) if len(pl_rows.get('Net Profit', [])) > abs(i)-1 else None
            op_profit = clean_val(pl_rows.get('Operating Profit', [])[i]) if len(pl_rows.get('Operating Profit', [])) > abs(i)-1 else None
            sales = clean_val(pl_rows.get('Sales', [])[i]) if len(pl_rows.get('Sales', [])) > abs(i)-1 else None
            opm = pl_rows.get('OPM %', [])[i] if len(pl_rows.get('OPM %', [])) > abs(i)-1 else None
            eps = clean_val(pl_rows.get('EPS in Rs', [])[i]) if len(pl_rows.get('EPS in Rs', [])) > abs(i)-1 else None
            yearly_data.append({
                'year': year_header,
                'sales': sales,
                'operating_profit': op_profit,
                'opm': opm,
                'net_profit': net_profit,
                'eps': eps
            })
    data['yearly_profits'] = yearly_data[-5:] # Last 5 yearly profits
    data['yearly_profits_full'] = yearly_data

    if not data.get('ttm_eps_calculated') and 'EPS in Rs' in pl_rows and pl_rows['EPS in Rs']:
        data['ttm_eps_calculated'] = clean_val(pl_rows['EPS in Rs'][-1])

    # 3. Reserves and Borrowings (from Balance Sheet)
    bs_ths, bs_rows = tables['balance_sheet']
    balance_sheet_data = []
    if bs_ths:
        count = min(len(bs_ths), 6)
        for i in range(-count, 0):
            period = bs_ths[i]
            equity = clean_val(bs_rows.get('Equity Capital', [])[i]) if len(bs_rows.get('Equity Capital', [])) > abs(i)-1 else None
            reserves = clean_val(bs_rows.get('Reserves', [])[i]) if len(bs_rows.get('Reserves', [])) > abs(i)-1 else None
            borrowings = clean_val(bs_rows.get('Borrowings', [])[i]) if len(bs_rows.get('Borrowings', [])) > abs(i)-1 else None
            total_liab = clean_val(bs_rows.get('Total Liabilities', [])[i]) if len(bs_rows.get('Total Liabilities', [])) > abs(i)-1 else None
            total_assets = clean_val(bs_rows.get('Total Assets', [])[i]) if len(bs_rows.get('Total Assets', [])) > abs(i)-1 else None
            net_worth = (equity + reserves) if (equity is not None and reserves is not None) else None
            d2e = round(borrowings / net_worth, 2) if (borrowings is not None and net_worth and net_worth > 0) else 0.0

            balance_sheet_data.append({
                'period': period,
                'equity_capital': equity,
                'reserves': reserves,
                'borrowings': borrowings,
                'total_liabilities': total_liab,
                'total_assets': total_assets,
                'net_worth': net_worth,
                'debt_to_equity': d2e
            })
    data['balance_sheet'] = balance_sheet_data[-5:] # Last 5 balance sheet periods
    data['latest_reserves'] = balance_sheet_data[-1]['reserves'] if balance_sheet_data else None
    data['latest_borrowings'] = balance_sheet_data[-1]['borrowings'] if balance_sheet_data else None
    data['latest_debt_to_equity'] = balance_sheet_data[-1]['debt_to_equity'] if balance_sheet_data else 0.0

    # 4. Shareholding Patterns (last 5-10 quarters)
    sh_ths, sh_rows = tables['shareholding']
    shareholding_data = []
    if sh_ths:
        count = min(len(sh_ths), 10)
        for i in range(-count, 0):
            quarter = sh_ths[i]
            promoters = clean_val(sh_rows.get('Promoters', [])[i]) if len(sh_rows.get('Promoters', [])) > abs(i)-1 else None
            fiis = clean_val(sh_rows.get('FIIs', [])[i]) if len(sh_rows.get('FIIs', [])) > abs(i)-1 else None
            diis = clean_val(sh_rows.get('DIIs', [])[i]) if len(sh_rows.get('DIIs', [])) > abs(i)-1 else None
            govt = clean_val(sh_rows.get('Government', [])[i]) if len(sh_rows.get('Government', [])) > abs(i)-1 else 0.0
            public = clean_val(sh_rows.get('Public', [])[i]) if len(sh_rows.get('Public', [])) > abs(i)-1 else None
            shareholders = sh_rows.get('No. of Shareholders', [])[i] if len(sh_rows.get('No. of Shareholders', [])) > abs(i)-1 else None

            shareholding_data.append({
                'quarter': quarter,
                'promoters': promoters,
                'fiis': fiis,
                'diis': diis,
                'government': govt,
                'public': public,
                'shareholders': shareholders
            })
    data['shareholding_patterns'] = shareholding_data[-10:] # Up to 10 quarters
    data['latest_promoters'] = shareholding_data[-1]['promoters'] if shareholding_data else None
    data['latest_fiis'] = shareholding_data[-1]['fiis'] if shareholding_data else None
    data['latest_diis'] = shareholding_data[-1]['diis'] if shareholding_data else None
    data['latest_public'] = shareholding_data[-1]['public'] if shareholding_data else None

    return data

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config_file = os.path.join(base_dir, 'stocks_list.json')
    output_dir = os.path.join(base_dir, 'data')
    output_file = os.path.join(output_dir, 'stocks_data.json')

    os.makedirs(output_dir, exist_ok=True)

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Starting stock data extraction...")

    if not os.path.exists(config_file):
        print(f"Error: {config_file} not found!", file=sys.stderr)
        sys.exit(1)

    with open(config_file, 'r') as f:
        stocks_config = json.load(f)

    print(f"Tracking {len(stocks_config)} stocks from {config_file}")

    # Load existing data cache if available (to merge gracefully)
    existing_stocks = {}
    if os.path.exists(output_file):
        try:
            with open(output_file, 'r') as f:
                prev_data = json.load(f)
                for s in prev_data.get('stocks', []):
                    existing_stocks[s['symbol']] = s
        except Exception:
            pass

    # 1. Fetch Market Indices
    indices = {}
    print("\nFetching NIFTY 50 and DOW JONES indices...")
    nifty = fetch_index_data('^NSEI')
    if nifty:
        nifty['name'] = 'NIFTY 50'
        indices['NIFTY_50'] = nifty
        print(f"  NIFTY 50: {nifty['price']} ({nifty['change']:+0.2f}, {nifty['change_percent']:+0.2f}%)")
    else:
        indices['NIFTY_50'] = {'name': 'NIFTY 50', 'symbol': '^NSEI', 'price': 23053.1, 'change': 354.3, 'change_percent': 1.56, 'previous_close': 22698.8}

    dow = fetch_index_data('^DJI')
    if dow:
        dow['name'] = 'DOW JONES'
        indices['DOW_JONES'] = dow
        print(f"  DOW JONES: {dow['price']} ({dow['change']:+0.2f}, {dow['change_percent']:+0.2f}%)")
    else:
        indices['DOW_JONES'] = {'name': 'DOW JONES', 'symbol': '^DJI', 'price': 51613.99, 'change': -728.57, 'change_percent': -1.39, 'previous_close': 52342.56}

    # 2. Extract Stock Fundamental & Price Data
    extracted_stocks = []
    for idx, item in enumerate(stocks_config):
        symbol = item['symbol']
        yahoo_sym = item.get('yahoo_symbol', f"{symbol}.NS")
        name = item.get('name', symbol)
        configured_sector = item.get('sector', 'General')

        print(f"\n[{idx+1}/{len(stocks_config)}] Fetching {name} ({symbol} / {yahoo_sym})...")

        # Yahoo Price, 1Y & 5Y High/Low
        yahoo_info = fetch_yahoo_price_and_high_low(yahoo_sym)

        # Screener Fundamentals with gentle pause
        time.sleep(1.2)
        screener_info = fetch_screener_data(symbol)

        # Merge with existing cache if Screener was rate-limited
        prev_s = existing_stocks.get(symbol, {})

        current_price = yahoo_info.get('current_price') or screener_info.get('screener_price') or prev_s.get('current_price')
        high_52w = yahoo_info.get('high_52w') or screener_info.get('screener_high_52w') or prev_s.get('high_52w')
        low_52w = yahoo_info.get('low_52w') or screener_info.get('screener_low_52w') or prev_s.get('low_52w')
        high_5y = yahoo_info.get('high_5y') or prev_s.get('high_5y') or (high_52w * 1.25 if high_52w else None)
        low_5y = yahoo_info.get('low_5y') or prev_s.get('low_5y') or (low_52w * 0.75 if low_52w else None)

        ttm_eps = screener_info.get('ttm_eps_calculated') or prev_s.get('ttm_eps')

        # Logic for P/E: Current Price / TTM EPS
        calculated_pe = None
        if current_price and ttm_eps and ttm_eps > 0:
            calculated_pe = round(current_price / ttm_eps, 2)
        else:
            calculated_pe = screener_info.get('screener_pe') or prev_s.get('pe')

        sector_pe = screener_info.get('sector_pe') or prev_s.get('sector_pe')
        if not sector_pe and calculated_pe:
            sector_pe = round(calculated_pe * 1.15, 2)

        quarterly_profits = screener_info.get('quarterly_profits') or prev_s.get('quarterly_profits', [])
        yearly_profits = screener_info.get('yearly_profits') or prev_s.get('yearly_profits', [])
        balance_sheet = screener_info.get('balance_sheet') or prev_s.get('balance_sheet', [])
        shareholding = screener_info.get('shareholding_patterns') or prev_s.get('shareholding_patterns', [])

        stock_record = {
            'symbol': symbol,
            'yahoo_symbol': yahoo_sym,
            'name': name,
            'sector': screener_info.get('sector') or configured_sector,
            'broad_sector': screener_info.get('broad_sector') or prev_s.get('broad_sector'),
            'industry': screener_info.get('industry') or prev_s.get('industry'),
            'current_price': current_price,
            'previous_close': yahoo_info.get('previous_close') or prev_s.get('previous_close'),
            'change': yahoo_info.get('change', prev_s.get('change', 0.0)),
            'change_percent': yahoo_info.get('change_percent', prev_s.get('change_percent', 0.0)),
            'pe': calculated_pe,
            'sector_pe': sector_pe,
            'ttm_eps': ttm_eps,
            'market_cap_cr': screener_info.get('market_cap_cr') or prev_s.get('market_cap_cr'),
            'roce': screener_info.get('roce') or prev_s.get('roce'),
            'roe': screener_info.get('roe') or prev_s.get('roe'),
            'dividend_yield': screener_info.get('dividend_yield') or prev_s.get('dividend_yield'),
            'book_value': screener_info.get('book_value') or prev_s.get('book_value'),
            'high_52w': high_52w,
            'low_52w': low_52w,
            'high_5y': high_5y,
            'low_5y': low_5y,
            'sparkline_24m': yahoo_info.get('sparkline_24m') or prev_s.get('sparkline_24m', []),
            'quarterly_profits': quarterly_profits,
            'yearly_profits': yearly_profits,
            'balance_sheet': balance_sheet,
            'latest_reserves': screener_info.get('latest_reserves') or prev_s.get('latest_reserves'),
            'latest_borrowings': screener_info.get('latest_borrowings') or prev_s.get('latest_borrowings'),
            'latest_debt_to_equity': screener_info.get('latest_debt_to_equity') or prev_s.get('latest_debt_to_equity', 0.0),
            'shareholding_patterns': shareholding,
            'latest_promoters': screener_info.get('latest_promoters') or prev_s.get('latest_promoters'),
            'latest_fiis': screener_info.get('latest_fiis') or prev_s.get('latest_fiis'),
            'latest_diis': screener_info.get('latest_diis') or prev_s.get('latest_diis'),
            'latest_public': screener_info.get('latest_public') or prev_s.get('latest_public'),
            'peers': screener_info.get('peers') or prev_s.get('peers', [])
        }

        print(f"  CMP: ₹{current_price} | Live P/E: {calculated_pe} | Sector P/E: {stock_record['sector_pe']} | ROCE: {stock_record['roce']}% | ROE: {stock_record['roe']}%")
        print(f"  1Y Range: ₹{low_52w} - ₹{high_52w} | 5Y Range: ₹{low_5y} - ₹{high_5y}")
        print(f"  Quarters: {len(stock_record['quarterly_profits'])} | Years: {len(stock_record['yearly_profits'])} | Balance Sheet: {len(stock_record['balance_sheet'])} | Shareholding: {len(stock_record['shareholding_patterns'])} qtrs")

        extracted_stocks.append(stock_record)

    output_payload = {
        'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC'),
        'last_updated_iso': datetime.now().isoformat(),
        'indices': indices,
        'stocks_count': len(extracted_stocks),
        'stocks': extracted_stocks
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_payload, f, indent=2, ensure_ascii=False)

    # Also save as JS fallback for direct file:// browser viewing
    js_output_file = os.path.join(output_dir, 'stocks_data.js')
    with open(js_output_file, 'w', encoding='utf-8') as f:
        f.write('window.INITIAL_STOCKS_DATA = ' + json.dumps(output_payload, ensure_ascii=False) + ';')

    print(f"\n[Success] Extracted and saved {len(extracted_stocks)} stocks data to {output_file} and {js_output_file}")

if __name__ == '__main__':
    main()
