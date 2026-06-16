import Foundation
import SwiftUI

struct CanvasSpec: Codable {
    let width: CGFloat
    let height: CGFloat
}

enum LayoutStrategy: String, Codable {
    case readingOrderEditorial = "reading_order_editorial"
}

struct FontSelection: Codable {
    let primaryFamily: String
    let accentFamily: String
}

struct SubtitleInputPayload: Codable {
    let items: [SubtitleInputItem]
}

// MARK: - Raw Premiere transcript (Transcript.exportToJSON)

/// Shape of a raw Premiere transcript export: `{ segments: [{ words: [...] }] }`.
/// The app segments this into editorial `SubtitleInputItem`s via `TranscriptSegmenter`.
struct RawTranscriptPayload: Codable {
    let segments: [RawTranscriptSegment]?
    let fps: Double?
}

struct RawTranscriptSegment: Codable {
    let words: [RawTranscriptWord]?
}

struct RawTranscriptWord: Codable {
    let text: String
    let start: Double
    let duration: Double
}

struct SubtitleInputItem: Codable {
    let text: String
    let start: Double
    let end: Double
    let accentLineIndex: Int
    let lines: [SubtitleLineRange]?
    let words: [SubtitleInputWord]
}

struct SubtitleLineRange: Codable {
    let from: Int
    let to: Int
}

enum SubtitleWordRole: String, Codable {
    case primary
    case accent
}

struct SubtitleInputWord: Codable {
    let text: String
    let start: Double
    let duration: Double
    let role: SubtitleWordRole
    let line: Int
}

struct WordToken: Identifiable {
    let id = UUID()
    let text: String
    let normalized: String
    let index: Int
    let isConnector: Bool

    var length: Int { normalized.count }
}

struct TextBlock: Identifiable {
    let id = UUID()
    let text: String
    let tokenIndexes: [Int]
    let averageLength: CGFloat
    let longestToken: Int
    let connectorCount: Int

    var importanceScore: CGFloat {
        averageLength * 1.25 + CGFloat(longestToken) * 0.8 - CGFloat(connectorCount) * 1.2
    }
}

struct ParsedText {
    let cleanedText: String
    let tokens: [WordToken]
    let blocks: [TextBlock]
}

enum VisualRole {
    case hero
    case secondary
    case support
}

struct WordStyle {
    let fontFamily: String
    let fontSize: CGFloat
    let fontWeight: Int
    let fill: String
    let rotation: Double
    let opacity: Double
    let role: VisualRole
}

struct StyledBlock: Identifiable {
    let id = UUID()
    let block: TextBlock
    let style: WordStyle
    let measuredSize: CGSize
    let role: VisualRole
}

struct StyledInputWord {
    let word: SubtitleInputWord
    let style: WordStyle
    let measuredSize: CGSize
}

struct LayoutElement: Identifiable, Codable {
    let id = UUID()
    let text: String
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
    let fontFamily: String
    let fontSize: CGFloat
    let fontWeight: Int
    let fill: String
    let rotation: Double
    let opacity: Double

    private enum CodingKeys: String, CodingKey {
        case text, x, y, width, height, fontFamily, fontSize, fontWeight, fill, rotation, opacity
    }
}

struct CompositionLayout: Codable {
    let canvas: CanvasSpec
    let background: String
    let strategy: LayoutStrategy
    let fonts: FontSelection
    let requestedLineCount: Int
    let verticalSpacingAdjustmentPx: Double
    let seed: UInt64
    let elements: [LayoutElement]
}

struct PositionedSubtitleWord: Codable {
    let text: String
    let start: Double
    let duration: Double
    let role: SubtitleWordRole
    let line: Int
    let x: CGFloat
    let y: CGFloat
    let fontFamily: String
    let fontSize: CGFloat
    let fill: String
    let rotation: Double
}

struct PositionedSubtitleItem: Codable {
    let text: String
    let start: Double
    let end: Double
    let accentLineIndex: Int
    let lines: [SubtitleLineRange]
    let words: [PositionedSubtitleWord]
}

extension Color {
    init(hex: String) {
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
            .sRGB,
            red: Double(r) / 255.0,
            green: Double(g) / 255.0,
            blue: Double(b) / 255.0,
            opacity: 1.0
        )
    }
}
