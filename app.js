'use strict';

const CSV_URL = 'https://raw.githubusercontent.com/JMarkstrom/aaguids/main/aaguids.csv';

let csvData = [];
let filteredData = [];
let headers = [];
let sortColumn = null;
let sortDirection = 1; // 1 = ascending, -1 = descending

const els = {
    search: document.getElementById('search'),
    clearBtn: document.getElementById('clearBtn'),
    csvBtn: document.getElementById('exportCsvBtn'),
    jsonBtn: document.getElementById('exportJsonBtn'),
    thead: document.querySelector('#csvTable thead'),
    tbody: document.querySelector('#csvTable tbody'),
    countLabel: document.getElementById('resultCount'),
    liveRegion: document.getElementById('a11y-live'),
    status: document.getElementById('tableStatus'),
};

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

// RFC-4180-ish CSV field escaping: quote when the field contains
// a delimiter, quote, CR or LF; double any embedded quotes.
function escapeCsvField(value) {
    const s = safeStr(value);
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function setStatus(msg) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.hidden = !msg;
}

function announce(msg) {
    if (!els.liveRegion) return;
    // Clearing first ensures the same string is re-announced.
    els.liveRegion.textContent = '';
    setTimeout(() => { els.liveRegion.textContent = msg; }, 50);
}

function fetchCSV() {
    setStatus('Loading…');
    fetch(CSV_URL)
        .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        })
        .then((csvText) => {
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (h) => h.trim(),
                transform: (v) => (typeof v === 'string' ? v.trim() : v),
                complete: (results) => {
                    csvData = results.data;
                    headers = (results.meta && results.meta.fields)
                        ? results.meta.fields.map((h) => h.trim())
                        : (csvData[0] ? Object.keys(csvData[0]) : []);
                    filteredData = csvData.slice();
                    buildHeader();
                    renderBody();
                    updateCount();
                    setStatus('');
                },
            });
        })
        .catch((error) => {
            console.error('Error fetching CSV:', error);
            setStatus('Failed to load data: ' + error.message);
        });
}

function buildHeader() {
    els.thead.innerHTML = '';
    const tr = document.createElement('tr');
    headers.forEach((header) => {
        const th = document.createElement('th');
        th.textContent = header;
        th.setAttribute('scope', 'col');
        th.setAttribute('tabindex', '0');
        th.setAttribute('aria-sort', 'none');
        th.dataset.column = header;
        const activate = () => onHeaderActivate(header);
        th.addEventListener('click', activate);
        th.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
            }
        });
        tr.appendChild(th);
    });
    els.thead.appendChild(tr);
    updateHeaderIndicators();
}

function onHeaderActivate(column) {
    if (sortColumn === column) {
        sortDirection *= -1;
    } else {
        sortColumn = column;
        sortDirection = 1;
    }
    sortData();
    updateHeaderIndicators();
    renderBody();
}

function sortData() {
    if (!sortColumn) return;
    const numeric = /^-?\d+(?:\.\d+)?$/;
    filteredData.sort((a, b) => {
        const valA = safeStr(a[sortColumn]).toLowerCase();
        const valB = safeStr(b[sortColumn]).toLowerCase();
        if (numeric.test(valA) && numeric.test(valB)) {
            return (parseFloat(valA) - parseFloat(valB)) * sortDirection;
        }
        return valA.localeCompare(valB, undefined, { numeric: true }) * sortDirection;
    });
}

function updateHeaderIndicators() {
    els.thead.querySelectorAll('th').forEach((th) => {
        th.classList.remove('asc', 'desc');
        if (th.dataset.column === sortColumn) {
            th.classList.add(sortDirection === 1 ? 'asc' : 'desc');
            th.setAttribute('aria-sort', sortDirection === 1 ? 'ascending' : 'descending');
        } else {
            th.setAttribute('aria-sort', 'none');
        }
    });
}

