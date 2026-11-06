import { useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';

import { PRIMARY } from '@/components/kit';
import { Spacing } from '@/constants/theme';

// react-native-webview's class-component types resolve to `never` under React 19 JSX typing;
// the same cast the location pickers use restores a usable functional-component type.
const RNWebView = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

export type LatLng = { lat: number; lng: number };

/**
 * Self-contained OpenStreetMap delivery view (Leaflet in a WebView, OSM tiles — no key, no
 * billing), mirroring the location-picker scaffold but read-only. Renders the courier pin, the
 * destination pin, and a dashed quadratic-bézier arc between them (a "flight path" look). The
 * courier pin is moved live via the `window.setCourier` bridge + `injectJavaScript`, so the map
 * is never torn down between updates. Capture-once HTML; the first fix is baked in.
 */
function buildHtml(courier: LatLng | null, dest: LatLng | null): string {
  const toArr = (p: LatLng | null) => (p ? `[${p.lat}, ${p.lng}]` : 'null');
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0;padding:0;background:transparent}</style>
</head><body><div id="map"></div><script>
  var map = L.map('map', { zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  var courierIcon = L.divIcon({ html: '<div style="font-size:30px;line-height:30px">🛵</div>', className: '', iconSize: [32,32], iconAnchor: [16,16] });
  var destIcon = L.divIcon({ html: '<div style="font-size:28px;line-height:28px">🏠</div>', className: '', iconSize: [28,28], iconAnchor: [14,26] });
  var dest = ${toArr(dest)};
  var courier = ${toArr(courier)};
  var destMarker = null, courierMarker = null, curve = null;
  if (dest) { destMarker = L.marker(dest, { icon: destIcon }).addTo(map); }
  function curvePoints(a, b) {
    var n = 32, pts = [];
    var mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2;
    var dx = b[0]-a[0], dy = b[1]-a[1];
    // Control point offset perpendicular to A→B by ~18% of the span → a gentle arc.
    var cx = mx - dy*0.18, cy = my + dx*0.18;
    for (var i=0;i<=n;i++){ var t=i/n, u=1-t;
      pts.push([u*u*a[0]+2*u*t*cx+t*t*b[0], u*u*a[1]+2*u*t*cy+t*t*b[1]]); }
    return pts;
  }
  function fit() {
    var pts = []; if (courier) pts.push(courier); if (dest) pts.push(dest);
    if (pts.length >= 2) { map.fitBounds(pts, { padding: [44,44], maxZoom: 16 }); }
    else if (pts.length === 1) { map.setView(pts[0], 15); }
    else { map.setView([20.5937, 78.9629], 4); }
  }
  function redraw() {
    if (courier) {
      if (!courierMarker) courierMarker = L.marker(courier, { icon: courierIcon }).addTo(map);
      else courierMarker.setLatLng(courier);
    }
    if (courier && dest) {
      var pts = curvePoints(courier, dest);
      if (curve) curve.setLatLngs(pts);
      else curve = L.polyline(pts, { color: '${PRIMARY}', weight: 3, opacity: 0.85, dashArray: '6,10' }).addTo(map);
    }
    fit();
  }
  window.setCourier = function(lat, lng) { courier = [lat, lng]; redraw(); };
  redraw();
</script></body></html>`;
}

export function DeliveryMap({
  courier,
  dest,
  height = 300,
}: Readonly<{ courier: LatLng | null; dest: LatLng | null; height?: number }>) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<LatLng | null>(null);
  // Capture the initial coords ONCE; every later fix flows through injectJavaScript so the
  // map (and its tiles/zoom) never reloads mid-watch.
  const [html] = useState(() => buildHtml(courier, dest));

  const cLat = courier?.lat ?? null;
  const cLng = courier?.lng ?? null;
  useEffect(() => {
    if (cLat == null || cLng == null) return;
    const js = `window.setCourier && window.setCourier(${cLat}, ${cLng}); true;`;
    if (readyRef.current) webRef.current?.injectJavaScript(js);
    else pendingRef.current = { lat: cLat, lng: cLng }; // inject-before-load no-ops; replay on load
  }, [cLat, cLng]);

  return (
    <View style={[styles.mapWrap, { height }]}>
      <RNWebView
        ref={webRef}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        source={{ html }}
        style={{ backgroundColor: 'transparent' }}
        onLoadEnd={() => {
          readyRef.current = true;
          const p = pendingRef.current;
          if (p) {
            webRef.current?.injectJavaScript(`window.setCourier(${p.lat}, ${p.lng}); true;`);
            pendingRef.current = null;
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PRIMARY + '33',
  },
});
