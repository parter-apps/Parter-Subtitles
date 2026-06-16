import AppKit
import Combine
import Foundation
import UniformTypeIdentifiers

@MainActor
final class AppViewModel: ObservableObject {
    @Published var inputText: String = ""
    @Published var primaryFontFamily: String
    @Published var accentFontFamily: String
    @Published var availableFonts: [String]
    @Published var verticalSpacingAdjustmentPx: Double = 5
    @Published var lowerRowSpacingAdjustmentPx: Double = 10
    @Published var wordSpacingAdjustmentPx: Double = 10
    @Published var textScaleInput: String = "0.7"
    @Published var canvasWidth: Double = 1080
    @Published var canvasHeight: Double = 1920
    @Published var seed: UInt64 = 42
    @Published var currentLayout: CompositionLayout?
    @Published var jsonPreview: String = "{}"
    @Published var statusMessage: String = ""
    @Published var extractedPhrases: [String] = []
    @Published var selectedPhraseIndex: Int = 0
    @Published var selectedWordIndex: Int? = nil

    @Published private(set) var sourceItems: [SubtitleInputItem] = []
    private var generatedLayouts: [CompositionLayout] = []
    private var positionedItems: [PositionedSubtitleItem] = []

    private let styler = StyleEngine()
    private let layoutEngine = LayoutEngine()
    private let exporter = LayoutExporter()
    private let segmenter = TranscriptSegmenter()

    init() {
        let fonts = NSFontManager.shared.availableFonts.sorted()
        availableFonts = fonts

        let montserrat = fonts.first(where: { $0.localizedCaseInsensitiveContains("Montserrat Bold") }) ??
            fonts.first(where: { $0.localizedCaseInsensitiveContains("Montserrat-Bold") }) ??
            fonts.first(where: { $0.localizedCaseInsensitiveContains("Montserrat") })
        let garamond = fonts.first(where: { $0.localizedCaseInsensitiveContains("Apple Garamond Italic") }) ??
            fonts.first(where: { $0.localizedCaseInsensitiveContains("AppleGaramond-Italic") }) ??
            fonts.first(where: { $0.localizedCaseInsensitiveContains("Apple Garamond Pro Italic") }) ??
            fonts.first(where: { $0.localizedCaseInsensitiveContains("Garamond") })

        primaryFontFamily = montserrat ?? fonts.first ?? "Helvetica Neue"
        accentFontFamily = garamond ?? fonts.first ?? "Times New Roman"
    }

    /// Re-parses the Input text into `sourceItems` (discarding manual edits),
    /// then lays everything out. This is the explicit "commit input" action.
    func generate(newSeed: Bool) {
        sourceItems = parseItems(from: inputText)
        selectedWordIndex = nil
        relayout(newSeed: newSeed)
    }

