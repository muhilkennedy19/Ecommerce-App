import {
  DEFAULT_LOYALTY,
  loyaltyConfig,
  pointsForOrder,
  pointsToRupees,
  quoteRedemption,
  subscribeShop,
  updateShop,
  userHasPermission,
  type LoyaltyConfig,
  type Shop,
} from '@common';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Loader,
  Screen,
  SectionTitle,
  SUCCESS,
  SwitchRow,
  TextField,
} from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

/** The numeric fields, kept as strings while editing so a half-typed value isn't clobbered. */
interface Draft {
  earnPerHundred: string;
  minOrderToEarn: string;
  rupeesPerPoint: string;
  minRedeemPoints: string;
  maxRedeemPercent: string;
  referrerBonus: string;
  refereeBonus: string;
}

function toDraft(cfg: LoyaltyConfig): Draft {
  return {
    earnPerHundred: String(cfg.earnPerHundred),
    minOrderToEarn: String(cfg.minOrderToEarn),
    rupeesPerPoint: String(cfg.rupeesPerPoint),
    minRedeemPoints: String(cfg.minRedeemPoints),
    maxRedeemPercent: String(cfg.maxRedeemPercent),
    referrerBonus: String(cfg.referrerBonus),
    refereeBonus: String(cfg.refereeBonus),
  };
}

