// Main Script (Loaded at end of body)
// =========================================================
// 1. DOM ELEMENTS
// =========================================================
const nlpInput = document.getElementById('nlpInput');
const generateBtn = document.getElementById('generateBtn');

// Containers
const resultsContainer = document.getElementById('resultsContainer');
const heroSection = document.querySelector('.search-hero');
const summaryText = document.getElementById('summaryText');

// SQL Section
const toggleSqlBtn = document.getElementById('toggleSqlBtn');
const sqlContent = document.getElementById('sqlContent');
const sqlEditor = document.getElementById('sqlEditor');
const runSqlBtn = document.getElementById('runSqlBtn');
const copyBtn = document.getElementById('copyBtn');

// Table & Pagination
const resultTable = document.getElementById('resultTable');
const rowCountLabel = document.getElementById('rowCount');
const dbSelector = document.getElementById('dbSelector');

// Pagination Controls
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageIndicator = document.getElementById('pageIndicator'); // Span text

// Dropdowns
const dbDropdown = document.getElementById('dbDropdown');
const selectedDbLabel = document.getElementById('selectedDbLabel');
const exportDropdown = document.getElementById('exportDropdown');

// =========================================================
// 2. STATE
// =========================================================
let currentSql = '';
let currentData = [];
let originalData = []; // Store baseline for sort reset
let isFilterMode = false; // Toggle for showing sort controls
let currentPage = 1;
const rowsPerPage = 10;

// =========================================================
// 0. AUTHENTICATION CHECK
// =========================================================
fetch('/api/auth/me')
    .then(res => res.json())
    .then(data => {
        if (!data.authenticated) {
            window.location.href = 'login.html';
        } else {
            // Optional: Display user name if you had a UI element for it
            console.log('Logged in as:', data.user.username);
        }
    })

    .catch(() => window.location.href = 'login.html'); // Fail safe

// =========================================================
// 0.5 SETTINGS & CONNECTIONS MANAGER
// =========================================================
const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.querySelector('.settings-btn'); // Gear icon

// Open Settings
// Settings event listeners replaced by global functions below

// Close Modal
// (Moved modal logic to bottom for cleaner organization)

// LOAD CONNECTIONS
async function loadConnections() {
    const list = document.getElementById('connectionList');
    list.innerHTML = '<div style="text-align:center; padding:20px;">Loading...</div>';

    try {
        const res = await fetch('/api/connections');
        const data = await res.json();
        const resMe = await fetch('/api/auth/me'); // Check active
        const meData = await resMe.json();
        const activeId = meData.activeConnection ? meData.activeConnection.id : null;

        list.innerHTML = '';

        if (data.connections.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">No connections saved. Add one above.</div>';
            return;
        }

        data.connections.forEach(conn => {
            const isConnected = conn.id === activeId;
            const div = document.createElement('div');
            div.className = `connection-item ${isConnected ? 'active-conn' : ''}`;
            div.innerHTML = `
                    <div class="conn-info">
                        <strong>${conn.name}</strong>
                        <span>${conn.host}:${conn.port} (${conn.db_user})</span>
                    </div>
                    <div class="conn-actions">
                        ${isConnected
                    ? `<span style="color:var(--primary); font-weight:bold; font-size:0.8rem; padding:6px; display:flex; align-items:center; gap:4px; cursor:pointer;" onclick="switchConnection(${conn.id}, event)" title="Click to Refresh Schemas"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Connected</span>`
                    : `<button class="btn-connect" onclick="switchConnection(${conn.id}, event)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                        Connect
                       </button>`
                }
                        <button class="btn-delete" title="Delete Connection" onclick="deleteConnection(${conn.id})">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                `;
            list.appendChild(div);
        });
    } catch (e) {
        console.error('Failed to load connections:', e);
        list.innerHTML = '<div style="color:#ef4444; font-size:0.8rem; padding:10px;">Error loading connections. Check console.</div>';
    }
}

// AUTO-FILL PORT based on Type
const portMap = {
    'mysql': 3306,
    'mariadb': 3306,
    'oracle': 1521,
    'postgres': 5432,
    'sqlserver': 1433
};

document.getElementById('newConnType').addEventListener('change', (e) => {
    const type = e.target.value;
    const schemaLabel = document.getElementById('newConnSchema').previousElementSibling;
    const schemaInput = document.getElementById('newConnSchema');

    if (type === 'oracle') {
        schemaLabel.innerHTML = 'Service Name <span style="color:#ef4444">(Required for Oracle)</span>';
        schemaInput.placeholder = 'e.g. XE, ORCL, or SID';
    } else {
        schemaLabel.textContent = 'Service Name / Schema';
        schemaInput.placeholder = 'e.g. XE or DB Name';
    }

    if (portMap[type]) {
        document.getElementById('newConnPort').value = portMap[type];
    }
});

