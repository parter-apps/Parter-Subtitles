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
    @Published var verticalSpacingAdjustmentPx: Double = -30
    @Published var canvasWidth: Double = 1920
    @Published var canvasHeight: Double = 1080
    @Published var seed: UInt64 = 42
    @Published var currentLayout: CompositionLayout?
    @Published var jsonPreview: String = "{}"
    @Published var statusMessage: String = ""
    @Published var extractedPhrases: [String] = []
    @Published var selectedPhraseIndex: Int = 0

    private var phraseEntries: [ExportPhraseEntry] = []
    private var generatedLayouts: [CompositionLayout] = []
    private let parser = TextParser()
    private let styler = StyleEngine()
    private let layoutEngine = LayoutEngine()
    private let exporter = LayoutExporter()

    init() {
        let fonts = NSFontManager.shared.availableFonts.sorted()
        availableFonts = fonts

        let montserrat = fonts.first(where: { $0.localizedCaseInsensitiveContains("Montserrat") })
        let garamond = fonts.first(where: {
            $0.localizedCaseInsensitiveContains("Apple Garamond Pro Italic") ||
                $0.localizedCaseInsensitiveContains("AppleGaramond-Italic") ||
                $0.localizedCaseInsensitiveContains("Garamond")
        })

        primaryFontFamily = montserrat ?? fonts.first ?? "Helvetica Neue"
        accentFontFamily = garamond ?? fonts.first ?? "Times New Roman"
    }

    func generate(newSeed: Bool) {
        if newSeed {
            seed = UInt64.random(in: 1...UInt64.max)
        }

        let entries = extractPhrases(from: inputText)
        guard !entries.isEmpty else {
            currentLayout = nil
            jsonPreview = "{}"
            extractedPhrases = []
            phraseEntries = []
            generatedLayouts = []
            statusMessage = "No valid subtitle text detected."
            return
        }

        phraseEntries = entries
        extractedPhrases = entries.map { $0.phrase }
        selectedPhraseIndex = min(selectedPhraseIndex, max(entries.count - 1, 0))

        let canvas = CanvasSpec(
            width: max(640, CGFloat(canvasWidth)),
            height: max(360, CGFloat(canvasHeight))
        )
        let fonts = FontSelection(
            primaryFamily: primaryFontFamily.trimmingCharacters(in: .whitespacesAndNewlines),
            accentFamily: accentFontFamily.trimmingCharacters(in: .whitespacesAndNewlines)
        )

        generatedLayouts = entries.enumerated().map { index, entry in
            let parsed = parser.parse(entry.phrase)
            let lineCount = automaticLineCount(wordCount: parsed.tokens.count)
            let styled = styler.style(
                parsed: parsed,
                fonts: fonts,
                canvas: canvas,
                seed: seed &+ UInt64(index) &* 997,
                targetLineCount: lineCount
            )

            return layoutEngine.compose(
                styledBlocks: styled,
                canvas: canvas,
                fonts: fonts,
                seed: seed &+ UInt64(index),
                requestedLineCount: lineCount,
                verticalSpacingAdjustmentPx: verticalSpacingAdjustmentPx
            )
        }

        selectPhrase(index: selectedPhraseIndex)
        statusMessage = "Generated \(generatedLayouts.count) subtitle layouts."
    }

    func selectPhrase(index: Int) {
        guard index >= 0, index < generatedLayouts.count else { return }
        selectedPhraseIndex = index
        let layout = generatedLayouts[index]
        currentLayout = layout
        jsonPreview = exporter.prettyJSONString(
            for: extractedPhrases[index],
            timecode: phraseEntries[index].timecode,
            layout: layout
        )
    }

    func importTXT() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.plainText]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }

        do {
            let content = try String(contentsOf: url, encoding: .utf8)
            inputText = content
            generate(newSeed: false)
        } catch {
            statusMessage = "Failed to load TXT: \(error.localizedDescription)"
        }
    }

    func exportJSON() {
        guard !generatedLayouts.isEmpty, !phraseEntries.isEmpty else {
            statusMessage = "Generate a layout before exporting."
            return
        }

        guard let url = saveURL(defaultName: "layout", contentType: .json) else { return }

        do {
            try exporter.jsonData(for: phraseEntries, layouts: generatedLayouts).write(to: url)
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
            guard let data = exporter.svgString(for: layout).data(using: String.Encoding.utf8) else {
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

    private func automaticLineCount(wordCount: Int) -> Int {
        if wordCount <= 2 { return 1 }
        if wordCount <= 4 { return 2 }
        return 3
    }

    private func extractPhrases(from raw: String) -> [ExportPhraseEntry] {
        let lines = raw
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

        let timecodeRegex = try? NSRegularExpression(pattern: "^\\d{2}:\\d{2}:\\d{2}:\\d{2}\\s*-\\s*\\d{2}:\\d{2}:\\d{2}:\\d{2}$")

        var entries: [ExportPhraseEntry] = []
        var currentTimecode: String?

        for line in lines {
            guard !line.isEmpty else { continue }

            if isTimecode(line, regex: timecodeRegex) {
                currentTimecode = line
                continue
            }

            let phrases = splitBySentence(line)
            if phrases.isEmpty {
                entries.append(ExportPhraseEntry(phrase: line, timecode: currentTimecode))
            } else {
                for phrase in phrases {
                    entries.append(ExportPhraseEntry(phrase: phrase, timecode: currentTimecode))
                }
            }
        }

        return entries
    }

    private func isTimecode(_ line: String, regex: NSRegularExpression?) -> Bool {
        guard let regex else { return false }
        let range = NSRange(location: 0, length: line.utf16.count)
        return regex.firstMatch(in: line, options: [], range: range) != nil
    }

    private func splitBySentence(_ line: String) -> [String] {
        let separators = CharacterSet(charactersIn: ".!?")
        let parts = line.components(separatedBy: separators)
        let cleaned = parts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return cleaned.isEmpty ? [line] : cleaned
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
