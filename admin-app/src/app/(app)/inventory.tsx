import {
  isStaleToday,
  subscribeProducts,
  touchProductPrice,
  touchProductStock,
  userHasPermission,
  type Product,
} from '@common';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, EmptyState, Screen, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
  const t = useT();
  const [products, setProducts] = useState<Product[]>([]);

  const canWrite = userHasPermission(appUser, 'products.write');

  useEffect(() => {
    if (!canWrite) return;
    return subscribeProducts(shopId, setProducts);
  }, [canWrite]);

  // Saving stamps `priceUpdatedAt` / `stockUpdatedAt`, so a row drops off this
  // list by itself once the live feed syncs.
  const stale = useMemo(
    () => products.filter((p) => needsPriceUpdate(p) || needsStockUpdate(p)),
    [products],
  );

  if (!canWrite) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('inventory.title', 'Update inventory') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('inventory.noAccessHint', "Your role can't update inventory.")}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('inventory.title', 'Update inventory') }} />

      {stale.length === 0 ? (
        <EmptyState
          title={t('inventory.allDone', 'Inventory up to date')}
          hint={t('inventory.allDoneHint', 'Nothing needs a price or stock update today.')}
        />
      ) : (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
              {t('inventory.intro', "Items whose price or stock hasn't been updated today.")}
            </ThemedText>
            <Badge label={String(stale.length)} color="#F2A900" />
          </Card>
          {stale.map((p) => (
            <InventoryRow key={p.id} product={p} />
          ))}
        </>
      )}
    </Screen>
  );
}

function InventoryRow({ product }: Readonly<{ product: Product }>) {
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
        <Button title={t('inventory.save', 'Save')} onPress={() => void onSave()} loading={saving} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badges: { flexDirection: 'row', gap: Spacing.one },
});
