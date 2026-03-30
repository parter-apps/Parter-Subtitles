import CoreGraphics
import Foundation

struct LayoutEngine {
    private let measurer = TextMeasurer()

    func compose(
        styledBlocks: [StyledBlock],
        canvas: CanvasSpec,
        fonts: FontSelection,
        seed: UInt64,
        requestedLineCount: Int,
        verticalSpacingAdjustmentPx: Double
    ) -> CompositionLayout {
        let lineCount = Swift.min(Swift.max(requestedLineCount, 1), 3)
        let spacingAdjustment = verticalSpacingAdjustmentPx

        guard !styledBlocks.isEmpty else {
            return CompositionLayout(
                canvas: canvas,
                background: "#E7E7E7",
                strategy: .readingOrderEditorial,
                fonts: fonts,
                requestedLineCount: lineCount,
                verticalSpacingAdjustmentPx: spacingAdjustment,
                seed: seed,
                elements: []
            )
        }

        var random = SeededRandom(seed: seed ^ 0x9E3779B97F4A7C15)
        let minDimension = Swift.min(canvas.width, canvas.height)
        let horizontalGap = Swift.max(CGFloat(6), minDimension * CGFloat(0.006))
        let topMargin = Swift.max(CGFloat(20), minDimension * CGFloat(0.12))

        let rows = collapseShortSingletonRows(partitionRows(
            blocks: styledBlocks,
            lineCount: lineCount,
            random: &random
        ))

        var resolvedRows = rows.enumerated().map { rowIndex, row in
            resolveRow(row, rowIndex: rowIndex, totalRows: rows.count, fonts: fonts)
        }

        if resolvedRows.count == 3 {
            let topWidth = width(for: resolvedRows[0], horizontalGap: horizontalGap)
            let bottomWidth = width(for: resolvedRows[2], horizontalGap: horizontalGap)
            let targetMiddleWidth = Swift.max(topWidth, bottomWidth)
            resolvedRows[1] = scaleRowToWidth(
                resolvedRows[1],
                targetWidth: targetMiddleWidth,
                horizontalGap: horizontalGap
            )
        }

        let rowWidths = resolvedRows.map { width(for: $0, horizontalGap: horizontalGap) }
        let globalWidth = rowWidths.max() ?? canvas.width * 0.6
        let globalLeft = Swift.max(CGFloat(8), (canvas.width - globalWidth) / 2)

        var elements: [LayoutElement] = []
        var cursorY = topMargin

        for (index, row) in resolvedRows.enumerated() {
            guard !row.isEmpty else { continue }

            let rowWidth = rowWidths[index]
            let rowHeight = row.reduce(CGFloat(0)) { Swift.max($0, $1.size.height) }

            let rowX: CGFloat
            if resolvedRows.count == 1 {
                rowX = globalLeft + (globalWidth - rowWidth) / CGFloat(2)
            } else if index == 0 {
                rowX = globalLeft
            } else if index == resolvedRows.count - 1 {
                rowX = globalLeft + (globalWidth - rowWidth)
            } else {
                rowX = globalLeft + (globalWidth - rowWidth) / CGFloat(2)
            }

            var cursorX = rowX
            for item in row {
                elements.append(
                    LayoutElement(
                        text: item.text,
                        x: cursorX,
                        y: cursorY,
                        width: item.size.width,
                        height: rowHeight,
                        fontFamily: item.fontFamily,
                        fontSize: item.fontSize,
                        fontWeight: item.fontWeight,
                        fill: item.fill,
                        rotation: 0,
                        opacity: item.opacity
                    )
                )
                cursorX += item.size.width + horizontalGap
            }

            if index < resolvedRows.count - 1 {
                let baseInterline: CGFloat = Swift.max(CGFloat(2), minDimension * CGFloat(0.002))
                let interline = Swift.max(-rowHeight + CGFloat(2), baseInterline + CGFloat(spacingAdjustment))
                cursorY += rowHeight + interline
            }
        }

        return CompositionLayout(
            canvas: canvas,
            background: "#E7E7E7",
            strategy: .readingOrderEditorial,
            fonts: fonts,
            requestedLineCount: resolvedRows.count,
            verticalSpacingAdjustmentPx: spacingAdjustment,
            seed: seed,
            elements: elements
        )
    }

