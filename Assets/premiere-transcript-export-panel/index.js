const { entrypoints, storage } = require("uxp");
const app = require("premierepro");
const { generateLayoutsFromRawInput } = require("./src/layoutPipeline");

const { localFileSystem } = storage;
const TXT_EXPORT_MAX_WORDS = 4;
const TXT_EXPORT_MAX_CHARS = 28;
const TXT_EXPORT_MAX_DURATION = 1.75;
const TXT_EXPORT_MIN_WORDS = 2;
const DEFAULT_EXPORT_FPS = 25;
let uiBound = false;
let latestLayoutJSON = "";
let latestSequenceName = "layout";

function safeToString(value) {
    try {
        if (value === undefined) {
            return "undefined";
        }
        if (value === null) {
            return "null";
        }
        return String(value);
    } catch (error) {
        return "[toString error]";
    }
}

function sanitizeFileName(value) {
    return String(value || "sequence")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .replace(/^\.+|\.+$/g, "")
        .trim() || "sequence";
}

function parseTranscriptJSONString(jsonString) {
    let parsed;

    try {
        parsed = JSON.parse(jsonString);
    } catch (error) {
        throw new Error("El transcript exportado no es JSON válido.");
    }

    if (!parsed || !Array.isArray(parsed.segments)) {
        throw new Error("El transcript exportado no contiene segments[].");
    }

    return parsed;
}

function normalizeSentenceText(text) {
    return String(text || "")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .replace(/\s+/g, " ")
        .trim();
}

function extractFrameRateValue(frameRate) {
    let fps = null;

    if (typeof frameRate === "number") {
        fps = Number(frameRate);
    } else if (frameRate && frameRate.framesPerSecond !== undefined) {
        fps = Number(frameRate.framesPerSecond);
    } else if (frameRate && frameRate.value !== undefined) {
        fps = Number(frameRate.value);
    } else if (frameRate && frameRate.numerator !== undefined && frameRate.denominator !== undefined) {
        fps = Number(frameRate.numerator) / Number(frameRate.denominator);
    } else if (frameRate && frameRate.num !== undefined && frameRate.den !== undefined) {
        fps = Number(frameRate.num) / Number(frameRate.den);
    }

    if (!fps || isNaN(fps) || fps <= 0) {
        return null;
    }

    return fps;
}

async function detectSequenceFPS(sequence) {
    let settings;
    let frameRate;
    let fps;

    try {
        if (sequence && typeof sequence.getSettings === "function") {
            settings = await sequence.getSettings();
            if (settings && typeof settings.getVideoFrameRate === "function") {
                frameRate = await settings.getVideoFrameRate();
                fps = extractFrameRateValue(frameRate);
                if (fps) {
                    return { fps: fps, source: "sequence.getSettings().getVideoFrameRate()" };
                }
            }
        }
    } catch (error) {}

    try {
        fps = extractFrameRateValue(sequence && sequence.frameRate);
        if (fps) {
            return { fps: fps, source: "sequence.frameRate" };
        }
    } catch (error2) {}

    try {
        fps = Number(sequence && sequence.timebase);
        if (fps && !isNaN(fps) && fps > 0 && fps <= 120) {
            return { fps: fps, source: "sequence.timebase" };
        }
    } catch (error3) {}

    return { fps: DEFAULT_EXPORT_FPS, source: "fallback" };
}

