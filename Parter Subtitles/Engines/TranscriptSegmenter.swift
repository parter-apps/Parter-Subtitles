import Foundation

/// Swift port of the transcript editorial CLI
/// (`Assets/scripts/transcript_editorial_cli.js`).
///
/// Turns a raw Premiere transcript (word-level `start`/`duration`) into the
/// editorial `SubtitleInputItem`s the app already consumes, so the app can
/// ingest a Premiere export directly without the external Node/Python step.
///
/// The function-word dictionaries cover Spanish + English; keep them in sync
/// with the CLI sets if the segmentation rules ever change.
struct TranscriptSegmenter {
    // MARK: - Function-word dictionaries (mirror the CLI)

    private static let articles: Set<String> = [
        "el", "la", "los", "las", "lo", "un", "una", "unos", "unas", "al", "del",
        // English determiners/articles
        "the", "an", "every", "each", "another", "this", "these", "those"
    ]

    private static let preps: Set<String> = [
        "a", "ante", "bajo", "cabe", "con", "contra", "de", "desde", "durante",
        "en", "entre", "hacia", "hasta", "mediante", "para", "por", "segun",
        "según", "sin", "so", "sobre", "tras", "versus", "via",
        // English prepositions
        "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "onto",
        "upon", "about", "over", "under", "between", "through", "during", "without",
        "within", "toward", "towards", "after", "before", "against", "among",
        "across", "behind", "below", "beside", "beyond", "near"
    ]

    private static let conj: Set<String> = [
        "y", "e", "ni", "o", "u", "pero", "mas", "más", "aunque", "sino", "si", "que",
        // English conjunctions / subordinators
        "and", "or", "but", "nor", "yet", "because", "although", "though", "while",
        "whereas", "unless", "since", "as", "than", "that", "whether", "when", "where", "if"
    ]

    private static let pron: Set<String> = [
        "me", "te", "se", "nos", "os", "le", "les", "lo", "la", "los", "las",
        "mi", "mis", "tu", "tus", "su", "sus", "nuestro", "nuestra", "nuestros",
        "nuestras", "vuestro", "vuestra", "vuestros", "vuestras", "este", "esta",
        "estos", "estas", "ese", "esa", "esos", "esas", "aquel", "aquella",
        "aquellos", "aquellas", "eso", "esto", "aquello",
        // English pronouns / possessives
        "i", "you", "he", "she", "it", "we", "they", "him", "us", "them",
        "my", "your", "his", "her", "its", "our", "their",
        "mine", "yours", "hers", "ours", "theirs",
        "who", "whom", "whose", "which", "what",
        "myself", "yourself", "himself", "herself", "itself", "ourselves",
        "yourselves", "themselves"
    ]

    private static let advs: Set<String> = ["no", "mas", "más", "not"]

    private enum Kind { case prep, article, conj, pron, adv, content }

    /// One transcript word with the only fields the segmenter needs.
    struct RawWord {
        let text: String
        let start: Double
        let duration: Double
    }

    // MARK: - Public entry point

    func segment(words: [RawWord], seedCounts: [Int]? = nil, fps: Double? = nil) -> [SubtitleInputItem] {
        guard !words.isEmpty else { return [] }
        let segments = segmentWords(words, seedCounts)
        return buildEditorialItems(words, segments, fps)
    }

    /// Re-runs only the line-breaking for one explicit phrase (no phrase
    /// splitting). Used when merging/splitting phrases in the editor.
    func relineate(words: [RawWord], fps: Double? = nil) -> SubtitleInputItem? {
        guard !words.isEmpty else { return nil }
        return buildEditorialItems(words, [(0, words.count - 1)], fps).first
    }

    // MARK: - Classification

    private static let wordChars = CharacterSet.alphanumerics
        .union(CharacterSet(charactersIn: "_áéíóúüñ"))

    private func norm(_ text: String) -> String {
        let lowered = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let scalars = Array(lowered.unicodeScalars)
        var start = 0
        var end = scalars.count
        while start < end, !Self.wordChars.contains(scalars[start]) { start += 1 }
        while end > start, !Self.wordChars.contains(scalars[end - 1]) { end -= 1 }
        return String(String.UnicodeScalarView(scalars[start..<end]))
    }

