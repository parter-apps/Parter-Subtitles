import CoreGraphics
import Foundation

struct LayoutEngine {
    private let measurer = TextMeasurer()

    func compose(
        item: SubtitleInputItem,
        styledWords: [StyledInputWord],
        canvas: CanvasSpec,
        fonts: FontSelection,
        seed: UInt64,
        verticalSpacingAdjustmentPx: Double,
        lowerRowSpacingAdjustmentPx: Double,
        wordSpacingAdjustmentPx: Double,
        textScale: Double
    ) -> (layout: CompositionLayout, positionedItem: PositionedSubtitleItem) {
        let resolvedLines = item.lines ?? deriveLineRanges(from: item.words)

        guard !styledWords.isEmpty else {
            let emptyLayout = CompositionLayout(
                canvas: canvas,
                background: "#E7E7E7",
                strategy: .readingOrderEditorial,
                fonts: fonts,
                requestedLineCount: 0,
                verticalSpacingAdjustmentPx: verticalSpacingAdjustmentPx,
                seed: seed,
                elements: []
            )
            let emptyItem = PositionedSubtitleItem(
                text: item.text,
                start: item.start,
                end: item.end,
                accentLineIndex: item.accentLineIndex,
                lines: resolvedLines,
                words: []
            )
            return (emptyLayout, emptyItem)
        }

        var grouped: [Int: [StyledInputWord]] = [:]
        for word in styledWords {
            grouped[word.word.line, default: []].append(word)
        }

        let lineIndexes = grouped.keys.sorted()
        let minDimension = min(canvas.width, canvas.height)
        let baseHorizontalGap = max(CGFloat(6), minDimension * 0.006)
        let horizontalGap = max(CGFloat(0), baseHorizontalGap + CGFloat(wordSpacingAdjustmentPx))
        let topMargin = max(CGFloat(20), minDimension * 0.12)

        var rows: [[ResolvedWord]] = lineIndexes.map { lineIndex in
            let rowWords = grouped[lineIndex] ?? []
            return resolveRow(
                rowWords,
                lineIndex: lineIndex,
                totalRows: lineIndexes.count,
                accentLineIndex: item.accentLineIndex,
                fonts: fonts
            )
        }

        let maxAllowedRowWidth = canvas.width * 0.86
        if rows.count == 1 {
            let singleRowWidth = rowWidth(rows[0], gap: horizontalGap)
            if singleRowWidth > maxAllowedRowWidth, singleRowWidth > 0 {
                let scale = maxAllowedRowWidth / singleRowWidth
                rows[0] = scaleRow(rows[0], by: scale)
            }
        }
        if rows.count == 3 {
            let middleRowWidth = rowWidth(rows[1], gap: horizontalGap)
            let middleCharacterCount = rows[1].reduce(0) { $0 + $1.input.text.count }
            if middleRowWidth > 0 && middleCharacterCount > 10 {
                let widthScale = max(CGFloat(0), min(CGFloat(1), CGFloat(textScale)))
                let targetWidth = maxAllowedRowWidth * widthScale
                let scale = targetWidth / middleRowWidth
                rows[1] = scaleRow(rows[1], by: scale)
            }
        }

        let rowWidths = rows.map { rowWidth($0, gap: horizontalGap) }
        let globalWidth = rowWidths.max() ?? canvas.width * 0.6
        let globalLeft = max(CGFloat(8), (canvas.width - globalWidth) / 2)

        let rowHeights = rows.map { row in row.reduce(CGFloat(0)) { max($0, $1.size.height) } }
        let rowInkTops = rows.map { row in row.map(\.inkTop).max() ?? 0 }
        let rowInkBottoms = rows.map { row in row.map(\.inkBottom).min() ?? 0 }

        let targetFirstBottomY = canvas.height * 0.615
        let firstInkBottom = rowInkBottoms.first ?? 0
        var currentBaselineY = max(targetFirstBottomY - firstInkBottom, topMargin + (rowInkTops.first ?? 0))
        var baselinePositions: [CGFloat] = []

        for rowIndex in rows.indices {
            baselinePositions.append(currentBaselineY)

            if rowIndex < rows.count - 1 {
                let nextTop = rowInkTops[rowIndex + 1]
                let currentBottom = abs(rowInkBottoms[rowIndex])
                let visualGapBase = CGFloat(2) + CGFloat(verticalSpacingAdjustmentPx)
                let rowSpecificAdjustment = (rows.count >= 3 && rowIndex == 1) ? CGFloat(lowerRowSpacingAdjustmentPx) : 0
                let visualGap = visualGapBase + rowSpecificAdjustment
                let baselineDelta = currentBottom + nextTop + visualGap
                currentBaselineY += baselineDelta
            }
        }

        for rowIndex in 1..<baselinePositions.count {
            let previousBottom = baselinePositions[rowIndex - 1] + abs(rowInkBottoms[rowIndex - 1])
            let currentTop = baselinePositions[rowIndex] - rowInkTops[rowIndex]
            let minimumVisualGap: CGFloat = 2
            let requiredTop = previousBottom + minimumVisualGap

            if currentTop < requiredTop {
                baselinePositions[rowIndex] += requiredTop - currentTop
            }
        }

        var elements: [LayoutElement] = []
        var positionedByKey: [String: PositionedSubtitleWord] = [:]

        for rowIndex in rows.indices {
            let row = rows[rowIndex]
            guard !row.isEmpty else { continue }

            let rowHeight = rowHeights[rowIndex]
            let rowInkHeight = rowInkTops[rowIndex] + abs(rowInkBottoms[rowIndex])
            let rowRenderHeight = max(rowHeight, rowInkHeight + 4)
            let rowBaselineY = baselinePositions[rowIndex]
            let rowX: CGFloat
            if rows.count == 1 {
                rowX = globalLeft + (globalWidth - rowWidths[rowIndex]) / 2
            } else if rowIndex == 0 {
                rowX = globalLeft
            } else if rowIndex == rows.count - 1 {
                rowX = globalLeft + (globalWidth - rowWidths[rowIndex])
            } else {
                rowX = globalLeft + (globalWidth - rowWidths[rowIndex]) / 2
            }

            var cursorX = rowX
            for word in row {
                let wordTop = rowBaselineY - word.ascender
                let element = LayoutElement(
                    text: word.input.text,
                    x: cursorX,
                    y: wordTop,
                    width: word.size.width,
                    height: max(rowRenderHeight, word.size.height),
                    fontFamily: word.fontFamily,
                    fontSize: word.fontSize,
                    fontWeight: word.fontWeight,
                    fill: word.fill,
                    rotation: 0,
                    opacity: word.opacity
                )
                elements.append(element)

                let positioned = PositionedSubtitleWord(
                    text: word.input.text,
                    start: word.input.start,
                    duration: word.input.duration,
                    role: word.input.role,
                    line: word.input.line,
                    x: cursorX,
                    y: rowBaselineY,
                    fontFamily: word.fontFamily,
                    fontSize: word.fontSize,
                    fill: word.fill,
                    rotation: 0
                )
                positionedByKey[key(for: word.input)] = positioned
                cursorX += word.size.width + horizontalGap
            }
        }

        let orderedWords = item.words.compactMap { positionedByKey[key(for: $0)] }
        let positionedItem = PositionedSubtitleItem(
            text: item.text,
            start: item.start,
            end: item.end,
            accentLineIndex: item.accentLineIndex,
            lines: resolvedLines,
            words: orderedWords
        )

        let layout = CompositionLayout(
            canvas: canvas,
            background: "#E7E7E7",
            strategy: .readingOrderEditorial,
            fonts: fonts,
            requestedLineCount: rows.count,
            verticalSpacingAdjustmentPx: verticalSpacingAdjustmentPx,
            seed: seed,
            elements: elements
        )

        return (layout, positionedItem)
    }

