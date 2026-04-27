const { entrypoints, storage } = require("uxp");
const ppro = require("premierepro");
const { localFileSystem } = storage;

const { segmentTranscript } = require("./src/editorialSegmenter");
const { generateLayoutsFromEditorialItems } = require("./src/layoutPipeline");
const { runMogrtInjection } = require("./src/mogrtRunner");

// ── State ────────────────────────────────────────────────────────────────────

let uiBound = false;
let sequenceName = "sequence";
let detectedCanvasWidth = 1920;
let detectedCanvasHeight = 1080;
let editorialResult = null;
let layoutResult = null;
let previewIndex = 0;
let isBusy = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeToString(value) {
    try {
        if (value === undefined) { return "undefined"; }
        if (value === null) { return "null"; }
        return String(value);
    } catch (e) { return "[toString error]"; }
}

function sanitizeFileName(value) {
    return String(value || "sequence")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .replace(/^\.+|\.+$/g, "")
        .trim() || "sequence";
}

function getEl(id) { return document.getElementById(id); }
function getInputValue(id) { const el = getEl(id); return el ? el.value : ""; }

function appendLog(message) {
    const logEl = getEl("log");
    if (!logEl) { return; }
    logEl.textContent += message + "\n";
    logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(message, type) {
    const el = getEl("status");
    if (!el) { return; }
    el.textContent = message;
    el.className = "status-bar" + (type ? " " + type : "");
}

function setBusy(busy) {
    isBusy = busy;
    ["loadTranscriptBtn", "applyBtn", "exportJsonBtn", "browseMogrtBtn",
        "prevPhraseBtn", "nextPhraseBtn"].forEach((id) => {
        const btn = getEl(id);
        if (btn) { btn.disabled = busy || shouldBeDisabled(id); }
    });
}

function shouldBeDisabled(id) {
    if (id === "applyBtn" || id === "exportJsonBtn") { return !layoutResult; }
    if (id === "prevPhraseBtn") { return !layoutResult || previewIndex <= 0; }
    if (id === "nextPhraseBtn") { return !layoutResult || previewIndex >= (layoutResult.items.length - 1); }
    return false;
}

function refreshButtons() {
    if (isBusy) { return; }
    ["applyBtn", "exportJsonBtn", "prevPhraseBtn", "nextPhraseBtn"].forEach((id) => {
        const btn = getEl(id);
        if (btn) { btn.disabled = shouldBeDisabled(id); }
    });
}

function setStepNum(numId, state) {
    const el = getEl(numId);
    if (!el) { return; }
    el.className = "nav-num" + (state === "done" ? " done" : "");
}

let currentStep = 1;

function showStep(n) {
    currentStep = n;
    [1, 2, 3].forEach((i) => {
        const content = getEl("stepContent" + i);
        const nav = getEl("nav" + i);
        if (content) { content.className = "step-content" + (i === n ? " visible" : ""); }
        if (nav) { nav.className = "nav-item" + (i === n ? " active" : ""); }
    });
}

// ── Settings persistence ─────────────────────────────────────────────────────

async function loadSettings() {
    try {
        const dataFolder = await localFileSystem.getDataFolder();
        const entries = await dataFolder.getEntries();
        const file = entries.find((f) => f.name === "settings.json");
        if (!file) { return; }
        const content = await file.read({ format: storage.formats.utf8 });
        const saved = JSON.parse(content);
        const fields = ["primaryFontFamily", "accentFontFamily",
            "verticalSpacingAdjustmentPx", "wordSpacingAdjustmentPx", "seed", "mogrtPath"];
        fields.forEach((id) => {
            if (saved[id] !== undefined) {
                const el = getEl(id);
                if (el) { el.value = saved[id]; }
            }
        });
    } catch (e) {}
}

async function saveSettings() {
    try {
        const dataFolder = await localFileSystem.getDataFolder();
        const saved = {
            primaryFontFamily: getInputValue("primaryFontFamily"),
            accentFontFamily: getInputValue("accentFontFamily"),
            verticalSpacingAdjustmentPx: getInputValue("verticalSpacingAdjustmentPx"),
            wordSpacingAdjustmentPx: getInputValue("wordSpacingAdjustmentPx"),
            seed: getInputValue("seed"),
            mogrtPath: getInputValue("mogrtPath")
        };
        const file = await dataFolder.createFile("settings.json", { overwrite: true });
        await file.write(JSON.stringify(saved), { format: storage.formats.utf8 });
    } catch (e) {}
}

// ── Preview (div + span, CSS scale — avoids canvas API issues in UXP) ─────────

function renderPreview() {
    const outer = getEl("previewOuter");
    const placeholder = getEl("previewPlaceholder");
    const labelEl = getEl("previewLabel");

    if (!layoutResult || !layoutResult.items || !layoutResult.items.length) {
        if (outer) { outer.style.display = "none"; }
        if (placeholder) { placeholder.style.display = "block"; }
        if (labelEl) { labelEl.textContent = "\u2014 / \u2014"; }
        return;
    }

    const item = layoutResult.items[previewIndex];
    if (!item || !outer) { return; }

    const srcW = detectedCanvasWidth;
    const srcH = detectedCanvasHeight;
    const maxW = 280;
    const maxH = 300;
    const scale = Math.min(maxW / srcW, maxH / srcH);
    const pW = Math.round(srcW * scale);
    const pH = Math.round(srcH * scale);

    outer.style.width = pW + "px";
    outer.style.height = pH + "px";
    outer.style.position = "relative";
    outer.style.background = "#e7e7e7";

    // Clear previous words
    while (outer.firstChild) {
        outer.removeChild(outer.firstChild);
    }

    const elements = Array.isArray(item.words) ? item.words : [];
    elements.forEach((el) => {
        const span = document.createElement("span");
        span.textContent = String(el.text || "");
        span.style.position = "absolute";
        span.style.left = Math.round(Number(el.x) * scale) + "px";
        // y is baseline; convert to CSS top (top of ink box ≈ baseline - ascent)
        // ascent ≈ 0.72 × fontSize for fonts with caps/ascenders
        const approxAscent = Number(el.fontSize) * 0.72;
        span.style.top = Math.round((Number(el.y) - approxAscent) * scale) + "px";
        span.style.fontFamily = String(el.fontFamily || "Helvetica") + ", Helvetica, Arial, sans-serif";
        span.style.fontSize = Math.max(4, Number(el.fontSize) * scale).toFixed(1) + "px";
        span.style.fontWeight = String(el.fontWeight || 700);
        span.style.color = String(el.fill || "#111111");
        span.style.lineHeight = "1";
        span.style.whiteSpace = "nowrap";
        outer.appendChild(span);
    });

    outer.style.display = "block";
    if (placeholder) { placeholder.style.display = "none"; }
    if (labelEl) { labelEl.textContent = (previewIndex + 1) + " / " + layoutResult.items.length; }
}

// ── Layout pipeline ───────────────────────────────────────────────────────────

function runLayoutPipeline() {
    if (!editorialResult || !editorialResult.items || !editorialResult.items.length) { return; }

    try {
        layoutResult = generateLayoutsFromEditorialItems({
            document: document,
            items: editorialResult.items,
            primaryFontFamily: getInputValue("primaryFontFamily"),
            accentFontFamily: getInputValue("accentFontFamily"),
            canvasWidth: detectedCanvasWidth,
            canvasHeight: detectedCanvasHeight,
            seed: getInputValue("seed"),
            verticalSpacingAdjustmentPx: getInputValue("verticalSpacingAdjustmentPx"),
            wordSpacingAdjustmentPx: getInputValue("wordSpacingAdjustmentPx")
        });

        appendLog("Layout generado: " + layoutResult.items.length + " frases.");
        previewIndex = 0;
        setStepNum("step2Num", "done");
        refreshButtons();
        // Update step 1 badge
        const badge = getEl("phraseCountBadge");
        if (badge && layoutResult.items.length) {
            badge.innerHTML = '<span class="badge">' + layoutResult.items.length + " frases</span>";
        }
    } catch (e) {
        setStatus("Error en el layout.", "error");
        appendLog("ERROR layout: " + safeToString(e && e.message ? e.message : e));
        console.error("[ParterSubtitles] layout error:", e);
        return;
    }

    // Render preview in a separate try so layout errors don't get swallowed by preview errors
    try {
        renderPreview();
    } catch (e) {
        appendLog("ERROR preview: " + safeToString(e && e.message ? e.message : e));
        console.error("[ParterSubtitles] preview error:", e);
    }
}

// ── Sequence canvas size detection ────────────────────────────────────────────

async function detectCanvasSize(sequence) {
    const fallback = { width: 1920, height: 1080 };

    // Try UXP sequence properties
    try {
        const w = Number(sequence.frameSizeHorizontal);
        const h = Number(sequence.frameSizeVertical);
        if (w > 0 && h > 0) { return { width: w, height: h }; }
    } catch (e) {}

    // Try via getSettings()
    try {
        if (typeof sequence.getSettings === "function") {
            const settings = await sequence.getSettings();
            if (settings) {
                const w = Number(
                    settings.videoFrameWidth ||
                    settings.frameWidth ||
                    settings.horizontalFrameSize
                );
                const h = Number(
                    settings.videoFrameHeight ||
                    settings.frameHeight ||
                    settings.verticalFrameSize
                );
                if (w > 0 && h > 0) { return { width: w, height: h }; }
            }
        }
    } catch (e) {}

    return fallback;
}

// ── Button handlers ───────────────────────────────────────────────────────────

async function handleLoadTranscript() {
    setBusy(true);
    setStatus("Cargando transcript...");
    appendLog("──────────────────────────");

    try {
        if (!ppro.Transcript || typeof ppro.Transcript.exportToJSON !== "function") {
            throw new Error("Transcript.exportToJSON no está disponible en este runtime UXP.");
        }

        const project = await ppro.Project.getActiveProject();
        if (!project) { throw new Error("No hay proyecto activo."); }

        const sequence = await project.getActiveSequence();
        if (!sequence) { throw new Error("No hay secuencia activa."); }

        // Detect canvas size
        const size = await detectCanvasSize(sequence);
        detectedCanvasWidth = size.width;
        detectedCanvasHeight = size.height;
        const canvasInfoEl = getEl("canvasInfo");
        if (canvasInfoEl) {
            canvasInfoEl.textContent = "Canvas detectado: " + detectedCanvasWidth + " × " + detectedCanvasHeight;
        }
        appendLog("Canvas: " + detectedCanvasWidth + "×" + detectedCanvasHeight);

        // Get project item for transcript
        let clipProjectItem = null;
        if (typeof sequence.getProjectItem === "function") {
            clipProjectItem = await sequence.getProjectItem();
        } else if (sequence.projectItem) {
            clipProjectItem = sequence.projectItem;
        }

        if (!clipProjectItem) {
            throw new Error("No se pudo obtener el ProjectItem. Selecciona la secuencia en el panel Proyecto e inténtalo de nuevo.");
        }

        const castItem = ppro.ClipProjectItem ? ppro.ClipProjectItem.cast(clipProjectItem) : clipProjectItem;
        const rawJSON = await ppro.Transcript.exportToJSON(castItem);
        if (!rawJSON) { throw new Error("La secuencia no tiene transcript. Transcribe el audio primero."); }

        sequenceName = sanitizeFileName(castItem.name || "sequence");
        appendLog("Transcript cargado: " + sequenceName);

        let transcriptData;
        try { transcriptData = JSON.parse(rawJSON); }
        catch (e) { throw new Error("El transcript no es JSON válido."); }

        editorialResult = segmentTranscript(transcriptData);
        appendLog("Frases segmentadas: " + editorialResult.items.length);

        const badge = getEl("phraseCountBadge");
        if (badge) {
            badge.innerHTML = '<span class="badge">' + editorialResult.items.length + " frases</span>";
        }

        setStepNum("step1Num", "done");
        runLayoutPipeline();
        showStep(2);
        setStatus("Transcript cargado. " + editorialResult.items.length + " frases.", "ok");
    } catch (err) {
        setStatus("Error al cargar transcript.", "error");
        appendLog("ERROR: " + safeToString(err && err.message ? err.message : err));
    } finally {
        setBusy(false);
    }
}

async function handleBrowseMogrt() {
    try {
        const file = await localFileSystem.getFileForOpening({ allowMultiple: false, types: ["mogrt"] });
        if (!file) { return; }
        const el = getEl("mogrtPath");
        if (el) { el.value = file.nativePath; }
        await saveSettings();
        appendLog("MOGRT: " + file.nativePath);
    } catch (e) {
        appendLog("ERROR browse: " + safeToString(e && e.message ? e.message : e));
    }
}

async function handleApply() {
    if (!layoutResult || !layoutResult.items || !layoutResult.items.length) {
        setStatus("Genera el layout primero.", "error");
        return;
    }
    const mogrtPath = getInputValue("mogrtPath");
    if (!mogrtPath) {
        setStatus("Configura la ruta del MOGRT.", "error");
        return;
    }

    setBusy(true);
    setStatus("Inyectando MOGRTs...");
    appendLog("──────────────────────────");

    try {
        const result = await runMogrtInjection(layoutResult, mogrtPath, ppro);
        appendLog("Método: " + result.method);
        appendLog(result.result);
        setStatus("MOGRTs aplicados correctamente.", "ok");
        setStepNum("step3Num", "done");
        showStep(3);
    } catch (err) {
        setStatus("Error al inyectar.", "error");
        appendLog("ERROR: " + safeToString(err && err.message ? err.message : err));
    } finally {
        setBusy(false);
    }
}

async function handleExportJson() {
    if (!layoutResult) { return; }
    try {
        const file = await localFileSystem.getFileForSaving(sequenceName + " layout.json", { types: ["json"] });
        if (!file) { return; }
        await file.write(JSON.stringify(layoutResult, null, 2));
        appendLog("JSON exportado: " + file.nativePath);
        setStatus("Layout JSON exportado.", "ok");
    } catch (e) {
        appendLog("ERROR exportar JSON: " + safeToString(e && e.message ? e.message : e));
    }
}

function handleSettingsChange() {
    if (editorialResult && editorialResult.items && editorialResult.items.length) {
        runLayoutPipeline();
    }
    saveSettings();
}

// ── UI wiring ─────────────────────────────────────────────────────────────────

function bindUI() {
    if (uiBound) { return; }

    getEl("loadTranscriptBtn").addEventListener("click", handleLoadTranscript);
    getEl("browseMogrtBtn").addEventListener("click", handleBrowseMogrt);
    getEl("applyBtn").addEventListener("click", handleApply);
    getEl("exportJsonBtn").addEventListener("click", handleExportJson);

    // Nav item clicks
    [1, 2, 3].forEach((i) => {
        const nav = getEl("nav" + i);
        if (nav) { nav.addEventListener("click", () => showStep(i)); }
    });

    getEl("prevPhraseBtn").addEventListener("click", () => {
        if (previewIndex > 0) { previewIndex--; renderPreview(); refreshButtons(); }
    });

    getEl("nextPhraseBtn").addEventListener("click", () => {
        if (layoutResult && previewIndex < layoutResult.items.length - 1) {
            previewIndex++;
            renderPreview();
            refreshButtons();
        }
    });

    ["primaryFontFamily", "accentFontFamily",
        "verticalSpacingAdjustmentPx", "wordSpacingAdjustmentPx", "seed"].forEach((id) => {
        const el = getEl(id);
        if (el) { el.addEventListener("change", handleSettingsChange); }
    });

    getEl("mogrtPath").addEventListener("change", saveSettings);

    uiBound = true;
    appendLog("Panel listo.");
}

// ── Entrypoints ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    bindUI();
    await loadSettings();
    setStatus("Listo.");
});

entrypoints.setup({
    plugin: {
        create() { console.log("Parter Subtitles plugin created."); }
    },
    panels: {
        parterSubtitlesPanel: {
            create() { bindUI(); },
            show() { bindUI(); setStatus("Listo."); }
        }
    }
});
