// Per-character advance widths as a fraction of em, for Spanish text.
// Derived from Montserrat Bold metrics. Used when canvas measureText is unavailable.
const MONTSERRAT_W = {
    a:0.56,b:0.57,c:0.50,d:0.57,e:0.56,f:0.33,g:0.57,h:0.57,i:0.25,j:0.25,
    k:0.52,l:0.25,m:0.84,n:0.57,o:0.58,p:0.57,q:0.57,r:0.38,s:0.49,t:0.39,
    u:0.57,v:0.53,w:0.75,x:0.53,y:0.53,z:0.49,
    A:0.63,B:0.59,C:0.60,D:0.64,E:0.52,F:0.50,G:0.63,H:0.64,I:0.28,J:0.37,
    K:0.60,L:0.50,M:0.71,N:0.64,O:0.68,P:0.57,Q:0.68,R:0.60,S:0.52,T:0.55,
    U:0.63,V:0.61,W:0.86,X:0.61,Y:0.57,Z:0.57,
    "\u00e1":0.56,"\u00e9":0.56,"\u00ed":0.25,"\u00f3":0.58,"\u00fa":0.57,
    "\u00fc":0.57,"\u00f1":0.57,"\u00c1":0.63,"\u00c9":0.52,"\u00cd":0.28,
    "\u00d3":0.68,"\u00da":0.63,"\u00dc":0.63,"\u00d1":0.64,
    " ":0.26,",":0.27,".":0.27,"!":0.28,"?":0.47,"-":0.37,":":0.27,";":0.27,
    "\u2019":0.28,"\u201c":0.39,"\u201d":0.39
};

function charWidth(ch, table, fallback) {
    return table[ch] !== undefined ? table[ch] : fallback;
}

function estimateWidth(str, table, avgRatio, fontSize) {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        w += charWidth(str[i], table, avgRatio) * fontSize;
    }
    return Math.ceil(w) + 2;
}

class TextMeasurer {
    constructor(documentRef) {
        this.document = documentRef;
        this.ctx = null; // null = untested, false = failed, object = working
    }

    ensureCtx() {
        if (this.ctx !== null) { return; }
        this.ctx = false;
        if (!this.document || !this.document.body) { return; }
        try {
            const el = this.document.createElement("canvas");
            el.width = 512;
            el.height = 128;
            el.style.cssText = "position:absolute;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none";
            this.document.body.appendChild(el);
            const ctx = el.getContext("2d");
            if (!ctx) { return; }
            // Verify canvas text measurement actually works in this environment
            ctx.font = "700 20px Arial";
            const t = ctx.measureText("M");
            if (t && t.width > 1) { this.ctx = ctx; }
        } catch (e) {}
    }

