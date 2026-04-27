class TextMeasurer {
    constructor(documentRef) {
        this.document = documentRef;
        this.measureNode = null;
    }

    ensureNode() {
        if (this.measureNode || !this.document || !this.document.body) {
            return;
        }

        this.measureNode = this.document.createElement("span");
        this.measureNode.style.position = "absolute";
        this.measureNode.style.left = "-100000px";
        this.measureNode.style.top = "-100000px";
        this.measureNode.style.visibility = "hidden";
        this.measureNode.style.whiteSpace = "pre";
        this.measureNode.style.pointerEvents = "none";
        this.document.body.appendChild(this.measureNode);
    }

    measure(text, fontFamily, fontSize, fontWeight) {
        let rect;

        this.ensureNode();

        if (!this.measureNode) {
            return {
                width: Math.ceil(String(text || "").length * Number(fontSize || 16) * 0.6) + 2,
                height: Math.ceil(Number(fontSize || 16) * 1.25) + 2
            };
        }

        this.measureNode.textContent = String(text || "");
        this.measureNode.style.fontFamily = String(fontFamily || "Helvetica Neue");
        this.measureNode.style.fontSize = Number(fontSize || 16) + "px";
        this.measureNode.style.fontWeight = String(fontWeight || 400);

        rect = this.measureNode.getBoundingClientRect();

        return {
            width: Math.ceil(rect.width) + 2,
            height: Math.ceil(rect.height) + 2
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

    compose(styledBlocks, canvas, fonts, seed, requestedLineCount, verticalSpacingAdjustmentPx) {
        const lineCount = Math.min(Math.max(requestedLineCount, 1), 3);
        const spacingAdjustment = Number(verticalSpacingAdjustmentPx || 0);
        const minDimension = Math.min(canvas.width, canvas.height);
        const horizontalGap = Math.max(6, minDimension * 0.006);
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

module.exports = {
    generateLayoutsFromRawInput
};
