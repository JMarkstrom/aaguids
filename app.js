'use strict';

/* ------------------------------------------------------------------ *
 * Config & state
 * ------------------------------------------------------------------ */

// Relative first (works offline / on the /aaguids/ subpath), remote as a fallback.
const CSV_LOCAL_URL = 'aaguids.csv';
const CSV_REMOTE_URL = 'https://raw.githubusercontent.com/JMarkstrom/aaguids/main/aaguids.csv';

const THEME_KEY = 'aaguids:theme';
const THEME_CHOICES = ['light', 'dark', 'system'];

// The canonical column set. Anything else falls back to auto table layout.
const EXPECTED_HEADERS = ['Model', 'Firmware', 'AAGUID', 'Certification'];

const SEARCH_DEBOUNCE_MS = 120;
const ANNOUNCE_DEBOUNCE_MS = 400;
const COPIED_RESET_MS = 1200;

// Pointer capability decides hover affordances vs. tap-to-toggle.
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const state = {
    data: [],
    filtered: [],
    headers: [],
    certValues: [],
    certFilter: null, // null = all certifications
    sortColumn: null,
    sortDirection: 1, // 1 = ascending, -1 = descending
};

/* ------------------------------------------------------------------ *
 * DOM cache
 * ------------------------------------------------------------------ */

const els = {
    search: document.getElementById('search'),
    searchForm: document.getElementById('searchForm'),
    clearBtn: document.getElementById('clearBtn'),
    csvBtn: document.getElementById('exportCsvBtn'),
    jsonBtn: document.getElementById('exportJsonBtn'),
    table: document.getElementById('csvTable'),
    thead: document.querySelector('#csvTable thead'),
    tbody: document.querySelector('#csvTable tbody'),
    sentinel: document.querySelector('.table-sentinel'),
    certChips: document.getElementById('certChips'),
    countLabel: document.getElementById('resultCount'),
    liveRegion: document.getElementById('a11y-live'),
    status: document.getElementById('tableStatus'),
    themeSwitch: document.querySelector('.theme-switch'),
    statRows: document.getElementById('statRows'),
    statModels: document.getElementById('statModels'),
};

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function debounce(fn, wait) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

function safeStr(val) {
    return String(val ?? '');
}

function slugify(s) {
    return safeStr(s)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// RFC-4180-ish CSV field escaping: quote when the field contains
// a delimiter, quote, CR or LF; double any embedded quotes.
function escapeCsvField(value) {
    const s = safeStr(value);
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function announce(msg) {
    if (!els.liveRegion) return;
    // Clearing first ensures the same string is re-announced.
    els.liveRegion.textContent = '';
    setTimeout(() => { els.liveRegion.textContent = msg; }, 50);
}

// #tableStatus is not a live region (toggling `hidden` on one is unreliable),
// so errors are routed through #a11y-live as well.
function setStatus(msg, isError) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.hidden = !msg;
    els.status.classList.toggle('is-error', Boolean(msg) && Boolean(isError));
    if (msg && isError) announce(msg);
}

function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Locate the raw header string behind a column slug (headers come from the file).
function headerBySlug(slug) {
    for (let i = 0; i < state.headers.length; i++) {
        if (slugify(state.headers[i]) === slug) return state.headers[i];
    }
    return null;
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

// Character scanner: quoted fields, doubled "" escapes, CRLF/LF, trailing
// newline, commas inside quotes. Every header and value is trimmed.
function parseCsv(text) {
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    const endField = () => { record.push(field.trim()); field = ''; };
    const endRecord = () => { endField(); records.push(record); record = []; };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch !== '"') { field += ch; continue; }
            if (text[i + 1] === '"') { field += '"'; i++; continue; }
            quoted = false;
            continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === ',') { endField(); continue; }
        if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            endRecord();
            continue;
        }
        field += ch;
    }
    if (field !== '' || record.length > 0) endRecord();

    const headers = records.shift() || [];
    const rows = records
        .filter((r) => r.some((v) => v !== ''))
        .map((r) => {
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = r[idx] === undefined ? '' : r[idx]; });
            return obj;
        });
    return { headers, rows };
}

