import * as Location from 'expo-location';
import { useRef, useState, type ComponentType, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { Button, PRIMARY } from '@/components/kit';
import { useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';

// react-native-webview ships class-component types that resolve to `never` props under
// React 19's JSX typing. Cast to a functional-component type so props/ref type-check.
const RNWebView = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Fallback map centre when the buyer has no pin yet (India centroid, country-wide zoom). */
const FALLBACK: LatLng = { lat: 20.5937, lng: 78.9629 };

/**
 * Self-contained OpenStreetMap pin picker. Renders Leaflet inside a WebView (no API key,
 * no billing) with OSM tiles. The buyer taps the map to drop a pin, drags it to fine-tune,
 * or taps "Use my location" (GPS via expo-location) to centre + drop the pin on their exact
 * position. Coordinates post back over the WebView bridge. Needs internet (Leaflet CDN + OSM
 * tiles) — fine at order time.
 */
function buildHtml(initial: LatLng | null): string {
  const center = initial ?? FALLBACK;
  const zoom = initial ? 16 : 4;
  const initialMarker = initial ? 'true' : 'false';
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0;padding:0}</style>
</head><body><div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: true }).setView([${center.lat}, ${center.lng}], ${zoom});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  var marker = null;
  function post(ll){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ lat: ll.lat, lng: ll.lng })); }
  function setMarker(ll){
    if (!marker) {
      marker = L.marker(ll, { draggable: true }).addTo(map);
      marker.on('dragend', function(){ post(marker.getLatLng()); });
    } else { marker.setLatLng(ll); }
  }
  if (${initialMarker}) setMarker(L.latLng(${center.lat}, ${center.lng}));
  map.on('click', function(e){ setMarker(e.latlng); post(e.latlng); });
  window.setPin = function(lat, lng){ var ll = L.latLng(lat, lng); setMarker(ll); map.setView(ll, 16); post(ll); };
  true;
</script></body></html>`;
}

export function LocationPicker({
  value,
  onChange,
  height = 260,
}: Readonly<{ value: LatLng | null; onChange: (c: LatLng) => void; height?: number }>) {
  const t = useT();
  const toast = useToast();
  const webRef = useRef<WebView>(null);
  const [locating, setLocating] = useState(false);
  // Capture the initial value ONCE so the WebView HTML (and its map state) never reloads
  // mid-edit. Live edits flow through injectJavaScript / the message bridge instead.
  const [html] = useState(() => buildHtml(value));

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const d = JSON.parse(e.nativeEvent.data) as Partial<LatLng>;
      if (typeof d.lat === 'number' && typeof d.lng === 'number') {
        onChange({ lat: d.lat, lng: d.lng });
      }
    } catch {
      // ignore malformed bridge messages
    }
  };

  const locateMe = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast({
          type: 'error',
          title: t('loc.permTitle', 'Location off'),
          message: t('loc.permHint', 'Allow location access, or drop the pin on the map manually.'),
        });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      onChange(c);
      webRef.current?.injectJavaScript(`window.setPin(${c.lat}, ${c.lng}); true;`);
    } catch {
      toast({
        type: 'error',
        title: t('loc.failTitle', "Couldn't get location"),
        message: t('loc.failHint', 'Drop the pin on the map instead.'),
      });
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={[styles.mapWrap, { height }]}>
        <RNWebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html }}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
          nestedScrollEnabled
          style={{ backgroundColor: 'transparent' }}
        />
      </View>
      <Button
        title={locating ? t('loc.locating', 'Locating…') : t('loc.useMine', 'Use my current location')}
        variant="secondary"
        loading={locating}
        onPress={() => void locateMe()}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {value
          ? t('loc.pinned', 'Pinned: {lat}, {lng}', { lat: value.lat.toFixed(5), lng: value.lng.toFixed(5) })
          : t('loc.tapHint', 'Tap the map to drop a delivery pin, or use your current location.')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    borderRadius: Spacing.two,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PRIMARY + '33',
  },
});
