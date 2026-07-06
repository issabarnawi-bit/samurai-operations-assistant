const DEFAULT_SETTINGS = {
    warningMinutes: 25,
    criticalMinutes: 30,
    soundEnabled: true,
    criticalPanelEnabled: true
};

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    const openOverviewBtn = document.getElementById("openOverviewBtn");

if (openOverviewBtn) {
    openOverviewBtn.addEventListener("click", () => {
        chrome.tabs.create({
            url: chrome.runtime.getURL("overview/overview.html")
        });
    });
}
    const saveBtn = document.getElementById("saveBtn");

    saveBtn.addEventListener("click", () => {
        saveSettings();
    });
});

function loadSettings() {
    chrome.storage.local.get(DEFAULT_SETTINGS, settings => {
        document.getElementById("warningMinutes").value = settings.warningMinutes;
        document.getElementById("criticalMinutes").value = settings.criticalMinutes;
        document.getElementById("soundEnabled").checked = settings.soundEnabled;
        document.getElementById("criticalPanelEnabled").checked = settings.criticalPanelEnabled;
    });
}

function saveSettings() {
    const warningMinutes = Number(document.getElementById("warningMinutes").value);
    const criticalMinutes = Number(document.getElementById("criticalMinutes").value);
    const soundEnabled = document.getElementById("soundEnabled").checked;
    const criticalPanelEnabled = document.getElementById("criticalPanelEnabled").checked;

    if (!warningMinutes || !criticalMinutes) {
        showMessage("Please enter valid numbers", true);
        return;
    }

    if (warningMinutes >= criticalMinutes) {
        showMessage("Warning must be less than Critical", true);
        return;
    }

    const settings = {
        warningMinutes,
        criticalMinutes,
        soundEnabled,
        criticalPanelEnabled
    };

    chrome.storage.local.set(settings, () => {
        showMessage("Settings saved");

        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (!tabs[0]?.id) return;

            chrome.tabs.sendMessage(tabs[0].id, {
                type: "SOA_SETTINGS_UPDATED",
                settings
            });
        });
    });
}

function showMessage(message, isError = false) {
    const status = document.getElementById("statusMessage");

    status.textContent = message;
    status.style.color = isError ? "#f87171" : "#2dce89";

    setTimeout(() => {
        status.textContent = "";
    }, 2500);
}