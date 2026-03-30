import Foundation

struct SeededRandom {
    private(set) var state: UInt64

    init(seed: UInt64) {
        state = seed == 0 ? 0xABCDEF1234567890 : seed
    }

    mutating func nextUnit() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        let upper = state >> 11
        return Double(upper) / Double(1 << 53)
    }

    mutating func next(in range: ClosedRange<Double>) -> Double {
        range.lowerBound + (range.upperBound - range.lowerBound) * nextUnit()
    }
}

struct StyleEngine {
    private let measurer = TextMeasurer()

    func style(
        parsed: ParsedText,
        fonts: FontSelection,
        canvas: CanvasSpec,
        seed: UInt64,
        targetLineCount: Int
    ) -> [StyledBlock] {
        guard !parsed.blocks.isEmpty else { return [] }

        var random = SeededRandom(seed: seed)
        let minDimension = min(canvas.width, canvas.height)
        let clampedLines = min(max(targetLineCount, 1), 3)

        let baseScale: CGFloat
        switch clampedLines {
        case 1: baseScale = 0.17
        case 2: baseScale = 0.135
        default: baseScale = 0.11
        }

        return parsed.blocks.map { block in
            let connectorAdjustment = block.connectorCount > 0 ? 0.85 : 1.0
            let jitter = CGFloat(random.next(in: -0.006...0.006))
            let size = max(20, (baseScale + jitter) * minDimension * connectorAdjustment)

            let style = WordStyle(
                fontFamily: fonts.primaryFamily,
                fontSize: size,
                fontWeight: block.connectorCount > 0 ? 500 : 700,
                fill: "#111111",
                rotation: 0,
                opacity: 1,
                role: .support
            )

            let measured = measurer.measure(
                text: block.text,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight
            )

            return StyledBlock(
                block: block,
                style: style,
                measuredSize: measured,
                role: .support
            )
        }
    }
}