// ADD CONNECTION
// TEST CONNECTION
document.getElementById('testConnBtn').addEventListener('click', async (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const btn = document.getElementById('testConnBtn');
    const type = document.getElementById('newConnType').value;
    const host = document.getElementById('newConnHost').value;
    const user = document.getElementById('newConnUser').value;
    const pass = document.getElementById('newConnPass').value;
    const port = document.getElementById('newConnPort').value;
    const schema = document.getElementById('newConnSchema').value;

    if (!host || !user || !pass) return alert("Please fill standard fields");

    // UI Loading
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Testing...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/connections/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                host, port: port || portMap[type],
                db_user: user, db_pass: pass,
                default_schema: schema,
                db_type: type
            })
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Connection Successful!', 'success');
            btn.innerHTML = '✓ Verified';
            btn.style.color = 'var(--primary)';
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        showToast('Connection Failed: ' + e.message, 'error');
        alert('Connection Failed: ' + e.message);
        btn.innerHTML = '⚠️ Failed';
        setTimeout(() => btn.innerHTML = originalText, 3000);
    } finally {
        btn.disabled = false;
    }
});

// ADD CONNECTION
document.getElementById('saveConnBtn').addEventListener('click', async (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const name = document.getElementById('newConnName').value;
    const type = document.getElementById('newConnType').value;
    const host = document.getElementById('newConnHost').value;
    const user = document.getElementById('newConnUser').value;
    const pass = document.getElementById('newConnPass').value;
    const port = document.getElementById('newConnPort').value;
    const schema = document.getElementById('newConnSchema').value;

    if (!name || !host || !user || !pass) return alert("Please fill standard fields");

    try {
        const res = await fetch('/api/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, host, port: port || portMap[type],
                db_user: user, db_pass: pass,
                default_schema: schema,
                db_type: type
            })
        });
        if (res.ok) {
            // Clear form (ALL fields)
            document.getElementById('newConnName').value = '';
            document.getElementById('newConnHost').value = ''; // Added
            document.getElementById('newConnUser').value = '';
            document.getElementById('newConnPass').value = '';
            document.getElementById('newConnSchema').value = ''; // Added

            // Reset to defaults
            document.getElementById('newConnType').value = 'mysql';
            document.getElementById('newConnPort').value = '3306';

            // Reset Custom Dropdown UI
            const typeDropdown = document.getElementById('newConnTypeDropdown');
            if (typeDropdown) {
                const label = typeDropdown.querySelector('.selected-value');
                if (label) label.textContent = 'MySQL';
                // Reset Selection Highlight
                typeDropdown.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('selected'));
                const defaultItem = typeDropdown.querySelector('[data-value="mysql"]');
                if (defaultItem) defaultItem.classList.add('selected');
            }

            // Reset Test Button
            document.getElementById('testConnBtn').innerHTML = 'Test Connection';
            document.getElementById('testConnBtn').style.color = '';
            document.getElementById('testConnBtn').disabled = false;

            loadConnections(); // Reload list
            showToast('Connection Saved', 'success');

            // Switch tab to list view for better UX
            const savedTab = document.querySelector('.tab-btn[data-tab="saved-connections"]');
            if (savedTab) savedTab.click();
        } else {
            alert('Failed to save');
        }
    } catch (e) { console.error(e); }
});

