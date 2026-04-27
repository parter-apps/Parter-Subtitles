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

    private var sourceItems: [SubtitleInputItem] = []
    private var generatedLayouts: [CompositionLayout] = []
    private var positionedItems: [PositionedSubtitleItem] = []

    private let styler = StyleEngine()
    private let layoutEngine = LayoutEngine()
    private let exporter = LayoutExporter()

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

    func generate(newSeed: Bool) {
        if newSeed {
            seed = UInt64.random(in: 1...UInt64.max)
        }

        let items = parseItems(from: inputText)
        guard !items.isEmpty else {
            currentLayout = nil
            jsonPreview = "{}"
            extractedPhrases = []
            sourceItems = []
            generatedLayouts = []
            positionedItems = []
            statusMessage = "No valid JSON items found."
            return
        }

        sourceItems = items
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
        selectedPhraseIndex = index
        currentLayout = generatedLayouts[index]
        jsonPreview = exporter.prettyJSONString(for: positionedItems[index])
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
        if let payload = try? decoder.decode(SubtitleInputPayload.self, from: data) {
            return payload.items
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
