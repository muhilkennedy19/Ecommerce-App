import { addAnnouncement, fuzzyFilter, getIdToken, putImage, getPushToken, rolesOf, sendNotify, setPushNotify, subscribeProducts, userHasPermission, type Product } from '@common';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button, Card, Loader, PRIMARY, Screen, SectionTitle, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { shopId, notifyUrl } from '@/lib/config';
import { registerForPush } from '@/lib/push';
import { useT } from '@/lib/i18n';

/** Resize + JPEG-compress a local image to a base64 string (no data-URI prefix). */
async function compressToBase64(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 1000 });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.5, format: SaveFormat.JPEG, base64: true });
  if (!out.base64) throw new Error('Could not process the selected image.');
  return out.base64;
}

/**
 * Self-service notification control, available to EVERY signed-in employee. Order
 * servers (sales) who only deliver — while the owner accepts — can switch their
 * new-order alerts off here. Persists `notify` on the user's pushTokens doc, which
 * the notify Worker honours when fanning out order notifications.
 *
 * Admins also get a "broadcast announcement" composer here: it stores an announcement
 * (optional banner image) buyers see on their Home, and fires a push to every buyer.
 */
export default function NotificationsScreen() {
  const { appUser, user } = useAuth();
  const t = useT();
  const toast = useToast();
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const inited = useRef(false);

  const canBroadcast = userHasPermission(appUser, 'shop.config');
  const theme = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Optional product to link the announcement to (buyer taps through to it).
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productId, setProductId] = useState<string | null>(null);

  useEffect(() => {
    if (!canBroadcast) return;
    return subscribeProducts(shopId, setProducts);
  }, [canBroadcast]);

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const productMatches = useMemo(() => {
    if (!productQuery.trim() || selectedProduct) return [];
    return fuzzyFilter(products.filter((p) => p.active), productQuery, (p) => [p.name, p.description]).slice(0, 6);
  }, [products, productQuery, selectedProduct]);

  useEffect(() => {
    if (!user || inited.current) return;
    inited.current = true;
    void (async () => {
      try {
        const tok = await getPushToken(user.uid);
        setEnabled(tok?.notify !== false);
      } catch {
        // default to on if we can't read it
      } finally {
        setLoaded(true);
      }
    })();
  }, [user]);

  async function onToggle(value: boolean) {
    if (!user) return;
    setSaving(true);
    setEnabled(value);
    try {
      // Re-register the device token (and current roles) when turning alerts on, so a
      // fresh token exists for the server to target; then persist the preference.
      if (value) await registerForPush(user.uid, appUser ? rolesOf(appUser) : null);
      await setPushNotify(user.uid, value);
      toast({
        type: 'success',
        title: t('common.saved', 'Saved ✓'),
        message: value
          ? t('notif.onMsg', "You'll receive order alerts on this device.")
          : t('notif.offMsg', 'Order alerts are off on this device.'),
      });
    } catch {
      setEnabled(!value); // revert on failure
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  }

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.6,
    });
    const uri = result.assets?.[0]?.uri;
    if (uri) setPickedUri(uri);
  };

  const publish = async () => {
    if (!user) return;
    if (!title.trim() || !body.trim()) {
      toast({
        type: 'error',
        title: t('broadcast.missing', 'Add a title and message'),
        message: '',
      });
      return;
    }
    setPublishing(true);
    try {
      let imageId: string | null = null;
      if (pickedUri) {
        const b64 = await compressToBase64(pickedUri);
        imageId = await putImage(b64, 'image/jpeg');
      }
      await addAnnouncement({
        shopId,
        title: title.trim(),
        body: body.trim(),
        imageId,
        productId,
        active: true,
        createdBy: user.uid,
      });
      // Fire the broadcast push (best-effort). The token fetch is guarded so a transient
      // token-refresh failure can't turn an already-saved announcement into a failure toast
      // (which would prompt a retry and duplicate the announcement). sendNotify no-ops on null.
      const idToken = await getIdToken().catch(() => null);
      await sendNotify(notifyUrl, idToken, {
        event: 'broadcast',
        shopId,
        title: title.trim(),
        body: body.trim(),
        ...(productId ? { productId } : {}),
      });
      setTitle('');
      setBody('');
      setPickedUri(null);
      setProductId(null);
      setProductQuery('');
      toast({
        type: 'success',
        title: t('broadcast.sent', 'Announcement sent'),
        message: t('broadcast.sentHint', 'Buyers will see it on their Home and get a notification.'),
      });
    } catch {
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('notif.title', 'Notifications') }} />
      <SectionTitle>{t('notif.orders', 'Order notifications')}</SectionTitle>
      {!loaded ? (
        <Loader label={t('common.loading', 'Loading…')} />
      ) : (
        <Card style={{ gap: Spacing.two }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }}>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold">{t('notif.ordersLabel', 'New order alerts')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t(
                  'notif.ordersHint',
                  'Turn off if you only deliver orders and someone else accepts them. You can turn it back on anytime.',
                )}
              </ThemedText>
            </View>
            <Switch
              value={enabled}
              disabled={saving}
              onValueChange={(v) => void onToggle(v)}
              trackColor={{ true: PRIMARY }}
            />
          </View>
        </Card>
      )}

      {canBroadcast ? (
        <>
          <SectionTitle>{t('broadcast.title', 'Broadcast announcement')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('broadcast.hint', 'Send a message to all buyers — shown on their Home and as a push notification.')}
            </ThemedText>
            <TextField
              label={t('broadcast.titleLabel', 'Title')}
              value={title}
              onChangeText={setTitle}
              placeholder={t('broadcast.titlePlaceholder', 'Fresh roses today!')}
            />
            <TextField
              label={t('broadcast.bodyLabel', 'Message')}
              value={body}
              onChangeText={setBody}
              multiline
              placeholder={t('broadcast.bodyPlaceholder', '20% off all flowers until 5pm.')}
            />
            {pickedUri ? (
              <Image source={{ uri: pickedUri }} style={styles.preview} contentFit="cover" />
            ) : null}
            <View style={{ flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' }}>
              <Button
                title={pickedUri ? t('broadcast.changeImage', 'Change image') : t('broadcast.addImage', 'Add image')}
                variant="secondary"
                onPress={() => void pickImage()}
              />
              {pickedUri ? (
                <Button title={t('broadcast.removeImage', 'Remove image')} variant="secondary" onPress={() => setPickedUri(null)} />
              ) : null}
            </View>

            {/* Optional: link a product so tapping the notification/card opens it. */}
            {selectedProduct ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                <ThemedText type="small" style={{ flex: 1 }}>
                  {t('broadcast.linkedProduct', 'Linked product')}: {selectedProduct.name}
                </ThemedText>
                <Button title={t('broadcast.clearProduct', 'Clear')} variant="secondary" onPress={() => setProductId(null)} />
              </View>
            ) : (
              <>
                <TextField
                  label={t('broadcast.productLabel', 'Link a product (optional)')}
                  value={productQuery}
                  onChangeText={setProductQuery}
                  placeholder={t('broadcast.productPlaceholder', 'Search products…')}
                />
                {productMatches.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setProductId(p.id);
                      setProductQuery('');
                    }}
                    style={{
                      paddingVertical: Spacing.two,
                      paddingHorizontal: Spacing.three,
                      borderRadius: Spacing.two,
                      backgroundColor: theme.backgroundElement,
                    }}
                  >
                    <ThemedText type="small">{p.name}</ThemedText>
                  </Pressable>
                ))}
              </>
            )}

            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                title={t('broadcast.send', 'Send to all buyers')}
                onPress={() => void publish()}
                loading={publishing}
                disabled={!title.trim() || !body.trim()}
              />
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 160, borderRadius: Spacing.two },
});
