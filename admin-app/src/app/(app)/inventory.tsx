import {
  effectiveStock,
  fuzzyFilter,
  isLowStock,
  isOutOfStock,
  isStaleToday,
  subscribeProducts,
  touchProductPrice,
  touchProductStock,
  userHasPermission,
  type Product,
} from '@common';
import { Stack, useLocalSearchParams } from 'expo-router';
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, DANGER, EmptyState, Screen, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

function tsToDate(ts: { toDate: () => Date } | null | undefined): Date | null {
  return ts ? ts.toDate() : null;
}

/** Perishables need a daily re-price; stock-tracked items need a daily stock count. */
export function needsPriceUpdate(p: Product): boolean {
  return !!p.perishable && isStaleToday(tsToDate(p.priceUpdatedAt));
}

export function needsStockUpdate(p: Product): boolean {
  return !!p.trackStock && isStaleToday(tsToDate(p.stockUpdatedAt));
}

export default function Inventory() {
  const { appUser } = useAuth();
  const theme = useTheme();
  const t = useT();
  // `?filter=low` lets the dashboard stock alert deep-link straight into the restock list.
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(filter === 'low');
  // Keystrokes stay responsive on large catalogues: the (expensive) fuzzy filter and the
  // list re-render run against the deferred copy, so typing is never blocked.
  const deferredSearch = useDeferredValue(search);

  // Viewing follows the Products tile; saving still needs write access.
  const canRead = userHasPermission(appUser, 'products.read');
  const canWrite = userHasPermission(appUser, 'products.write');

  useEffect(() => {
    if (!canRead) return;
    return subscribeProducts(shopId, setProducts);
  }, [canRead]);

  // Saving stamps `priceUpdatedAt` / `stockUpdatedAt`, so a row drops off this
  // list by itself once the live feed syncs.
  const stale = useMemo(
    () => products.filter((p) => needsPriceUpdate(p) || needsStockUpdate(p)),
    [products],
  );

  // Out of stock first, then running low — the order a shopkeeper would work the list in.
  const needsRestock = useMemo(
    () => [...products.filter(isOutOfStock), ...products.filter(isLowStock)],
    [products],
  );

  // Searching escapes the "due today" filter entirely — that is the point, so a
  // stock count can be corrected for any item, not just the ones being nagged.
  const searching = deferredSearch.trim().length > 0;
  const results = useMemo(() => {
    if (searching) {
      return fuzzyFilter(products, deferredSearch, (p) => [p.name, p.description ?? '']);
    }
    return lowOnly ? needsRestock : stale;
  }, [searching, products, deferredSearch, stale, lowOnly, needsRestock]);

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('inventory.title', 'Update inventory') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('inventory.noAccessHint', "Your role can't view inventory.")}
        />
      </Screen>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['left', 'right']}>
      <Stack.Screen options={{ title: t('inventory.title', 'Update inventory') }} />
      {/*
        Virtualised on purpose: every row mounts two or three native TextInputs, so a
        plain map() over a few hundred products exhausts memory and takes the screen down
        on open. FlatList keeps only the visible window mounted.
      */}
      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <InventoryRow product={item} canWrite={canWrite} />}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews={false}
        ListHeaderComponent={
          <View style={{ gap: Spacing.three }}>
            <TextField
              placeholder={t('inventory.search', 'Search products to update stock')}
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />

            {!canWrite ? (
              <Card>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('inventory.readOnly', "Your role can view inventory but can't change it.")}
                </ThemedText>
              </Card>
            ) : null}

            {!searching ? (
              <View style={styles.modeRow}>
                <ModePill
                  label={t('inventory.modeDue', 'Due today ({count})', { count: stale.length })}
                  selected={!lowOnly}
                  onPress={() => setLowOnly(false)}
                />
                <ModePill
                  label={t('inventory.modeLow', 'Restock ({count})', { count: needsRestock.length })}
                  selected={lowOnly}
                  onPress={() => setLowOnly(true)}
                />
              </View>
            ) : null}

            {results.length > 0 ? (
              <Card style={styles.introCard}>
                <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
                  {searching
                    ? t('inventory.searchIntro', 'Matching products — edit price or stock any time.')
                    : lowOnly
                      ? t('inventory.lowIntro', 'Out of stock or at/below the reorder level.')
                      : t('inventory.intro', "Items whose price or stock hasn't been updated today.")}
                </ThemedText>
                <Badge label={String(results.length)} color={searching ? '#4A90D9' : '#F2A900'} />
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={
              searching
                ? t('inventory.noMatch', 'No products match')
                : lowOnly
                  ? t('inventory.stockHealthy', 'Stock looks healthy')
                  : t('inventory.allDone', 'Inventory up to date')
            }
            hint={
              searching
                ? t('inventory.noMatchHint', 'Try a different name.')
                : lowOnly
                  ? t('inventory.stockHealthyHint', 'Nothing is out of stock or below its reorder level.')
                  : t('inventory.allDoneHint', 'Nothing needs a price or stock update today.')
            }
          />
        }
      />
    </SafeAreaView>
  );
}