    private func partitionRows(
        blocks: [StyledBlock],
        lineCount: Int,
        random: inout SeededRandom
    ) -> [[StyledBlock]] {
        if lineCount <= 1 || blocks.count <= 1 { return [blocks] }

        if lineCount == 2 {
            let split = chooseSplitForTwoLines(blocks: blocks, random: &random)
            return [Array(blocks[..<split]), Array(blocks[split...])]
        }

        if blocks.count == 2 {
            return [[blocks[0]], [blocks[1]]]
        }

        let (a, b) = chooseSplitsForThreeLines(blocks: blocks, random: &random)
        return [Array(blocks[..<a]), Array(blocks[a..<b]), Array(blocks[b...])]
    }

    private func collapseShortSingletonRows(_ input: [[StyledBlock]]) -> [[StyledBlock]] {
        var rows = input
        guard rows.count > 1 else { return rows }

        var changed = true
        while changed {
            changed = false

            for i in rows.indices {
                guard rows[i].count == 1, let single = rows[i].first, isShortSingleton(single) else { continue }

                if rows.count == 2 {
                    if i == 0 {
                        rows[1].insert(single, at: 0)
                    } else {
                        rows[0].append(single)
                    }
                    rows.remove(at: i)
                    changed = true
                    break
                }

                if i == 0 {
                    rows[1].insert(single, at: 0)
                    rows.remove(at: 0)
                } else if i == rows.count - 1 {
                    rows[i - 1].append(single)
                    rows.remove(at: i)
                } else {
                    rows[i - 1].append(single)
                    rows.remove(at: i)
                }
                changed = true
                break
            }
        }

        return rows
    }

