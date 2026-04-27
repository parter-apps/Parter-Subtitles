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
                            .foregroundStyle(Color(hex: element.fill).opacity(element.opacity))
                            .lineLimit(1)
                            .fixedSize()
                            .rotationEffect(.degrees(element.rotation))
                            .offset(x: element.x, y: element.y)
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
