import Ionicons from '@expo/vector-icons/Ionicons';
import { localize, type ChecklistSuggestionDto, type OutletChecklistDto } from '@eccs/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
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
  onError: (message: string | null) => void;
}

/**
 * The box for adding an item to a checklist. As the person types, matching
 * ready-made checks from the library appear underneath; tapping one adds it.
 * If nothing fits, they add exactly what they typed as their own item.
 */
export function ChecklistItemSearch({ outletChecklistId, onAdded, onError }: ChecklistItemSearchProps) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<ChecklistSuggestionDto[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  // Bumped after adding a suggestion so the list refreshes without it.
  const [refresh, setRefresh] = useState(0);
  // Whether the next item added needs a proof photo. Photo is the default.
  const [photoRequired, setPhotoRequired] = useState(true);

  const search = text.trim();
  const searchable = search.length >= MIN_SEARCH_LENGTH;

  // Waits for a pause in typing, then asks for matches. A newer keystroke cancels the older request.
  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.checklists
        .suggestions(outletChecklistId, search)
        .then((found) => !cancelled && setSuggestions(found))
        .catch(() => !cancelled && setSuggestions([]));
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, outletChecklistId, search, searchable, refresh]);

  function change(next: string) {
    setText(next);
    if (next.trim().length < MIN_SEARCH_LENGTH) setSuggestions(null);
  }

  async function add(key: string, input: { label: string } | { libraryItemId: string }) {
    setAdding(key);
    onError(null);
    try {
      onAdded(await api.checklists.addItem(outletChecklistId, { ...input, photoRequired }));
      if ('label' in input) {
        setText('');
        setSuggestions(null);
      } else {
        setRefresh((count) => count + 1);
      }
    } catch (e) {
      onError(errorMessage(e, t));
    } finally {
      setAdding(null);
    }
  }

  return (
    <View style={styles.wrapper}>
      <TextField
        label={t('setup.addLabel')}
        value={text}
        onChangeText={change}
        placeholder={t('setup.searchPlaceholder')}
        maxLength={160}
        autoCorrect={false}
        returnKeyType="search"
      />

      {searchable && (
        <View style={styles.proof}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('setup.proofLabel')}
          </ThemedText>
          <View style={styles.proofOptions}>
            {([true, false] as const).map((value) => {
              const selected = photoRequired === value;
              return (
                <Pressable
                  key={String(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setPhotoRequired(value)}
                  style={[
                    styles.proofOption,
                    { borderColor: selected ? theme.primary : theme.border },
                    selected && { backgroundColor: theme.backgroundElement },
                  ]}>
                  <Ionicons
                    name={value ? 'camera' : 'checkmark-circle-outline'}
                    size={22}
                    color={selected ? theme.primary : theme.textSecondary}
                  />
                  <ThemedText type="default" themeColor={selected ? 'primary' : 'text'}>
                    {t(value ? 'setup.photoNeeded' : 'setup.tickOnly')}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          {!photoRequired && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('setup.tickOnlyHelp')}
            </ThemedText>
          )}
        </View>
      )}

      {searchable && suggestions === null && <ActivityIndicator color={theme.primary} />}

      {searchable && suggestions !== null && suggestions.length > 0 && (
        <View style={[styles.results, { borderColor: theme.border }]}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.resultsTitle}>
            {t('setup.suggestions')}
          </ThemedText>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              accessibilityRole="button"
              disabled={adding !== null}
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

      {searchable && suggestions !== null && suggestions.length === 0 && (
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
  proof: { gap: Spacing.two },
  proofOptions: { flexDirection: 'row', gap: Spacing.two },
  proofOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  results: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
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