// GLOBAL ACTIONS (Expose to window for onclick)
window.switchConnection = async (id, e) => {
    if (e) e.stopPropagation();

    // CASE: Force Refresh (ID is null)
    // CASE: Force Refresh (ID is null)
    if (id === null) {
        // Find the button to animate
        const btn = e?.currentTarget || e?.target?.closest('button');
        if (btn) {
            const icon = btn.querySelector('svg');
            if (icon) icon.classList.add('rotating'); // CSS spin class
            btn.disabled = true;
        }

        // No Toast, just silent refresh with animation
        await fetchDatabases();

        // Reset Button State
        if (btn) {
            const icon = btn.querySelector('svg');
            if (icon) icon.classList.remove('rotating');
            btn.disabled = false;
        }
        return;
    }

    try {
        const activeConnElement = document.querySelector('.active-conn');
        const isRefresh = activeConnElement && activeConnElement.querySelector('.conn-actions span')?.contains(e?.target);

        if (isRefresh) {
            showToast('Refreshing Database List...', 'success');
        } else {
            showToast('Connecting...', 'success');
        }

        const res = await fetch('/api/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId: id })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Connection refused by server');
        }

        showToast(`Connected to ${data.activeConnection}`, 'success');
        loadConnections(); // Refresh UI

        // REFRESH DATABASES & AWAIT IT
        await fetchDatabases();

        // Reset sidebar search if any
        const searchInput = document.getElementById('dbSearchInput');
        if (searchInput) {
            searchInput.value = '';
            // Trigger clear btn hide if needed (via internal logic)
            const clearBtn = document.getElementById('dbSearchClear');
            if (clearBtn) clearBtn.style.display = 'none';
        }

    } catch (e) {
        console.error(e);
        alert('Connection Failed: ' + e.message);
        // Also show toast
        showToast('Connection Failed: ' + e.message, 'error');
    }
};

window.deleteConnection = async (id) => {
    if (!confirm('Delete this connection?')) return;
    await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    loadConnections();
};
const logoutAction = document.getElementById('logoutAction');

// 6. GLOBAL HELPERS FOR HTML ONCLICK
// (Avoids event listener race conditions)

window.toggleSettingsDropdown = (e) => {
    if (e) e.stopPropagation();

    // Close other dropdowns (Database Dropdown)
    const dbDd = document.querySelector('.custom-dropdown');
    if (dbDd) dbDd.classList.remove('active');

    const dd = document.querySelector('.settings-dropdown');
    if (dd) dd.classList.toggle('active');
};

window.openSettingsModal = (e) => {
    if (e) e.stopPropagation();
    const dd = document.querySelector('.settings-dropdown');
    const modal = document.getElementById('settingsModal');

    if (dd) dd.classList.remove('active'); // Close menu
    if (modal) modal.style.display = 'flex'; // Open modal

    // Call loadConnections if available (it's defined in this scope)
    // We need to ensure loadConnections is hoisted or available. 
    // Since it's 'async function loadConnections', it is hoisted within this scope.
    loadConnections();
};

window.closeSettingsModal = (e) => {
    if (e) e.stopPropagation();
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
};

// Close dropdowns on global click
document.addEventListener('click', (e) => {
    // Settings
    const settingsDd = document.querySelector('.settings-dropdown');
    if (settingsDd && !settingsDd.contains(e.target)) {
        settingsDd.classList.remove('active');
    }

    // Database
    const dbDd = document.getElementById('dbDropdown');
    if (dbDd && !dbDd.contains(e.target)) {
        dbDd.classList.remove('active');
    }

    // Export
    const exportDd = document.getElementById('exportDropdown');
    if (exportDd && !exportDd.contains(e.target)) {
        exportDd.classList.remove('active');
    }

    // Close modal on overlay click
    const modal = document.getElementById('settingsModal');
    if (modal && e.target === modal) {
        modal.style.display = 'none';
    }
});

if (logoutAction) {
    logoutAction.addEventListener('click', () => {
        fetch('/api/auth/logout', { method: 'POST' })
            .then(() => window.location.href = 'login.html');
    });
}

// =========================================================
// 1. DOM ELEMENTS
// =========================================================

// =========================================================
// HELPER: Format DB Name (Camel/Title Case)
// =========================================================
function formatDbName(name) {
    if (!name) return '';
    // Replace underscores with spaces
    let formatted = name.replace(/_/g, ' ');
    // Title Case
    return formatted.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

// Search Filter Logic for DB Dropdown
function initDbSearch() {
    const searchInput = document.getElementById('dbSearchInput');
    const clearBtn = document.getElementById('dbSearchClear');

    if (!searchInput || !clearBtn) return;

    // Use event delegation or dynamic lookup to find contentArea
    const filterList = () => {
        const term = searchInput.value.toLowerCase();
        const contentArea = dbDropdown.querySelector('.dropdown-content');
        if (!contentArea) return;

        const items = contentArea.querySelectorAll('.dropdown-item');
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            const match = text.includes(term);
            item.style.display = match ? 'block' : 'none';
        });
        clearBtn.style.display = term ? 'flex' : 'none';
    };

    searchInput.addEventListener('input', filterList);
    searchInput.addEventListener('click', (e) => e.stopPropagation());

    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        searchInput.value = '';
        filterList();
        searchInput.focus();
    });
}

