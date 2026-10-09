import Ionicons from '@expo/vector-icons/Ionicons';
import { DAY_MARKS, LABEL_SIZES, type LabelPrintData, type LabelSize } from '@eccs/shared';
import { StyleSheet, Text, View } from 'react-native';

import { DirectionView } from '@/components/direction-view';

/**
 * The mark for a day of the week: each day has its own shape, so the day can
 * be told at a glance without reading and without relying on colour. On the
 * printed label it is black (a thermal printer has no colours); on the
 * phone's lists it also takes the day's usual "day dot" colour. It never
 * stands alone: the day is always written beside it as a word.
 */
export function DayMark({ dayIndex, size, ink = false }: { dayIndex: number; size: number; ink?: boolean }) {
  const mark = DAY_MARKS[dayIndex % 7]!;
  const color = ink ? '#000000' : mark.color;
  const bar = size * 0.22;

  if (mark.shape === 'cross') {
    return (
      <View style={[styles.center, { width: size, height: size }]}>
        <View style={{ position: 'absolute', width: size * 0.9, height: bar * 1.4, backgroundColor: color }} />
        <View style={{ position: 'absolute', width: bar * 1.4, height: size * 0.9, backgroundColor: color }} />
      </View>
    );
  }
  if (mark.shape === 'stripes') {
    return (
      <View style={[styles.stripes, { width: size, height: size }]}>
        {[0, 1, 2].map((stripe) => (
          <View key={stripe} style={{ width: size * 0.9, height: bar, backgroundColor: color }} />
        ))}
      </View>
    );
  }
  const icon = { circle: 'ellipse', triangle: 'triangle', square: 'square', diamond: 'diamond', star: 'star' } as const;
  return <Ionicons name={icon[mark.shape]} size={size} color={color} />;
}

// How wide the label is drawn on the phone.
const PREVIEW_WIDTH = 304;

/**
 * The label as it will print, drawn on the phone: black on white whatever
 * the phone's theme, in the same arrangement as the printed one (the printed
 * layout itself is `labelsHtml` in @eccs/shared; keep the two in step).
 */
export function FoodLabelPreview({ label, size }: { label: LabelPrintData; size: Exclude<LabelSize, 'A4'> }) {
  const { widthMm, heightMm } = LABEL_SIZES[size];
  const perMm = PREVIEW_WIDTH / widthMm;
  // As in the printed layout: every measurement is a share of the label's height.
  const em = (heightMm / 30) * perMm;
  const direction = label.rtl ? ('rtl' as const) : ('ltr' as const);
  const text = { color: '#000000', writingDirection: direction };

  return (
    <DirectionView
      // A label reads the way its language does, whatever is around it.
      direction={direction}
      accessible
      accessibilityRole="image"
      accessibilityLabel={[label.itemName, `${label.preparedHeading} ${label.preparedText}`, `${label.useByHeading} ${label.useByText}`, ...label.lines].join('. ')}
      style={[styles.label, { width: PREVIEW_WIDTH, height: heightMm * perMm, paddingVertical: 1.4 * em, paddingHorizontal: 1.8 * em }]}>
      <Text numberOfLines={2} style={[text, { fontSize: 4.6 * em, lineHeight: 5.15 * em, fontWeight: 800 }]}>
        {label.itemName}
      </Text>
      <Text numberOfLines={1} style={[text, { fontSize: 2.7 * em, lineHeight: 3.4 * em, marginTop: 0.5 * em }]}>
        <Text style={[styles.heading, { fontSize: 2.1 * em }]}>{label.preparedHeading.toLocaleUpperCase()} </Text>
        {label.preparedText}
      </Text>
      <View style={[styles.useBy, { borderWidth: Math.max(1.5, 0.45 * em), paddingHorizontal: 1.1 * em, marginTop: 0.5 * em }]}>
        <Text numberOfLines={1} style={[text, { fontSize: 3.2 * em, lineHeight: 4.2 * em, fontWeight: 800 }]}>
          <Text style={[styles.heading, { fontSize: 2.5 * em }]}>{label.useByHeading.toLocaleUpperCase()} </Text>
          {label.useByText}
        </Text>
      </View>
      <View style={[styles.foot, { gap: 2.5 * em, marginTop: 1.2 * em }]}>
        <View style={styles.day}>
          <DayMark dayIndex={label.dayIndex} size={5.4 * em} ink />
          <Text numberOfLines={1} style={[text, { fontSize: 2.1 * em, fontWeight: 800 }]}>
            {label.dayWord}
          </Text>
        </View>
        <View style={styles.lines}>
          {label.lines.map((line) => (
            <Text key={line} numberOfLines={1} style={[text, { fontSize: 2.1 * em, lineHeight: 2.6 * em }]}>
              {line}
            </Text>
          ))}
          <Text numberOfLines={1} style={[text, { fontSize: 1.8 * em, lineHeight: 2.4 * em }]}>
            {label.outletName}
          </Text>
        </View>
      </View>
    </DirectionView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  stripes: { alignItems: 'center', justifyContent: 'space-evenly' },
  label: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#7A858C',
    borderRadius: 4,
    overflow: 'hidden',
  },
  heading: { fontWeight: 800 },
  useBy: { borderColor: '#000000' },
  foot: { flexDirection: 'row', flex: 1, overflow: 'hidden' },
  day: { alignItems: 'center', gap: 2 },
  lines: { flex: 1 },
});
