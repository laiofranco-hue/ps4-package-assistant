import AppKit

func renderIcon(size s: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(s), pixelsHigh: Int(s),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let inset = s * 0.1
    let tile = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let tilePath = NSBezierPath(roundedRect: tile, xRadius: s * 0.2237, yRadius: s * 0.2237)
    NSGradient(colors: [
        NSColor(calibratedRed: 0.16, green: 0.25, blue: 0.40, alpha: 1),
        NSColor(calibratedRed: 0.063, green: 0.075, blue: 0.102, alpha: 1)
    ])!.draw(in: tilePath, angle: -90)

    let accent = NSColor(calibratedRed: 0.447, green: 0.655, blue: 1.0, alpha: 1)
    let box = NSRect(x: s * 0.25, y: s * 0.18, width: s * 0.50, height: s * 0.24)
    accent.setFill()
    NSBezierPath(roundedRect: box, xRadius: s * 0.04, yRadius: s * 0.04).fill()

    NSColor.white.setFill()
    NSBezierPath(roundedRect: NSRect(x: s * 0.465, y: s * 0.50, width: s * 0.07, height: s * 0.26),
                 xRadius: s * 0.02, yRadius: s * 0.02).fill()
    let head = NSBezierPath()
    head.move(to: NSPoint(x: s * 0.36, y: s * 0.52))
    head.line(to: NSPoint(x: s * 0.64, y: s * 0.52))
    head.line(to: NSPoint(x: s * 0.50, y: s * 0.38))
    head.close()
    head.fill()

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let outputDir = CommandLine.arguments[1]
let entries: [(String, CGFloat)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)
]
for (name, size) in entries {
    let data = renderIcon(size: size).representation(using: .png, properties: [:])!
    try data.write(to: URL(fileURLWithPath: outputDir).appendingPathComponent(name))
}
