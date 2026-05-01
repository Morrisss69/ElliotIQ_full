

// --- GLOBAL VARIABLES ---
let chart, candleSeries;
let binanceSocket = null;
let forexSocket = null;
let lastSubscribedSymbol = null;
let lastCandle = null;

let currentSymbol = APP_CONFIG.DEFAULT_SYMBOL || 'BTCUSDT';
let currentInterval = APP_CONFIG.DEFAULT_TIMEFRAME || '15m';
let currentMarket = APP_CONFIG.DEFAULT_MARKET || 'crypto';

// Testing mode: no login/payment yet
let isPaidUser = true;

let tradeLines = [];
let currentAnalysisData = null;
let waitWarningShownForCurrentAnalysis = false; // Show "Market Unclear" popup only once per analysis run

// ==================================================
// --- LOCAL ALERT SYSTEM ---
// ==================================================
let alertState = {
    symbol: null,
    entryHit: false,
    tp1Hit: false,
    tp2Hit: false,
    slHit: false
};

// UI References
function getElements() {
    return {
        views: {
            dashboard: document.getElementById('view-dashboard'),
            scanner: document.getElementById('view-scanner'),
            settings: document.getElementById('view-settings')
        },
        controls: {
            chartContainer: document.getElementById('chart-inner'),
            aiLogs: document.getElementById('ai-logs'),
            aiLogsContent: document.getElementById('ai-logs-content'),
            statsPanel: document.getElementById('ai-stats-panel'),
            scannerGrid: document.getElementById('scanner-grid')
        },
        buttons: {
            analyze: document.getElementById('analyze-btn'),
            scan: document.getElementById('start-scan-btn'),
        },
        inputs: {
            market: document.getElementById('market-selector'),
            coin: document.getElementById('coin-input'),
            tf: document.getElementById('timeframe-select'),
            scanMode: document.getElementById('scan-mode')
        },
        startup: {
            overlay: document.getElementById('startup-overlay'),
            card: document.getElementById('startup-card'),
            btnLaunch: document.getElementById('btn-launch-terminal'),
            inputMarket: document.getElementById('startup-market'),
            inputCoin: document.getElementById('startup-coin'),
            inputTf: document.getElementById('startup-tf')
        }
    };
}

document.addEventListener('DOMContentLoaded', () => {
    isPaidUser = true;
    console.log("AI Signal Dashboard loaded");

    loadUserPreferences();

    const els = getElements();

    if (els.inputs.market) els.inputs.market.value = currentMarket;
    if (els.inputs.coin) els.inputs.coin.value = currentSymbol;
    if (els.inputs.tf) els.inputs.tf.value = currentInterval;

    initChart();
    loadChartData(currentSymbol, currentInterval);
    trigger3DAnimations();
});

function applyMarketConstraints(market) {
    const btn15m = document.querySelector('.tf-btn[data-tf="15m"]');
    const option15m = document.querySelector('#timeframe-select option[value="15m"]');

    // Always show 15m option now since VPS supports it
    if (btn15m) btn15m.style.display = '';
    if (option15m) {
        option15m.style.display = '';
        option15m.disabled = false;
    }
}

function trigger3DAnimations() {
    const els = getElements();
    const chartWrapper = document.getElementById('chart-container');
    if (chartWrapper) {
        chartWrapper.classList.remove('chart-init-hidden');
        chartWrapper.classList.add('animate-fly-in');
    }
    if (els.controls.aiLogs) {
        els.controls.aiLogs.classList.add('ai-logs-reveal');
    }
}

window.switchTab = (tabName, el) => {
    const els = getElements();
    Object.values(els.views).forEach(v => { if (v) v.classList.remove('active') });
    document.querySelectorAll('.nav-icon').forEach(n => n.classList.remove('active'));

    const targetView = document.getElementById(`view-${tabName}`);
    if (targetView) targetView.classList.add('active');

    if (el) el.classList.add('active');

    if (tabName === 'dashboard' && chart) {
        setTimeout(() => chart.timeScale().fitContent(), 100);
    }
};

const marketSelector = document.getElementById('market-selector');
if (marketSelector) {
    marketSelector.addEventListener('change', (e) => {
        currentMarket = e.target.value;
        const els = getElements();

        applyMarketConstraints(currentMarket);

        if (currentMarket === 'forex') {
            alert("Forex mode is not enabled yet.");
            currentMarket = "crypto";

            if (els.inputs.market) els.inputs.market.value = "crypto";
            if (els.inputs.coin) {
                els.inputs.coin.value = "BTCUSDT";
                els.inputs.coin.placeholder = "Ex: BTCUSDT";
            }

            currentSymbol = "BTCUSDT";
            return loadChartData(currentSymbol, currentInterval);
        }

        if (currentMarket === 'forex') {
            els.inputs.coin.value = 'BTCUSDT';
            els.inputs.coin.placeholder = 'Ex: BTCUSDT';
        }

        currentSymbol = els.inputs.coin.value;
        loadChartData(currentSymbol, currentInterval);
    });
}

// 🔥 TIMEFRAME DROPDOWN LISTENER
const tfSelect = document.getElementById('timeframe-select');
if (tfSelect) {
    tfSelect.addEventListener('change', (e) => {
        const selectedTf = e.target.value;
        currentInterval = selectedTf;

        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-tf') === selectedTf) {
                btn.classList.add('active');
            }
        });

        loadChartData(currentSymbol, currentInterval);
    });
}

async function handleStatusUpdate() {
    const els = getElements();
    const symbol = currentSymbol;
    const analysisTf = currentInterval;

    if (!symbol) return alert("Please enter a coin symbol!");
    if (!isPaidUser) return alert("Pro Feature Required");

    const btnStatus = document.getElementById('embedded-status-btn');
    if (btnStatus) {
        btnStatus.disabled = true;
        const icon = btnStatus.querySelector('svg');
        if (icon) icon.classList.add('status-loading');
    }

    try {
        let statusData = await runStatusWeb(symbol, analysisTf, currentMarket);

        if (currentAnalysisData && currentAnalysisData.ai_prediction) {
            const newStatus = statusData.ai_prediction?.trade_status_message;
            const newAdvice = statusData.ai_prediction?.action_advice;

            if (newStatus) currentAnalysisData.ai_prediction.trade_status_message = newStatus;

            if (newAdvice) {
                currentAnalysisData.ai_prediction.action_advice = newAdvice;

                if (
                    currentAnalysisData.ai_prediction.trade_scenarios &&
                    currentAnalysisData.ai_prediction.trade_scenarios.length > 0
                ) {
                    currentAnalysisData.ai_prediction.trade_scenarios[0].generated_advice = newAdvice;
                }
            }

            localStorage.setItem(
                `analysis_${currentMarket}_${currentSymbol}_${currentInterval}`,
                JSON.stringify(currentAnalysisData)
            );

            updateDashboard(currentAnalysisData);
        } else {
            updateDashboard(statusData);
        }

    } catch (error) {
        console.error(error);
        alert("Status Check Failed");
    } finally {
        if (btnStatus) {
            btnStatus.disabled = false;
            const icon = btnStatus.querySelector('svg');
            if (icon) icon.classList.remove('status-loading');
        }
    }
}

// ==========================================================
// --- 🚨 NEW: BINANCE FUTURES COIN VALIDATION 🚨 ---
// ==========================================================


async function callBackend(action, payload = {}) {
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/analyze`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            symbol: payload.symbol || currentSymbol,
            interval: payload.interval || currentInterval,
            action: action || "analyze",
            market_type: payload.market || currentMarket || "crypto"
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Backend request failed: ${response.status} ${text}`);
    }

    return await response.json();
}

async function runAnalysisWeb(symbol, interval, market = "crypto") {
    return await callBackend("analyze", {
        symbol,
        interval,
        market
    });
}

async function runStatusWeb(symbol, interval, market = "crypto") {
    return await callBackend("status", {
        symbol,
        interval,
        market
    });
}

async function runScanWeb(mode, market = "crypto") {
    return await callBackend("scan", {
        symbol: mode,
        interval: "15m",
        market
    });
}