    private func kind(_ text: String) -> Kind {
        let token = norm(text)
        if Self.preps.contains(token) { return .prep }
        if Self.articles.contains(token) { return .article }
        if Self.conj.contains(token) { return .conj }
        if Self.pron.contains(token) { return .pron }
        if Self.advs.contains(token) { return .adv }
        return .content
    }

    private func isTerminal(_ word: RawWord) -> Bool {
        var s = Substring(word.text)
        if let last = s.last, last == "\"" || last == "'" { s = s.dropLast() }
        guard let last = s.last else { return false }
        return "?!.…".contains(last)
    }

    private func isSoft(_ word: RawWord) -> Bool {
        var s = Substring(word.text)
        if let last = s.last, last == "\"" || last == "'" { s = s.dropLast() }
        guard let last = s.last else { return false }
        return ",;:".contains(last)
    }

    // MARK: - Phrase segmentation

    private func gapAfter(_ words: [RawWord], _ index: Int) -> Double {
        if index >= words.count - 1 { return 0 }
        let current = words[index]
        let next = words[index + 1]
        return next.start - (current.start + current.duration)
    }

    private func phraseFuncRatio(_ words: [RawWord], _ start: Int, _ end: Int) -> Double {
        let block = words[start...end]
        let functional = block.filter { kind($0.text) != .content }.count
        return Double(functional) / Double(block.count)
    }

    private func boundaryScore(_ words: [RawWord], _ start: Int, _ end: Int, _ chunkStart: Int, _ chunkEnd: Int) -> Double {
        let count = end - start + 1
        let last = words[end]
        let next = end + 1 < chunkEnd ? words[end + 1] : nil
        var score = 0.0

        let countPenalty: [Int: Double] = [1: 4.0, 2: 1.1, 3: 0.2, 4: 0.0, 5: 0.2, 6: 0.8, 7: 1.6, 8: 2.8]
        score -= countPenalty[count] ?? (4.0 + Double(count))

        if isTerminal(last) {
            score += 4.5
        } else if isSoft(last) {
            score += 3.2
        }

        let gap = gapAfter(words, end)
        if gap >= 0.9 {
            score += 2.4
        } else if gap >= 0.6 {
            score += 1.8
        } else if gap >= 0.45 {
            score += 1.2
        } else if gap >= 0.24 {
            score += 0.5
        }

        let lastKind = kind(last.text)
        if lastKind == .prep || lastKind == .article {
            score -= 5.0
        } else if lastKind == .conj {
            score -= 3.5
        } else if lastKind == .pron {
            score -= 2.2
        }

        if let next = next {
            let nextKind = kind(next.text)
            if (nextKind == .prep || nextKind == .article || nextKind == .conj) && lastKind == .content && count >= 3 {
                score += 1.0
            }
            if (nextKind == .prep || nextKind == .conj) && lastKind == .content && count == 2 && start == chunkStart && kind(words[start].text) != .content {
                score += 1.8
            }
            if nextKind == .pron && lastKind == .content && count >= 3 {
                score += 0.3
            }
            let nextFirst = next.text.prefix(1)
            let lastChar = last.text.suffix(1)
            if String(nextFirst).uppercased() == String(nextFirst) && !".!?".contains(lastChar) {
                score += 2.0
            }
        }

        let ratio = phraseFuncRatio(words, start, end)
        if ratio > 0.66 {
            score -= 2.5
        }

        let chars = words[start...end].map(\.text).joined(separator: " ").count
        if chars > 40 {
            score -= 3.0
        } else if chars > 32 {
            score -= 1.0
        }

        return score
    }

