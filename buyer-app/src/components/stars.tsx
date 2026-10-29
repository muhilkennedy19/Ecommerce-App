import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

const STAR_FULL = '★';
const STAR_EMPTY = '☆';
const GOLD = '#F5A623';

/** A 1–5 star row. Pass `onSelect` to make it an interactive picker; omit it for display. */
export function Stars({
  value,
  size = 18,
  onSelect,
}: {
  value: number;
  size?: number;
  onSelect?: (n: number) => void;
}) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <ThemedText style={{ fontSize: size, color: GOLD }}>{n <= value ? STAR_FULL : STAR_EMPTY}</ThemedText>;
        return onSelect ? (
          <Pressable key={n} onPress={() => onSelect(n)} hitSlop={6} style={{ paddingHorizontal: 2 }}>
            {star}
          </Pressable>
        ) : (
          <View key={n} style={{ paddingHorizontal: 1 }}>
            {star}
          </View>
        );
      })}
    </View>
  );
}