// Auto-Discover Databases
let activeDiscoveryId = 0;
async function fetchDatabases() {
    const discoveryId = ++activeDiscoveryId;
    // 1. Immediate UI Feedback
    if (selectedDbLabel) selectedDbLabel.textContent = "Refreshing...";
    const dropdownMenu = dbDropdown.querySelector('.dropdown-menu');
    let contentArea = dropdownMenu.querySelector('.dropdown-content');

    // Structure fix (only if needed)
    if (!contentArea) {
        contentArea = document.createElement('div');
        contentArea.className = 'dropdown-content';
        dropdownMenu.appendChild(contentArea);
    }

    // Add a Footer if missing
    let footer = dropdownMenu.querySelector('.dropdown-footer');
    if (!footer) {
        footer = document.createElement('div');
        footer.className = 'dropdown-footer';
        footer.innerHTML = `
            <button class="btn-refresh-schemas" onclick="switchConnection(null, event)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                Refresh
            </button>
        `;
        dropdownMenu.appendChild(footer);
    }

    // 4. Smooth Transition for Update
    contentArea.style.transition = 'opacity 0.2s';
    contentArea.style.opacity = '0.5';

    try {
        const response = await fetch('/api/databases');
        const data = await response.json();

        // Race condition check
        if (discoveryId !== activeDiscoveryId) return;

        console.log(`📥 Discovery Updated: found ${data.databases?.length} schemas.`);

        // Clear for real data
        contentArea.innerHTML = '';
        const hiddenSelect = document.getElementById('dbSelector');
        if (hiddenSelect) hiddenSelect.innerHTML = '';

        if (data.databases && data.databases.length > 0) {
            data.databases.forEach((db) => {
                const displayName = formatDbName(db);

                // Custom Item
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                if (displayName === selectedDbLabel?.textContent) item.classList.add('selected');
                item.dataset.value = db;
                item.textContent = displayName;
                contentArea.appendChild(item);

                // Hidden Select
                if (hiddenSelect) {
                    const option = document.createElement('option');
                    option.value = db;
                    option.textContent = displayName;
                    if (displayName === selectedDbLabel?.textContent) option.selected = true;
                    hiddenSelect.appendChild(option);
                }
            });

            // Fallback: If nothing was persisted as selected, pick the first one
            if (!contentArea.querySelector('.selected')) {
                const first = contentArea.querySelector('.dropdown-item');
                if (first) {
                    first.classList.add('selected');
                    if (selectedDbLabel) selectedDbLabel.textContent = first.textContent;
                }
            }
        } else {
            contentArea.innerHTML = '<div style="padding:15px; color:#94a3b8; font-size:0.8rem; text-align:center;">No schemas discovered.</div>';
            if (selectedDbLabel) selectedDbLabel.textContent = "Select Database";
        }

        // Restore opacity (Animate In)
        requestAnimationFrame(() => contentArea.style.opacity = '1');

        // Update footer count
        const footer = dropdownMenu.querySelector('.dropdown-footer');
        if (footer) {
            const count = data.databases ? data.databases.length : 0;
            const countLabel = footer.querySelector('#dbCountLabel') || document.createElement('div');
            countLabel.id = 'dbCountLabel';
            countLabel.style.cssText = 'padding: 4px; font-size: 0.7rem; color: #94a3b8; text-align: center; border-bottom: 1px solid #f1f5f9;';
            countLabel.textContent = `Showing ${count} schemas`;
            if (!countLabel.parentElement) footer.prepend(countLabel);
        }

        const connectionStatus = document.getElementById('connectionStatus');
        if (connectionStatus) {
            connectionStatus.textContent = data.connectedTo || 'Not Connected';
        }

    } catch (e) {
        console.error('DB Discovery Error', e);
        contentArea.innerHTML = '<div style="padding:10px; color:#ef4444; font-size:0.8rem;">Failed to load.</div>';
        if (selectedDbLabel) selectedDbLabel.textContent = "Error";
    }
}

// Run initializations
initDbSearch();
fetchDatabases();

// =========================================================
// 4. EVENT LISTENERS
// =========================================================

