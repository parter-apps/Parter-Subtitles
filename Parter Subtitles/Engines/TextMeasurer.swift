import AppKit
import Foundation

struct TextMeasurer {
    func measure(text: String, fontFamily: String, fontSize: CGFloat, fontWeight: Int) -> CGSize {
        let font = resolvedFont(family: fontFamily, size: fontSize, weight: fontWeight)
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let size = (text as NSString).size(withAttributes: attributes)
        return CGSize(width: ceil(size.width) + 2, height: ceil(font.ascender - font.descender + 2))
    }

    func resolvedFont(family: String, size: CGFloat, weight: Int) -> NSFont {
        for candidate in fallbackCandidates(for: family) {
            if let explicit = NSFont(name: candidate, size: size) {
                return explicit
            }
        }

        let weightValue = NSFont.Weight(rawValue: CGFloat(weight) / 1000.0)
        return NSFont.systemFont(ofSize: size, weight: weightValue)
    }

    private func fallbackCandidates(for family: String) -> [String] {
        let lower = family.lowercased()

        if lower.contains("garamon") || lower.contains("garamond") {
            return [
                family,
                "Apple Garamond Pro Italic",
                "AppleGaramond-Italic",
                "Apple Garamond",
                "Times New Roman Italic"
            ]
        }

        if lower.contains("montserrat") {
            return [family, "Montserrat", "Avenir Next", "Helvetica Neue"]
        }

        return [family]
    }
}