function fetchCsvText(url) {
    return fetch(url).then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.text();
    });
}

function loadData() {
    setStatus('Loading…');
    return fetchCsvText(CSV_LOCAL_URL)
        .catch(() => fetchCsvText(CSV_REMOTE_URL))
        .then((text) => {
            const parsed = parseCsv(text);
            state.headers = parsed.headers;
            state.data = parsed.rows;
            state.filtered = state.data.slice();
            setStatus('');
        })
        .catch((error) => {
            console.error('Error loading CSV:', error);
            setStatus('Failed to load data: ' + error.message, true);
        });
}

/* ------------------------------------------------------------------ *
 * Table header & sort
 * ------------------------------------------------------------------ */

function buildHeader() {
    if (!els.thead) return;
    els.thead.innerHTML = '';
    const tr = document.createElement('tr');
    state.headers.forEach((header) => {
        const th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.setAttribute('aria-sort', 'none');
        th.dataset.col = slugify(header);
        th.dataset.column = header;
        // The nested button carries the keyboard behaviour natively.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'th-sort';
        btn.textContent = header;
        btn.addEventListener('click', () => onHeaderActivate(header));
        th.appendChild(btn);
        tr.appendChild(th);
    });
    els.thead.appendChild(tr);

    if (els.table) {
        const known = state.headers.length === EXPECTED_HEADERS.length
            && state.headers.every((h, i) => h === EXPECTED_HEADERS[i]);
        els.table.classList.toggle('table--auto', !known);
    }
    updateHeaderIndicators();
}

function onHeaderActivate(column) {
    if (state.sortColumn === column) {
        state.sortDirection *= -1;
    } else {
        state.sortColumn = column;
        state.sortDirection = 1;
    }
    sortData();
    updateHeaderIndicators();
    renderBody();
}

function sortData() {
    if (!state.sortColumn) return;
    const numeric = /^-?\d+(?:\.\d+)?$/;
    state.filtered.sort((a, b) => {
        const valA = safeStr(a[state.sortColumn]).toLowerCase();
        const valB = safeStr(b[state.sortColumn]).toLowerCase();
        if (numeric.test(valA) && numeric.test(valB)) {
            return (parseFloat(valA) - parseFloat(valB)) * state.sortDirection;
        }
        return valA.localeCompare(valB, undefined, { numeric: true }) * state.sortDirection;
    });
}

function updateHeaderIndicators() {
    if (!els.thead) return;
    els.thead.querySelectorAll('th').forEach((th) => {
        th.classList.remove('asc', 'desc');
        if (th.dataset.column === state.sortColumn) {
            th.classList.add(state.sortDirection === 1 ? 'asc' : 'desc');
            th.setAttribute('aria-sort', state.sortDirection === 1 ? 'ascending' : 'descending');
        } else {
            th.setAttribute('aria-sort', 'none');
        }
    });
}

/* ------------------------------------------------------------------ *
 * Model images
 * ------------------------------------------------------------------ */

const YUBIKEY_STEMS = new Set([
    'yubikey-5',
    'yubikey-5-nano',
    'yubikey-5-nano-fips',
    'yubikey-5-nfc',
    'yubikey-5-nfc-ccn',
    'yubikey-5-nfc-epin',
    'yubikey-5-nfc-fips',
    'yubikey-5c',
    'yubikey-5c-fips',
    'yubikey-5c-nano',
    'yubikey-5c-nano-fips',
    'yubikey-5c-nfc',
    'yubikey-5c-nfc-epin',
    'yubikey-5c-nfc-fips',
    'yubikey-5ci',
    'yubikey-5ci-fips',
    'yubikey-bio-c-fido-ed',
    'yubikey-bio-c-mpe',
    'yubikey-bio-fido-ed',
    'yubikey-bio-mpe',
    'yubikey-security-key',
    'yubikey-security-key-c',
    'yubikey-security-key-c-enterprise-edition',
    'yubikey-security-key-enterprise-edition',
]);

