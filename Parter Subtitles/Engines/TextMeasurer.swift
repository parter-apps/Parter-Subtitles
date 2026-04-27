import AppKit
import CoreText
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

    func fontVerticalMetrics(fontFamily: String, fontSize: CGFloat, fontWeight: Int) -> FontVerticalMetrics {
        let font = resolvedFont(family: fontFamily, size: fontSize, weight: fontWeight)
        return FontVerticalMetrics(
            ascender: font.ascender,
            descender: abs(font.descender)
        )
    }

    func inkMetrics(text: String, fontFamily: String, fontSize: CGFloat, fontWeight: Int) -> InkMetrics {
        let font = resolvedFont(family: fontFamily, size: fontSize, weight: fontWeight)
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let attr = NSAttributedString(string: text, attributes: attributes)
        let line = CTLineCreateWithAttributedString(attr as CFAttributedString)

        var ascent: CGFloat = 0
        var descent: CGFloat = 0
        var leading: CGFloat = 0
        let advance = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))

        let glyphBounds = CTLineGetBoundsWithOptions(line, [.useGlyphPathBounds, .excludeTypographicLeading])
        if glyphBounds.isNull || glyphBounds.isEmpty {
            return InkMetrics(top: ascent, bottom: -descent, left: 0, right: advance, advanceWidth: advance)
        }

        let top = glyphBounds.maxY
        let bottom = glyphBounds.minY
        return InkMetrics(
            top: top,
            bottom: bottom,
            left: glyphBounds.minX,
            right: glyphBounds.maxX,
            advanceWidth: advance
        )
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

struct InkMetrics {
    let top: CGFloat
    let bottom: CGFloat
    let left: CGFloat
    let right: CGFloat
    let advanceWidth: CGFloat
}

struct FontVerticalMetrics {
    let ascender: CGFloat
    let descender: CGFloat
}
