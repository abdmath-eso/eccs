import { parseLegalMarkdown, type LegalInline } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDirection } from '@/lib/direction';

/** Bold and links inside a line. Plain `Text`, so each stretch keeps the size of the line it is in. */
function Inline({ content }: { content: LegalInline[] }) {
  const theme = useTheme();
  return content.map((run, index) =>
    run.type === 'bold' ? (
      <Text key={index} style={styles.bold}>
        {run.text}
      </Text>
    ) : run.type === 'link' ? (
      // Underlined as well as coloured, so a link never relies on colour alone. Opens in the browser.
      <Text
        key={index}
        accessibilityRole="link"
        style={[styles.link, { color: theme.primary }]}
        onPress={() => void Linking.openURL(run.href).catch(() => undefined)}>
        {run.text}
      </Text>
    ) : (
      <Text key={index}>{run.text}</Text>
    ),
  );
}

/** The main headings of a legal document, in order, for its contents list. */
export function legalHeadings(markdown: string): string[] {
  return parseLegalMarkdown(markdown)
    .filter((block) => block.type === 'h2')
    .map((block) => ('content' in block ? block.content.map((run) => run.text).join('') : ''));
}

/**
 * A legal document drawn from its Markdown (parseLegalMarkdown in packages/shared,
 * the same reading the public web pages use): headings in bold, lists indented,
 * links that open in the browser. `skipTitle` leaves out the document's own
 * "# " title when the screen already shows it. `onHeading` is told where each main
 * heading sits within the document, for the contents list to jump to it.
 */
export function LegalText({
  markdown,
  skipTitle,
  onHeading,
}: {
  markdown: string;
  skipTitle?: boolean;
  onHeading?: (position: number, y: number) => void;
}) {
  const blocks = parseLegalMarkdown(markdown);
  // Each main heading's place among the main headings, matching legalHeadings().
  const mainHeadings = blocks.flatMap((block, index) => (block.type === 'h2' ? [index] : []));
  return (
    <View style={styles.document}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'title':
            return skipTitle ? null : (
              <ThemedText key={index} type="default" accessibilityRole="header" style={styles.title}>
                <Inline content={block.content} />
              </ThemedText>
            );
          case 'h2': {
            const position = mainHeadings.indexOf(index);
            return (
              <ThemedText
                key={index}
                type="default"
                accessibilityRole="header"
                onLayout={onHeading && ((event) => onHeading(position, event.nativeEvent.layout.y))}
                style={styles.h2}>
                <Inline content={block.content} />
              </ThemedText>
            );
          }
          case 'h3':
            return (
              <ThemedText key={index} type="default" accessibilityRole="header" style={styles.h3}>
                <Inline content={block.content} />
              </ThemedText>
            );
          case 'p':
            return (
              <ThemedText key={index} type="default" style={styles.paragraph}>
                <Inline content={block.content} />
              </ThemedText>
            );
          case 'ul':
          case 'ol':
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, position) => (
                  <View key={position} style={styles.item}>
                    <ThemedText type="default" style={styles.marker} importantForAccessibility="no">
                      {block.type === 'ul' ? '•' : `${block.start + position}.`}
                    </ThemedText>
                    <ThemedText type="default" style={styles.itemText}>
                      <Inline content={item} />
                    </ThemedText>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

/** A box holding a list of documents, one row each (LegalDocRow). */
export function LegalDocList({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.box, { borderColor: theme.border }]}>{children}</View>;
}

interface LegalDocRowProps {
  title: string;
  /** A quiet line under the title, such as when the person agreed to it. */
  note?: string | null;
  /** What a screen reader says the row does. */
  hint: string;
  onPress: () => void;
  icon?: 'document-text-outline' | 'trash-outline';
  /** The first row has no line above it. */
  first?: boolean;
}

/** One document in a LegalDocList: its title, a note, and an arrow; tapping opens it. */
export function LegalDocRow({ title, note, hint, onPress, icon = 'document-text-outline', first }: LegalDocRowProps) {
  const theme = useTheme();
  const { forwardIcon } = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
        pressed && { backgroundColor: theme.backgroundElement },
      ]}>
      <Ionicons name={icon} size={22} color={theme.primary} />
      <View style={styles.rowText}>
        <ThemedText type="default" style={styles.rowTitle}>
          {title}
        </ThemedText>
        {note && (
          <ThemedText type="small" themeColor="textSecondary">
            {note}
          </ThemedText>
        )}
      </View>
      <Ionicons name={forwardIcon} size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  document: { gap: Spacing.three },
  bold: { fontWeight: 700 },
  link: { textDecorationLine: 'underline' },
  title: { fontSize: 24, lineHeight: 32, fontWeight: 700 },
  h2: { fontSize: 20, lineHeight: 28, fontWeight: 700, marginTop: Spacing.two },
  h3: { fontSize: 17, lineHeight: 24, fontWeight: 700 },
  paragraph: { lineHeight: 26 },
  // The marker on the text's own edge and the words just after it (until 22 Oct 2026 they started
  // 40 in, which read as belonging to something above).
  list: { gap: Spacing.two },
  item: { flexDirection: 'row', gap: Spacing.two },
  marker: { minWidth: Spacing.three, lineHeight: 26 },
  itemText: { flex: 1, lineHeight: 26 },
  box: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouchSize,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowTitle: { fontWeight: 700 },
});
