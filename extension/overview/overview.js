let currentFilter = "all";
let currentSearch = "";
let latestOverviewItems = [];

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("refreshBtn").addEventListener("click", loadOverview);
    document.getElementById("clearOldBtn").addEventListener("click", clearOldData);

    setupFilters();
    setupOverviewSearch();

    loadOverview();

    setInterval(loadOverview, 1000);
});

function loadOverview() {
    chrome.storage.local.get({ soaTrackingSnapshots: {} }, result => {
        const snapshots = Object.values(result.soaTrackingSnapshots || {});

        const activeSnapshots = snapshots
            .filter(item => Date.now() - item.updatedAt < 5 * 60 * 1000)
            .sort((a, b) => {
                if (b.critical !== a.critical) return b.critical - a.critical;
                if (b.warning !== a.warning) return b.warning - a.warning;
                if (a.healthScore !== b.healthScore) return a.healthScore - b.healthScore;
                return b.updatedAt - a.updatedAt;
            });

        latestOverviewItems = activeSnapshots;
        renderCurrentOverview();
    });
}

function renderCurrentOverview() {
    const filteredItems = applyOverviewSearch(
        applyOverviewFilter(latestOverviewItems)
    );

    renderSummary(filteredItems);
    renderGlobalAlert(latestOverviewItems);
    renderBranches(filteredItems);
}

function renderSummary(items) {
    const totalOrders = items.reduce((sum, item) => sum + Number(item.orders || 0), 0);
    const totalCritical = items.reduce((sum, item) => sum + Number(item.critical || 0), 0);
    const totalWarning = items.reduce((sum, item) => sum + Number(item.warning || 0), 0);

    setText("totalBranches", items.length);
    setText("totalOrders", totalOrders);
    setText("totalCritical", totalCritical);
    setText("totalWarning", totalWarning);
}

function renderGlobalAlert(items) {
    const alertBox = document.getElementById("globalAlert");
    if (!alertBox) return;

    const totalCritical = items.reduce((sum, item) => sum + Number(item.critical || 0), 0);
    const criticalBranches = items.filter(item => Number(item.critical || 0) > 0);

    if (totalCritical === 0) {
        alertBox.classList.add("hidden");
        alertBox.textContent = "";
        return;
    }

    const branchNames = criticalBranches
        .slice(0, 4)
        .map(item => item.branchName || item.branchId)
        .join(", ");

    alertBox.classList.remove("hidden");

    alertBox.innerHTML = `
        🚨 <strong>${totalCritical}</strong> Critical Orders
        across <strong>${criticalBranches.length}</strong> branches
        <span>${escapeHtml(branchNames)}</span>
    `;
}

function renderBranches(items) {
    const container = document.getElementById("branchesContainer");
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty">
                No active tracking pages found.<br>
                Open one or more Branch Tracking pages first.
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(item => {
        const cardClass = Number(item.critical || 0) > 0
            ? "critical"
            : Number(item.warning || 0) > 0
                ? "warning"
                : "";

        return `
            <div class="branch-card ${cardClass}">
                <div class="branch-header">
                    <div>
                        <div class="branch-title">${escapeHtml(item.branchName || item.branchId)}</div>
                        <div class="branch-time">Updated ${formatAge(item.updatedAt)}</div>
                    </div>

                    <button data-url="${escapeHtml(item.url)}" class="open-tracking-btn">
                        Open
                    </button>
                </div>

                <div class="branch-stats">
                    <div class="stat">
                        <span>Health</span>
                        <strong class="${getHealthClass(item.healthScore)}">${item.healthScore ?? 0}%</strong>
                    </div>

                    <div class="stat">
                        <span>Critical</span>
                        <strong class="critical-text">${item.critical ?? 0}</strong>
                    </div>

                    <div class="stat">
                        <span>Warning</span>
                        <strong class="warning-text">${item.warning ?? 0}</strong>
                    </div>

                    <div class="stat">
                        <span>Orders</span>
                        <strong>${item.orders ?? 0}</strong>
                    </div>

                    <div class="stat">
                        <span>Captains</span>
                        <strong>${item.captains ?? 0}</strong>
                    </div>

                    <div class="stat">
                        <span>Free</span>
                        <strong class="good-text">${item.free ?? 0}</strong>
                    </div>

                    <div class="stat">
                        <span>Offline</span>
                        <strong>${item.offline ?? 0}</strong>
                    </div>

                    <div class="stat">
                        <span>On Way</span>
                        <strong>${item.onWay ?? 0}</strong>
                    </div>
                </div>

                ${renderCriticalOrders(item.criticalOrders)}
            </div>
        `;
    }).join("");

    document.querySelectorAll(".open-tracking-btn").forEach(button => {
        button.addEventListener("click", () => {
            openOrFocusTrackingTab(button.dataset.url);
        });
    });
}