    private func resolveRow(
        _ rowWords: [StyledInputWord],
        lineIndex: Int,
        totalRows: Int,
        accentLineIndex: Int,
        fonts: FontSelection
    ) -> [ResolvedWord] {
        guard !rowWords.isEmpty else { return [] }

        let rowWeight = rowFontWeight(lineIndex: lineIndex, totalRows: totalRows, accentLineIndex: accentLineIndex)

        var resolved = rowWords.map { styled in
            let family = styled.word.role == .accent ? fonts.accentFamily : fonts.primaryFamily
            let finalSize = styled.style.fontSize

            let measured = measurer.measure(text: styled.word.text, fontFamily: family, fontSize: finalSize, fontWeight: rowWeight)
            let ink = measurer.inkMetrics(text: styled.word.text, fontFamily: family, fontSize: finalSize, fontWeight: rowWeight)
            let metrics = measurer.fontVerticalMetrics(fontFamily: family, fontSize: finalSize, fontWeight: rowWeight)
            return ResolvedWord(
                input: styled.word,
                fontFamily: family,
                fontSize: finalSize,
                fontWeight: rowWeight,
                fill: "#111111",
                opacity: 1,
                size: measured,
                inkTop: ink.top,
                inkBottom: ink.bottom,
                ascender: metrics.ascender,
                descender: metrics.descender,
                hasVerticalOverhang: ink.top > metrics.ascender + 1 || abs(ink.bottom) > metrics.descender + 1,
                hasHorizontalOverhang: ink.left < -1 || ink.right > ink.advanceWidth + 1
            )
        }

        return resolved
    }

