import makeQr from "qrcode-generator";

/**
 * A QR code for an address, as an SVG picture: sharp at any print size and
 * small enough to sit inside the page itself. Made by the `qrcode-generator`
 * library (pure JavaScript, no other packages).
 *
 * Error correction "Q" lets about a quarter of the code be scuffed or covered
 * and still scan, which suits a code that lives on a restaurant table. The
 * white margin of four squares all round (the "quiet zone") is part of the QR
 * standard: scanners need it to find the code.
 */
export function qrSvg(text: string, label: string): string {
  const code = makeQr(0, "Q");
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  const quiet = 4;
  const size = count + quiet * 2;

  // One short path instruction per run of dark squares in a row.
  let path = "";
  for (let row = 0; row < count; row += 1) {
    let start = -1;
    for (let column = 0; column <= count; column += 1) {
      const dark = column < count && code.isDark(row, column);
      if (dark && start < 0) start = column;
      if (!dark && start >= 0) {
        path += `M${start + quiet} ${row + quiet}h${column - start}v1h-${column - start}z`;
        start = -1;
      }
    }
  }
  const title = label.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${title}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  );
}
