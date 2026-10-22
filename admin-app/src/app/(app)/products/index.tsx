import {
  addCategory,
  deleteCategory,
  describeExpiry,
  describePrep,
  fuzzyFilter,
  userHasPermission,
  subscribeCategories,
  subscribeProducts,
  type Category,
  type Product,
} from '@common';
import { Stack, router } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  DANGER,
  EmptyState,
  Screen,
  SectionTitle,
  TextField,
} from '@/components/kit';
import { useConfirm, useToast } from '@/components/feedback';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCachedImage } from '@/hooks/use-cached-image';
import { useTheme } from '@/hooks/use-theme';
import { shopId } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

function money(n: number): string {
  return `₹${n}`;
}

export default function ProductsScreen() {
  const { appUser } = useAuth();
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();

  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const [search, setSearch] = useState('');

  const canRead = userHasPermission(appUser, 'products.read');
  const canWriteProducts = userHasPermission(appUser, 'products.write');
  const canWriteCategories = userHasPermission(appUser, 'categories.write');

  useEffect(() => {
    if (!canRead) return;
    const unsubCats = subscribeCategories(shopId, setCats);
    const unsubProducts = subscribeProducts(shopId, setProducts);
    return () => {
      unsubCats();
      unsubProducts();
    };
  }, [canRead]);

  const byCategory = useMemo(
    () => (selectedCat ? products.filter((p) => p.categoryId === selectedCat) : products),
    [products, selectedCat],
  );

  const filtered = useMemo(
    () => fuzzyFilter(byCategory, search, (p) => [p.name, p.description]),
    [byCategory, search],
  );

  if (!canRead) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('products.title', 'Products') }} />
        <EmptyState title={t('common.noAccess', 'No access')} hint={t('products.noViewHint', "Your role can't view products.")} />
      </Screen>
    );
  }

  const onAddCategory = () => {
    const name = newCat.trim();
    if (!name) return;
    setNewCat('');
    void (async () => {
      try {
        await addCategory(shopId, name, cats.length);
      } catch (e) {
        toast({ type: 'error', title: t('products.couldNotAddCategory', 'Could not add category'), message: e instanceof Error ? e.message : String(e) });
      }
    })();
  };

  const onDeleteCategory = async (cat: Category) => {
    const ok = await confirm({
      title: t('products.deleteCategory', 'Delete category'),
      message: t('products.deleteCategoryConfirm', 'Delete "{name}"?', { name: cat.name }),
      confirmText: t('common.delete', 'Delete'),
      cancelText: t('common.cancel', 'Cancel'),
      destructive: true,
    });
    if (!ok) return;
    if (selectedCat === cat.id) setSelectedCat(null);
    try {
      await deleteCategory(cat.id);
    } catch (e) {
      toast({ type: 'error', title: t('products.couldNotDeleteCategory', 'Could not delete category'), message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('products.title', 'Products') }} />

      {canWriteProducts ? (
        <Button title={t('products.add', '+ Add product')} onPress={() => router.push('/products/edit' as never)} />
      ) : null}

      <SectionTitle>{t('products.categories', 'Categories')}</SectionTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        <Pill label={t('products.all', 'All')} selected={selectedCat === null} onPress={() => setSelectedCat(null)} />
        {cats.map((c) => (
          <Pill
            key={c.id}
            label={c.name}
            selected={selectedCat === c.id}
            onPress={() => setSelectedCat(c.id)}
            onLongPress={canWriteCategories ? () => onDeleteCategory(c) : undefined}
          />
        ))}
      </ScrollView>

      {canWriteCategories ? (
        <Card>
          <TextField
            label={t('products.addCategory', 'Add category')}
            placeholder={t('products.categoryName', 'Category name')}
            value={newCat}
            onChangeText={setNewCat}
            onSubmitEditing={onAddCategory}
            returnKeyType="done"
          />
          <Button title={t('products.addCategory', 'Add category')} variant="secondary" onPress={onAddCategory} />
          {cats.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('products.longPressDelete', 'Long-press a category pill to delete it.')}
            </ThemedText>
          ) : null}
        </Card>
      ) : null}

      <SectionTitle>{t('products.title', 'Products')}</SectionTitle>
      <TextField
        placeholder={t('products.search', 'Search products')}
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {filtered.length === 0 ? (
        <EmptyState
          title={t('products.noneTitle', 'No products')}
          hint={
            search.trim()
              ? t('products.noMatch', 'No products match "{query}"', { query: search.trim() })
              : canWriteProducts
                ? t('products.addHint', 'Tap "+ Add product" to create one.')
                : undefined
          }
        />
      ) : (
        filtered.map((p) => <ProductRow key={p.id} product={p} />)
      )}
    </Screen>
  );
}

function ProductRow({ product: p }: Readonly<{ product: Product }>) {
  const theme = useTheme();
  const t = useT();
  const uri = useCachedImage(p.imageId);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/products/edit', params: { id: p.id } } as never)}
    >
      <Card style={{ flexDirection: 'row', gap: Spacing.three }}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.thumb}
            contentFit="cover"
            transition={100}
          />
        ) : (
          <View style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={{ flex: 1, gap: Spacing.one }}>
          <ThemedText type="smallBold">{p.name}</ThemedText>
          <View style={styles.priceRow}>
            {p.discountPrice != null ? (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.struck}>
                  {money(p.price)}
                </ThemedText>
                <ThemedText type="smallBold">{money(p.discountPrice)}</ThemedText>
              </>
            ) : (
              <ThemedText type="smallBold">{money(p.price)}</ThemedText>
            )}
          </View>
          <View style={styles.badgeRow}>
            {!p.active ? <Badge label={t('products.inactive', 'Inactive')} color={DANGER} /> : null}
            {p.perishable ? <Badge label={t('products.perishable', 'Perishable')} /> : null}
            {p.onDemand ? (
              <Badge label={p.prepTime ? describePrep(p.prepTime) : t('products.onDemand', 'On demand')} />
            ) : null}
            {p.trackStock ? (
              p.stock && p.stock > 0 ? (
                <Badge label={t('products.stock', 'Stock: {count}', { count: p.stock })} />
              ) : (
                <Badge label={t('products.outOfStock', 'Out of stock')} color={DANGER} />
              )
            ) : null}
            {p.expiresAt ? <ExpiryBadge date={p.expiresAt.toDate()} /> : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function ExpiryBadge({ date }: { date: Date }) {
  const { expired, text } = describeExpiry(date);
  return <Badge label={text} color={expired ? DANGER : undefined} />;
}

function Pill({
  label,
  selected,
  onPress,
  onLongPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.pill,
        {
          backgroundColor: selected ? theme.text : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText type="small" style={{ color: selected ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pillRow: { gap: Spacing.two, paddingVertical: Spacing.one },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  thumb: { width: 56, height: 56, borderRadius: Spacing.two },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  struck: { textDecorationLine: 'line-through' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
});
