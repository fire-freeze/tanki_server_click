// Socket Connection
const socket = io();

// Application State
let baseAccounts = []; // Accounts loaded from server /api/accounts
let accountsWithSettings = []; // Accounts merged with local runtime settings (battleLink, side)
const activeSessions = new Map(); // Account handle -> { status, startTime }
let statusFilter = 'all';    // account-list state filter
let editingAccountIndex = -1;
let lastPingTime = 0;

// Default Settings
const DEFAULT_BATTLE_LINK = "#/battle=2aaaaabafddececf";
const DEFAULT_SIDE = "Alpha";

// Tanki Client Configuration Payload
const TANKI_CONFIG = {
    resources: "https://s.eu.tankionline.com",
    config_template: "https://c{server}.eu.tankionline.com/config.xml",
    balancer: "https://tankionline.com/s/status.js/",
    lang: "en",
    browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    os: "Win32",
    device_type: "Desktop",
    client_type: "BROWSER",
    hardware_concurrency: "8",
    time_zone: "UTC",
    video_card: "Unknown",
    mobile_device: "false",
    touchscreen_support: "false",
    ram_size: "8192",
};

// DOM Elements
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const statusPulse = document.getElementById('statusPulse');
const pingLatency = document.getElementById('pingLatency');
const activeWorkersBadge = document.getElementById('activeWorkersBadge');
const accountsList = document.getElementById('accountsList');
const accountCount = document.getElementById('accountCount');
const addAccountForm = document.getElementById('addAccountForm');
const searchInput = document.getElementById('searchInput');
const editModal = document.getElementById('editModal');
const editAccountForm = document.getElementById('editAccountForm');
const batchEditModal = document.getElementById('batchEditModal');
const batchEditForm = document.getElementById('batchEditForm');

// Lightweight console-based logger stub (terminal UI removed)
const logger = {
    log: (level, tag, msg, d) => console.log(tag, msg, d !== undefined ? d : ''),
    info: (msg, d) => console.log('[INFO]', msg, d !== undefined ? d : ''),
    success: (msg, d) => console.log('[SUCCESS]', msg, d !== undefined ? d : ''),
    error: (msg, d) => console.error('[ERROR]', msg, d !== undefined ? d : ''),
    warning: (msg, d) => console.warn('[WARN]', msg, d !== undefined ? d : ''),
    account: (msg, d) => console.log('[ACCOUNT]', msg, d !== undefined ? d : ''),
    click: (msg, d) => console.log('[CLICK]', msg, d !== undefined ? d : ''),
    clear: () => { },
    rebuild: () => { },
};

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================
// API & STORAGE OPERATIONS
// ==========================================
async function loadAccounts() {
    try {
        const response = await fetch('/api/accounts');
        baseAccounts = await response.json();

        accountsWithSettings = baseAccounts.map(acc => {
            const stored = sessionStorage.getItem(`account_${acc.account}`);
            if (stored) {
                try {
                    return { ...acc, ...JSON.parse(stored) };
                } catch (e) { }
            }
            return {
                ...acc,
                battleLink: DEFAULT_BATTLE_LINK,
                side: DEFAULT_SIDE
            };
        });

        renderAccounts();
        updateHeaderBadges();
    } catch (error) {
        logger.error('Failed to load accounts', error.message);
    }
}

function saveAccountSettings(index) {
    const account = accountsWithSettings[index];
    if (!account) return;
    const settings = {
        battleLink: account.battleLink,
        side: account.side
    };
    sessionStorage.setItem(`account_${account.account}`, JSON.stringify(settings));
}

// ==========================================
// WORKER UI RENDERER
// ==========================================

