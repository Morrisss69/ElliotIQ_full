(function () {
    const hostname = window.location.hostname;

    let apiBaseUrl;

    // Same PC local test
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        apiBaseUrl = "http://127.0.0.1:8080";
    }

    // Other devices on same WiFi/LAN
    else if (
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("172.")
    ) {
        apiBaseUrl = `http://${hostname}:8080`;
    }

    // Public/Netlify later
    else {
        apiBaseUrl = "https://YOUR-ORACLE-API-DOMAIN.com";
    }

    window.APP_CONFIG = {
        API_BASE_URL: apiBaseUrl,
        DEFAULT_MARKET: "crypto",
        DEFAULT_SYMBOL: "BTCUSDT",
        DEFAULT_TIMEFRAME: "15m"
    };
})();