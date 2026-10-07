import Ionicons from '@expo/vector-icons/Ionicons';
import { localize, type ChecklistSuggestionDto, type OutletChecklistDto } from '@eccs/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DELAY_MS = 300;

interface ChecklistItemSearchProps {
  outletChecklistId: string;
  /** Called with the outlet's updated checklists after an item is added. */
  onAdded: (lists: OutletChecklistDto[]) => void;
}

/**
 * The box for adding an item to a checklist. As the person types, matching
 * ready-made checks from the library appear underneath; tapping one adds it.
 * If nothing fits, they add exactly what they typed as their own item.
 */
export function ChecklistItemSearch({ outletChecklistId, onAdded }: ChecklistItemSearchProps) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const [text, setText] = useState('');
  // The matches last received, with the search they answer, so old matches are never taken for new ones.
  const [found, setFound] = useState<{ key: string; items: ChecklistSuggestionDto[] } | null>(null);
  // The search that could not reach the server, if the latest one did not.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // Bumped by "Try again" to repeat the same search.
  const [attempt, setAttempt] = useState(0);
  // Whether the next item added needs a proof photo. Photo is the default.
  const [photoRequired, setPhotoRequired] = useState(true);

  const search = text.trim();
  const searchable = search.length >= MIN_SEARCH_LENGTH;
  const key = `${attempt}:${search}`;
  const failed = searchable && failedKey === key;
  const loading = searchable && !failed && found?.key !== key;
  // Matches for an earlier search stay on screen, dimmed and not tappable, until the new ones arrive.
  const stale = found !== null && found.key !== key;

  // Waits for a pause in typing, then asks for matches. A newer keystroke cancels the older request.
  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.checklists
        .suggestions(outletChecklistId, search)
        .then((items) => !cancelled && setFound({ key, items }))
        .catch(() => !cancelled && setFailedKey(key));
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, outletChecklistId, search, searchable, key]);

  function change(next: string) {
    setText(next);
    setAddError(null);
    if (next.trim().length < MIN_SEARCH_LENGTH) setFound(null);
  }

  async function add(which: string, input: { label: string } | { libraryItemId: string }) {
    setAdding(which);
    setAddError(null);
    try {
      onAdded(await api.checklists.addItem(outletChecklistId, { ...input, photoRequired }));
      // Start clean for the next item, whichever way this one was added.
      setText('');
      setFound(null);
      notify(t('setup.itemAdded'));
    } catch (e) {
      setAddError(errorMessage(e, t));
    } finally {
      setAdding(null);
    }
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <TextField
            label={t('setup.addLabel')}
            value={text}
            onChangeText={change}
            placeholder={t('setup.searchPlaceholder')}
            maxLength={160}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {text.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.clear')}
            onPress={() => change('')}
            style={styles.clear}>
            <Ionicons name="close-circle" size={28} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>
      {/* Under the search box, where the person is looking when an add fails. */}
      <ErrorText message={addError} />

      {searchable && (
        <View style={styles.proof}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('setup.proofLabel')}
          </ThemedText>
          <View style={styles.proofOptions} accessibilityRole="radiogroup">
            {([true, false] as const).map((value) => (
              <OptionChip
                key={String(value)}
                label={t(value ? 'setup.photoNeeded' : 'setup.tickOnly')}
                selected={photoRequired === value}
                onPress={() => setPhotoRequired(value)}
              />
            ))}
          </View>
          {!photoRequired && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('setup.tickOnlyHelp')}
            </ThemedText>
          )}
        </View>
      )}

      {loading && (
        <View style={styles.searching} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.primary} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('setup.searching')}
          </ThemedText>
        </View>
      )}

      {/* A search that did not reach the server is not the same as a search that found nothing. */}
      {failed && <ErrorText message={t('setup.searchFailed')} onRetry={() => setAttempt((count) => count + 1)} />}

      {searchable && !failed && found !== null && found.items.length > 0 && (
        <View style={[styles.results, { borderColor: theme.border }, stale && styles.stale]}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.resultsTitle}>
            {t('setup.suggestions')}
          </ThemedText>
          {found.items.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: stale || adding !== null, busy: adding === suggestion.id }}
              disabled={stale || adding !== null}
              onPress={() => void add(suggestion.id, { libraryItemId: suggestion.id })}
              style={({ pressed }) => [
                styles.result,
                { borderColor: theme.border },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <View style={styles.resultText}>
                <ThemedText type="default">{localize(suggestion.text, language)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {suggestion.checklistName} · {suggestion.category}
                </ThemedText>
              </View>
              {adding === suggestion.id ? (
                <ActivityIndicator color={theme.primary} />
              ) : (
                <Ionicons name="add-circle" size={30} color={theme.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}

      {searchable && !loading && !failed && found !== null && found.items.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('setup.noMatches')}
        </ThemedText>
      )}

      {searchable && (
        <Button
          label={t('setup.addOwn', { text: search })}
          variant="secondary"
          onPress={() => void add('own', { label: search })}
          loading={adding === 'own'}
          disabled={adding !== null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  // The clear button sits beside the box, level with it (the label is above the box).
  searchRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.one },
  searchField: { flex: 1 },
  clear: { width: MinTouchSize, height: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  proof: { gap: Spacing.two },
  proofOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  searching: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  results: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  stale: { opacity: 0.45 },
  resultsTitle: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
  },
  resultText: { flex: 1, gap: Spacing.half },
});