// Toast Notification Helper (Refined: Single instance, fast exit)
function showToast(message, type = 'error') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = "position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; pointer-events: none;";
        document.body.appendChild(container);
    }

    // POLICY: Remove existing toasts to prevent stacking (Cleaner UI)
    while (container.firstChild) {
        container.firstChild.remove();
    }

    const toast = document.createElement('div');
    const color = type === 'success' ? '#10b981' : '#ef4444';
    const bg = type === 'success' ? '#ecfdf5' : '#fef2f2';
    const icon = type === 'success' ? '✓' : '✕';

    toast.style.cssText = `
            background: ${bg};
            color: ${type === 'success' ? '#065f46' : '#991b1b'};
            padding: 10px 16px;
            border-radius: 99px; /* Pill shape */
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            border: 1px solid ${color};
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.85rem;
            font-weight: 600;
            opacity: 0;
            transform: translateX(30px) scale(0.95); /* Start slightly right & smaller */
            transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); /* Smooth "Apple-like" ease */
            min-width: 200px;
            justify-content: center;
        `;

    toast.innerHTML = `<span style="color:${color}; font-size: 1rem; font-weight: 800;">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    // Animate In
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0) scale(1)';
    });

    // Remove after 2.5s
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(30px) scale(0.95)'; // Slide out right
        setTimeout(() => toast.remove(), 350);
    }, 2500);
}

// A. Generate SQL from NLP
if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
        const input = nlpInput.value.trim();
        if (!input) return;

        // Loading UI (Spinner Only)
        const originalContent = generateBtn.innerHTML;
        generateBtn.innerHTML = `<span class="spinner"></span>`;
        generateBtn.disabled = true;

        try {
            const database = dbSelector.value;

            // 1. Generate
            const genRes = await fetch('/api/generate-sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input, database })
            });
            const genData = await genRes.json();

            // Safety Check (Assuming backend might return error structure)
            if (genData.error) throw new Error(genData.error);

            currentSql = genData.sql;
            if (sqlEditor) sqlEditor.value = currentSql;

            // 2. Execute
            await executeAndRender(currentSql, database);

            // 3. Summary Update
            if (summaryText) {
                if (genData.safety.isSafe) {
                    summaryText.textContent = `Found matching records`;
                    summaryText.style.color = "#059669";
                } else {
                    summaryText.textContent = `Policy Violation: ${genData.safety.reason}`;
                    summaryText.style.color = "#dc2626";
                    showToast(`Policy Violation: ${genData.safety.reason}`, 'error');
                }
            }

            // 4. Show Results Area
            if (heroSection) heroSection.classList.add('compact');
            if (resultsContainer) resultsContainer.style.display = 'block';
            document.querySelector('.content-wrapper').classList.add('wide-mode');

        } catch (error) {
            console.error(error);
            showToast('Something went wrong. Please try again.', 'error');
        } finally {
            generateBtn.innerHTML = originalContent;
            generateBtn.disabled = false;
        }
    });
}

// Enter Key
if (nlpInput) {
    nlpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') generateBtn.click();
    });
}

// B. Manual Run SQL
if (runSqlBtn) {
    runSqlBtn.addEventListener('click', () => {
        if (!sqlEditor) return;
        const manualSql = sqlEditor.value.trim();
        if (!manualSql) return;

        const database = dbSelector.value;

        // UI Feedback
        const originalText = runSqlBtn.innerHTML;
        runSqlBtn.innerHTML = 'Running...';
        runSqlBtn.disabled = true;

        executeAndRender(manualSql, database).finally(() => {
            runSqlBtn.innerHTML = originalText;
            runSqlBtn.disabled = false;
        });
    });
}

// C. Copy SQL to Clipboard
if (copyBtn && sqlEditor) {
    copyBtn.addEventListener('click', () => {
        const text = sqlEditor.value;
        navigator.clipboard.writeText(text).then(() => {
            // Feedback UI
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '✓ Copied!';
            copyBtn.classList.add('copied');

            showToast('SQL copied to clipboard!', 'success');

            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('Copy failed', err);
            showToast('Failed to copy', 'error');
        });
    });
}

// B. Toggle SQL Accordion (Animated)
if (toggleSqlBtn && sqlContent) {

    // 1. Force Initial Clean State
    sqlContent.style.display = ''; // Remove inline styles
    sqlContent.classList.remove('expanded');
    toggleSqlBtn.classList.remove('active');
    toggleSqlBtn.innerHTML = `Show SQL query <span class="chevron">⌄</span>`;

    toggleSqlBtn.addEventListener('click', () => {
        // Safety: Ensure display is clear
        sqlContent.style.display = '';

        const isExpanded = sqlContent.classList.contains('expanded');

        if (isExpanded) {
            // Close
            sqlContent.classList.remove('expanded');
            toggleSqlBtn.classList.remove('active');
            // Keep icon same, CSS rotates it back to 0
            toggleSqlBtn.innerHTML = `Show SQL query <span class="chevron">⌄</span>`;
        } else {
            // Open
            sqlContent.classList.add('expanded');
            toggleSqlBtn.classList.add('active');
            // Keep icon same, CSS rotates it 180deg
            toggleSqlBtn.innerHTML = `Hide SQL query <span class="chevron">⌄</span>`;
        }
    });
}

// D. Copy SQL
if (copyBtn) {
    copyBtn.addEventListener('click', () => {
        const val = sqlEditor ? sqlEditor.value : '';
        navigator.clipboard.writeText(val);

        const original = copyBtn.innerText;
        copyBtn.innerText = 'Copied!';
        setTimeout(() => copyBtn.innerText = original, 2000);
    });
}

// E. Pagination Controls
if (prevPageBtn) prevPageBtn.addEventListener('click', () => changePage(-1));
if (nextPageBtn) nextPageBtn.addEventListener('click', () => changePage(1));


// =========================================================
// 5. DROPDOWN INTERACTIONS (Generic)
// =========================================================

// Toggle Logic
const allDropdowns = document.querySelectorAll('.custom-dropdown');
allDropdowns.forEach(dd => {
    dd.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close other custom dropdowns
        allDropdowns.forEach(other => {
            if (other !== dd) other.classList.remove('active');
        });

        // Close Settings Dropdown
        const settingsDd = document.querySelector('.settings-dropdown');
        if (settingsDd) settingsDd.classList.remove('active');

        dd.classList.toggle('active');
    });
});

document.addEventListener('click', () => {
    allDropdowns.forEach(dd => dd.classList.remove('active'));
});

// DB Dropdown Specifics
if (dbDropdown) {
    dbDropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('dropdown-item')) {
            const val = e.target.dataset.value; // Raw value (e.g. xerago_staging)
            const text = e.target.textContent;  // Pretty value (e.g. Xerago Staging)

            if (selectedDbLabel) selectedDbLabel.textContent = text;
            if (dbSelector) dbSelector.value = val;

            // Sync "Connected to..." text + " DB" suffix
            const connectionInfoStrong = document.querySelector('.connection-info strong');
            if (connectionInfoStrong) connectionInfoStrong.textContent = `${text} DB`;

            dbDropdown.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('selected'));
            e.target.classList.add('selected');
        }
    });
}

// Modal DB Type Dropdown Specifics
const modalDbDropdown = document.getElementById('newConnTypeDropdown');
if (modalDbDropdown) {
    modalDbDropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (item) {
            const val = item.dataset.value;
            const text = item.textContent;

            const label = modalDbDropdown.querySelector('.selected-value');
            const hiddenInput = document.getElementById('newConnType');

            if (label) label.textContent = text;
            if (hiddenInput) {
                hiddenInput.value = val;
                // Trigger change event to update Port automatically
                hiddenInput.dispatchEvent(new Event('change'));
            }

            // Update Selected State
            modalDbDropdown.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
        }
    });
}

// Export Dropdown Specifics
if (exportDropdown) {
    exportDropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;
        const action = item.dataset.action;

        if (currentData.length === 0) {
            alert('No data to export');
            return;
        }

        if (action === 'csv') downloadCSV(currentData);
        if (action === 'json') downloadJSON(currentData);
        if (action === 'copy') copyToClipboard(currentData, item);
    });
}

// =========================================================
// 5.4 FULLSCREEN TOGGLE
// =========================================================
const expandBtn = document.getElementById('expandBtn');

if (expandBtn) {
    expandBtn.addEventListener('click', () => {
        // Robustly find the parent card
        const dataCard = expandBtn.closest('.data-card');
        if (!dataCard) return;

        const isFullscreen = dataCard.classList.contains('fullscreen-mode');

        if (!isFullscreen) {
            // === ENTER FULLSCREEN ===
            // 1. Drop a bookmark so we know where to return
            const bookmark = document.createElement('div');
            bookmark.id = 'fullscreen-bookmark';
            bookmark.style.display = 'none';
            dataCard.parentNode.insertBefore(bookmark, dataCard);

            // 2. Teleport to Body (Breaks out of any container transforms)
            document.body.appendChild(dataCard);

            // 3. Apply Class
            dataCard.classList.add('fullscreen-mode');

            // 4. Update Icon (Minimize)
            expandBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                    </svg>
                `;

        } else {
            // === EXIT FULLSCREEN ===
            // 1. Find bookmark
            const bookmark = document.getElementById('fullscreen-bookmark');

            // 2. Teleport Back
            if (bookmark) {
                bookmark.parentNode.insertBefore(dataCard, bookmark);
                bookmark.remove();
            } else {
                // Fallback just in case
                const container = document.getElementById('resultsContainer') || document.querySelector('.content-wrapper');
                if (container) container.appendChild(dataCard);
            }

            // 3. Remove Class
            dataCard.classList.remove('fullscreen-mode');

            // 4. Update Icon (Maximize)
            expandBtn.innerHTML = `
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                    </svg>
                `;
        }
    });
}