function buildSentenceGroups(transcriptData) {
    const sentences = [];
    let pendingWords = [];
    let sentenceStart = null;
    let sentenceEnd = null;
    let sentenceSpeaker = "";
    let sentenceLanguage = "";

    function flushSentence() {
        const text = normalizeSentenceText(pendingWords.map(function (word) {
            return word.text;
        }).join(" "));

        if (!pendingWords.length || !text) {
            pendingWords = [];
            sentenceStart = null;
            sentenceEnd = null;
            sentenceSpeaker = "";
            sentenceLanguage = "";
            return;
        }

        sentences.push({
            index: sentences.length + 1,
            start: sentenceStart,
            end: sentenceEnd,
            duration: Number(sentenceEnd) - Number(sentenceStart),
            speaker: sentenceSpeaker,
            language: sentenceLanguage,
            wordCount: pendingWords.length,
            text: text,
            words: pendingWords.slice(0)
        });

        pendingWords = [];
        sentenceStart = null;
        sentenceEnd = null;
        sentenceSpeaker = "";
        sentenceLanguage = "";
    }

    for (const segment of transcriptData.segments) {
        const words = segment && Array.isArray(segment.words) ? segment.words : [];
        const segmentSpeaker = segment && segment.speaker ? segment.speaker : "";
        const segmentLanguage = segment && segment.language ? segment.language : transcriptData.language || "";

        for (const word of words) {
            let wordStart;
            let wordDuration;
            let wordEnd;

            if (!word || word.type !== "word" || !word.text) {
                continue;
            }

            wordStart = Number(word.start);
            wordDuration = Number(word.duration);

            if (isNaN(wordStart)) {
                continue;
            }

            if (isNaN(wordDuration) || wordDuration < 0) {
                wordDuration = 0;
            }

            wordEnd = wordStart + wordDuration;

            if (!pendingWords.length) {
                sentenceStart = wordStart;
                sentenceSpeaker = segmentSpeaker;
                sentenceLanguage = segmentLanguage;
            }

            pendingWords.push({
                text: String(word.text),
                start: wordStart,
                end: wordEnd,
                duration: wordDuration,
                eos: !!word.eos,
                confidence: word.confidence
            });

            sentenceEnd = wordEnd;

            if (word.eos) {
                flushSentence();
            }
        }
    }

    flushSentence();

    return {
        language: transcriptData.language || "",
        speakers: Array.isArray(transcriptData.speakers) ? transcriptData.speakers : [],
        sourceSegmentCount: transcriptData.segments.length,
        sentenceCount: sentences.length,
        sentences: sentences
    };
}

function flattenTranscriptWords(transcriptData) {
    const words = [];

    for (const segment of transcriptData.segments) {
        const segmentWords = segment && Array.isArray(segment.words) ? segment.words : [];

        for (const word of segmentWords) {
            let start;
            let duration;

            if (!word || word.type !== "word" || !word.text) {
                continue;
            }

            start = Number(word.start);
            duration = Number(word.duration);

            if (isNaN(start)) {
                continue;
            }

            if (isNaN(duration) || duration < 0) {
                duration = 0;
            }

            words.push({
                text: String(word.text),
                start: start,
                duration: duration,
                end: start + duration,
                eos: !!word.eos
            });
        }
    }

    return words;
}

function buildCaptionLikeTextBlocks(transcriptData) {
    const words = flattenTranscriptWords(transcriptData);
    const blocks = [];
    let currentWords = [];
    let currentStart = null;
    let currentEnd = null;

    function flushBlock() {
        const text = normalizeSentenceText(currentWords.map(function (word) {
            return word.text;
        }).join(" "));

        if (!currentWords.length || !text) {
            currentWords = [];
            currentStart = null;
            currentEnd = null;
            return;
        }

        blocks.push({
            index: blocks.length + 1,
            start: currentStart,
            end: currentEnd,
            text: text,
            words: currentWords.slice(0)
        });

        currentWords = [];
        currentStart = null;
        currentEnd = null;
    }

    for (const word of words) {
        let proposedWords;
        let proposedText;
        let proposedDuration;
        let shouldSplitBeforeWord = false;

        if (!currentWords.length) {
            currentStart = word.start;
        }

        proposedWords = currentWords.concat([word]);
        proposedText = normalizeSentenceText(proposedWords.map(function (item) {
            return item.text;
        }).join(" "));
        proposedDuration = word.end - currentStart;

        if (
            currentWords.length >= TXT_EXPORT_MIN_WORDS &&
            (
                proposedWords.length > TXT_EXPORT_MAX_WORDS ||
                proposedText.length > TXT_EXPORT_MAX_CHARS ||
                proposedDuration > TXT_EXPORT_MAX_DURATION
            )
        ) {
            shouldSplitBeforeWord = true;
        }

        if (shouldSplitBeforeWord) {
            flushBlock();
            currentStart = word.start;
        }

        currentWords.push(word);
        currentEnd = word.end;

        if (word.eos) {
            flushBlock();
        }
    }

    flushBlock();

    for (let i = 0; i < blocks.length - 1; i++) {
        blocks[i].displayEnd = blocks[i + 1].start;
    }

    if (blocks.length) {
        blocks[blocks.length - 1].displayEnd = blocks[blocks.length - 1].end;
    }

    return blocks;
}

