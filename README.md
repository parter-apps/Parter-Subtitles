# Typographic Layout MVP (macOS SwiftUI)

Aplicacion local para convertir frases en composiciones tipograficas editoriales con jerarquia visual, variantes por seed y exportacion a JSON/SVG/PNG.

## Que incluye

- Pipeline completo: entrada de texto -> parser -> style engine -> layout engine -> renderer -> exportador.
- Seleccion de fuentes por dropdown usando las fuentes instaladas en el sistema.
- Defaults orientados a tu objetivo visual: Montserrat + Apple Garamond Pro Italic (o fallback cercano).
- Soporte para bloques largos de subtitulos y archivo `.txt`.
- Ignora lineas de timecode automaticamente y estiliza frase por frase.
- Regeneracion de variantes controlada por `seed`.
- Evita solapes usando colocacion iterativa con verificacion de colisiones.
- Orden de lectura preservado (izquierda a derecha, arriba a abajo) y texto sin rotacion.
- UI local con preview y panel JSON en tiempo real.

## Estructura

- `Parter Subtitles/Models/TypographyModels.swift`: modelos de dominio, fuentes y layout.
- `Parter Subtitles/Engines/TextParser.swift`: limpieza, tokenizacion y agrupacion en bloques.
- `Parter Subtitles/Engines/StyleEngine.swift`: jerarquia visual y asignacion de estilos.
- `Parter Subtitles/Engines/LayoutEngine.swift`: distribucion espacial y anti-solape.
- `Parter Subtitles/Engines/TextMeasurer.swift`: medicion de texto con AppKit.
- `Parter Subtitles/Render/TypographicCanvasView.swift`: preview en canvas SwiftUI.
- `Parter Subtitles/Export/LayoutExporter.swift`: export a JSON, SVG y PNG.
- `Parter Subtitles/ViewModels/AppViewModel.swift`: orquestacion de la app y acciones de UI.
- `Parter Subtitles/ContentView.swift`: interfaz principal.

## Como ejecutar

1. Abre `Parter Subtitles.xcodeproj` en Xcode.
2. Selecciona el scheme `Parter Subtitles`.
3. Run en destino `My Mac`.
4. Escribe un bloque o importa un `.txt`, elige fuentes y pulsa `Generate` o `Regenerate variant`.

## Exportaciones

- `Export JSON`: guarda estructura de layout (canvas + elements).
- `Export SVG`: guarda vector con nodos `<text>` y transformacion de rotacion.
- `Export PNG`: rasteriza la composicion con fuentes y estilos actuales.

## Como funciona el layout engine (resumen)

1. Determina lineas automaticamente por cantidad de palabras: <=2 (1 linea), 3-4 (2 lineas), >=5 (3 lineas).
2. Mantiene lectura occidental y evita cortes junto a conectores/articulos.
3. En 3 lineas, la linea central no supera en palabras a las lineas superior/inferior.
4. Aplica reglas de fuente por linea: primaria/accentual segun estructura.
5. Ignora timecodes y procesa cada frase de subtitulo por separado.

## Frases de prueba incluidas

- antes de contratar mas gente
- aprender a vender cambia todo
- este es el momento de acelerar
- menos ruido mas foco
- hoy no compites manana lideras
