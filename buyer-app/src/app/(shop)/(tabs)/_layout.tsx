import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRIMARY } from '@/components/kit';
import { useI18n } from '@/lib/i18n';

/** Renders a tab's emoji icon, dimmed when the tab is not focused. */
function tabEmoji(emoji: string) {
  return function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.4 }}>{emoji}</Text>;
  };
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: PRIMARY,
        // Sit above the Android system navigation bar via the bottom safe-area inset.
        tabBarStyle: {
          borderTopWidth: 0,
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: t('tabs.shop', 'Shop'), tabBarLabel: t('tabs.shop', 'Shop'), tabBarIcon: tabEmoji('🏠') }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: t('tabs.orders', 'Orders'), tabBarLabel: t('tabs.orders', 'Orders'), tabBarIcon: tabEmoji('🧾') }}
      />
      <Tabs.Screen
        name="contact"
        options={{ title: t('tabs.contact', 'Contact'), tabBarLabel: t('tabs.contact', 'Contact'), tabBarIcon: tabEmoji('☎️') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('tabs.profile', 'Profile'), tabBarLabel: t('tabs.profile', 'Profile'), tabBarIcon: tabEmoji('👤') }}
      />
    </Tabs>
  );
}