async function checkBinanceFuturesSymbol(symbol) {
    try {
        // Checking the symbol directly from Binance Futures API
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
        const data = await res.json();

        // If Binance returns an error code (like -1121: Invalid symbol), return false
        if (data.msg === "Invalid symbol." || data.code === -1121) {
            return false;
        }
        return true;
    } catch (error) {
        console.error("Error verifying symbol:", error);
        // If there's a network error, return true to avoid blocking valid requests
        return true;
    }
}

function showInvalidCoinPopup(symbol) {
    if (document.getElementById('invalid-coin-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'invalid-coin-overlay';

    overlay.innerHTML = `
        <div class="wait-modal" style="border: 1px solid rgba(239, 68, 68, 0.3);">
            <div class="icon-pulse" style="color: #EF4444; font-size: 48px; margin-bottom: 20px;">❌</div>
            <h2 style="color: #EF4444; font-size: 20px; margin-bottom: 12px; font-family: 'Inter', sans-serif; text-transform: uppercase;">Invalid Symbol</h2>
            <p style="color: #94A3B8; font-size: 14px; line-height: 1.6; margin-bottom: 30px;">
                <strong>${symbol}</strong> could not be found in the Binance Futures market.<br><br>
                Please check the spelling or ensure the coin is available for Futures trading (Spot-only coins are not supported).
            </p>
            <button id="btn-ack-invalid" style="background: rgba(239, 68, 68, 0.1); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: 'Inter', sans-serif;">Check Again</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.id = 'invalid-coin-style';
    style.innerHTML = `
        @keyframes invalidCoinFadeIn { to { opacity: 1; } }
        #invalid-coin-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(5, 7, 10, 0.85); backdrop-filter: blur(8px);
            z-index: 99999; display: flex; align-items: center; justify-content: center;
            opacity: 0; animation: invalidCoinFadeIn 0.3s forwards;
            cursor: default;
        }
        #invalid-coin-overlay .wait-modal {
            background: linear-gradient(135deg, rgba(30, 37, 54, 0.95), rgba(20, 25, 35, 0.98));
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            padding: 40px; border-radius: 16px; text-align: center;
            max-width: 420px; cursor: default; pointer-events: auto;
            transform: scale(0.9); animation: invalidCoinPopIn 0.3s forwards;
        }
        @keyframes invalidCoinPopIn { to { transform: scale(1); } }
        #btn-ack-invalid { cursor: pointer; pointer-events: auto; }
        #btn-ack-invalid:hover { background: #EF4444 !important; color: #000 !important; }
    `;
    document.head.appendChild(style);

    const escHandler = (e) => {
        if (e.key === 'Escape') closeInvalidOverlay();
    };

    function closeInvalidOverlay() {
        document.removeEventListener('keydown', escHandler);
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        setTimeout(() => {
            overlay.remove();
            style.remove();
        }, 300);
    }

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeInvalidOverlay();
    });
    document.addEventListener('keydown', escHandler);

    document.getElementById('btn-ack-invalid').addEventListener('click', (e) => {
        e.stopPropagation();
        closeInvalidOverlay();
    });
}

// ==========================================================

const btnAnalyze = document.getElementById('analyze-btn');
if (btnAnalyze) {
    btnAnalyze.addEventListener('click', async () => {
        const els = getElements();
        const symbol = els.inputs.coin.value.toUpperCase();
        currentSymbol = symbol;

        if (!symbol) return alert("Please enter a symbol!");

        if (!isPaidUser) {
            if (els.controls.aiLogsContent) showLockMessage(els.controls.aiLogsContent);
            if (els.controls.statsPanel) els.controls.statsPanel.innerHTML = `<div class="scanner-empty" style="padding:30px; font-size:12px; color:var(--color-short);">Upgrade required</div>`;
            return;
        }

        // --- 🟢 NEW: VALIDATE COIN BEFORE SENDING TO SERVER 🟢 ---
        if (currentMarket === 'crypto') {
            const isValid = await checkBinanceFuturesSymbol(symbol);
            if (!isValid) {
                showInvalidCoinPopup(symbol);
                // Update Logs section with error state
                if (els.controls.aiLogsContent) {
                    els.controls.aiLogsContent.innerHTML = `
                        <div class="scanner-empty" style="padding:40px;">
                            <div style="font-size: 28px; margin-bottom: 12px;">🚫</div>
                            <strong style="color:var(--color-short); font-size: 14px;">Invalid Coin Symbol: ${symbol}</strong><br>
                            <span style="font-size:11px; color:var(--text-muted); margin-top: 8px; display: inline-block;">
                                Please verify the coin is listed on Binance Futures.
                            </span>
                        </div>`;
                }
                return; // Stop further execution! Server request and chart load will be aborted.
            }
        }
        // ---------------------------------------------------------

        try {
            setLoadingState(true);
            waitWarningShownForCurrentAnalysis = false; // Reset so new analysis can show popup if WAIT
            if (els.controls.aiLogsContent) els.controls.aiLogsContent.innerHTML = "<div class='pulse' style='color:var(--accent-cyan); text-align:center; padding:40px;'>Running analysis...</div>";

            resetAlertState(symbol);
            await loadChartData(symbol, currentInterval, false);
            clearChartObjects();

            let analysisData = await runAnalysisWeb(symbol, currentInterval, currentMarket);

            currentAnalysisData = analysisData;
            localStorage.setItem(`analysis_${currentMarket}_${symbol}_${currentInterval}`, JSON.stringify(analysisData));
            updateDashboard(analysisData);

        } catch (error) {
            console.error("Full Analysis Error:", error);
            const errorMsg = error.error || error.message || JSON.stringify(error);
            if (els.controls.aiLogsContent) els.controls.aiLogsContent.innerHTML = `<div style="color:var(--color-short)">Error: ${errorMsg}</div>`;
        } finally {
            setLoadingState(false);
        }
    });
}

function resetAlertState(symbol) {
    alertState = {
        symbol: symbol,
        entryHit: false,
        tp1Hit: false,
        tp2Hit: false,
        slHit: false
    };
    console.log("Alerts Reset for:", symbol);
}

function monitorPriceForAlerts(currentPrice) {
    if (!currentAnalysisData || !currentAnalysisData.ai_prediction) return;

    const scenario = currentAnalysisData.ai_prediction.trade_scenarios ? currentAnalysisData.ai_prediction.trade_scenarios[0] : null;
    if (!scenario) return;

    if (alertState.symbol !== currentSymbol) return;

    const type = (scenario.trade_type || "").toUpperCase();
    const entry = extractPrice(scenario.entry_zone || scenario.entry);
    const sl = extractPrice(scenario.invalidation);

    let targets = scenario.targets || [];
    if (targets.length === 0 && scenario.target) targets = [scenario.target];
    const numTargets = targets.map(t => extractPrice(t)).filter(t => t);

    if (!entry || !sl || numTargets.length === 0) return;

    const tp1 = numTargets[0];
    const tp2 = numTargets.length > 1 ? numTargets[1] : null;

    let message = "";

    if (type.includes("LONG") || type.includes("BUY")) {
        if (!alertState.entryHit && currentPrice <= entry) {
            alertState.entryHit = true;
            message = `🚀 ENTRY HIT: ${currentSymbol} at ${currentPrice}\nOpen LONG Position.`;
        }
        if (!alertState.tp1Hit && currentPrice >= tp1) {
            alertState.tp1Hit = true;
            message = `💰 TP 1 HIT: ${currentSymbol} at ${currentPrice}\nSecure Profits (1.5R).`;
        }
        if (tp2 && !alertState.tp2Hit && currentPrice >= tp2) {
            alertState.tp2Hit = true;
            message = `💰💰 TP 2 HIT: ${currentSymbol} at ${currentPrice}\nMoon Bag Activated!`;
        }
        if (!alertState.slHit && currentPrice <= sl) {
            alertState.slHit = true;
            message = `🛑 STOP LOSS HIT: ${currentSymbol} at ${currentPrice}\nClose Trade.`;
        }
    }
    else if (type.includes("SHORT") || type.includes("SELL")) {
        if (!alertState.entryHit && currentPrice >= entry) {
            alertState.entryHit = true;
            message = `🚀 ENTRY HIT: ${currentSymbol} at ${currentPrice}\nOpen SHORT Position.`;
        }
        if (!alertState.tp1Hit && currentPrice <= tp1) {
            alertState.tp1Hit = true;
            message = `💰 TP 1 HIT: ${currentSymbol} at ${currentPrice}\nSecure Profits (1.5R).`;
        }
        if (tp2 && !alertState.tp2Hit && currentPrice <= tp2) {
            alertState.tp2Hit = true;
            message = `💰💰 TP 2 HIT: ${currentSymbol} at ${currentPrice}\nTarget 2 Smashed!`;
        }
        if (!alertState.slHit && currentPrice >= sl) {
            alertState.slHit = true;
            message = `🛑 STOP LOSS HIT: ${currentSymbol} at ${currentPrice}\nClose Trade.`;
        }
    }

    if (message) {
        console.log("Local Alert:", message);
    }
}

async function updateDashboard(data) {
    const els = getElements();
    if (!data) return;

    const p = data.ai_prediction || {};
    const macro = p.macro_analysis || {};
    const micro = p.micro_analysis || {};

    if (p.trade_scenarios && Array.isArray(p.trade_scenarios)) {
        // --- 🟢 NEW LOGIC: CHECK FOR WAIT/NEUTRAL SIGNAL (show popup only once per analysis) ---
        const mainSetup = p.trade_scenarios[0];
        if (mainSetup && !waitWarningShownForCurrentAnalysis) {
            const type = (mainSetup.trade_type || "").toUpperCase();
            if (type === 'WAIT' || type === 'NEUTRAL') {
                waitWarningShownForCurrentAnalysis = true;
                showWaitWarningPopup();
            }
        }
        // ----------------------------------------------------

        p.trade_scenarios.forEach(sc => {
            const entry = extractPrice(sc.entry_zone || sc.entry);
            const stop = extractPrice(sc.invalidation);

            if (entry && stop) {
                const risk = Math.abs(entry - stop);
                const type = (sc.trade_type || "").toUpperCase();
                const isLong = type.includes('LONG') || type.includes('BUY');
                const isShort = type.includes('SHORT') || type.includes('SELL');
                const decimals = entry < 10 ? 4 : 2;

                const capRR = 5.0;
                let capPrice = 0;

                if (isLong) capPrice = entry + (risk * capRR);
                else if (isShort) capPrice = entry - (risk * capRR);

                if (capPrice > 0) {
                    if (!sc.targets) sc.targets = [];
                    if (!Array.isArray(sc.targets)) {
                        if (sc.target) sc.targets = [sc.target];
                        else sc.targets = [];
                    }

                    sc.targets = sc.targets.map(t => {
                        const price = extractPrice(t);
                        if (price === null) return t;

                        if (isLong) {
                            return price > capPrice ? parseFloat(capPrice.toFixed(decimals)) : price;
                        } else if (isShort) {
                            return price < capPrice ? parseFloat(capPrice.toFixed(decimals)) : price;
                        }
                        return price;
                    });

                    sc.targets = [...new Set(sc.targets)];
                }
            }
        });
    }

    const statusMsg = p.trade_status_message || "FRESH ANALYSIS";
    let statusColor = "var(--text-dim)";

    if (statusMsg.includes("WON")) statusColor = "var(--color-long)";
    else if (statusMsg.includes("TP")) statusColor = "var(--color-long)";
    else if (statusMsg.includes("LOST")) statusColor = "var(--color-short)";
    else if (statusMsg.includes("RUNNING")) statusColor = "var(--primary)";
    else if (statusMsg.includes("LIMIT ORDER")) statusColor = "#FBBF24";
    else if (statusMsg.includes("WAITING")) statusColor = "#FBBF24";
    else if (statusMsg.includes("MISSED")) statusColor = "#F87171";

    const macTrend = macro.trend || "NEUTRAL";
    const micTrend = micro.wave_personality || "NEUTRAL";
    const macColor = macTrend.toLowerCase().includes('bull') ? 'var(--color-long)' : (macTrend.toLowerCase().includes('bear') ? 'var(--color-short)' : 'var(--text-dim)');

    const mMacro = document.getElementById('meter-macro');
    const mMicro = document.getElementById('meter-micro');
    if (mMacro) mMacro.innerHTML = `<span style="color:${macColor}">${macTrend}</span>`;
    if (mMicro) mMicro.innerHTML = `<span style="color:${macColor}">${micTrend.includes('Impulse') ? 'IMPULSE' : 'CORRECTION'}</span>`;

    let rrDisplay = "-";
    let riskDisplay = "-";
    let rewardDisplay = "-";

    if (p.trade_scenarios && p.trade_scenarios.length > 0) {
        const sc = p.trade_scenarios[0];
        const entry = extractPrice(sc.entry_zone || sc.entry);
        let targets = sc.targets || [sc.target];
        let finalTP = extractPrice(targets[targets.length - 1]);
        const stop = extractPrice(sc.invalidation);

        if (entry && finalTP && stop) {
            const risk = Math.abs(entry - stop);
            const reward = Math.abs(finalTP - entry);
            const rr = (reward / risk).toFixed(2);
            rrDisplay = `1 : ${rr}`;
            riskDisplay = ((risk / entry) * 100).toFixed(2) + "%";
            rewardDisplay = ((reward / entry) * 100).toFixed(2) + "%";
        }
    }

    if (els.controls.statsPanel) {
        els.controls.statsPanel.innerHTML = `
            <div style="margin-bottom: 20px;">
                <div class="stat-section-title">Market Status</div>
                <div class="stat-box highlight" style="border-left-color: ${statusColor};">
                    <span class="stat-label">Signal</span>
                    <span class="stat-value" style="color: ${statusColor};">${statusMsg.split('|')[0]}</span>
                </div>
                <div class="stat-box">
                    <span class="stat-label">Trend</span>
                    <span class="stat-value" style="color: ${macColor}">${macro.trend || 'N/A'}</span>
                </div>
                <div class="stat-box wave-box">
                    <span class="stat-label">Wave</span>
                    <span class="stat-value">${micro.wave_personality || micro.current_wave_degree || micro.wave_count_status || '-'}</span>
                </div>
            </div>
            <div style="margin-bottom: 20px;">
                <div class="stat-section-title">Key Levels</div>
                <div class="stat-box" style="flex-direction: column; align-items: flex-start; gap: 6px;">
                    <span class="stat-label">Resistance / Support</span>
                    <span class="stat-value" style="font-size: 11px; line-height: 1.5;">${macro.key_levels || 'Run analysis to see key levels'}</span>
                </div>
            </div>
            <div>
                <div class="stat-section-title">Trade Math</div>
                <div class="stat-box">
                    <span class="stat-label">R:R</span>
                    <span class="stat-value" style="color: var(--accent-cyan);">${rrDisplay}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div class="stat-box">
                        <span class="stat-label">Risk</span>
                        <span class="stat-value" style="color: var(--color-short);">${riskDisplay.includes('-') ? riskDisplay : '-' + riskDisplay}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Reward</span>
                        <span class="stat-value" style="color: var(--color-long);">${rewardDisplay.includes('+') ? rewardDisplay : '+' + rewardDisplay}</span>
                    </div>
                </div>
            </div>
        `;
    }

    let html = `
        <div class="analysis-status-banner" style="background: linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(6,182,212,0.08) 100%); border: 1px solid rgba(59,130,246,0.3); border-radius: 10px; padding: 14px 18px; margin-bottom: 20px;">
            <div style="font-size: 9px; color: var(--accent-cyan); text-transform: uppercase; font-weight: 700; letter-spacing: 1px; margin-bottom: 6px;">Status</div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text-main);">${statusMsg}</div>
        </div>
        <div style="margin-bottom: 20px;">
            <div class="stat-section-title">Macro Analysis (${currentSymbol})</div>
            <p style="font-size: 12px; color: var(--text-main); line-height: 1.6; opacity: 0.9;">${macro.detailed_breakdown || 'Analysis complete.'}</p>
            ${macro.key_levels ? `
            <div class="key-levels-box">
                <div class="key-levels-label">Key Levels</div>
                <div class="key-levels-val">${macro.key_levels}</div>
            </div>
            ` : ''}
        </div>
        ${(micro.wave_count_status || micro.wave_personality) ? `
        <div class="micro-analysis-box">
            <div class="micro-title">Micro Analysis (${currentInterval})</div>
            <div class="micro-row">
                <div class="micro-item">
                    <div class="micro-item-label">Wave Count</div>
                    <div class="micro-item-value">${micro.wave_count_status || '-'}</div>
                </div>
                <div class="micro-item">
                    <div class="micro-item-label">Wave Personality</div>
                    <div class="micro-item-value">${micro.wave_personality || '-'}</div>
                </div>
            </div>
        </div>
        ` : ''}
        <div>
            <div class="stat-section-title">Trade Scenarios</div>
    `;

    if (p.trade_scenarios && Array.isArray(p.trade_scenarios)) {
        const mainSetup = p.trade_scenarios[0];
        let activeAdvice = mainSetup.generated_advice || p.action_advice || null;

        clearChartObjects();
        if (mainSetup) {
            drawTradeLinesOnChart(mainSetup);
        }

        p.trade_scenarios.forEach((sc, index) => {
            let type = sc.trade_type ? sc.trade_type.toUpperCase() : "NEUTRAL";
            let themeColor = 'var(--text-dim)';
            let dirLabel = 'NEUTRAL';
            let dirIcon = '▬';
            let bgBadge = 'transparent';

            let dirClass = 'neutral';
            if (type.includes('LONG')) { themeColor = 'var(--color-long)'; dirLabel = 'LONG'; dirIcon = '▲'; dirClass = 'long'; }
            else if (type.includes('SHORT')) { themeColor = 'var(--color-short)'; dirLabel = 'SHORT'; dirIcon = '▼'; dirClass = 'short'; }

            let targetList = (sc.targets || (sc.target ? [sc.target] : [])).filter(t => t != null && t !== '');
            let targetHtml = targetList.map((t, i) => {
                const val = extractPrice(t) ?? t;
                return `<div style="font-size:10px; margin-bottom:2px;"><span style="color:var(--text-muted)">TP${i + 1}</span> ${val}</div>`;
            }).join('');

            let isMain = index === 0;

            let adviceHtml = '';
            if (isMain) {
                let adviceText = activeAdvice || "Waiting for updates...";
                let adviceColor = "var(--accent-cyan)";
                if (adviceText.includes("Hold") || adviceText.includes("Entry") || adviceText.includes("Execute") || adviceText.includes("Target") || adviceText.includes("Profit")) adviceColor = "var(--color-long)";
                if (adviceText.includes("Close") || adviceText.includes("Loss") || adviceText.includes("Stop") || adviceText.includes("Risk")) adviceColor = "var(--color-short)";

                adviceHtml = `
                <div class="ai-advice-box" style="background: rgba(0,0,0,0.2); border: 1px solid ${adviceColor};">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span class="ai-advice-title" style="color:${adviceColor}">AI Advice</span>
                        <button id="embedded-status-btn" style="padding:4px 8px; font-size:9px; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:var(--text-dim); border-radius:4px; font-weight:700; cursor:pointer;" title="Update Status">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                        </button>
                    </div>
                    <div style="font-size:12px; color:var(--text-main); line-height:1.5;">${adviceText}</div>
                </div>`;
            }

            html += `
                <div class="trade-card ${isMain ? 'active-setup' : ''}">
                    <div class="card-header">
                        <div>
                            <div class="card-title">${sc.name}</div>
                            <div class="card-badges">
                                ${isMain ? `<span class="card-badge" style="background:${themeColor}; color:white;">Active</span>` : ''}
                                ${sc.probability ? `<span class="card-badge" style="background:var(--glass-panel-hover); color:var(--text-dim);">${sc.probability}</span>` : ''}
                            </div>
                        </div>
                        <div class="card-direction ${dirClass}">${dirIcon} ${dirLabel}</div>
                    </div>
                    ${adviceHtml}
                    ${(sc.entry_zone || sc.entry || sc.invalidation || targetList.length) ? `
                    <div class="level-row">
                        ${(sc.entry_zone || sc.entry) ? `
                        <div class="level-item entry-level">
                            <div class="level-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
                            </div>
                            <div class="level-content">
                                <div class="level-label">Entry Zone</div>
                                <div class="level-val">${formatPriceDisplay(sc.entry_zone || sc.entry)}</div>
                            </div>
                        </div>
                        ` : ''}
                        ${sc.invalidation ? `
                        <div class="level-item sl-level">
                            <div class="level-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </div>
                            <div class="level-content">
                                <div class="level-label">Stop Loss</div>
                                <div class="level-val">${formatPriceDisplay(sc.invalidation)}</div>
                            </div>
                        </div>
                        ` : ''}
                        ${targetList.length ? `
                        <div class="level-item tp-level">
                            <div class="level-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
                            </div>
                            <div class="level-content">
                                <div class="level-label">Take Profit Targets</div>
                                <div class="tp-list">
                                    ${targetList.map((t, i) => {
                const val = formatPriceDisplay(extractPrice(t) ?? t);
                return `<div class="tp-row"><span>TP${i + 1}</span><span>${val}</span></div>`;
            }).join('')}
                                </div>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}
                    ${sc.summary ? `<div class="card-summary">"${sc.summary}"</div>` : ''}
                </div>
            `;
        });
    } else {
        html += `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:12px;">No trade scenarios found.</div>`;
    }
    html += `</div>`;

    if (els.controls.aiLogsContent) {
        els.controls.aiLogsContent.innerHTML = html;

        const btnEmbed = document.getElementById('embedded-status-btn');
        if (btnEmbed) {
            btnEmbed.addEventListener('click', handleStatusUpdate);
        }
    }
}

