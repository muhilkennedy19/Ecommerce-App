import {
  subscribeDeliveryFeedback,
  subscribeProducts,
  subscribeShopReviews,
  userHasPermission,
  type DeliveryFeedback,
  type Product,
  type Review,
} from '@common';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Card, EmptyState, Screen, SectionTitle } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const GOLD = '#F5A623';

function Stars({ value }: { value: number }) {
  const n = Math.round(value);
  return <ThemedText style={{ color: GOLD }}>{'★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))}</ThemedText>;
}

/** Admin/superuser view of product reviews + delivery ratings (feeds sentiment analysis). */
export default function FeedbackScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const canView = userHasPermission(appUser, 'shop.config');

  const [reviews, setReviews] = useState<Review[]>([]);
  const [delivery, setDelivery] = useState<DeliveryFeedback[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!canView) return;
    return subscribeShopReviews(shopId, setReviews);
  }, [canView]);
  useEffect(() => {
    if (!canView) return;
    return subscribeDeliveryFeedback(shopId, setDelivery);
  }, [canView]);
  useEffect(() => {
    if (!canView) return;
    return subscribeProducts(shopId, setProducts);
  }, [canView]);

  const productName = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [products]);

  const deliveryAvg = delivery.length ? delivery.reduce((s, d) => s + d.rating, 0) / delivery.length : 0;
  const reviewAvg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  if (!canView) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('feedback.title', 'Feedback') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('feedback.noAccess', 'Only admins and the superuser can view feedback.')}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('feedback.title', 'Feedback') }} />

      <SectionTitle>{t('feedback.delivery', 'Delivery ratings')}</SectionTitle>
      <Card style={{ gap: Spacing.one }}>
        {delivery.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Stars value={deliveryAvg} />
            <ThemedText type="smallBold">{deliveryAvg.toFixed(1)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              ({delivery.length})
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('feedback.noDelivery', 'No delivery ratings yet.')}
          </ThemedText>
        )}
      </Card>
      {delivery.map((d) => (
        <Card key={d.id} style={{ gap: Spacing.half }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Stars value={d.rating} />
            <ThemedText type="smallBold" style={{ flex: 1 }}>
              {d.customerName || t('feedback.anon', 'Customer')}
            </ThemedText>
          </View>
          {d.text ? (
            <ThemedText type="small" themeColor="textSecondary">
              {d.text}
            </ThemedText>
          ) : null}
        </Card>
      ))}

      <SectionTitle>{t('feedback.products', 'Product reviews')}</SectionTitle>
      <Card style={{ gap: Spacing.one }}>
        {reviews.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Stars value={reviewAvg} />
            <ThemedText type="smallBold">{reviewAvg.toFixed(1)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              ({reviews.length})
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('feedback.noReviews', 'No reviews yet.')}
          </ThemedText>
        )}
      </Card>
      {reviews.map((r) => (
        <Card key={r.id} style={{ gap: Spacing.half }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Stars value={r.rating} />
            <ThemedText type="smallBold" style={{ flex: 1 }}>
              {productName.get(r.productId) ?? t('feedback.product', 'Product')}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {r.customerName || t('feedback.anon', 'Customer')}
          </ThemedText>
          {r.text ? <ThemedText type="small">{r.text}</ThemedText> : null}
        </Card>
      ))}
    </Screen>
  );
}
