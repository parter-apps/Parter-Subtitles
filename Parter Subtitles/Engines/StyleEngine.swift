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
        item: SubtitleInputItem,
        fonts: FontSelection,
        canvas: CanvasSpec,
        seed: UInt64,
        textScale: Double
    ) -> [StyledInputWord] {
        guard !item.words.isEmpty else { return [] }

        let globalScale = CGFloat(max(0.0, textScale))
        let minDimension = min(canvas.width, canvas.height)
        let primarySize = max(1, minDimension * 0.095 * globalScale)
        let primaryReference = measurer.measure(
            text: "Ag",
            fontFamily: fonts.primaryFamily,
            fontSize: primarySize,
            fontWeight: 700
        )
        let accentReference = measurer.measure(
            text: "Ag",
            fontFamily: fonts.accentFamily,
            fontSize: primarySize,
            fontWeight: 700
        )
        let accentSize: CGFloat
        if accentReference.height > 0 {
            accentSize = primarySize * (primaryReference.height / accentReference.height) * 2
        } else {
            accentSize = primarySize * 2
        }

        return item.words.map { word in
            let fontFamily = word.role == .accent ? fonts.accentFamily : fonts.primaryFamily
            let fontWeight = word.role == .accent ? 550 : 700
            let size = word.role == .accent ? accentSize : primarySize

            let style = WordStyle(
                fontFamily: fontFamily,
                fontSize: size,
                fontWeight: fontWeight,
                fill: "#111111",
                rotation: 0,
                opacity: 1,
                role: .support
            )

            let measured = measurer.measure(
                text: word.text,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight
            )

            return StyledInputWord(word: word, style: style, measuredSize: measured)
        }
    }
}
