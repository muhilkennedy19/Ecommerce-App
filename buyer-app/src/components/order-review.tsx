import { upsertDeliveryFeedback, upsertReview, type Order } from '@common';
import { useState } from 'react';
import { View } from 'react-native';

import { useToast } from '@/components/feedback';
import { Button, Card, SectionTitle, TextField } from '@/components/kit';
import { Stars } from '@/components/stars';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';

interface Draft {
  rating: number;
  text: string;
}

/**
 * Lets a buyer rate the products in one of their own orders AND the delivery experience.
 * Because it's created from an order they placed, product reviews are inherently verified.
 * The delivery rating is stored separately (for later sentiment analysis).
 */
export function OrderReview({
  order,
  user,
}: {
  order: Order;
  user: { uid: string; displayName?: string | null } | null;
}) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [delivery, setDelivery] = useState<Draft>({ rating: 0, text: '' });
  const [saving, setSaving] = useState(false);

  // One row per distinct product in the order.
  const items = Array.from(new Map(order.items.map((i) => [i.productId, i])).values());

  const setDraft = (productId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => {
      const base = prev[productId] ?? { rating: 0, text: '' };
      return { ...prev, [productId]: { ...base, ...patch } };
    });

  const submit = async () => {
    if (!user) return;
    const rated = items.filter((i) => (drafts[i.productId]?.rating ?? 0) >= 1);
    const hasDelivery = delivery.rating >= 1;
    if (rated.length === 0 && !hasDelivery) {
      toast({ type: 'error', title: t('reviews.pickStars', 'Tap a star to rate'), message: '' });
      return;
    }
    setSaving(true);
    try {
      for (const i of rated) {
        const d = drafts[i.productId];
        await upsertReview({
          productId: i.productId,
          shopId: order.shopId,
          uid: user.uid,
          customerName: user.displayName ?? null,
          rating: d.rating,
          text: d.text,
        });
      }
      if (hasDelivery) {
        await upsertDeliveryFeedback({
          orderId: order.id,
          shopId: order.shopId,
          uid: user.uid,
          customerName: user.displayName ?? null,
          rating: delivery.rating,
          text: delivery.text,
        });
      }
      setOpen(false);
      toast({ type: 'success', title: t('reviews.thanks', 'Thanks for your feedback!'), message: '' });
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

  if (!user) return null;

  if (!open) {
    return (
      <Button title={t('reviews.rateOrder', 'Rate this order')} variant="secondary" size="sm" onPress={() => setOpen(true)} />
    );
  }

  return (
    <Card style={{ gap: Spacing.two, marginTop: Spacing.one }}>
      {/* Delivery rating — stored separately from product reviews. */}
      <SectionTitle>{t('reviews.delivery', 'Delivery')}</SectionTitle>
      <View style={{ gap: Spacing.half }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('reviews.deliveryPrompt', 'How was the delivery?')}
        </ThemedText>
        <Stars value={delivery.rating} size={26} onSelect={(n) => setDelivery((d) => ({ ...d, rating: n }))} />
        <TextField
          value={delivery.text}
          onChangeText={(v) => setDelivery((d) => ({ ...d, text: v }))}
          multiline
          placeholder={t('reviews.deliveryPlaceholder', 'On time? Well packed? (optional)')}
        />
      </View>

      <SectionTitle>{t('reviews.products', 'Products')}</SectionTitle>
      {items.map((i) => {
        const d = drafts[i.productId] ?? { rating: 0, text: '' };
        return (
          <View key={i.productId} style={{ gap: Spacing.half }}>
            <ThemedText type="small" style={{ flex: 1 }}>
              {i.name}
            </ThemedText>
            <Stars value={d.rating} size={26} onSelect={(n) => setDraft(i.productId, { rating: n })} />
            <TextField
              value={d.text}
              onChangeText={(v) => setDraft(i.productId, { text: v })}
              multiline
              placeholder={t('reviews.placeholder', 'Share a few words (optional)')}
            />
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', gap: Spacing.two }}>
        <Button title={t('common.cancel', 'Cancel')} variant="secondary" size="sm" onPress={() => setOpen(false)} />
        <Button title={t('reviews.submit', 'Submit review')} size="sm" onPress={() => void submit()} loading={saving} />
      </View>
    </Card>
  );
}
