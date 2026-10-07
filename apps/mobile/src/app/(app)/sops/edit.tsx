import Ionicons from '@expo/vector-icons/Ionicons';
import { SOP_CATEGORIES, SOP_LANGUAGES, type SopCategory, type SopLanguage } from '@eccs/shared';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

const MAX_STEPS = 30;

// Each step keeps a key of its own, so its text box stays with it when steps are moved or removed.
interface Step {
  key: number;
  text: string;
}
let lastKey = 0;
const newStep = (text = ''): Step => ({ key: ++lastKey, text });

/** What would be saved, as one string: used to tell whether anything has been changed. */
const snapshot = (title: string, category: SopCategory, steps: Step[]) =>
  JSON.stringify([title.trim(), category, steps.map((step) => step.text.trim()).filter(Boolean)]);

/**
 * Where the Owner or Manager writes an SOP for their outlet, or changes one
 * they wrote: a name, a category and the steps in order.
 */
export default function EditSopScreen() {
  const theme = useTheme();
  const { outletId, sopId } = useLocalSearchParams<{ outletId: string; sopId?: string }>();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const ownLanguage = language.toLowerCase() as SopLanguage;

  const [loading, setLoading] = useState(Boolean(sopId));
  const [attempt, setAttempt] = useState(0);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SopCategory>('CLEANING');
  const [steps, setSteps] = useState<Step[]>(() => [newStep(), newStep()]);
  // What the form held when it opened (or was loaded), to know whether there is anything to lose.
  const [original, setOriginal] = useState(() => snapshot('', 'CLEANING', []));
  // An SOP is changed in the language it was written in, whoever opens it.
  const [writtenIn, setWrittenIn] = useState<SopLanguage>(ownLanguage);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once Save has been pressed, so what is still missing is said beside it.
  const [showMissing, setShowMissing] = useState(false);
  // The step waiting for a yes before it is removed, and whether leaving is waiting for one.
  const [removing, setRemoving] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!sopId) return;
    let cancelled = false;
    (async () => {
      try {
        const sop = await api.sops.get(sopId);
        if (cancelled) return;
        const existing = sop.steps[ownLanguage]
          ? ownLanguage
          : (SOP_LANGUAGES.find((code) => sop.steps[code]) ?? ownLanguage);
        const loadedTitle = sop.title[existing] ?? '';
        const loadedSteps = (sop.steps[existing] ?? ['']).map((text) => newStep(text));
        setWrittenIn(existing);
        setTitle(loadedTitle);
        setCategory(sop.category);
        setSteps(loadedSteps);
        setOriginal(snapshot(loadedTitle, sop.category, loadedSteps));
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, sopId, attempt]);

  const written = steps.map((step) => step.text.trim()).filter(Boolean);
  const titleMissing = title.trim().length < 2;
  const stepsMissing = written.length === 0;
  const changed = !loading && !loadError && snapshot(title, category, steps) !== original;

  /** Back, Cancel and the phone's back button all come here: ask first if there is work to lose. */
  function leave() {
    if (changed && !saving) setLeaving(true);
    else router.back();
  }

  // The phone's own back button asks the same question as the one on screen.
  useFocusEffect(
    useCallback(() => {
      // A browser has no such button, and React Native warns if it is asked for one.
      if (!changed || Platform.OS === 'web') return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setLeaving(true);
        return true;
      });
      return () => subscription.remove();
    }, [changed]),
  );

  async function save() {
    if (titleMissing || stepsMissing) return setShowMissing(true);
    setSaving(true);
    setError(null);
    try {
      if (sopId) await api.sops.update(sopId, { category, title: title.trim(), steps: written, language: writtenIn });
      else await api.sops.create({ outletId, category, title: title.trim(), steps: written, language: writtenIn });
      notify(t('common.saved'));
      router.back();
    } catch (e) {
      setError(errorMessage(e, t));
      setSaving(false);
    }
  }

  /** Swaps a step with the one above (-1) or below (+1). */
  const move = (index: number, by: -1 | 1) =>
    setSteps((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const removeStep = (key: number) => setSteps((current) => current.filter((step) => step.key !== key));
  const removingIndex = steps.findIndex((step) => step.key === removing);

  const stepButton = (
    icon: ComponentProps<typeof Ionicons>['name'],
    label: string,
    onPress: () => void,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        { borderColor: theme.outline },
        pressed && { backgroundColor: theme.backgroundElement },
        disabled && styles.faded,
      ]}>
      <Ionicons name={icon} size={24} color={theme.text} />
    </Pressable>
  );

  return (
    <Screen back onBack={leave} title={t(sopId ? 'sops.editTitle' : 'sops.new')}>
      {/* On an iPhone, swiping back from the edge would skip the question, so it is off while there are changes. */}
      <Stack.Screen options={{ gestureEnabled: !changed }} />

      {loading && <ActivityIndicator color={theme.primary} />}
      <ErrorText
        message={loadError}
        onRetry={() => {
          setLoadError(null);
          setLoading(true);
          setAttempt((count) => count + 1);
        }}
      />

      {!loading && !loadError && (
        <>
          <TextField
            label={t('sops.name')}
            value={title}
            onChangeText={setTitle}
            placeholder={t('sops.namePlaceholder')}
            maxLength={100}
            error={showMissing && titleMissing ? t('sops.nameNeeded') : null}
          />

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('sops.category')}
          </ThemedText>
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('sops.category')}>
            {SOP_CATEGORIES.map((value) => (
              <OptionChip
                key={value}
                label={t(`sopCategory.${value}`)}
                selected={value === category}
                onPress={() => setCategory(value)}
              />
            ))}
          </View>

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('sops.steps')}
          </ThemedText>
          {steps.map((step, index) => (
            <View key={step.key} style={styles.step}>
              {/* The number stays beside the step while it is typed, as on the reading screen. */}
              <View style={[styles.number, { backgroundColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                  {index + 1}
                </ThemedText>
              </View>
              <View style={styles.stepBody}>
                <TextField
                  accessibilityLabel={t('sops.step', { number: index + 1 })}
                  placeholder={t('sops.stepPlaceholder')}
                  value={step.text}
                  onChangeText={(text) =>
                    setSteps((current) => current.map((old) => (old.key === step.key ? { ...old, text } : old)))
                  }
                  maxLength={300}
                  multiline
                  style={styles.stepInput}
                />
                {steps.length > 1 && (
                  <View style={styles.stepButtons}>
                    {stepButton('arrow-up', t('sops.moveUp', { number: index + 1 }), () => move(index, -1), index === 0)}
                    {stepButton(
                      'arrow-down',
                      t('sops.moveDown', { number: index + 1 }),
                      () => move(index, 1),
                      index === steps.length - 1,
                    )}
                    <View style={styles.spacer} />
                    {stepButton('trash-outline', t('sops.removeStep', { number: index + 1 }), () =>
                      // An empty step has nothing to lose, so it goes at once.
                      step.text.trim() ? setRemoving(step.key) : removeStep(step.key),
                    )}
                  </View>
                )}
              </View>
            </View>
          ))}
          {steps.length < MAX_STEPS && (
            <Button
              label={`+  ${t('sops.addStep')}`}
              variant="secondary"
              onPress={() => setSteps((current) => [...current, newStep()])}
            />
          )}
          <ErrorText message={showMissing && stepsMissing ? t('sops.stepsNeeded') : null} />

          <ErrorText message={error} />
          <Button label={t('sops.save')} onPress={() => void save()} loading={saving} />
          <Button label={t('common.cancel')} variant="link" onPress={leave} />
        </>
      )}

      <ConfirmDialog
        visible={removing !== null && removingIndex >= 0}
        message={t('sops.removeStepConfirm', { number: removingIndex + 1 })}
        confirmLabel={t('sops.removeStep', { number: removingIndex + 1 })}
        danger
        onConfirm={() => {
          if (removing !== null) removeStep(removing);
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        visible={leaving}
        message={t('sops.leaveConfirm')}
        confirmLabel={t('sops.leaveDiscard')}
        danger
        onConfirm={() => {
          setLeaving(false);
          router.back();
        }}
        onCancel={() => setLeaving(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  // Lined up with the first line of the text box beside it.
  number: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: (MinTouchSize - 30) / 2,
  },
  stepBody: { flex: 1, gap: Spacing.two },
  stepInput: { fontSize: 17, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  stepButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepButton: {
    minWidth: MinTouchSize,
    minHeight: MinTouchSize,
    borderWidth: 1,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { flex: 1 },
  faded: { opacity: 0.3 },
});
