import {
  fetchUsageSnapshot,
  USAGE_COLLECTIONS,
  userHasRole,
  type UsageSnapshot,
} from '@common';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, DANGER, EmptyState, Loader, Screen, SectionTitle, SUCCESS } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { firebaseConfig } from '@/lib/config';
import { logError } from '@/lib/logging';
import { useT } from '@/lib/i18n';

/**
 * Spark (free) plan ceilings, for context next to the measured numbers.
 * Source: firebase.google.com/pricing — update if Google changes them.
 */
const SPARK_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GiB total Firestore storage
const SPARK_READS_PER_DAY = 50_000;
const SPARK_WRITES_PER_DAY = 20_000;

/** Rough bytes-on-disk for a document, excluding the image blob itself. */
const AVG_DOC_OVERHEAD_BYTES = 1024;

function fmtBytes(n: number): string {
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.min(100, Math.round((part / whole) * 100));
}

export default function UsageScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const isSuperuser = userHasRole(appUser, 'superuser');

  const [snap, setSnap] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnap(await fetchUsageSnapshot());
    } catch (e) {
      logError('usage.fetch', e);
      toast({
        type: 'error',
        title: t('usage.failed', 'Could not read usage'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    if (isSuperuser) void load();
  }, [isSuperuser, load]);

  if (!isSuperuser) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('usage.title', 'Firebase usage') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('usage.noAccessHint', 'Only a superuser can view project usage.')}
        />
      </Screen>
    );
  }

  const projectId = firebaseConfig.projectId ?? '';
  const consoleUrl = `https://console.firebase.google.com/project/${projectId}/firestore/usage`;

  // Storage estimate: measured image bytes plus a flat per-document allowance for
  // everything else. Deliberately labelled an estimate — Firestore bills indexes too.
  const estimatedStorage = snap
    ? snap.imageBytesKnown + Math.max(0, snap.totalDocs - (snap.counts.images ?? 0)) * AVG_DOC_OVERHEAD_BYTES
    : 0;
  const storagePct = pct(estimatedStorage, SPARK_STORAGE_BYTES);

  return (
    <Screen onRefresh={() => void load()} refreshing={loading}>
      <Stack.Screen options={{ title: t('usage.title', 'Firebase usage') }} />

      {!snap && loading ? <Loader label={t('usage.loading', 'Measuring…')} /> : null}

      {snap ? (
        <>
          <SectionTitle>{t('usage.storage', 'Estimated storage')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            <View style={styles.row}>
              <ThemedText type="title" style={{ flex: 1, fontSize: 24 }}>
                {fmtBytes(estimatedStorage)}
              </ThemedText>
              <Badge
                label={t('usage.ofLimit', '{pct}% of 1 GiB', { pct: storagePct })}
                color={storagePct > 80 ? DANGER : SUCCESS}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('usage.imagesBreakdown', 'Images: {size} across {count} docs', {
                size: fmtBytes(snap.imageBytesKnown),
                count: snap.counts.images ?? 0,
              })}
            </ThemedText>
            {snap.imagesUnmeasured > 0 ? (
              <ThemedText type="small" style={{ color: '#F2A900' }}>
                {t(
                  'usage.unmeasured',
                  '{count} older images have no recorded size and are not included — they will be measured as they are re-uploaded.',
                  { count: snap.imagesUnmeasured },
                )}
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {t(
                'usage.storageCaveat',
                'Estimate only: measured image bytes plus ~1 KB per other document. Firestore also bills index storage, so the real figure is higher. Use the console for the billed number.',
              )}
            </ThemedText>
          </Card>

          <SectionTitle>{t('usage.documents', 'Documents')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            {USAGE_COLLECTIONS.map((name) => {
              const n = snap.counts[name] ?? 0;
              return (
                <View key={name} style={styles.row}>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {name}
                  </ThemedText>
                  <ThemedText type="smallBold">
                    {n < 0 ? t('usage.noRead', 'no access') : n.toLocaleString()}
                  </ThemedText>
                </View>
              );
            })}
            <View style={[styles.row, styles.totalRow]}>
              <ThemedText type="smallBold" style={{ flex: 1 }}>
                {t('usage.total', 'Total')}
              </ThemedText>
              <ThemedText type="smallBold">{snap.totalDocs.toLocaleString()}</ThemedText>
            </View>
          </Card>

          <SectionTitle>{t('usage.limits', 'Spark plan daily limits')}</SectionTitle>
          <Card style={{ gap: Spacing.one }}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('usage.readsLimit', 'Reads: {n} / day', {
                n: SPARK_READS_PER_DAY.toLocaleString(),
              })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('usage.writesLimit', 'Writes: {n} / day', {
                n: SPARK_WRITES_PER_DAY.toLocaleString(),
              })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(
                'usage.liveQuotaCaveat',
                'Google does not expose live read/write counters to client apps — only the console and Cloud Monitoring have them.',
              )}
            </ThemedText>
          </Card>

          <Card style={{ gap: Spacing.one }}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('usage.snapshotCost', 'This snapshot cost about {n} Firestore reads.', {
                n: snap.readsUsed,
              })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('usage.takenAt', 'Measured {when}', {
                when: new Date(snap.takenAt).toLocaleTimeString(),
              })}
            </ThemedText>
          </Card>
        </>
      ) : null}

      <Button
        title={t('usage.refresh', 'Refresh')}
        onPress={() => void load()}
        loading={loading}
      />
      {projectId ? (
        <Button
          title={t('usage.openConsole', 'Open Firebase console')}
          variant="secondary"
          onPress={() => void Linking.openURL(consoleUrl)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#8883', paddingTop: Spacing.two },
});