    private func isShortSingleton(_ block: StyledBlock) -> Bool {
        let cleaned = block.block.text.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }
        return cleaned.count <= 3
    }

    private func chooseSplitForTwoLines(
        blocks: [StyledBlock],
        random: inout SeededRandom
    ) -> Int {
        let count = blocks.count
        if count == 3 { return 2 }
        if count == 4 { return 2 }

        let valid = (1..<blocks.count).filter { isValidBreak(after: $0 - 1, blocks: blocks) }
        let candidates = (valid.isEmpty ? Array(1..<blocks.count) : valid)
            .map { split -> (Int, Int) in
                let c1 = split
                let c2 = blocks.count - split
                return (split, Swift.abs(c1 - c2))
            }
            .sorted { $0.1 < $1.1 }

        let top = Array(candidates.prefix(Swift.min(3, candidates.count)))
        return top[Int(random.next(in: 0...Double(top.count - 1)))].0
    }

    private func chooseSplitsForThreeLines(
        blocks: [StyledBlock],
        random: inout SeededRandom
    ) -> (Int, Int) {
        let count = blocks.count
        if count == 5 { return (2, 3) }
        if count == 6 { return (2, 4) }

        var candidates: [(Int, Int, Int)] = []

        for a in 1..<(blocks.count - 1) {
            for b in (a + 1)..<blocks.count {
                guard isValidBreak(after: a - 1, blocks: blocks), isValidBreak(after: b - 1, blocks: blocks) else {
                    continue
                }

                let c1 = a
                let c2 = b - a
                let c3 = blocks.count - b
                guard c2 <= c1 && c2 <= c3 else { continue }

                let score = Swift.abs(c1 - c3) + Swift.abs(c1 - c2) + Swift.abs(c3 - c2)
                candidates.append((a, b, score))
            }
        }

        if candidates.isEmpty {
            let a = Swift.max(1, blocks.count / 3)
            let b = Swift.max(a + 1, Swift.min(blocks.count - 1, (blocks.count * 2) / 3))
            return (a, b)
        }

        let sorted = candidates.sorted { $0.2 < $1.2 }
        let top = Array(sorted.prefix(Swift.min(4, sorted.count)))
        let pick = top[Int(random.next(in: 0...Double(top.count - 1)))]
        return (pick.0, pick.1)
    }

    private func isValidBreak(after index: Int, blocks: [StyledBlock]) -> Bool {
        guard index >= 0, index + 1 < blocks.count else { return false }
        let leftIsConnector = blocks[index].block.connectorCount > 0
        let rightIsConnector = blocks[index + 1].block.connectorCount > 0
        return !leftIsConnector && !rightIsConnector
    }

    private func resolveRow(
        _ row: [StyledBlock],
        rowIndex: Int,
        totalRows: Int,
        fonts: FontSelection
    ) -> [ResolvedItem] {
        let rowBaseSize = row.map { $0.style.fontSize }.reduce(CGFloat(0), +) / CGFloat(Swift.max(row.count, 1))
        let sizeMultiplier = sizeMultiplierFor(rowIndex: rowIndex, totalRows: totalRows)
        let rowFontSize = rowBaseSize * sizeMultiplier
        let rowFontWeight = weightFor(rowIndex: rowIndex, totalRows: totalRows)

        return row.enumerated().map { index, block in
            let fontFamily = fontFor(
                rowIndex: rowIndex,
                totalRows: totalRows,
                indexInRow: index,
                rowWordCount: row.count,
                fonts: fonts
            )

            let measured = measurer.measure(
                text: block.block.text,
                fontFamily: fontFamily,
                fontSize: rowFontSize,
                fontWeight: rowFontWeight
            )

            return ResolvedItem(
                text: block.block.text,
                fontFamily: fontFamily,
                fontSize: rowFontSize,
                fontWeight: rowFontWeight,
                fill: block.style.fill,
                opacity: block.style.opacity,
                size: measured
            )
        }
    }

    private func weightFor(rowIndex: Int, totalRows: Int) -> Int {
        switch totalRows {
        case 2:
            return rowIndex == 0 ? 650 : 700
        case 3:
            return rowIndex == 1 ? 550 : 700
        default:
            return 700
        }
    }

    private func scaleRowToWidth(_ row: [ResolvedItem], targetWidth: CGFloat, horizontalGap: CGFloat) -> [ResolvedItem] {
        guard !row.isEmpty else { return row }

        let gapTotal = horizontalGap * CGFloat(Swift.max(row.count - 1, 0))
        let currentTextWidth = row.reduce(CGFloat(0)) { $0 + $1.size.width }
        let desiredTextWidth = Swift.max(CGFloat(1), targetWidth - gapTotal)
        guard currentTextWidth > 0 else { return row }

        let scale = desiredTextWidth / currentTextWidth

        return row.map { item in
            let newSize = item.fontSize * scale
            let measured = measurer.measure(
                text: item.text,
                fontFamily: item.fontFamily,
                fontSize: newSize,
                fontWeight: item.fontWeight
            )
            return ResolvedItem(
                text: item.text,
                fontFamily: item.fontFamily,
                fontSize: newSize,
                fontWeight: item.fontWeight,
                fill: item.fill,
                opacity: item.opacity,
                size: measured
            )
        }
    }

    private func sizeMultiplierFor(rowIndex: Int, totalRows: Int) -> CGFloat {
        switch totalRows {
        case 2:
            return rowIndex == 0 ? 0.86 : 1.16
        case 3:
            return rowIndex == 1 ? 1.0 : 0.96
        default:
            return 1.0
        }
    }

    private func fontFor(
        rowIndex: Int,
        totalRows: Int,
        indexInRow: Int,
        rowWordCount: Int,
        fonts: FontSelection
    ) -> String {
        switch totalRows {
        case 1:
            if rowWordCount == 2 && indexInRow == 1 {
                return fonts.accentFamily
            }
            return fonts.primaryFamily
        case 2:
            return rowIndex == 0 ? fonts.primaryFamily : fonts.accentFamily
        default:
            return rowIndex == 1 ? fonts.accentFamily : fonts.primaryFamily
        }
    }

    private func width(for row: [ResolvedItem], horizontalGap: CGFloat) -> CGFloat {
        row.reduce(CGFloat(0)) { $0 + $1.size.width } + horizontalGap * CGFloat(Swift.max(row.count - 1, 0))
    }
}

private struct ResolvedItem {
    let text: String
    let fontFamily: String
    let fontSize: CGFloat
    let fontWeight: Int
    let fill: String
    let opacity: Double
    let size: CGSize
}
