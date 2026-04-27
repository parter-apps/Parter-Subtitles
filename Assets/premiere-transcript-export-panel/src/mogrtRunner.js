"use strict";

// ── Word units from layout ────────────────────────────────────────────────────

function safeStr(v) {
    try { return String(v === null || v === undefined ? "" : v); } catch (e) { return ""; }
}

function buildWordUnits(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
        const layout = items[i];
        const words = layout.words || [];
        if (!words.length) { continue; }
        const totalDur = Number(layout.end) - Number(layout.start);
        const eachDur = words.length > 0 ? totalDur / words.length : 0.2;
        const effectiveEnd = (i + 1 < items.length)
            ? Number(items[i + 1].start)
            : Number(layout.end);
        for (let j = 0; j < words.length; j++) {
            const el = words[j];
            let startSec = Number(el.start);
            if (isNaN(startSec)) { startSec = Number(layout.start) + j * eachDur; }
            const endSec = (isNaN(effectiveEnd) || effectiveEnd <= startSec)
                ? startSec + (Number(el.duration) || eachDur)
                : effectiveEnd;
            out.push({
                phraseIndex: i, wordIndex: j,
                text: safeStr(el.text),
                startSeconds: startSec, endSeconds: endSec,
                x: Number(el.x), y: Number(el.y),
                fontFamily: safeStr(el.fontFamily),
                fontSize: Number(el.fontSize)
            });
        }
    }
    return out;
}

// ── Track helpers (UXP API) ───────────────────────────────────────────────────

function getVideoTrackCount(sequence) {
    try { return Number(sequence.getVideoTrackCount()); } catch (e) { return 0; }
}

function getTrack(sequence, index) {
    try { return sequence.getVideoTrack(index); } catch (e) { return null; }
}

function getTrackItems(track) {
    try {
        // trackItemType 1 = CLIP (most common enum value in Premiere)
        const items = track.getTrackItems(1, false);
        if (Array.isArray(items)) { return items; }
    } catch (e) {}
    try {
        const items = track.getTrackItems(0, false);
        if (Array.isArray(items)) { return items; }
    } catch (e) {}
    return [];
}

function getHighestOccupiedTrackIndex(sequence) {
    const count = getVideoTrackCount(sequence);
    for (let i = count - 1; i >= 0; i--) {
        try {
            const track = getTrack(sequence, i);
            if (track && getTrackItems(track).length > 0) { return i; }
        } catch (e) {}
    }
    return -1;
}

function getCanvasSize(sequence) {
    try {
        const r = sequence.getFrameSize();
        const w = (r.right - r.left) || r.width || 1920;
        const h = (r.bottom - r.top) || r.height || 1080;
        if (w > 0 && h > 0) { return { width: w, height: h }; }
    } catch (e) {}
    try {
        const w = Number(sequence.frameSizeHorizontal);
        const h = Number(sequence.frameSizeVertical);
        if (w > 0 && h > 0) { return { width: w, height: h }; }
    } catch (e) {}
    return { width: 1920, height: 1080 };
}

// ── Clip property helpers ─────────────────────────────────────────────────────

async function findTextAndPositionParams(videoClip) {
    let textParam = null;
    let positionParam = null;

    let chain;
    try { chain = videoClip.getComponentChain(); } catch (e) { return { textParam, positionParam }; }

    let compCount = 0;
    try { compCount = Number(chain.getComponentCount()); } catch (e) {}

    for (let ci = 0; ci < compCount && (!textParam || !positionParam); ci++) {
        let comp;
        try { comp = chain.getComponentAtIndex(ci); } catch (e) { continue; }
        if (!comp) { continue; }

        let paramCount = 0;
        try { paramCount = Number(await comp.getParamCount()); } catch (e) {}

        for (let pi = 0; pi < paramCount; pi++) {
            let param;
            try { param = await comp.getParam(pi); } catch (e) { continue; }
            if (!param) { continue; }

            const dn = safeStr(param.displayName).toLowerCase();

            if (!textParam && (dn.includes("text") || dn.includes("texto"))) {
                textParam = param;
            } else if (!positionParam && (dn === "position" || dn === "posición" || dn === "posicion")) {
                positionParam = param;
            }
        }
    }
    return { textParam, positionParam };
}

async function setParamValue(project, param, value) {
    try {
        const keyframe = param.createKeyframe(value);
        await project.executeTransaction((compound) => {
            compound.addAction(param.createSetValueAction(keyframe, true));
        }, "Parter: set param");
    } catch (e) {
        throw new Error("setParamValue failed: " + (e.message || e));
    }
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function runMogrtInjection(layoutResult, mogrtPath, ppro) {
    if (!layoutResult || !Array.isArray(layoutResult.items) || !layoutResult.items.length) {
        throw new Error("No hay layouts generados. Carga el transcript primero.");
    }
    if (!mogrtPath) {
        throw new Error("No se ha configurado la ruta del MOGRT.");
    }

    const project = await ppro.Project.getActiveProject();
    if (!project) { throw new Error("No hay proyecto activo."); }

    const sequence = await project.getActiveSequence();
    if (!sequence) { throw new Error("No hay secuencia activa."); }

    const wordUnits = buildWordUnits(layoutResult.items);
    if (!wordUnits.length) { throw new Error("No hay palabras en el layout."); }

    // SequenceEditor is the correct UXP API for MOGRT insertion
    const editor = ppro.SequenceEditor.getEditor(sequence);
    if (!editor) { throw new Error("SequenceEditor no disponible. Verifica que el plugin tiene acceso a la API de secuencias."); }

    const canvas = getCanvasSize(sequence);
    const highestOccupied = getHighestOccupiedTrackIndex(sequence);
    const baseTrackIndex = highestOccupied + 1;

    let created = 0;
    const errors = [];

    for (const unit of wordUnits) {
        const trackIndex = baseTrackIndex + unit.wordIndex;
        try {
            // Insert MOGRT — returns (VideoClipTrackItem | AudioClipTrackItem)[]
            const startTime = ppro.TickTime.createWithSeconds(unit.startSeconds);
            const clips = await editor.insertMogrtFromPath(mogrtPath, startTime, trackIndex, -1);
            if (!clips || !clips.length) { throw new Error("insertMogrtFromPath returned empty"); }

            // First element is always the video clip when audioTrackIndex is -1
            const videoClip = clips[0];

            // Trim clip end
            const endTime = ppro.TickTime.createWithSeconds(unit.endSeconds);
            await project.executeTransaction((compound) => {
                compound.addAction(videoClip.createSetEndAction(endTime));
            }, "Parter: trim");

            // Set text and position via component params
            const { textParam, positionParam } = await findTextAndPositionParams(videoClip);

            if (textParam) {
                await setParamValue(project, textParam, unit.text);
            } else {
                errors.push("layout=" + unit.phraseIndex + " word=" + unit.wordIndex + ' "' + unit.text + '": text param not found');
            }

            if (positionParam) {
                // Position is normalized [0,1] in Premiere's coordinate system
                await setParamValue(project, positionParam, { x: unit.x / canvas.width, y: unit.y / canvas.height });
            }
            // Position not found is non-fatal (some MOGRTs don't expose position as a param)

            created++;
        } catch (e) {
            errors.push(
                "layout=" + unit.phraseIndex + " word=" + unit.wordIndex +
                ' "' + unit.text + '": ' + (e.message || String(e))
            );
        }
    }

    const summary = "Instancias creadas: " + created + " / " + wordUnits.length;
    return {
        method: "uxp-native",
        result: summary + (errors.length ? "\nErrores:\n" + errors.join("\n") : "")
    };
}

module.exports = { runMogrtInjection };
