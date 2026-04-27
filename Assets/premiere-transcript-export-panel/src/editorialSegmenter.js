"use strict";

const ARTICLES = new Set(["el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "al", "del"]);
const PREPS = new Set([
    "a", "ante", "bajo", "cabe", "con", "contra", "de", "desde", "durante", "en", "entre",
    "hacia", "hasta", "mediante", "para", "por", "segun", "según", "sin", "so", "sobre",
    "tras", "versus", "via"
]);
const CONJ = new Set(["y", "e", "ni", "o", "u", "pero", "mas", "más", "aunque", "sino", "si", "que"]);
const PRON = new Set([
    "me", "te", "se", "nos", "os", "le", "les", "lo", "la", "los", "las",
    "mi", "mis", "tu", "tus", "su", "sus",
    "nuestro", "nuestra", "nuestros", "nuestras", "vuestro", "vuestra", "vuestros", "vuestras",
    "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
    "aquel", "aquella", "aquellos", "aquellas", "eso", "esto", "aquello"
]);
const ADVS = new Set(["no", "mas", "más"]);

const TERMINAL_RE = /[.!?…]+["']?$/u;
const SOFT_RE = /[,;:]+["']?$/u;
const STRIP_RE = /^[^\wáéíóúüñ]+|[^\wáéíóúüñ]+$/giu;

function norm(text) {
    return String(text || "").toLowerCase().trim().replace(STRIP_RE, "");
}

function kindText(text) {
    const token = norm(text);
    if (PREPS.has(token)) { return "prep"; }
    if (ARTICLES.has(token)) { return "article"; }
    if (CONJ.has(token)) { return "conj"; }
    if (PRON.has(token)) { return "pron"; }
    if (ADVS.has(token)) { return "adv"; }
    return "content";
}

function kind(word) {
    return kindText(word.text);
}

function isTerminal(word) {
    return TERMINAL_RE.test(String(word.text || ""));
}

function isSoft(word) {
    return SOFT_RE.test(String(word.text || ""));
}

function extractWords(data) {
    if (data && typeof data === "object" && Array.isArray(data.segments)) {
        const words = [];
        for (const segment of data.segments) {
            if (segment && Array.isArray(segment.words)) {
                for (const word of segment.words) {
                    // Accept both typed words (Premiere format) and plain word objects
                    if (word && word.text && (word.type === "word" || word.type === undefined)) {
                        words.push(word);
                    }
                }
            }
        }
        return words;
    }
    if (Array.isArray(data)) {
        return data;
    }
    return [];
}

function gapAfter(words, index) {
    if (index >= words.length - 1) { return 0; }
    const current = words[index];
    const next = words[index + 1];
    return Number(next.start) - (Number(current.start) + Number(current.duration));
}

function phraseFuncRatio(words, start, end) {
    const block = words.slice(start, end + 1);
    return block.filter((word) => kind(word) !== "content").length / block.length;
}

function boundaryScore(words, start, end, chunkStart, chunkEnd) {
    const count = end - start + 1;
    const last = words[end];
    const next = end + 1 < chunkEnd ? words[end + 1] : null;
    let score = 0;

    const lengthPenalties = { 1: 4.0, 2: 1.1, 3: 0.2, 4: 0.0, 5: 0.2, 6: 0.8, 7: 1.6, 8: 2.8 };
    score -= (lengthPenalties[count] !== undefined ? lengthPenalties[count] : (4 + count));

    if (isTerminal(last)) {
        score += 4.5;
    } else if (isSoft(last)) {
        score += 3.2;
    }

    const gap = gapAfter(words, end);
    if (gap >= 0.9) { score += 2.4; }
    else if (gap >= 0.6) { score += 1.8; }
    else if (gap >= 0.45) { score += 1.2; }
    else if (gap >= 0.24) { score += 0.5; }

    const lastKind = kind(last);
    if (lastKind === "prep" || lastKind === "article") { score -= 5.0; }
    else if (lastKind === "conj") { score -= 3.5; }
    else if (lastKind === "pron") { score -= 2.2; }

    if (next) {
        const nextKind = kind(next);
        if ((nextKind === "prep" || nextKind === "article" || nextKind === "conj") && lastKind === "content" && count >= 3) {
            score += 1.0;
        }
        if ((nextKind === "prep" || nextKind === "conj") && lastKind === "content" && count === 2 && start === chunkStart && kind(words[start]) !== "content") {
            score += 1.8;
        }
        if (nextKind === "pron" && lastKind === "content" && count >= 3) {
            score += 0.3;
        }
        const nextText = String(words[end + 1].text || "");
        const lastText = String(words[end].text || "");
        if (nextText.slice(0, 1).toUpperCase() === nextText.slice(0, 1) && !".!?".includes(lastText.slice(-1))) {
            score += 2.0;
        }
    }

    const ratio = phraseFuncRatio(words, start, end);
    if (ratio > 0.66) { score -= 2.5; }

    const chars = words.slice(start, end + 1).map((word) => word.text).join(" ").length;
    if (chars > 40) { score -= 3.0; }
    else if (chars > 32) { score -= 1.0; }

    return score;
}

function segmentWords(words, seedCounts) {
    const segments = [];
    let index = 0;

    if (seedCounts && seedCounts.length) {
        for (const count of seedCounts) {
            if (count <= 0) { continue; }
            const end = index + count - 1;
            if (end >= words.length) { break; }
            segments.push([index, end]);
            index += count;
        }
    }

    let chunkStart = index;
    const chunks = [];
    for (let i = index; i < words.length; i += 1) {
        if (isTerminal(words[i])) {
            chunks.push([chunkStart, i + 1]);
            chunkStart = i + 1;
        }
    }
    if (chunkStart < words.length) {
        chunks.push([chunkStart, words.length]);
    }

    for (const [chunkStartIndex, chunkEnd] of chunks) {
        let i = chunkStartIndex;
        while (i < chunkEnd) {
            const remaining = chunkEnd - i;

            if (remaining <= 8) {
                if (remaining === 1 && segments.length) {
                    const previous = segments[segments.length - 1];
                    previous[1] = i;
                    i = chunkEnd;
                    break;
                }

                let bestScore = boundaryScore(words, i, chunkEnd - 1, chunkStartIndex, chunkEnd) + 0.5;
                let bestSplit = chunkEnd - 1;

                for (let split = i + 1; split < chunkEnd - 1; split += 1) {
                    const tail = chunkEnd - (split + 1);
                    if (tail === 1) { continue; }
                    if (tail >= 2 && tail <= 5) {
                        const score = boundaryScore(words, i, split, chunkStartIndex, chunkEnd);
                        if (score > bestScore + 0.7) {
                            bestScore = score;
                            bestSplit = split;
                        }
                    }
                }

                segments.push([i, bestSplit]);
                i = bestSplit + 1;
                continue;
            }

            let bestSplit = null;
            let bestScore = Number.NEGATIVE_INFINITY;
            for (let split = i + 1; split < Math.min(chunkEnd, i + 8); split += 1) {
                const tail = chunkEnd - (split + 1);
                if (tail === 1) { continue; }
                const score = boundaryScore(words, i, split, chunkStartIndex, chunkEnd);
                if (bestSplit === null || score > bestScore) {
                    bestScore = score;
                    bestSplit = split;
                }
            }

            if (bestSplit === null) {
                bestSplit = Math.min(chunkEnd - 1, i + 3);
            }

            segments.push([i, bestSplit]);
            i = bestSplit + 1;
        }
    }

    return segments;
}

function lineChars(group) {
    return group.map((word) => word.text).join(" ").length;
}

function functionalRatio(group) {
    return group.filter((word) => kind(word) !== "content").length / group.length;
}

function breakPenalty(prevWord, nextWord) {
    const prevKind = kind(prevWord);
    const nextKind = kind(nextWord);
    let penalty = 0;
    if (prevKind === "prep" || prevKind === "article") { penalty += 7.0; }
    else if (prevKind === "conj") { penalty += 4.0; }
    else if (prevKind === "pron") { penalty += 2.5; }
    if ((nextKind === "prep" || nextKind === "article") && prevKind === "content") { penalty += 0.7; }
    return penalty;
}

function pstdev(values) {
    if (!values.length) { return 0; }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) * (value - mean)), 0) / values.length;
    return Math.sqrt(variance);
}

function partitionScore(block, splits) {
    const groups = [];
    let start = 0;
    for (const end of [...splits, block.length]) {
        groups.push(block.slice(start, end));
        start = end;
    }

    const chars = groups.map(lineChars);
    let score = 0;

    groups.forEach((group, index) => {
        const charCount = chars[index];

        if (group.length === 1) {
            const cleaned = norm(group[0].text);
            if (cleaned.length <= 2) { score += 5.0; }
            else if (cleaned.length <= 4) { score += 2.5; }
            else if (cleaned.length <= 6) { score += 1.0; }
        }

        const ratio = functionalRatio(group);
        if (ratio === 1) { score += 8.0; }
        else if (ratio > 0.66) { score += 4.0; }
        else if (ratio > 0.5) { score += 1.5; }

        if (charCount > 18) {
            if (group.length === 1 || block.length <= 2) {
                score += 8.0 + ((charCount - 18) * 0.5);
            } else {
                score += 100.0 + ((charCount - 18) * 5.0);
            }
        } else if (charCount > 15) {
            score += (charCount - 15) * 2.5;
        }
    });

    for (let i = 0; i < groups.length - 1; i += 1) {
        score += breakPenalty(groups[i][groups[i].length - 1], groups[i + 1][0]);
    }

    if (groups.length >= 2 && chars[1] > chars[0]) {
        score += (chars[1] - chars[0]) * 3.5;
    }

    if (chars.length > 1) {
        score += pstdev(chars) * 0.25;
    }

    if (groups.length === 2 && block.length >= 5) { score += 2.0; }
    if (groups.length === 3 && block.length >= 5) { score -= 0.7; }
    if (groups.length === 2 && (block.length === 3 || block.length === 4)) { score -= 0.3; }

    return [score, groups];
}

function combinations(length, pick) {
    const results = [];

    function walk(start, current) {
        if (current.length === pick) {
            results.push(current.slice());
            return;
        }
        for (let i = start; i < length; i += 1) {
            current.push(i);
            walk(i + 1, current);
            current.pop();
        }
    }

    walk(1, []);
    return results;
}

function chooseLines(block) {
    const count = block.length;
    if (count <= 2) { return [block]; }

    const candidates = [];
    const lineCounts = (count === 3 || count === 4) ? [2] : [3, 2];
    for (const totalLines of lineCounts) {
        if (totalLines > count) { continue; }
        for (const splits of combinations(count, totalLines - 1)) {
            const [score, groups] = partitionScore(block, splits);
            candidates.push([score, groups]);
        }
    }

    candidates.sort((a, b) => a[0] - b[0]);
    return candidates[0][1];
}

function lineRole(totalLines, lineIndex, wordsInPhrase, wordIndex) {
    if (totalLines === 1) {
        if (wordsInPhrase === 1) { return "primary"; }
        return wordIndex === 0 ? "primary" : "accent";
    }
    if (totalLines === 2) {
        return lineIndex === 0 ? "primary" : "accent";
    }
    return lineIndex === 1 ? "accent" : "primary";
}

function accentLineIndexFor(totalLines, wordsInPhrase) {
    if (totalLines === 1) {
        return wordsInPhrase === 1 ? null : 0;
    }
    return 1;
}

function buildEditorialItems(words, segments, fps) {
    const items = [];

    for (const [startIndex, endIndex] of segments) {
        const block = words.slice(startIndex, endIndex + 1);
        const lines = chooseLines(block);
        const lineMap = [];

        lines.forEach((group, lineIndex) => {
            group.forEach((word) => {
                lineMap.push([word, lineIndex]);
            });
        });

        const phraseWords = lineMap.map(([word, lineIndex], wordIndex) => ({
            text: word.text,
            start: Number(word.start),
            duration: Number(word.duration),
            role: lineRole(lines.length, lineIndex, block.length, wordIndex),
            line: lineIndex
        }));

        let end = Number(block[block.length - 1].start) + Number(block[block.length - 1].duration);
        if (fps) {
            end = Math.round(end * fps) / fps;
        }

        items.push({
            text: block.map((word) => word.text).join(" "),
            start: Number(block[0].start),
            end,
            accentLineIndex: accentLineIndexFor(lines.length, block.length),
            words: phraseWords
        });
    }

    return items;
}

function segmentTranscript(transcriptData, fps) {
    const words = extractWords(transcriptData);
    if (!words.length) { return { items: [] }; }
    const detectedFps = fps || (transcriptData && transcriptData.fps) || null;
    const segments = segmentWords(words, null);
    const items = buildEditorialItems(words, segments, detectedFps);
    return { items };
}

module.exports = { segmentTranscript };