/** Parse a draft field; returns null when it isn't a usable non-negative number. */
function num(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function LoyaltyScreen() {
  const appUser = useAuth().appUser;
  const t = useT();
  const toast = useToast();
  const canConfig = userHasPermission(appUser, 'shop.config');

  const [shop, setShop] = useState<Shop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const initRef = useRef(false); // populate the form from the shop doc exactly once

  const [enabled, setEnabled] = useState(false);
  const [referralsEnabled, setReferralsEnabled] = useState(false);
  const [playStoreUrl, setPlayStoreUrl] = useState('');
  const [draft, setDraft] = useState<Draft>(toDraft(DEFAULT_LOYALTY));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canConfig) return;
    return subscribeShop(shopId, (s) => {
      setShop(s);
      setLoaded(true);
      if (s && !initRef.current) {
        initRef.current = true;
        const cfg = loyaltyConfig(s.loyalty);
        setEnabled(cfg.enabled);
        setReferralsEnabled(cfg.referralsEnabled);
        setPlayStoreUrl(s.playStoreUrl ?? '');
        setDraft(toDraft(cfg));
      }
    });
  }, [canConfig]);

  if (!canConfig) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('loyalty.title', 'Loyalty & referrals') }} />
        <EmptyState
          title={t('common.noAccess', 'No access')}
          hint={t('loyalty.noAccessHint', "Your role can't change shop settings.")}
        />
      </Screen>
    );
  }

  if (!loaded) {
    return (
      <Screen scroll={false} style={{ justifyContent: 'center' }}>
        <Stack.Screen options={{ title: t('loyalty.title', 'Loyalty & referrals') }} />
        <Loader label={t('common.loading', 'Loading…')} />
      </Screen>
    );
  }

  const set = (key: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));

  /** Validate every field, returning the config to persist or null after toasting. */
  const buildConfig = (): LoyaltyConfig | null => {
    const earnPerHundred = num(draft.earnPerHundred);
    const minOrderToEarn = num(draft.minOrderToEarn);
    const rupeesPerPoint = num(draft.rupeesPerPoint);
    const minRedeemPoints = num(draft.minRedeemPoints);
    const maxRedeemPercent = num(draft.maxRedeemPercent);
    const referrerBonus = num(draft.referrerBonus);
    const refereeBonus = num(draft.refereeBonus);

    const invalid =
      earnPerHundred === null ||
      minOrderToEarn === null ||
      rupeesPerPoint === null ||
      minRedeemPoints === null ||
      maxRedeemPercent === null ||
      referrerBonus === null ||
      refereeBonus === null;
    if (invalid) {
      toast({
        type: 'error',
        title: t('loyalty.invalid', 'Check the numbers'),
        message: t('loyalty.invalidHint', 'Every field must be a number of 0 or more.'),
      });
      return null;
    }
    if (maxRedeemPercent > 100) {
      toast({
        type: 'error',
        title: t('loyalty.invalid', 'Check the numbers'),
        message: t('loyalty.invalidPercent', 'Max redemption cannot exceed 100% of an order.'),
      });
      return null;
    }
    if (enabled && rupeesPerPoint <= 0) {
      toast({
        type: 'error',
        title: t('loyalty.invalid', 'Check the numbers'),
        message: t('loyalty.invalidValue', 'Point value must be greater than 0 to allow redemption.'),
      });
      return null;
    }
    return {
      enabled,
      referralsEnabled,
      earnPerHundred,
      minOrderToEarn,
      rupeesPerPoint,
      minRedeemPoints,
      maxRedeemPercent,
      referrerBonus,
      refereeBonus,
    };
  };

  const onSave = async () => {
    const cfg = buildConfig();
    if (!cfg) return;
    const link = playStoreUrl.trim();
    // Only https links are accepted — the value is pasted straight into a share message that
    // goes to the buyer's contacts, so a stray scheme shouldn't ride along.
    if (link && !/^https:\/\/\S+$/i.test(link)) {
      toast({
        type: 'error',
        title: t('loyalty.invalidLink', 'Invalid link'),
        message: t('loyalty.invalidLinkHint', 'Paste the full https:// Play Store URL, or leave it blank.'),
      });
      return;
    }
    setSaving(true);
    try {
      await updateShop(shopId, { loyalty: cfg, playStoreUrl: link || null });
      toast({
        type: 'success',
        title: t('loyalty.saved', 'Loyalty updated'),
        message: cfg.enabled
          ? t('loyalty.savedOn', 'Buyers can now earn and redeem points.')
          : t('loyalty.savedOff', 'Loyalty is switched off for buyers.'),
      });
    } catch (e) {
      toast({
        type: 'error',
        title: t('common.couldNotSave', 'Could not save'),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  // Live worked example so the shopkeeper can see what the numbers actually mean.
  const previewCfg = loyaltyConfig({
    enabled,
    referralsEnabled,
    earnPerHundred: num(draft.earnPerHundred) ?? 0,
    minOrderToEarn: num(draft.minOrderToEarn) ?? 0,
    rupeesPerPoint: num(draft.rupeesPerPoint) ?? 0,
    minRedeemPoints: num(draft.minRedeemPoints) ?? 0,
    maxRedeemPercent: num(draft.maxRedeemPercent) ?? 0,
    referrerBonus: num(draft.referrerBonus) ?? 0,
    refereeBonus: num(draft.refereeBonus) ?? 0,
  });
  const SAMPLE_ORDER = 500;
  const samplePoints = pointsForOrder(previewCfg, { subtotal: SAMPLE_ORDER, total: SAMPLE_ORDER, discount: 0 });
  const sampleRedeem = quoteRedemption(previewCfg, previewCfg.minRedeemPoints, SAMPLE_ORDER);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('loyalty.title', 'Loyalty & referrals') }} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <ThemedText type="smallBold" style={{ flex: 1 }}>
            {t('loyalty.programme', 'Loyalty programme')}
          </ThemedText>
          <Badge
            label={enabled ? t('common.on', 'On') : t('common.off', 'Off')}
            color={enabled ? SUCCESS : undefined}
          />
        </View>
        <SwitchRow
          label={t('loyalty.enable', 'Enable loyalty points')}
          value={enabled}
          onValueChange={setEnabled}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'loyalty.enableHint',
            'Off hides every mention of points in the buyer app. Existing balances are kept, not erased.',
          )}
        </ThemedText>
      </Card>

      <SectionTitle>{t('loyalty.earning', 'Earning')}</SectionTitle>
      <Card>
        <TextField
          label={t('loyalty.earnPerHundred', 'Points earned per ₹100 spent')}
          value={draft.earnPerHundred}
          onChangeText={set('earnPerHundred')}
          keyboardType="numeric"
          placeholder="2"
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'loyalty.earnHint',
            'Points are granted when an order is marked served, on the amount paid for goods (after coupons).',
          )}
        </ThemedText>
        <TextField
          label={t('loyalty.minOrderToEarn', 'Minimum order to earn (₹)')}
          value={draft.minOrderToEarn}
          onChangeText={set('minOrderToEarn')}
          keyboardType="numeric"
          placeholder="0"
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t('loyalty.minOrderToEarnHint', '0 means every order earns points.')}
        </ThemedText>
      </Card>

      <SectionTitle>{t('loyalty.redeeming', 'Redeeming')}</SectionTitle>
      <Card>
        <TextField
          label={t('loyalty.rupeesPerPoint', 'Value of 1 point (₹)')}
          value={draft.rupeesPerPoint}
          onChangeText={set('rupeesPerPoint')}
          keyboardType="numeric"
          placeholder="1"
        />
        <TextField
          label={t('loyalty.minRedeemPoints', 'Minimum balance before redeeming')}
          value={draft.minRedeemPoints}
          onChangeText={set('minRedeemPoints')}
          keyboardType="numeric"
          placeholder="50"
        />
        <TextField
          label={t('loyalty.maxRedeemPercent', 'Max % of an order payable by points')}
          value={draft.maxRedeemPercent}
          onChangeText={set('maxRedeemPercent')}
          keyboardType="numeric"
          placeholder="20"
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'loyalty.maxRedeemHint',
            'Stops a large balance wiping out a whole bill. 20% means points can cover at most ₹100 of a ₹500 order.',
          )}
        </ThemedText>
      </Card>

      <SectionTitle>{t('loyalty.referrals', 'Referrals')}</SectionTitle>
      <Card>
        <SwitchRow
          label={t('loyalty.enableReferrals', 'Enable referrals')}
          value={referralsEnabled}
          onValueChange={setReferralsEnabled}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'loyalty.referralsHint',
            'When on, each buyer gets a share code and can enter a friend\u2019s code. Both bonuses are paid once, when the new buyer\u2019s first order is served.',
          )}
        </ThemedText>
        {referralsEnabled && !enabled ? (
          <ThemedText type="small" style={{ color: '#F2A900' }}>
            {t(
              'loyalty.referralsNeedLoyalty',
              'Referral rewards are paid in points — switch loyalty on for this to do anything.',
            )}
          </ThemedText>
        ) : null}
        <TextField
          label={t('loyalty.referrerBonus', 'Bonus points to the referrer')}
          value={draft.referrerBonus}
          onChangeText={set('referrerBonus')}
          keyboardType="numeric"
          placeholder="50"
          editable={referralsEnabled}
        />
        <TextField
          label={t('loyalty.refereeBonus', 'Bonus points to the new buyer')}
          value={draft.refereeBonus}
          onChangeText={set('refereeBonus')}
          keyboardType="numeric"
          placeholder="25"
          editable={referralsEnabled}
        />
        <TextField
          label={t('loyalty.playStoreUrl', 'Play Store link (buyer app)')}
          value={playStoreUrl}
          onChangeText={setPlayStoreUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://play.google.com/store/apps/details?id=com.ecommerce.buyer"
        />
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'loyalty.playStoreUrlHint',
            'Added to the share message once your app is live, so an invited friend can install it. Leave blank until then — only the code is shared.',
          )}
        </ThemedText>
      </Card>

      <SectionTitle>{t('loyalty.preview', 'Worked example')}</SectionTitle>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {t('loyalty.previewOrder', 'On a ₹{amount} order:', { amount: SAMPLE_ORDER })}
        </ThemedText>
        <ThemedText type="small">
          {t('loyalty.previewEarn', '• Buyer earns {points} points (worth ₹{value})', {
            points: samplePoints,
            value: pointsToRupees(previewCfg, samplePoints),
          })}
        </ThemedText>
        <ThemedText type="small">
          {sampleRedeem.points > 0
            ? t('loyalty.previewRedeem', '• With {points} points they can take ₹{value} off', {
                points: sampleRedeem.points,
                value: sampleRedeem.rupees,
              })
            : t('loyalty.previewNoRedeem', '• Nothing redeemable yet: {reason}', {
                reason: sampleRedeem.reason ?? '—',
              })}
        </ThemedText>
        {referralsEnabled ? (
          <ThemedText type="small">
            {t('loyalty.previewReferral', '• A successful referral pays {referrer} + {referee} points', {
              referrer: num(draft.referrerBonus) ?? 0,
              referee: num(draft.refereeBonus) ?? 0,
            })}
          </ThemedText>
        ) : null}
      </Card>

      <Button
        title={t('common.save', 'Save')}
        onPress={() => void onSave()}
        loading={saving}
        disabled={!shop}
      />
    </Screen>
  );
}
