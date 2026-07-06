console.log("🟢 SOA Branch Tracking Scanner Loaded");


let alertedOrders = new Set();
let audioUnlocked = false;
let isMuted = false;
let lastLog = "";
let latestOrders = [];
let scannerIntervalId = null;
let soaDragState = null;
let soaDragDocumentListenersReady = false;
let soaAudioContext = null;
let soaAudioEnabled = false;
let lastRoamingAlertAt = 0;

const SCAN_INTERVAL_MS = 1000;

let soaSettings = {
    roamingAlertCount: 8,
    warningMinutes: 25,
    criticalMinutes: 30,
    atPickUpWarningMinutes: 2,
    notAssignedWarningMinutes: 10,
    soundEnabled: true,
    criticalPanelEnabled: true
};
let soaAlarm = null;

// SOA alert sound uses Web Audio tones only.
// No external alert.mp3 file is required.
document.addEventListener(
    "click",
    () => {
        audioUnlocked = true;
    },
    { once: true }
);

function startSOA() {
    
    checkPageAndScan();

    if (scannerIntervalId) {
        clearInterval(scannerIntervalId);
    }

    scannerIntervalId = setInterval(() => {
        checkPageAndScan();
    }, SCAN_INTERVAL_MS);

    window.addEventListener("hashchange", () => {
        checkPageAndScan();
    });
}

function checkPageAndScan() {
    if (!isTrackingPage()) {
        removeOldSOAElements();
        removeDashboardToggleButton();
        return;
    }

    if (!document.getElementById("soa-dashboard")) {
        createDashboard();
    }

    createDashboardToggleButton();

    scanNow();
}

function hasLiveChromeStorage() {
    try {
        return (
            typeof chrome !== "undefined" &&
            chrome.runtime &&
            chrome.runtime.id &&
            chrome.storage &&
            chrome.storage.local
        );
    } catch (error) {
        return false;
    }
}

function loadSOASettings(callback) {
    try {
        if (!hasLiveChromeStorage()) {
            callback?.();
            return;
        }

        chrome.storage.local.get(soaSettings, settings => {
            soaSettings = normalizeSettings(settings);
            isMuted = !soaSettings.soundEnabled;
            callback?.();
        });
    } catch (error) {
        console.warn("SOA settings load skipped:", error.message);
        callback?.();
    }
}

function normalizeSettings(settings) {
    const roamingAlertCount = Number(settings?.roamingAlertCount);
    const warningMinutes = Number(settings?.warningMinutes);
    const criticalMinutes = Number(settings?.criticalMinutes);
    const atPickUpWarningMinutes = Number(settings?.atPickUpWarningMinutes);
    const notAssignedWarningMinutes = Number(settings?.notAssignedWarningMinutes);

    const safeCritical = Number.isFinite(criticalMinutes) && criticalMinutes > 0
        ? criticalMinutes
        : 30;

    let safeWarning = Number.isFinite(warningMinutes) && warningMinutes > 0
        ? warningMinutes
        : 25;

    if (safeWarning >= safeCritical) {
        safeWarning = Math.max(1, safeCritical - 5);
    }

    return {
        roamingAlertCount:
    Number.isFinite(roamingAlertCount) && roamingAlertCount > 0
        ? roamingAlertCount
        : 8,
        warningMinutes: safeWarning,
        criticalMinutes: safeCritical,
        atPickUpWarningMinutes:
    Number.isFinite(atPickUpWarningMinutes) && atPickUpWarningMinutes > 0
        ? atPickUpWarningMinutes
        : 2,
        notAssignedWarningMinutes:
    Number.isFinite(notAssignedWarningMinutes) && notAssignedWarningMinutes > 0
        ? notAssignedWarningMinutes
        : 10,
        soundEnabled: settings?.soundEnabled !== false,
        criticalPanelEnabled: settings?.criticalPanelEnabled !== false
        
    };
}

try {
    if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.onMessage
    ) {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === "SOA_SETTINGS_UPDATED") {
                soaSettings = normalizeSettings(message.settings || soaSettings);
                isMuted = !soaSettings.soundEnabled;

                updateSoundButton();
                updateCriticalToggleButton();
                updateThresholdLabels();
                checkPageAndScan();
            }
        });
    }
} catch (error) {
    console.warn("SOA message listener skipped:", error.message);
}

loadSOASettings(() => {
    startSOA();
});

function removeOldSOAElements() {
    const oldDashboard = document.getElementById("soa-dashboard");
    if (oldDashboard) oldDashboard.remove();

    const oldPanel = document.getElementById("soa-critical-panel");
    if (oldPanel) oldPanel.remove();

    const oldTopBar = document.getElementById("soa-topbar-widget");
    if (oldTopBar) oldTopBar.remove();
}

function isTrackingPage() {
    return window.location.href.includes("/tracking");
}

function createDashboard() {
    const oldDashboard = document.getElementById("soa-dashboard");
    if (oldDashboard) oldDashboard.remove();

    const dashboard = document.createElement("div");
    dashboard.id = "soa-dashboard";
    applyDashboardBaseStyle(dashboard);

    dashboard.innerHTML = `
        <div class="soa-dashboard-header">
            <div class="soa-title" style="font-size:15px;font-weight:900;color:#2dce89;">
                Samurai Operations Assistant
            </div>

            <button id="soa-collapse-btn" class="soa-collapse-btn" title="Collapse / Expand">
                −
            </button>
        </div>

        <div id="soa-dashboard-body">
            <div class="soa-health-box" style="margin-bottom:12px;padding:10px;border-radius:10px;background:rgba(31,41,55,.9);text-align:center;">
                <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Health Score</div>
                <div id="soa-health-score" style="font-size:28px;font-weight:900;color:#2dce89;">100%</div>
                <div id="soa-health-status" style="font-size:12px;font-weight:800;color:#d1d5db;">Healthy</div>
            </div>

            <div class="soa-row"><span>Orders</span><strong id="soa-orders">0</strong></div>
            <div class="soa-row"><span id="soa-critical-label">Critical ${soaSettings.criticalMinutes}+</span><strong id="soa-critical">0</strong></div>
            <div class="soa-row"><span id="soa-warning-label">Warning ${soaSettings.warningMinutes}+</span><strong id="soa-warning">0</strong></div>
            <div class="soa-row"><span>On The Way</span><strong id="soa-on-way">0</strong></div>
            <div class="soa-row"><span>Collecting</span><strong id="soa-collecting">0</strong></div>
            <div class="soa-row"><span>Free</span><strong id="soa-free">0</strong></div>
            <div class="soa-row"><span>Captains</span><strong id="soa-captains">0</strong></div>
            <div class="soa-row"><span>Free</span><strong id="soa-free">0</strong></div>
            <div class="soa-row"><span>Roaming</span><strong id="soa-roaming">0</strong></div>
            <div class="soa-row"><span>In Store</span><strong id="soa-in-store">0</strong></div>
            <div class="soa-row"><span>Offline</span><strong id="soa-offline">0</strong></div>
            <div class="soa-status" style="margin-top:10px;font-size:12px;color:#9ca3af;">
                Scanner: <span id="soa-status">Running</span>
            </div>

            <button id="soa-mute-btn" class="soa-mute-btn">
                ${isMuted ? "🔇 Muted" : "🔊 Sound On"}
            </button>
            
            <button id="soa-test-sound-btn" class="soa-mute-btn">
    🔔 Enable / Test Sound
</button>

            <button id="soa-critical-toggle" class="soa-mute-btn">
                ${soaSettings.criticalPanelEnabled ? "🚨 Hide Critical Panel" : "🚨 Show Critical Panel"}
            </button>
        </div>
    `;

    document.body.appendChild(dashboard);
    
    setupTestSoundButton();
    applyDashboardChildStyles();
    setupSoundButton();
    setupCriticalToggleButton();
    setupDashboardCollapseButton();
    setupDraggablePanels();
}

