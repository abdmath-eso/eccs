import { ThemedText } from '@/components/themed-text';

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <ThemedText type="default" themeColor="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
      {message}
    </ThemedText>
  );
}
