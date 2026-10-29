import {
  describeExpiry,
  describePrep,
  effectivePrice,
  formatUnitPrice,
  getCustomer,
  setBackInStockWatch,
  shopAcceptsOrders,
  subscribeProducts,
  subscribeShop,
  type Customer,
  type Product,
  type Shop,
} from '@common';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Badge, Button, DANGER, EmptyState, PRIMARY, Screen } from '@/components/kit';
import { ProductReviews } from '@/components/product-reviews';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCachedImage } from '@/hooks/use-cached-image';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const money = (n: number) => `₹${n.toFixed(2)}`;

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const t = useT();
  const cart = useCart();
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [watching, setWatching] = useState(false);
  const [savingWatch, setSavingWatch] = useState(false);

  useEffect(
    () =>
      subscribeProducts(shopId, (p) => {
        setProducts(p);
        setLoaded(true);
      }),
    [],
  );
  useEffect(() => subscribeShop(shopId, setShop), []);

  const product = products.find((p) => p.id === id) ?? null;
  // Hook must run unconditionally; it tolerates an undefined/null image id.
  const uri = useCachedImage(product?.imageId);

  const productId = product?.id;

  // Load the buyer's customer doc whenever signed in — the subscribe block needs their saved
  // address/phone, and the out-of-stock watch toggle needs their back-in-stock list.
  useEffect(() => {
    if (!user || !productId) {
      setCustomer(null);
      setWatching(false);
      return;
    }
    let active = true;
    getCustomer(user.uid)
      .then((c) => {
        if (!active) return;
        setCustomer(c);
        setWatching(!!c?.notifyBackInStock?.includes(productId));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user, productId]);

  const toggleWatch = async () => {
    if (!customer || !productId) return;
    const next = !watching;
    setWatching(next);
    setSavingWatch(true);
    try {
      await setBackInStockWatch(customer, productId, next);
    } catch {
      setWatching(!next); // revert on failure
    } finally {
      setSavingWatch(false);
    }
  };

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('product.title', 'Product') }} />
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (!product) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('product.title', 'Product') }} />
        <EmptyState
          title={t('product.notFound', 'Product not found')}
          hint={t('product.notFoundHint', 'This item may no longer be available.')}
        />
      </Screen>
    );
  }

  const price = effectivePrice(product);
  const hasDiscount = price < product.price;
  const outOfStock = product.trackStock && (product.stock ?? 0) <= 0;
  const accepting = shopAcceptsOrders(shop);
  const canAdd = accepting && !outOfStock;
  const expiry = product.expiresAt ? describeExpiry(product.expiresAt.toDate()) : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('product.title', 'Product') }} />

      <Image
        source={uri ? { uri } : undefined}
        style={[styles.hero, { backgroundColor: theme.backgroundSelected }]}
        contentFit="cover"
      />

      <ThemedText type="title">{product.name}</ThemedText>

      <View style={styles.priceRow}>
        <ThemedText type="subtitle" style={{ color: PRIMARY }}>
          {formatUnitPrice(price, product.unit)}
        </ThemedText>
        {hasDiscount ? (
          <ThemedText themeColor="textSecondary" style={styles.struck}>
            {money(product.price)}
          </ThemedText>
        ) : null}
      </View>

      {product.description ? (
        <ThemedText themeColor="textSecondary">{product.description}</ThemedText>
      ) : null}

      {expiry ? (
        <ThemedText type="small" themeColor="textSecondary">
          {expiry.text}
        </ThemedText>
      ) : null}

      {product.onDemand && product.prepTime ? (
        <ThemedText type="small" themeColor="textSecondary">
          {describePrep(product.prepTime)}
        </ThemedText>
      ) : null}

      {outOfStock ? <Badge label={t('common.outOfStock', 'Out of stock')} color={DANGER} /> : null}

      {outOfStock && user ? (
        <Button
          title={
            watching
              ? t('product.notifyOn', "You'll be notified ✓")
              : t('product.notifyBackInStock', 'Notify me when back in stock')
          }
          variant="secondary"
          onPress={toggleWatch}
          loading={savingWatch}
          disabled={!customer || savingWatch}
        />
      ) : null}

      {shop != null && !accepting ? (
        <ThemedText type="small" style={{ color: DANGER }}>
          {t('common.shopClosed', 'The shop is not accepting orders right now.')}
        </ThemedText>
      ) : null}

      <Button
        title={t('common.addToCart', 'Add to cart')}
        disabled={!canAdd}
        onPress={() => cart.add({ productId: product.id, name: product.name, price, unit: product.unit })}
      />

      <ProductReviews productId={product.id} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { padding: Spacing.six, alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', aspectRatio: 1, borderRadius: Spacing.three },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  struck: { textDecorationLine: 'line-through' },
});
