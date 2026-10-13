import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import { can, formatDistance, localize, sellsFood, type VendorDto } from '@eccs/shared';
import { Redirect, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { VendorActions } from '@/components/vendor-actions';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { ltrText } from '@/lib/direction';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * One vendor from the directory, opened from its row: what they sell, how far
 * they are from the outlet in view and where, when they are open, whether they
 * deliver, their FSSAI number, and the same Call, WhatsApp and Directions
 * buttons at full width. Kept to one screen: each fact is one line with a
 * picture of its own, and there is nothing to scroll past.
 *
 * FSSAI's licence conditions ask a restaurant to buy food only from licensed or
 * registered vendors and to keep a record, so the number is shown as the vendor
 * gave it, with where to check it. ECCS has not checked it.
 */
export default function VendorScreen() {
  const theme = useTheme();
  const { vendorId, outletId } = useLocalSearchParams<{ vendorId: string; outletId: string }>();
  const { t, api, user, language } = useSession();

  const allowed = can(user?.memberships ?? [], 'vendors', 'read');
  // 'GONE' when the vendor has been taken off the list since the row was shown.
  const { data, error, reload } = useLoaded<VendorDto | 'GONE'>(
    allowed && vendorId && outletId ? `${outletId}|${vendorId}` : null,
    async () => {
      try {
        return await api.vendors.get(vendorId, outletId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return 'GONE';
        throw e;
      }
    },
  );

  // Nothing here for the Head Chef or ECCS staff.
  if (!allowed) return <Redirect href="/" />;
  // The distance is from an outlet, so the page is only ever opened from the list, which says which.
  if (!vendorId || !outletId) return <Redirect href="/vendors" />;

  const vendor = data === 'GONE' ? null : data;

  // One fact: its picture, its words, and a quieter second line where there is more to say.
  const fact = (icon: IconName, text: string, more?: string | null, tone: ThemeColor = 'textSecondary') => (
    <View style={styles.fact}>
      <Ionicons name={icon} size={22} color={theme[tone]} />
      <View style={styles.factText}>
        <ThemedText type="default">{text}</ThemedText>
        {more ? (
          <ThemedText type="small" themeColor="textSecondary">
            {more}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );

  return (
    <Screen back title={vendor?.name} onRefresh={reload}>
      <ErrorText message={error} onRetry={() => void reload()} />
      {!data && !error && <ActivityIndicator color={theme.primary} />}
      {data === 'GONE' && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('vendors.notFound')}
        </ThemedText>
      )}

      {vendor && (
        <>
          <View style={styles.what}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {vendor.categories.map((code) => t(`vendors.category.${code}`)).join(' · ')}
            </ThemedText>
            {vendor.sells && <ThemedText type="default">{localize(vendor.sells, language)}</ThemedText>}
          </View>

          <View style={styles.facts}>
            {/* Where: how far from the outlet in view (when both places are known), then the locality and the address. */}
            {fact(
              'location-outline',
              vendor.distanceMetres !== null
                ? t('vendors.fromOutlet', { distance: ltrText(formatDistance(vendor.distanceMetres)) })
                : `${vendor.area}, ${vendor.city}`,
              [vendor.distanceMetres !== null ? `${vendor.area}, ${vendor.city}` : null, vendor.address].filter(Boolean).join('\n'),
            )}
            {vendor.hours && fact('time-outline', t('vendors.open', { hours: localize(vendor.hours, language) }))}
            {vendor.delivers
              ? fact(
                  'bicycle-outline',
                  vendor.minOrderPaise !== null
                    ? t('vendors.deliversMin', { amount: formatMoney(vendor.minOrderPaise, language) })
                    : t('vendors.delivers'),
                )
              : fact('storefront-outline', t('vendors.noDelivery'))}
            {/* The number as the vendor gave it, kept left to right; or, in words with a warning mark, that there is none. */}
            {/* The warning is only for someone who sells food: a gas agency or a steel fabricator has no such number. */}
            {vendor.fssaiNumber
              ? fact('shield-checkmark-outline', t('vendors.fssai', { number: ltrText(vendor.fssaiNumber) }), t('vendors.fssaiNote'))
              : sellsFood(vendor)
                ? fact('warning', t('vendors.noFssai'), null, 'warning')
                : null}
            {/* A sample's number is made up and could be a stranger's phone, so it is not shown to be dialled by hand. */}
            {vendor.isSample
              ? fact('information-circle-outline', t('vendors.sampleNumber'))
              : vendor.phone && fact('call-outline', t('vendors.phone', { number: ltrText(vendor.phone) }))}
          </View>

          <VendorActions vendor={vendor} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  what: { gap: Spacing.one },
  facts: { gap: Spacing.two + Spacing.one },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  factText: { flex: 1, gap: Spacing.half },
});
