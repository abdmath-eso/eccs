import Ionicons from '@expo/vector-icons/Ionicons';
import {
  can,
  formatDistance,
  isNearby,
  VENDOR_CATEGORIES,
  vendorMatches,
  type VendorCategory,
  type VendorDirectoryDto,
  type VendorDto,
} from '@eccs/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Expandable } from '@/components/ui/expandable';
import { OptionChip } from '@/components/ui/option-chip';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { VendorActions } from '@/components/vendor-actions';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText, useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/**
 * "Vendors" in the More menu, for the Owner and the Manager: the wholesalers
 * and distributors that sell in bulk to restaurants, with the ones nearest to
 * the outlet first and the rest of the directory underneath.
 *
 * Built the way store locators are (the MetaLocator, TravelTime, Storepoint and
 * Bullseye guides agree): nearest first by default, the distance on every row,
 * a search box with one row of filter chips over the list (Material's filter
 * chips), Call and Directions as buttons on the row, and enough on a row to
 * compare vendors without opening each. The list is the point of the screen, so
 * it starts straight after the search; the explanation is one line that opens,
 * at the very end.
 *
 * The whole directory arrives in one answer and is searched on the phone, so
 * typing and choosing a chip are instant and need no signal.
 */
export default function VendorsScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { forwardIcon } = useDirection();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<VendorCategory | null>(null);

  const allowed = can(user?.memberships ?? [], 'vendors', 'read');
  // Distances are from the outlet in view. What was loaded for another outlet is never shown.
  const { data: directory, error, reload } = useLoaded<VendorDirectoryDto>(allowed && outletId ? outletId : null, () =>
    api.vendors.list(outletId!),
  );

  // Nothing here for the Head Chef or ECCS staff.
  if (!allowed) return <Redirect href="/" />;

  const everyone = directory?.vendors ?? [];
  // Only the categories that someone on the list sells, in their usual order.
  const categories = VENDOR_CATEGORIES.filter((code) => everyone.some((vendor) => vendor.categories.includes(code)));
  // A chip that is no longer offered (the list changed on a refresh) counts as "All".
  const chosen = category !== null && categories.includes(category) ? category : null;
  const categoryNames = (vendor: VendorDto) => vendor.categories.map((code) => t(`vendors.category.${code}`));
  const shown = everyone.filter((vendor) =>
    vendorMatches(vendor, { query, category: chosen, language, alsoSearch: categoryNames(vendor) }),
  );

  // With the outlet's place known: those within 5 km first, then the rest, each nearest first
  // (the server sorted them). Without it there is one list, in name order, and no headings.
  const hasPlace = directory?.outletHasPlace ?? false;
  const near = hasPlace ? shown.filter((vendor) => isNearby(vendor, directory?.nearbyMetres)) : [];
  const rest = hasPlace ? shown.filter((vendor) => !isNearby(vendor, directory?.nearbyMetres)) : shown;
  // "5 km" in the heading, from the same number the server sorted by.
  const nearbyMetres = directory?.nearbyMetres ?? 0;
  const within = nearbyMetres % 1000 === 0 ? `${nearbyMetres / 1000} km` : formatDistance(nearbyMetres);

  const row = (vendor: VendorDto, index: number) => (
    // A plain row with a thin line above it, not a box each: quicker to run the eye down, and shorter.
    <View key={vendor.id} style={[styles.vendor, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/vendors/[vendorId]', params: { vendorId: vendor.id, outletId: outletId! } })}
        style={({ pressed }) => [styles.vendorText, pressed && { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.nameLine}>
          <ThemedText type="default" style={styles.name}>
            {vendor.name}
          </ThemedText>
          {vendor.distanceMetres !== null && (
            <ThemedText type="smallBold" themeColor="textSecondary">
              {ltrText(formatDistance(vendor.distanceMetres))}
            </ThemedText>
          )}
          <Ionicons name={forwardIcon} size={18} color={theme.textSecondary} />
        </View>
        <ThemedText type="small">{categoryNames(vendor).join(' · ')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {[vendor.area, vendor.delivers ? t('vendors.delivers') : null].filter(Boolean).join(' · ')}
        </ThemedText>
      </Pressable>
      <VendorActions vendor={vendor} compact />
    </View>
  );

  const group = (title: string | null, vendors: VendorDto[]) =>
    vendors.length > 0 && (
      <View>
        {title !== null && (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {title}
          </ThemedText>
        )}
        {vendors.map(row)}
      </View>
    );

  return (
    <Screen back title={t('vendors.title')} onRefresh={reload}>
      <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />

      <ErrorText message={error} onRetry={() => void reload()} />
      {(outletLoading || (!directory && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {directory && everyone.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('vendors.empty')}
        </ThemedText>
      )}

      {everyone.length > 0 && (
        <>
          {/* ── The search box: a magnifying glass where the typing starts, and a cross to empty it. What can be
              searched is the line above the box, not grey words inside it: in most of the twelve languages
              the sentence is longer than the box, and words inside a box are cut off where a line above wraps. ── */}
          <View>
            <TextField
              label={t('vendors.search')}
              placeholder={t('common.search')}
              value={query}
              onChangeText={setQuery}
              maxLength={60}
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
            />
            <View style={[styles.searchIcon, styles.untouchable]}>
              <Ionicons name="search" size={22} color={theme.textSecondary} />
            </View>
            {query.length > 0 && (
              <Pressable accessibilityRole="button" accessibilityLabel={t('common.clear')} onPress={() => setQuery('')} style={styles.clear}>
                <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* ── One row of chips to swipe sideways: "All", then what the listed vendors sell. One at a time. ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chips}
            accessibilityRole="radiogroup">
            <OptionChip label={t('vendors.all')} selected={chosen === null} onPress={() => setCategory(null)} />
            {categories.map((code) => (
              <OptionChip key={code} label={t(`vendors.category.${code}`)} selected={chosen === code} onPress={() => setCategory(code)} />
            ))}
          </ScrollView>

          {!hasPlace && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('vendors.noPlace')}
            </ThemedText>
          )}
          {shown.some((vendor) => vendor.isSample) && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('vendors.sampleNote')}
            </ThemedText>
          )}

          {group(hasPlace ? t('vendors.near', { distance: ltrText(within) }) : null, near)}
          {group(hasPlace ? t('vendors.further') : null, rest)}

          {shown.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('vendors.none')}
            </ThemedText>
          )}

          {/* Read once, so it is one line that opens, after the list. */}
          <Expandable title={t('vendors.about.title')} icon="information-circle-outline">
            <ThemedText type="small">{t('vendors.about.notChecked')}</ThemedText>
            <ThemedText type="small">{t('vendors.about.fssai')}</ThemedText>
          </Expandable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Taps pass straight through to the box underneath.
  untouchable: { pointerEvents: 'none' },
  // Room for the magnifying glass where the typing starts (the left; the right in Urdu)
  // and for the cross at the other end.
  searchInput: { paddingStart: Spacing.three + 22 + Spacing.two, paddingEnd: MinTouchSize },
  searchIcon: { position: 'absolute', start: Spacing.three, bottom: 0, height: MinTouchSize, justifyContent: 'center' },
  clear: {
    position: 'absolute',
    end: 0,
    bottom: 0,
    width: MinTouchSize,
    height: MinTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { gap: Spacing.two },
  vendor: { paddingVertical: Spacing.two },
  vendorText: { gap: Spacing.half, minHeight: MinTouchSize, justifyContent: 'center' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { flex: 1, fontWeight: 700 },
});
