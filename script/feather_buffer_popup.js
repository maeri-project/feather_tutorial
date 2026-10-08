/* Physical scalar-address inspector for the tutorial's shared animation clock. */
(function (global) {
  'use strict';

  const KINDS = {
    I: {name: 'Streaming / inputs', short: 'Streaming', color: '#004C99'},
    W: {name: 'Stationary / weights', short: 'Stationary', color: '#006633'},
    O: {name: 'Output / results', short: 'Output', color: '#990000'}
  };
  const PAGE_ROWS = 8;
  const MAX_BANKS = 16;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(id, text, action) {
    const node = element('button', 'mg-buffer-button', text);
    node.type = 'button';
    if (id) node.id = id;
    if (action) node.addEventListener('click', action);
    return node;
  }

  function integer(value, fallback) {
    return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  }

  function create(options) {
    options = options || {};
    let operand = 'I';
    let pageStart = 0;
    let selected = null;
    let opener = null;
    let opened = false;
    let gridKey = '';
    let eventKey = '';
    let renderedRevision = null;
    let pageCells = [];
    let latestLayout = {bankCount: 0, rowCount: 0};

    const panel = element('section', 'mg-buffer-popup');
    panel.id = 'mgBufferPopup';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'mgBufferPopupTitle');
    panel.setAttribute('aria-describedby', 'mgBufferPopupExplanation');

    const heading = element('div', 'mg-buffer-heading');
    const title = element('h3', '', 'Physical buffer layout');
    title.id = 'mgBufferPopupTitle';
    const dockButton = button('mgBufferPopupDock', 'Move left', () => {
      const left = panel.dataset.dock !== 'left';
      panel.dataset.dock = left ? 'left' : 'right';
      dockButton.textContent = left ? 'Move right' : 'Move left';
      dockButton.setAttribute('aria-label', 'Move buffer inspector to the ' + (left ? 'right' : 'left') + ' side');
    });
    dockButton.setAttribute('aria-label', 'Move buffer inspector to the left side');
    const closeButton = button('mgBufferPopupClose', 'Close', close);
    closeButton.setAttribute('aria-label', 'Close buffer layout inspector');
    heading.append(title, dockButton, closeButton);

    const body = element('div', 'mg-buffer-body');
    const explanation = element('p', 'mg-buffer-help', 'Exact configured addresses; symbolic values. PASS BIRRD writes are illustrative partial destinations, not reduced GEMM results. The diagram and this inspector share one animation clock.');
    explanation.id = 'mgBufferPopupExplanation';

    const tabs = element('div', 'mg-buffer-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Buffer to inspect');
    const tabButtons = {};
    Object.keys(KINDS).forEach(kind => {
      const tab = button('', KINDS[kind].short, () => switchOperand(kind));
      tab.dataset.bufferKind = kind;
      tab.setAttribute('aria-pressed', 'false');
      tabs.append(tab);
      tabButtons[kind] = tab;
    });

    const controls = element('div', 'mg-buffer-controls');
    const play = button('mgBufferPopupPlay', 'Play', () => {
      if (options.onPlayPause) options.onPlayPause();
      refresh();
    });
    const back = button('mgBufferPopupBack', 'Back', () => {
      if (options.onStep) options.onStep(-1);
      refresh();
    });
    const step = button('mgBufferPopupStep', 'Step', () => {
      if (options.onStep) options.onStep(1);
      refresh();
    });
    back.setAttribute('aria-label', 'Step animation backward');
    step.setAttribute('aria-label', 'Step animation forward');
    const followLabel = element('label', 'mg-buffer-follow');
    const follow = element('input');
    follow.id = 'mgBufferPopupFollow';
    follow.type = 'checkbox';
    follow.checked = true;
    follow.addEventListener('change', refresh);
    followLabel.append(follow, document.createTextNode('Follow active address'));
    controls.append(play, back, step, followLabel);

    const stateLine = element('p', 'mg-buffer-state');
    stateLine.id = 'mgBufferPopupState';
    const metadata = element('p', 'mg-buffer-meta');
    metadata.id = 'mgBufferPopupMeta';
    const note = element('p', 'mg-buffer-note');
    note.id = 'mgBufferPopupNote';

    const pager = element('div', 'mg-buffer-pager');
    const previous = button('mgBufferPopupPrev', 'Previous rows', () => changePage(-1));
    const next = button('mgBufferPopupNext', 'Next rows', () => changePage(1));
    const range = element('span', 'mg-buffer-range');
    range.id = 'mgBufferPopupRange';
    const rowLabel = element('label', '', 'Scalar row');
    rowLabel.htmlFor = 'mgBufferPopupRow';
    const rowInput = element('input', 'mg-buffer-row-input');
    rowInput.id = 'mgBufferPopupRow';
    rowInput.type = 'number';
    rowInput.min = '0';
    rowInput.step = '1';
    rowInput.value = '0';
    const go = button('mgBufferPopupGo', 'Go', goToRow);
    rowInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        goToRow();
      }
    });
    pager.append(previous, next, range, rowLabel, rowInput, go);

    const scroll = element('div', 'mg-buffer-grid-scroll');
    const table = element('table', 'mg-buffer-grid');
    table.id = 'mgBufferPopupGrid';
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-label', 'Physical bank and scalar row addresses. Use arrow keys to move between cells.');
    scroll.append(table);

    const details = element('p', 'mg-buffer-details');
    details.id = 'mgBufferPopupDetails';
    details.setAttribute('aria-live', 'polite');
    const transfersTitle = element('h4', '', 'Current buffer transfers');
    const events = element('div', 'mg-buffer-events');
    events.id = 'mgBufferPopupEvents';
    const legend = element('p', 'mg-buffer-help', 'Outlined cells are active reads or writes; striped output cells hold partial results. Arrow keys navigate banks and scalar rows. Paging never allocates the entire buffer.');
    body.append(explanation, tabs, controls, stateLine, metadata, note, pager, scroll, details, transfersTitle, events, legend);
    panel.append(heading, body);
    document.body.append(panel);

    function state() {
      return options.getState ? options.getState() || {} : {};
    }

    function layout() {
      const value = options.getLayout ? options.getLayout(operand) || {} : {};
      return Object.assign({}, value, {
        bankCount: Math.min(MAX_BANKS, integer(value.bankCount === undefined ? value.AW : value.bankCount, 0)),
        rowCount: integer(value.rowCount === undefined ? value.extentRows : value.rowCount, 0)
      });
    }

    function transfers() {
      const values = options.getTransfers ? options.getTransfers(operand) || [] : [];
      const current = values.filter(value => (!value.operand || value.operand === operand) &&
        Number.isInteger(value.bank) && Number.isInteger(value.scalarRow));
      // A pipelined network exposes many younger, in-flight rows before the
      // row arriving at OB. Keep the current write address visible and followed.
      if (operand === 'O') {
        const rank = value => ['preview-written', 'written', 'arrived'].includes(transferState(value)) ? 0 : value.arriving ? 1 : 2;
        current.sort((a, b) => rank(a) - rank(b));
      }
      return current;
    }

    function selectCell(bank, scalarRow, notify) {
      selected = {bank, scalarRow};
      if (notify && options.onSelectCell) {
        const cell = options.getCell ? options.getCell(operand, bank, scalarRow) || {} : {};
        options.onSelectCell(Object.assign({}, cell, {operand, bank, scalarRow}));
      }
    }

    function switchOperand(kind) {
      if (!KINDS[kind]) return;
      operand = kind;
      pageStart = 0;
      selected = null;
      gridKey = '';
      eventKey = '';
      refresh();
    }

    function changePage(direction) {
      follow.checked = false;
      const lastPage = Math.floor(Math.max(0, latestLayout.rowCount - 1) / PAGE_ROWS) * PAGE_ROWS;
      pageStart = Math.max(0, Math.min(lastPage, pageStart + direction * PAGE_ROWS));
      selectCell(selected ? selected.bank : 0, pageStart, false);
      refresh();
    }

    function goToRow() {
      const requested = Number(rowInput.value);
      if (!Number.isInteger(requested) || requested < 0 || requested >= latestLayout.rowCount) {
        rowInput.setCustomValidity('Choose a scalar row from 0 to ' + Math.max(0, latestLayout.rowCount - 1) + '.');
        rowInput.reportValidity();
        return;
      }
      rowInput.setCustomValidity('');
      follow.checked = false;
      pageStart = Math.floor(requested / PAGE_ROWS) * PAGE_ROWS;
      selectCell(selected ? selected.bank : 0, requested, false);
      refresh();
      focusCell(selected.bank, selected.scalarRow);
    }

    rowInput.addEventListener('input', () => rowInput.setCustomValidity(''));

    function focusCell(bank, scalarRow) {
      const entry = pageCells.find(item => item.bank === bank && item.scalarRow === scalarRow);
      if (entry) {
        entry.node.focus({preventScroll: true});
        entry.node.scrollIntoView({block: 'nearest', inline: 'nearest'});
      }
    }

    function navigateCell(event, bank, scalarRow) {
      let nextBank = bank;
      let nextRow = scalarRow;
      if (event.key === 'ArrowRight') nextBank++;
      else if (event.key === 'ArrowLeft') nextBank--;
      else if (event.key === 'ArrowDown') nextRow++;
      else if (event.key === 'ArrowUp') nextRow--;
      else if (event.key === 'Home') nextBank = 0;
      else if (event.key === 'End') nextBank = latestLayout.bankCount - 1;
      else if (event.key === 'PageDown') nextRow += PAGE_ROWS;
      else if (event.key === 'PageUp') nextRow -= PAGE_ROWS;
      else return;
      event.preventDefault();
      follow.checked = false;
      nextBank = Math.max(0, Math.min(latestLayout.bankCount - 1, nextBank));
      nextRow = Math.max(0, Math.min(latestLayout.rowCount - 1, nextRow));
      pageStart = Math.floor(nextRow / PAGE_ROWS) * PAGE_ROWS;
      selectCell(nextBank, nextRow, true);
      refresh();
      focusCell(nextBank, nextRow);
    }

    function rebuildGrid(currentLayout) {
      table.replaceChildren();
      pageCells = [];
      const thead = element('thead');
      const headers = element('tr');
      const corner = element('th', '', 'Scalar row');
      corner.scope = 'col';
      headers.append(corner);
      for (let bank = 0; bank < currentLayout.bankCount; bank++) {
        const label = element('th', '', 'B' + bank);
        label.scope = 'col';
        label.title = 'Physical bank ' + bank;
        headers.append(label);
      }
      thead.append(headers);
      const tbody = element('tbody');
      const end = Math.min(currentLayout.rowCount, pageStart + PAGE_ROWS);
      for (let scalarRow = pageStart; scalarRow < end; scalarRow++) {
        const tr = element('tr');
        tr.setAttribute('aria-rowindex', String(scalarRow + 2));
        const rowHeader = element('th', '', String(scalarRow));
        rowHeader.scope = 'row';
        tr.append(rowHeader);
        for (let bank = 0; bank < currentLayout.bankCount; bank++) {
          const td = element('td');
          const node = button('', '', () => {
            follow.checked = false;
            selectCell(bank, scalarRow, true);
            refresh();
          });
          node.className = 'mg-buffer-cell';
          node.dataset.bank = String(bank);
          node.dataset.scalarRow = String(scalarRow);
          node.addEventListener('keydown', event => navigateCell(event, bank, scalarRow));
          const label = element('span', 'mg-buffer-cell-label');
          const address = element('span', 'mg-buffer-cell-address');
          node.append(label, address);
          td.append(node);
          tr.append(td);
          pageCells.push({node, label, address, bank, scalarRow});
        }
        tbody.append(tr);
      }
      table.append(thead, tbody);
      table.setAttribute('aria-rowcount', String(currentLayout.rowCount + 1));
      table.setAttribute('aria-colcount', String(currentLayout.bankCount + 1));
    }

    function transferState(transfer) {
      return transfer.status || transfer.state || 'in-flight';
    }

    function transferDescription(transfer) {
      const identity = transfer.label || transfer.logical || '';
      const address = 'bank ' + transfer.bank + ', scalar row ' + transfer.scalarRow;
      const pe = Number.isInteger(transfer.peRow) && Number.isInteger(transfer.peCol)
        ? 'PE[' + transfer.peRow + ',' + transfer.peCol + ']' : transfer.destination || '';
      const route = operand === 'O'
        ? (Number.isInteger(transfer.sourcePort) ? 'BIRRD port ' + transfer.sourcePort + ' → ' : '') + address
        : address + (pe ? ' → ' + pe : ' → array');
      return identity + ' · ' + route + ' · ' + transferState(transfer) + (transfer.partial ? ' (partial)' : '');
    }

    function renderTransfers(active) {
      const key = JSON.stringify(active.slice(0, 32));
      if (key === eventKey) return;
      eventKey = key;
      events.replaceChildren();
      if (!active.length) {
        events.append(element('p', 'mg-buffer-help', 'No active transfer for this buffer in the current animation phase.'));
        return;
      }
      active.slice(0, 32).forEach(transfer => {
        const item = button('', transferDescription(transfer), () => {
          if (transfer.bank >= latestLayout.bankCount || transfer.scalarRow >= latestLayout.rowCount) return;
          follow.checked = false;
          pageStart = Math.floor(transfer.scalarRow / PAGE_ROWS) * PAGE_ROWS;
          selectCell(transfer.bank, transfer.scalarRow, true);
          refresh();
          focusCell(transfer.bank, transfer.scalarRow);
        });
        item.className = 'mg-buffer-event';
        item.dataset.bank = String(transfer.bank);
        item.dataset.scalarRow = String(transfer.scalarRow);
        item.dataset.transferState = transferState(transfer);
        events.append(item);
      });
      if (active.length > 32) events.append(element('p', 'mg-buffer-help', 'Showing 32 of ' + active.length + ' simultaneous transfers. All visible active cells remain highlighted.'));
    }

    function refresh() {
      if (!opened) return;
      const currentState = state();
      panel.dataset.progress = String(currentState.progress === undefined ? 1 : currentState.progress);
      const revisionKey = () => currentState.revision === undefined ? null : JSON.stringify([
        currentState.revision, currentState.playing, currentState.phase,
        operand, pageStart, selected, follow.checked
      ]);
      const requestedRevision = revisionKey();
      // Packet positions change every animation frame; scalar addresses only
      // change at transfer boundaries. Keep cell nodes and keyboard focus stable.
      if (requestedRevision !== null && requestedRevision === renderedRevision) return;
      const currentLayout = layout();
      latestLayout = currentLayout;
      const active = transfers();
      const inRange = active.filter(item => item.bank >= 0 && item.bank < currentLayout.bankCount &&
        item.scalarRow >= 0 && item.scalarRow < currentLayout.rowCount);
      if (follow.checked && inRange.length) {
        const target = inRange[0];
        pageStart = Math.floor(target.scalarRow / PAGE_ROWS) * PAGE_ROWS;
        selectCell(target.bank, target.scalarRow, false);
      }
      pageStart = Math.min(pageStart, Math.floor(Math.max(0, currentLayout.rowCount - 1) / PAGE_ROWS) * PAGE_ROWS);
      if (!selected || selected.bank >= currentLayout.bankCount || selected.scalarRow >= currentLayout.rowCount) {
        selected = currentLayout.bankCount && currentLayout.rowCount ? {bank: 0, scalarRow: pageStart} : null;
      }

      panel.dataset.operand = operand;
      panel.dataset.pageStart = String(pageStart);
      panel.dataset.rows = String(currentLayout.rowCount);
      panel.dataset.bankCount = String(currentLayout.bankCount);
      panel.dataset.playing = currentState.playing ? 'true' : 'false';
      panel.style.setProperty('--buffer-color', KINDS[operand].color);
      title.textContent = KINDS[operand].name + ' buffer layout';
      Object.keys(tabButtons).forEach(kind => tabButtons[kind].setAttribute('aria-pressed', kind === operand ? 'true' : 'false'));
      play.textContent = currentState.playing ? 'Pause' : 'Play';
      play.setAttribute('aria-label', currentState.playing ? 'Pause shared architecture animation' : 'Play shared architecture animation');
      stateLine.textContent = (currentState.frame === undefined ? '' : 'Frame ' + currentState.frame + ' · ') +
        (currentState.phase || 'No animation selected') + (currentState.playing ? ' · playing' : ' · paused');
      metadata.textContent = currentLayout.bankCount + ' physical banks × ' + currentLayout.rowCount +
        ' mapped scalar rows' + (currentLayout.vnSize ? ' · ' + currentLayout.vnSize + ' lanes / VN' : '') +
        (currentLayout.label ? ' · ' + currentLayout.label : '');
      const warnings = Array.isArray(currentLayout.diagnostics) ? currentLayout.diagnostics : [];
      const notes = [currentLayout.note].concat(warnings.map(item => typeof item === 'string' ? item : item.message || String(item)));
      note.textContent = Array.from(new Set(notes.filter(Boolean))).join(' ');
      note.hidden = !note.textContent;
      const end = Math.min(currentLayout.rowCount, pageStart + PAGE_ROWS);
      range.textContent = currentLayout.rowCount ? 'Rows ' + pageStart + '–' + (end - 1) + ' / ' + currentLayout.rowCount : 'No mapped rows';
      previous.disabled = pageStart === 0;
      next.disabled = end >= currentLayout.rowCount;
      rowInput.max = String(Math.max(0, currentLayout.rowCount - 1));
      rowInput.disabled = go.disabled = !currentLayout.rowCount;
      if (document.activeElement !== rowInput) rowInput.value = String(selected ? selected.scalarRow : pageStart);

      const nextGridKey = [operand, pageStart, currentLayout.rowCount, currentLayout.bankCount].join(':');
      if (nextGridKey !== gridKey) {
        gridKey = nextGridKey;
        rebuildGrid(currentLayout);
      }
      const activeByAddress = new Map();
      inRange.forEach(item => {
        const key = item.bank + ':' + item.scalarRow;
        if (!activeByAddress.has(key)) activeByAddress.set(key, []);
        activeByAddress.get(key).push(item);
      });
      let selectedCell = null;
      pageCells.forEach(entry => {
        const cell = options.getCell ? options.getCell(operand, entry.bank, entry.scalarRow) || {} : {};
        const current = activeByAddress.get(entry.bank + ':' + entry.scalarRow) || [];
        const isSelected = Boolean(selected && selected.bank === entry.bank && selected.scalarRow === entry.scalarRow);
        const partial = Boolean(cell.partial || current.some(item => item.partial));
        const status = current.length ? transferState(current[0]) : cell.written ? 'written' : 'idle';
        entry.label.textContent = cell.label || (cell.valid === false ? '—' : '?');
        entry.address.textContent = cell.valid === false ? 'unmapped' : 'VN ' + (cell.vnRow === undefined ? '?' : cell.vnRow) + ' · L' + (cell.lane === undefined ? '?' : cell.lane);
        entry.node.dataset.vnRow = cell.vnRow === undefined ? '' : String(cell.vnRow);
        entry.node.dataset.vnIndex = cell.vnIndex === undefined ? '' : String(cell.vnIndex);
        entry.node.dataset.lane = cell.lane === undefined ? '' : String(cell.lane);
        entry.node.dataset.label = cell.label || '';
        entry.node.dataset.transferState = status;
        entry.node.dataset.partial = partial ? 'true' : 'false';
        entry.node.classList.toggle('mg-buffer-cell-active', current.length > 0);
        entry.node.classList.toggle('mg-buffer-cell-selected', isSelected);
        entry.node.classList.toggle('mg-buffer-cell-empty', cell.valid === false);
        entry.node.classList.toggle('mg-buffer-cell-written', Boolean(cell.written));
        entry.node.classList.toggle('mg-buffer-cell-partial', partial);
        entry.node.tabIndex = isSelected ? 0 : -1;
        entry.node.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        const cellLabel = (cell.label || 'Unmapped') + ', bank ' + entry.bank + ', scalar row ' + entry.scalarRow +
          ', VN slot ' + (cell.vnRow === undefined ? '?' : cell.vnRow) + ', lane ' + (cell.lane === undefined ? '?' : cell.lane) + ', ' + status;
        entry.node.setAttribute('aria-label', cellLabel);
        entry.node.title = cellLabel;
        if (isSelected) selectedCell = {cell, current, cellLabel};
      });
      details.textContent = selectedCell ? selectedCell.cellLabel + '. ' +
        (selectedCell.current.length ? selectedCell.current.map(transferDescription).join('; ') :
          selectedCell.cell.valid === false ? 'This address has no configured matrix element.' :
          operand === 'O' ? 'This is the configured output address; no active write at this phase.' : 'Select a transfer below to inspect its source address and array destination.') :
        'Configure this VN layout to inspect its physical addresses.';
      renderTransfers(active);
      renderedRevision = revisionKey();
    }

    function open(kind, source) {
      if (!KINDS[kind]) kind = 'I';
      if (!opened) opener = source || document.activeElement;
      opened = true;
      panel.hidden = false;
      switchOperand(kind);
      closeButton.focus({preventScroll: true});
    }

    function close() {
      if (!opened) return;
      opened = false;
      panel.hidden = true;
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({preventScroll: true});
    }

    function escape(event) {
      if (!opened || event.key !== 'Escape' || document.querySelector('.mg-modal-overlay.show')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
    document.addEventListener('keydown', escape, true);

    return {
      open, close, refresh,
      isOpen: () => opened,
      getCurrentSelection: () => selected ? Object.assign({operand}, selected) : null,
      destroy: () => {
        close();
        document.removeEventListener('keydown', escape, true);
        panel.remove();
      }
    };
  }

  global.FeatherBufferPopup = {create};
})(window);