    // Returns { width, ascent, descent, height }
    // ascent  = ink above baseline (positive)
    // descent = ink below baseline (positive magnitude)
    // height  = ascent + descent (backward compat for LayoutEngine)
    measure(text, fontFamily, fontSize, fontWeight) {
        const str = String(text || "");
        const size = Number(fontSize || 16);
        const weight = String(fontWeight || 400);
        const family = String(fontFamily || "Arial").replace(/"/g, "");

        this.ensureCtx();

        if (this.ctx) {
            try {
                this.ctx.font = weight + " " + size + "px " + family;
                const m = this.ctx.measureText(str);
                if (m.width > 0) {
                    const asc = m.actualBoundingBoxAscent || 0;
                    const dsc = m.actualBoundingBoxDescent || 0;
                    const h = (asc + dsc) > 0 ? Math.ceil(asc + dsc) + 2 : Math.ceil(size * 0.72) + 2;
                    return { width: Math.ceil(m.width) + 2, ascent: asc, descent: dsc, height: h };
                }
                // Font not found in canvas; fall back to Arial with scale
                this.ctx.font = weight + " " + size + "px Arial";
                const mf = this.ctx.measureText(str);
                if (mf.width > 0) {
                    const scale = this.fontWidthScale(family);
                    const asc = mf.actualBoundingBoxAscent || 0;
                    const dsc = mf.actualBoundingBoxDescent || 0;
                    const h = (asc + dsc) > 0 ? Math.ceil(asc + dsc) + 2 : Math.ceil(size * 0.72) + 2;
                    return { width: Math.ceil(mf.width * scale) + 2, ascent: asc, descent: dsc, height: h };
                }
            } catch (e) {}
        }

        return this.estimate(str, family, size);
    }

    fontWidthScale(family) {
        if (/montserrat/i.test(family)) { return 1.02; }
        if (/garamond|palatino|didot|hoefler/i.test(family)) { return 0.75; }
        if (/baskerville|times/i.test(family)) { return 0.82; }
        if (/georgia/i.test(family)) { return 0.97; }
        if (/avenir/i.test(family)) { return 1.0; }
        if (/futura/i.test(family)) { return 0.93; }
        return 1.0;
    }

    estimate(str, family, size) {
        const isSerif = /garamond|times|georgia|baskerville|palatino|didot|hoefler/i.test(family);
        const wRatio = isSerif ? 0.42 : 0.60;
        // Ascent: cap-height if caps or ascending lowercase (b d f h i j k l t), else x-height
        const hasAscenders = /[A-ZÁÉÍÓÚÑ]|[bdfhklt]/.test(str);
        const asc = (hasAscenders ? 0.72 : 0.50) * size;
        // Descent: only for letters that descend below baseline
        const dsc = /[gjpqy]/.test(str) ? 0.20 * size : 0.02 * size;
        return {
            width: Math.ceil(str.length * size * wRatio) + 2,
            ascent: asc,
            descent: dsc,
            height: Math.ceil(asc + dsc) + 2
        };
    }
}

const CONNECTORS = new Set([
    "a", "al", "ante", "bajo", "con", "contra", "de", "del", "desde", "el", "la", "los", "las",
    "en", "entre", "hacia", "hasta", "para", "por", "sin", "sobre", "tras", "y", "o", "u",
    "un", "una", "unos", "unas", "que", "mas", "más"
]);

function cleanText(text) {
    return String(text || "")
        .replace(/\u2019/g, "'")
        .replace(/\u2018/g, "'")
        .replace(/\u00B4/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeForLookup(token) {
    return String(token || "")
        .toLowerCase()
        .replace(/\u2019/g, "'")
        .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

function parsePhrase(phrase) {
    const cleaned = cleanText(phrase);
    const rawWords = cleaned ? cleaned.split(/\s+/) : [];
    const tokens = rawWords.map(function (token, index) {
        const normalized = normalizeForLookup(token);
        return {
            text: token,
            normalized: normalized,
            index: index,
            isConnector: CONNECTORS.has(normalized),
            length: normalized.length
        };
    });

    return {
        cleanedText: cleaned,
        tokens: tokens,
        blocks: tokens.map(function (token) {
            return {
                text: token.text,
                tokenIndexes: [token.index],
                averageLength: token.length,
                longestToken: token.length,
                connectorCount: token.isConnector ? 1 : 0
            };
        })
    };
}

function automaticLineCount(wordCount) {
    if (wordCount <= 2) {
        return 1;
    }
    if (wordCount <= 4) {
        return 2;
    }
    return 3;
}

function extractPhraseEntries(raw) {
    const lines = String(raw || "")
        .split(/\r?\n/)
        .map(function (line) { return line.trim(); });
    const entries = [];
    let currentTimecode = null;

    for (const line of lines) {
        let phrases;

        if (!line) {
            continue;
        }

        if (/^\d{2}:\d{2}:\d{2}:\d{2}\s*-\s*\d{2}:\d{2}:\d{2}:\d{2}$/.test(line)) {
            currentTimecode = line;
            continue;
        }

        phrases = line
            .split(/[.!?]/)
            .map(function (part) { return part.trim(); })
            .filter(Boolean);

        if (!phrases.length) {
            entries.push({ phrase: line, timecode: currentTimecode });
            continue;
        }

        for (const phrase of phrases) {
            entries.push({ phrase: phrase, timecode: currentTimecode });
        }
    }

    return entries;
}

class SeededRandom {
    constructor(seed) {
        this.state = seed === 0 ? 0xABCDEF12 : (seed || 0xABCDEF12);
    }

    nextUnit() {
        this.state = (this.state * 1664525 + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }

    next(rangeMin, rangeMax) {
        return rangeMin + (rangeMax - rangeMin) * this.nextUnit();
    }
}

class StyleEngine {
    constructor(measurer) {
        this.measurer = measurer;
    }

    style(parsed, fonts, canvas, seed, targetLineCount) {
        let random;
        let minDimension;
        let clampedLines;
        let baseScale;

        if (!parsed || !parsed.blocks || !parsed.blocks.length) {
            return [];
        }

        random = new SeededRandom(seed);
        minDimension = Math.min(canvas.width, canvas.height);
        clampedLines = Math.min(Math.max(targetLineCount, 1), 3);

        switch (clampedLines) {
        case 1:
            baseScale = 0.17;
            break;
        case 2:
            baseScale = 0.135;
            break;
        default:
            baseScale = 0.11;
            break;
        }

        return parsed.blocks.map((block) => {
            const connectorAdjustment = block.connectorCount > 0 ? 0.85 : 1.0;
            const jitter = random.next(-0.006, 0.006);
            const size = Math.max(20, (baseScale + jitter) * minDimension * connectorAdjustment);
            const style = {
                fontFamily: fonts.primaryFamily,
                fontSize: size,
                fontWeight: block.connectorCount > 0 ? 500 : 700,
                fill: "#111111",
                rotation: 0,
                opacity: 1
            };
            const measured = this.measurer.measure(
                block.text,
                style.fontFamily,
                style.fontSize,
                style.fontWeight
            );

            return {
                block: block,
                style: style,
                measuredSize: measured
            };
        });
    }
}

class LayoutEngine {
    constructor(measurer) {
        this.measurer = measurer;
    }

    compose(styledBlocks, canvas, fonts, seed, requestedLineCount, verticalSpacingAdjustmentPx, wordSpacingAdjustmentPx) {
        const lineCount = Math.min(Math.max(requestedLineCount, 1), 3);
        const spacingAdjustment = Number(verticalSpacingAdjustmentPx || 0);
        const minDimension = Math.min(canvas.width, canvas.height);
        const horizontalGap = Math.max(2, minDimension * 0.006 + Number(wordSpacingAdjustmentPx || 0));
        const topMargin = Math.max(20, minDimension * 0.12);
        const elements = [];
        let resolvedRows;
        let rowWidths;
        let globalWidth;
        let globalLeft;
        let cursorY;

        if (!styledBlocks || !styledBlocks.length) {
            return {
                canvas: canvas,
                background: "#E7E7E7",
                strategy: "reading_order_editorial",
                fonts: fonts,
                requestedLineCount: lineCount,
                verticalSpacingAdjustmentPx: spacingAdjustment,
                seed: seed,
                elements: []
            };
        }

        resolvedRows = this.collapseShortSingletonRows(this.partitionRows(styledBlocks, lineCount))
            .map((row, rowIndex, rows) => this.resolveRow(row, rowIndex, rows.length, fonts));

        if (resolvedRows.length === 3) {
            const topWidth = this.widthFor(resolvedRows[0], horizontalGap);
            const bottomWidth = this.widthFor(resolvedRows[2], horizontalGap);
            const targetMiddleWidth = Math.max(topWidth, bottomWidth);
            resolvedRows[1] = this.scaleRowToWidth(resolvedRows[1], targetMiddleWidth, horizontalGap);
        }

        rowWidths = resolvedRows.map((row) => this.widthFor(row, horizontalGap));
        globalWidth = rowWidths.length ? Math.max.apply(Math, rowWidths) : canvas.width * 0.6;
        globalLeft = Math.max(8, (canvas.width - globalWidth) / 2);
        cursorY = topMargin;

        resolvedRows.forEach((row, index) => {
            const rowWidth = rowWidths[index];
            const rowHeight = row.reduce((max, item) => Math.max(max, item.size.height), 0);
            let rowX;
            let cursorX;

            if (!row.length) {
                return;
            }

            if (resolvedRows.length === 1) {
                rowX = globalLeft + (globalWidth - rowWidth) / 2;
            } else if (index === 0) {
                rowX = globalLeft;
            } else if (index === resolvedRows.length - 1) {
                rowX = globalLeft + (globalWidth - rowWidth);
            } else {
                rowX = globalLeft + (globalWidth - rowWidth) / 2;
            }

            cursorX = rowX;

            row.forEach((item) => {
                elements.push({
                    text: item.text,
                    x: cursorX,
                    y: cursorY,
                    width: item.size.width,
                    height: rowHeight,
                    fontFamily: item.fontFamily,
                    fontSize: item.fontSize,
                    fontWeight: item.fontWeight,
                    fill: item.fill,
                    rotation: 0,
                    opacity: item.opacity
                });
                cursorX += item.size.width + horizontalGap;
            });

            if (index < resolvedRows.length - 1) {
                const baseInterline = Math.max(2, minDimension * 0.002);
                const interline = Math.max(-rowHeight + 2, baseInterline + spacingAdjustment);
                cursorY += rowHeight + interline;
            }
        });

        return {
            canvas: canvas,
            background: "#E7E7E7",
            strategy: "reading_order_editorial",
            fonts: fonts,
            requestedLineCount: resolvedRows.length,
            verticalSpacingAdjustmentPx: spacingAdjustment,
            seed: seed,
            elements: elements
        };
    }

    partitionRows(blocks, lineCount) {
        let split;
        let splits;

        if (lineCount <= 1 || blocks.length <= 1) {
            return [blocks];
        }

        if (lineCount === 2) {
            split = this.chooseSplitForTwoLines(blocks);
            return [blocks.slice(0, split), blocks.slice(split)];
        }

        if (blocks.length === 2) {
            return [[blocks[0]], [blocks[1]]];
        }

        splits = this.chooseSplitsForThreeLines(blocks);
        return [blocks.slice(0, splits[0]), blocks.slice(splits[0], splits[1]), blocks.slice(splits[1])];
    }

    collapseShortSingletonRows(inputRows) {
        const rows = inputRows.map((row) => row.slice(0));
        let changed = true;

        while (changed) {
            changed = false;

            for (let i = 0; i < rows.length; i++) {
                const single = rows[i][0];

                if (rows[i].length !== 1 || !this.isShortSingleton(single)) {
                    continue;
                }

                if (rows.length === 2) {
                    if (i === 0) {
                        rows[1].unshift(single);
                    } else {
                        rows[0].push(single);
                    }
                    rows.splice(i, 1);
                    changed = true;
                    break;
                }

                if (i === 0) {
                    rows[1].unshift(single);
                    rows.splice(0, 1);
                } else if (i === rows.length - 1) {
                    rows[i - 1].push(single);
                    rows.splice(i, 1);
                } else {
                    rows[i - 1].push(single);
                    rows.splice(i, 1);
                }

                changed = true;
                break;
            }
        }

        return rows;
    }

    isShortSingleton(block) {
        const cleaned = String(block.block.text || "").replace(/[^0-9a-záéíóúüñ]/gi, "");
        return cleaned.length <= 3;
    }

    chooseSplitForTwoLines(blocks) {
        const candidates = [];

        if (blocks.length === 3) {
            return 2;
        }
        if (blocks.length === 4) {
            return 2;
        }

        for (let split = 1; split < blocks.length; split++) {
            if (!this.isValidBreak(split - 1, blocks)) {
                continue;
            }
            candidates.push({
                split: split,
                score: Math.abs(split - (blocks.length - split))
            });
        }

        if (!candidates.length) {
            return Math.max(1, Math.floor(blocks.length / 2));
        }

        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].split;
    }

    chooseSplitsForThreeLines(blocks) {
        const candidates = [];
        let fallbackA;
        let fallbackB;

        if (blocks.length === 5) {
            return [2, 3];
        }
        if (blocks.length === 6) {
            return [2, 4];
        }

        for (let a = 1; a < blocks.length - 1; a++) {
            for (let b = a + 1; b < blocks.length; b++) {
                const c1 = a;
                const c2 = b - a;
                const c3 = blocks.length - b;

                if (!this.isValidBreak(a - 1, blocks) || !this.isValidBreak(b - 1, blocks)) {
                    continue;
                }
                if (c2 > c1 || c2 > c3) {
                    continue;
                }

                candidates.push({
                    a: a,
                    b: b,
                    score: Math.abs(c1 - c3) + Math.abs(c1 - c2) + Math.abs(c3 - c2)
                });
            }
        }

        if (!candidates.length) {
            fallbackA = Math.max(1, Math.floor(blocks.length / 3));
            fallbackB = Math.max(fallbackA + 1, Math.min(blocks.length - 1, Math.floor((blocks.length * 2) / 3)));
            return [fallbackA, fallbackB];
        }

        candidates.sort((a, b) => a.score - b.score);
        return [candidates[0].a, candidates[0].b];
    }

    isValidBreak(index, blocks) {
        if (index < 0 || index + 1 >= blocks.length) {
            return false;
        }
        return !(blocks[index].block.connectorCount > 0 || blocks[index + 1].block.connectorCount > 0);
    }

    resolveRow(row, rowIndex, totalRows, fonts) {
        const rowBaseSize = row.reduce((sum, block) => sum + block.style.fontSize, 0) / Math.max(row.length, 1);
        const rowFontSize = rowBaseSize * this.sizeMultiplierFor(rowIndex, totalRows);
        const rowFontWeight = this.weightFor(rowIndex, totalRows);

        return row.map((block, index) => {
            const fontFamily = this.fontFor(rowIndex, totalRows, index, row.length, fonts);
            const measured = this.measurer.measure(
                block.block.text,
                fontFamily,
                rowFontSize,
                rowFontWeight
            );

            return {
                text: block.block.text,
                fontFamily: fontFamily,
                fontSize: rowFontSize,
                fontWeight: rowFontWeight,
                fill: block.style.fill,
                opacity: block.style.opacity,
                size: measured
            };
        });
    }

    weightFor(rowIndex, totalRows) {
        if (totalRows === 2) {
            return rowIndex === 0 ? 650 : 700;
        }
        if (totalRows === 3) {
            return rowIndex === 1 ? 550 : 700;
        }
        return 700;
    }

    scaleRowToWidth(row, targetWidth, horizontalGap) {
        const gapTotal = horizontalGap * Math.max(row.length - 1, 0);
        const currentTextWidth = row.reduce((sum, item) => sum + item.size.width, 0);
        const desiredTextWidth = Math.max(1, targetWidth - gapTotal);
        const scale = currentTextWidth > 0 ? desiredTextWidth / currentTextWidth : 1;

        return row.map((item) => {
            const newSize = item.fontSize * scale;
            const measured = this.measurer.measure(
                item.text,
                item.fontFamily,
                newSize,
                item.fontWeight
            );

            return {
                text: item.text,
                fontFamily: item.fontFamily,
                fontSize: newSize,
                fontWeight: item.fontWeight,
                fill: item.fill,
                opacity: item.opacity,
                size: measured
            };
        });
    }

    sizeMultiplierFor(rowIndex, totalRows) {
        if (totalRows === 2) {
            return rowIndex === 0 ? 0.86 : 1.16;
        }
        if (totalRows === 3) {
            return rowIndex === 1 ? 1.0 : 0.96;
        }
        return 1.0;
    }

    fontFor(rowIndex, totalRows, indexInRow, rowWordCount, fonts) {
        if (totalRows === 1) {
            if (rowWordCount === 2 && indexInRow === 1) {
                return fonts.accentFamily;
            }
            return fonts.primaryFamily;
        }
        if (totalRows === 2) {
            return rowIndex === 0 ? fonts.primaryFamily : fonts.accentFamily;
        }
        return rowIndex === 1 ? fonts.accentFamily : fonts.primaryFamily;
    }

    widthFor(row, horizontalGap) {
        return row.reduce((sum, item) => sum + item.size.width, 0) + horizontalGap * Math.max(row.length - 1, 0);
    }
}

function batchJSONString(entries, layouts) {
    return JSON.stringify({
        layouts: entries.map(function (entry, index) {
            const layout = layouts[index];
            return {
                phrase: entry.phrase,
                timecode: entry.timecode || null,
                background: layout.background,
                fonts: layout.fonts,
                elements: layout.elements
            };
        })
    }, null, 2);
}

function prettyJSONString(entry, layout) {
    return JSON.stringify({
        phrase: entry.phrase,
        timecode: entry.timecode || null,
        background: layout.background,
        fonts: layout.fonts,
        elements: layout.elements
    }, null, 2);
}

function generateLayoutsFromRawInput(options) {
    const rawText = options && options.rawText ? options.rawText : "";
    const entries = extractPhraseEntries(rawText);
    const measurer = new TextMeasurer(options.document);
    const styler = new StyleEngine(measurer);
    const layoutEngine = new LayoutEngine(measurer);
    const canvas = {
        width: Math.max(640, Number(options.canvasWidth || 1920)),
        height: Math.max(360, Number(options.canvasHeight || 1080))
    };
    const fonts = {
        primaryFamily: String(options.primaryFontFamily || "Montserrat").trim() || "Montserrat",
        accentFamily: String(options.accentFontFamily || "AppleGaramond-Italic").trim() || "AppleGaramond-Italic"
    };
    const seed = Number(options.seed || 42);
    const verticalSpacingAdjustmentPx = Number(options.verticalSpacingAdjustmentPx || -30);
    const layouts = [];

    if (!entries.length) {
        return {
            entries: [],
            layouts: [],
            previewJSON: "{}",
            batchJSON: JSON.stringify({ layouts: [] }, null, 2)
        };
    }

    entries.forEach((entry, index) => {
        const parsed = parsePhrase(entry.phrase);
        const lineCount = automaticLineCount(parsed.tokens.length);
        const styled = styler.style(parsed, fonts, canvas, seed + (index * 997), lineCount);
        const layout = layoutEngine.compose(styled, canvas, fonts, seed + index, lineCount, verticalSpacingAdjustmentPx);
        layouts.push(layout);
    });

    return {
        entries: entries,
        layouts: layouts,
        previewJSON: prettyJSONString(entries[0], layouts[0]),
        batchJSON: batchJSONString(entries, layouts)
    };
}

// Lays out a single editorial item using the roles/line assignments already determined
// by the editorial segmenter. Matches Swift LayoutEngine positioning exactly:
//   - Primary size: minDimension * 0.095 * 0.7
//   - Accent size: scaled so cap-height of accent = 2× cap-height of primary
//   - First row bottom anchored at canvas.height * 0.615
//   - Row X: first=left-aligned, last=right-aligned, middle/single=centered
function composeFromEditorialWords(item, canvas, fonts, verticalSpacingAdjustmentPx, wordSpacingAdjustmentPx, measurer) {
    const words = Array.isArray(item.words) ? item.words : [];
    if (!words.length) { return []; }

    const minDimension = Math.min(canvas.width, canvas.height);
    const horizontalGap = Math.max(6, minDimension * 0.006 + Number(wordSpacingAdjustmentPx || 0));
    const topMargin = Math.max(20, minDimension * 0.12);

    const totalLines = words.reduce((max, w) => Math.max(max, Number(w.line || 0)), 0) + 1;
    const accentLineIdx = item.accentLineIndex != null ? Number(item.accentLineIndex) : 1;

    // Font sizes — matching Swift StyleEngine
    const primarySize = Math.max(1, minDimension * 0.095 * 0.7);
    const primaryCapH = measurer.measure("H", fonts.primaryFamily, primarySize, 700).height;
    const accentCapH = measurer.measure("H", fonts.accentFamily, primarySize, 400).height;
    const accentSize = accentCapH > 0 ? primarySize * (primaryCapH / accentCapH) * 2 : primarySize * 2;

    function fontFamilyForLine(li) {
        if (totalLines === 2) { return li === 0 ? fonts.primaryFamily : fonts.accentFamily; }
        if (totalLines === 3) { return li === accentLineIdx ? fonts.accentFamily : fonts.primaryFamily; }
        return words.some((w) => Number(w.line || 0) === li && w.role === "accent") ? fonts.accentFamily : fonts.primaryFamily;
    }
    function fontSizeForLine(li) {
        if (totalLines === 2) { return li === 0 ? primarySize : accentSize; }
        if (totalLines === 3) { return li === accentLineIdx ? accentSize : primarySize; }
        return primarySize;
    }
    function fontWeightForLine(li) {
        if (totalLines === 2) { return li === 0 ? 650 : 700; }
        if (totalLines === 3) { return li === accentLineIdx ? 550 : 700; }
        return 700;
    }

    // Group and measure words per line
    const rows = [];
    for (let li = 0; li < totalLines; li++) {
        const lineWords = words.filter((w) => Number(w.line || 0) === li);
        const fontFamily = fontFamilyForLine(li);
        const fontSize = fontSizeForLine(li);
        const fontWeight = fontWeightForLine(li);
        rows.push(lineWords.map((w) => ({
            source: w,
            text: w.text,
            fontFamily,
            fontSize,
            fontWeight,
            fill: "#111111",
            size: measurer.measure(w.text, fontFamily, fontSize, fontWeight)
        })));
    }

    // Row widths and per-row ink metrics
    const rowWidths = rows.map((row) =>
        row.reduce((sum, it) => sum + it.size.width, 0) + horizontalGap * Math.max(row.length - 1, 0)
    );
    const rowMaxAscent  = rows.map((row) => row.reduce((mx, it) => Math.max(mx, it.size.ascent),  0));
    const rowMaxDescent = rows.map((row) => row.reduce((mx, it) => Math.max(mx, it.size.descent), 0));

    // For 3-row layout, scale middle row to match max(top, bottom) width
    if (rows.length === 3 && rowWidths[1] > 0 && rows[1].length > 0) {
        const targetMidW = Math.max(rowWidths[0], rowWidths[2]);
        const scale = targetMidW / rowWidths[1];
        const newFs = rows[1][0].fontSize * scale;
        rows[1] = rows[1].map((it) => {
            const s = measurer.measure(it.text, it.fontFamily, newFs, it.fontWeight);
            return Object.assign({}, it, { fontSize: newFs, size: s });
        });
        rowWidths[1] = rows[1].reduce((sum, it) => sum + it.size.width, 0) + horizontalGap * Math.max(rows[1].length - 1, 0);
        rowMaxAscent[1]  = rows[1].reduce((mx, it) => Math.max(mx, it.size.ascent),  0);
        rowMaxDescent[1] = rows[1].reduce((mx, it) => Math.max(mx, it.size.descent), 0);
    }

    const globalWidth = rowWidths.length ? Math.max.apply(Math, rowWidths) : canvas.width * 0.6;
    const globalLeft = Math.max(8, (canvas.width - globalWidth) / 2);
    const vAdj = Number(verticalSpacingAdjustmentPx || 0);

    // Baseline anchoring — matching Swift exactly:
    //   baseline_row0 = max(canvas.height * 0.615 + maxDescent_row0, topMargin + maxAscent_row0)
    //   baseline_rowN = baseline_{N-1} + maxDescent_{N-1} + (2 + vAdj) + maxAscent_rowN
    // y for each word = its row's baseline (same meaning as Swift JSON export)
    const baselines = [];
    if (rows.length > 0) {
        baselines[0] = Math.max(
            canvas.height * 0.615 + rowMaxDescent[0],
            topMargin + rowMaxAscent[0]
        );
        for (let li = 1; li < rows.length; li++) {
            baselines[li] = baselines[li - 1] + rowMaxDescent[li - 1] + Math.max(2, 2 + vAdj) + rowMaxAscent[li];
        }
    }

    const elements = [];

    rows.forEach((row, li) => {
        if (!row.length) { return; }
        const rowWidth = rowWidths[li];
        const baseline = baselines[li];
        const rowHeight = rowMaxAscent[li] + rowMaxDescent[li];

        let rowX;
        if (rows.length === 1) {
            rowX = globalLeft + (globalWidth - rowWidth) / 2;
        } else if (li === 0) {
            rowX = globalLeft;
        } else if (li === rows.length - 1) {
            rowX = globalLeft + (globalWidth - rowWidth);
        } else {
            rowX = globalLeft + (globalWidth - rowWidth) / 2;
        }

        let cursorX = rowX;
        row.forEach((it) => {
            elements.push({
                text: it.text,
                x: Math.round(cursorX),
                y: Math.round(baseline),
                width: it.size.width,
                height: rowHeight,
                fontFamily: it.fontFamily,
                fontSize: it.fontSize,
                fontWeight: it.fontWeight,
                fill: it.fill,
                rotation: 0,
                opacity: 1,
                start: Number(it.source.start || 0),
                duration: Number(it.source.duration || 0),
                role: String(it.source.role || "primary"),
                line: Number(it.source.line || 0)
            });
            cursorX += it.size.width + horizontalGap;
        });
    });

    return elements;
}

function generateLayoutsFromEditorialItems(options) {
    const items = options && Array.isArray(options.items) ? options.items : [];
    const measurer = new TextMeasurer(options.document);
    const canvas = {
        width: Math.max(640, Number(options.canvasWidth || 1920)),
        height: Math.max(360, Number(options.canvasHeight || 1080))
    };
    const fonts = {
        primaryFamily: String(options.primaryFontFamily || "Montserrat").trim() || "Montserrat",
        accentFamily: String(options.accentFontFamily || "AppleGaramond-Italic").trim() || "AppleGaramond-Italic"
    };
    const verticalSpacingAdjustmentPx = Number(options.verticalSpacingAdjustmentPx || 0);
    const wordSpacingAdjustmentPx = Number(options.wordSpacingAdjustmentPx || 0);

    if (!items.length) { return { items: [] }; }

    const resultItems = items.map((item) => {
        const words = Array.isArray(item.words) ? item.words : [];
        if (!words.length) { return null; }

        const elements = composeFromEditorialWords(
            item, canvas, fonts,
            verticalSpacingAdjustmentPx, wordSpacingAdjustmentPx,
            measurer
        );

        return {
            text: String(item.text || words.map((w) => w.text).join(" ")),
            start: Number(item.start),
            end: Number(item.end),
            accentLineIndex: item.accentLineIndex != null ? Number(item.accentLineIndex) : null,
            background: "#E7E7E7",
            fonts: fonts,
            words: elements
        };
    }).filter(Boolean);

    return { items: resultItems };
}

module.exports = {
    generateLayoutsFromRawInput,
    generateLayoutsFromEditorialItems
};