function extractPrice(str) {
    if (str === null || str === undefined) return null;
    if (typeof str === 'number') return str;
    const match = str.toString().match(/[\d,]+(\.\d+)?/);
    return match ? parseFloat(match[0].replace(',', '')) : null;
}

function getDecimalPlaces(num) {
    if (num === null || num === undefined) return 2;
    if (num >= 1000) return 2;
    if (num >= 100) return 2;
    if (num >= 10) return 2;
    if (num >= 1) return 4;  // Forex pairs like EURUSD, GBPUSD need 4 decimals
    if (num >= 0.1) return 4;
    if (num >= 0.01) return 5;
    if (num >= 0.001) return 5;
    if (num >= 0.0001) return 6;
    if (num >= 0.00001) return 7;
    return 8;
}

function updateLivePrice(price) {
    const livePriceEl = document.getElementById('live-price');
    if (livePriceEl) {
        if (price === null || price === undefined) {
            livePriceEl.textContent = '-';
        } else {
            const decimals = getDecimalPlaces(price);
            livePriceEl.textContent = price.toFixed(decimals);
        }
    }
}

function formatPriceDisplay(val) {
    if (val === null || val === undefined) return '-';
    const num = typeof val === 'number' ? val : extractPrice(val);
    if (num === null) return String(val);

    if (num >= 1000) {
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    const decimals = getDecimalPlaces(num);
    return num.toFixed(decimals);
}

function drawTradeLinesOnChart(scenario) {
    if (!chart || !candleSeries) return;

    const entry = extractPrice(scenario.entry_zone || scenario.entry);
    const sl = extractPrice(scenario.invalidation);

    let targets = [];
    if (scenario.targets && Array.isArray(scenario.targets)) {
        targets = scenario.targets.map(t => extractPrice(t)).filter(t => t);
    } else if (scenario.target) {
        targets = [extractPrice(scenario.target)];
    }

    if (!entry || targets.length === 0 || !sl) return;

    const entryDecimals = getDecimalPlaces(entry);
    const entryFormatted = entry.toFixed(entryDecimals);

    tradeLines.push(candleSeries.createPriceLine({
        price: entry, color: '#f59e0b', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: `ENTRY: ${entryFormatted}`
    }));

    const slPct = ((Math.abs(entry - sl) / entry) * 100).toFixed(2);
    const slDecimals = getDecimalPlaces(sl);
    const slFormatted = sl.toFixed(slDecimals);

    tradeLines.push(candleSeries.createPriceLine({
        price: sl, color: '#ef4444', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: `STOP: ${slFormatted} (-${slPct}%)`
    }));

    targets.forEach((tp, index) => {
        const tpPct = ((Math.abs(tp - entry) / entry) * 100).toFixed(2);
        const tpDecimals = getDecimalPlaces(tp);
        const tpFormatted = tp.toFixed(tpDecimals);

        let title = index === 0 ? `TP 1: ${tpFormatted} (1.5R) (+${tpPct}%)` : `TP ${index + 1}: ${tpFormatted} (+${tpPct}%)`;

        tradeLines.push(candleSeries.createPriceLine({
            price: tp,
            color: '#10B981',
            lineWidth: 2,
            lineStyle: 0,
            axisLabelVisible: true,
            title: title
        }));
    });
}

function clearChartObjects() {
    if (candleSeries && tradeLines.length > 0) {
        tradeLines.forEach(line => candleSeries.removePriceLine(line));
        tradeLines = [];
    }
}

function initChart() {
    const els = getElements();
    if (chart) return;

    const container = els.controls.chartContainer;
    if (!container) return;

    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userLocale = navigator.language || 'en-US';

    const { createChart } = LightweightCharts;
    chart = createChart(container, {
        layout: { background: { color: 'transparent' }, textColor: '#a1a1aa', fontFamily: "'Outfit', sans-serif" },
        grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
        width: container.clientWidth,
        height: container.clientHeight,

        localization: {
            locale: userLocale,
            timeFormatter: (timestamp) => {
                return new Date(timestamp * 1000).toLocaleString(userLocale, {
                    timeZone: userTimezone,
                    hour12: false,
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: 'rgba(255,255,255,0.1)',
            tickMarkFormatter: (time, tickMarkType, locale) => {
                const date = new Date(time * 1000);
                if (currentInterval === '1d' || currentInterval === '1wk') {
                    return date.toLocaleDateString(userLocale, {
                        timeZone: userTimezone,
                        day: 'numeric',
                        month: 'short'
                    });
                } else {
                    return date.toLocaleTimeString(userLocale, {
                        timeZone: userTimezone,
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            }
        },
        rightPriceScale: {
            borderColor: 'rgba(255,255,255,0.1)',
            priceFormatter: (price) => {
                const decimals = getDecimalPlaces(price);
                return price.toFixed(decimals);
            }
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderUpColor: '#22c55e', borderDownColor: '#ef4444',
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });

    new ResizeObserver(entries => {
        if (entries.length && entries[0].target === container) {
            const { width, height } = entries[0].contentRect;
            chart.applyOptions({ width, height });
        }
    }).observe(container);

    showTimezoneLabel(userTimezone);
}

function showTimezoneLabel(tz) {
    const container = document.getElementById('chart-inner');
    if (!container) return;

    let label = document.getElementById('tz-label');
    if (!label) {
        label = document.createElement('div');
        label.id = 'tz-label';
        label.style.position = 'absolute';
        label.style.bottom = '5px';
        label.style.left = '5px';
        label.style.fontSize = '10px';
        label.style.color = 'rgba(148, 163, 184, 0.5)';
        label.style.zIndex = '20';
        label.style.pointerEvents = 'none';
        label.style.fontFamily = "'Inter', sans-serif";
        container.appendChild(label);
    }
    label.innerText = `Timezone: ${tz}`;
}

async function loadChartData(symbol, interval, restoreState = true) {
    if (!symbol) return;

    if (binanceSocket) {
        binanceSocket.onmessage = null;
        binanceSocket.close();
        binanceSocket = null;
    }
    clearChartObjects();
    if (candleSeries) candleSeries.setData([]);
    if (chart) { chart.timeScale().fitContent(); chart.priceScale('right').applyOptions({ autoScale: true }); }

    document.title = `Loading ${symbol}... | AI Signal Dashboard`;
    updateLivePrice(null); // Reset live price display

    if (currentMarket === 'forex') {
        alert("Forex mode is not enabled yet.");
        currentMarket = "crypto";
        return loadChartData(symbol, interval, restoreState);
    }

    // --- CRYPTO LOGIC (Binance) ---
    else {
        stopForexStream();
        try {
            const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1000`);
            const data = await res.json();
            const candles = data.map(d => ({
                time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4])
            }));
            candleSeries.setData(candles);
            if (candles.length > 0) {
                updateLivePrice(candles[candles.length - 1].close);
            }
            chart.priceScale('right').applyOptions({ autoScale: true });
            chart.timeScale().fitContent();
            connectBinanceStream(symbol, interval);
            if (restoreState) checkAndRestoreAnalysis(symbol);
        } catch (e) { console.error("Chart Data Error", e); }
    }
}

function checkAndRestoreAnalysis(symbol) {
    const savedData = localStorage.getItem(`analysis_${currentMarket}_${symbol}_${currentInterval}`);
    if (savedData) {
        try {
            const parsedData = JSON.parse(savedData);
            console.log(`Restoring saved analysis for ${symbol}`);
            currentAnalysisData = parsedData;
            updateDashboard(parsedData);
        } catch (e) {
            console.error("Failed to restore local analysis", e);
        }
    } else {
        currentAnalysisData = null;
        const els = getElements();
        if (els.controls.aiLogsContent) {
            els.controls.aiLogsContent.innerHTML = `<div class="scanner-empty" style="padding:40px;"><span>Ready to analyze <strong>${symbol}</strong></span><span style="font-size:11px;">Run analysis to see trade scenarios</span></div>`;
        }
        if (els.controls.statsPanel) {
            els.controls.statsPanel.innerHTML = `<div class="scanner-empty" style="padding:30px; font-size:12px;">No Active Analysis</div>`;
        }
    }
}

// --- FOREX SOCKET (forex_server.py) ---
function connectForexStream(symbol) {
    const ioClient = window.io || io;

    if (!forexSocket || !forexSocket.connected) {
        console.log("Connecting to Forex Server:", FOREX_SERVER_URL);
        forexSocket = ioClient(FOREX_SERVER_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 5
        });

        forexSocket.on('connect', () => {
            console.log("✅ Connected to Forex VPS!");
            subscribeToSymbol(symbol);
        });

        forexSocket.on('price_update', (data) => {
            if (data.symbol !== lastSubscribedSymbol) return;

            console.log("Price Update:", data.symbol, data.bid);

            if (lastCandle && candleSeries) {
                const updatedCandle = {
                    time: lastCandle.time,
                    open: lastCandle.open,
                    high: Math.max(lastCandle.high, data.bid),
                    low: Math.min(lastCandle.low, data.bid),
                    close: data.bid
                };

                candleSeries.update(updatedCandle);
                lastCandle = updatedCandle;
            } else {
                const candle = {
                    time: Math.floor(data.time),
                    open: data.bid,
                    high: data.bid,
                    low: data.bid,
                    close: data.bid
                };
                candleSeries.update(candle);
                lastCandle = candle;
            }

            const bidDecimals = getDecimalPlaces(data.bid);
            document.title = `${data.bid.toFixed(bidDecimals)} | ${data.symbol}`;
            updateLivePrice(data.bid);
            monitorPriceForAlerts(data.bid);
        });

        forexSocket.on('connect_error', (err) => {
            console.error("❌ Socket Error:", err.message);
        });

        forexSocket.on('disconnect', () => {
            console.log("⚠️ Disconnected from Forex Feed");
        });

    } else {
        subscribeToSymbol(symbol);
    }
}

function subscribeToSymbol(newSymbol) {
    if (lastSubscribedSymbol === newSymbol) return;

    if (lastSubscribedSymbol) {
        console.log(`👋 Unsubscribing from ${lastSubscribedSymbol}`);
        forexSocket.emit('unsubscribe', lastSubscribedSymbol);
    }

    console.log(`🔔 Subscribing to ${newSymbol}`);
    forexSocket.emit('subscribe', newSymbol);

    lastSubscribedSymbol = newSymbol;
}

function stopForexStream() {
    if (forexSocket) {
        if (lastSubscribedSymbol) {
            forexSocket.emit('unsubscribe', lastSubscribedSymbol);
        }
        forexSocket.disconnect();
        forexSocket = null;
        lastSubscribedSymbol = null;
        console.log("🛑 Forex Stream Stopped");
    }
}

function connectBinanceStream(symbol, interval) {
    if (currentMarket === 'forex') return;

    const wsSymbol = symbol.toLowerCase();
    binanceSocket = new WebSocket(`wss://fstream.binance.com/ws/${wsSymbol}@kline_${interval}`);
    binanceSocket.onmessage = (e) => {
        if (symbol !== currentSymbol || !candleSeries) return;
        const k = JSON.parse(e.data).k;
        const candle = {
            time: k.t / 1000, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c)
        };
        candleSeries.update(candle);
        const closePrice = parseFloat(k.c);
        const closeDecimals = getDecimalPlaces(closePrice);
        document.title = `${closePrice.toFixed(closeDecimals)} | ${symbol}`;
        updateLivePrice(closePrice);
        monitorPriceForAlerts(candle.close);
    };
}

const btnScan = document.getElementById('start-scan-btn');
if (btnScan) {
    btnScan.addEventListener('click', async () => {
        const els = getElements();

        if (!isPaidUser) {
            showLockMessage(els.controls.scannerGrid);
            return;
        }

        const mode = els.inputs.scanMode.value;
        const displayMode = currentMarket === 'forex'
            ? 'Forex Market'
            : `Futures Market (${mode})`;

        els.controls.scannerGrid.innerHTML = `
            <div class='pulse' style="text-align:center; margin-top:50px; color:var(--primary);">
                Scanning ${displayMode}...
            </div>
        `;

        try {
            let res = await runScanWeb(mode, currentMarket);
            renderScannerResults(res);
        } catch (e) {
            console.error("Scanner Error:", e);
            els.controls.scannerGrid.innerHTML = `
                <div style="text-align:center; color:var(--color-short); margin-top:20px;">
                    Error: ${e.message}
                </div>
            `;
        }
    });
}

function renderScannerResults(data) {
    const els = getElements();
    const grid = els.controls.scannerGrid;
    grid.innerHTML = "";

    let hasResults = false;

    let aiSymbols = [];
    if (data.ai_analysis) {
        let aiPicks = [];
        try { aiPicks = typeof data.ai_analysis === 'string' ? JSON.parse(data.ai_analysis) : data.ai_analysis; } catch (e) { }

        if (Array.isArray(aiPicks) && aiPicks.length > 0) {
            hasResults = true;
            let aiHtml = `<div style="margin-bottom: 24px;"><div class="scan-section-title">Premium Opportunities</div><div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:12px;">`;

            aiPicks.forEach(coin => {
                let sym = coin.ticker || coin.symbol;
                aiSymbols.push(sym);
                let isLong = coin.signal.includes('LONG');
                let color = isLong ? 'var(--color-long)' : 'var(--color-short)';
                let bgColor = isLong ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                aiHtml += `
                    <div class="scan-card" onclick="loadFromScanner('${sym}')" style="border-left: 3px solid ${color}">
                        <div class="scan-card-header">
                            <span class="scan-ticker">${sym}</span>
                            <span class="scan-signal-badge" style="background:${bgColor}; color:${color};">${coin.signal.replace('POTENTIAL_', '')}</span>
                        </div>
                        <div class="scan-reason">${coin.reason}</div>
                    </div>
                `;
            });
            aiHtml += `</div></div>`;
            grid.innerHTML += aiHtml;
        }
    }

    if (data.candidates && Array.isArray(data.candidates)) {
        const extraCoins = data.candidates.filter(c => !aiSymbols.includes(c.symbol)).slice(0, 20);
        if (extraCoins.length > 0) {
            hasResults = true;
            let extraHtml = `<div><div class="scan-section-title">Quick Signals</div><div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap:10px;">`;

            extraCoins.forEach(coin => {
                let signalText = coin.signal || "NEUTRAL";
                let isLong = signalText.toUpperCase().includes('LONG') || signalText.toUpperCase().includes('BUY');
                let isShort = signalText.toUpperCase().includes('SHORT') || signalText.toUpperCase().includes('SELL');
                let color = 'var(--text-dim)';
                let type = 'WAIT';
                if (isLong) { color = 'var(--color-long)'; type = 'LONG'; }
                else if (isShort) { color = 'var(--color-short)'; type = 'SHORT'; }

                extraHtml += `
                    <div class="scan-card" onclick="loadFromScanner('${coin.symbol}')" style="text-align:center; padding:12px;">
                        <div class="scan-ticker" style="margin-bottom:4px;">${coin.symbol}</div>
                        <div class="scan-signal-badge" style="background:var(--glass-panel-hover); color:${color};">${type}</div>
                    </div>
                `;
            });
            extraHtml += `</div></div>`;
            grid.innerHTML += extraHtml;
        }
    }

    if (!hasResults) {
        grid.innerHTML = `
            <div class="scanner-empty">
                <div class="scanner-empty-icon">📊</div>
                <div style="font-weight: 600;">No Opportunities Found</div>
                <div style="font-size: 11px;">
                    Market may be quiet. Try switching timeframe or scan mode.
                </div>
            </div>
        `;
    }
}

window.loadFromScanner = (sym) => {
    const els = getElements();
    currentSymbol = sym;
    els.inputs.coin.value = sym;

    const scanMode = els.inputs.scanMode.value;

    if (scanMode === 'swing') {
        currentInterval = '4h';
    } else {
        currentInterval = '15m';
    }

    if (els.inputs.tf) els.inputs.tf.value = currentInterval;

    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-tf') === currentInterval) {
            btn.classList.add('active');
        }
    });

    switchTab('dashboard');
    loadChartData(sym, currentInterval);

    const btnAnalyze = document.getElementById('analyze-btn');
    setTimeout(() => {
        if (btnAnalyze) btnAnalyze.click();
    }, 500);
};

function showLockMessage(container) {
    if (!container) return;

    container.innerHTML = `
        <div class="scanner-empty" style="padding: 40px;">
            <div style="font-size: 28px; margin-bottom: 12px;">🔒</div>
            <div style="font-weight: 700; color: var(--color-short); margin-bottom: 12px;">
                Access Restricted
            </div>
            <div style="font-size: 12px; color: var(--text-muted); line-height: 1.6;">
                Login and subscription access will be enabled soon.
            </div>
        </div>
    `;
}
function setLoadingState(isLoading) {
    const btn = document.getElementById('analyze-btn');
    if (!btn) return;
    btn.disabled = isLoading;
    btn.innerText = isLoading ? "Analyzing..." : "Run Analysis";
}

document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const selectedTf = e.target.getAttribute('data-tf');

        const tfDropdown = document.getElementById('timeframe-select');
        if (tfDropdown) tfDropdown.value = selectedTf;

        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentInterval = selectedTf;
        loadChartData(currentSymbol, selectedTf);
    });
});

function loadUserPreferences() {
    const els = getElements();
    const saved = localStorage.getItem('signal_ai_prefs');
    if (saved) {
        const prefs = JSON.parse(saved);
        if (prefs.market) {
            currentMarket = prefs.market;
            if (els.inputs.market) els.inputs.market.value = prefs.market;
            if (!prefs.coin) {
                const defaultCoin = prefs.market === 'forex' ? 'XAUUSD' : 'BTCUSDT';
                currentSymbol = defaultCoin;
                if (els.inputs.coin) {
                    els.inputs.coin.value = defaultCoin;
                    els.inputs.coin.placeholder = prefs.market === 'forex' ? 'Ex: XAUUSD' : 'Ex: BTCUSDT';
                }
            }
        }
        if (prefs.coin) {
            currentSymbol = prefs.coin;
            if (els.inputs.coin) els.inputs.coin.value = prefs.coin;
            const defCoin = document.getElementById('set-def-coin');
            if (defCoin) defCoin.value = prefs.coin;
        }
        if (prefs.tf) {
            currentInterval = prefs.tf;
            if (els.inputs.tf) els.inputs.tf.value = prefs.tf;
            const defTf = document.getElementById('set-def-tf');
            if (defTf) defTf.value = prefs.tf;
        }
        if (prefs.scanMode) {
            if (els.inputs.scanMode) els.inputs.scanMode.value = prefs.scanMode;
            const defScan = document.getElementById('set-def-scan');
            if (defScan) defScan.value = prefs.scanMode;
        }
        if (prefs.telegramChatId) {
            const tgInput = document.getElementById('set-tg-chat-id');
            if (tgInput) tgInput.value = prefs.telegramChatId;
        }

        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-tf') === currentInterval) btn.classList.add('active');
        });

        applyMarketConstraints(currentMarket);
    }
}