function applyDashboardBaseStyle(dashboard) {
    dashboard.style.position = "fixed";
    dashboard.style.top = "95px";
    dashboard.style.right = "225px";
    dashboard.style.left = "auto";
    dashboard.style.width = "270px";
    dashboard.style.maxHeight = "calc(100vh - 120px)";
    dashboard.style.overflowY = "auto";
    dashboard.style.background = "rgba(17, 24, 39, 0.98)";
    dashboard.style.color = "#ffffff";
    dashboard.style.border = "2px solid #2dce89";
    dashboard.style.borderRadius = "12px";
    dashboard.style.padding = "14px";
    dashboard.style.zIndex = "2147483646";
    dashboard.style.boxShadow = "0 12px 30px rgba(0, 0, 0, 0.65)";
    dashboard.style.fontFamily = "Arial, sans-serif";
    dashboard.style.fontSize = "13px";
}

function applyDashboardChildStyles() {
    const header = document.querySelector("#soa-dashboard .soa-dashboard-header");
    if (header) {
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";
        header.style.gap = "8px";
        header.style.marginBottom = "12px";
        header.style.cursor = "move";
    }

    document.querySelectorAll("#soa-dashboard .soa-row").forEach(row => {
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "5px 0";
        row.style.borderBottom = "1px solid rgba(255,255,255,.08)";
    });

    document.querySelectorAll("#soa-dashboard .soa-row span").forEach(span => {
        span.style.color = "#d1d5db";
    });

    document.querySelectorAll("#soa-dashboard .soa-row strong").forEach(strong => {
        strong.style.color = "#ffffff";
        strong.style.fontSize = "15px";
    });

    document.querySelectorAll("#soa-dashboard .soa-mute-btn").forEach(button => {
        button.style.width = "100%";
        button.style.marginTop = "10px";
        button.style.padding = "7px";
        button.style.border = "1px solid #2dce89";
        button.style.borderRadius = "8px";
        button.style.background = "rgba(45,206,137,.12)";
        button.style.color = "#ffffff";
        button.style.fontWeight = "700";
        button.style.cursor = "pointer";
    });

    const collapseButton = document.getElementById("soa-collapse-btn");
    if (collapseButton) {
        collapseButton.style.width = "28px";
        collapseButton.style.height = "24px";
        collapseButton.style.border = "1px solid #2dce89";
        collapseButton.style.borderRadius = "6px";
        collapseButton.style.background = "rgba(45,206,137,.12)";
        collapseButton.style.color = "#ffffff";
        collapseButton.style.fontWeight = "900";
        collapseButton.style.cursor = "pointer";
        collapseButton.style.padding = "0";
        collapseButton.style.margin = "0";
        collapseButton.style.flex = "0 0 auto";
    }
}

function setupSoundButton() {
    const muteButton = document.getElementById("soa-mute-btn");
    if (!muteButton) return;

    muteButton.addEventListener("click", () => {
        isMuted = !isMuted;
        soaSettings.soundEnabled = !isMuted;

        updateSoundButton();
        savePartialSettings({ soundEnabled: soaSettings.soundEnabled });
    });
}

function setupCriticalToggleButton() {
    const criticalToggleButton = document.getElementById("soa-critical-toggle");
    if (!criticalToggleButton) return;

    criticalToggleButton.addEventListener("click", () => {
        soaSettings.criticalPanelEnabled = !soaSettings.criticalPanelEnabled;

        const panel = document.getElementById("soa-critical-panel");
        if (panel) {
            panel.style.display = soaSettings.criticalPanelEnabled ? "block" : "none";
        }

        updateCriticalToggleButton();
        savePartialSettings({ criticalPanelEnabled: soaSettings.criticalPanelEnabled });
        checkPageAndScan();
    });
}

function setupDashboardCollapseButton() {
    const collapseButton = document.getElementById("soa-collapse-btn");
    const dashboardBody = document.getElementById("soa-dashboard-body");
    const dashboard = document.getElementById("soa-dashboard");

    if (!collapseButton || !dashboardBody || !dashboard) return;

    collapseButton.addEventListener("click", () => {
        const isCollapsed = dashboard.dataset.collapsed === "true";

        if (isCollapsed) {
            dashboard.dataset.collapsed = "false";
            dashboardBody.style.display = "block";
            collapseButton.textContent = "−";
            dashboard.style.width = "270px";
        } else {
            dashboard.dataset.collapsed = "true";
            dashboardBody.style.display = "none";
            collapseButton.textContent = "+";
            dashboard.style.width = "270px";
        }
    });
}

function updateSoundButton() {
    const muteButton = document.getElementById("soa-mute-btn");
    if (muteButton) {
        muteButton.textContent = isMuted ? "🔇 Muted" : "🔊 Sound On";
    }
}