function padTimecodePart(value, width) {
    const text = String(Math.max(0, Math.floor(value)));
    if (text.length >= width) {
        return text;
    }
    return new Array(width - text.length + 1).join("0") + text;
}

function secondsToFrameTimecode(secondsValue, fps) {
    const safeValue = Math.max(0, Number(secondsValue) || 0);
    const safeFPS = Math.max(1, Math.round(Number(fps) || DEFAULT_EXPORT_FPS));
    const totalFrames = Math.floor((safeValue * safeFPS) + 0.000001);
    const hours = Math.floor(totalFrames / (safeFPS * 3600));
    const minutes = Math.floor((totalFrames % (safeFPS * 3600)) / (safeFPS * 60));
    const seconds = Math.floor((totalFrames % (safeFPS * 60)) / safeFPS);
    const frames = totalFrames % safeFPS;

    return [
        padTimecodePart(hours, 2),
        padTimecodePart(minutes, 2),
        padTimecodePart(seconds, 2),
        padTimecodePart(frames, 2)
    ].join(":");
}

function buildTXTFromBlocks(blocks, fps) {
    const lines = [];

    for (const block of blocks) {
        lines.push(secondsToFrameTimecode(block.start, fps) + " - " + secondsToFrameTimecode(block.displayEnd, fps));
        lines.push(block.text);
        lines.push("");
    }

    return lines.join("\n");
}

async function writeFileInFolder(folder, fileName, content) {
    const file = await folder.createFile(fileName, { overwrite: true });
    await file.write(content);
    return file;
}

function getEl(id) {
    return document.getElementById(id);
}

function getInputValue(id) {
    const element = getEl(id);
    return element ? element.value : "";
}

function bindUI() {
    if (uiBound) {
        return;
    }

    getEl("loadTranscriptBtn").addEventListener("click", function () {
        loadActiveTranscriptIntoInput();
    });

    getEl("exportTranscriptBtn").addEventListener("click", function () {
        exportTranscriptArtifacts();
    });

    getEl("generateLayoutBtn").addEventListener("click", function () {
        generateLayoutJSON();
    });

    getEl("exportLayoutBtn").addEventListener("click", function () {
        exportLayoutJSON();
    });

    uiBound = true;
    appendLog("Panel listo.");
}

