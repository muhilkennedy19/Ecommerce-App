import {
  addCategory,
  deleteCategory,
  describeExpiry,
  describePrep,
  effectivePrice,
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
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Badge,
  Button,
  Card,
  DANGER,
  EmptyState,
  PRIMARY,
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
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();

  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'priceAsc' | 'priceDesc'>('name');
  const [inStockOnly, setInStockOnly] = useState(false);

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

  // In-stock filter + chosen sort, applied client-side over the in-memory catalog.
  const shown = useMemo(() => {
    const list = inStockOnly
      ? filtered.filter((p) => !p.trackStock || (p.stock ?? 0) > 0)
      : filtered;
    const sorted = [...list];
    if (sortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'priceAsc') sorted.sort((a, b) => effectivePrice(a) - effectivePrice(b));
    else sorted.sort((a, b) => effectivePrice(b) - effectivePrice(a));
    return sorted;
  }, [filtered, inStockOnly, sortBy]);

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
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['left', 'right']}>
      <Stack.Screen options={{ title: t('products.title', 'Products') }} />
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <ProductRow product={item} />}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        windowSize={11}
        ListHeaderComponent={
          <View style={{ gap: Spacing.three }}>
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
            <View style={styles.searchRow}>
              <View style={{ flex: 1 }}>
                <TextField
                  placeholder={t('products.search', 'Search products')}
                  value={search}
                  onChangeText={setSearch}
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                />
              </View>
              <Pressable
                onPress={() => setFilterOpen((o) => !o)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('products.filter', 'Sort & filter')}
                style={[styles.searchIcon, { backgroundColor: filterOpen ? PRIMARY : theme.backgroundElement }]}
              >
                <ThemedText style={{ fontSize: 16, color: filterOpen ? '#ffffff' : theme.text }}>{'⇅'}</ThemedText>
              </Pressable>
            </View>

            {filterOpen ? (
              <Card style={{ gap: Spacing.two }}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('products.sortBy', 'Sort by')}
                </ThemedText>
                <View style={styles.pillWrap}>
                  <Pill label={t('products.sortName', 'Name')} selected={sortBy === 'name'} onPress={() => setSortBy('name')} />
                  <Pill label={t('products.sortPriceAsc', 'Price ↑')} selected={sortBy === 'priceAsc'} onPress={() => setSortBy('priceAsc')} />
                  <Pill label={t('products.sortPriceDesc', 'Price ↓')} selected={sortBy === 'priceDesc'} onPress={() => setSortBy('priceDesc')} />
                </View>
                <View style={styles.pillWrap}>
                  <Pill
                    label={t('products.inStock', 'In stock only')}
                    selected={inStockOnly}
                    onPress={() => setInStockOnly((v) => !v)}
                  />
                </View>
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
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
        }
      />
    </SafeAreaView>
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
  listContent: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  searchIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
