import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import { vendorActionUrl, vendorActions, type VendorAction, type VendorDto } from '@eccs/shared';
import { useState, type ComponentProps } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Each button has its own picture and its own word, never a picture alone.
const LOOK: Record<VendorAction, { icon: IconName; label: MessageKey; failed: MessageKey }> = {
  CALL: { icon: 'call-outline', label: 'vendors.call', failed: 'vendors.callFailed' },
  WHATSAPP: { icon: 'logo-whatsapp', label: 'vendors.whatsapp', failed: 'vendors.whatsappFailed' },
  DIRECTIONS: { icon: 'navigate-outline', label: 'vendors.directions', failed: 'vendors.directionsFailed' },
};

interface VendorActionsProps {
  vendor: VendorDto;
  /**
   * Small buttons side by side, for a row of the list. Without it: full-width
   * buttons one under another, for the vendor's own page.
   */
  compact?: boolean;
}

/**
 * Call, WhatsApp and Directions for one vendor, on the list's rows and on the
 * vendor's page. They are buttons so that nobody has to copy a number out, as
 * store locators do it (the MetaLocator, Storepoint and Bullseye guides).
 * WhatsApp shows only when there is a number for it, Directions only when the
 * shop's place is saved.
 *
 * A sample vendor is never dialled or messaged: its numbers are invented and
 * could be a stranger's. `vendorActionUrl` in @eccs/shared gives no link for
 * one, and a short message says why instead. Directions still opens, being
 * only a place on the map.
 */
export function VendorActions({ vendor, compact }: VendorActionsProps) {
  const theme = useTheme();
  const { t } = useSession();
  const notify = useSnackbar();
  // What could not be opened on this phone, said under the buttons.
  const [failed, setFailed] = useState<string | null>(null);

  const actions = vendorActions(vendor);
  if (actions.length === 0) return null;

  async function press(action: VendorAction) {
    setFailed(null);
    const url = vendorActionUrl(vendor, action);
    if (url === null) {
      // No link: this is a sample vendor's Call or WhatsApp. Nothing is opened.
      notify(t('vendors.sampleNumber'));
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      // No phone app, no WhatsApp, or no map on this phone.
      setFailed(t(LOOK[action].failed));
    }
  }

  if (!compact) {
    return (
      <View style={styles.full}>
        {actions.map((action, index) => (
          <Button
            key={action}
            icon={LOOK[action].icon}
            label={t(LOOK[action].label)}
            variant={index === 0 ? 'primary' : 'secondary'}
            onPress={() => void press(action)}
          />
        ))}
        <ErrorText message={failed} />
      </View>
    );
  }

  return (
    <View>
      {/* Each button is as wide as its word needs and they share the row. In a language whose words
          are long, the last one moves to a line of its own rather than being cut short: three
          equal buttons do not fit a 360-point phone. */}
      <View style={styles.row}>
        {actions.map((action) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            // Read out with the vendor's name, so "Call" says whom.
            accessibilityLabel={`${t(LOOK[action].label)}: ${vendor.name}`}
            onPress={() => void press(action)}
            // The part that takes the tap is as tall as every other button in the app (wet or
            // gloved hands); the outline drawn inside it is smaller, so a long list stays light.
            style={styles.target}>
            {({ pressed }) => (
              <View style={[styles.pill, { borderColor: theme.outline }, pressed && { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name={LOOK[action].icon} size={18} color={theme.primary} />
                <ThemedText type="smallBold" numberOfLines={1}>
                  {t(LOOK[action].label)}
                </ThemedText>
              </View>
            )}
          </Pressable>
        ))}
      </View>
      <ErrorText message={failed} />
    </View>
  );
}

const PILL_HEIGHT = 40;

const styles = StyleSheet.create({
  full: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.two },
  target: { flexGrow: 1, minHeight: MinTouchSize, justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    height: PILL_HEIGHT,
    borderWidth: 1,
    borderRadius: PILL_HEIGHT / 2,
    // Kept narrow on purpose: with more, "Directions" no longer fits beside the other two on a 360-point phone.
    paddingHorizontal: Spacing.two,
  },
});