function updateCriticalToggleButton() {
    const criticalToggleButton = document.getElementById("soa-critical-toggle");
    if (criticalToggleButton) {
        criticalToggleButton.textContent = soaSettings.criticalPanelEnabled
            ? "🚨 Hide Critical Panel"
            : "🚨 Show Critical Panel";
    }
}

function updateThresholdLabels() {
    setText("soa-critical-label", `Critical ${soaSettings.criticalMinutes}+`);
    setText("soa-warning-label", `Warning ${soaSettings.warningMinutes}+`);
}

function savePartialSettings(partialSettings) {
    try {
        if (!hasLiveChromeStorage()) return;
        chrome.storage.local.set(partialSettings);
    } catch (error) {
        console.warn("SOA save settings skipped:", error.message);
    }
}

function scanNow() {
    if (!isTrackingPage()) return;

    try {
        const orders = getOrders();
        latestOrders = orders;
        const captains = getCaptains();
        const stats = buildStats(orders, captains);

        updateDashboard(stats);
        handleRoamingAlert(stats);
        highlightOrders(orders);
        handleCriticalAlerts(orders);
        updateCriticalPanel(orders);
        saveTrackingSnapshot(stats, orders);

        const log = JSON.stringify(stats);

        if (log !== lastLog) {
            console.log("SOA Orders:", orders);
            console.log("SOA Captains:", captains);
            console.log("SOA Stats:", stats);
            lastLog = log;
        }
    } catch (error) {
        console.error("SOA ERROR:", error);
        setText("soa-status", "Error");
    }
}

function getOrders() {
    const cards = Array.from(document.querySelectorAll("div")).filter(div => {
        const text = div.innerText || "";
        const normalized = normalizeStatusText(text);

        return (
            text.includes("#orders-order-") &&
            hasPaymentType(text) &&
            text.includes("Show") &&
            (
                normalized.includes("ON_THE_WAY") ||
                normalized.includes("COLLECTING_ORDER") ||
                normalized.includes("NEAR_PICK_UP") ||
                normalized.includes("AT_PICK_UP") ||
                normalized.includes("NEAR_DELIVERY") ||
                normalized.includes("AT_DELIVERY") ||
                normalized.includes("RETURNING_TO_AREA") ||
                normalized.includes("NOT_ASSIGNED")
            )
        );
    });

    const smallestCards = getSmallestCards(cards);

    return smallestCards
        .map(card => {
            const text = card.innerText || "";
            const createdAt = extractCreatedAt(text);

            return {
                id: extractOrderId(text),
                status: extractStatus(text),
                distance: extractDistance(text),
                captain: extractCaptainId(text),
                createdAt,
                elapsedMinutes: createdAt ? minutesSince(createdAt) : null,
                element: card
            };
        })
        .filter(order => order.id);
}

function hasPaymentType(text) {
    return (
        text.includes("PREPAID") ||
        text.includes("POSTPAID") ||
        text.includes("CASH")
    );
}

function getSmallestCards(cards) {
    const result = [];

    cards.forEach(card => {
        const text = card.innerText || "";
        const id = extractOrderId(text);

        if (!id) return;

        const existingIndex = result.findIndex(existing => {
            const existingText = existing.innerText || "";
            return extractOrderId(existingText) === id;
        });

        if (existingIndex === -1) {
            result.push(card);
            return;
        }

        const existing = result[existingIndex];

        if (existing.contains(card)) {
            result[existingIndex] = card;
        }
    });

    return result;
}

function getCaptains() {
    const links = Array.from(
        document.querySelectorAll('a[href*="/admin/captains/"]')
    );

    const captains = [];

    links.forEach(link => {
        const card = findCaptainCard(link);
        if (!card) return;

        const text = card.innerText || "";
        const name = clean(link.innerText);
        const idMatch = name.match(/^\d+/);
        const ordersMatch = text.match(/No\. of orders:\s*(\d+)/i);

        captains.push({
            id: idMatch ? idMatch[0] : "",
            name,
            orders: ordersMatch ? Number(ordersMatch[1]) : 0,
            workStatus: extractCaptainWorkStatus(text),
            connection: extractCaptainConnection(text),
            element: card
        });
    });

    return uniqueById(captains);
}

function findCaptainCard(element) {
    let current = element;

    for (let i = 0; i < 8; i++) {
        if (!current) return null;

        const text = current.innerText || "";
        const upper = text.toUpperCase();

        if (
            text.includes("No. of orders") &&
            (upper.includes("CONNECTED") || upper.includes("OFFLINE"))
        ) {
            return current;
        }

        current = current.parentElement;
    }

    return null;
}

function buildStats(orders, captains) {
    const critical = orders.filter(order => isCriticalOrder(order));
    const warning = orders.filter(order => isWarningOrder(order));

    const offlineCaptains = captains.filter(captain =>
        captain.connection === "OFFLINE"
    );

    const freeCaptains = captains.filter(captain =>
        captain.workStatus === "IN_AREA" &&
        captain.connection === "CONNECTED"
    );

    const healthScore = calculateHealthScore(
        critical.length,
        warning.length,
        offlineCaptains.length
    );
   const roamingCaptains = captains.filter(captain =>
    captain.workStatus === "ROAMING" ||
    captain.locationStatus === "ROAMING"
    
);


const inStoreCaptains = captains.filter(captain =>
    captain.workStatus === "IN_STORE" ||
    captain.locationStatus === "IN_STORE"
);
const roamingCountFromFooter = extractBottomCounter("Roaming");
const inStoreCountFromFooter = extractBottomCounter("In Store");
    return {
    orders: orders.length,
    critical: critical.length,
    warning: warning.length,
    onWay: orders.filter(order => order.status === "ON_THE_WAY").length,
    collecting: orders.filter(order => order.status === "COLLECTING_ORDER").length,
    captains: captains.length,
    free: freeCaptains.length,

    roaming: Math.max(roamingCaptains.length, roamingCountFromFooter),
    inStore: Math.max(inStoreCaptains.length, inStoreCountFromFooter),

    offline: offlineCaptains.length,
    healthScore,
    healthStatus: getHealthStatus(healthScore)
};
    
}

function calculateHealthScore(criticalCount, warningCount, offlineCount) {
    let score = 100;

    score -= criticalCount * 8;
    score -= warningCount * 3;
    score -= offlineCount * 1;

    return Math.max(0, Math.min(100, score));
}