function appendLog(message) {
    const logEl = getEl("log");
    if (!logEl) {
        return;
    }

    logEl.textContent += "[parter_panel] " + message + "\n";
    logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(message) {
    const statusEl = getEl("status");
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function setBusy(busy) {
    ["loadTranscriptBtn", "exportTranscriptBtn", "generateLayoutBtn", "exportLayoutBtn"].forEach(function (id) {
        const button = getEl(id);
        if (button) {
            button.disabled = !!busy;
        }
    });
}

async function getActiveSequenceContext() {
    const project = await app.Project.getActiveProject();
    let sequence;
    let projectItem = null;

    if (!project) {
        throw new Error("No hay proyecto activo.");
    }

    appendLog("Proyecto activo: " + safeToString(project.name));

    sequence = await project.getActiveSequence();
    if (!sequence) {
        throw new Error("No hay secuencia activa.");
    }

    appendLog("Secuencia activa detectada.");

    if (typeof sequence.getProjectItem === "function") {
        projectItem = await sequence.getProjectItem();
        appendLog("sequence.getProjectItem() ejecutado.");
    } else if (sequence.projectItem) {
        projectItem = sequence.projectItem;
        appendLog("Se usó sequence.projectItem como fallback.");
    }

    if (!projectItem && app.ProjectUtils && typeof app.ProjectUtils.getSelection === "function") {
        const selection = await app.ProjectUtils.getSelection(project);
        const selectedItems = selection && typeof selection.getItems === "function"
            ? await selection.getItems()
            : [];

        appendLog("Fallback Project panel selection count=" + selectedItems.length);

        for (const selectedItem of selectedItems) {
            let selectedClipProjectItem = null;

            try {
                selectedClipProjectItem = app.ClipProjectItem.cast(selectedItem);
            } catch (error) {
                selectedClipProjectItem = null;
            }

            if (!selectedClipProjectItem || typeof selectedClipProjectItem.isSequence !== "function") {
                continue;
            }

            if (await selectedClipProjectItem.isSequence()) {
                projectItem = selectedItem;
                appendLog("Se usó la secuencia seleccionada en Project panel como fallback.");
                break;
            }
        }
    }

    if (!projectItem) {
        throw new Error("No se pudo obtener el ProjectItem de la secuencia activa. Si el fallo persiste, selecciona esa secuencia en el Project panel y vuelve a intentarlo.");
    }

    appendLog("ProjectItem detectado: " + safeToString(projectItem.name));

    if (!app.ClipProjectItem || typeof app.ClipProjectItem.cast !== "function") {
        throw new Error("ClipProjectItem.cast no está disponible.");
    }

    return {
        sequence: sequence,
        clipProjectItem: app.ClipProjectItem.cast(projectItem)
    };
}

async function exportTranscriptJSON() {
    let context;
    let jsonString;

    if (!app.Transcript || typeof app.Transcript.exportToJSON !== "function") {
        throw new Error("Transcript.exportToJSON no está disponible en este runtime UXP.");
    }

    context = await getActiveSequenceContext();
    jsonString = await app.Transcript.exportToJSON(context.clipProjectItem);

    appendLog("Transcript.exportToJSON ejecutado.");

    if (!jsonString) {
        throw new Error("La secuencia no devolvió transcript JSON.");
    }

    latestSequenceName = sanitizeFileName(context.clipProjectItem.name);

    return {
        sequence: context.sequence,
        clipProjectItem: context.clipProjectItem,
        jsonString: jsonString
    };
}

async function buildTranscriptArtifacts() {
    const transcriptExport = await exportTranscriptJSON();
    const transcriptJSON = transcriptExport.jsonString;
    const transcriptData = parseTranscriptJSONString(transcriptJSON);
    const sentenceData = buildSentenceGroups(transcriptData);
    const textBlocks = buildCaptionLikeTextBlocks(transcriptData);
    const fpsInfo = await detectSequenceFPS(transcriptExport.sequence);
    const txtText = buildTXTFromBlocks(textBlocks, fpsInfo.fps);

    appendLog("Sentencias derivadas desde transcript: " + sentenceData.sentenceCount);
    appendLog("Bloques TXT derivados desde transcript: " + textBlocks.length);
    appendLog("FPS usado para TXT: " + safeToString(fpsInfo.fps) + " (" + fpsInfo.source + ")");

    return {
        sequence: transcriptExport.sequence,
        clipProjectItem: transcriptExport.clipProjectItem,
        transcriptJSON: transcriptJSON,
        sentenceData: sentenceData,
        txtText: txtText
    };
}

async function loadActiveTranscriptIntoInput() {
    setBusy(true);
    setStatus("Cargando transcript activo...");
    appendLog("--------------------------------------");

    try {
        const artifacts = await buildTranscriptArtifacts();
        getEl("inputText").value = artifacts.txtText;
        setStatus("Transcript cargado en el input.");
        appendLog("TXT cargado en el panel.");
    } catch (error) {
        setStatus("Error.");
        appendLog("ERROR: " + safeToString(error && error.message ? error.message : error));
    } finally {
        setBusy(false);
    }
}

async function exportTranscriptArtifacts() {
    setBusy(true);
    setStatus("Exportando transcript...");
    appendLog("--------------------------------------");

    try {
        const artifacts = await buildTranscriptArtifacts();
        const folder = await localFileSystem.getFolder();
        let rawFile;
        let sentencesFile;
        let txtFile;

        if (!folder) {
            throw new Error("La exportación fue cancelada por el usuario.");
        }

        rawFile = await writeFileInFolder(folder, latestSequenceName + " transcript.json", artifacts.transcriptJSON);
        sentencesFile = await writeFileInFolder(folder, latestSequenceName + " transcript sentences.json", JSON.stringify(artifacts.sentenceData, null, 2));
        txtFile = await writeFileInFolder(folder, latestSequenceName + ".txt", artifacts.txtText);

        appendLog("Archivo guardado: " + safeToString(rawFile.nativePath));
        appendLog("Archivo guardado: " + safeToString(sentencesFile.nativePath));
        appendLog("Archivo guardado: " + safeToString(txtFile.nativePath));
        setStatus("Transcript exportado.");
    } catch (error) {
        setStatus("Error.");
        appendLog("ERROR: " + safeToString(error && error.message ? error.message : error));
    } finally {
        setBusy(false);
    }
}

function generateLayoutJSON() {
    let result;

    setBusy(true);
    setStatus("Generando layout JSON...");
    appendLog("--------------------------------------");

    try {
        result = generateLayoutsFromRawInput({
            document: document,
            rawText: getInputValue("inputText"),
            primaryFontFamily: getInputValue("primaryFontFamily"),
            accentFontFamily: getInputValue("accentFontFamily"),
            canvasWidth: getInputValue("canvasWidth"),
            canvasHeight: getInputValue("canvasHeight"),
            seed: getInputValue("seed"),
            verticalSpacingAdjustmentPx: getInputValue("verticalSpacingAdjustmentPx")
        });

        latestLayoutJSON = result.batchJSON;
        getEl("jsonPreview").value = result.batchJSON;
        setStatus("Layout generado.");
        appendLog("Frases procesadas: " + result.entries.length);
    } catch (error) {
        setStatus("Error.");
        appendLog("ERROR: " + safeToString(error && error.message ? error.message : error));
    } finally {
        setBusy(false);
    }
}

async function exportLayoutJSON() {
    let file;

    if (!latestLayoutJSON) {
        generateLayoutJSON();
    }

    if (!latestLayoutJSON) {
        return;
    }

    setBusy(true);
    setStatus("Exportando layout JSON...");

    try {
        file = await localFileSystem.getFileForSaving(latestSequenceName + " layout.json", { types: ["json"] });
        if (!file) {
            throw new Error("La exportación fue cancelada por el usuario.");
        }
        await file.write(latestLayoutJSON);
        appendLog("Layout JSON guardado: " + safeToString(file.nativePath));
        setStatus("Layout JSON exportado.");
    } catch (error) {
        setStatus("Error.");
        appendLog("ERROR: " + safeToString(error && error.message ? error.message : error));
    } finally {
        setBusy(false);
    }
}

document.addEventListener("DOMContentLoaded", function () {
    bindUI();
    setStatus("Listo.");
});

entrypoints.setup({
    plugin: {
        create() {
            console.log("Parter Subtitles plugin created.");
        }
    },
    panels: {
        transcriptExportPanel: {
            create() {
                bindUI();
            },
            show() {
                bindUI();
                setStatus("Listo.");
            }
        }
    }
});
