import { subscribeProductReviews, type Review } from '@common';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Card, SectionTitle } from '@/components/kit';
import { Stars } from '@/components/stars';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';

/**
 * Read-only ratings & reviews for a product: the average, the count, and the list.
 * Buyers post reviews from their Orders screen (inherently verified), not here.
 */
export function ProductReviews({ productId }: { productId: string }) {
  const t = useT();
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => subscribeProductReviews(productId, setReviews), [productId]);

  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  return (
    <>
      <SectionTitle>{t('reviews.title', 'Ratings & reviews')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        {reviews.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Stars value={Math.round(avg)} />
            <ThemedText type="smallBold">{avg.toFixed(1)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('reviews.count', '({count})', { count: reviews.length })}
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('reviews.none', 'No reviews yet.')}
          </ThemedText>
        )}
      </Card>

      {reviews.map((r) => (
        <Card key={r.id} style={{ gap: Spacing.half }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <Stars value={r.rating} size={14} />
            <ThemedText type="smallBold" style={{ flex: 1 }}>
              {r.customerName || t('reviews.anon', 'Customer')}
            </ThemedText>
          </View>
          {r.text ? (
            <ThemedText type="small" themeColor="textSecondary">
              {r.text}
            </ThemedText>
          ) : null}
        </Card>
      ))}
    </>
  );
}