function modelToStem(model) {
    let value = model.trim();
    if (/^security key/i.test(value)) {
        value = 'YubiKey ' + value;
        value = value.replace(/\s+NFC\b/i, '');
        value = value.replace(/\bEd\.?$/i, 'Edition');
    }
    return value
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function modelImageSrc(model) {
    const stem = modelToStem(model);
    return YUBIKEY_STEMS.has(stem) ? 'images/yubikeys/' + stem + '.png' : '';
}

/* ------------------------------------------------------------------ *
 * Table render
 * ------------------------------------------------------------------ */

function renderDefaultCell(td, value) {
    td.textContent = value;
}

// Keyed by column slug. Signature: (td, value, row) => void.
const CELL_RENDERERS = {
    model(td, value) {
        td.classList.add('model-cell');
        td.dataset.model = value;
        const src = modelImageSrc(value);
        if (src) {
            td.dataset.image = src;
            const img = document.createElement('img');
            img.className = 'model-thumb';
            img.src = src;
            img.alt = '';
            img.width = 28;
            img.height = 28;
            img.loading = 'lazy';
            img.decoding = 'async';
            td.appendChild(img);
        }
        const name = document.createElement('span');
        name.className = 'model-name';
        name.textContent = value;
        td.appendChild(name);
    },

    firmware: renderDefaultCell,

    aaguid(td, value) {
        // textContent must stay exactly the AAGUID: copyToClipboard reads it.
        td.textContent = value;
        td.classList.add('monospace', 'copyable');
        td.tabIndex = 0;
        td.setAttribute('role', 'button');
        td.setAttribute('aria-label', 'Copy AAGUID');
    },

    certification(td, value) {
        const level = value.toLowerCase();
        const tone = level.includes('2') ? 'cert-l2' : level.includes('1') ? 'cert-l1' : '';
        if (!tone) {
            td.textContent = value;
            return;
        }
        const chip = document.createElement('span');
        chip.className = 'cert ' + tone;
        chip.textContent = value;
        td.appendChild(chip);
    },
};

function renderEmptyState() {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'empty-state';
    td.colSpan = state.headers.length || 1;

    const title = document.createElement('p');
    title.className = 'empty-title';
    title.textContent = 'No matching results';

    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'Try a different search term or clear the filters.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn empty-clear';
    btn.textContent = 'Clear filters';

    td.append(title, hint, btn);
    tr.appendChild(td);
    return tr;
}

function renderBody() {
    hideCopyTip();
    hideModelCard();
    if (!els.tbody) return;
    els.tbody.innerHTML = '';

    if (state.filtered.length === 0) {
        els.tbody.appendChild(renderEmptyState());
        return;
    }

    const firmwareHeader = headerBySlug('firmware');
    const certHeader = headerBySlug('certification');
    const frag = document.createDocumentFragment();

    state.filtered.forEach((row) => {
        const tr = document.createElement('tr');
        // The preview card reads these for its meta line.
        if (firmwareHeader) tr.dataset.firmware = safeStr(row[firmwareHeader]);
        if (certHeader) tr.dataset.cert = safeStr(row[certHeader]);

        state.headers.forEach((header) => {
            const slug = slugify(header);
            const value = safeStr(row[header]);
            const td = document.createElement('td');
            td.dataset.col = slug;
            td.dataset.label = header;
            (CELL_RENDERERS[slug] || renderDefaultCell)(td, value, row);
            tr.appendChild(td);
        });
        frag.appendChild(tr);
    });

    els.tbody.appendChild(frag);
}

function renderStats() {
    if (els.statRows) {
        els.statRows.textContent = state.data.length + ' AAGUIDs';
    }
    if (els.statModels) {
        const modelHeader = headerBySlug('model');
        const distinct = new Set();
        if (modelHeader) {
            state.data.forEach((row) => {
                const v = safeStr(row[modelHeader]);
                if (v) distinct.add(v);
            });
        }
        els.statModels.textContent = distinct.size + ' models';
    }
}

function initStickyShadow() {
    if (!els.sentinel || !els.table || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            els.table.classList.toggle('is-stuck', !entry.isIntersecting);
        });
    }, { threshold: 0 });
    io.observe(els.sentinel);
}

