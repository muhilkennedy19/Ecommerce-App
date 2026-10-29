import type { OccasionEffect } from '@common';
import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

/** Same bundled fallback the launch splash uses, so the effect always has a logo to sit on. */
const FALLBACK_LOGO = require('../../assets/images/splash-icon.png');

/**
 * The buyer shop logo with an optional festive overlay drawn on top (fireworks for Diwali,
 * the Indian flag for Republic/Independence Day, a Santa cap for Christmas/New Year). The
 * overlay is built from emoji + plain Views so it needs no extra native dependency and scales
 * with `size`. The container lets the overlay spill past the logo edges (overflow visible),
 * so e.g. the Santa cap perches on the top-left corner.
 */
export function OccasionLogo({
  logoUri,
  size,
  effect = 'none',
  borderRadius = 0,
}: Readonly<{
  logoUri?: string | null;
  size: number;
  effect?: OccasionEffect | null;
  borderRadius?: number;
}>) {
  return (
    <View style={{ width: size, height: size }}>
      <Image
        source={logoUri ? { uri: logoUri } : FALLBACK_LOGO}
        style={{ width: size, height: size, borderRadius }}
        contentFit="contain"
      />
      <OccasionOverlay effect={effect ?? 'none'} size={size} />
    </View>
  );
}

/** Just the overlay, absolutely positioned over a `size`×`size` box. */
export function OccasionOverlay({ effect, size }: Readonly<{ effect: OccasionEffect; size: number }>) {
  if (effect === 'none') return null;

  if (effect === 'santa') return <SantaCap size={size} />;

  // fireworks + flag are single emoji "badges" perched on the top-right corner, with a
  // second sparkle accent for fireworks. emojiShadow keeps them legible over a pale logo.
  const badge = effect === 'fireworks' ? '🎆' : '🇮🇳';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Text
        style={[
          styles.emoji,
          emojiShadow,
          { fontSize: size * 0.46, top: -size * 0.1, right: -size * 0.08 },
        ]}
      >
        {badge}
      </Text>
      {effect === 'fireworks' ? (
        <Text
          style={[
            styles.emoji,
            emojiShadow,
            { fontSize: size * 0.3, bottom: -size * 0.06, left: -size * 0.06, top: undefined, right: undefined },
          ]}
        >
          ✨
        </Text>
      ) : null}
    </View>
  );
}

/** A Santa cap drawn with Views (white brim + red cone + white pom), tilted onto the top-left. */
function SantaCap({ size }: Readonly<{ size: number }>) {
  const capW = size * 0.6;
  const brimH = Math.max(3, size * 0.14);
  const coneH = size * 0.3;
  const coneBase = capW * 0.82;
  const pom = Math.max(4, size * 0.17);

  const group: ViewStyle = {
    position: 'absolute',
    top: -size * 0.2,
    left: -size * 0.08,
    width: capW,
    height: brimH + coneH,
    transform: [{ rotate: '-16deg' }],
  };

  return (
    <View pointerEvents="none" style={group}>
      {/* pom at the cone tip */}
      <View
        style={{
          position: 'absolute',
          top: -pom * 0.35,
          left: capW / 2 - pom / 2,
          width: pom,
          height: pom,
          borderRadius: pom / 2,
          backgroundColor: '#FFFFFF',
          ...softShadow,
        }}
      />
      {/* red cone (upward CSS triangle) sitting on the brim */}
      <View
        style={{
          position: 'absolute',
          bottom: brimH * 0.6,
          left: capW / 2 - coneBase / 2,
          width: 0,
          height: 0,
          borderLeftWidth: coneBase / 2,
          borderRightWidth: coneBase / 2,
          borderBottomWidth: coneH,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: '#D32F2F',
        }}
      />
      {/* white fluffy brim */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: capW,
          height: brimH,
          borderRadius: brimH / 2,
          backgroundColor: '#FFFFFF',
          ...softShadow,
        }}
      />
    </View>
  );
}

const softShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.25,
  shadowRadius: 1.5,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
} as const;

const emojiShadow = {
  textShadowColor: 'rgba(0,0,0,0.3)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 2,
} as const;

const styles = StyleSheet.create({
  emoji: { position: 'absolute' },
});
