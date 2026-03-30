import AppKit
import Foundation

struct LayoutExporter {
    func prettyJSONString(for phrase: String, timecode: String?, layout: CompositionLayout) -> String {
        let payload = PhraseLayoutExport(
            phrase: phrase,
            timecode: timecode,
            background: layout.background,
            fonts: layout.fonts,
            elements: layout.elements
        )
        return stringify(payload)
    }

    func jsonData(for entries: [ExportPhraseEntry], layouts: [CompositionLayout]) -> Data {
        let phraseLayouts = zip(entries, layouts).map { entry, layout in
            PhraseLayoutExport(
                phrase: entry.phrase,
                timecode: entry.timecode,
                background: layout.background,
                fonts: layout.fonts,
                elements: layout.elements
            )
        }

        let payload = BatchLayoutExport(layouts: phraseLayouts)
        return Data(stringify(payload).utf8)
    }

    func svgString(for layout: CompositionLayout) -> String {
        let nodes = layout.elements.map { element in
            let escapedText = xmlEscaped(element.text)
            return """
              <text x="\(format(element.x + element.width / 2))" y="\(format(element.y + element.height * 0.78))" \
                    text-anchor="middle" font-family="\(element.fontFamily)" font-size="\(format(element.fontSize))" \
                    font-weight="\(element.fontWeight)" fill="\(element.fill)" fill-opacity="\(format(element.opacity))" \
                    transform="rotate(\(format(element.rotation)) \(format(element.x + element.width / 2)) \(format(element.y + element.height / 2)))">\(escapedText)</text>
            """
        }.joined(separator: "\n")

        return """
        <svg xmlns="http://www.w3.org/2000/svg" width="\(Int(layout.canvas.width))" height="\(Int(layout.canvas.height))" viewBox="0 0 \(Int(layout.canvas.width)) \(Int(layout.canvas.height))">
          <rect width="100%" height="100%" fill="\(layout.background)" />
        \(nodes)
        </svg>
        """
    }

    func pngData(for layout: CompositionLayout) -> Data? {
        let imageSize = NSSize(width: layout.canvas.width, height: layout.canvas.height)
        let image = NSImage(size: imageSize)

        image.lockFocus()
        defer { image.unlockFocus() }

        guard let context = NSGraphicsContext.current?.cgContext else { return nil }
        context.setFillColor(NSColor(hex: layout.background).cgColor)
        context.fill(CGRect(origin: .zero, size: imageSize))

        for element in layout.elements {
            context.saveGState()

            let center = CGPoint(x: element.x + element.width / 2, y: element.y + element.height / 2)
            context.translateBy(x: center.x, y: center.y)
            context.rotate(by: CGFloat(element.rotation * .pi / 180))
            context.translateBy(x: -center.x, y: -center.y)

            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center

            let font = NSFont(name: element.fontFamily, size: element.fontSize) ?? NSFont.systemFont(ofSize: element.fontSize)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: NSColor(hex: element.fill).withAlphaComponent(element.opacity),
                .paragraphStyle: paragraph
            ]

            let rect = CGRect(x: element.x, y: element.y, width: element.width, height: element.height)
            NSAttributedString(string: element.text, attributes: attrs).draw(in: rect)
            context.restoreGState()
        }

        guard
            let tiffData = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiffData)
        else { return nil }

        return bitmap.representation(using: NSBitmapImageRep.FileType.png, properties: [:])
    }

    private func xmlEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    private func format(_ value: CGFloat) -> String {
        String(format: "%.2f", value)
    }

    private func format(_ value: Double) -> String {
        String(format: "%.2f", value)
    }

    private func stringify<T: Encodable>(_ payload: T) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(payload) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}

private struct PhraseLayoutExport: Encodable {
    let phrase: String
    let timecode: String?
    let background: String
    let fonts: FontSelection
    let elements: [LayoutElement]
}

private struct BatchLayoutExport: Encodable {
    let layouts: [PhraseLayoutExport]
}

struct ExportPhraseEntry {
    let phrase: String
    let timecode: String?
}

private extension NSColor {
    convenience init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&int)

        let r, g, b: UInt64
        switch cleaned.count {
        case 6:
            r = (int >> 16) & 0xFF
            g = (int >> 8) & 0xFF
            b = int & 0xFF
        default:
            r = 255
            g = 255
            b = 255
        }

        self.init(
            red: CGFloat(r) / 255,
            green: CGFloat(g) / 255,
            blue: CGFloat(b) / 255,
            alpha: 1
        )
    }
}
