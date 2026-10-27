// JXA script: draws the MDView icon with AppKit and writes a 1024px PNG.
// Usage: osascript -l JavaScript macos/make-icon.js /path/to/out.png
ObjC.import('AppKit');

function run(argv) {
  const out = argv[0];
  const S = 1024;
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, S, S, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext(ctx);

  const rgb = (r, g, b, a = 1) => $.NSColor.colorWithSRGBRedGreenBlueAlpha(r / 255, g / 255, b / 255, a);

  // Rounded-square body on the standard macOS icon grid (824pt inside 1024).
  const body = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(100, 100, 824, 824), 185, 185);
  const grad = $.NSGradient.alloc.initWithStartingColorEndingColor(rgb(44, 58, 76), rgb(22, 29, 39));
  grad.drawInBezierPathAngle(body, -90);

  // Glyphs from the 64-unit favicon grid, flipped into Cocoa's bottom-left origin.
  const k = 824 / 64;
  const P = (x, y) => $.NSMakePoint(100 + x * k, 100 + (64 - y) * k);
  function poly(points, color) {
    const p = $.NSBezierPath.bezierPath;
    p.moveToPoint(P(points[0][0], points[0][1]));
    for (let i = 1; i < points.length; i++) p.lineToPoint(P(points[i][0], points[i][1]));
    p.closePath;
    color.setFill;
    p.fill;
  }
  poly([[14, 44], [14, 20], [20, 20], [27, 29], [34, 20], [40, 20], [40, 44], [34, 44], [34, 30], [27, 39], [20, 30], [20, 44]], rgb(244, 241, 234));
  poly([[46, 20], [51, 20], [51, 34], [56, 34], [48.5, 44], [41, 34], [46, 34]], rgb(143, 184, 255));

  $.NSGraphicsContext.restoreGraphicsState;
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  if (!png.writeToFileAtomically(out, true)) throw new Error('could not write ' + out);
  return out;
}