function renderCriticalOrders(orders) {
    if (!orders || orders.length === 0) {
        return "";
    }

    return `
        <div class="critical-orders">
            <strong class="critical-text">Critical Orders</strong>

            ${orders.map(order => `
                <div class="critical-order">
                    #${escapeHtml(order.id)} — ${escapeHtml(order.status)} — ${order.elapsedMinutes ?? "-"} min
                    ${order.distance ? `— ${order.distance} KM` : ""}
                    ${order.captain ? `— Captain ${escapeHtml(order.captain)}` : ""}
                </div>
            `).join("")}
        </div>
    `;
}

function setupFilters() {
    document.querySelectorAll(".filter-btn").forEach(button => {
        button.addEventListener("click", () => {
            currentFilter = button.dataset.filter || "all";

            document.querySelectorAll(".filter-btn").forEach(item => {
                item.classList.remove("active");
            });

            button.classList.add("active");

            renderCurrentOverview();
        });
    });
}

function applyOverviewFilter(items) {
    if (currentFilter === "critical") {
        return items.filter(item => Number(item.critical || 0) > 0);
    }

    if (currentFilter === "warning") {
        return items.filter(item =>
            Number(item.critical || 0) === 0 &&
            Number(item.warning || 0) > 0
        );
    }

    if (currentFilter === "healthy") {
        return items.filter(item =>
            Number(item.critical || 0) === 0 &&
            Number(item.warning || 0) === 0
        );
    }

    return items;
}

function setupOverviewSearch() {
    const input = document.getElementById("overviewSearchInput");
    if (!input) return;

    input.addEventListener("input", () => {
        currentSearch = input.value.trim().toLowerCase();
        renderCurrentOverview();
    });
}

function applyOverviewSearch(items) {
    if (!currentSearch) {
        return items;
    }

    return items.filter(item => {
        const branchText = [
            item.branchId,
            item.branchName,
            item.healthStatus,
            item.url
        ].join(" ").toLowerCase();

        const criticalOrdersText = (item.criticalOrders || [])
            .map(order => [
                order.id,
                order.status,
                order.captain,
                order.distance,
                order.elapsedMinutes
            ].join(" "))
            .join(" ")
            .toLowerCase();

        return (
            branchText.includes(currentSearch) ||
            criticalOrdersText.includes(currentSearch)
        );
    });
}

function clearOldData() {
    chrome.storage.local.set({ soaTrackingSnapshots: {} }, () => {
        latestOverviewItems = [];
        loadOverview();
    });
}

function openOrFocusTrackingTab(url) {
    if (!url) return;

    chrome.tabs.query({}, tabs => {
        const existingTab = tabs.find(tab => tab.url === url);

        if (existingTab) {
            chrome.tabs.update(existingTab.id, { active: true });

            if (existingTab.windowId) {
                chrome.windows.update(existingTab.windowId, { focused: true });
            }

            return;
        }

        chrome.tabs.create({ url });
    });
}

function formatAge(timestamp) {
    if (!timestamp) return "unknown";

    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
}

function getHealthClass(score) {
    if (score >= 75) return "good-text";
    if (score >= 60) return "warning-text";
    return "critical-text";
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.soaTrackingSnapshots) {
        loadOverview();
    }
});