/** Small segmented control for switching the inventory list between its two jobs. */
function ModePill({
  label,
  selected,
  onPress,
}: Readonly<{ label: string; selected: boolean; onPress: () => void }>) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.modePill,
        { backgroundColor: selected ? theme.text : theme.backgroundElement },
      ]}
    >
      <ThemedText type="small" style={{ color: selected ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const InventoryRow = memo(function InventoryRow({
  product,
  canWrite,
}: Readonly<{ product: Product; canWrite: boolean }>) {
  const t = useT();
  const toast = useToast();
  const [price, setPrice] = useState(String(product.price));
  const [discount, setDiscount] = useState(
    product.discountPrice != null ? String(product.discountPrice) : '',
  );
  const [stock, setStock] = useState(product.stock != null ? String(product.stock) : '0');
  const [saving, setSaving] = useState(false);

  const tracksStock = !!product.trackStock;
  const pricePending = needsPriceUpdate(product);
  const stockPending = needsStockUpdate(product);

  const onSave = async () => {
    const priceNum = Number(price);
    const discountNum = discount.trim() ? Number(discount) : null;
    const stockNum = Number(stock);

    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      toast({
        type: 'error',
        title: t('product.invalidPrice', 'Invalid price'),
        message: t('product.invalidPriceHint', 'Please enter a price greater than 0.'),
      });
      return;
    }
    if (discountNum !== null && !(Number.isFinite(discountNum) && discountNum > 0 && discountNum < priceNum)) {
      toast({
        type: 'error',
        title: t('product.invalidDiscount', 'Invalid discount price'),
        message: t(
          'product.invalidDiscountHint',
          'Enter a discount greater than 0 and less than the price, or leave it blank.',
        ),
      });
      return;
    }
    if (tracksStock && !(Number.isInteger(stockNum) && stockNum >= 0)) {
      toast({
        type: 'error',
        title: t('inventory.invalidStock', 'Invalid stock'),
        message: t('inventory.invalidStockHint', 'Enter a whole number of 0 or more.'),
      });
      return;
    }

    const priceChanged =
      priceNum !== product.price || discountNum !== (product.discountPrice ?? null);

    setSaving(true);
    try {
      // Stamping is the point of this screen: a perishable row must clear its
      // reminder even when the price is unchanged.
      if (pricePending || priceChanged) {
        await touchProductPrice(product.id, priceNum, discountNum);
      }
      if (tracksStock) {
        await touchProductStock(product.id, stockNum);
      }
      toast({
        type: 'success',
        title: t('inventory.saved', 'Inventory updated'),
        message: t('inventory.savedHint', '{name} updated for today.', { name: product.name }),
      });
    } catch {
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: Spacing.two }}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          {product.name}
        </ThemedText>
        <View style={styles.badges}>
          {isOutOfStock(product) ? (
            <Badge label={t('products.outOfStock', 'Out of stock')} color={DANGER} />
          ) : null}
          {isLowStock(product) ? (
            <Badge
              label={t('inventory.lowStock', 'Low: {count}', { count: effectiveStock(product) })}
              color={DANGER}
            />
          ) : null}
          {pricePending ? <Badge label={t('inventory.priceDue', 'Price')} color="#F2A900" /> : null}
          {stockPending ? <Badge label={t('inventory.stockDue', 'Stock')} color="#F2A900" /> : null}
        </View>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {tracksStock
          ? t('inventory.currentBoth', 'Current: ₹{price} · {stock} in stock', {
              price: product.price,
              stock: product.stock ?? 0,
            })
          : t('inventory.current', 'Current: ₹{price}', { price: product.price })}
      </ThemedText>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <TextField
            label={t('inventory.newPrice', 'New price')}
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label={t('product.discountPrice', 'Discount price (optional)')}
            value={discount}
            onChangeText={setDiscount}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
      </View>

      {tracksStock ? (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('inventory.newStock', 'Stock on hand')}
              value={stock}
              onChangeText={setStock}
              keyboardType="numeric"
              placeholder="0"
            />
          </View>
          <View style={{ flex: 1 }} />
        </View>
      ) : null}

      <View style={{ alignSelf: 'flex-start' }}>
        <Button
          title={t('inventory.save', 'Save')}
          onPress={() => void onSave()}
          loading={saving}
          disabled={!canWrite}
        />
      </View>
    </Card>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  listContent: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  introCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeRow: { flexDirection: 'row', gap: Spacing.two },
  modePill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
});
