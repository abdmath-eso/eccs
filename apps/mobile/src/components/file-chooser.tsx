import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Spacing } from '@/constants/theme';
import { CameraPermissionError } from '@/lib/photo';
import { chooseDocument, photographDocument, UnsupportedFileError, type ChosenFile } from '@/lib/pick-file';
import { useSession } from '@/lib/session';

interface FileChooserProps {
  value: ChosenFile | null;
  onChange: (file: ChosenFile | null) => void;
}

/** Two ways to attach a document: photograph the paper, or pick a PDF or image already on the phone. */
export function FileChooser({ value, onChange }: FileChooserProps) {
  const { t } = useSession();
  const [error, setError] = useState<string | null>(null);

  async function pick(source: () => Promise<ChosenFile | null>) {
    setError(null);
    try {
      const chosen = await source();
      if (chosen) onChange(chosen);
    } catch (e) {
      setError(
        t(e instanceof CameraPermissionError ? 'error.camera' : e instanceof UnsupportedFileError ? 'error.fileType' : 'error.generic'),
      );
    }
  }

  return (
    <View style={styles.wrapper}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('docs.file')}
      </ThemedText>
      <View style={styles.buttons}>
        <View style={styles.button}>
          <Button label={`📷  ${t('docs.takePhoto')}`} variant="secondary" onPress={() => void pick(photographDocument)} />
        </View>
        <View style={styles.button}>
          <Button label={`📄  ${t('docs.chooseFile')}`} variant="secondary" onPress={() => void pick(chooseDocument)} />
        </View>
      </View>
      {value && (
        <ThemedText type="small" themeColor="primary">
          ✓ {t('docs.fileChosen', { name: value.name })}
        </ThemedText>
      )}
      <ErrorText message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.two },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  button: { flex: 1 },
});
