import {
  addProduct,
  deleteImage,
  deleteProduct,
  getIdToken,
  userHasPermission,
  PRODUCT_UNITS,
  putImage,
  sendNotify,
  subscribeCategories,
  subscribeProducts,
  UNIT_LABELS,
  updateProduct,
  type Category,
  type PrepUnit,
  type Product,
  type ProductDraft,
  type ProductUnit,
} from '@common';
import { Timestamp } from 'firebase/firestore';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Screen,
  SectionTitle,
  SwitchRow,
  TextField,
} from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCachedImage } from '@/hooks/use-cached-image';
import { useTheme } from '@/hooks/use-theme';
import { shopId, notifyUrl } from '@/lib/config';
import { useAuth } from '@/lib/auth';
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

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { appUser } = useAuth();
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const isEdit = !!id;

  const [cats, setCats] = useState<Category[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [discountPrice, setDiscountPrice] = useState('');
  const [unit, setUnit] = useState<ProductUnit | null>(null);

  const [imageId, setImageId] = useState<string | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(null);

  const [active, setActive] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [perishable, setPerishable] = useState(false);

  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);

  const [trackStock, setTrackStock] = useState(false);
  const [stock, setStock] = useState('');

  const [onDemand, setOnDemand] = useState(false);
  const [prepValue, setPrepValue] = useState('');
  const [prepUnit, setPrepUnit] = useState<PrepUnit>('hours');

  const [saving, setSaving] = useState(false);

  const canWrite = userHasPermission(appUser, 'products.write');
  const loadedRef = useRef(false);
  const loadedProductRef = useRef<Product | null>(null);

  useEffect(() => {
    if (!canWrite) return;
    return subscribeCategories(shopId, setCats);
  }, [canWrite]);

  // Populate the form once from the live product when editing.
  useEffect(() => {
    if (!canWrite || !id) return;
    return subscribeProducts(shopId, (list) => {
      if (loadedRef.current) return;
      const p = list.find((x) => x.id === id);
      if (!p) return;
      loadedRef.current = true;
      loadedProductRef.current = p;
      setName(p.name);
      setDescription(p.description);
      setCategoryId(p.categoryId);
      setPrice(String(p.price));
      setDiscountPrice(p.discountPrice != null ? String(p.discountPrice) : '');
      setUnit(p.unit ?? null);
      setImageId(p.imageId ?? null);
      setActive(p.active);
      setFeatured(!!p.featured);
      setPerishable(p.perishable);
      if (p.expiresAt) {
        setHasExpiry(true);
        setExpiryDate(p.expiresAt.toDate());
      }
      setTrackStock(p.trackStock);
      setStock(p.stock != null ? String(p.stock) : '');
      setOnDemand(p.onDemand);
      if (p.prepTime) {
        setPrepValue(String(p.prepTime.value));
        setPrepUnit(p.prepTime.unit);
      }
    });
  }, [canWrite, id]);

  if (!canWrite) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('product.title', 'Product') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('product.noEditHint', "Your role can't edit products.")} />
      </Screen>
    );
  }

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
    });
    const uri = result.assets?.[0]?.uri;
    if (uri) setPickedUri(uri);
  };

  const onSave = async () => {
    const trimmedName = name.trim();
    const priceNum = Number(price);
    const discountNum = discountPrice.trim() ? Number(discountPrice) : null;
    const stockNum = stock.trim() ? Number.parseInt(stock, 10) : 0;
    const prepNum = prepValue.trim() ? Number(prepValue) : 0;

    if (!trimmedName) {
      toast({ type: 'error', title: t('product.missingName', 'Missing name'), message: t('product.missingNameHint', 'Please enter a product name.') });
      return;
    }
    if (!categoryId) {
      toast({ type: 'error', title: t('product.missingCategory', 'Missing category'), message: t('product.missingCategoryHint', 'Please choose a category.') });
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      toast({ type: 'error', title: t('product.invalidPrice', 'Invalid price'), message: t('product.invalidPriceHint', 'Please enter a price greater than 0.') });
      return;
    }
    if (
      discountNum !== null &&
      !(Number.isFinite(discountNum) && discountNum > 0 && discountNum < priceNum)
    ) {
      toast({
        type: 'error',
        title: t('product.invalidDiscount', 'Invalid discount price'),
        message: t('product.invalidDiscountHint', 'Enter a discount greater than 0 and less than the price, or leave it blank.'),
      });
      return;
    }
    if (trackStock && !(Number.isInteger(stockNum) && stockNum >= 0)) {
      toast({ type: 'error', title: t('product.invalidStock', 'Invalid stock'), message: t('product.invalidStockHint', 'Enter the stock as a whole number of 0 or more.') });
      return;
    }
    if (onDemand && !(Number.isFinite(prepNum) && prepNum > 0)) {
      toast({ type: 'error', title: t('product.invalidPrep', 'Invalid prep time'), message: t('product.invalidPrepHint', 'Enter a prep time greater than 0.') });
      return;
    }

    const loaded = loadedProductRef.current;
    const priceChanged =
      !loaded || loaded.price !== priceNum || (loaded.discountPrice ?? null) !== discountNum;
    const stockChanged = !loaded || (loaded.stock ?? null) !== stockNum;

    setSaving(true);
    try {
      let finalImageId = imageId;
      if (pickedUri) {
        let base64: string;
        try {
          base64 = await compressToBase64(pickedUri);
        } catch (e) {
          toast({ type: 'error', title: t('product.imageError', 'Image error'), message: e instanceof Error ? e.message : t('product.imageProcessFail', 'Could not process image.') });
          return;
        }
        let newImageId: string;
        try {
          newImageId = await putImage(base64, 'image/jpeg');
        } catch (e) {
          toast({
            type: 'error',
            title: t('product.imageTooLarge', 'Image too large'),
            message: e instanceof Error ? e.message : t('product.imagePickSmaller', 'Please pick a smaller image.'),
          });
          return;
        }
        const oldImageId = imageId;
        finalImageId = newImageId;
        if (oldImageId && oldImageId !== newImageId) {
          await deleteImage(oldImageId).catch(() => {});
        }
      }

      const draft: ProductDraft = {
        shopId,
        categoryId,
        name: trimmedName,
        description: description.trim(),
        price: priceNum,
        discountPrice: discountNum,
        unit,
        imageId: finalImageId ?? null,
        active,
        featured,
        perishable,
        priceUpdatedAt:
          !id || priceChanged ? Timestamp.now() : loaded?.priceUpdatedAt ?? null,
        expiresAt: hasExpiry ? Timestamp.fromDate(expiryDate) : null,
        trackStock,
        stock: trackStock ? stockNum : null,
        stockUpdatedAt: trackStock
          ? !id || stockChanged
            ? Timestamp.now()
            : loaded?.stockUpdatedAt ?? null
          : null,
        onDemand,
        prepTime: onDemand ? { value: prepNum, unit: prepUnit } : null,
      };

      if (id) {
        await updateProduct(id, draft);
        // Back-in-stock: a tracked product whose stock rose from <= 0 to > 0.
        // Fire-and-forget best-effort push; never block the save flow.
        if (loaded && trackStock && (loaded.stock ?? 0) <= 0 && stockNum > 0) {
          void (async () => {
            try {
              await sendNotify(notifyUrl, await getIdToken(), {
                event: 'back-in-stock',
                shopId,
                productId: id,
                productName: trimmedName,
              });
            } catch {
              // best-effort; ignore push failures
            }
          })();
        }
      } else {
        await addProduct(draft);
      }
      router.back();
    } catch (e) {
      toast({ type: 'error', title: t('common.saveFailed', 'Save failed'), message: e instanceof Error ? e.message : t('common.tryAgain', 'Please try again.') });
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!id) return;
    const ok = await confirm({
      title: t('product.deleteProduct', 'Delete product'),
      message: t('product.deleteConfirm', 'Delete "{name}"?', { name: name || t('product.thisProduct', 'this product') }),
      confirmText: t('common.delete', 'Delete'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!ok) return;
    await deleteProduct(id);
    router.back();
  };

  const cachedUri = useCachedImage(imageId);
  const previewUri = pickedUri ?? cachedUri;

  return (
    <Screen>
      <Stack.Screen options={{ title: isEdit ? t('product.editTitle', 'Edit product') : t('product.addTitle', 'Add product') }} />

      <Card>
        <TextField label={t('product.name', 'Name')} placeholder={t('product.namePlaceholder', 'Product name')} value={name} onChangeText={setName} />
        <TextField
          label={t('product.description', 'Description')}
          placeholder={t('product.description', 'Description')}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          style={{ minHeight: 72, textAlignVertical: 'top' }}
        />
      </Card>

      <SectionTitle>{t('product.category', 'Category')}</SectionTitle>
      <Card>
        {cats.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('product.noCategories', 'No categories yet. Add one on the Products screen first.')}
          </ThemedText>
        ) : (
          <View style={styles.pillRow}>
            {cats.map((c) => {
              const selected = categoryId === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(c.id)}
                  style={[
                    styles.pill,
                    { backgroundColor: selected ? theme.text : theme.backgroundSelected },
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{ color: selected ? theme.background : theme.text }}
                  >
                    {c.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}
      </Card>

      <SectionTitle>{t('product.pricing', 'Pricing')}</SectionTitle>
      <Card>
        <TextField
          label={t('product.price', 'Price')}
          placeholder="0"
          value={price}
          onChangeText={setPrice}
          keyboardType="numeric"
        />
        <TextField
          label={t('product.discountPrice', 'Discount price (optional)')}
          placeholder="0"
          value={discountPrice}
          onChangeText={setDiscountPrice}
          keyboardType="numeric"
        />
      </Card>

      <SectionTitle>{t('product.unit', 'Unit')}</SectionTitle>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {t('product.unitHint', 'Optional. Shown next to the price (e.g. ₹50 / Kg).')}
        </ThemedText>
        <View style={styles.pillRow}>
          {([null, ...PRODUCT_UNITS] as (ProductUnit | null)[]).map((u) => {
            const selected = unit === u;
            const label = u === null ? t('product.none', 'None') : UNIT_LABELS[u];
            return (
              <Pressable
                key={u ?? 'none'}
                onPress={() => setUnit(u)}
                style={[
                  styles.pill,
                  { backgroundColor: selected ? theme.text : theme.backgroundSelected },
                ]}
              >
                <ThemedText
                  type="small"
                  style={{ color: selected ? theme.background : theme.text }}
                >
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionTitle>{t('product.image', 'Image')}</SectionTitle>
      <Card style={{ gap: Spacing.three }}>
        {previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={styles.preview}
            contentFit="cover"
            transition={100}
          />
        ) : (
          <View style={[styles.preview, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <Button title={previewUri ? t('product.changeImage', 'Change image') : t('product.pickImage', 'Pick image')} variant="secondary" onPress={() => void pickImage()} />
      </Card>

      <SectionTitle>{t('product.options', 'Options')}</SectionTitle>
      <Card>
        <SwitchRow label={t('product.active', 'Active')} value={active} onValueChange={setActive} />
        <SwitchRow
          label={t('product.featured', 'Featured (show on buyer home)')}
          value={featured}
          onValueChange={setFeatured}
        />
        <SwitchRow label={t('products.perishable', 'Perishable')} value={perishable} onValueChange={setPerishable} />

        <SwitchRow label={t('product.hasExpiry', 'Has expiry')} value={hasExpiry} onValueChange={setHasExpiry} />
        {hasExpiry ? (
          <View style={{ gap: Spacing.two }}>
            <Pressable onPress={() => setShowPicker(true)}>
              <Badge label={t('product.useBy', 'Use by: {date}', { date: expiryDate.toLocaleDateString() })} />
            </Pressable>
            {showPicker ? (
              <DateTimePicker
                value={expiryDate}
                mode="date"
                onChange={(_event, selected) => {
                  setShowPicker(false);
                  if (selected) setExpiryDate(selected);
                }}
              />
            ) : null}
          </View>
        ) : null}

        <SwitchRow label={t('product.trackStock', 'Track stock')} value={trackStock} onValueChange={setTrackStock} />
        {trackStock ? (
          <TextField
            label={t('product.stockLabel', 'Stock')}
            placeholder="0"
            value={stock}
            onChangeText={setStock}
            keyboardType="numeric"
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('product.alwaysAvailable', 'Always shown as available.')}
          </ThemedText>
        )}

        <SwitchRow label={t('product.madeOnDemand', 'Made on demand')} value={onDemand} onValueChange={setOnDemand} />
        {onDemand ? (
          <View style={{ gap: Spacing.two }}>
            <TextField
              label={t('product.prepTime', 'Prep time')}
              placeholder="0"
              value={prepValue}
              onChangeText={setPrepValue}
              keyboardType="numeric"
            />
            <View style={styles.pillRow}>
              {(['hours', 'days'] as PrepUnit[]).map((u) => {
                const selected = prepUnit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => setPrepUnit(u)}
                    style={[
                      styles.pill,
                      { backgroundColor: selected ? theme.text : theme.backgroundSelected },
                    ]}
                  >
                    <ThemedText
                      type="small"
                      style={{ color: selected ? theme.background : theme.text }}
                    >
                      {u === 'hours' ? t('product.hours', 'hours') : t('product.days', 'days')}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Card>

      <Button title={isEdit ? t('product.saveChanges', 'Save changes') : t('product.create', 'Create product')} onPress={() => void onSave()} loading={saving} />
      {isEdit ? <Button title={t('product.deleteProduct', 'Delete product')} variant="danger" onPress={onDelete} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  preview: { width: '100%', height: 160, borderRadius: Spacing.two },
});