const YUBIKEY_STEMS = new Set([
    'yubikey-5',
    'yubikey-5-nano',
    'yubikey-5-nano-cspn',
    'yubikey-5-nano-fips',
    'yubikey-5-nfc',
    'yubikey-5-nfc-ccn',
    'yubikey-5-nfc-cspn',
    'yubikey-5-nfc-epin',
    'yubikey-5-nfc-fips',
    'yubikey-5c',
    'yubikey-5c-cspn',
    'yubikey-5c-fips',
    'yubikey-5c-nano',
    'yubikey-5c-nano-cspn',
    'yubikey-5c-nano-fips',
    'yubikey-5c-nfc',
    'yubikey-5c-nfc-cspn',
    'yubikey-5c-nfc-epin',
    'yubikey-5c-nfc-fips',
    'yubikey-5ci',
    'yubikey-5ci-cspn',
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

function renderBody() {
    hideCopyTip();
    hideModelCard();
    els.tbody.innerHTML = '';
    if (filteredData.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = headers.length || 1;
        td.className = 'empty-state';
        td.textContent = 'No matching results.';
        tr.appendChild(td);
        els.tbody.appendChild(tr);
        return;
    }
    const frag = document.createDocumentFragment();
    filteredData.forEach((row) => {
        const tr = document.createElement('tr');
        headers.forEach((header) => {
            const td = document.createElement('td');
            const value = safeStr(row[header]);
            td.textContent = value;
            if (header === 'Model') {
                td.classList.add('model-cell');
                const src = modelImageSrc(value);
                if (src) td.dataset.image = src;
            }
            if (header === 'Certification') {
                const level = value.toLowerCase();
                const tone = level.includes('2') ? 'cert-l2' : level.includes('1') ? 'cert-l1' : '';
                if (tone) {
                    const chip = document.createElement('span');
                    chip.className = 'cert ' + tone;
                    chip.textContent = value;
                    td.textContent = '';
                    td.appendChild(chip);
                }
            }
            if (header === 'AAGUID') {
                td.classList.add('monospace', 'copyable');
                td.tabIndex = 0;
                td.setAttribute('role', 'button');
                td.setAttribute('aria-label', 'Copy AAGUID');
            }
            tr.appendChild(td);
        });
        frag.appendChild(tr);
    });
    els.tbody.appendChild(frag);
}

const copyTip = document.createElement('div');
copyTip.className = 'copy-tooltip';
copyTip.hidden = true;
document.body.appendChild(copyTip);

const modelCard = document.createElement('figure');
modelCard.className = 'model-card';
modelCard.hidden = true;
const modelImg = document.createElement('img');
modelImg.alt = '';
const modelCaption = document.createElement('figcaption');
modelCard.append(modelImg, modelCaption);
document.body.appendChild(modelCard);

let tipTarget = null;
let copiedTimer = null;
let modelTarget = null;

function copyableFrom(target) {
    if (!(target instanceof Element)) return null;
    const td = target.closest('.copyable');
    return td && els.tbody.contains(td) ? td : null;
}

function positionCopyTip(el) {
    const rect = el.getBoundingClientRect();
    const tipRect = copyTip.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top - tipRect.height - 6;
    if (top < 8) top = rect.bottom + 6;
    const maxLeft = window.innerWidth - tipRect.width - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    copyTip.style.left = left + 'px';
    copyTip.style.top = top + 'px';
}

function showCopyTip(el, text) {
    copyTip.textContent = text;
    copyTip.hidden = false;
    positionCopyTip(el);
}

function hideCopyTip() {
    copyTip.hidden = true;
    tipTarget = null;
}

function showIdleTip(td) {
    tipTarget = td;
    showCopyTip(td, 'Copy AAGUID');
}

function modelFrom(target) {
    if (!(target instanceof Element)) return null;
    const td = target.closest('.model-cell');
    return td && td.dataset.image && els.tbody.contains(td) ? td : null;
}

function positionModelCard(el) {
    const rect = el.getBoundingClientRect();
    const cardRect = modelCard.getBoundingClientRect();
    let left = rect.right + 8;
    let top = rect.top;
    if (left + cardRect.width > window.innerWidth - 8) left = rect.left - cardRect.width - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    const maxTop = window.innerHeight - cardRect.height - 8;
    if (top > maxTop) top = Math.max(8, maxTop);
    modelCard.style.left = left + 'px';
    modelCard.style.top = top + 'px';
}

function showModelCard(td) {
    const src = td.dataset.image;
    if (!src) return;
    modelTarget = td;
    modelCaption.textContent = td.textContent;
    modelImg.alt = td.textContent;
    modelCard.hidden = false;
    if (modelImg.getAttribute('src') !== src) modelImg.src = src;
    positionModelCard(td);
}

function hideModelCard() {
    modelCard.hidden = true;
    modelTarget = null;
}

modelImg.addEventListener('load', () => {
    if (modelTarget && !modelCard.hidden) positionModelCard(modelTarget);
});
modelImg.addEventListener('error', hideModelCard);

async function copyToClipboard(value, td) {
    try {
        await navigator.clipboard.writeText(value);
        tipTarget = td;
        showCopyTip(td, 'Copied');
        announce('Copied');
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
            if (tipTarget === td) showCopyTip(td, 'Copy AAGUID');
        }, 1000);
    } catch (err) {
        console.error('Failed to copy text:', err);
        announce('Copy failed');
    }
}