// =========================================================
// 5.5 FILTER TOGGLE MODE & PER-COLUMN SORT
// =========================================================
const filterToggleBtn = document.getElementById('filterToggleBtn');

// 1. Toggle Filter Mode
if (filterToggleBtn) {
    filterToggleBtn.addEventListener('click', () => {
        isFilterMode = !isFilterMode;

        // UI Toggle
        filterToggleBtn.classList.toggle('active', isFilterMode);
        resultTable.classList.toggle('filter-active', isFilterMode);

        // Logic: If turning OFF, reset sort
        if (!isFilterMode) {
            applySort(null, 'none'); // Reset to original
        }
    });
}

const contextMenu = document.getElementById('columnContextMenu');
let currentSortState = { column: null, direction: null }; // track current active sort

// Handle Menu Options
if (contextMenu) {
    contextMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.ctx-item');
        if (item && activeSortColumn) {
            const direction = item.dataset.sort;
            applySort(activeSortColumn, direction);
            contextMenu.classList.remove('active');
        }
    });
}

// Hide Menu on Outside Click
document.addEventListener('click', (e) => {
    if (contextMenu && contextMenu.classList.contains('active')) {
        // If click is not inside the menu, close it
        if (!e.target.closest('.context-menu')) {
            contextMenu.classList.remove('active');
        }
    }
});