    private func segmentWords(_ words: [RawWord], _ seedCounts: [Int]?) -> [(Int, Int)] {
        var segments: [(Int, Int)] = []
        var index = 0

        if let seedCounts = seedCounts, !seedCounts.isEmpty {
            for count in seedCounts {
                if count <= 0 { continue }
                let end = index + count - 1
                if end >= words.count { break }
                segments.append((index, end))
                index += count
            }
        }

        var chunkStart = index
        var chunks: [(Int, Int)] = []
        var i = index
        while i < words.count {
            if isTerminal(words[i]) {
                chunks.append((chunkStart, i + 1))
                chunkStart = i + 1
            }
            i += 1
        }
        if chunkStart < words.count {
            chunks.append((chunkStart, words.count))
        }

        for (chunkStartIndex, chunkEnd) in chunks {
            var i = chunkStartIndex
            while i < chunkEnd {
                let remaining = chunkEnd - i

                if remaining <= 8 {
                    if remaining == 1 && !segments.isEmpty {
                        segments[segments.count - 1].1 = i
                        i = chunkEnd
                        break
                    }

                    var bestScore = boundaryScore(words, i, chunkEnd - 1, chunkStartIndex, chunkEnd) + 0.5
                    var bestSplit = chunkEnd - 1

                    var split = i + 1
                    while split < chunkEnd - 1 {
                        let tail = chunkEnd - (split + 1)
                        if tail == 1 { split += 1; continue }
                        if tail >= 2 && tail <= 5 {
                            let score = boundaryScore(words, i, split, chunkStartIndex, chunkEnd)
                            if score > bestScore + 0.7 {
                                bestScore = score
                                bestSplit = split
                            }
                        }
                        split += 1
                    }

                    segments.append((i, bestSplit))
                    i = bestSplit + 1
                    continue
                }

                var bestSplit: Int? = nil
                var bestScore = -Double.infinity
                var split = i + 1
                while split < min(chunkEnd, i + 8) {
                    let tail = chunkEnd - (split + 1)
                    if tail == 1 { split += 1; continue }
                    let score = boundaryScore(words, i, split, chunkStartIndex, chunkEnd)
                    if bestSplit == nil || score > bestScore {
                        bestScore = score
                        bestSplit = split
                    }
                    split += 1
                }

                let resolved = bestSplit ?? min(chunkEnd - 1, i + 3)
                segments.append((i, resolved))
                i = resolved + 1
            }
        }

        return segments
    }

    // MARK: - Line breaking

    private func lineText(_ group: [RawWord]) -> String {
        group.map(\.text).joined(separator: " ")
    }

    private func lineChars(_ group: [RawWord]) -> Int {
        lineText(group).count
    }

    private func functionalRatio(_ group: [RawWord]) -> Double {
        let functional = group.filter { kind($0.text) != .content }.count
        return Double(functional) / Double(group.count)
    }

    private func breakPenalty(_ prevWord: RawWord, _ nextWord: RawWord) -> Double {
        let prevKind = kind(prevWord.text)
        let nextKind = kind(nextWord.text)
        var penalty = 0.0
        if prevKind == .prep || prevKind == .article {
            penalty += 7.0
        } else if prevKind == .conj {
            penalty += 4.0
        } else if prevKind == .pron {
            penalty += 2.5
        }
        if (nextKind == .prep || nextKind == .article) && prevKind == .content {
            penalty += 0.7
        }
        return penalty
    }

    private func pstdev(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let mean = values.reduce(0, +) / Double(values.count)
        let variance = values.reduce(0) { $0 + (($1 - mean) * ($1 - mean)) } / Double(values.count)
        return variance.squareRoot()
    }

