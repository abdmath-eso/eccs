import Ionicons from '@expo/vector-icons/Ionicons';
import type { SopCategory, SopLibraryItemDto, SopLibraryOverviewDto } from '@eccs/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DELAY_MS = 300;

/**
 * The library of ready-made SOPs. There are several hundred, so nobody is
 * shown them all: the person types what they are looking for, or picks a
 * category and then a section, and opens one to read and add it.
 */
export default function SopLibraryScreen() {
  const theme = useTheme();
  const { outletId } = useLocalSearchParams<{ outletId: string }>();
  const { t, api } = useSession();
  const [overview, setOverview] = useState<SopLibraryOverviewDto | null>(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<SopCategory | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [results, setResults] = useState<SopLibraryItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = text.trim();
  const searching = search.length >= MIN_SEARCH_LENGTH;
  const sections = overview?.categories.find((entry) => entry.category === category)?.sections ?? [];

  useEffect(() => {
    let cancelled = false;
    api.sops.library
      .overview(outletId)
      .then((loaded) => !cancelled && setOverview(loaded))
      .catch((e) => !cancelled && setError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  // Loads what is being looked at: the search if there is one, otherwise the chosen
  // section. Typing waits for a pause first. Runs again on coming back from an SOP,
  // so one just added shows as added.
  useFocusEffect(
    useCallback(() => {
      if (!searching && !category) return;
      let cancelled = false;
      const timer = setTimeout(
        () => {
          api.sops.library
            .search(outletId, searching ? { search } : { category: category!, ...(section && { section }) })
            .then((found) => {
              if (cancelled) return;
              setResults(found);
              setError(null);
            })
            .catch((e) => !cancelled && setError(errorMessage(e, t)));
        },
        searching ? SEARCH_DELAY_MS : 0,
      );
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, outletId, search, searching, category, section]),
  );

  function openCategory(next: SopCategory | null) {
    const inside = overview?.categories.find((entry) => entry.category === next)?.sections ?? [];
    setCategory(next);
    // A category with several sections opens on its first one.
    setSection(inside.length > 1 ? inside[0]!.name : null);
    setResults(null);
  }

  const showingResults = searching || category !== null;

  return (
    <Screen
      back
      title={t('soplib.title')}
      subtitle={overview ? t('soplib.help', { count: overview.total }) : undefined}>
      <TextField
        value={text}
        onChangeText={(next) => {
          setText(next);
          setResults(null);
        }}
        accessibilityLabel={t('soplib.search')}
        placeholder={t('soplib.search')}
        maxLength={80}
        autoCorrect={false}
        returnKeyType="search"
      />

      <ErrorText message={error} />
      {!overview && !error && <ActivityIndicator color={theme.primary} />}

      {/* ── Browsing: categories first, then the sections inside the chosen one ── */}
      {!searching && category === null && overview && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('soplib.browse')}
          </ThemedText>
          {overview.categories.map((entry) => (
            <Pressable
              key={entry.category}
              accessibilityRole="button"
              onPress={() => openCategory(entry.category)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
              ]}>
              <ThemedText type="default" style={styles.rowTitle}>
                {t(`sopCategory.${entry.category}`)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('soplib.count', { count: entry.count })}
              </ThemedText>
              <Ionicons name="chevron-forward" size={22} color={theme.textSecondary} />
            </Pressable>
          ))}
        </>
      )}

      {!searching && category !== null && (
        <>
          <Pressable accessibilityRole="button" onPress={() => openCategory(null)} style={styles.backToAll}>
            <ThemedText type="default" themeColor="primary">
              ‹ {t('soplib.allCategories')}
            </ThemedText>
          </Pressable>
          <ThemedText type="default" style={styles.categoryTitle}>
            {t(`sopCategory.${category}`)}
          </ThemedText>
          {sections.length > 1 && (
            <View style={styles.chips}>
              {sections.map((entry) => {
                const selected = entry.name === section;
                return (
                  <Pressable
                    key={entry.name}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSection(entry.name);
                      setResults(null);
                    }}
                    style={[
                      styles.chip,
                      { borderColor: selected ? theme.primary : theme.border },
                      selected && { backgroundColor: theme.backgroundElement },
                    ]}>
                    <ThemedText type="small" themeColor={selected ? 'primary' : 'text'}>
                      {entry.label} · {t('soplib.count', { count: entry.count })}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}

      {/* ── What was found ── */}
      {showingResults && results === null && !error && <ActivityIndicator color={theme.primary} />}
      {showingResults && results?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('soplib.none')}
        </ThemedText>
      )}
      {showingResults &&
        results?.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/sops/library/[itemId]', params: { itemId: item.id, outletId } })}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <View style={styles.rowText}>
              <ThemedText type="default" style={styles.rowTitle}>
                {item.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.sectionLabel}
              </ThemedText>
            </View>
            {item.addedSopId ? (
              <ThemedText type="smallBold" themeColor="primary">
                ✓ {t('soplib.added')}
              </ThemedText>
            ) : (
              <Ionicons name="chevron-forward" size={22} color={theme.textSecondary} />
            )}
          </Pressable>
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize * 1.2,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowTitle: { flex: 1, fontWeight: 700 },
  backToAll: { minHeight: MinTouchSize - 8, justifyContent: 'center' },
  categoryTitle: { fontWeight: 700, fontSize: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: MinTouchSize - 8,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
});