/* ------------------------------------------------------------------ *
 * Overlays (tooltip + preview)
 * ------------------------------------------------------------------ */

const copyTip = document.createElement('div');
copyTip.className = 'copy-tooltip';
copyTip.hidden = true;
document.body.appendChild(copyTip);

const modelCard = document.createElement('figure');
modelCard.className = 'model-card';
modelCard.hidden = true;
modelCard.setAttribute('aria-hidden', 'true');
const modelImg = document.createElement('img');
modelImg.alt = ''; // always empty: the caption already names the model
modelImg.width = 150;
modelImg.height = 150;
const modelCaption = document.createElement('figcaption');
const modelCardName = document.createElement('span');
modelCardName.className = 'model-card-name';
const modelCardMeta = document.createElement('span');
modelCardMeta.className = 'model-card-meta';
modelCaption.append(modelCardName, modelCardMeta);
modelCard.append(modelImg, modelCaption);
document.body.appendChild(modelCard);

let tipTarget = null;
let copiedTimer = null;
let copiedCell = null;
let modelTarget = null;
let floaterFrame = 0;

function copyableFrom(target) {
    if (!(target instanceof Element)) return null;
    const td = target.closest('.copyable');
    return td && els.tbody && els.tbody.contains(td) ? td : null;
}

function modelFrom(target) {
    if (!(target instanceof Element)) return null;
    const td = target.closest('.model-cell');
    return td && td.dataset.image && els.tbody && els.tbody.contains(td) ? td : null;
}

// One positioner for both floaters. `side` is the preferred placement
// ('above' or 'right'); both fall back and clamp inside the viewport.
function positionFloater(floater, anchor, opts) {
    const options = opts || {};
    const gap = typeof options.gap === 'number' ? options.gap : 8;
    const side = options.side === 'right' ? 'right' : 'above';
    const rect = anchor.getBoundingClientRect();
    const box = floater.getBoundingClientRect();
    let left;
    let top;

    if (side === 'above') {
        left = rect.left;
        top = rect.top - box.height - gap;
        if (top < 8) top = rect.bottom + gap;
        const maxLeft = window.innerWidth - box.width - 8;
        if (left > maxLeft) left = Math.max(8, maxLeft);
    } else {
        left = rect.right + gap;
        top = rect.top;
        if (left + box.width > window.innerWidth - 8) left = rect.left - box.width - gap;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        const maxTop = window.innerHeight - box.height - 8;
        if (top > maxTop) top = Math.max(8, maxTop);
    }

    floater.style.left = left + 'px';
    floater.style.top = top + 'px';
}

function showCopyTip(el, text) {
    copyTip.textContent = text;
    copyTip.hidden = false;
    positionFloater(copyTip, el, { side: 'above', gap: 6 });
}

function hideCopyTip() {
    copyTip.hidden = true;
    tipTarget = null;
}

function showIdleTip(td) {
    tipTarget = td;
    showCopyTip(td, 'Copy AAGUID');
}

function showModelCard(td) {
    const src = td.dataset.image;
    if (!src) return;
    modelTarget = td;
    modelCardName.textContent = td.dataset.model || '';
    const tr = td.closest('tr');
    const firmware = tr ? safeStr(tr.dataset.firmware) : '';
    const cert = tr ? safeStr(tr.dataset.cert) : '';
    const meta = [firmware ? 'Firmware ' + firmware : '', cert].filter(Boolean).join(' · ');
    modelCardMeta.textContent = meta;
    modelCard.hidden = false;
    if (modelImg.getAttribute('src') !== src) modelImg.src = src;
    positionFloater(modelCard, td, { side: 'right', gap: 8 });
}

