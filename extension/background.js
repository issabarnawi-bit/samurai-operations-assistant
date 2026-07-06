chrome.runtime.onInstalled.addListener(() => {
    console.log("✅ Samurai Operations Assistant Installed");
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SOA_NOTIFICATION") {
        chrome.notifications.create({
            type: "basic",
            title: message.title || "Samurai Operations Assistant",
            message: message.message || "Critical order detected",
            priority: 2
        });
    }
});