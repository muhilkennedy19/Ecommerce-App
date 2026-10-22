import {
  isStaleToday,
  subscribeProducts,
  touchProductPrice,
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

export default function PriceUpdates() {
  const { appUser } = useAuth();
  const t = useT();
  const [products, setProducts] = useState<Product[]>([]);

  const canWrite = userHasPermission(appUser, 'products.write');

  useEffect(() => {
    if (!canWrite) return;
    return subscribeProducts(shopId, setProducts);
  }, [canWrite]);

  // Perishable items whose price hasn't been re-stamped today. Saving a price
  // stamps `priceUpdatedAt`, so the row drops off this list via the live feed.
  const stale = useMemo(
    () => products.filter((p) => p.perishable && isStaleToday(tsToDate(p.priceUpdatedAt))),
    [products],
  );

  if (!canWrite) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('priceUpdates.title', 'Update prices') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('priceUpdates.noAccessHint', "Your role can't update prices.")}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('priceUpdates.title', 'Update prices') }} />

      {stale.length === 0 ? (
        <EmptyState
          title={t('priceUpdates.allDone', 'All prices up to date')}
          hint={t('priceUpdates.allDoneHint', 'No perishable items need a price update today.')}
        />
      ) : (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
              {t('priceUpdates.intro', "Perishable items whose price hasn't been updated today.")}
            </ThemedText>
            <Badge label={String(stale.length)} color="#F2A900" />
          </Card>
          {stale.map((p) => (
            <PriceRow key={p.id} product={p} />
          ))}
        </>
      )}
    </Screen>
  );
}

function PriceRow({ product }: Readonly<{ product: Product }>) {
  const t = useT();
  const toast = useToast();
  const [price, setPrice] = useState(String(product.price));
  const [discount, setDiscount] = useState(product.discountPrice != null ? String(product.discountPrice) : '');
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    const priceNum = Number(price);
    const discountNum = discount.trim() ? Number(discount) : null;

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

    setSaving(true);
    try {
      await touchProductPrice(product.id, priceNum, discountNum);
      toast({
        type: 'success',
        title: t('priceUpdates.saved', 'Price updated'),
        message: t('priceUpdates.savedHint', '{name} re-priced for today.', { name: product.name }),
      });
      // The live products feed drops this row (no longer stale) once it syncs.
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
      <ThemedText type="smallBold">{product.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('priceUpdates.current', 'Current: ₹{price}', { price: product.price })}
      </ThemedText>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <TextField
            label={t('priceUpdates.newPrice', 'New price')}
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
      <View style={{ alignSelf: 'flex-start' }}>
        <Button title={t('priceUpdates.save', 'Save price')} onPress={() => void onSave()} loading={saving} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
});
