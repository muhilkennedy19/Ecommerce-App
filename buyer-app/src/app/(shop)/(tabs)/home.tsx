import {
  describeExpiry,
  describePrep,
  effectivePrice,
  formatUnitPrice,
  fuzzyFilter,
  shopAcceptsOrders,
  subscribeCategories,
  subscribeProducts,
  subscribeShop,
  type Category,
  type Product,
  type Shop,
} from '@common';
import { Image } from 'expo-image';
import { router, Tabs } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, DANGER, EmptyState, Loader, PRIMARY, Screen, SectionTitle, TextField } from '@/components/kit';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCachedImage } from '@/hooks/use-cached-image';
import { useShopName } from '@/hooks/use-shop-name';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';
const money = (n: number) => `₹${n.toFixed(2)}`;

const openDetail = (id: string) => router.push(('/product/' + id) as never);

export default function Home() {
  const theme = useTheme();
  const t = useT();
  const cart = useCart();
  const shopName = useShopName();
  const [shop, setShop] = useState<Shop | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearch(''); // closing clears the filter so the list isn't silently narrowed
      return !open;
    });
  };

  useEffect(() => subscribeShop(shopId, setShop), []);
  useEffect(() => subscribeCategories(shopId, setCategories), []);
  useEffect(
    () =>
      subscribeProducts(shopId, (p) => {
        setProducts(p);
        setLoaded(true);
      }),
    [],
  );

  const open = shopAcceptsOrders(shop);

  const featured = useMemo(() => products.filter((p) => p.active && p.featured), [products]);

  const byCategory = useMemo(
    () =>
      products.filter(
        (p) => p.active && (selectedCategory === null || p.categoryId === selectedCategory),
      ),
    [products, selectedCategory],
  );

  const visible = useMemo(
    () => fuzzyFilter(byCategory, search, (p) => [p.name, p.description]),
    [byCategory, search],
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Tabs.Screen
          options={{
            title: shopName,
            headerTitleAlign: 'center',
            headerTitleStyle: { fontWeight: '700' },
          }}
        />

        {shop != null && !open ? (
          <Card style={{ backgroundColor: DANGER + '22' }}>
            <ThemedText type="smallBold" style={{ color: DANGER }}>
              {t('home.closed', 'Not accepting orders right now — back soon!')}
            </ThemedText>
          </Card>
        ) : null}

        {!loaded ? (
          <Loader label={t('home.loading', 'Loading products…')} />
        ) : (
          <>
            {featured.length > 0 ? (
              <>
                <SectionTitle>{t('home.featured', 'Featured')}</SectionTitle>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.featuredRow}
                >
                  {featured.map((p) => (
                    <FeaturedCard
                      key={p.id}
                      product={p}
                      canAdd={open}
                      onOpen={() => openDetail(p.id)}
                      onAdd={() => cart.add({ productId: p.id, name: p.name, price: effectivePrice(p), unit: p.unit })}
                    />
                  ))}
                </ScrollView>
              </>
            ) : null}

            <View style={styles.sectionHeader}>
              <SectionTitle>{t('home.categories', 'Categories')}</SectionTitle>
              <Pressable
                onPress={toggleSearch}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('home.search', 'Search products')}
                style={[styles.searchIcon, { backgroundColor: searchOpen ? PRIMARY : theme.backgroundElement }]}
              >
                <ThemedText style={{ fontSize: 15 }}>{searchOpen ? '\u2715' : '\u2315'}</ThemedText>
              </Pressable>
            </View>

            {searchOpen ? (
              <TextField
                placeholder={t('home.search', 'Search products')}
                value={search}
                onChangeText={setSearch}
                clearButtonMode="while-editing"
                returnKeyType="search"
                autoFocus
              />
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pills}
            >
              <Pill label={t('home.all', 'All')} active={selectedCategory === null} onPress={() => setSelectedCategory(null)} />
              {categories.map((c) => (
                <Pill
                  key={c.id}
                  label={c.name}
                  active={selectedCategory === c.id}
                  onPress={() => setSelectedCategory(c.id)}
                />
              ))}
            </ScrollView>

            <SectionTitle>{t('home.products', 'Products')}</SectionTitle>
            {visible.length === 0 ? (
              <EmptyState
                title={t('home.noProducts', 'No products')}
                hint={
                  search.trim()
                    ? t('home.noMatch', 'No products match "{q}"', { q: search.trim() })
                    : t('home.noneInCategory', 'Nothing available in this category yet.')
                }
              />
            ) : (
              visible.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  canAdd={open}
                  onOpen={() => openDetail(p.id)}
                  onAdd={() => cart.add({ productId: p.id, name: p.name, price: effectivePrice(p), unit: p.unit })}
                />
              ))
            )}
          </>
        )}
      </Screen>

      {cart.count > 0 ? (
        <View style={[styles.cartBar, { backgroundColor: theme.backgroundElement, borderTopColor: theme.backgroundSelected }]}>
          <View style={{ flex: 1 }}>
            <ThemedText type="small" themeColor="textSecondary">
              {cart.count === 1
                ? t('home.itemOne', '1 item')
                : t('home.itemMany', '{count} items', { count: cart.count })}
            </ThemedText>
            <ThemedText type="smallBold">{money(cart.total)}</ThemedText>
          </View>
          <Button title={t('common.checkout', 'Checkout')} onPress={() => router.push('/checkout' as never)} />
        </View>
      ) : null}
    </View>
  );
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        { backgroundColor: active ? PRIMARY : theme.backgroundElement },
      ]}
    >
      <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ProductCard({
  product,
  canAdd,
  onAdd,
  onOpen,
}: {
  product: Product;
  canAdd: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const uri = useCachedImage(product.imageId);
  const effective = effectivePrice(product);
  const hasDiscount = effective < product.price;
  const outOfStock = product.trackStock && (product.stock ?? 0) <= 0;

  const hints: string[] = [];
  if (product.expiresAt) hints.push(describeExpiry(product.expiresAt.toDate()).text);
  if (product.onDemand && product.prepTime) hints.push(describePrep(product.prepTime));
  if (outOfStock) hints.push(t('common.outOfStock', 'Out of stock'));

  return (
    <Card style={styles.productCard}>
      <Pressable onPress={onOpen}>
        <Image
          source={uri ? { uri } : undefined}
          style={[styles.productImage, { backgroundColor: theme.backgroundSelected }]}
          contentFit="cover"
        />
      </Pressable>
      <View style={{ flex: 1, gap: Spacing.one }}>
        <Pressable onPress={onOpen} style={{ gap: Spacing.one }}>
          <ThemedText type="smallBold">{product.name}</ThemedText>
          <View style={styles.priceRow}>
            <ThemedText type="small" style={{ color: PRIMARY, fontWeight: '700' }}>
              {formatUnitPrice(effective, product.unit)}
            </ThemedText>
            {hasDiscount ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.struck}>
                {money(product.price)}
              </ThemedText>
            ) : null}
          </View>
          {hints.map((h) => (
            <ThemedText key={h} type="small" themeColor="textSecondary">
              {h}
            </ThemedText>
          ))}
        </Pressable>
        <View style={{ alignSelf: 'flex-start', marginTop: Spacing.one }}>
          {outOfStock ? (
            <Badge label={t('common.unavailable', 'Unavailable')} color={DANGER} />
          ) : (
            <Button title={t('common.addToCart', 'Add to cart')} onPress={onAdd} disabled={!canAdd} size="sm" />
          )}
        </View>
      </View>
    </Card>
  );
}

