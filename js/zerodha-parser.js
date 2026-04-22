/**
 * zerodha-parser.js — Parser for Zerodha Kite Holdings CSV
 * Extracts equity holdings data for the 'Indian Stocks' section.
 * Exposes: window.ZerodhaParser
 */
(function (global) {
  'use strict';

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) throw new Error('CSV is empty or missing data rows');

    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const lineLower = lines[i].toLowerCase();
      if (lineLower.includes('instrument') || lineLower.includes('symbol')) {
        headerIdx = i;
        break;
      }
    }

    const headers = lines[headerIdx].split(',').map(h => h.replace(/["'\r]/g, '').trim().toLowerCase());
    
    // Find column indices defensively
    const colIdx = {
      instrument: headers.findIndex(h => h.startsWith('instrument') || h === 'symbol'),
      qty: headers.findIndex(h => h === 'qty.' || h === 'qty' || h === 'quantity'),
      avgCost: headers.findIndex(h => h === 'avg. cost' || h === 'avg cost' || h.includes('average')),
      ltp: headers.findIndex(h => h === 'ltp' || h === 'price' || h.includes('last price')),
      invested: headers.findIndex(h => h === 'invested' || h.includes('investment')),
      curVal: headers.findIndex(h => h === 'cur. val' || h === 'current value' || h === 'present value'),
      pnl: headers.findIndex(h => h === 'p&l' || h === 'profit' || h.includes('unrealised')),
      netChg: headers.findIndex(h => h.includes('net') && h.includes('chg')),
      dayChg: headers.findIndex(h => h.includes('day') && h.includes('chg'))
    };

    // Auto-fallback for standard Kite Exports if strict match fails
    if (colIdx.instrument === -1 && headers.length >= 7) {
      colIdx.instrument = 0; colIdx.qty = 1; colIdx.avgCost = 2; colIdx.ltp = 3;
      colIdx.invested = 4; colIdx.curVal = 5; colIdx.pnl = 6;
    }

    if (colIdx.instrument === -1 || colIdx.qty === -1 || colIdx.ltp === -1) {
      console.error('Parsed headers:', headers);
      throw new Error('Invalid CSV format: Missing required columns');
    }

    const holdings = [];
    let totalInvested = 0;
    let totalCurrentValue = 0;
    let totalPnL = 0;

    const cleanNum = (str) => {
      if (!str) return 0;
      return parseFloat(str.replace(/[^0-9.-]/g, '')) || 0;
    };

    for (let i = headerIdx + 1; i < lines.length; i++) {
      // Basic CSV split, ignores commas inside quotes if any (rare in Kite exports but good practice)
      const cols = [];
      let inQuote = false;
      let curStr = '';
      for (const char of lines[i]) {
        if (char === '"') inQuote = !inQuote;
        else if (char === ',' && !inQuote) {
          cols.push(curStr.trim());
          curStr = '';
        } else {
          curStr += char;
        }
      }
      cols.push(curStr.trim());

      const instrument = cols[colIdx.instrument];
      if (!instrument || instrument.startsWith('Total')) continue; // Skip total row if present

      const qty = cleanNum(cols[colIdx.qty]);
      if (qty === 0) continue; // Skip zero quantity holdings

      const avgCost = cleanNum(cols[colIdx.avgCost]);
      const ltp = cleanNum(cols[colIdx.ltp]);
      const invested = colIdx.invested !== -1 ? cleanNum(cols[colIdx.invested]) : (qty * avgCost);
      const curVal = colIdx.curVal !== -1 ? cleanNum(cols[colIdx.curVal]) : (qty * ltp);
      const pnl = colIdx.pnl !== -1 ? cleanNum(cols[colIdx.pnl]) : (curVal - invested);
      const netChg = colIdx.netChg !== -1 ? cleanNum(cols[colIdx.netChg]) : 0;
      const dayChg = colIdx.dayChg !== -1 ? cleanNum(cols[colIdx.dayChg]) : 0;

      totalInvested += invested;
      totalCurrentValue += curVal;
      totalPnL += pnl;

      holdings.push({
        instrument,
        qty,
        avgCost,
        ltp,
        invested,
        currentValue: curVal,
        pnl,
        netChangePct: netChg,
        dayChangePct: dayChg
      });
    }

    return {
      type: 'STOCKS_IN',
      broker: 'Zerodha',
      holdings,
      _summary: {
        totalInvested,
        totalCurrentValue,
        totalPnL
      }
    };
  }

  async function parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const result = parseCSV(e.target.result);
          result._filename = file.name;
          result._parsedAt = new Date().toISOString();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  global.ZerodhaParser = { parseFile };
})(window);
