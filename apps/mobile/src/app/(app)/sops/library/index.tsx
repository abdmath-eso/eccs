import Ionicons from '@expo/vector-icons/Ionicons';
import type { SopCategory, SopLibraryItemDto, SopLibraryOverviewDto } from '@eccs/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';
import { getJson, setJson } from '@/lib/storage';

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DELAY_MS = 300;
// The last few searches are kept on the phone and offered again under the empty search box.
const RECENT_KEY = 'eccs.sopSearches';
const MAX_RECENT = 5;

/**
 * The library of ready-made SOPs. There are several hundred, so nobody is
 * shown them all: the person types what they are looking for, or picks a
 * category and then a section, and opens one to read and add it.
 */
export default function SopLibraryScreen() {
  const theme = useTheme();
  const { outletId } = useLocalSearchParams<{ outletId: string }>();
  const { t, api, language } = useSession();
  const { forwardIcon } = useDirection();
  const [overview, setOverview] = useState<SopLibraryOverviewDto | null>(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<SopCategory | null>(null);
  const [section, setSection] = useState<string | null>(null);
  // What was found last, and which search or section it was found for. While the next
  // one loads, the old list stays on screen, dimmed, instead of blanking on every letter.
  const [results, setResults] = useState<{ wanted: string; items: SopLibraryItemDto[] } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Counts presses of "Try again", so a failed load is run again.
  const [attempt, setAttempt] = useState(0);

  const search = text.trim();
  const searching = search.length >= MIN_SEARCH_LENGTH;
  const sections = overview?.categories.find((entry) => entry.category === category)?.sections ?? [];
  // Names what should be on screen now, to tell fresh results from left-over ones.
  const wanted = searching ? `search:${search}` : category ? `browse:${category}:${section ?? ''}` : null;
  const query = searching ? { search } : category ? { category, ...(section && { section }) } : null;

  useEffect(() => {
    let cancelled = false;
    api.sops.library
      .overview(outletId)
      .then((loaded) => {
        if (cancelled) return;
        setOverview(loaded);
        setOverviewError(null);
      })
      .catch((e) => !cancelled && setOverviewError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, language, attempt]);

  useEffect(() => {
    let cancelled = false;
    getJson<string[]>(RECENT_KEY)
      .then((kept) => {
        if (!cancelled && Array.isArray(kept)) setRecent(kept.filter((entry) => typeof entry === 'string'));
      })
      // Without the remembered searches the screen simply shows none.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Loads what is being looked at: the search if there is one, otherwise the chosen
  // section. Typing waits for a pause first. Runs again on coming back from an SOP,
  // so one just added shows as added.
  useFocusEffect(
    useCallback(() => {
      if (!wanted || !query) return;
      let cancelled = false;
      const timer = setTimeout(
        () => {
          api.sops.library
            .search(outletId, query)
            .then((found) => {
              if (cancelled) return;
              setResults({ wanted, items: found });
              setSearchError(null);
            })
            .catch((e) => !cancelled && setSearchError(errorMessage(e, t)));
        },
        searching ? SEARCH_DELAY_MS : 0,
      );
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
      // `query` is rebuilt on every draw; `wanted` changes exactly when it does.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, outletId, wanted, language, attempt]),
  );

  /** Pulling down loads the categories and the current list again. */
  async function refresh() {
    try {
      setOverview(await api.sops.library.overview(outletId));
      setOverviewError(null);
    } catch (e) {
      setOverviewError(errorMessage(e, t));
    }
    if (!wanted || !query) return;
    try {
      setResults({ wanted, items: await api.sops.library.search(outletId, query) });
      setSearchError(null);
    } catch (e) {
      setSearchError(errorMessage(e, t));
    }
  }

  function openCategory(next: SopCategory | null) {
    const inside = overview?.categories.find((entry) => entry.category === next)?.sections ?? [];
    setCategory(next);
    // A category with several sections opens on its first one.
    setSection(inside.length > 1 ? inside[0]!.name : null);
    setResults(null);
    setSearchError(null);
  }

  /** Puts a search at the front of the remembered ones. Called when it was run on purpose or led somewhere. */
  function remember(term: string) {
    if (term.length < MIN_SEARCH_LENGTH) return;
    const next = [term, ...recent.filter((entry) => entry.toLowerCase() !== term.toLowerCase())].slice(0, MAX_RECENT);
    setRecent(next);
    void setJson(RECENT_KEY, next).catch(() => undefined);
  }

  function forgetRecent() {
    setRecent([]);
    void setJson(RECENT_KEY, []).catch(() => undefined);
  }

  const showingResults = wanted !== null;
  // Left over from the search or section before this one, while the new one loads.
  const stale = results !== null && results.wanted !== wanted;
  const waiting = showingResults && !searchError && (results === null || stale);

  // Inside a category, going back returns to the list of categories; from that list it
  // leaves the library. The phone's own back button does the same as the one on screen.
  useFocusEffect(
    useCallback(() => {
      // A browser has no such button, and React Native warns if it is asked for one.
      if (category === null || Platform.OS === 'web') return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        openCategory(null);
        return true;
      });
      return () => subscription.remove();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [category]),
  );

  return (
    <Screen
      back
      {...(category !== null && { backLabel: t('soplib.allCategories'), onBack: () => openCategory(null) })}
      title={t('soplib.title')}
      subtitle={overview ? t('soplib.help', { count: overview.total }) : undefined}
      onRefresh={refresh}>
      {/* ── The search box: a magnifying glass where the typing starts, and a cross to empty it once there is text ── */}
      <View>
        <TextField
          label={t('soplib.searchAll')}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setSearchError(null);
          }}
          onSubmitEditing={() => remember(search)}
          placeholder={t('soplib.search')}
          maxLength={80}
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
        <View pointerEvents="none" style={styles.searchIcon}>
          <Ionicons name="search" size={22} color={theme.textSecondary} />
        </View>
        {text.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.clear')}
            onPress={() => setText('')}
            style={styles.clear}>
            <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>
      {search.length > 0 && !searching && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('soplib.typeMore')}
        </ThemedText>
      )}

      {/* ── Earlier searches, offered while the box is empty ── */}
      {text.length === 0 && category === null && recent.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('soplib.recent')}
          </ThemedText>
          <View style={styles.chips}>
            {recent.map((term) => (
              <Pressable
                key={term}
                accessibilityRole="button"
                accessibilityLabel={t('soplib.searchFor', { text: term })}
                onPress={() => {
                  setText(term);
                  remember(term);
                }}
                style={({ pressed }) => [
                  styles.recent,
                  { borderColor: theme.outline },
                  pressed && { backgroundColor: theme.backgroundElement },
                ]}>
                <Ionicons name="time-outline" size={20} color={theme.textSecondary} />
                <ThemedText type="default" numberOfLines={1} style={styles.recentText}>
                  {term}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <Button label={t('soplib.clearRecent')} variant="link" onPress={forgetRecent} />
        </>
      )}

      <ErrorText
        message={overviewError}
        onRetry={() => {
          setOverviewError(null);
          setAttempt((count) => count + 1);
        }}
      />
      {!overview && !overviewError && <ActivityIndicator color={theme.primary} />}

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
              <Ionicons name={forwardIcon} size={22} color={theme.textSecondary} />
            </Pressable>
          ))}
        </>
      )}

      {!searching && category !== null && (
        <>
          <ThemedText type="default" style={styles.categoryTitle}>
            {t(`sopCategory.${category}`)}
          </ThemedText>
          {sections.length > 1 && (
            <View style={styles.chips} accessibilityRole="radiogroup">
              {sections.map((entry) => (
                <OptionChip
                  key={entry.name}
                  label={`${entry.label ?? entry.name} · ${t('soplib.count', { count: entry.count })}`}
                  selected={entry.name === section}
                  onPress={() => setSection(entry.name)}
                />
              ))}
            </View>
          )}
        </>
      )}

      {/* ── What was found ── */}
      {searching && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {results && !stale ? t('soplib.foundAll', { count: results.items.length }) : t('soplib.searchingAll')}
        </ThemedText>
      )}
      <ErrorText
        message={showingResults ? searchError : null}
        onRetry={() => {
          setSearchError(null);
          setAttempt((count) => count + 1);
        }}
      />
      {waiting && <ActivityIndicator color={theme.primary} />}
      {showingResults && results && !stale && results.items.length === 0 && (
        <View style={styles.empty}>
          <ThemedText type="default" themeColor="textSecondary">
            {searching ? t('soplib.noneFor', { text: search }) : t('soplib.none')}
          </ThemedText>
          {searching && (
            <>
              <Button
                label={t('soplib.browseInstead')}
                variant="secondary"
                onPress={() => {
                  setText('');
                  openCategory(null);
                }}
              />
              <Button
                label={`+  ${t('sops.writeOwn')}`}
                variant="link"
                onPress={() => router.push({ pathname: '/sops/edit', params: { outletId } })}
              />
            </>
          )}
        </View>
      )}
      {showingResults && results && (
        <View style={[styles.results, stale && styles.stale]}>
          {results.items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => {
                // A search that led to an SOP being opened is worth offering again.
                if (searching) remember(search);
                router.push({ pathname: '/sops/library/[itemId]', params: { itemId: item.id, outletId } });
              }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
              ]}>
              <View style={styles.rowText}>
                <ThemedText type="default" style={styles.itemTitle}>
                  {item.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {/* A search covers every category, so each result says which one it is from. */}
                  {results.wanted.startsWith('search:') ? `${t(`sopCategory.${item.category}`)} · ` : ''}
                  {item.sectionLabel ?? item.section}
                </ThemedText>
              </View>
              {item.addedSopId ? (
                <ThemedText type="smallBold" themeColor="primary">
                  ✓ {t('soplib.added')}
                </ThemedText>
              ) : (
                <Ionicons name={forwardIcon} size={22} color={theme.textSecondary} />
              )}
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Room for the magnifying glass where the typing starts (the left; the right in Urdu)
  // and for the cross at the other end.
  searchInput: { paddingStart: Spacing.three + 22 + Spacing.two, paddingEnd: MinTouchSize },
  searchIcon: {
    position: 'absolute',
    start: Spacing.three,
    bottom: 0,
    height: MinTouchSize,
    justifyContent: 'center',
  },
  clear: {
    position: 'absolute',
    end: 0,
    bottom: 0,
    width: MinTouchSize,
    height: MinTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    maxWidth: '100%',
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: MinTouchSize / 2,
    paddingHorizontal: Spacing.three,
  },
  recentText: { flexShrink: 1 },
  results: { gap: Spacing.three },
  stale: { opacity: 0.45 },
  empty: { gap: Spacing.two },
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
  itemTitle: { fontWeight: 700 },
  categoryTitle: { fontWeight: 700, fontSize: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