function openContextMenu(e, col) {
    e.stopPropagation(); // Don't trigger other clicks
    activeSortColumn = col;
    const btn = e.currentTarget; // The clicked 3-dots button

    // Force menu to be the very last element in DOM (above fullscreen card)
    document.body.appendChild(contextMenu);

    // Get Button Position
    const rect = btn.getBoundingClientRect();

    // Default: Align Left of Menu to Left of Button (Extends Right)
    // This prevents covering the column header text which is usually to the left of the button
    let leftPos = rect.left;

    // Check for Right Overflow
    const menuWidth = 180; // approximate width
    if (leftPos + menuWidth > window.innerWidth) {
        // If dragging right goes off screen, flip to align Right
        leftPos = rect.right - menuWidth;
    }

    contextMenu.style.top = `${rect.bottom + 4}px`;
    contextMenu.style.left = `${leftPos}px`;

    contextMenu.classList.add('active');

    // Close on Scroll (Fix for persistent weirdness)
    const closeOnScroll = () => {
        contextMenu.classList.remove('active');
        window.removeEventListener('scroll', closeOnScroll, true);
    };
    // Capture phase true to catch any scroll in any container
    window.addEventListener('scroll', closeOnScroll, true);
}

function applySort(column, direction) {
    // Handle Reset (Clear Sort)
    if (direction === 'none') {
        currentSortState = { column: null, direction: null };
        currentData = [...originalData]; // Restore original order
        currentPage = 1;
        renderPagination();
        return; // EXIT FUNCTION - Do not proceed to sort
    }

    currentSortState = { column, direction };

    // Sort Data
    currentData.sort((a, b) => {
        let valA = a[column];
        let valB = b[column];

        // Handle Nulls/Undefined
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        // Numeric check
        if (!isNaN(parseFloat(valA)) && isFinite(valA) && !isNaN(parseFloat(valB)) && isFinite(valB)) {
            valA = parseFloat(valA);
            valB = parseFloat(valB);
        } else {
            // String check
            valA = valA.toString().toLowerCase();
            valB = valB.toString().toLowerCase();
        }

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    currentPage = 1;
    renderPagination();
}

// ... inside renderPagination ...


// =========================================================
// 6. LOGIC & HELPERS
// =========================================================

// Global for debug info
let currentDebugInfo = null;

async function executeAndRender(sql, database) {
    try {
        const execRes = await fetch('/api/execute-query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, database })
        });
        const execData = await execRes.json();

        // Update State
        currentData = execData.results || [];
        originalData = [...currentData]; // Capture baseline for reset
        currentDebugInfo = execData.debug || null; // Capture debug info
        currentPage = 1;
        currentSortState = { column: null, direction: null };

        renderPagination();

        if (summaryText && !nlpInput.value.trim()) {
            summaryText.textContent = `Query executed successfully (${currentData.length} rows)`;
        }

    } catch (e) {
        console.error(e);
        showToast('Execution failed. Check SQL syntax.', 'error');
    }
}

function changePage(delta) {
    const totalPages = Math.ceil(currentData.length / rowsPerPage);
    const newPage = currentPage + delta;

    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        renderPagination();
    }
}

