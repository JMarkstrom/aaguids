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

function renderBody() {
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
            if (header === 'Model') td.classList.add('model-cell');
            if (header === 'AAGUID') {
                td.classList.add('monospace', 'copyable');
                td.setAttribute('role', 'button');
                td.setAttribute('tabindex', '0');
                td.setAttribute('title', 'Click to copy');
                td.setAttribute('aria-label', 'Copy AAGUID ' + value);
                const copy = () => copyToClipboard(value, td);
                td.addEventListener('click', copy);
                td.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        copy();
                    }
                });
            }
            tr.appendChild(td);
        });
        frag.appendChild(tr);
    });
    els.tbody.appendChild(frag);
}

async function copyToClipboard(value, td) {
    try {
        await navigator.clipboard.writeText(value);
        td.classList.add('copied');
        announce('AAGUID copied to clipboard');
        setTimeout(() => td.classList.remove('copied'), 1000);
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

els.search.addEventListener('input', debounce(applyFilter, 120));
els.clearBtn.addEventListener('click', clearFilter);
els.csvBtn.addEventListener('click', exportToCSV);
els.jsonBtn.addEventListener('click', exportToJSON);

fetchCSV();