function getHealthStatus(score) {
    if (score >= 90) return "Healthy";
    if (score >= 75) return "Good";
    if (score >= 60) return "Warning";
    return "Critical";
}

function isCriticalOrder(order) {
    if (["RETURNING_TO_AREA", "DELIVERED", "CANCELED"].includes(order.status)) {
        return false;
    }

    return (
        order.elapsedMinutes !== null &&
        order.elapsedMinutes >= soaSettings.criticalMinutes
    );
}

function isWarningOrder(order) {
    if (["RETURNING_TO_AREA", "DELIVERED", "CANCELED"].includes(order.status)) {
        return false;
    }

    if (order.elapsedMinutes === null) {
        return false;
    }

    // تنبيه خاص: الطلب عند المتجر AT_PICK_UP وبقي دقيقتين أو أكثر
    if (
        order.status === "AT_PICK_UP" &&
        order.elapsedMinutes >= soaSettings.atPickUpWarningMinutes &&
        order.elapsedMinutes < soaSettings.criticalMinutes
    ) {
        return true;
    }

    // تنبيه خاص: الكابتن غير مسند NOT_ASSIGNED وبقي 10 دقائق أو أكثر
    if (
        order.status === "NOT_ASSIGNED" &&
        order.elapsedMinutes >= soaSettings.notAssignedWarningMinutes &&
        order.elapsedMinutes < soaSettings.criticalMinutes
    ) {
        return true;
    }

    // التنبيه العام
    return (
        order.elapsedMinutes >= soaSettings.warningMinutes &&
        order.elapsedMinutes < soaSettings.criticalMinutes
    );
}
function highlightOrders(orders) {
    orders.forEach(order => {
        if (!order.element) return;

        resetOrderStyle(order.element);

        if (isCriticalOrder(order)) {
            markCritical(order);
            return;
        }

        if (isWarningOrder(order)) {
            markWarning(order);
        }
    });
}

function resetOrderStyle(element) {
    const oldCriticalLabel = element.querySelector(".soa-critical-label");
    if (oldCriticalLabel) oldCriticalLabel.remove();

    const oldWarningLabel = element.querySelector(".soa-warning-label");
    if (oldWarningLabel) oldWarningLabel.remove();

    element.classList.remove("soa-critical-order", "soa-warning-order");

    element.style.borderLeft = "";
    element.style.outline = "";
    element.style.backgroundColor = "";
    element.style.boxShadow = "";

    stopBlink(element);
}

function markCritical(order) {
    const element = order.element;

    element.classList.add("soa-critical-order");

    element.style.borderLeft = "10px solid #ff0000";
    element.style.outline = "4px solid #ff0000";
    element.style.backgroundColor = "rgba(255, 0, 0, 0.28)";
    element.style.boxShadow = "0 0 25px rgba(255, 0, 0, 1)";

    const badge = document.createElement("div");
    badge.className = "soa-critical-label";
    badge.textContent = `🚨 CRITICAL ${order.elapsedMinutes ?? "-"} MIN`;

    element.prepend(badge);
    startBlink(element);
}

function markWarning(order) {
    const element = order.element;
    element.classList.add("soa-warning-order");

    const isAtPickUpWarning =
        order.status === "AT_PICK_UP" &&
        order.elapsedMinutes >= soaSettings.atPickUpWarningMinutes;

    const isNotAssignedWarning =
        order.status === "NOT_ASSIGNED" &&
        order.elapsedMinutes >= soaSettings.notAssignedWarningMinutes;

    element.style.borderLeft = "10px solid #f59e0b";
    element.style.outline = "3px solid #f59e0b";
    element.style.backgroundColor = "rgba(245, 158, 11, 0.22)";
    element.style.boxShadow = "0 0 18px rgba(245, 158, 11, 0.75)";

    const badge = document.createElement("div");
    badge.className = "soa-warning-label";

    if (isAtPickUpWarning) {
        badge.textContent = `⚠️ AT PICK UP ${order.elapsedMinutes ?? "-"} MIN`;
    } else if (isNotAssignedWarning) {
        badge.textContent = `⚠️ NOT ASSIGNED ${order.elapsedMinutes ?? "-"} MIN`;
    } else {
        badge.textContent = `⚠️ WARNING ${order.elapsedMinutes ?? "-"} MIN`;
    }

    element.prepend(badge);
}

function stopBlink(element) {
    if (element.soaBlinkInterval) {
        clearInterval(element.soaBlinkInterval);
    }

    element.dataset.soaBlinking = "false";
    element.dataset.soaBright = "false";
}

function handleCriticalAlerts(orders) {
    const criticalOrders = orders.filter(order => isCriticalOrder(order));

    criticalOrders.forEach(order => {
        if (!order.id) return;
        if (alertedOrders.has(order.id)) return;

        alertedOrders.add(order.id);
        playAlarm();
    });

    cleanupResolvedAlerts(orders);
}

function updateCriticalPanel(orders) {
    let panel = document.getElementById("soa-critical-panel");

    if (!panel) {
        panel = document.createElement("div");
        panel.id = "soa-critical-panel";
        applyCriticalPanelStyle(panel);
        document.body.appendChild(panel);
    }

    if (!soaSettings.criticalPanelEnabled) {
        panel.style.display = "none";
        return;
    }

    const criticalOrders = orders.filter(order => isCriticalOrder(order));

    if (criticalOrders.length === 0) {
        panel.style.display = "none";
        panel.innerHTML = "";
        return;
    }

    panel.style.display = "block";

    const topOrders = criticalOrders.slice(0, 5);

    panel.innerHTML = `
    <div class="soa-critical-panel-title">
        🚨 Critical Orders (${criticalOrders.length})
    </div>

    ${topOrders.map(order => `
        <div class="soa-critical-panel-card">
            <div><strong>Order:</strong> ${order.id}</div>
            <div><strong>Status:</strong> ${order.status}</div>
            <div><strong>Elapsed:</strong> ${order.elapsedMinutes ?? "-"} min</div>
            <div><strong>Distance:</strong> ${order.distance ?? "-"} KM</div>
            <div><strong>Captain:</strong> ${order.captain || "-"}</div>

            <div class="soa-critical-actions">
                <button class="soa-critical-focus-btn" data-order-id="${order.id}">
                    Focus
                </button>

                <button class="soa-critical-copy-btn" data-order-id="${order.id}">
                    Copy ID
                </button>
            </div>
        </div>
    `).join("")}
`;

setupCriticalPanelActions(panel);
setupDraggablePanels();
}

