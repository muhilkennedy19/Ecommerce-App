import { subscribeShop, type Shop } from '@common';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';

import { useToast } from '@/components/feedback';
import { Button, Card, EmptyState, PRIMARY, Screen, SectionTitle } from '@/components/kit';
import { OccasionLogo } from '@/components/occasion-logo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useShopIconEffect, useShopLogo, useShopName } from '@/hooks/use-shop-name';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';

// react-native-webview ships class-component types that resolve to `never` props under
// React 19's JSX typing. Cast to a functional-component type so props type-check.
const RNWebView = WebView as unknown as ComponentType<WebViewProps>;

/** A read-only Leaflet map centred on the shop pin (no picker UI; panning is harmless). */
function mapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0;padding:0}</style>
</head><body><div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${lat}, ${lng}], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  L.marker([${lat}, ${lng}]).addTo(map);
  true;
</script></body></html>`;
}

/** Build a cross-platform Maps link: prefer the exact pin, else fall back to the address. */
function directionsUrl(shop: Shop | null): string | null {
  if (!shop) return null;
  if (shop.lat != null && shop.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${shop.lat},${shop.lng}`;
  }
  if (shop.address?.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address.trim())}`;
  }
  return null;
}

export default function Contact() {
  const t = useT();
  const toast = useToast();
  const shopName = useShopName();
  const logoUri = useShopLogo();
  const iconEffect = useShopIconEffect();
  const [shop, setShop] = useState<Shop | null>(null);

  useEffect(() => subscribeShop(shopId, setShop), []);

  const directions = useMemo(() => directionsUrl(shop), [shop]);

  const open = (url: string) => {
    Linking.openURL(url).catch(() => {
      toast({
        type: 'error',
        title: t('contact.couldNotOpen', 'Could not open'),
        message: t('common.tryAgain', 'Please try again.'),
      });
    });
  };

  const tagline = shop?.tagline?.trim();
  const address = shop?.address?.trim();
  const phone1 = shop?.contactPhone1?.trim();
  const phone2 = shop?.contactPhone2?.trim();
  const email = shop?.contactEmail?.trim();
  const hasPin = shop?.lat != null && shop?.lng != null;
  const hasAny = !!(tagline || address || phone1 || phone2 || email || hasPin);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('contact.title', 'Contact us') }} />

      <Card style={styles.header}>
        <OccasionLogo logoUri={logoUri} size={72} effect={iconEffect} borderRadius={12} />
        <ThemedText type="subtitle" style={{ fontWeight: '700', textAlign: 'center' }}>
          {shopName}
        </ThemedText>
        {tagline ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
            {tagline}
          </ThemedText>
        ) : null}
      </Card>

      {!hasAny ? (
        <EmptyState
          title={t('contact.empty', 'No contact details yet')}
          hint={t('contact.emptyHint', 'The shop has not added its contact information yet.')}
        />
      ) : null}

      {address || hasPin ? (
        <>
          <SectionTitle>{t('contact.location', 'Where to find us')}</SectionTitle>
          <Card style={{ gap: Spacing.two }}>
            {address ? <ThemedText type="small">{address}</ThemedText> : null}
            {hasPin ? (
              <View style={styles.mapWrap}>
                <RNWebView
                  originWhitelist={['*']}
                  source={{ html: mapHtml(shop!.lat as number, shop!.lng as number) }}
                  javaScriptEnabled
                  style={{ backgroundColor: 'transparent' }}
                />
              </View>
            ) : null}
            {directions ? (
              <Button title={t('contact.getDirections', 'Get directions')} onPress={() => open(directions)} />
            ) : null}
          </Card>
        </>
      ) : null}

      {phone1 || phone2 || email ? (
        <>
          <SectionTitle>{t('contact.reachUs', 'Reach us')}</SectionTitle>
          {phone1 ? (
            <ContactRow
              label={t('contact.phone', 'Phone')}
              value={phone1}
              onPress={() => open('tel:' + phone1)}
            />
          ) : null}
          {phone2 ? (
            <ContactRow
              label={t('contact.phone', 'Phone')}
              value={phone2}
              onPress={() => open('tel:' + phone2)}
            />
          ) : null}
          {email ? (
            <ContactRow
              label={t('contact.email', 'Email')}
              value={email}
              onPress={() => open('mailto:' + email)}
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function ContactRow({
  label,
  value,
  onPress,
}: Readonly<{ label: string; value: string; onPress: () => void }>) {
  return (
    <Pressable onPress={onPress}>
      <Card style={styles.row}>
        <View style={{ flex: 1 }}>
          <ThemedText type="small" themeColor="textSecondary">
            {label}
          </ThemedText>
          <ThemedText type="smallBold" style={{ color: PRIMARY }}>
            {value}
          </ThemedText>
        </View>
        <ThemedText type="small" style={{ color: PRIMARY }}>
          ›
        </ThemedText>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mapWrap: {
    height: 200,
    borderRadius: Spacing.two,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PRIMARY + '33',
  },
});
