/* Shared physical-bank projection for the architecture and VN buffer views.
 * A displayed row is one VN per bank; its AH nested lanes are scalar rows.
 * Sparse active rows remain labeled with their real physical VN addresses. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports
    ? require('./feather_buffer_model.js') : root.FeatherBufferModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FeatherBufferView = api;
})(typeof window === 'object' ? window : globalThis, function (model) {
  'use strict';
  const PAGE_ROWS = 4, MAX_ROWS = 20;
  function dimensions(layout) {
    const AH = [4, 8, 16].includes(layout?.AH) ? layout.AH : 4;
    const AW = [4, 8, 16].includes(layout?.AW) ? layout.AW : 4;
    const total = Number.isSafeInteger(layout?.totalVNs) && layout.totalVNs > 0
      ? Math.ceil(layout.totalVNs / AW) : 0;
    return {AH, AW, total};
  }
  function windowFor(layout, activeCells = []) {
    const {AH, AW, total} = dimensions(layout);
    const active = [];
    for (const entry of activeCells.slice(0, MAX_ROWS * AW)) {
      const cell = entry?.cell || entry;
      if (!cell || entry.valid === false || cell.valid === false || cell.outOfCapacity) continue;
      const row = Number.isSafeInteger(cell.vnRow) ? cell.vnRow
        : Number.isSafeInteger(cell.scalarRow) ? Math.floor(cell.scalarRow / AH) : -1;
      const bank = cell.bank;
      if (!Number.isSafeInteger(row) || row < 0 || row >= total ||
          !Number.isSafeInteger(bank) || bank < 0 || bank >= AW ||
          row * AW + bank >= layout.totalVNs) continue;
      if (Number.isFinite(layout.capacityRows) &&
          row * AH + (Number.isSafeInteger(cell.lane) ? cell.lane : 0) >= layout.capacityRows) continue;
      active.push(row);
    }
    const anchor = active.length ? Math.min(...active) : 0;
    const start = Math.floor(anchor / PAGE_ROWS) * PAGE_ROWS;
    const rows = new Set(active.slice(0, MAX_ROWS));
    for (let row = start; row < Math.min(total, start + PAGE_ROWS); row++) rows.add(row);
    // Callers supply at most AW simultaneous transfers, so all live rows plus
    // their four-row neighborhood fit. Keep this API bounded for other callers.
    const vnRows = [...rows].sort((a, b) => a - b).slice(0, MAX_ROWS);
    return {vnRows, bankCount: AW, totalVNRows: total,
      signature: [AH, AW, layout?.order, ...(layout?.dims || []), ...vnRows].join(':')};
  }
  function laneHeight(layout) { return dimensions(layout).AH <= 4 ? 4 : dimensions(layout).AH <= 8 ? 3 : 2; }
  function height(layout, projection) {
    const {AH} = dimensions(layout);
    return 52 + 28 + (projection?.vnRows?.length || 0) * (14 + AH * laneHeight(layout) + 6);
  }
  function draw(ctx, layout, projection, region, options = {}) {
    const {AH, AW} = dimensions(layout), rows = projection?.vnRows || [];
    const color = options.color || '#607D8B', fill = options.fill || '#EEF2F5';
    const getCell = options.cellAt || ((bank, row) => model.scalar(layout, bank, row));
    const events = new Map();
    for (const event of options.events || []) {
      if (!event?.valid) continue;
      const key = event.bank + ':' + event.scalarRow;
      const entries = events.get(key) || [];
      entries.push(event); events.set(key, entries);
    }
    const laneH = laneHeight(layout), rowH = 14 + AH * laneH + 6;
    const bankW = Math.max(1, (region.width - 34 - 24) / AW);
    const cells = [];
    ctx.save();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = '8px sans-serif';
    const contiguous = rows.every((row, index) => !index || row === rows[index - 1] + 1);
    const rowLabel = rows.length ? (contiguous ? rows[0] + '–' + rows[rows.length - 1] : rows.join(',')) : 'none';
    ctx.fillText('VN rows ' + rowLabel + ' / ' + projection.totalVNRows + ' · each VN = ' + AH + ' scalar lanes',
      region.x + region.width / 2, region.y + 30, Math.max(1, region.width - 12));
    for (let bank = 0; bank < AW; bank++)
      ctx.fillText('B' + bank, region.x + 34 + (bank + .5) * bankW, region.y + 44, bankW - 1);
    rows.forEach((vnRow, rowIndex) => {
      const rowY = region.y + 52 + rowIndex * rowH;
      ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.font = '8px sans-serif';
      ctx.fillText('VNr' + vnRow, region.x + 30, rowY + rowH / 2, 29);
      for (let bank = 0; bank < AW; bank++) {
        const bankX = region.x + 34 + bank * bankW, vnCell = getCell(bank, vnRow * AH);
        const vnValid = Boolean(vnCell?.valid && !vnCell.outOfCapacity);
        ctx.fillStyle = vnValid ? fill : '#F2F2F2';
        ctx.fillRect(bankX + 1, rowY, Math.max(1, bankW - 2), rowH - 6);
        ctx.strokeStyle = vnValid ? color : '#BCC3C8'; ctx.lineWidth = .7;
        ctx.strokeRect(bankX + 1, rowY, Math.max(1, bankW - 2), rowH - 6);
        ctx.fillStyle = vnValid ? color : '#747B80'; ctx.textAlign = 'center'; ctx.font = '8px sans-serif';
        const coordinate = vnValid ? '(' + vnCell.first + ',' + vnCell.second + ')' : '—';
        ctx.fillText(coordinate, bankX + bankW / 2, rowY + 10, Math.max(1, bankW - 4));
        for (let lane = 0; lane < AH; lane++) {
          const scalarRow = vnRow * AH + lane, scalar = getCell(bank, scalarRow);
          const valid = Boolean(scalar?.valid && !scalar.outOfCapacity);
          const matches = events.get(bank + ':' + scalarRow) || [];
          const completed = matches.find(event => event.status === 'preview-written' || event.status === 'arrived');
          const active = completed || matches[0], status = active?.status || 'idle';
          const bounds = {x: bankX + 2, y: rowY + 14 + lane * laneH,
            width: Math.max(1, bankW - 4), height: laneH};
          ctx.fillStyle = valid ? active || scalar.written ? color : fill : '#E4E7E9';
          ctx.globalAlpha = valid && !active && scalar.written ? .5 : 1;
          ctx.fillRect(bounds.x, bounds.y, bounds.width, Math.max(1, laneH - .5));
          ctx.globalAlpha = 1;
          ctx.strokeStyle = valid ? color : '#BCC3C8'; ctx.lineWidth = .3;
          ctx.strokeRect(bounds.x, bounds.y, bounds.width, Math.max(1, laneH - .5));
          if (completed) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(bounds.x + bounds.width / 2 - 1, bounds.y + .5, 2, Math.max(1, laneH - 1.5));
          }
          cells.push({...scalar, bank, scalarRow, vnRow, vnIndex: vnRow * AW + bank, lane,
            label: scalar?.label || 'Unmapped', valid, written: Boolean(scalar?.written), status,
            x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
            width: bounds.width, height: bounds.height, bounds});
        }
      }
    });
    if (!layout?.valid || !rows.length) {
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = '9px sans-serif';
      ctx.fillText('Configure a valid layout to display physical buffer addresses',
        region.x + region.width / 2, region.y + 59, Math.max(1, region.width - 12));
    }
    ctx.restore();
    return cells;
  }
  function point(cells, bank, scalarRow) {
    const cell = cells?.find(item => item.valid && item.bank === bank && item.scalarRow === scalarRow);
    return cell ? [cell.x, cell.y] : null;
  }
  return {window: windowFor, height, draw, point};
});