const saveBtn = document.getElementById('save-settings-btn');
if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const defCoin = document.getElementById('set-def-coin');
        const defTf = document.getElementById('set-def-tf');
        const defScan = document.getElementById('set-def-scan');
        const tgInput = document.getElementById('set-tg-chat-id');

        const newCoin = defCoin ? defCoin.value.toUpperCase() : 'BTCUSDT';
        const newTf = defTf ? defTf.value : '15m';
        const newScan = defScan ? defScan.value : 'scalp';
        const newTgId = tgInput ? tgInput.value.trim() : '';

        if (!newCoin) return alert("Please enter a valid coin symbol.");

        const prefs = {
            coin: newCoin,
            tf: newTf,
            scanMode: newScan,
            market: currentMarket,
            telegramChatId: newTgId
        };
        localStorage.setItem('signal_ai_prefs', JSON.stringify(prefs));

        const originalText = saveBtn.innerText;
        saveBtn.innerText = "SAVED";
        saveBtn.style.background = "var(--color-long)";
        setTimeout(() => {
            saveBtn.innerText = originalText;
            saveBtn.style.background = "";
        }, 2000);
    });
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        runCustomTour(true);
    }
});

const customTourStyle = document.createElement('style');
customTourStyle.innerHTML = `
    .tour-backdrop {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: transparent;
        z-index: 9990;
        opacity: 0; transition: opacity 0.3s ease; pointer-events: all; 
    }
    .tour-backdrop.active { opacity: 1; }
    .tour-highlight-box {
        position: fixed; border: 2px solid #eab308; border-radius: 8px;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.75);
        z-index: 9995; pointer-events: none; transition: all 0.4s;
        background: transparent;
    }
    .tour-tooltip {
        position: fixed; background: #0d1014; border: 1px solid #1e252d; color: #f4f4f5;
        padding: 20px; border-radius: 10px; width: 300px; z-index: 10000;
        font-family: 'Outfit', sans-serif;
        opacity: 0; transform: translateY(10px); transition: all 0.3s ease;
    }
    .tour-tooltip.active { opacity: 1; transform: translateY(0); }
    .tour-tooltip h3 { margin: 0 0 8px 0; color: #eab308; font-size: 14px; font-weight: 700; }
    .tour-tooltip p { margin: 0 0 16px 0; font-size: 12px; color: #a1a1aa; line-height: 1.5; }
    .tour-footer { display: flex; justify-content: space-between; align-items: center; }
    .tour-step-counter { font-size: 11px; color: #71717a; }
    .tour-buttons { display: flex; gap: 8px; }
    .tour-btn { padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; transition: 0.15s; }
    .tour-btn-next { background: #eab308; color: #000; }
    .tour-btn-next:hover { background: #ca8a04; }
    .tour-btn-skip { background: transparent; color: #71717a; }
    .tour-btn-skip:hover { color: #a1a1aa; }
`;
document.head.appendChild(customTourStyle);

