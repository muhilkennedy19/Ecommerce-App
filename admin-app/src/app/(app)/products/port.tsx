import {
  addCategory,
  addProduct,
  getFast2SmsKey,
  putImage,
  setFast2SmsKey,
  subscribeCategories,
  subscribeProducts,
  updateProduct,
  upsertReview,
  userHasRole,
  type Barcode,
  type Category,
  type Product,
  type ProductUnit,
} from '@common';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as XLSX from 'xlsx';

import { useToast } from '@/components/feedback';
import { Badge, Button, Card, DANGER, EmptyState, Screen, SectionTitle, SUCCESS, TextField } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

const UNITS: ProductUnit[] = ['kg', 'g', 'litre', 'ml', 'piece'];
const bool = (v: unknown) => ['true', '1', 'yes', 'y'].includes(String(v).trim().toLowerCase());
const yn = (v: boolean) => (v ? 'TRUE' : 'FALSE');
const num = (v: unknown): number | undefined => {
  const s = String(v).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** "CODE=10; OTHER=5" → Barcode[]. */
function parseBarcodes(v: unknown): Barcode[] {
  const s = String(v).trim();
  if (!s) return [];
  return s
    .split(';')
    .map((part) => {
      const [code, qty] = part.split('=');
      return { code: (code ?? '').trim(), qty: Math.max(0, Math.round(num(qty) ?? 0)) };
    })
    .filter((b) => b.code);
}
const serializeBarcodes = (bs: Barcode[] | null | undefined) =>
  (bs ?? []).map((b) => `${b.code}=${b.qty}`).join('; ');

interface Row {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  price?: string | number;
  discountPrice?: string | number;
  unit?: string;
  active?: string;
  featured?: string;
  perishable?: string;
  trackStock?: string;
  stock?: string | number;
  fixedQty?: string;
  onDemand?: string;
  prepTimeValue?: string | number;
  prepTimeUnit?: string;
  expiresAt?: string;
  barcodes?: string;
  imageId?: string;
  /** Import-only: raw base64 image (no data: prefix). When present, stored via putImage. */
  imageBase64?: string;
  /** Import-only: 1–5; seeds one review for the product by the importing superuser. */
  rating?: string | number;
}

/** png/jpeg sniff from base64 magic bytes, so putImage records the right mime. */
function sniffMime(b64: string): string {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  return 'image/png';
}

function maskKey(key: string): string {
  if (key.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}

export default function ProductPort() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const isSuper = userHasRole(appUser, 'superuser');

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);

  // Fast2SMS key — a shared secret, superuser-only (this whole screen is superuser-gated).
  const [fast2sms, setFast2sms] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    if (!isSuper) return;
    return subscribeProducts(shopId, setProducts);
  }, [isSuper]);
  useEffect(() => {
    if (!isSuper) return;
    return subscribeCategories(shopId, setCategories);
  }, [isSuper]);
  useEffect(() => {
    if (!isSuper) return;
    void getFast2SmsKey().then(setFast2sms);
  }, [isSuper]);

  const saveKey = async () => {
    const key = keyInput.trim();
    if (!key) return;
    setSavingKey(true);
    try {
      await setFast2SmsKey(key);
      setFast2sms(key);
      setKeyInput('');
      toast({ type: 'success', title: t('common.saved', 'Saved'), message: t('settings.keyUpdated', 'Fast2SMS key updated.') });
    } catch (e) {
      toast({ type: 'error', title: t('settings.couldNotSaveKey', 'Could not save key'), message: String(e) });
    } finally {
      setSavingKey(false);
    }
  };

  const exportProducts = async () => {
    setBusy(true);
    try {
      const catName = new Map(categories.map((c) => [c.id, c.name]));
      const rows: Row[] = products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: catName.get(p.categoryId) ?? '',
        price: p.price,
        discountPrice: p.discountPrice ?? '',
        unit: p.unit ?? '',
        active: yn(p.active),
        featured: yn(!!p.featured),
        perishable: yn(p.perishable),
        trackStock: yn(p.trackStock),
        stock: p.stock ?? '',
        fixedQty: yn(!!p.fixedQty),
        onDemand: yn(p.onDemand),
        prepTimeValue: p.prepTime?.value ?? '',
        prepTimeUnit: p.prepTime?.unit ?? '',
        expiresAt: p.expiresAt ? p.expiresAt.toDate().toISOString().slice(0, 10) : '',
        barcodes: serializeBarcodes(p.barcodes),
        imageId: p.imageId ?? '',
        imageBase64: '',
        rating: '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');
      const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const path = FileSystem.cacheDirectory + 'products.xlsx';
      await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      toast({ type: 'success', title: t('port.exported', 'Exported'), message: t('port.exportedHint', '{n} products', { n: products.length }) });
    } catch (e) {
      toast({ type: 'error', title: t('port.exportFailed', 'Export failed'), message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const importProducts = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', '*/*'],
      });
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;
      setBusy(true);
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const wb = XLSX.read(b64, { type: 'base64' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: '' });

      // Local category name→id map, extended as new categories are created during the import.
      const catByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
      let catCount = categories.length;
      const productId = new Set(products.map((p) => p.id));

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const r of rows) {
        const name = String(r.name ?? '').trim();
        const price = num(r.price);
        const categoryName = String(r.category ?? '').trim();
        // Required: name, a valid price, and a category.
        if (!name || price === undefined || price < 0 || !categoryName) {
          skipped++;
          continue;
        }

        // Resolve (or create) the category by name.
        let categoryId = catByName.get(categoryName.toLowerCase());
        if (!categoryId) {
          categoryId = await addCategory(shopId, categoryName, catCount++);
          catByName.set(categoryName.toLowerCase(), categoryId);
        }

        const unit = UNITS.includes(String(r.unit).trim() as ProductUnit) ? (String(r.unit).trim() as ProductUnit) : null;
        const bars = parseBarcodes(r.barcodes);
        const usesBarcodes = bars.length > 0;
        const trackStock = usesBarcodes ? true : bool(r.trackStock);
        const stockFromBars = bars.reduce((s, b) => s + b.qty, 0);
        const manualStock = num(r.stock);
        const onDemand = bool(r.onDemand);
        const prepVal = num(r.prepTimeValue);
        const prepUnit = String(r.prepTimeUnit).trim() === 'days' ? 'days' : 'hours';
        const discount = num(r.discountPrice);
        let expiresAt: Timestamp | null = null;
        const exp = String(r.expiresAt ?? '').trim();
        if (exp) {
          const [y, m, d] = exp.split('-').map((x) => Number(x));
          if (y && m && d) expiresAt = Timestamp.fromDate(new Date(y, m - 1, d));
        }

        // Optional inline image: store the base64 and reference it by id.
        let imageId: string | null = String(r.imageId ?? '').trim() || null;
        const inlineImg = String(r.imageBase64 ?? '').trim();
        if (inlineImg) {
          try {
            imageId = await putImage(inlineImg, sniffMime(inlineImg));
          } catch {
            // keep whatever imageId column had if the blob is rejected (e.g. >1MB)
          }
        }

        const fields = {
          shopId,
          categoryId,
          name,
          description: String(r.description ?? '').trim(),
          price,
          discountPrice: discount !== undefined ? discount : null,
          unit,
          imageId,
          active: bool(r.active),
          featured: bool(r.featured),
          perishable: bool(r.perishable),
          priceUpdatedAt: Timestamp.now(),
          expiresAt,
          trackStock,
          stock: usesBarcodes ? stockFromBars : manualStock ?? null,
          stockUpdatedAt: Timestamp.now(),
          fixedQty: bool(r.fixedQty),
          barcodes: usesBarcodes ? bars : null,
          onDemand,
          prepTime: onDemand && prepVal !== undefined ? { value: prepVal, unit: prepUnit as 'hours' | 'days' } : null,
        };

        const id = String(r.id ?? '').trim();
        let finalId = id;
        if (id && productId.has(id)) {
          await updateProduct(id, fields);
          updated++;
        } else {
          finalId = await addProduct(fields);
          created++;
        }

        // Optional rating: seed one review for the product by the importing superuser
        // (Rules allow one review per uid per product). Enough to populate the catalog's
        // average-rating badge for load testing.
        const rating = num(r.rating);
        if (rating !== undefined && rating >= 1 && rating <= 5 && appUser) {
          try {
            await upsertReview({
              productId: finalId,
              shopId,
              uid: appUser.uid,
              customerName: appUser.name ?? null,
              rating: Math.round(rating),
              text: null,
            });
          } catch {
            // non-fatal — a missing review shouldn't fail the whole import
          }
        }
      }

      toast({
        type: 'success',
        title: t('port.imported', 'Import complete'),
        message: t('port.importedHint', 'Created {c}, updated {u}, skipped {s}.', { c: created, u: updated, s: skipped }),
      });
    } catch (e) {
      toast({ type: 'error', title: t('port.importFailed', 'Import failed'), message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!isSuper) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('port.title', 'Import / Export products') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('port.noAccess', 'Only the superuser can import/export products.')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('port.title', 'Import / Export products') }} />

      <SectionTitle>{t('port.export', 'Export')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('port.exportHint', 'Download all {n} products (with every detail) as an Excel file.', { n: products.length })}
        </ThemedText>
        <Button title={t('port.exportBtn', 'Export to Excel')} onPress={() => void exportProducts()} loading={busy} />
      </Card>

      <SectionTitle>{t('port.import', 'Import')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'port.importHint',
            'Pick an edited export. Rows with a matching id are updated; rows with a blank/new id are created. Categories are matched by name (created if new). Required: name, price, category.',
          )}
        </ThemedText>
        <Button title={t('port.importBtn', 'Import from Excel')} variant="secondary" onPress={() => void importProducts()} loading={busy} />
      </Card>

      <SectionTitle>{t('settings.fast2sms', 'Fast2SMS key')}</SectionTitle>
      <Card style={{ gap: Spacing.two }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            {fast2sms ? t('settings.keySetMasked', 'Key set · {masked}', { masked: maskKey(fast2sms) }) : t('settings.notSet', 'Not set')}
          </ThemedText>
          <Badge label={fast2sms ? t('settings.keySet', 'Key set') : t('settings.notSet', 'Not set')} color={fast2sms ? SUCCESS : DANGER} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('settings.fast2smsWarn', 'WARNING: Stored in the database and read by the buyer app when sending OTP — a known, accepted exposure. For production, move it behind a server.')}
        </ThemedText>
        <TextField
          label={fast2sms ? t('settings.rotateKey', 'Rotate / replace key') : t('settings.newKey', 'New key')}
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder={t('settings.pasteKey', 'Paste Fast2SMS API key')}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          title={fast2sms ? t('settings.saveReplaceKey', 'Save (replace key)') : t('settings.saveKey', 'Save key')}
          loading={savingKey}
          disabled={!keyInput.trim()}
          onPress={() => void saveKey()}
        />
      </Card>
    </Screen>
  );
}
