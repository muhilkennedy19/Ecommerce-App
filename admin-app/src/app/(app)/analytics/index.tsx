import {
  subscribeOrders,
  subscribeProducts,
  userHasPermission,
  type Order,
  type OrderStatus,
  type Product,
} from '@common';
import { Stack } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as XLSX from 'xlsx';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  PRIMARY,
  Screen,
  SectionTitle,
  TextField,
} from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

type RangePreset = '7' | '30' | 'all';
const RANGE_KEYS: Record<RangePreset, { key: string; en: string }> = {
  '7': { key: 'analytics.range7', en: 'Last 7 days' },
  '30': { key: 'analytics.range30', en: 'Last 30 days' },
  all: { key: 'analytics.rangeAll', en: 'All time' },
};

type StatusFilter = 'all' | OrderStatus;
const STATUS_FILTERS: StatusFilter[] = ['all', 'new', 'accepted', 'out_for_delivery', 'served', 'cancelled'];

type PaymentFilter = 'all' | 'cod' | 'upi';
const PAYMENT_FILTERS: PaymentFilter[] = ['all', 'cod', 'upi'];

// How many product chips to show before the user searches. Keeps the chip row
// short and fast even with a catalog of hundreds (see search box below).
const TOP_CHIPS = 8;
const SEARCH_CHIP_CAP = 20;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtMoney(n: number): string {
  return `₹${n.toFixed(2)}`;
}

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString() : '—';
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function statusColor(status: Order['status']): string {
  switch (status) {
    case 'served':
      return '#30A46C';
    case 'cancelled':
      return '#E5484D';
    case 'accepted':
      return '#F2A900';
    default:
      return PRIMARY;
  }
}

