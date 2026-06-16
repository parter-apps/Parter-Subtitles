import SwiftUI

/// Post-segmentation editor for the selected phrase: regroup (merge/split),
/// manual line breaks, and accent-line choice. Edits mutate `sourceItems` and
/// survive "Regenerate variant".
struct PhraseEditorView: View {
    @ObservedObject var viewModel: AppViewModel

    private var index: Int { viewModel.selectedPhraseIndex }

    private var item: SubtitleInputItem? {
        viewModel.sourceItems.indices.contains(index) ? viewModel.sourceItems[index] : nil
    }

    var body: some View {
        if let item = item {
            VStack(alignment: .leading, spacing: 10) {
                header(item)
                lineGrid(item)
                controls(item)
            }
            .padding(12)
            .background(.black.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    // MARK: Header + regroup

    private func header(_ item: SubtitleInputItem) -> some View {
        HStack {
            Text("Editar frase \(index + 1) de \(viewModel.sourceItems.count)")
                .font(.subheadline.weight(.semibold))
            Spacer()
            Button {
                viewModel.mergePhrase(at: index, withNext: false)
            } label: {
                Label("Unir ↑", systemImage: "arrow.up.to.line")
            }
            .disabled(index <= 0)

            Button {
                viewModel.mergePhrase(at: index, withNext: true)
            } label: {
                Label("Unir ↓", systemImage: "arrow.down.to.line")
            }
            .disabled(index >= viewModel.sourceItems.count - 1)
        }
    }

    // MARK: Words grouped by line, with break toggles

    private func lineGrid(_ item: SubtitleInputItem) -> some View {
        let lines = groupedLines(item)
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(lines.enumerated()), id: \.offset) { lineIdx, line in
                HStack(spacing: 6) {
                    if lineIdx > 0, let firstGlobal = line.first?.0 {
                        Button {
                            viewModel.toggleLineBreak(phrase: index, beforeWord: firstGlobal)
                        } label: {
                            Image(systemName: "arrow.up.left")
                        }
                        .buttonStyle(.borderless)
                        .help("Unir con la línea de arriba")
                    }

                    ForEach(Array(line.enumerated()), id: \.element.0) { posInLine, entry in
                        let (global, word) = entry
                        wordChip(word, global: global, accent: lineIdx == item.accentLineIndex)

                        if posInLine < line.count - 1 {
                            Button {
                                viewModel.toggleLineBreak(phrase: index, beforeWord: global + 1)
                            } label: {
                                Image(systemName: "return")
                                    .font(.caption2)
                            }
                            .buttonStyle(.borderless)
                            .foregroundStyle(.secondary)
                            .help("Salto de línea aquí")
                        }
                    }

                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func wordChip(_ word: SubtitleInputWord, global: Int, accent: Bool) -> some View {
        let selected = viewModel.selectedWordIndex == global
        return Button {
            viewModel.selectedWordIndex = selected ? nil : global
        } label: {
            Text(word.text)
                .font(.system(size: 15))
                .italic(accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(selected ? Color.accentColor.opacity(0.25) : Color.black.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(selected ? Color.accentColor : .clear, lineWidth: 1.5)
                )
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    // MARK: Accent line + split

    private func controls(_ item: SubtitleInputItem) -> some View {
        let totalLines = (item.words.map(\.line).max() ?? 0) + 1
        return HStack(spacing: 14) {
            if totalLines > 1 {
                Picker("Línea acentual", selection: Binding(
                    get: { min(max(item.accentLineIndex, 0), totalLines - 1) },
                    set: { viewModel.setAccentLine(phrase: index, line: $0) }
                )) {
                    ForEach(0..<totalLines, id: \.self) { line in
                        Text("Línea \(line + 1)").tag(line)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 280)
            }

            Spacer(minLength: 0)

            Button {
                if let wordIndex = viewModel.selectedWordIndex {
                    viewModel.splitPhrase(at: index, beforeWord: wordIndex)
                }
            } label: {
                Label("Dividir frase aquí", systemImage: "scissors")
            }
            .disabled(!canSplit(item))
            .help("Selecciona una palabra y divide la frase antes de ella")
        }
    }

    // MARK: Helpers

    private func canSplit(_ item: SubtitleInputItem) -> Bool {
        guard let wordIndex = viewModel.selectedWordIndex else { return false }
        return wordIndex > 0 && wordIndex < item.words.count
    }

    /// Group words into contiguous lines, keeping each word's global index.
    private func groupedLines(_ item: SubtitleInputItem) -> [[(Int, SubtitleInputWord)]] {
        var result: [[(Int, SubtitleInputWord)]] = []
        for (i, word) in item.words.enumerated() {
            if result.isEmpty || word.line != item.words[i - 1].line {
                result.append([(i, word)])
            } else {
                result[result.count - 1].append((i, word))
            }
        }
        return result
    }
}