function applyCriticalPanelStyle(panel) {
    panel.style.position = "fixed";
    panel.style.top = "360px";
    panel.style.right = "225px";
    panel.style.left = "auto";
    panel.style.width = "270px";
    panel.style.maxHeight = "320px";
    panel.style.overflowY = "auto";
    panel.style.zIndex = "2147483646";
    panel.style.background = "rgba(127, 29, 29, 0.94)";
    panel.style.color = "#ffffff";
    panel.style.border = "2px solid #ff0000";
    panel.style.borderRadius = "12px";
    panel.style.padding = "12px";
    panel.style.fontFamily = "Arial, sans-serif";
    panel.style.fontSize = "12px";
    panel.style.boxShadow = "0 0 22px rgba(255, 0, 0, 0.75)";
}

function playAlarm() {
    if (isMuted) return;

    try {
        if (!audioUnlocked || !soaAudioEnabled) {
            console.log("SOA audio waiting for Enable Sound click");
            return;
        }

        playSOATone();
    } catch (error) {
        console.warn("SOA audio error:", error);
    }
}
function cleanupResolvedAlerts(orders) {
    const currentCriticalIds = new Set(
        orders
            .filter(order => isCriticalOrder(order))
            .map(order => order.id)
    );

    alertedOrders.forEach(id => {
        if (!currentCriticalIds.has(id)) {
            alertedOrders.delete(id);
        }
    });
}

function extractOrderId(text) {
    const match = text.match(/#orders-order-(\d+)/);
    return match ? match[1] : "";
}

function extractStatus(text) {
    const normalized = normalizeStatusText(text);

    const statuses = [
        "COLLECTING_ORDER",
        "ON_THE_WAY",
        "NEAR_PICK_UP",
        "AT_PICK_UP",
        "NEAR_DELIVERY",
        "AT_DELIVERY",
        "RETURNING_TO_AREA",
        "NOT_ASSIGNED",
        "DELIVERED",
        "CANCELED"
    ];

    return statuses.find(status => normalized.includes(status)) || "UNKNOWN";
}

function normalizeStatusText(text) {
    return String(text || "")
        .toUpperCase()
        .replace(/\s+/g, "_");
}

function extractDistance(text) {
    const match = text.match(/(\d+(\.\d+)?)\s*KM/i);
    return match ? Number(match[1]) : null;
}

function extractCaptainId(text) {
    const lines = text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        if (/^\d{4,6}$/.test(line)) {
            return line;
        }
    }

    return "";
}

function extractCreatedAt(text) {
    const match = text.match(
        /[A-Z][a-z]{2}\s\d{2},\s\d{4},\s\d{1,2}:\d{2}:\d{2}\s(?:AM|PM)/
    );

    return match ? match[0] : "";
}

function extractCaptainWorkStatus(text) {
    const upper = text.toUpperCase();

    if (upper.includes("BUSY")) return "BUSY";
    if (upper.includes("IN_AREA")) return "IN_AREA";
    if (upper.includes("RETURNING")) return "RETURNING";
    if (upper.includes("ROAMING")) return "ROAMING";
    if (upper.includes("ON_BREAK")) return "ON_BREAK";

    return "UNKNOWN";
}

function extractCaptainConnection(text) {
    const upper = text.toUpperCase();

    if (upper.includes("OFFLINE")) return "OFFLINE";
    if (upper.includes("CONNECTED")) return "CONNECTED";

    return "UNKNOWN";
}

function minutesSince(dateText) {
    const date = new Date(dateText);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const diff = Date.now() - date.getTime();

    if (diff < 0) {
        return 0;
    }

    return Math.floor(diff / 60000);
}

function updateDashboard(stats) {
    setText("soa-roaming", stats.roaming);
    setText("soa-in-store", stats.inStore);
    setText("soa-orders", stats.orders);
    setText("soa-critical", stats.critical);
    setText("soa-warning", stats.warning);
    setText("soa-on-way", stats.onWay);
    setText("soa-collecting", stats.collecting);
    setText("soa-captains", stats.captains);
    setText("soa-free", stats.free);
    setText("soa-offline", stats.offline);
    setText("soa-status", "Running");

    updateHealthUI(stats.healthScore, stats.healthStatus);
}


function applyTopBarStyle(widget) {
    widget.style.position = "fixed";
    widget.style.top = "52px";
    widget.style.right = "520px";
    widget.style.left = "auto";
    widget.style.display = "inline-flex";
    widget.style.alignItems = "center";
    widget.style.gap = "12px";
    widget.style.height = "34px";
    widget.style.padding = "0 14px";
    widget.style.borderRadius = "8px";
    widget.style.border = "2px solid #2dce89";
    widget.style.background = "rgba(17, 24, 39, 0.97)";
    widget.style.color = "#ffffff";
    widget.style.fontFamily = "Arial, sans-serif";
    widget.style.fontSize = "13px";
    widget.style.fontWeight = "800";
    widget.style.zIndex = "2147483647";
    widget.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.45)";
}

function updateHealthUI(score, status) {
    const scoreElement = document.getElementById("soa-health-score");
    const statusElement = document.getElementById("soa-health-status");

    if (!scoreElement || !statusElement) {
        return;
    }

    scoreElement.textContent = `${score}%`;
    statusElement.textContent = status;
    scoreElement.style.color = getHealthColor(score);

    scoreElement.classList.remove(
        "soa-health-healthy",
        "soa-health-good",
        "soa-health-warning",
        "soa-health-critical"
    );

    if (score >= 90) {
        scoreElement.classList.add("soa-health-healthy");
    } else if (score >= 75) {
        scoreElement.classList.add("soa-health-good");
    } else if (score >= 60) {
        scoreElement.classList.add("soa-health-warning");
    } else {
        scoreElement.classList.add("soa-health-critical");
    }
}