const tourSteps = [
    { target: '.logo-area', title: 'Welcome to AI Signal Dashboard', text: 'Your AI-powered crypto trading assistant. Let’s take a quick tour.', position: 'bottom' },
    { target: '#market-selector', title: 'Select Market', text: 'Choose the market type. Crypto is enabled now; Forex can be added later.', position: 'bottom' },
    { target: '#coin-input', title: 'Select Symbol', text: 'Enter the crypto symbol you want to analyze here (e.g., BTCUSDT).', position: 'bottom' },
    { target: '#timeframe-select', title: 'Choose Timeframe', text: 'Select your preferred trading timeframe.', position: 'bottom' },
    { target: '#analyze-btn', title: 'Run Analysis', text: 'Click here to trigger the Deep Wave AI engine.', position: 'bottom' },
    { target: '#chart-container', title: 'Interactive Chart', text: 'Visualize price action, Trend Lines, and Wave Counts.', position: 'right' },
    { target: '#ai-logs', title: 'AI Signals Terminal', text: 'View optimized Entry zones, Stop Loss levels, and Profit Targets.', position: 'top' },
    { target: '.nav-icon:nth-child(2)', title: 'Scanner', text: 'Find setups automatically.', position: 'bottom' }
];

let currentStepIndex = 0;
let tourOverlayElements = {};

