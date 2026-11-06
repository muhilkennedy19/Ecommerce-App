import type { OrderStatus } from '@common';
import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/lib/i18n';

const SCENE_HEIGHT = 116;
/** Items that ride the packing roller and fill the delivery bag. */
const PARCELS = ['📦', '🍎', '🥫', '🧴', '🍞', '🧃'] as const;
/** Roadside scenery that streams past the rider to sell "highway speed". */
const SCENERY = ['🌳', '🏢', '🌵', '🏠', '🌲', '⛽'] as const;

/**
 * A single emoji that rides across the lane on a continuous, evenly-spaced loop.
 *
 * The travellers all share one duration; an initial `delay` offsets each one by a fraction of
 * a cycle so they stay spread out. The 0→1 loop resets instantly, but because both ends of the
 * interpolation sit off-screen (±64 px past the lane) the reset is never visible. Everything is
 * transform/opacity only, so `useNativeDriver` keeps it off the JS thread.
 */
function Traveller({
  laneWidth,
  delay,
  duration,
  direction,
  style,
  children,
}: Readonly<{
  laneWidth: number;
  delay: number;
  duration: number;
  /** 'rtl' streams right→left (scenery/road, i.e. the rider moving forward); 'ltr' left→right. */
  direction: 'ltr' | 'rtl';
  style?: ViewStyle;
  children: React.ReactNode;
}>) {
  const [v] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (laneWidth <= 0) return;
    const run = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    ]);
    run.start();
    return () => run.stop();
  }, [v, laneWidth, delay, duration]);

  const off = 64;
  const translateX = v.interpolate({
    inputRange: [0, 1],
    outputRange: direction === 'ltr' ? [-off, laneWidth + off] : [laneWidth + off, -off],
  });

  return (
    <Animated.View style={[styles.traveller, style, { transform: [{ translateX }] }]}>
      {children}
    </Animated.View>
  );
}

/** A looping transform (bob/pulse) expressed as a 0→1→0 triangle wave. */
function usePingPong(duration: number) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration]);
  return v;
}

/** The worker inspecting parcels off a roller and dropping them into a basket. */
function PackingScene({ laneWidth }: Readonly<{ laneWidth: number }>) {
  const theme = useTheme();
  const bob = usePingPong(520);
  const lensScale = bob.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const workerBob = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });

  return (
    <>
      {/* Roller bed */}
      <View style={[styles.roller, { backgroundColor: theme.backgroundSelected }]}>
        {Array.from({ length: 9 }).map((_, i) => (
          <View key={i} style={[styles.rollerWheel, { borderColor: theme.textSecondary }]} />
        ))}
      </View>

      {/* Parcels riding the roller toward the inspector + basket */}
      {laneWidth > 0 &&
        PARCELS.map((p, i) => (
          <Traveller
            key={p}
            laneWidth={laneWidth}
            duration={4200}
            delay={(i * 4200) / PARCELS.length}
            direction="ltr"
            style={{ bottom: 34 }}
          >
            <ThemedText style={styles.parcel}>{p}</ThemedText>
          </Traveller>
        ))}

      {/* Inspector with a pulsing magnifier, planted over the roller */}
      <Animated.View style={[styles.inspector, { transform: [{ translateY: workerBob }] }]}>
        <ThemedText style={styles.worker}>👷</ThemedText>
        <Animated.Text style={[styles.lens, { transform: [{ scale: lensScale }] }]}>🔍</Animated.Text>
      </Animated.View>

      {/* Basket the inspected parcels drop into */}
      <ThemedText style={styles.basket}>🧺</ThemedText>
    </>
  );
}