function getHealthColor(score) {
    if (score >= 90) return "#2dce89";
    if (score >= 75) return "#22c55e";
    if (score >= 60) return "#f59e0b";
    return "#ff4d4d";
}

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function makeDraggable(elementId, handleSelector) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const handle = handleSelector
        ? element.querySelector(handleSelector)
        : element;

    if (!handle) return;

    if (element.dataset.soaDraggableReady === "true") return;
    element.dataset.soaDraggableReady = "true";

    handle.style.cursor = "move";

    const storageKey = `soa-position-${elementId}`;
    const savedPosition = localStorage.getItem(storageKey);

    if (savedPosition) {
        try {
            const position = JSON.parse(savedPosition);

            if (
                typeof position.left === "number" &&
                typeof position.top === "number"
            ) {
                element.style.left = `${position.left}px`;
                element.style.top = `${position.top}px`;
                element.style.right = "auto";
                element.style.bottom = "auto";
            }
        } catch (error) {
            console.warn("SOA saved position invalid:", error);
        }
    }

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener("mousedown", event => {
        if (event.target.tagName === "BUTTON") return;

        isDragging = true;

        const rect = element.getBoundingClientRect();

        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        element.style.left = `${startLeft}px`;
        element.style.top = `${startTop}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";

        document.body.style.userSelect = "none";

        event.preventDefault();
    });

    document.addEventListener("mousemove", event => {
        if (!isDragging) return;

        const newLeft = startLeft + (event.clientX - startX);
        const newTop = startTop + (event.clientY - startY);

        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
    });

    document.addEventListener("mouseup", () => {
        if (!isDragging) return;

        isDragging = false;
        document.body.style.userSelect = "";

        const rect = element.getBoundingClientRect();

        localStorage.setItem(
            storageKey,
            JSON.stringify({
                left: Math.round(rect.left),
                top: Math.round(rect.top)
            })
        );
    });
}
function setupDraggablePanels() {
    makeDraggable("soa-dashboard", ".soa-dashboard-header");
    makeDraggable("soa-critical-panel", ".soa-critical-panel-title");
}

function uniqueById(items) {
    const map = new Map();

    items.forEach(item => {
        if (item.id) {
            map.set(item.id, item);
        }
    });

    return Array.from(map.values());
}

function clean(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}
function setupTopBarActions() {
    const criticalItem = document.querySelector("#soa-topbar-widget .critical");

    if (!criticalItem) return;
    if (criticalItem.dataset.soaClickReady === "true") return;

    criticalItem.dataset.soaClickReady = "true";
    criticalItem.style.cursor = "pointer";
    criticalItem.title = "Click to focus first critical order";

    criticalItem.addEventListener("click", () => {
        focusFirstCriticalOrder();
    });
}

function focusFirstCriticalOrder() {
    const criticalOrder = latestOrders.find(order => isCriticalOrder(order));

    if (!criticalOrder || !criticalOrder.element) {
        console.log("SOA: No critical order to focus");
        return;
    }

    criticalOrder.element.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

    flashFocusedOrder(criticalOrder.element);
}

function flashFocusedOrder(element) {
    const oldOutline = element.style.outline;
    const oldBoxShadow = element.style.boxShadow;

    element.style.outline = "5px solid #ffffff";
    element.style.boxShadow = "0 0 35px rgba(255, 255, 255, 1)";

    setTimeout(() => {
        element.style.outline = oldOutline;
        element.style.boxShadow = oldBoxShadow;
    }, 1200);
}
function focusFirstCriticalOrder() {
    const criticalOrders = latestOrders.filter(order => isCriticalOrder(order));

    if (criticalOrders.length === 0) {
        showSOATemporaryMessage("No critical orders now");
        return;
    }

    const order = criticalOrders[0];

    if (!order.element) {
        showSOATemporaryMessage("Critical order element not found");
        return;
    }

    order.element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
    });

    flashFocusedOrder(order.element);
    showSOATemporaryMessage(`Focused Critical Order ${order.id}`);
}

function flashFocusedOrder(element) {
    const oldOutline = element.style.outline;
    const oldBoxShadow = element.style.boxShadow;
    const oldTransform = element.style.transform;

    element.style.outline = "6px solid #ffffff";
    element.style.boxShadow = "0 0 40px rgba(255, 255, 255, 1)";
    element.style.transform = "scale(1.02)";

    setTimeout(() => {
        element.style.outline = oldOutline;
        element.style.boxShadow = oldBoxShadow;
        element.style.transform = oldTransform;
    }, 1500);
}

function showSOATemporaryMessage(message) {
    let toast = document.getElementById("soa-toast-message");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "soa-toast-message";

        toast.style.position = "fixed";
        toast.style.top = "95px";
        toast.style.right = "520px";
        toast.style.zIndex = "2147483647";
        toast.style.background = "rgba(17, 24, 39, 0.96)";
        toast.style.color = "#ffffff";
        toast.style.border = "2px solid #2dce89";
        toast.style.borderRadius = "8px";
        toast.style.padding = "10px 14px";
        toast.style.fontFamily = "Arial, sans-serif";
        toast.style.fontSize = "13px";
        toast.style.fontWeight = "800";
        toast.style.boxShadow = "0 8px 20px rgba(0,0,0,.45)";

        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.display = "block";

    setTimeout(() => {
        toast.style.display = "none";
    }, 1800);
}
function setupCriticalPanelActions(panel) {
    if (!panel) return;

    if (panel.dataset.soaActionsReady === "true") return;
    panel.dataset.soaActionsReady = "true";

    panel.addEventListener("click", event => {
        const focusButton = event.target.closest(".soa-critical-focus-btn");
        const copyButton = event.target.closest(".soa-critical-copy-btn");

        if (focusButton) {
            focusOrderById(focusButton.dataset.orderId);
            return;
        }

        if (copyButton) {
            copyOrderId(copyButton.dataset.orderId);
        }
    });
}

function focusOrderById(orderId) {
    const orders = getOrders();
    const order = orders.find(item => item.id === orderId);

    if (!order || !order.element) {
        showSOATemporaryMessage("Order not found");
        return;
    }

    order.element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
    });

    flashFocusedOrder(order.element);
    showSOATemporaryMessage(`Focused Order ${orderId}`);
}

function copyOrderId(orderId) {
    if (!orderId) return;

    navigator.clipboard.writeText(orderId)
        .then(() => {
            showSOATemporaryMessage(`Copied Order ${orderId}`);
        })
        .catch(() => {
            showSOATemporaryMessage("Copy failed");
        });
}

function setupCriticalPanelActions(panel) {
    if (!panel) return;

    if (panel.dataset.soaActionsReady === "true") return;
    panel.dataset.soaActionsReady = "true";

    panel.addEventListener("click", event => {
        const focusButton = event.target.closest(".soa-critical-focus-btn");
        const copyButton = event.target.closest(".soa-critical-copy-btn");

        if (focusButton) {
            focusOrderById(focusButton.dataset.orderId);
            return;
        }

        if (copyButton) {
            copyOrderId(copyButton.dataset.orderId);
        }
    });
}

function focusOrderById(orderId) {
    const orders = getOrders();
    const order = orders.find(item => item.id === orderId);

    if (!order || !order.element) {
        showSOATemporaryMessage("Order not found");
        return;
    }

    order.element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
    });

    flashFocusedOrder(order.element);
    showSOATemporaryMessage(`Focused Order ${orderId}`);
}

function copyOrderId(orderId) {
    if (!orderId) return;

    navigator.clipboard.writeText(orderId)
        .then(() => {
            showSOATemporaryMessage(`Copied Order ${orderId}`);
        })
        .catch(() => {
            showSOATemporaryMessage("Copy failed");
        });
}

function flashFocusedOrder(element) {
    const oldOutline = element.style.outline;
    const oldBoxShadow = element.style.boxShadow;
    const oldTransform = element.style.transform;

    element.style.outline = "6px solid #ffffff";
    element.style.boxShadow = "0 0 40px rgba(255, 255, 255, 1)";
    element.style.transform = "scale(1.02)";

    setTimeout(() => {
        element.style.outline = oldOutline;
        element.style.boxShadow = oldBoxShadow;
        element.style.transform = oldTransform;
    }, 1500);
}

function showSOATemporaryMessage(message) {
    let toast = document.getElementById("soa-toast-message");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "soa-toast-message";

        toast.style.position = "fixed";
        toast.style.top = "95px";
        toast.style.right = "520px";
        toast.style.zIndex = "2147483647";
        toast.style.background = "rgba(17, 24, 39, 0.96)";
        toast.style.color = "#ffffff";
        toast.style.border = "2px solid #2dce89";
        toast.style.borderRadius = "8px";
        toast.style.padding = "10px 14px";
        toast.style.fontFamily = "Arial, sans-serif";
        toast.style.fontSize = "13px";
        toast.style.fontWeight = "800";
        toast.style.boxShadow = "0 8px 20px rgba(0,0,0,.45)";

        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.display = "block";

    setTimeout(() => {
        toast.style.display = "none";
    }, 1800);
}
function saveTrackingSnapshot(stats, orders) {
    try {
        if (
            typeof chrome === "undefined" ||
            !chrome.storage ||
            !chrome.storage.local ||
            !chrome.runtime ||
            !chrome.runtime.id
        ) {
            return;
        }

        const branchId = getBranchIdFromTrackingUrl();
        const branchName = getBranchDisplayName(branchId);

        const snapshot = {
            branchId,
            branchName,
            url: window.location.href,
            updatedAt: Date.now(),

            orders: stats.orders,
            critical: stats.critical,
            warning: stats.warning,
            onWay: stats.onWay,
            collecting: stats.collecting,
            captains: stats.captains,
            free: stats.free,
            offline: stats.offline,
            healthScore: stats.healthScore,
            healthStatus: stats.healthStatus,

            criticalOrders: orders
                .filter(order => isCriticalOrder(order))
                .slice(0, 10)
                .map(order => ({
                    id: order.id,
                    status: order.status,
                    elapsedMinutes: order.elapsedMinutes,
                    distance: order.distance,
                    captain: order.captain
                }))
        };

        chrome.storage.local.get({ soaTrackingSnapshots: {} }, result => {
            const snapshots = result.soaTrackingSnapshots || {};
            snapshots[branchId] = snapshot;

            chrome.storage.local.set({
                soaTrackingSnapshots: snapshots
            });
        });
    } catch (error) {
        console.warn("SOA snapshot save skipped:", error.message);
    }
}

function getBranchIdFromTrackingUrl() {
    const match = window.location.href.match(/platform_branches\/(\d+)\/tracking/i);
    return match ? match[1] : `tracking-${location.pathname}`;
}

function getBranchDisplayName(branchId) {
    const text = document.body.innerText || "";

    const branchCodeMatch = text.match(/\b[A-Z]{2,5}-[A-Z]{2,5}\d{2,5}\b/);

    if (branchCodeMatch) {
        return branchCodeMatch[0];
    }

    return `Branch ${branchId}`;
}
function startBlink(element) {
    if (!element) return;

    if (element.dataset.soaBlinking === "true") {
        return;
    }

    element.dataset.soaBlinking = "true";

    element.soaBlinkInterval = setInterval(() => {
        if (!document.body.contains(element)) {
            clearInterval(element.soaBlinkInterval);
            element.dataset.soaBlinking = "false";
            return;
        }

        const isBright = element.dataset.soaBright === "true";

        if (isBright) {
            element.style.backgroundColor = "rgba(255, 0, 0, 0.18)";
            element.style.boxShadow = "0 0 12px rgba(255, 0, 0, 0.65)";
            element.dataset.soaBright = "false";
        } else {
            element.style.backgroundColor = "rgba(255, 0, 0, 0.42)";
            element.style.boxShadow = "0 0 32px rgba(255, 0, 0, 1)";
            element.dataset.soaBright = "true";
        }
    }, 700);
}

function stopBlink(element) {
    if (!element) return;

    if (element.soaBlinkInterval) {
        clearInterval(element.soaBlinkInterval);
        element.soaBlinkInterval = null;
    }

    element.dataset.soaBlinking = "false";
    element.dataset.soaBright = "false";
}
function setupTestSoundButton() {
    const testButton = document.getElementById("soa-test-sound-btn");

    if (!testButton) return;
    if (testButton.dataset.soaReady === "true") return;

    testButton.dataset.soaReady = "true";

    testButton.addEventListener("click", async () => {
        try {
            audioUnlocked = true;
            isMuted = false;
            soaSettings.soundEnabled = true;
            soaAudioEnabled = true;

            updateSoundButton();

            if (!soaAudioContext) {
                soaAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            if (soaAudioContext.state === "suspended") {
                await soaAudioContext.resume();
            }

            playSOATone();

            showSOATemporaryMessage?.("Sound enabled");
            console.log("SOA sound enabled");
        } catch (error) {
            console.warn("SOA test sound error:", error);
            showSOATemporaryMessage?.("Sound could not be enabled");
        }
    });
}
function playSOATone() {
    if (!soaAudioContext) {
        soaAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const now = soaAudioContext.currentTime;

    playTone(880, now, 0.18);
    playTone(660, now + 0.22, 0.18);
    playTone(880, now + 0.44, 0.22);
}

function playTone(frequency, startTime, duration) {
    const oscillator = soaAudioContext.createOscillator();
    const gain = soaAudioContext.createGain();

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gain);
    gain.connect(soaAudioContext.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.03);
}
function setupSOAApiInterceptor() {
    if (!isSamuraiPortalPage()) {
        return;
    }

    if (window.__SOA_API_INTERCEPTOR_READY === true) {
        return;
    }

    window.__SOA_API_INTERCEPTOR_READY = true;

    window.addEventListener("message", event => {
        if (event.source !== window) return;

        const payload = event.data;

        if (!payload || payload.source !== "OPS_SENTINEL_API") {
            return;
        }

        handleSOAApiCapture(payload.url, payload.data);
    });

    try {
        const script = document.createElement("script");

        const interceptorUrl = chrome.runtime.getURL("interceptor.js");
        console.log("SOA interceptor URL:", interceptorUrl);

        script.src = interceptorUrl;

        script.onload = () => {
            script.remove();
            console.log("SOA interceptor injected");
        };

        script.onerror = error => {
            console.warn("SOA interceptor failed to load:", error);
        };

        (document.head || document.documentElement).appendChild(script);
    } catch (error) {
        console.warn("SOA interceptor injection skipped:", error);
    }
}
function isSamuraiPortalPage() {
    return (
        window.location.hostname.includes("portal.samurai.delivery") ||
        window.location.hostname.includes("portal.ananinja.com")
    );
}

function handleSOAApiCapture(url, data) {
    console.log("SOA API captured:", url, data);
        if (
        String(url || "").includes("/admin/platform_branches/") &&
        String(url || "").includes("/tracking")
    ) {
        window.__SOA_LAST_TRACKING_API__ = data;
        console.log("SOA latest tracking API updated");
    }

    try {
        if (
            typeof chrome === "undefined" ||
            !chrome.storage ||
            !chrome.storage.local
        ) {
            return;
        }

        const capture = {
            url: String(url || ""),
            capturedAt: Date.now(),
            data
        };

        chrome.storage.local.get({ soaApiCaptures: [] }, result => {
            const captures = Array.isArray(result.soaApiCaptures)
                ? result.soaApiCaptures
                : [];

            captures.unshift(capture);

            chrome.storage.local.set({
                soaApiCaptures: captures.slice(0, 30)
            });
        });
    } catch (error) {
        console.warn("SOA API capture save skipped:", error);
    }
}
function createDashboardToggleButton() {
    let toggleButton = document.getElementById("soa-dashboard-toggle-btn");

    if (!toggleButton) {
        toggleButton = document.createElement("button");
        toggleButton.id = "soa-dashboard-toggle-btn";
        toggleButton.textContent = "SOA";

        document.body.appendChild(toggleButton);
    }

    if (toggleButton.dataset.ready === "true") return;

    toggleButton.dataset.ready = "true";

    toggleButton.addEventListener("click", () => {
        const dashboard = document.getElementById("soa-dashboard");

        if (!dashboard) {
            createDashboard();
            return;
        }

        const isHidden = dashboard.style.display === "none";

        if (isHidden) {
            dashboard.style.display = "block";
            toggleButton.textContent = "SOA";
            toggleButton.classList.remove("collapsed");
        } else {
            dashboard.style.display = "none";
            toggleButton.textContent = "SOA";
            toggleButton.classList.add("collapsed");
        }
    });
}
function createDashboardToggleButton() {
    let toggleButton = document.getElementById("soa-dashboard-toggle-btn");

    if (!toggleButton) {
        toggleButton = document.createElement("button");
        toggleButton.id = "soa-dashboard-toggle-btn";
        toggleButton.type = "button";
        toggleButton.textContent = "SOA";
        document.body.appendChild(toggleButton);
    }

    toggleButton.onclick = () => {
        const dashboard = document.getElementById("soa-dashboard");

        if (!dashboard) {
            createDashboard();
            return;
        }

        const isHidden = dashboard.classList.contains("soa-dashboard-hidden");

        if (isHidden) {
            dashboard.classList.remove("soa-dashboard-hidden");
            toggleButton.classList.remove("collapsed");
        } else {
            dashboard.classList.add("soa-dashboard-hidden");
            toggleButton.classList.add("collapsed");
        }
    };
}

function removeDashboardToggleButton() {
    const toggleButton = document.getElementById("soa-dashboard-toggle-btn");
    if (toggleButton) {
        toggleButton.remove();
    }
}
function handleRoamingAlert(stats) {
    if (!stats) return;

    const roamingCount = Number(stats.roaming || 0);
    const limit = Number(soaSettings.roamingAlertCount || 8);

    if (roamingCount < limit) {
        return;
    }

    const nowTime = Date.now();
    const cooldownMs = 2 * 60 * 1000;

    if (nowTime - lastRoamingAlertAt < cooldownMs) {
        return;
    }

    lastRoamingAlertAt = nowTime;

    showSOATemporaryMessage?.(`⚠️ Roaming Captains reached ${roamingCount}`);
    playAlarm?.();

    console.warn("SOA ROAMING ALERT:", {
        roamingCount,
        limit
    });
}
function extractBottomCounter(label) {
    const text = document.body.innerText || "";
    const regex = new RegExp(label + "\\s*:?\\s*(\\d+)", "i");
    const match = text.match(regex);

    return match ? Number(match[1]) : 0;
}


function handleRoamingAlert(stats) {
    if (!stats) return;

    const roamingCount = Number(stats.roaming || 0);
    const limit = Number(soaSettings.roamingAlertCount || 8);

    if (roamingCount < limit) {
        return;
    }

    const nowTime = Date.now();
    const cooldownMs = 2 * 60 * 1000;

    if (nowTime - lastRoamingAlertAt < cooldownMs) {
        return;
    }

    lastRoamingAlertAt = nowTime;

    if (typeof showSOATemporaryMessage === "function") {
        showSOATemporaryMessage(`⚠️ Roaming Captains reached ${roamingCount}`);
    }

    if (typeof playAlarm === "function") {
        playAlarm();
    }

    console.warn("SOA ROAMING ALERT:", {
        roamingCount,
        limit
    });
}