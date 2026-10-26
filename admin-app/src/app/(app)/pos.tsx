import {
  effectivePrice,
  formatQty,
  formatUnitPrice,
  fuzzyFilter,
  isDivisibleUnit,
  placePosSale,
  qtyToSubUnits,
  subUnitOf,
  subUnitsToQty,
  subscribeProducts,
  subscribeShop,
  UNIT_LABELS,
  userHasPermission,
  type OrderItem,
  type PaymentMode,
  type Product,
  type ProductUnit,
  type Shop,
} from '@common';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, DANGER, EmptyState, PRIMARY, Screen, SectionTitle, TextField } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

interface Line {
  key: string;
  productId: string;
  name: string;
  unit: ProductUnit | null; // product base unit (price basis)
  weighable: boolean; // divisible unit AND not a fixed package
  measure: ProductUnit | null; // unit the amount is entered in (base or sub-unit); null = plain count
  amount: number; // value in `measure` (weighable) or whole count (otherwise)
  price: number; // per base unit (weighable) or per item/package (otherwise)
}

const PAY_MODES: PaymentMode[] = ['cash', 'upi', 'card'];

function money(n: number): string {
  return `₹${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

/** Quantity in the product's base unit (kg, piece, …) for pricing + storage. */
function baseQty(l: Line): number {
  if (l.weighable && l.measure && l.measure !== l.unit) {
    // `measure` is the sub-unit (g/ml); `amount` is in sub-units → convert to base (kg/litre).
    return subUnitsToQty(l.amount, l.unit);
  }
  return l.amount;
}

/** Human label for a line's quantity: "500 g" / "1.5 Kg" for weighed, else the plain count. */
function qtyLabel(l: Line): string {
  return l.weighable ? formatQty(baseQty(l), l.unit) : String(baseQty(l));
}

export default function PosScreen() {
  const { appUser, user } = useAuth();
  const t = useT();
  const toast = useToast();
  const theme = useTheme();

  const [products, setProducts] = useState<Product[]>([]);
  const [shop, setShop] = useState<Shop | null>(null);
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [payMode, setPayMode] = useState<PaymentMode>('cash');
  const [customerName, setCustomerName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();

  const canUse = userHasPermission(appUser, 'pos.use');

  useEffect(() => {
    if (!canUse) return;
    const unsubP = subscribeProducts(shopId, setProducts);
    const unsubS = subscribeShop(shopId, setShop);
    return () => {
      unsubP();
      unsubS();
    };
  }, [canUse]);

  const matches = useMemo(() => {
    if (!search.trim()) return [];
    return fuzzyFilter(
      products.filter((p) => p.active),
      search,
      (p) => [p.name, p.description],
    ).slice(0, 20);
  }, [products, search]);

  const total = useMemo(() => lines.reduce((s, l) => s + baseQty(l) * l.price, 0), [lines]);

  if (!canUse) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('pos.title', 'Point of Sale') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('pos.noAccessHint', 'Your role does not include POS.')} />
      </Screen>
    );
  }

  const addProduct = (p: Product) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], amount: Math.round((next[i].amount + 1) * 1000) / 1000 };
        return next;
      }
      const weighable = isDivisibleUnit(p.unit) && !p.fixedQty;
      return [
        ...prev,
        {
          key: `${p.id}:${Date.now()}`,
          productId: p.id,
          name: p.name,
          unit: p.unit ?? null,
          weighable,
          measure: weighable ? (p.unit ?? null) : null,
          amount: 1,
          price: effectivePrice(p),
        },
      ];
    });
  };

  const addBySearch = (p: Product) => {
    addProduct(p);
    setSearch('');
  };

  const onScanned = ({ data }: { data: string }) => {
    const code = data.trim();
    if (!code) return;
    const p = products.find((x) => x.active && (x.barcodes ?? []).some((b) => b.code === code));
    if (!p) {
      toast({ type: 'error', title: t('pos.unknownCode', 'Unknown barcode'), message: code });
      return;
    }
    addProduct(p);
    toast({ type: 'success', title: t('pos.added', 'Added'), message: p.name });
    setScanning(false);
  };

  const openScanner = async () => {
    if (!camPerm?.granted) {
      const res = await requestCamPerm();
      if (!res.granted) {
        toast({ type: 'error', title: t('pos.cameraDenied', 'Camera blocked'), message: t('pos.cameraDeniedHint', 'Enable camera access to scan.') });
        return;
      }
    }
    setScanning(true);
  };

  const setAmount = (key: string, text: string) => {
    const n = text.trim() ? Math.max(0, Number(text) || 0) : 0;
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, amount: n } : l)));
  };
  const setPrice = (key: string, text: string) => {
    const n = text.trim() ? Math.max(0, Number(text) || 0) : 0;
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, price: n } : l)));
  };
  const setMeasure = (key: string, measure: ProductUnit) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const base = baseQty(l); // preserve the physical quantity across the unit switch
        const amount = measure === l.unit ? base : qtyToSubUnits(base, l.unit);
        return { ...l, measure, amount: Math.round(amount * 1000) / 1000 };
      }),
    );
  };
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  async function generateBill(billId: string, grand: number) {
    try {
      const rows = lines
        .map(
          (l) =>
            `<tr><td>${esc(l.name)}</td><td style="text-align:right">${esc(qtyLabel(l))}</td><td style="text-align:right">${money(
              l.price,
            )}</td><td style="text-align:right">${money(baseQty(l) * l.price)}</td></tr>`,
        )
        .join('');
      const html = `<html><head><meta charset="utf-8"><style>
        body{font-family:-apple-system,Roboto,sans-serif;padding:24px;color:#111}
        h1{font-size:20px;margin:0} .muted{color:#555;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
        th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}
        tfoot td{font-weight:700;border-top:2px solid #333}
      </style></head><body>
        <h1>${esc(shop?.name ?? 'Shop')}</h1>
        <div class="muted">${esc(t('pos.billTitle', 'POS Bill'))} · ${esc(billId.slice(0, 6))} · ${esc(new Date().toLocaleString())}</div>
        <div class="muted">${esc(t('pos.payment', 'Payment'))}: ${esc(payMode.toUpperCase())}${customerName.trim() ? ' · ' + esc(customerName.trim()) : ''}</div>
        <table>
          <thead><tr><th>${esc(t('pos.item', 'Item'))}</th><th style="text-align:right">${esc(t('pos.qty', 'Qty'))}</th><th style="text-align:right">${esc(t('pos.rate', 'Rate'))}</th><th style="text-align:right">${esc(t('pos.amount', 'Amount'))}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3">${esc(t('pos.total', 'Total'))}</td><td style="text-align:right">${money(grand)}</td></tr></tfoot>
        </table>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      // bill generation is best-effort; the sale is already saved
    }
  }

  const onCheckout = async () => {
    if (!user || lines.length === 0) return;
    const items: OrderItem[] = lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      price: Math.round(l.price * 100) / 100,
      qty: Math.round(baseQty(l) * 1000) / 1000,
      unit: l.unit,
    }));
    if (items.some((i) => i.qty <= 0 || i.price < 0)) {
      toast({ type: 'error', title: t('pos.invalidLine', 'Check quantities'), message: t('pos.invalidLineHint', 'Every line needs a quantity greater than 0.') });
      return;
    }
    setSaving(true);
    try {
      const grand = Math.round(total * 100) / 100;
      const billId = await placePosSale({
        shopId,
        operatorId: user.uid,
        operatorName: appUser?.name ?? null,
        customerName: customerName.trim() || null,
        items,
        paymentMode: payMode,
      });
      await generateBill(billId, grand);
      toast({ type: 'success', title: t('pos.saleSaved', 'Sale recorded'), message: money(grand) });
      setLines([]);
      setCustomerName('');
      setPayMode('cash');
    } catch (e) {
      toast({ type: 'error', title: t('pos.saveFailed', 'Could not save sale'), message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const payLabel = (m: PaymentMode): string =>
    m === 'cash' ? t('pos.cash', 'Cash') : m === 'upi' ? t('pos.upi', 'UPI') : t('pos.card', 'Card');

  return (
    <Screen>
      <Stack.Screen options={{ title: t('pos.title', 'Point of Sale') }} />

      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <TextField
            placeholder={t('pos.searchAdd', 'Search product to add')}
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
        </View>
        <Pressable
          onPress={() => void openScanner()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('pos.scan', 'Scan barcode')}
          style={[styles.scanBtn, { backgroundColor: PRIMARY }]}
        >
          <ThemedText style={{ fontSize: 18, color: '#fff' }}>{'⌘'}</ThemedText>
        </Pressable>
      </View>

      {matches.length > 0 ? (
        <Card style={{ gap: Spacing.one }}>
          {matches.map((p) => (
            <Pressable key={p.id} onPress={() => addBySearch(p)} style={styles.matchRow}>
              <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                {p.name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatUnitPrice(effectivePrice(p), p.unit)}
              </ThemedText>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <SectionTitle>{t('pos.cart', 'Current sale')}</SectionTitle>
      {lines.length === 0 ? (
        <EmptyState title={t('pos.empty', 'No items yet')} hint={t('pos.emptyHint', 'Search or scan to add products.')} />
      ) : (
        lines.map((l) => {
          const sub = l.weighable ? subUnitOf(l.unit) : null;
          return (
            <Card key={l.key} style={{ gap: Spacing.two }}>
              <View style={styles.lineTop}>
                <ThemedText type="smallBold" style={{ flex: 1 }} numberOfLines={1}>
                  {l.name}
                </ThemedText>
                <Pressable onPress={() => removeLine(l.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.delete', 'Delete')}>
                  <ThemedText style={{ fontSize: 18, color: DANGER }}>{'✕'}</ThemedText>
                </Pressable>
              </View>
              {l.weighable && sub && l.unit ? (
                <View style={styles.measureRow}>
                  {([l.unit, sub.label as ProductUnit] as ProductUnit[]).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMeasure(l.key, m)}
                      style={[styles.measurePill, { backgroundColor: l.measure === m ? PRIMARY : theme.backgroundElement }]}
                    >
                      <ThemedText type="small" style={{ color: l.measure === m ? '#fff' : theme.text }}>
                        {UNIT_LABELS[m]}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.lineFields}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={
                      l.weighable && l.measure
                        ? t('pos.amountIn', 'Amount ({unit})', { unit: UNIT_LABELS[l.measure] })
                        : t('pos.qty', 'Qty')
                    }
                    value={String(l.amount)}
                    onChangeText={(v) => setAmount(l.key, v)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    label={l.weighable && l.unit ? t('pos.pricePer', 'Price / {unit}', { unit: UNIT_LABELS[l.unit] }) : t('pos.unitPrice', 'Price')}
                    value={String(l.price)}
                    onChangeText={(v) => setPrice(l.key, v)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ justifyContent: 'flex-end', paddingBottom: Spacing.two }}>
                  <ThemedText type="smallBold">{money(baseQty(l) * l.price)}</ThemedText>
                </View>
              </View>
            </Card>
          );
        })
      )}

      <SectionTitle>{t('pos.payment', 'Payment')}</SectionTitle>
      <View style={styles.payRow}>
        {PAY_MODES.map((m) => (
          <Pressable
            key={m}
            onPress={() => setPayMode(m)}
            style={[styles.payPill, { backgroundColor: payMode === m ? PRIMARY : theme.backgroundElement }]}
          >
            <ThemedText type="small" style={{ color: payMode === m ? '#fff' : theme.text }}>
              {payLabel(m)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Card>
        <TextField
          label={t('pos.customerOptional', 'Customer name (optional)')}
          value={customerName}
          onChangeText={setCustomerName}
          placeholder={t('pos.walkIn', 'Walk-in')}
        />
      </Card>

      <Card style={styles.totalRow}>
        <ThemedText type="smallBold">{t('pos.total', 'Total')}</ThemedText>
        <ThemedText type="title" style={{ fontSize: 22, lineHeight: 28 }}>{money(total)}</ThemedText>
      </Card>

      <Button
        title={t('pos.checkout', 'Save & generate bill')}
        onPress={() => void onCheckout()}
        loading={saving}
        disabled={lines.length === 0}
      />

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          {camPerm?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr'],
              }}
              onBarcodeScanned={onScanned}
            />
          ) : (
            <View style={styles.camFallback}>
              <ThemedText style={{ color: '#fff', textAlign: 'center' }}>
                {t('pos.cameraNeeded', 'Camera access is needed to scan barcodes.')}
              </ThemedText>
              <Button title={t('pos.grantCamera', 'Grant camera access')} onPress={() => void requestCamPerm()} />
            </View>
          )}
          <View style={styles.scanBar}>
            <ThemedText style={{ color: '#fff', textAlign: 'center' }}>
              {t('pos.scanHint', 'Point at a product barcode to add it.')}
            </ThemedText>
            <Button title={t('common.done', 'Done')} onPress={() => setScanning(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  scanBtn: { width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  lineTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  measureRow: { flexDirection: 'row', gap: Spacing.two },
  measurePill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999 },
  lineFields: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  payPill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 999 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  camFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  scanBar: { position: 'absolute', bottom: 48, left: Spacing.four, right: Spacing.four, gap: Spacing.two },
});
