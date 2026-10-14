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

/**
 * A legal document drawn from its Markdown (parseLegalMarkdown in packages/shared,
 * the same reading the public web pages use): headings in bold, lists indented,
 * links that open in the browser. `skipTitle` leaves out the document's own
 * "# " title when the screen already shows it.
 */
export function LegalText({ markdown, skipTitle }: { markdown: string; skipTitle?: boolean }) {
  const blocks = parseLegalMarkdown(markdown);
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
          case 'h2':
          case 'h3':
            return (
              <ThemedText key={index} type="default" accessibilityRole="header" style={block.type === 'h2' ? styles.h2 : styles.h3}>
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
  list: { gap: Spacing.two, paddingStart: Spacing.two },
  item: { flexDirection: 'row', gap: Spacing.two },
  marker: { minWidth: 24, lineHeight: 26 },
  itemText: { flex: 1, lineHeight: 26 },
  box: { borderWidth: 1.5, borderRadius: Spacing.three, overflow: 'hidden' },
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
