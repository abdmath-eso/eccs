import makeQr from 'qrcode-generator';
import { StyleSheet, View } from 'react-native';

interface QrCodeProps {
  /** What the code holds: the address of the customer page. */
  value: string;
  /** Width and height on screen, the white margin included. */
  size: number;
  /** Read out by screen readers in place of the picture. */
  label: string;
}

/**
 * A QR code drawn from plain squares, so it needs no image or drawing package:
 * the `qrcode-generator` library (pure JavaScript) works out which squares are
 * dark, and each run of dark squares in a row is one black box.
 *
 * Always black on white, whatever the app's theme, with the white margin of four
 * squares the QR standard asks for: a code on a dark background, or with no
 * margin, is the usual reason a phone camera fails to read one. Error correction
 * "Q" lets about a quarter of the code be damaged and still scan.
 */
export function QrCode({ value, size, label }: QrCodeProps) {
  const code = makeQr(0, 'Q');
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  const quiet = 4;
  // Whole pixels per square, so the squares meet without hairlines between them.
  const cell = Math.max(1, Math.floor(size / (count + quiet * 2)));
  const side = cell * (count + quiet * 2);

  const rows = [];
  for (let row = 0; row < count; row += 1) {
    const runs = [];
    let start = -1;
    for (let column = 0; column <= count; column += 1) {
      const dark = column < count && code.isDark(row, column);
      if (dark && start < 0) start = column;
      if (!dark && start >= 0) {
        runs.push(
          <View key={start} style={[styles.dark, { left: start * cell, width: (column - start) * cell, height: cell }]} />,
        );
        start = -1;
      }
    }
    rows.push(
      <View key={row} style={{ height: cell, width: count * cell }}>
        {runs}
      </View>,
    );
  }

  return (
    // A QR code is never mirrored: it is drawn left to right in every language, so plain
    // `left` is right here although the rest of the app uses `start` and `end`.
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.frame, { width: side, height: side, padding: quiet * cell }]}>
      {rows}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: '#FFFFFF', alignItems: 'flex-start' },
  dark: { position: 'absolute', top: 0, backgroundColor: '#000000' },
});