/** Escape user-provided text before embedding in the export HTML. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

export default function Analytics() {
  const appUser = useAuth().appUser;
  const t = useT();
  const toast = useToast();
  const theme = useTheme();
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [range, setRange] = useState<RangePreset>('7');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [productQuery, setProductQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');

  const canRead = userHasPermission(appUser, 'analytics.read');

  useEffect(() => {
    if (!canRead) return;
    const unsubOrders = subscribeOrders(shopId, setOrders);
    const unsubProducts = subscribeProducts(shopId, setProducts);
    return () => {
      unsubOrders();
      unsubProducts();
    };
  }, [canRead]);

  // Orders kept after the date-range, status and payment filters — but NOT the
  // single-product chip. Product ranking + monthly insight derive from this so
  // they stay stable (and meaningful) regardless of the selected product chip.
  const scopedOrders = useMemo(() => {
    const rangeDays = range === 'all' ? null : parseInt(range, 10);
    // Align the cutoff to calendar midnight so the overview window matches the
    // chart's day buckets: include today + the previous rangeDays-1 calendar days.
    let cutoff: number | null = null;
    if (rangeDays) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (rangeDays - 1));
      cutoff = start.getTime();
    }
    return orders.filter((o) => {
      const d = o.createdAt?.toDate();
      if (cutoff !== null && (!d || d.getTime() < cutoff)) return false;
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (paymentFilter !== 'all' && (o.paymentMode ?? 'cod') !== paymentFilter) return false;
      return true;
    });
  }, [orders, range, statusFilter, paymentFilter]);

  // Adds the single-product chip filter on top of the scoped set.
  const filtered = useMemo(() => {
    if (productFilter === 'all') return scopedOrders;
    return scopedOrders.filter((o) => o.items.some((i) => i.productId === productFilter));
  }, [scopedOrders, productFilter]);

  // Cancelled orders never count toward revenue / item metrics.
  const revenueOrders = useMemo(() => filtered.filter((o) => o.status !== 'cancelled'), [filtered]);
  const scopedRevenue = useMemo(() => scopedOrders.filter((o) => o.status !== 'cancelled'), [scopedOrders]);

  const totalRevenue = revenueOrders.reduce((s, o) => s + o.total, 0);
  const orderCount = filtered.length;
  const avgOrderValue = revenueOrders.length ? totalRevenue / revenueOrders.length : 0;
  const itemsSold = revenueOrders.reduce((s, o) => s + o.items.reduce((q, i) => q + i.qty, 0), 0);

  // Per-product units + revenue over the scoped range, ranked by units sold.
  const productStats = useMemo(() => {
    const m = new Map<string, { id: string; name: string; qty: number; revenue: number }>();
    for (const o of scopedRevenue) {
      for (const i of o.items) {
        const cur = m.get(i.productId) ?? { id: i.productId, name: i.name, qty: 0, revenue: 0 };
        cur.qty += i.qty;
        cur.revenue += i.price * i.qty;
        cur.name = i.name; // keep the latest snapshot name
        m.set(i.productId, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  }, [scopedRevenue]);

  // Which product chips to render. With an empty query we show only the top
  // sellers; typing filters the full catalog by name (capped). The currently
  // selected product is always appended so its active state stays visible.
  const visibleProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    let list: Product[];
    if (q) {
      list = products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, SEARCH_CHIP_CAP);
    } else {
      const rankIndex = new Map(productStats.map((s, i) => [s.id, i]));
      list = [...products]
        .sort((a, b) => (rankIndex.get(a.id) ?? Infinity) - (rankIndex.get(b.id) ?? Infinity))
        .slice(0, TOP_CHIPS);
    }
    if (productFilter !== 'all' && !list.some((p) => p.id === productFilter)) {
      const sel = products.find((p) => p.id === productFilter);
      if (sel) list = [sel, ...list];
    }
    return list;
  }, [products, productStats, productQuery, productFilter]);

  // The product the monthly breakdown focuses on: the selected chip, else the
  // top seller in range.
  const focusProductId = productFilter !== 'all' ? productFilter : productStats[0]?.id;
  const focusProductName =
    products.find((p) => p.id === focusProductId)?.name ??
    productStats.find((s) => s.id === focusProductId)?.name ??
    '';

  // Units + revenue per calendar month for the focus product.
  const monthly = useMemo(() => {
    if (!focusProductId) return [] as { key: string; label: string; qty: number; revenue: number }[];
    const m = new Map<string, { key: string; label: string; qty: number; revenue: number }>();
    for (const o of scopedRevenue) {
      const dt = o.createdAt?.toDate();
      if (!dt) continue;
      const line = o.items.find((i) => i.productId === focusProductId);
      if (!line) continue;
      const key = monthKey(dt);
      const cur = m.get(key) ?? { key, label: monthLabel(dt), qty: 0, revenue: 0 };
      cur.qty += line.qty;
      cur.revenue += line.price * line.qty;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [scopedRevenue, focusProductId]);

  const bestMonth = useMemo(
    () => monthly.reduce<(typeof monthly)[number] | null>((best, m) => (!best || m.qty > best.qty ? m : best), null),
    [monthly],
  );
  const monthlyMax = Math.max(1, ...monthly.map((m) => m.qty));

  // Revenue per day for the chart (last N days ending today).
  const chartDays = range === '7' ? 7 : range === '30' ? 30 : 30;
  const chart = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: chartDays }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() - (chartDays - 1 - i));
      return { date: d, value: 0 };
    });
    for (const o of revenueOrders) {
      const dt = o.createdAt?.toDate();
      if (!dt) continue;
      const od = new Date(dt);
      od.setHours(0, 0, 0, 0);
      const idx = chartDays - 1 - Math.round((start.getTime() - od.getTime()) / 86_400_000);
      if (idx >= 0 && idx < chartDays) buckets[idx].value += o.total;
    }
    return buckets.map((b) => ({
      label: `${b.date.getDate()}/${b.date.getMonth() + 1}`,
      value: b.value,
    }));
  }, [revenueOrders, chartDays]);

  const rangeLabel = (r: RangePreset): string => t(RANGE_KEYS[r].key, RANGE_KEYS[r].en);
  const statusLabel = (s: StatusFilter): string =>
    s === 'all' ? t('analytics.all', 'All') : t(`analytics.status.${s}`, s);
  const paymentLabel = (p: PaymentFilter): string =>
    p === 'all'
      ? t('analytics.all', 'All')
      : p === 'cod'
        ? t('analytics.paymentCod', 'COD')
        : t('analytics.paymentUpi', 'UPI');

  const filterSummary = t(
    'analytics.filterSummary',
    'Range: {range} · Product: {product} · Orders: {count}',
    {
      range: rangeLabel(range),
      product:
        productFilter === 'all'
          ? t('analytics.all', 'All')
          : (products.find((p) => p.id === productFilter)?.name ?? productFilter),
      count: orderCount,
    },
  );

  async function exportPdf() {
    try {
      const rows = filtered
        .map(
          (o) =>
            `<tr><td>${esc(o.id.slice(0, 6))}</td><td>${esc(
              o.customerName ?? '—',
            )}</td><td>${fmtDate(o.createdAt?.toDate())}</td><td>${o.status}</td><td style="text-align:right">${fmtMoney(
              o.total,
            )}</td></tr>`,
        )
        .join('');
      const html = `<html><head><meta charset="utf-8"><style>
        body{font-family:-apple-system,Roboto,sans-serif;padding:24px;color:#111}
        h1{font-size:20px} p{color:#555}
        table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
        th,td{border:1px solid #ddd;padding:6px;text-align:left}
        th{background:#f3f3f3}
        tfoot td{font-weight:700}
      </style></head><body>
        <h1>${esc(t('analytics.report', 'Analytics Report'))}</h1>
        <p>${esc(filterSummary)}</p>
        <table>
          <thead><tr><th>${esc(t('analytics.colOrder', 'Order'))}</th><th>${esc(t('analytics.colCustomer', 'Customer'))}</th><th>${esc(t('analytics.colDate', 'Date'))}</th><th>${esc(t('analytics.colStatus', 'Status'))}</th><th style="text-align:right">${esc(t('analytics.colTotal', 'Total'))}</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5">${esc(t('analytics.noOrders', 'No orders'))}</td></tr>`}</tbody>
          <tfoot><tr><td colspan="4">${esc(t('analytics.totalRevenue', 'Total revenue'))}</td><td style="text-align:right">${fmtMoney(
            totalRevenue,
          )}</td></tr></tfoot>
        </table>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch (e) {
      toast({ type: 'error', title: t('analytics.exportFailed', 'Export failed'), message: String(e) });
    }
  }

  async function exportExcel() {
    try {
      const rows = filtered.map((o) => ({
        [t('analytics.colOrder', 'Order')]: o.id,
        [t('analytics.colCustomer', 'Customer')]: o.customerName ?? '',
        [t('analytics.colDate', 'Date')]: fmtDate(o.createdAt?.toDate()),
        [t('analytics.colStatus', 'Status')]: o.status,
        [t('analytics.colTotal', 'Total')]: o.total,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');
      const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const path = FileSystem.cacheDirectory + 'orders.xlsx';
      await FileSystem.writeAsStringAsync(path, b64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
    } catch (e) {
      toast({ type: 'error', title: t('analytics.exportFailed', 'Export failed'), message: String(e) });
    }
  }

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('analytics.title', 'Analytics') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('analytics.noAccessHint', "Your role doesn't include analytics. Ask an admin if you need it.")}
        />
      </Screen>
    );
  }

  const chartMax = Math.max(1, ...chart.map((c) => c.value));

  return (
    <Screen>
      <Stack.Screen options={{ title: t('analytics.title', 'Analytics') }} />

      <SectionTitle>{t('analytics.dateRange', 'Date range')}</SectionTitle>
      <View style={styles.pillRow}>
        {(['7', '30', 'all'] as RangePreset[]).map((r) => (
          <Pill key={r} label={rangeLabel(r)} active={range === r} onPress={() => setRange(r)} />
        ))}
      </View>

      <SectionTitle>{t('analytics.statusFilter', 'Order status')}</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        {STATUS_FILTERS.map((s) => (
          <Pill key={s} label={statusLabel(s)} active={statusFilter === s} onPress={() => setStatusFilter(s)} />
        ))}
      </ScrollView>

      <SectionTitle>{t('analytics.paymentFilter', 'Payment')}</SectionTitle>
      <View style={styles.pillRow}>
        {PAYMENT_FILTERS.map((p) => (
          <Pill key={p} label={paymentLabel(p)} active={paymentFilter === p} onPress={() => setPaymentFilter(p)} />
        ))}
      </View>

      <SectionTitle>{t('analytics.product', 'Product')}</SectionTitle>
      <TextField
        value={productQuery}
        onChangeText={setProductQuery}
        placeholder={t('analytics.searchProduct', 'Search products…')}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        <Pill label={t('analytics.all', 'All')} active={productFilter === 'all'} onPress={() => setProductFilter('all')} />
        {visibleProducts.map((p) => (
          <Pill key={p.id} label={p.name} active={productFilter === p.id} onPress={() => setProductFilter(p.id)} />
        ))}
      </ScrollView>
      {productQuery.trim() ? (
        visibleProducts.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.chipHint}>
            {t('analytics.noProductMatch', 'No products match “{q}”.', { q: productQuery.trim() })}
          </ThemedText>
        ) : null
      ) : products.length > TOP_CHIPS ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.chipHint}>
          {t('analytics.chipHint', 'Showing top {shown} of {total} — search to find others.', {
            shown: Math.min(TOP_CHIPS, products.length),
            total: products.length,
          })}
        </ThemedText>
      ) : null}

      <SectionTitle>{t('analytics.overview', 'Overview')}</SectionTitle>
      <View style={styles.grid}>
        <Metric label={t('analytics.totalRevenue', 'Total revenue')} value={fmtMoney(totalRevenue)} />
        <Metric label={t('analytics.orders', 'Orders')} value={String(orderCount)} />
        <Metric label={t('analytics.avgOrderValue', 'Avg order value')} value={fmtMoney(avgOrderValue)} />
        <Metric label={t('analytics.itemsSold', 'Items sold')} value={String(itemsSold)} />
      </View>

      <SectionTitle>{t('analytics.topProducts', 'Top products')}</SectionTitle>
      {productStats.length === 0 ? (
        <EmptyState title={t('analytics.noSales', 'No sales in this range')} />
      ) : (
        <Card style={{ gap: Spacing.two }}>
          {productStats.slice(0, 10).map((s, i) => (
            <View key={s.id} style={styles.rankRow}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.rank}>
                {i + 1}
              </ThemedText>
              <ThemedText type="small" style={{ flex: 1 }} numberOfLines={1}>
                {s.name}
              </ThemedText>
              <ThemedText type="smallBold">{t('analytics.unitsSold', '{qty} sold', { qty: s.qty })}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.rankRevenue}>
                {fmtMoney(s.revenue)}
              </ThemedText>
            </View>
          ))}
        </Card>
      )}

      {focusProductId ? (
        <>
          <SectionTitle>{t('analytics.monthlyTitle', 'Monthly sales · {product}', { product: focusProductName })}</SectionTitle>
          {monthly.length === 0 ? (
            <EmptyState title={t('analytics.noMonthly', 'Not enough data for a monthly breakdown.')} />
          ) : (
            <Card>
              {bestMonth ? (
                <ThemedText type="smallBold" style={{ marginBottom: Spacing.two }}>
                  {t('analytics.bestMonth', 'Best month: {month} · {qty} sold', {
                    month: bestMonth.label,
                    qty: bestMonth.qty,
                  })}
                </ThemedText>
              ) : null}
              <View style={styles.chartRow}>
                {monthly.map((m) => (
                  <View key={m.key} style={styles.chartCol}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.barValue}>
                      {m.qty}
                    </ThemedText>
                    <View
                      style={[
                        styles.bar,
                        { height: Math.max(2, (m.qty / monthlyMax) * 110), backgroundColor: PRIMARY },
                      ]}
                    />
                  </View>
                ))}
              </View>
              {monthly.length <= 8 ? (
                <View style={styles.chartLabelRow}>
                  {monthly.map((m) => (
                    <View key={m.key} style={styles.chartCol}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.axisLabel}>
                        {m.label}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                  {monthly[0]?.label} – {monthly[monthly.length - 1]?.label}
                </ThemedText>
              )}
            </Card>
          )}
        </>
      ) : null}

      <SectionTitle>{t('analytics.revenueLast', 'Revenue · last {count} days', { count: chartDays })}</SectionTitle>
      <Card>
        <View style={styles.chartRow}>
          {chart.map((c, i) => (
            <View key={i} style={styles.chartCol}>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(2, (c.value / chartMax) * 120),
                    backgroundColor: c.value > 0 ? PRIMARY : theme.backgroundSelected,
                  },
                ]}
              />
            </View>
          ))}
        </View>
        {chartDays <= 10 ? (
          <View style={styles.chartLabelRow}>
            {chart.map((c, i) => (
              <View key={i} style={styles.chartCol}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.axisLabel}>
                  {c.label}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {chart[0]?.label} – {chart[chart.length - 1]?.label}
          </ThemedText>
        )}
      </Card>

      <SectionTitle>{t('analytics.export', 'Export')}</SectionTitle>
      <View style={styles.pillRow}>
        <View style={{ flex: 1 }}>
          <Button title={t('analytics.exportPdf', 'Export PDF')} onPress={() => void exportPdf()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('analytics.exportExcel', 'Export Excel')} variant="secondary" onPress={() => void exportExcel()} />
        </View>
      </View>

      <SectionTitle>{t('analytics.orderHistory', 'Order history')}</SectionTitle>
      {filtered.length === 0 ? (
        <EmptyState title={t('analytics.noOrders', 'No orders')} hint={t('analytics.noMatch', 'Nothing matches the current filters.')} />
      ) : (
        filtered.map((o) => (
          <Card key={o.id} style={styles.orderRow}>
            <View style={{ flex: 1, gap: Spacing.half }}>
              <ThemedText type="smallBold">{o.customerName ?? t('analytics.unknownCustomer', 'Unknown customer')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {fmtDate(o.createdAt?.toDate())}
              </ThemedText>
            </View>
            <View style={{ alignItems: 'flex-end', gap: Spacing.one }}>
              <ThemedText type="smallBold">{fmtMoney(o.total)}</ThemedText>
              <Badge label={t(`analytics.status.${o.status}`, o.status)} color={statusColor(o.status)} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1, gap: Spacing.one }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle" style={{ fontSize: 24, lineHeight: 30 }}>
        {value}
      </ThemedText>
    </Card>
  );
}

function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, { backgroundColor: active ? PRIMARY : theme.backgroundSelected }]}
    >
      <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  chipHint: { marginTop: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 132 },
  chartLabelRow: { flexDirection: 'row', gap: 2 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '70%', borderRadius: 2, minHeight: 2 },
  barValue: { fontSize: 9, lineHeight: 12, marginBottom: 2 },
  axisLabel: { fontSize: 9, lineHeight: 12, textAlign: 'center' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rank: { width: 20, textAlign: 'center' },
  rankRevenue: { minWidth: 72, textAlign: 'right' },
  orderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