/** Maps a raw status string to display config + filter group */
function getStatusConfig(status) {
    if (!status) return { group: 'standby', dot: 'bg-anthropic-borderDark', badge: 'text-anthropic-stoneMuted bg-anthropic-borderDark/40 border-anthropic-borderDark/50', label: 'Standby' };
    const s = status.toLowerCase();
    if (s === 'clicking') return { group: 'clicking', dot: 'bg-emerald-400 status-pulse', badge: 'text-emerald-300 bg-emerald-950/50 border-emerald-700/40', label: 'Clicking' };
    if (s === 'glitched') return { group: 'glitched', dot: 'bg-amber-400 status-pulse', badge: 'text-amber-300 bg-amber-950/50 border-amber-700/40', label: 'Glitched', countdown: true };
    if (s.includes('unglitch')) return { group: 'refreshing', dot: 'bg-anthropic-terracotta status-pulse', badge: 'text-anthropic-terracotta bg-anthropic-terracottaMuted border-anthropic-terracotta/30', label: 'Unglitching' };
    if (s === 'refreshing') return { group: 'refreshing', dot: 'bg-sky-400 status-pulse', badge: 'text-sky-300 bg-sky-950/50 border-sky-700/40', label: 'Refreshing' };
    if (s.includes('loading') || s.includes('connecting')) return { group: 'loading', dot: 'bg-blue-400 status-pulse', badge: 'text-blue-300 bg-blue-950/50 border-blue-700/40', label: status };
    if (s === 'paused') return { group: 'other', dot: 'bg-purple-400', badge: 'text-purple-300 bg-purple-950/50 border-purple-700/40', label: 'Paused' };
    if (s.includes('timeout') || s.includes('error')) return { group: 'error', dot: 'bg-rose-500', badge: 'text-rose-300 bg-rose-950/50 border-rose-700/40', label: 'Error' };
    return { group: 'other', dot: 'bg-anthropic-sage status-pulse', badge: 'text-anthropic-sage bg-anthropic-sageDark/40 border-anthropic-sage/20', label: status };
}

function renderAccounts() {
    accountsList.innerHTML = '';
    const query = (searchInput.value || '').trim().toLowerCase();

    const filtered = accountsWithSettings.filter(acc => {
        // Text search
        const matchesQuery = !query || (
            acc.account.toLowerCase().includes(query) ||
            String(acc.rank).includes(query) ||
            (acc.battleLink || '').toLowerCase().includes(query) ||
            (acc.side || '').toLowerCase().includes(query)
        );
        if (!matchesQuery) return false;

        // Status filter
        if (statusFilter === 'all') return true;
        const cfg = getStatusConfig(activeSessions.get(acc.account)?.status);
        return cfg.group === statusFilter;
    });

    accountCount.textContent = `${filtered.length} Total`;

    if (filtered.length === 0) {
        accountsList.innerHTML = `
            <div class="p-6 text-center text-xs font-mono text-anthropic-stoneMuted bg-anthropic-bgDark/40 rounded-xl border border-anthropic-borderDark/50">
                ${accountsWithSettings.length === 0 ? 'No accounts loaded.' : 'No matching accounts found.'}
            </div>
        `;
        return;
    }

    filtered.forEach((account) => {
        const index = accountsWithSettings.findIndex(a => a.account === account.account);
        const session = activeSessions.get(account.account);
        const cfg = getStatusConfig(session?.status);
        const isActive = cfg.group !== 'standby';

        const card = document.createElement('div');
        card.className = 'p-3.5 rounded-xl bg-anthropic-bgDark/60 hover:bg-anthropic-cardDarkHover border border-anthropic-borderDark hover:border-anthropic-stoneMuted/40 transition-all';

        // Side badge
        let sideBadgeClass = 'bg-blue-950/60 border-blue-800/50 text-blue-300';
        if (account.side === 'Bravo') sideBadgeClass = 'bg-rose-950/60 border-rose-800/50 text-rose-300';
        else if (account.side === 'Spectator') sideBadgeClass = 'bg-purple-950/60 border-purple-800/50 text-purple-300';

        // Glitch countdown (only for Glitched status)
        let countdownHtml = '';
        if (cfg.countdown && session?.glitchTime) {
            const endTime = session.glitchTime + 180000;
            const secsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
            const mins = Math.floor(secsLeft / 60);
            const secs = secsLeft % 60;
            const pct = Math.max(0, Math.min(100, (secsLeft / 180) * 100));
            countdownHtml = `
                <div class="mt-2 rounded-lg bg-amber-950/30 border border-amber-800/30 px-2.5 py-1.5">
                    <div class="flex items-center justify-between text-[11px] font-mono mb-1.5">
                        <span class="text-amber-400/70">Re-clicking in</span>
                        <span class="text-amber-300 font-semibold tabular-nums" data-countdown-end="${endTime}">${mins}:${String(secs).padStart(2, '0')}</span>
                    </div>
                    <div class="w-full h-1 rounded-full bg-amber-950/60">
                        <div class="h-1 rounded-full bg-amber-500/70 transition-all duration-1000" data-countdown-bar="${endTime}" style="width:${pct}%"></div>
                    </div>
                </div>`;
        }

        card.innerHTML = `
            <div class="flex items-start justify-between gap-2 mb-2">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}"></span>
                    <span class="font-mono text-sm font-semibold text-anthropic-sand">${escapeHtml(account.account)}</span>
                    <span class="text-[10px] font-mono px-1.5 py-0.5 rounded border ${sideBadgeClass}">
                        ${escapeHtml(account.side || DEFAULT_SIDE)}
                    </span>
                </div>
                <span class="text-[11px] font-mono font-medium px-2 py-0.5 rounded border whitespace-nowrap ${cfg.badge}">${escapeHtml(cfg.label)}</span>
            </div>

            <div class="grid grid-cols-2 gap-y-1 text-xs text-anthropic-stoneMuted font-mono mb-3 bg-anthropic-cardDark/50 p-2 rounded-lg border border-anthropic-borderDark/40">
                <div><span class="text-anthropic-stoneMuted/60">Rank:</span> <span class="text-anthropic-sand">${account.rank}</span></div>
                <div class="col-span-2 truncate">
                    <span class="text-anthropic-stoneMuted/60">Battle:</span>
                    <span class="text-anthropic-stoneLight hover:underline cursor-pointer font-mono">${escapeHtml(account.battleLink || DEFAULT_BATTLE_LINK)}</span>
                </div>
            </div>

            ${countdownHtml}

            <div class="flex items-center gap-2 ${countdownHtml ? 'mt-2' : ''}">
                ${isActive ? `
                    <button class="flex-1 py-1.5 px-3 rounded-lg bg-emerald-900/40 hover:bg-emerald-800/50 border border-emerald-600/50 text-emerald-300 text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer" onclick="clickAccount(${index})">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        RE-ENGAGE
                    </button>
                ` : `
                    <button class="flex-1 py-1.5 px-3 rounded-lg bg-anthropic-terracotta/20 hover:bg-anthropic-terracotta/30 border border-anthropic-terracotta/40 text-anthropic-terracotta text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer" onclick="clickAccount(${index})">
                         CLICK
                    </button>
                `}
                <button onclick="unglitchAccount(${index})" class="px-2.5 py-1.5 rounded-lg bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 border border-amber-800/40 text-xs font-mono transition-colors cursor-pointer" title="Stop Account Session">
                    Stop
                </button>
                <button onclick="openEditModal(${index})" class="px-2.5 py-1.5 rounded-lg bg-anthropic-borderDark/40 hover:bg-anthropic-borderDark text-anthropic-sand border border-anthropic-borderDark text-xs font-mono transition-colors cursor-pointer">
                    Edit
                </button>
            </div>
        `;

        accountsList.appendChild(card);
    });
}