    private func partitionScore(_ block: [RawWord], _ splits: [Int]) -> (Double, [[RawWord]]) {
        var groups: [[RawWord]] = []
        var start = 0
        for end in splits + [block.count] {
            groups.append(Array(block[start..<end]))
            start = end
        }

        let chars = groups.map(lineChars)
        var score = 0.0

        for (index, group) in groups.enumerated() {
            let charCount = chars[index]

            if group.count == 1 {
                let cleaned = norm(group[0].text)
                if cleaned.count <= 2 {
                    score += 5.0
                } else if cleaned.count <= 4 {
                    score += 2.5
                } else if cleaned.count <= 6 {
                    score += 1.0
                }
            }

            let ratio = functionalRatio(group)
            if ratio == 1 {
                score += 8.0
            } else if ratio > 0.66 {
                score += 4.0
            } else if ratio > 0.5 {
                score += 1.5
            }

            if charCount > 18 {
                if group.count == 1 || block.count <= 2 {
                    score += 8.0 + (Double(charCount - 18) * 0.5)
                } else {
                    score += 100.0 + (Double(charCount - 18) * 5.0)
                }
            } else if charCount > 15 {
                score += Double(charCount - 15) * 2.5
            }
        }

        for i in 0..<(groups.count - 1) {
            score += breakPenalty(groups[i][groups[i].count - 1], groups[i + 1][0])
        }

        if groups.count >= 2 && chars[1] > chars[0] {
            score += Double(chars[1] - chars[0]) * 3.5
        }

        if chars.count > 1 {
            score += pstdev(chars.map(Double.init)) * 0.25
        }

        if groups.count == 2 && block.count >= 5 { score += 2.0 }
        if groups.count == 3 && block.count >= 5 { score -= 0.7 }
        if groups.count == 2 && (block.count == 3 || block.count == 4) { score -= 0.3 }

        return (score, groups)
    }

    private func combinations(_ length: Int, _ pick: Int) -> [[Int]] {
        var results: [[Int]] = []
        var current: [Int] = []

        func walk(_ start: Int) {
            if current.count == pick {
                results.append(current)
                return
            }
            var i = start
            while i < length {
                current.append(i)
                walk(i + 1)
                current.removeLast()
                i += 1
            }
        }

        walk(1)
        return results
    }

    private func chooseLines(_ block: [RawWord]) -> [[RawWord]] {
        let count = block.count
        if count <= 2 { return [block] }

        var candidates: [(Double, [[RawWord]])] = []
        let lineCounts = (count == 3 || count == 4) ? [2] : [3, 2]
        for totalLines in lineCounts {
            if totalLines > count { continue }
            for splits in combinations(count, totalLines - 1) {
                candidates.append(partitionScore(block, splits))
            }
        }

        candidates.sort { $0.0 < $1.0 }
        return candidates[0].1
    }

    private func lineRole(_ totalLines: Int, _ lineIndex: Int, _ wordsInPhrase: Int, _ wordIndex: Int) -> SubtitleWordRole {
        if totalLines == 1 {
            if wordsInPhrase == 1 { return .primary }
            return wordIndex == 0 ? .primary : .accent
        }
        if totalLines == 2 {
            return lineIndex == 0 ? .primary : .accent
        }
        return lineIndex == 1 ? .accent : .primary
    }

    /// Returns the accent line index, or `-1` when there is no accent line
    /// (single-word, single-line phrases — `null` in the CLI output).
    private func accentLineIndex(_ totalLines: Int, _ wordsInPhrase: Int) -> Int {
        if totalLines == 1 {
            return wordsInPhrase == 1 ? -1 : 0
        }
        return 1
    }

    // MARK: - Item assembly

    private func buildEditorialItems(_ words: [RawWord], _ segments: [(Int, Int)], _ fps: Double?) -> [SubtitleInputItem] {
        var items: [SubtitleInputItem] = []

        for (startIndex, endIndex) in segments {
            let block = Array(words[startIndex...endIndex])
            let lines = chooseLines(block)

            var lineMap: [(RawWord, Int)] = []
            for (lineIndex, group) in lines.enumerated() {
                for word in group {
                    lineMap.append((word, lineIndex))
                }
            }

            let phraseWords: [SubtitleInputWord] = lineMap.enumerated().map { wordIndex, pair in
                let (word, lineIndex) = pair
                return SubtitleInputWord(
                    text: word.text,
                    start: word.start,
                    duration: word.duration,
                    role: lineRole(lines.count, lineIndex, block.count, wordIndex),
                    line: lineIndex
                )
            }

            var end = block[block.count - 1].start + block[block.count - 1].duration
            if let fps = fps, fps > 0 {
                end = (end * fps).rounded() / fps
            }

            items.append(
                SubtitleInputItem(
                    text: block.map(\.text).joined(separator: " "),
                    start: block[0].start,
                    end: end,
                    accentLineIndex: accentLineIndex(lines.count, block.count),
                    lines: nil,
                    words: phraseWords
                )
            )
        }

        return items
    }
}
