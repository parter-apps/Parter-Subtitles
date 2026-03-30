import Foundation

struct TextParser {
    private let connectors: Set<String> = [
        "a", "al", "ante", "bajo", "con", "contra", "de", "del", "desde", "el", "la", "los", "las",
        "en", "entre", "hacia", "hasta", "para", "por", "sin", "sobre", "tras", "y", "o", "u",
        "un", "una", "unos", "unas", "que", "mas", "más"
    ]

    func parse(_ phrase: String) -> ParsedText {
        let cleaned = clean(phrase)
        let rawWords = cleaned
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)

        let tokens: [WordToken] = rawWords.enumerated().map { index, token in
            let normalized = normalizeForLookup(token)
            return WordToken(
                text: token,
                normalized: normalized,
                index: index,
                isConnector: connectors.contains(normalized)
            )
        }

        return ParsedText(cleanedText: cleaned, tokens: tokens, blocks: groupBlocks(tokens))
    }

    private func clean(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\u{2019}", with: "'")
            .replacingOccurrences(of: "\u{2018}", with: "'")
            .replacingOccurrences(of: "\u{00B4}", with: "'")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func normalizeForLookup(_ token: String) -> String {
        token
            .lowercased()
            .replacingOccurrences(of: "\u{2019}", with: "'")
            .trimmingCharacters(in: CharacterSet.punctuationCharacters.union(.symbols))
    }

    private func groupBlocks(_ tokens: [WordToken]) -> [TextBlock] {
        tokens.map { makeBlock([$0]) }
    }

    private func makeBlock(_ tokens: [WordToken]) -> TextBlock {
        let text = tokens.map(\.text).joined(separator: " ")
        let lengths = tokens.map { CGFloat($0.length) }
        let averageLength = lengths.reduce(0, +) / CGFloat(max(lengths.count, 1))

        return TextBlock(
            text: text,
            tokenIndexes: tokens.map(\.index),
            averageLength: averageLength,
            longestToken: tokens.map(\.length).max() ?? 0,
            connectorCount: tokens.filter(\.isConnector).count
        )
    }
}