function hideModelCard() {
    modelCard.hidden = true;
    modelTarget = null;
}

function repositionFloaters() {
    floaterFrame = 0;
    if (tipTarget) positionFloater(copyTip, tipTarget, { side: 'above', gap: 6 });
    if (modelTarget) positionFloater(modelCard, modelTarget, { side: 'right', gap: 8 });
}

function scheduleReposition() {
    if (floaterFrame) return;
    floaterFrame = requestAnimationFrame(repositionFloaters);
}

modelImg.addEventListener('load', () => {
    if (modelTarget && !modelCard.hidden) positionFloater(modelCard, modelTarget, { side: 'right', gap: 8 });
});
modelImg.addEventListener('error', hideModelCard);

// Clipboard write with a plain-HTTP fallback (navigator.clipboard is
// undefined on insecure origins, e.g. LAN dev over http://).
function writeClipboard(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(value);
    }
    return new Promise((resolve, reject) => {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (err) {
            ok = false;
        }
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('Clipboard unavailable'));
    });
}

async function copyToClipboard(value, td) {
    try {
        await writeClipboard(value);
        tipTarget = td;
        showCopyTip(td, 'Copied');
        td.classList.add('is-copied');
        announce('Copied');
        clearTimeout(copiedTimer);
        if (copiedCell && copiedCell !== td) copiedCell.classList.remove('is-copied');
        copiedCell = td;
        copiedTimer = setTimeout(() => {
            td.classList.remove('is-copied');
            if (copiedCell === td) copiedCell = null;
            if (tipTarget === td) showCopyTip(td, 'Copy AAGUID');
        }, COPIED_RESET_MS);
    } catch (err) {
        console.error('Failed to copy text:', err);
        announce('Copy failed');
    }
}

function initOverlays() {
    if (!els.tbody) return;

    if (canHover) {
        els.tbody.addEventListener('mouseover', (e) => {
            const td = copyableFrom(e.target);
            if (!td || tipTarget === td) return;
            showIdleTip(td);
        });
        els.tbody.addEventListener('mouseout', (e) => {
            const td = copyableFrom(e.target);
            if (!td || copyableFrom(e.relatedTarget) === td) return;
            if (tipTarget === td) hideCopyTip();
        });
        els.tbody.addEventListener('mouseover', (e) => {
            const td = modelFrom(e.target);
            if (!td || modelTarget === td) return;
            showModelCard(td);
        });
        els.tbody.addEventListener('mouseout', (e) => {
            const td = modelFrom(e.target);
            if (!td || modelFrom(e.relatedTarget) === td) return;
            if (modelTarget === td) hideModelCard();
        });
    } else {
        // Touch/coarse pointers: tap a model cell to toggle the preview,
        // tap anywhere else to dismiss it.
        document.addEventListener('pointerdown', (e) => {
            if (modelFrom(e.target)) return;
            if (e.target instanceof Node && modelCard.contains(e.target)) return;
            hideModelCard();
        });
    }

    els.tbody.addEventListener('focusin', (e) => {
        const td = copyableFrom(e.target);
        if (td) showIdleTip(td);
    });
    els.tbody.addEventListener('focusout', (e) => {
        const td = copyableFrom(e.target);
        if (td && tipTarget === td) hideCopyTip();
    });
    els.tbody.addEventListener('focusin', (e) => {
        const td = modelFrom(e.target);
        if (td && modelTarget !== td) showModelCard(td);
    });
    els.tbody.addEventListener('focusout', (e) => {
        const td = modelFrom(e.target);
        if (td && modelTarget === td) hideModelCard();
    });

    els.tbody.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('.empty-clear')) {
            clearFilter();
            return;
        }
        const copyTd = copyableFrom(e.target);
        if (copyTd) {
            copyToClipboard(copyTd.textContent, copyTd);
            return;
        }
        if (!canHover) {
            const modelTd = modelFrom(e.target);
            if (modelTd) {
                if (modelTarget === modelTd) hideModelCard();
                else showModelCard(modelTd);
            }
        }
    });

    els.tbody.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const td = copyableFrom(e.target);
        if (!td) return;
        e.preventDefault();
        copyToClipboard(td.textContent, td);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        hideCopyTip();
        hideModelCard();
    });

    window.addEventListener('scroll', scheduleReposition, { capture: true, passive: true });
}