/** The rider speeding down a highway with the order bag; scenery streams past for speed. */
function DeliveryScene({ laneWidth }: Readonly<{ laneWidth: number }>) {
  const theme = useTheme();
  const shake = usePingPong(130);
  const riderBob = shake.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const puff = shake.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });

  return (
    <>
      {/* Background scenery, fastest stream = furthest sense of speed */}
      {laneWidth > 0 &&
        SCENERY.map((s, i) => (
          <Traveller
            key={s}
            laneWidth={laneWidth}
            duration={2600}
            delay={(i * 2600) / SCENERY.length}
            direction="rtl"
            style={{ bottom: 44, opacity: 0.5 }}
          >
            <ThemedText style={styles.scenery}>{s}</ThemedText>
          </Traveller>
        ))}

      {/* Road with dashed lane markings streaming backwards under the rider */}
      <View style={[styles.road, { backgroundColor: theme.backgroundSelected }]} />
      {laneWidth > 0 &&
        Array.from({ length: 6 }).map((_, i) => (
          <Traveller
            key={`dash-${i}`}
            laneWidth={laneWidth}
            duration={900}
            delay={(i * 900) / 6}
            direction="rtl"
            style={{ bottom: 13 }}
          >
            <View style={[styles.dash, { backgroundColor: theme.textSecondary }]} />
          </Traveller>
        ))}

      {/* The rider, bobbing over the bumps, bag in tow, exhaust puffing behind */}
      <Animated.View style={[styles.rider, { transform: [{ translateY: riderBob }] }]}>
        <Animated.Text style={[styles.puff, { opacity: puff }]}>💨</Animated.Text>
        <ThemedText style={styles.vehicle}>🛵</ThemedText>
        <ThemedText style={styles.bag}>🛍️</ThemedText>
      </Animated.View>
    </>
  );
}

/**
 * A playful, status-aware scene shown under the order's status trail in the buyer app.
 * Renders only while an order is being prepared (`accepted`) or on the road
 * (`out_for_delivery`); every other status returns nothing, leaving the trail to speak.
 */
export function OrderStatusAnimation({ status }: Readonly<{ status: OrderStatus }>) {
  const theme = useTheme();
  const t = useT();
  const [laneWidth, setLaneWidth] = useState(0);

  if (status !== 'accepted' && status !== 'packed' && status !== 'out_for_delivery') return null;

  let caption: string;
  if (status === 'accepted') caption = t('orders.anim.packing', 'Inspecting and packing with care');
  else if (status === 'packed') caption = t('orders.anim.packed', 'Packed — waiting for the delivery partner');
  else caption = t('orders.anim.delivery', 'Speeding down the highway to you');

  const onLayout = (e: LayoutChangeEvent) => setLaneWidth(e.nativeEvent.layout.width);

  return (
    <View style={{ gap: Spacing.two }}>
      <View
        onLayout={onLayout}
        style={[styles.scene, { backgroundColor: theme.backgroundSelected + '55' }]}
      >
        {status === 'out_for_delivery' ? (
          <DeliveryScene laneWidth={laneWidth} />
        ) : (
          <PackingScene laneWidth={laneWidth} />
        )}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
        {caption}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    height: SCENE_HEIGHT,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  traveller: { position: 'absolute', left: 0 },

  // Packing
  roller: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 16,
    height: 14,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
  },
  rollerWheel: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  parcel: { fontSize: 26 },
  inspector: { position: 'absolute', right: 52, bottom: 24, alignItems: 'center' },
  worker: { fontSize: 38 },
  lens: { position: 'absolute', right: -6, top: 8, fontSize: 20 },
  basket: { position: 'absolute', right: 8, bottom: 18, fontSize: 36 },

  // Delivery
  scenery: { fontSize: 30 },
  road: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 26 },
  dash: { width: 22, height: 4, borderRadius: 2, opacity: 0.8 },
  rider: { position: 'absolute', left: '34%', bottom: 20, flexDirection: 'row', alignItems: 'flex-end' },
  vehicle: { fontSize: 44 },
  bag: { fontSize: 22, marginLeft: -10, marginBottom: 4 },
  puff: { fontSize: 24, marginRight: -6, marginBottom: 2 },
});