function renderPagination() {
    const thead = resultTable.querySelector('thead');
    const tbody = resultTable.querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Maintain Filter Mode Class
    resultTable.classList.toggle('filter-active', isFilterMode);

    if (currentData.length === 0) {
        if (rowCountLabel) rowCountLabel.textContent = '0 rows';
        if (pageIndicator) pageIndicator.textContent = '0-0 of 0';
        if (prevPageBtn) prevPageBtn.disabled = true;
        if (nextPageBtn) nextPageBtn.disabled = true;

        // Enhanced Zero-Row Message
        let messageHtml = 'No data found';
        if (currentDebugInfo) {
            messageHtml = `
                <div style="margin-bottom: 0.5rem; font-weight: 600; color: #1e293b;">
                    ${currentDebugInfo.message}
                </div>
                <div style="font-size: 0.85rem; color: #64748b;">
                    Analyzed table: <code>${currentDebugInfo.tableName}</code> (${currentDebugInfo.totalRows} total rows)
                </div>
            `;
        } else {
            messageHtml = `<div style="color: #9ca3af;">No data returned from query.</div>`;
        }

        tbody.innerHTML = `<tr><td colspan="100%" style="text-align:center; padding: 2rem;">${messageHtml}</td></tr>`;
        return;
    }


    // Slice Data
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, currentData.length);
    const pagedData = currentData.slice(startIndex, endIndex);

    // Header with Context Menu Triggers
    const cols = Object.keys(currentData[0]);
    const headerRow = document.createElement('tr');
    cols.forEach(col => {
        const th = document.createElement('th');
        // Check active state
        if (currentSortState.column === col) {
            th.classList.add('sort-active');
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'th-wrapper';

        const textSpan = document.createElement('span');
        let label = col.replace(/_/g, ' ');
        // Add arrow to label if active
        if (currentSortState.column === col) {
            label += currentSortState.direction === 'asc' ? ' ↑' : ' ↓';
        }
        textSpan.textContent = label;

        const btn = document.createElement('button');
        btn.className = 'th-menu-btn';
        btn.innerHTML = '⋮'; // Context Menu Icon
        btn.onclick = (e) => openContextMenu(e, col);

        wrapper.appendChild(textSpan);
        wrapper.appendChild(btn);
        th.appendChild(wrapper);
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    // Body (Standard) with Staggered Animation
    pagedData.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.classList.add('animate-in');
        tr.style.animationDelay = `${index * 0.05}s`; // Stagger effect

        cols.forEach(col => {
            const td = document.createElement('td');
            const val = row[col];
            if (typeof val === 'string' && val.toLowerCase() === 'active' && col.toLowerCase().includes('status')) {
                td.innerHTML = `<span style="background: #ecfdf5; color: #047857; padding: 2px 8px; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">Active</span>`;
            } else {
                td.textContent = val !== null ? val : '-';
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    // Footer Info (Combined)
    if (rowCountLabel) rowCountLabel.textContent = `${currentData.length} rows total`;
    if (pageIndicator) pageIndicator.textContent = `${startIndex + 1}-${endIndex} of ${currentData.length}`;

    if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= Math.ceil(currentData.length / rowsPerPage);
}

// -- Export Helpers --

function downloadCSV(data) {
    fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
    })
        .then(r => r.blob())
        .then(blob => downloadBlob(blob, 'export.csv'))
        .catch(console.error);
}

function downloadJSON(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'export.json');
}

function copyToClipboard(data, uiElement) {
    const keys = Object.keys(data[0]);
    const tsv = [keys.join('\t'), ...data.map(r => keys.map(k => r[k]).join('\t'))].join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
        const original = uiElement.textContent;
        uiElement.textContent = 'Copied!';
        setTimeout(() => uiElement.textContent = original, 1500);
    });
}

function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// =========================================================
// 6. TABS LOGIC
// =========================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // 1. Remove active from all buttons
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        // 2. Add active to clicked
        btn.classList.add('active');

        // 3. Hide all tab content
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // 4. Show target tab content
        const tabId = btn.dataset.tab;
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.add('active');

        // 5. Optional: Refresh list if viewing connections
        if (tabId === 'saved-connections') {
            loadConnections();
        }
    });
});