/* ------------------------------------------------------------------ *
 * Filtering
 * ------------------------------------------------------------------ */

function searchTerm() {
    return els.search ? els.search.value.trim().toLowerCase() : '';
}

function matchesSearch(row, term) {
    if (!term) return true;
    return Object.values(row).some((val) => safeStr(val).toLowerCase().includes(term));
}

function matchesCert(row, certHeader) {
    if (state.certFilter === null) return true;
    if (!certHeader) return true;
    return safeStr(row[certHeader]) === state.certFilter;
}

function applyFilter() {
    const term = searchTerm();
    const certHeader = headerBySlug('certification');
    state.filtered = state.data.filter((row) => matchesCert(row, certHeader) && matchesSearch(row, term));
    sortData();
    renderBody();
    updateCount();
    updateChips();
}

function clearFilter() {
    if (els.search) els.search.value = '';
    state.certFilter = null;
    state.sortColumn = null;
    state.sortDirection = 1;
    state.filtered = state.data.slice();
    updateHeaderIndicators();
    renderBody();
    updateCount();
    updateChips();
    if (els.search) els.search.focus();
    announce('Filters cleared. ' + countText());
}

function countText() {
    const total = state.data.length;
    const shown = state.filtered.length;
    const filtering = shown !== total || state.certFilter !== null;
    let text = filtering
        ? 'Showing ' + shown + ' of ' + total
        : total + ' item' + (total === 1 ? '' : 's');
    if (state.certFilter) text += ' · ' + state.certFilter;
    return text;
}

function updateCount() {
    if (els.countLabel) els.countLabel.textContent = countText();
    const disabled = state.filtered.length === 0;
    if (els.csvBtn) els.csvBtn.disabled = disabled;
    if (els.jsonBtn) els.jsonBtn.disabled = disabled;
}

function buildCertChips() {
    if (!els.certChips) return;
    const certHeader = headerBySlug('certification');
    const seen = new Set();
    state.certValues = [];
    if (certHeader) {
        state.data.forEach((row) => {
            const v = safeStr(row[certHeader]);
            if (v && !seen.has(v)) {
                seen.add(v);
                state.certValues.push(v);
            }
        });
        state.certValues.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    els.certChips.innerHTML = '';
    if (state.certValues.length === 0) {
        els.certChips.hidden = true;
        return;
    }
    els.certChips.hidden = false;

    const frag = document.createDocumentFragment();
    [''].concat(state.certValues).forEach((cert) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.dataset.cert = cert;
        btn.setAttribute('aria-pressed', 'false');
        btn.appendChild(document.createTextNode(cert || 'All'));
        const count = document.createElement('span');
        count.className = 'chip-count';
        btn.appendChild(count);
        frag.appendChild(btn);
    });
    els.certChips.appendChild(frag);
    updateChips();
}

// Counts are computed against the search-filtered set, not the cert-filtered
// one, so each chip shows how many rows it *would* yield.
function updateChips() {
    if (!els.certChips) return;
    const term = searchTerm();
    const certHeader = headerBySlug('certification');
    const base = state.data.filter((row) => matchesSearch(row, term));

    els.certChips.querySelectorAll('.chip').forEach((chip) => {
        const cert = chip.dataset.cert || '';
        const active = cert === '' ? state.certFilter === null : state.certFilter === cert;
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        const n = cert === ''
            ? base.length
            : (certHeader ? base.filter((row) => safeStr(row[certHeader]) === cert).length : 0);
        const countEl = chip.querySelector('.chip-count');
        if (countEl) countEl.textContent = String(n);
    });
}