function updateCount() {
    if (!els.countLabel) return;
    const total = csvData.length;
    const shown = filteredData.length;
    els.countLabel.textContent = shown === total
        ? total + ' item' + (total === 1 ? '' : 's')
        : 'Showing ' + shown + ' of ' + total;
    const disabled = shown === 0;
    els.csvBtn.disabled = disabled;
    els.jsonBtn.disabled = disabled;
}

const applyFilter = () => {
    const searchText = els.search.value.trim().toLowerCase();
    filteredData = !searchText
        ? csvData.slice()
        : csvData.filter((row) =>
            Object.values(row).some((val) => safeStr(val).toLowerCase().includes(searchText))
        );
    sortData();
    renderBody();
    updateCount();
};

function clearFilter() {
    els.search.value = '';
    sortColumn = null;
    sortDirection = 1;
    filteredData = csvData.slice();
    updateHeaderIndicators();
    renderBody();
    updateCount();
    els.search.focus();
}

function exportToCSV() {
    if (filteredData.length === 0) {
        announce('Nothing to export');
        return;
    }
    const lines = [
        headers.map(escapeCsvField).join(','),
        ...filteredData.map((row) => headers.map((h) => escapeCsvField(row[h])).join(',')),
    ];
    // Prepend a UTF-8 BOM so Excel opens it with the correct encoding.
    download('\uFEFF' + lines.join('\r\n'), 'yubikey_aaguids.csv', 'text/csv;charset=utf-8;');
}

function exportToJSON() {
    if (filteredData.length === 0) {
        announce('Nothing to export');
        return;
    }
    download(JSON.stringify(filteredData, null, 2), 'yubikey_aaguids.json', 'application/json;charset=utf-8;');
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
els.tbody.addEventListener('focusin', (e) => {
    const td = copyableFrom(e.target);
    if (td) showIdleTip(td);
});
els.tbody.addEventListener('focusout', (e) => {
    const td = copyableFrom(e.target);
    if (td && tipTarget === td) hideCopyTip();
});
els.tbody.addEventListener('click', (e) => {
    const td = copyableFrom(e.target);
    if (td) copyToClipboard(td.textContent, td);
});
els.tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const td = copyableFrom(e.target);
    if (!td) return;
    e.preventDefault();
    copyToClipboard(td.textContent, td);
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
window.addEventListener('scroll', () => {
    if (tipTarget) positionCopyTip(tipTarget);
    if (modelTarget) positionModelCard(modelTarget);
}, true);

els.search.addEventListener('input', debounce(applyFilter, 120));
els.clearBtn.addEventListener('click', clearFilter);
els.csvBtn.addEventListener('click', exportToCSV);
els.jsonBtn.addEventListener('click', exportToJSON);

fetchCSV();