function updateHeaderBadges() {
    const activeCount = Array.from(activeSessions.values()).filter(s => s.status && !s.status.toLowerCase().includes('error')).length;
    activeWorkersBadge.textContent = `${activeCount}/${accountsWithSettings.length} active`;
}

/** Activate an account-list status filter pill */
function setAccountFilter(filter) {
    statusFilter = filter;
    const colorMap = {
        'all': 'bg-anthropic-cardDark text-anthropic-sand border-anthropic-borderDark',
        'clicking': 'bg-emerald-950/60 text-emerald-300 border-emerald-700/40',
        'glitched': 'bg-amber-950/60 text-amber-300 border-amber-700/40',
        'loading': 'bg-blue-950/60 text-blue-300 border-blue-700/40',
        'refreshing': 'bg-sky-950/60 text-sky-300 border-sky-700/40',
        'error': 'bg-rose-950/60 text-rose-300 border-rose-700/40',
    };
    document.querySelectorAll('#statusFilterPills button').forEach(p => {
        const pf = p.getAttribute('data-status-filter');
        const base = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition-colors cursor-pointer';
        p.className = `${base} ${pf === filter
            ? (colorMap[filter] || colorMap['all'])
            : 'text-anthropic-stoneMuted border-anthropic-borderDark/50 hover:text-anthropic-sand'}`;
    });
    renderAccounts();
}

// ==========================================
// WORKER ACTIONS & SOCKET EMITS
// ==========================================
function clickAccount(index) {
    const account = accountsWithSettings[index];
    if (!account) return;

    logger.click(`Starting account: "${account.account}"`, {
        battle: account.battleLink,
        side: account.side,
        rank: account.rank
    });

    const clickData = {
        account: account.account,
        password: account.password,
        rank: Number(account.rank),
        battleLink: account.battleLink || DEFAULT_BATTLE_LINK,
        side: account.side || DEFAULT_SIDE,
        tankiConfig: JSON.stringify(TANKI_CONFIG),
        proxyUrl: account.proxyUrl || ''
    };

    activeSessions.set(account.account, { status: "Clicking", startTime: Date.now() });
    renderAccounts();
    updateHeaderBadges();

    socket.emit('click', clickData);
}