    /// Lays out the current `sourceItems` without re-parsing the input, so
    /// manual phrase edits survive a variant regeneration.
    func relayout(newSeed: Bool) {
        if newSeed {
            seed = UInt64.random(in: 1...UInt64.max)
        }

        let items = sourceItems
        guard !items.isEmpty else {
            currentLayout = nil
            jsonPreview = "{}"
            extractedPhrases = []
            generatedLayouts = []
            positionedItems = []
            statusMessage = "No valid JSON items found."
            return
        }

        extractedPhrases = items.map(\.text)
        selectedPhraseIndex = min(selectedPhraseIndex, max(items.count - 1, 0))

        let canvas = CanvasSpec(
            width: max(640, CGFloat(canvasWidth)),
            height: max(360, CGFloat(canvasHeight))
        )
        let fonts = FontSelection(
            primaryFamily: primaryFontFamily.trimmingCharacters(in: .whitespacesAndNewlines),
            accentFamily: accentFontFamily.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let textScale = parseTextScale(textScaleInput)

        generatedLayouts = []
        positionedItems = []

        for (index, item) in items.enumerated() {
            let styled = styler.style(
                item: item,
                fonts: fonts,
                canvas: canvas,
                seed: seed &+ UInt64(index) &* 997,
                textScale: textScale
            )
            let result = layoutEngine.compose(
                item: item,
                styledWords: styled,
                canvas: canvas,
                fonts: fonts,
                seed: seed &+ UInt64(index),
                verticalSpacingAdjustmentPx: verticalSpacingAdjustmentPx,
                lowerRowSpacingAdjustmentPx: lowerRowSpacingAdjustmentPx,
                wordSpacingAdjustmentPx: wordSpacingAdjustmentPx,
                textScale: textScale
            )
            generatedLayouts.append(result.layout)
            positionedItems.append(result.positionedItem)
        }

        selectPhrase(index: selectedPhraseIndex)
        statusMessage = "Generated \(generatedLayouts.count) subtitle layouts from JSON."
    }

    func selectPhrase(index: Int) {
        guard index >= 0, index < generatedLayouts.count, index < positionedItems.count else { return }
        if index != selectedPhraseIndex { selectedWordIndex = nil }
        selectedPhraseIndex = index
        currentLayout = generatedLayouts[index]
        jsonPreview = exporter.prettyJSONString(for: positionedItems[index])
    }

    // MARK: - Phrase editing (regroup / line breaks / accent line)

    /// Merge the phrase at `index` with its previous or next neighbour, then
    /// re-run the line breaker on the combined words.
    func mergePhrase(at index: Int, withNext: Bool) {
        let other = withNext ? index + 1 : index - 1
        guard sourceItems.indices.contains(index), sourceItems.indices.contains(other) else { return }
        let lo = min(index, other)
        let hi = max(index, other)
        let words = rawWords(sourceItems[lo]) + rawWords(sourceItems[hi])
        guard let merged = segmenter.relineate(words: words) else { return }
        sourceItems.replaceSubrange(lo...hi, with: [merged])
        selectedPhraseIndex = lo
        selectedWordIndex = nil
        relayout(newSeed: false)
    }

    /// Split the phrase at `index` into two, the second starting at `wordIndex`.
    func splitPhrase(at index: Int, beforeWord wordIndex: Int) {
        guard sourceItems.indices.contains(index) else { return }
        let words = rawWords(sourceItems[index])
        guard wordIndex > 0, wordIndex < words.count else { return }
        let head = Array(words[0..<wordIndex])
        let tail = Array(words[wordIndex...])
        guard let a = segmenter.relineate(words: head), let b = segmenter.relineate(words: tail) else { return }
        sourceItems.replaceSubrange(index...index, with: [a, b])
        selectedPhraseIndex = index
        selectedWordIndex = nil
        relayout(newSeed: false)
    }

    /// Toggle a manual line break immediately before `wordIndex` in a phrase.
    func toggleLineBreak(phrase index: Int, beforeWord wordIndex: Int) {
        guard sourceItems.indices.contains(index) else { return }
        let words = sourceItems[index].words
        guard wordIndex > 0, wordIndex < words.count else { return }

        var breaks = Set<Int>()
        for i in 1..<words.count where words[i].line != words[i - 1].line { breaks.insert(i) }
        if breaks.contains(wordIndex) {
            breaks.remove(wordIndex)
        } else {
            breaks.insert(wordIndex)
        }

        if breaks.count + 1 > 3 {
            statusMessage = "Máximo 3 líneas por frase."
            return
        }

        var line = 0
        let relined: [SubtitleInputWord] = words.enumerated().map { i, word in
            if breaks.contains(i) { line += 1 }
            return SubtitleInputWord(text: word.text, start: word.start, duration: word.duration, role: word.role, line: line)
        }

        let totalLines = line + 1
        let accent = clampAccent(sourceItems[index].accentLineIndex, totalLines: totalLines)
        rebuildItem(at: index, words: relined, accent: accent)
    }

    /// Choose which line (0-based) is the accent (italic) line for a phrase.
    func setAccentLine(phrase index: Int, line: Int) {
        guard sourceItems.indices.contains(index) else { return }
        rebuildItem(at: index, words: sourceItems[index].words, accent: line)
    }

    // MARK: Editing helpers

    private func rawWords(_ item: SubtitleInputItem) -> [TranscriptSegmenter.RawWord] {
        item.words.map { TranscriptSegmenter.RawWord(text: $0.text, start: $0.start, duration: $0.duration) }
    }

    private func clampAccent(_ accent: Int, totalLines: Int) -> Int {
        if accent < 0 { return totalLines > 1 ? 1 : -1 }
        if accent >= totalLines { return totalLines > 1 ? 1 : 0 }
        return accent
    }

    /// Recompute word roles from the given line assignment + accent line and
    /// replace the phrase, preserving its text/timing.
    private func rebuildItem(at index: Int, words: [SubtitleInputWord], accent: Int) {
        let totalLines = (words.map(\.line).max() ?? 0) + 1
        let wordsInPhrase = words.count
        let rebuilt: [SubtitleInputWord] = words.enumerated().map { wordIndex, word in
            let role = roleFor(totalLines: totalLines, line: word.line, wordsInPhrase: wordsInPhrase, wordIndex: wordIndex, accent: accent)
            return SubtitleInputWord(text: word.text, start: word.start, duration: word.duration, role: role, line: word.line)
        }
        let old = sourceItems[index]
        sourceItems[index] = SubtitleInputItem(
            text: old.text,
            start: old.start,
            end: old.end,
            accentLineIndex: accent,
            lines: nil,
            words: rebuilt
        )
        relayout(newSeed: false)
    }

    private func roleFor(totalLines: Int, line: Int, wordsInPhrase: Int, wordIndex: Int, accent: Int) -> SubtitleWordRole {
        if totalLines == 1 {
            if wordsInPhrase == 1 { return .primary }
            if accent == 0 { return wordIndex == 0 ? .primary : .accent }
            return .primary
        }
        return line == accent ? .accent : .primary
    }

    func importJSON() {
        let panel = NSOpenPanel()
        let jsonType = UTType(filenameExtension: "json") ?? .json
        panel.allowedContentTypes = [jsonType]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }

        do {
            let content = try String(contentsOf: url, encoding: .utf8)
            inputText = content
            generate(newSeed: false)
        } catch {
            statusMessage = "Failed to load JSON: \(error.localizedDescription)"
        }
    }