function onChipActivate(cert) {
    state.certFilter = cert || null;
    applyFilter();
    announce((state.certFilter ? state.certFilter + '. ' : 'All certifications. ') + countText());
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function exportToCSV() {
    if (state.filtered.length === 0) {
        announce('Nothing to export');
        return;
    }
    const lines = [
        state.headers.map(escapeCsvField).join(','),
        ...state.filtered.map((row) => state.headers.map((h) => escapeCsvField(row[h])).join(',')),
    ];
    // Prepend a UTF-8 BOM so Excel opens it with the correct encoding.
    download('\uFEFF' + lines.join('\r\n'), 'yubikey_aaguids.csv', 'text/csv;charset=utf-8;');
}

function exportToJSON() {
    if (state.filtered.length === 0) {
        announce('Nothing to export');
        return;
    }
    download(JSON.stringify(state.filtered, null, 2), 'yubikey_aaguids.json', 'application/json;charset=utf-8;');
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

function getThemePref() {
    try {
        const stored = localStorage.getItem(THEME_KEY);
        return THEME_CHOICES.indexOf(stored) === -1 ? 'system' : stored;
    } catch (err) {
        return 'system';
    }
}

function syncThemeButtons(choice) {
    document.querySelectorAll('.theme-btn').forEach((btn) => {
        btn.setAttribute('aria-pressed', btn.dataset.themeChoice === choice ? 'true' : 'false');
    });
}

function setTheme(choice) {
    const value = THEME_CHOICES.indexOf(choice) === -1 ? 'system' : choice;
    try {
        if (value === 'system') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, value);
    } catch (err) {
        // Storage may be unavailable (private mode); theming still applies.
    }
    // Removing the attribute hands control back to `color-scheme: light dark`,
    // which tracks the OS natively — no matchMedia listener needed.
    if (value === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
    syncThemeButtons(value);
    announce('Theme: ' + value);
}

function initThemeToggle() {
    syncThemeButtons(getThemePref());
    if (!els.themeSwitch) return;
    els.themeSwitch.addEventListener('click', (e) => {
        if (!(e.target instanceof Element)) return;
        const btn = e.target.closest('.theme-btn');
        if (!btn || !els.themeSwitch.contains(btn)) return;
        setTheme(btn.dataset.themeChoice);
    });
}

/* ------------------------------------------------------------------ *
 * Init
 * ------------------------------------------------------------------ */

const announceResults = () => announce(countText());

function initControls() {
    if (els.searchForm) {
        els.searchForm.addEventListener('submit', (e) => e.preventDefault());
    }
    if (els.search) {
        // Rendering is debounced tightly; announcements far more loosely so
        // typing does not flood the live region.
        els.search.addEventListener('input', debounce(applyFilter, SEARCH_DEBOUNCE_MS));
        els.search.addEventListener('input', debounce(announceResults, ANNOUNCE_DEBOUNCE_MS));
    }
    if (els.clearBtn) els.clearBtn.addEventListener('click', clearFilter);
    if (els.csvBtn) els.csvBtn.addEventListener('click', exportToCSV);
    if (els.jsonBtn) els.jsonBtn.addEventListener('click', exportToJSON);
    if (els.certChips) {
        els.certChips.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const chip = e.target.closest('.chip');
            if (!chip || !els.certChips.contains(chip)) return;
            onChipActivate(chip.dataset.cert || '');
        });
    }
}

initThemeToggle();
initControls();
initOverlays();

loadData().then(() => {
    buildHeader();
    buildCertChips();
    renderBody();
    updateCount();
    renderStats();
    initStickyShadow();
});
