//
//  ContentView.swift
//  Parter Subtitles
//
//  Created by Daniel Dickinson on 22/3/26.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = AppViewModel()

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Input")
                    .font(.headline)

                TextEditor(text: $viewModel.inputText)
                    .font(.system(size: 16))
                    .frame(height: 96)
                    .padding(6)
                    .background(.black.opacity(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                HStack(spacing: 12) {
                    Button("Import TXT") {
                        viewModel.importTXT()
                    }
                }

                HStack(spacing: 12) {
                    Picker("Primary Font", selection: $viewModel.primaryFontFamily) {
                        ForEach(viewModel.availableFonts, id: \.self) { fontName in
                            Text(fontName).tag(fontName)
                        }
                    }
                    .pickerStyle(.menu)

                    Picker("Accent Font", selection: $viewModel.accentFontFamily) {
                        ForEach(viewModel.availableFonts, id: \.self) { fontName in
                            Text(fontName).tag(fontName)
                        }
                    }
                    .pickerStyle(.menu)
                }

                HStack(spacing: 12) {
                    TextField("Width", value: $viewModel.canvasWidth, format: .number)
                        .frame(width: 90)
                    TextField("Height", value: $viewModel.canvasHeight, format: .number)
                        .frame(width: 90)
                    Text("Seed: \(viewModel.seed)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Vertical spacing: \(viewModel.verticalSpacingAdjustmentPx, specifier: "%.0f") px")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack(spacing: 8) {
                            TextField("e.g. 40 or -10", value: $viewModel.verticalSpacingAdjustmentPx, format: .number)
                                .frame(width: 120)
                            Text("px")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if !viewModel.extractedPhrases.isEmpty {
                        Picker("Phrase", selection: $viewModel.selectedPhraseIndex) {
                            ForEach(Array(viewModel.extractedPhrases.enumerated()), id: \.offset) { index, phrase in
                                Text("\(index + 1). \(phrase)").tag(index)
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(maxWidth: 420)
                        .onChange(of: viewModel.selectedPhraseIndex) { _, index in
                            viewModel.selectPhrase(index: index)
                        }
                    }
                }

                HStack(spacing: 10) {
                    Button("Generate") {
                        viewModel.generate(newSeed: false)
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Regenerate variant") {
                        viewModel.generate(newSeed: true)
                    }
                    .buttonStyle(.bordered)

                    Spacer()

                    Button("Export JSON") {
                        viewModel.exportJSON()
                    }
                    Button("Export SVG") {
                        viewModel.exportSVG()
                    }
                    Button("Export PNG") {
                        viewModel.exportPNG()
                    }
                }

                if !viewModel.statusMessage.isEmpty {
                    Text(viewModel.statusMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                TypographicCanvasView(layout: viewModel.currentLayout)
                    .frame(minHeight: 450)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(.black.opacity(0.18), lineWidth: 1)
                    }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Generated JSON")
                    .font(.headline)

                ScrollView {
                    Text(viewModel.jsonPreview)
                        .font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                .padding(10)
                .background(.black.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .frame(width: 420)
        }
        .padding(16)
        .onAppear {
            viewModel.generate(newSeed: false)
        }
    }
}

#Preview {
    ContentView()
        .frame(width: 1400, height: 900)
}