/** Compact vertical card for the horizontal "Featured" row. */
function FeaturedCard({
  product,
  canAdd,
  onAdd,
  onOpen,
}: {
  product: Product;
  canAdd: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const uri = useCachedImage(product.imageId);
  const effective = effectivePrice(product);
  const hasDiscount = effective < product.price;
  const outOfStock = product.trackStock && (product.stock ?? 0) <= 0;

  return (
    <Card style={styles.featuredCard}>
      <Pressable onPress={onOpen} style={{ gap: Spacing.one }}>
        <Image
          source={uri ? { uri } : undefined}
          style={[styles.featuredImage, { backgroundColor: theme.backgroundSelected }]}
          contentFit="cover"
        />
        <ThemedText type="smallBold" numberOfLines={1}>
          {product.name}
        </ThemedText>
        <View style={styles.featuredPriceRow}>
          <ThemedText
            type="small"
            style={{ color: PRIMARY, fontWeight: '700', flexShrink: 1 }}
            numberOfLines={1}
          >
            {formatUnitPrice(effective, product.unit)}
          </ThemedText>
          {hasDiscount ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={[styles.struck, { flexShrink: 1 }]}
              numberOfLines={1}
            >
              {money(product.price)}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      <View style={{ alignSelf: 'flex-start', marginTop: Spacing.one }}>
        {outOfStock ? (
          <Badge label={t('common.unavailable', 'Unavailable')} color={DANGER} />
        ) : (
          <Button title={t('home.add', 'Add')} onPress={onAdd} disabled={!canAdd} size="sm" />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pills: { gap: Spacing.two, paddingVertical: Spacing.one },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  featuredRow: { gap: Spacing.three, paddingVertical: Spacing.one },
  featuredCard: { width: 160, gap: Spacing.one },
  featuredImage: { width: '100%', height: 136, borderRadius: Spacing.two },
  productCard: { flexDirection: 'row', gap: Spacing.three },
  productImage: { width: 88, height: 88, borderRadius: Spacing.two },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // Featured cards are only 160px wide, so the price + struck original must wrap
  // instead of running past the card edge.
  featuredPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexWrap: 'wrap',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  searchIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  struck: { textDecorationLine: 'line-through' },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    borderTopWidth: 1,
  },
});