function createTourElements() {
    if (document.querySelector('.tour-backdrop')) return;
    const backdrop = document.createElement('div'); backdrop.className = 'tour-backdrop'; document.body.appendChild(backdrop);
    const highlightBox = document.createElement('div'); highlightBox.className = 'tour-highlight-box'; document.body.appendChild(highlightBox);
    const tooltip = document.createElement('div'); tooltip.className = 'tour-tooltip';
    tooltip.innerHTML = `
        <h3 id="tour-title"></h3><p id="tour-text"></p>
        <div class="tour-footer">
            <span class="tour-step-counter" id="tour-counter"></span>
            <div class="tour-buttons"><button class="tour-btn tour-btn-skip" onclick="endCustomTour()">Skip</button><button class="tour-btn tour-btn-next" id="tour-next-btn">Next</button></div>
        </div>
    `;
    document.body.appendChild(tooltip);
    document.getElementById('tour-next-btn').addEventListener('click', () => {
        if (currentStepIndex < tourSteps.length - 1) { currentStepIndex++; showStep(currentStepIndex); } else { endCustomTour(); }
    });
    tourOverlayElements = { backdrop, highlightBox, tooltip };
    requestAnimationFrame(() => { backdrop.classList.add('active'); tooltip.classList.add('active'); });
}

