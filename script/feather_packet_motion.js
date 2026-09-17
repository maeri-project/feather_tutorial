/* Enlarged packet motion is driven exclusively by the architecture's frame clock. */
(function (global) {
    'use strict';
    const NS = 'http://www.w3.org/2000/svg';
    const COLORS = { I: '#004C99', W: '#006633', O: '#990000', P: '#4C0099' };

    function create(host) {
        const mount = document.getElementById('mgMotionMount');
        if (!mount) throw new Error('The packet motion view needs #mgMotionMount.');
        const handlers = host || {};
        let current = { packets: [], progress: 1, playing: false, reduced: false, frame: 0 };
        let preferredKey = null;
        let activeKey = null;
        let preferredAddress = null;
        let optionsSignature = null;
        let collapsed = false;

        function html(tag, attrs, text, parent) {
            const node = document.createElement(tag);
            Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
            if (text !== undefined) node.textContent = text;
            if (parent) parent.appendChild(node);
            return node;
        }
        function svg(tag, attrs, text, parent) {
            const node = document.createElementNS(NS, tag);
            Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
            if (text !== undefined) node.textContent = text;
            if (parent) parent.appendChild(node);
            return node;
        }
        function call(name, value) {
            if (typeof handlers[name] === 'function') handlers[name](value);
        }
        const panel = html('section', { class: 'mg-motion', 'aria-label': 'Detailed data movement' }, undefined, mount);
        const header = html('div', { class: 'mg-motion-header' }, undefined, panel);
        const toggle = html('button', { id: 'mgMotionToggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'mgMotionBody' }, '▾ Detailed data movement', header);
        const phase = html('span', { id: 'mgMotionPhase', class: 'mg-motion-phase' }, '', header);
        const body = html('div', { id: 'mgMotionBody' }, undefined, panel);
        const controls = html('div', { class: 'mg-motion-controls' }, undefined, body);
        const selectorLabel = html('label', { for: 'mgMotionSelect' }, 'Follow element', controls);
        const select = html('select', { id: 'mgMotionSelect', 'aria-label': 'Element to follow through the architecture' }, undefined, selectorLabel);
        const replay = html('button', { id: 'mgMotionReplay', type: 'button', title: 'Replay this transfer using the shared architecture clock' }, '↺ Replay transfer', controls);
        const play = html('button', { id: 'mgMotionPlay', type: 'button' }, 'Play', controls);
        const scrubLabel = html('label', { class: 'mg-motion-scrub-label', for: 'mgMotionScrub' }, 'Transfer', controls);
        const scrub = html('input', { id: 'mgMotionScrub', type: 'range', min: '0', max: '100', step: '1', value: '100', 'aria-label': 'Transfer progress in the current architecture frame' }, undefined, scrubLabel);
        const percentage = html('output', { id: 'mgMotionPercent', for: 'mgMotionScrub' }, '100%', scrubLabel);
        const diagram = svg('svg', { id: 'mgMotionDiagram', viewBox: '0 0 920 100', role: 'img', 'aria-label': 'Selected data element moving from its source to its destination' }, undefined, body);
        const description = svg('title', {}, '', diagram);
        const track = svg('path', { class: 'mg-motion-track', d: 'M132 58H788' }, undefined, diagram);
        const trail = svg('path', { id: 'mgMotionTrail', class: 'mg-motion-trail', d: 'M132 58H788' }, undefined, diagram);
        const sourceText = svg('text', { class: 'mg-motion-anchor-label', x: '132', y: '14', 'text-anchor': 'middle' }, 'SOURCE', diagram);
        const destinationText = svg('text', { class: 'mg-motion-anchor-label', x: '788', y: '14', 'text-anchor': 'middle' }, 'DESTINATION', diagram);
        const ghost = svg('g', { id: 'mgMotionSourceGhost', transform: 'translate(132 58)' }, undefined, diagram);
        const ghostBox = svg('rect', { x: '-118', y: '-26', width: '236', height: '52', rx: '7', class: 'mg-motion-ghost-box' }, undefined, ghost);
        const ghostTag = svg('text', { y: '-5', 'text-anchor': 'middle', class: 'mg-motion-ghost-tag' }, '', ghost);
        const ghostLabel = svg('text', { y: '14', 'text-anchor': 'middle', class: 'mg-motion-ghost-label' }, '', ghost);
        const arrival = svg('rect', { id: 'mgMotionArrival', x: '670', y: '32', width: '236', height: '52', rx: '7', class: 'mg-motion-arrival', opacity: '0' }, undefined, diagram);
        const destinationMark = svg('circle', { cx: '788', cy: '58', r: '5', class: 'mg-motion-destination-dot' }, undefined, diagram);
        const card = svg('g', { id: 'mgMotionCard', transform: 'translate(788 58)' }, undefined, diagram);
        const cardBox = svg('rect', { x: '-118', y: '-26', width: '236', height: '52', rx: '7', class: 'mg-motion-card-box' }, undefined, card);
        const fingerprint = svg('path', { d: 'M-104,-4h12v12h-12z', class: 'mg-motion-fingerprint' }, undefined, card);
        const tagText = svg('text', { y: '-6', 'text-anchor': 'middle', class: 'mg-motion-card-tag' }, '', card);
        const labelText = svg('text', { y: '14', 'text-anchor': 'middle', class: 'mg-motion-card-label' }, '', card);
        const statusText = svg('text', { x: '460', y: '96', 'text-anchor': 'middle', class: 'mg-motion-status' }, '', diagram);
        const endpoints = html('div', { id: 'mgMotionEndpoints', class: 'mg-motion-endpoints' }, '', body);
        const origin = html('div', { id: 'mgMotionOrigin', class: 'mg-motion-origin' }, '', body);
        const help = html('details', { class: 'mg-motion-help' }, undefined, body);
        html('summary', {}, 'Identity key · symbolic PASS partial-result preview', help);
        html('div', { class: 'mg-motion-note' }, 'Identity tags: I/W = bank.scalar-row; P = mapping:PE-row.PE-column·dot. Matching tags are copies of the same source element.', help);
        const disclaimer = html('div', { class: 'mg-motion-note' }, 'Symbolic tensor elements; timing is illustrative. BIRRD PASS traffic remains a partial result, not a completed GEMM value.', undefined);
        help.appendChild(disclaimer);

        function packetAtAddress(packet, address) {
            return address && packet.operand === address.operand && packet.bank === address.bank && packet.scalarRow === address.scalarRow;
        }
        function choose(packets) {
            const exact = packets.find(packet => packet.key === preferredKey);
            if (exact) return exact;
            const addressed = packets.find(packet => packetAtAddress(packet, preferredAddress));
            if (addressed) return addressed;
            const previous = packets.find(packet => packet.key === activeKey);
            if (previous) return previous;
            return packets.find(packet => packet.operand === 'W' && packet.phase === 'read') ||
                packets.find(packet => packet.operand === 'I') || packets[0] || null;
        }
        function identity(packet) {
            const address = Number.isInteger(packet.bank) && Number.isInteger(packet.scalarRow) ? ' · bank ' + packet.bank + ' / row ' + packet.scalarRow : '';
            return (packet.tag || packet.key || packet.operand) + address;
        }
        function fitText(node, text, maxWidth, fontSize) {
            node.textContent = text;
            if (String(text).length * fontSize * 0.62 > maxWidth) {
                node.setAttribute('textLength', maxWidth);
                node.setAttribute('lengthAdjust', 'spacingAndGlyphs');
            } else {
                node.removeAttribute('textLength');
                node.removeAttribute('lengthAdjust');
            }
        }
        function draw(next) {
            current = Object.assign({}, current, next || {});
            const packets = (Array.isArray(current.packets) ? current.packets : []).filter(packet => packet && packet.valid !== false && packet.key);
            const selected = choose(packets);
            activeKey = selected ? selected.key : null;
            const signature = JSON.stringify(packets.map(packet => [packet.key, packet.tag, packet.label, packet.stageLabel]));
            if (signature !== optionsSignature) {
                optionsSignature = signature;
                select.replaceChildren();
                if (!packets.length) html('option', { value: '' }, 'No mapped transfer in this frame', select);
                packets.forEach(packet => html('option', { value: packet.key }, (packet.tag || packet.operand) + ' · ' + packet.label + (packet.stageLabel ? ' · ' + packet.stageLabel : ''), select));
            }
            select.value = activeKey || '';
            select.disabled = !selected;
            const progress = Math.max(0, Math.min(1, Number.isFinite(Number(current.progress)) ? Number(current.progress) : 1));
            const percent = Math.round(progress * 100);
            scrub.value = String(percent);
            scrub.setAttribute('aria-valuetext', percent + '% of this transfer');
            percentage.textContent = percent + '%';
            play.textContent = current.playing ? 'Pause' : 'Play';
            play.setAttribute('aria-label', current.playing ? 'Pause the shared architecture animation' : 'Play the shared architecture animation');
            play.setAttribute('aria-pressed', String(!!current.playing));
            replay.disabled = !selected;
            scrub.disabled = !selected;
            phase.textContent = selected ? (selected.stageLabel || 'Selected transfer') + (current.reduced ? ' · reduced-motion snapshot' : '') : 'No active mapped transfer';

            const width = Math.max(300, Math.min(920, (mount.clientWidth || 944) - 24));
            const cardWidth = Math.min(236, Math.max(138, width * 0.31));
            const startX = cardWidth / 2 + 6;
            const endX = width - startX;
            const packetX = startX + (endX - startX) * progress;
            diagram.setAttribute('viewBox', '0 0 ' + width + ' 100');
            Object.assign(diagram.dataset, { selectedKey: activeKey || '', progress: String(progress), packetX: String(packetX), packetY: '58', startX: String(startX), endX: String(endX) });
            track.setAttribute('d', 'M' + startX + ' 58H' + endX);
            trail.setAttribute('d', 'M' + startX + ' 58H' + packetX);
            sourceText.setAttribute('x', startX);
            destinationText.setAttribute('x', endX);
            ghost.setAttribute('transform', 'translate(' + startX + ' 58)');
            ghostBox.setAttribute('x', -cardWidth / 2);
            ghostBox.setAttribute('width', cardWidth);
            arrival.setAttribute('x', endX - cardWidth / 2);
            arrival.setAttribute('width', cardWidth);
            arrival.setAttribute('opacity', selected && progress === 1 ? '0.2' : '0');
            destinationMark.setAttribute('cx', endX);
            card.setAttribute('transform', 'translate(' + packetX + ' 58)');
            cardBox.setAttribute('x', -cardWidth / 2);
            cardBox.setAttribute('width', cardWidth);
            statusText.setAttribute('x', width / 2);
            card.style.display = selected ? '' : 'none';
            ghost.style.display = selected ? '' : 'none';
            trail.style.display = selected ? '' : 'none';
            const color = selected && selected.color || COLORS[selected && selected.operand] || COLORS.I;
            panel.style.setProperty('--mg-packet-color', color);
            if (selected) {
                const signatureLabel = identity(selected);
                const exactLabel = String(selected.label || 'Symbolic element');
                const glyphX = -cardWidth / 2 + 13;
                const shapes = [
                    'M' + (glyphX + 5) + ',-8a6,6 0 1,0 0,12a6,6 0 1,0 0,-12',
                    'M' + (glyphX + 5) + ',-8l6,6l-6,6l-6,-6z',
                    'M' + glyphX + ',-7h10v10h-10z',
                    'M' + (glyphX + 5) + ',-8l6,12h-12z'
                ];
                fingerprint.setAttribute('d', shapes[(Number(selected.shape) || 0) % shapes.length]);
                fitText(tagText, signatureLabel, cardWidth - 46, 10);
                fitText(labelText, exactLabel, cardWidth - 18, 14);
                fitText(ghostTag, signatureLabel, cardWidth - 20, 10);
                fitText(ghostLabel, exactLabel, cardWidth - 18, 13);
                description.textContent = exactLabel + ', ' + signatureLabel + ', from ' + selected.sourceLabel + ' to ' + selected.destinationLabel + ', ' + percent + '%';
                endpoints.textContent = 'This transfer: ' + (selected.sourceLabel || 'Source') + ' → ' + (selected.destinationLabel || 'Destination');
                origin.textContent = 'Original source: ' + (selected.originLabel || selected.sourceLabel || 'See mapped source') + ' · ' + exactLabel;
                statusText.textContent = progress === 1 ? 'Arrived at this transfer’s destination' : progress === 0 ? 'At source — replay or drag Transfer to follow this element' : 'In flight · ' + percent + '% · same identity from source to destination';
                card.dataset.packetKey = selected.key;
                card.dataset.packetLabel = exactLabel;
                ghost.dataset.packetKey = selected.key;
            } else {
                description.textContent = 'No mapped transfer in this frame.';
                endpoints.textContent = 'Generate Animation, then Replay transfer or Play to follow an element.';
                origin.textContent = 'Exact element labels and physical addresses appear when a transfer is available.';
                statusText.textContent = 'Generate Animation or step to a mapped transfer';
                delete card.dataset.packetKey;
                delete card.dataset.packetLabel;
                delete ghost.dataset.packetKey;
            }
            panel.dataset.selectedKey = activeKey || '';
            panel.dataset.frame = String(current.frame);
            fitText(statusText, statusText.textContent, width - 12, width < 700 ? 8 : 10);
        }

        select.addEventListener('change', function () {
            preferredKey = select.value || null;
            preferredAddress = null;
            activeKey = preferredKey;
            call('onSelect', activeKey);
            draw();
            call('onRedraw');
        });
        replay.addEventListener('click', function () { call('onReplay'); });
        play.addEventListener('click', function () { call('onPlayPause'); });
        scrub.addEventListener('input', function () { call('onScrub', Number(scrub.value) / 100); });
        toggle.addEventListener('click', function () {
            collapsed = !collapsed;
            body.hidden = collapsed;
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.textContent = (collapsed ? '▸' : '▾') + ' Detailed data movement';
            call('onRedraw');
        });
        help.addEventListener('toggle', function () { call('onRedraw'); });
        draw();
        return {
            render: draw,
            selectedKey: function () { return activeKey; },
            selectAddress: function (address) {
                preferredAddress = address ? Object.assign({}, address) : null;
                preferredKey = null;
                const packet = (current.packets || []).find(item => packetAtAddress(item, preferredAddress));
                if (packet) preferredKey = packet.key;
                draw();
                call('onSelect', activeKey);
                call('onRedraw');
            },
            reset: function () {
                preferredKey = null;
                preferredAddress = null;
                activeKey = null;
                optionsSignature = null;
                draw({ packets: [], progress: 1, playing: false });
            }
        };
    }

    global.FeatherPacketMotion = { create: create };
}(typeof window !== 'undefined' ? window : globalThis));