    func exportJSON() {
        guard !positionedItems.isEmpty else {
            statusMessage = "Generate a layout before exporting."
            return
        }

        guard let url = saveURL(defaultName: "layout", contentType: .json) else { return }

        do {
            try exporter.jsonData(for: positionedItems).write(to: url)
            statusMessage = "JSON exported to \(url.lastPathComponent)."
        } catch {
            statusMessage = "Failed to export JSON: \(error.localizedDescription)"
        }
    }

    func exportSVG() {
        guard let layout = currentLayout else {
            statusMessage = "Generate a layout before exporting."
            return
        }

        let svgType = UTType(filenameExtension: "svg") ?? .data
        guard let url = saveURL(defaultName: "layout", contentType: svgType) else { return }

        do {
            guard let data = exporter.svgString(for: layout).data(using: .utf8) else {
                statusMessage = "Failed to encode SVG data."
                return
            }
            try data.write(to: url)
            statusMessage = "SVG exported to \(url.lastPathComponent)."
        } catch {
            statusMessage = "Failed to export SVG: \(error.localizedDescription)"
        }
    }

    func exportPNG() {
        guard let layout = currentLayout else {
            statusMessage = "Generate a layout before exporting."
            return
        }

        guard let data = exporter.pngData(for: layout) else {
            statusMessage = "Failed to render PNG preview."
            return
        }

        guard let url = saveURL(defaultName: "layout", contentType: .png) else { return }

        do {
            try data.write(to: url)
            statusMessage = "PNG exported to \(url.lastPathComponent)."
        } catch {
            statusMessage = "Failed to export PNG: \(error.localizedDescription)"
        }
    }

    private func parseItems(from raw: String) -> [SubtitleInputItem] {
        guard let data = raw.data(using: .utf8) else { return [] }
        let decoder = JSONDecoder()

        // Already-editorial payload ({ "items": [...] }) — use as-is.
        if let payload = try? decoder.decode(SubtitleInputPayload.self, from: data),
           !payload.items.isEmpty {
            return payload.items
        }

        // Raw Premiere transcript ({ "segments": [{ "words": [...] }] }) —
        // segment it into editorial items in-app.
        if let transcript = try? decoder.decode(RawTranscriptPayload.self, from: data) {
            let words = (transcript.segments ?? []).flatMap { $0.words ?? [] }
            if !words.isEmpty {
                let rawWords = words.map {
                    TranscriptSegmenter.RawWord(text: $0.text, start: $0.start, duration: $0.duration)
                }
                return TranscriptSegmenter().segment(words: rawWords, fps: transcript.fps)
            }
        }

        // Top-level word array ([{ "text", "start", "duration" }, ...]).
        if let words = try? decoder.decode([RawTranscriptWord].self, from: data), !words.isEmpty {
            let rawWords = words.map {
                TranscriptSegmenter.RawWord(text: $0.text, start: $0.start, duration: $0.duration)
            }
            return TranscriptSegmenter().segment(words: rawWords, fps: nil)
        }

        return []
    }

    private func parseTextScale(_ raw: String) -> Double {
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ",", with: ".")

        guard let value = Double(normalized) else { return 1.0 }
        return max(0.0, value)
    }

    private func saveURL(defaultName: String, contentType: UTType) -> URL? {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(defaultName).\(contentType.preferredFilenameExtension ?? "txt")"
        panel.allowedContentTypes = [contentType]
        panel.canCreateDirectories = true
        panel.title = "Export Layout"

        return panel.runModal() == .OK ? panel.url : nil
    }
}