function showStep(index) {
    const step = tourSteps[index];
    const targetEl = document.querySelector(step.target);
    if (!targetEl) { if (index < tourSteps.length - 1) { currentStepIndex++; showStep(currentStepIndex); } else { endCustomTour(); } return; }
    const rect = targetEl.getBoundingClientRect(); const padding = 5; const box = tourOverlayElements.highlightBox;
    box.style.width = `${rect.width + (padding * 2)}px`; box.style.height = `${rect.height + (padding * 2)}px`; box.style.top = `${rect.top - padding}px`; box.style.left = `${rect.left - padding}px`;
    document.getElementById('tour-title').innerText = step.title; document.getElementById('tour-text').innerText = step.text;
    document.getElementById('tour-counter').innerText = `${index + 1} / ${tourSteps.length}`;
    document.getElementById('tour-next-btn').innerText = (index === tourSteps.length - 1) ? "Finish" : "Next";
    const tooltip = tourOverlayElements.tooltip; const tooltipRect = tooltip.getBoundingClientRect();
    let top = 0, left = 0;
    if (step.position === 'bottom') { top = rect.bottom + 15; left = rect.left; } else if (step.position === 'top') { top = rect.top - tooltipRect.height - 15; left = rect.left; } else if (step.position === 'right') { top = rect.top; left = rect.right + 15; }
    if (left + 320 > window.innerWidth) left = window.innerWidth - 340; if (top + tooltipRect.height > window.innerHeight) top = rect.top - tooltipRect.height - 15; if (top < 0) top = rect.bottom + 15;
    tooltip.style.top = `${top}px`; tooltip.style.left = `${left}px`;
}

function runCustomTour(force = false) {
    const hasSeen = localStorage.getItem('signal_ai_tour_seen_custom');
    if (hasSeen && !force) return;
    currentStepIndex = 0; createTourElements(); showStep(0);
}