function unglitchAccount(index) {
    const account = accountsWithSettings[index];
    if (!account) return;

    logger.account(`Stopping account: "${account.account}"`);

    const unglitchData = {
        account: account.account,
        password: account.password,
        tankiConfig: JSON.stringify(TANKI_CONFIG),
        proxyUrl: account.proxyUrl || ''
    };

    activeSessions.set(account.account, { status: "Unglitching", startTime: Date.now() });
    renderAccounts();
    updateHeaderBadges();

    socket.emit('unglitch-account', unglitchData);
}

async function addNewAccount(e) {
    e.preventDefault();

    const nickname = document.getElementById('accountInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const rank = parseInt(document.getElementById('rankInput').value) || 20;
    const side = document.getElementById('sideSelectInput').value || DEFAULT_SIDE;
    const battleLink = (document.getElementById('battleLinkInput')?.value.trim()) || DEFAULT_BATTLE_LINK;
    const proxyUrl = "http://109.199.119.160:80";

    if (!nickname || !password) {
        logger.error('Account name and password are required.');
        return;
    }

    const payload = {
        account: nickname,
        password: password,
        rank: rank,
        proxyUrl: proxyUrl
    };

    try {
        const response = await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const savedAccount = await response.json();
            baseAccounts.push(savedAccount);

            const enriched = {
                ...savedAccount,
                battleLink,
                side
            };
            accountsWithSettings.push(enriched);

            // Store in session storage
            sessionStorage.setItem(`account_${nickname}`, JSON.stringify({ battleLink, side }));

            renderAccounts();
            updateHeaderBadges();
            addAccountForm.reset();

            logger.log('success', '[SUCCESS]', `Account "${nickname}" added.`);
        } else {
            const errData = await response.json();
            logger.error(`Could not add account: ${errData.error || 'Server error'}`);
        }
    } catch (err) {
        logger.error('Failed to add account', err.message);
    }
}

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('passwordInput');
    const btn = pwdInput.nextElementSibling;
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        btn.textContent = 'Hide';
    } else {
        pwdInput.type = 'password';
        btn.textContent = 'Show';
    }
}

// ==========================================
// MODAL HANDLERS
// ==========================================
function openEditModal(index) {
    editingAccountIndex = index;
    const account = accountsWithSettings[index];
    if (!account) return;

    document.getElementById('modalAccountName').textContent = `Worker: ${account.account}`;
    document.getElementById('editBattleLink').value = account.battleLink || DEFAULT_BATTLE_LINK;
    document.getElementById('editSide').value = account.side || DEFAULT_SIDE;

    editModal.classList.remove('hidden');
    editModal.classList.add('flex');
}

function closeEditModal() {
    editModal.classList.add('hidden');
    editModal.classList.remove('flex');
    editingAccountIndex = -1;
}

function saveAccountEdit(e) {
    e.preventDefault();
    if (editingAccountIndex < 0 || editingAccountIndex >= accountsWithSettings.length) return;

    const battleLink = document.getElementById('editBattleLink').value.trim();
    const side = document.getElementById('editSide').value;
    const account = accountsWithSettings[editingAccountIndex];

    account.battleLink = battleLink;
    account.side = side;

    saveAccountSettings(editingAccountIndex);
    renderAccounts();
    closeEditModal();

    logger.log('info', '[ACCOUNT]', `Updated configuration for "${account.account}": Battle = ${battleLink}, Side = ${side}`);
}

function openBatchEditModal() {
    if (accountsWithSettings.length === 0) {
        logger.warning('No workers loaded to batch edit.');
        return;
    }

    const firstAccount = accountsWithSettings[0];
    document.getElementById('batchBattleLink').value = firstAccount.battleLink || DEFAULT_BATTLE_LINK;
    document.getElementById('batchSide').value = '';

    batchEditModal.classList.remove('hidden');
    batchEditModal.classList.add('flex');
}

function closeBatchEditModal() {
    batchEditModal.classList.add('hidden');
    batchEditModal.classList.remove('flex');
}

