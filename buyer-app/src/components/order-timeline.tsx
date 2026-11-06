import { ORDER_STATUS_LABELS, type Order, type OrderStatus } from '@common';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DANGER, PRIMARY, SUCCESS } from '@/components/kit';

const DOT_COLOR: Record<OrderStatus, string> = {
  new: PRIMARY,
  accepted: '#F5A623',
  packed: '#12A594',
  out_for_delivery: '#8E4EC6',
  served: SUCCESS,
  cancelled: DANGER,
};

function formatWhen(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleString();
}

/**
 * Renders an order's `statusLog` as a vertical timeline: who moved it where, and when.
 *
 * The log is written on every transition (placement, accept, out-for-delivery, served,
 * cancelled), so this is purely a view over data that already exists — no extra reads.
 * Entries are shown oldest-first because that is the order events happened in.
 */
export function OrderTimeline({
  order,
  showActor = true,
}: Readonly<{ order: Order; showActor?: boolean }>) {
  const theme = useTheme();
  const entries = [...(order.statusLog ?? [])].sort((a, b) => a.at - b.at);

  if (entries.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {order.createdAt ? formatWhen(order.createdAt.toMillis()) : '—'}
      </ThemedText>
    );
  }

  return (
    <View style={styles.wrap}>
      {entries.map((e, i) => {
        const isLast = i === entries.length - 1;
        const color = DOT_COLOR[e.status] ?? PRIMARY;
        return (
          <View key={`${e.status}-${e.at}`} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              {/* The connector is drawn by every entry except the last. */}
              {!isLast ? (
                <View style={[styles.line, { backgroundColor: theme.backgroundSelected }]} />
              ) : null}
            </View>
            <View style={styles.body}>
              <ThemedText type="smallBold" style={{ color }}>
                {ORDER_STATUS_LABELS[e.status] ?? e.status}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatWhen(e.at)}
                {showActor && e.byName ? ` · ${e.byName}` : ''}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0 },
  row: { flexDirection: 'row', gap: Spacing.two },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  line: { width: 2, flex: 1, marginVertical: 2 },
  body: { flex: 1, paddingBottom: Spacing.three, gap: 2 },
});
