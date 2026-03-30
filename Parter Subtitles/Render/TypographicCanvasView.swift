import SwiftUI

struct TypographicCanvasView: View {
    let layout: CompositionLayout?

    var body: some View {
        GeometryReader { geometry in
            if let layout {
                let scale = min(
                    geometry.size.width / layout.canvas.width,
                    geometry.size.height / layout.canvas.height
                )

                ZStack(alignment: .topLeading) {
                    Rectangle()
                        .fill(Color(hex: layout.background))
                        .frame(width: layout.canvas.width, height: layout.canvas.height)

                    ForEach(layout.elements) { element in
                        Text(element.text)
                            .font(.custom(element.fontFamily, size: element.fontSize))
                            .fontWeight(.fromNumeric(element.fontWeight))
                            .foregroundStyle(Color(hex: element.fill).opacity(element.opacity))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(width: element.width, height: element.height)
                            .rotationEffect(.degrees(element.rotation))
                            .position(
                                x: element.x + element.width / 2,
                                y: element.y + element.height / 2
                            )
                    }
                }
                .frame(width: layout.canvas.width, height: layout.canvas.height, alignment: .topLeading)
                .scaleEffect(scale, anchor: .topLeading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(.black.opacity(0.08))
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.black.opacity(0.06))
                    .overlay {
                        Text("Generate a layout to preview composition")
                            .foregroundStyle(.secondary)
                    }
            }
        }
    }
}

private extension Font.Weight {
    static func fromNumeric(_ value: Int) -> Font.Weight {
        switch value {
        case 900...: return .black
        case 800..<900: return .heavy
        case 700..<800: return .bold
        case 600..<700: return .semibold
        case 500..<600: return .medium
        case 400..<500: return .regular
        default: return .light
        }
    }
}