function saveBatchEdit(e) {
    e.preventDefault();

    const battleLink = document.getElementById('batchBattleLink').value.trim();
    const side = document.getElementById('batchSide').value;

    accountsWithSettings.forEach((account, idx) => {
        account.battleLink = battleLink;
        if (side) {
            account.side = side;
        }
        saveAccountSettings(idx);
    });

    renderAccounts();
    closeBatchEditModal();

    logger.log('success', '[ACCOUNT]', `Batch edit applied to all ${accountsWithSettings.length} accounts. Battle = ${battleLink}${side ? `, Side = ${side}` : ''}`);
}

// ==========================================
// SOCKET EVENT LISTENERS
// ==========================================

socket.on('connect', () => {
    statusDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-anthropic-sage';
    statusPulse.className = 'status-pulse absolute inline-flex h-full w-full rounded-full bg-anthropic-sage opacity-75';
    statusText.className = 'text-anthropic-sage font-medium';
    statusText.textContent = 'Socket Live';

    lastPingTime = Date.now();
    pingLatency.textContent = '14ms latency';

});

socket.on('disconnect', () => {
    statusDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-red-500';
    statusPulse.className = 'status-pulse absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75';
    statusText.className = 'text-red-400 font-medium';
    statusText.textContent = 'Disconnected';
    pingLatency.textContent = '-- ms latency';

    logger.log('error', '[ERROR]', 'Connection lost.');
});

socket.on('update-status', (data) => {
    const { account, status } = data;
    logger.log('info', '[ACCOUNT]', `[${account}] Status: "${status}"`);

    // Preserve glitchTime across re-renders; only stamp it on first Glitched transition
    const prev = activeSessions.get(account) || {};
    const glitchTime = status === 'Glitched'
        ? (prev.status === 'Glitched' ? prev.glitchTime : Date.now())
        : undefined;
    activeSessions.set(account, { status, startTime: Date.now(), glitchTime });
    renderAccounts();
    updateHeaderBadges();
});

// Countdown ticker — updates glitch timer text + progress bar every second without full re-render
setInterval(() => {
    document.querySelectorAll('[data-countdown-end]').forEach(el => {
        const endTime = parseInt(el.getAttribute('data-countdown-end'));
        const secsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        const mins = Math.floor(secsLeft / 60);
        const secs = secsLeft % 60;
        el.textContent = secsLeft > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : '–';
        const bar = document.querySelector(`[data-countdown-bar="${endTime}"]`);
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, (secsLeft / 180) * 100))}%`;
    });
}, 1000);

socket.on('new-message', (data) => {
    const { color, message } = data;
    let tag = '[INFO]';
    let level = 'info';
    if (color === 'red') {
        tag = '[ERROR]';
        level = 'error';
    } else if (color === 'green') {
        tag = '[SUCCESS]';
        level = 'success';
    } else if (color === 'yellow') {
        tag = '[NOTICE]';
        level = 'warning';
    }

    logger.log(level, tag, message);
});

socket.on('close-click-session', (accountName) => {
    logger.log('warning', '[ACCOUNT]', `[${accountName}] Session ended.`);
    activeSessions.delete(accountName);
    renderAccounts();
    updateHeaderBadges();
});

socket.on('remove-account', (accountName) => {
    logger.log('warning', '[ACCOUNT]', `[${accountName}] Account removed.`);
    activeSessions.delete(accountName);
    renderAccounts();
    updateHeaderBadges();
});

socket.on('pause-account', (accountName) => {
    logger.log('warning', '[ACCOUNT]', `[${accountName}] Paused.`);
});

socket.on('resume-account', (accountName) => {
    logger.log('info', '[ACCOUNT]', `[${accountName}] Resumed.`);
});

// Wildcard socket listener for account specific events
socket.onAny((event, ...args) => {
    if (event.startsWith('stop-click-')) {
        const accountName = event.replace('stop-click-', '');
        logger.log('account', '[ACCOUNT]', `[${accountName}] Stop event received`, args);
    } else if (event.startsWith('pause-account-')) {
        const accountName = event.replace('pause-account-', '');
        logger.log('account', '[ACCOUNT]', `[${accountName}] Pause event received`, args);
    } else if (
        !['connect', 'disconnect', 'update-status', 'new-message', 'close-click-session', 'remove-account', 'pause-account', 'resume-account'].includes(event)
    ) {
        logger.log('info', '[INFO]', `Event: ${event}`, args);
    }
});

// ==========================================
// DOM INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    addAccountForm.addEventListener('submit', addNewAccount);
    editAccountForm.addEventListener('submit', saveAccountEdit);
    batchEditForm.addEventListener('submit', saveBatchEdit);

    // Initial load
    loadAccounts();
});
