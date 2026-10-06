import Ionicons from '@expo/vector-icons/Ionicons';
import { SOP_CATEGORIES, SOP_LANGUAGES, type SopCategory, type SopLanguage } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

const MAX_STEPS = 30;

/**
 * Where the Owner or Manager writes an SOP for their outlet, or changes one
 * they wrote: a name, a category and the steps in order.
 */
export default function EditSopScreen() {
  const theme = useTheme();
  const { outletId, sopId } = useLocalSearchParams<{ outletId: string; sopId?: string }>();
  const { t, api, language } = useSession();
  const ownLanguage = language.toLowerCase() as SopLanguage;

  const [loading, setLoading] = useState(Boolean(sopId));
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SopCategory>('CLEANING');
  const [steps, setSteps] = useState<string[]>(['', '']);
  // An SOP is changed in the language it was written in, whoever opens it.
  const [writtenIn, setWrittenIn] = useState<SopLanguage>(ownLanguage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setWrittenIn(existing);
        setTitle(sop.title[existing] ?? '');
        setCategory(sop.category);
        setSteps(sop.steps[existing] ?? ['']);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, sopId]);

  const written = steps.map((step) => step.trim()).filter(Boolean);
  const ready = title.trim().length >= 2 && written.length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (sopId) await api.sops.update(sopId, { category, title: title.trim(), steps: written, language: writtenIn });
      else await api.sops.create({ outletId, category, title: title.trim(), steps: written, language: writtenIn });
      router.back();
    } catch (e) {
      setError(errorMessage(e, t));
      setSaving(false);
    }
  }

  return (
    <Screen back title={t(sopId ? 'sops.editTitle' : 'sops.new')}>
      {loading ? (
        <ActivityIndicator color={theme.primary} />
      ) : (
        <>
          <TextField
            label={t('sops.name')}
            value={title}
            onChangeText={setTitle}
            placeholder={t('sops.namePlaceholder')}
            maxLength={100}
          />

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('sops.category')}
          </ThemedText>
          <View style={styles.options}>
            {SOP_CATEGORIES.map((value) => {
              const selected = value === category;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setCategory(value)}
                  style={[
                    styles.option,
                    { borderColor: selected ? theme.primary : theme.border },
                    selected && { backgroundColor: theme.backgroundElement },
                  ]}>
                  <ThemedText type="small" themeColor={selected ? 'primary' : 'text'}>
                    {t(`sopCategory.${value}`)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('sops.steps')}
          </ThemedText>
          {steps.map((step, index) => (
            <View key={index} style={styles.step}>
              <View style={styles.stepField}>
                <TextField
                  accessibilityLabel={t('sops.step', { number: index + 1 })}
                  placeholder={t('sops.step', { number: index + 1 })}
                  value={step}
                  onChangeText={(text) => setSteps((current) => current.map((old, at) => (at === index ? text : old)))}
                  maxLength={300}
                  multiline
                  style={styles.stepInput}
                />
              </View>
              {steps.length > 1 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('sops.removeStep', { number: index + 1 })}
                  onPress={() => setSteps((current) => current.filter((_, at) => at !== index))}
                  style={styles.remove}>
                  <Ionicons name="close-circle" size={26} color={theme.textSecondary} />
                </Pressable>
              )}
            </View>
          ))}
          {steps.length < MAX_STEPS && (
            <Button
              label={`+  ${t('sops.addStep')}`}
              variant="secondary"
              onPress={() => setSteps((current) => [...current, ''])}
            />
          )}

          <ErrorText message={error} />
          <Button label={t('sops.save')} onPress={() => void save()} loading={saving} disabled={!ready} />
          <Button label={t('common.cancel')} variant="link" onPress={() => router.back()} />
        </>
      )}
      {loading && <ErrorText message={error} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  option: {
    minHeight: MinTouchSize - 8,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stepField: { flex: 1 },
  stepInput: { fontSize: 17, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  remove: { minWidth: MinTouchSize - 8, minHeight: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