window.endCustomTour = function () {
    const { backdrop, highlightBox, tooltip } = tourOverlayElements;
    if (backdrop) backdrop.classList.remove('active'); if (tooltip) tooltip.classList.remove('active');
    if (highlightBox) highlightBox.style.opacity = '0';
    setTimeout(() => { if (backdrop) backdrop.remove(); if (highlightBox) highlightBox.remove(); if (tooltip) tooltip.remove(); tourOverlayElements = {}; }, 300);
    localStorage.setItem('signal_ai_tour_seen_custom', 'true');
};

function showTelegramPopup() {
    if (!isPaidUser) return;
    if (localStorage.getItem('signal_ai_telegram_seen')) return;

    const overlay = document.createElement('div');
    overlay.className = 'telegram-overlay';

    overlay.innerHTML = `
        <div class="telegram-modal">
            <div class="tg-icon-circle">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width:30px;height:30px;">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 7.36l-1.6 7.6a.996.996 0 0 1-.72.76.99.99 0 0 1-1.04-.32l-2.6-2.12-1.28 1.24a.67.67 0 0 1-.48.16h-.08a.56.56 0 0 1-.52-.36l-.68-2.4-2.52-.76a.6.6 0 0 1 .04-1.16l9.84-3.84a.6.6 0 0 1 .8.8l-1.6 7.6z"/>
                    <path d="M12.04 2.03C6.5 2.03 2 6.53 2 12.07s4.5 10.04 10.04 10.04-4.5 10.04-10.04S17.58 2.03 12.04 2.03zM16.64 7.43l-1.6 7.6a.996.996 0 0 1-.72.76.99.99 0 0 1-1.04-.32l-2.6-2.12-1.28 1.24a.67.67 0 0 1-.48.16h-.08a.56.56 0 0 1-.52-.36l-.68-2.4-2.52-.76a.6.6 0 0 1 .04-1.16l9.84-3.84a.6.6 0 0 1 .8.8z" fill="none"/>
                    <path d="M9.8 14.64l.68 2.4c.12.44.72.56 1 .2l1.28-1.24L9.8 14.64z" fill="currentColor" opacity="0.5"/>
                    <path d="M21.198 2.433a2.242 2.242 0 0 0-1.022.215l-8.609 3.33c-2.068.8-4.133 1.598-5.724 2.21a405.15 405.15 0 0 1-2.849 1.09c-.42.147-.99.332-1.473.901-.728.968.193 1.798.919 2.286 1.61.516 3.275 1.009 4.654 1.472.509 1.793.997 3.592 1.48 5.388.16.36.506.494.864.498l-.002.018s.281.028.555-.038a2.1 2.1 0 0 0 .933-.517c.345-.324 1.28-1.244 1.811-1.764l3.999 2.952c.232.168.536.196.78.148l.671-11.736c.03-.533-.42-1.024-1.007-1.144z" fill="white"/>
                </svg>
            </div>
            <h2 class="tg-title">Exclusive Pro Access</h2>
            <p class="tg-desc">
                Welcome to the elite circle. As a Pro member, you have unlocked access to our 
                <strong>Private Telegram Channel</strong> for real-time signals, market updates, and direct support.
            </p>
            <div class="tg-actions">
                <button id="btn-join-tg" class="btn-tg-primary">JOIN CHANNEL NOW</button>
                <button id="btn-close-tg" class="btn-tg-secondary">Maybe Later</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.innerHTML = `
        .telegram-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(7, 9, 12, 0.9); z-index: 20000; display: flex; align-items: center; justify-content: center; }
        .telegram-modal { 
            background: #0d1014; border: 1px solid #1e252d;
            width: 360px; padding: 28px; border-radius: 12px; text-align: center; 
        }
        .tg-icon-circle { width: 56px; height: 56px; background: rgba(234, 179, 8, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 18px; color: #eab308; }
        .tg-title { color: #f4f4f5; font-size: 18px; font-weight: 700; margin-bottom: 10px; font-family: 'Outfit', sans-serif; }
        .tg-desc { color: #a1a1aa; font-size: 13px; line-height: 1.6; margin-bottom: 22px; }
        .tg-actions { display: flex; flex-direction: column; gap: 8px; }
        .btn-tg-primary { background: #eab308; color: #000; border: none; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; transition: 0.15s; }
        .btn-tg-primary:hover { background: #ca8a04; }
        .btn-tg-secondary { background: transparent; color: #71717a; border: none; padding: 10px; cursor: pointer; font-size: 12px; font-weight: 500; transition: 0.15s; }
        .btn-tg-secondary:hover { color: #a1a1aa; }
        @keyframes popIn { to { transform: scale(1); } }
    `;
    document.head.appendChild(style);
    document.getElementById('btn-join-tg').addEventListener('click', () => { const telegramLink = "https://t.me/+m6fnm2VyM0FjYzdl"; if (window.electronAPI && window.electronAPI.openExternal) { window.electronAPI.openExternal(telegramLink); } else { window.open(telegramLink, '_blank'); } localStorage.setItem('signal_ai_tour_seen_custom', 'true'); removePopup(); });
    document.getElementById('btn-close-tg').addEventListener('click', () => { localStorage.setItem('signal_ai_tour_seen_custom', 'true'); removePopup(); });
    function removePopup() { overlay.style.opacity = '0'; setTimeout(() => { overlay.remove(); style.remove(); }, 300); }
}

// ==========================================================
// --- 🚨 NEW FUNCTION: MARKET UNCERTAINTY POPUP 🚨 ---
// ==========================================================
function showWaitWarningPopup() {
    // Check if popup already exists
    if (document.getElementById('wait-warning-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'wait-warning-overlay';

    // Style consistent with "Glassy" theme
    overlay.innerHTML = `
        <div class="wait-modal">
            <div class="icon-pulse">⚠️</div>
            <h2>Market Conditions Unclear</h2>
            <p>
                Current market structure is undefined or choppy. 
                It is risky to trade now. Please wait for better price action or try a different timeframe.
            </p>
            <button id="btn-ack-wait">I Understand</button>
        </div>
    `;
    document.body.appendChild(overlay);

    // CSS Styling injected dynamically
    const style = document.createElement('style');
    style.id = 'wait-warning-style';
    style.innerHTML = `
        #wait-warning-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(5, 7, 10, 0.85);
            backdrop-filter: blur(8px);
            z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            opacity: 0; animation: fadeIn 0.3s forwards;
        }
        .wait-modal {
            background: linear-gradient(135deg, rgba(30, 37, 54, 0.9), rgba(20, 25, 35, 0.95));
            border: 1px solid rgba(245, 158, 11, 0.3); /* Amber border for warning */
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            padding: 40px;
            border-radius: 16px;
            text-align: center;
            max-width: 400px;
            transform: scale(0.9); animation: popIn 0.3s forwards;
        }
        .icon-pulse {
            font-size: 48px; margin-bottom: 20px;
            display: inline-block;
            animation: pulseWarn 2s infinite;
        }
        .wait-modal h2 {
            color: #FBBF24; /* Amber-400 */
            font-size: 20px; margin-bottom: 12px;
            font-family: 'Inter', sans-serif;
            text-transform: uppercase; letter-spacing: 1px;
        }
        .wait-modal p {
            color: #94A3B8;
            font-size: 14px; line-height: 1.6;
            margin-bottom: 30px;
        }
        #btn-ack-wait {
            background: rgba(245, 158, 11, 0.1);
            color: #FBBF24;
            border: 1px solid rgba(245, 158, 11, 0.3);
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600; cursor: pointer;
            transition: all 0.2s;
            font-family: 'Inter', sans-serif;
        }
        #btn-ack-wait:hover {
            background: #FBBF24; color: #000;
        }
        @keyframes pulseWarn {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
            100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeIn { to { opacity: 1; } }
        @keyframes popIn { to { transform: scale(1); } }
    `;
    document.head.appendChild(style);

    // Close Event
    document.getElementById('btn-ack-wait').addEventListener('click', () => {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
            style.remove();
        }, 300);
    });
}