    private func rowWidth(_ row: [ResolvedWord], gap: CGFloat) -> CGFloat {
        row.reduce(CGFloat(0)) { $0 + $1.size.width } + gap * CGFloat(max(row.count - 1, 0))
    }

    private func scaleRow(_ row: [ResolvedWord], by scale: CGFloat) -> [ResolvedWord] {
        guard !row.isEmpty else { return row }

        return row.map { word in
            let size = word.fontSize * scale
            let measured = measurer.measure(text: word.input.text, fontFamily: word.fontFamily, fontSize: size, fontWeight: word.fontWeight)
            let ink = measurer.inkMetrics(text: word.input.text, fontFamily: word.fontFamily, fontSize: size, fontWeight: word.fontWeight)
            let metrics = measurer.fontVerticalMetrics(fontFamily: word.fontFamily, fontSize: size, fontWeight: word.fontWeight)
            return ResolvedWord(
                input: word.input,
                fontFamily: word.fontFamily,
                fontSize: size,
                fontWeight: word.fontWeight,
                fill: word.fill,
                opacity: word.opacity,
                size: measured,
                inkTop: ink.top,
                inkBottom: ink.bottom,
                ascender: metrics.ascender,
                descender: metrics.descender,
                hasVerticalOverhang: ink.top > metrics.ascender + 1 || abs(ink.bottom) > metrics.descender + 1,
                hasHorizontalOverhang: ink.left < -1 || ink.right > ink.advanceWidth + 1
            )
        }
    }

    private func rowFontWeight(lineIndex: Int, totalRows: Int, accentLineIndex: Int) -> Int {
        if totalRows == 2 {
            return lineIndex == 0 ? 650 : 700
        }
        if totalRows == 3 {
            return lineIndex == accentLineIndex ? 550 : 700
        }
        return 700
    }

    private func sizeMultiplier(lineIndex: Int, totalRows: Int) -> CGFloat {
        return 1.0
    }

    private func key(for word: SubtitleInputWord) -> String {
        "\(word.start)-\(word.duration)-\(word.text)-\(word.line)"
    }

    private func deriveLineRanges(from words: [SubtitleInputWord]) -> [SubtitleLineRange] {
        guard !words.isEmpty else { return [] }

        var ranges: [SubtitleLineRange] = []
        var currentLine = words[0].line
        var startIndex = 0

        for index in words.indices {
            if words[index].line != currentLine {
                ranges.append(SubtitleLineRange(from: startIndex, to: index - 1))
                currentLine = words[index].line
                startIndex = index
            }
        }

        ranges.append(SubtitleLineRange(from: startIndex, to: words.count - 1))
        return ranges
    }
}

private struct ResolvedWord {
    let input: SubtitleInputWord
    let fontFamily: String
    let fontSize: CGFloat
    let fontWeight: Int
    let fill: String
    let opacity: Double
    let size: CGSize
    let inkTop: CGFloat
    let inkBottom: CGFloat
    let ascender: CGFloat
    let descender: CGFloat
    let hasVerticalOverhang: Bool
    let hasHorizontalOverhang: Bool
}
