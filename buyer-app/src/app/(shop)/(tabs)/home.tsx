import {
  describeExpiry,
  describePrep,
  effectivePrice,
  formatUnitPrice,
  fuzzyFilter,
  shopAcceptsOrders,
  subscribeAnnouncements,
  subscribeCategories,
  subscribeProducts,
  subscribeShop,
  subscribeShopReviews,
  type Announcement,
  type Category,
  type Product,
  type Review,
  type Shop,
} from '@common';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { router, Tabs } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, DANGER, EmptyState, Loader, PRIMARY, SectionTitle, TextField } from '@/components/kit';
import { OccasionLogo } from '@/components/occasion-logo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCachedImage } from '@/hooks/use-cached-image';
import { useShopName, useShopLogo, useShopIconEffect } from '@/hooks/use-shop-name';
import { useTheme } from '@/hooks/use-theme';
import { useCart } from '@/lib/cart';
import { shopId } from '@/lib/config';
import { useT } from '@/lib/i18n';
const money = (n: number) => `₹${n.toFixed(2)}`;
const RATING_GOLD = '#F5A623';

const openDetail = (id: string) => router.push(('/product/' + id) as never);

export default function Home() {
  const theme = useTheme();
  const t = useT();
  const cart = useCart();
  const shopName = useShopName();
  const [shop, setShop] = useState<Shop | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'priceAsc' | 'priceDesc'>('name');
  const [inStockOnly, setInStockOnly] = useState(false);

  const toggleFilter = () => setFilterOpen((o) => !o);

  const toggleSearch = () => {
    setSearchOpen((open) => {
      if (open) setSearch(''); // closing clears the filter so the list isn't silently narrowed
      return !open;
    });
  };

  useEffect(() => subscribeShop(shopId, setShop), []);
  useEffect(() => subscribeCategories(shopId, setCategories), []);
  useEffect(() => subscribeShopReviews(shopId, setReviews), []);
  useEffect(() => subscribeAnnouncements(shopId, setAnnouncements), []);
  useEffect(() => {
    AsyncStorage.getItem('dismissedAnnouncements')
      .then((raw) => {
        if (!raw) return;
        try {
          const ids = JSON.parse(raw);
          if (Array.isArray(ids)) setDismissed((cur) => Array.from(new Set([...cur, ...ids])));
        } catch {
          // ignore a corrupt blob
        }
      })
      .catch(() => {});
  }, []);
  useEffect(
    () =>
      subscribeProducts(shopId, (p) => {
        setProducts(p);
        setLoaded(true);
      }),
    [],
  );

  const open = shopAcceptsOrders(shop);
  // Admin-uploaded shop logo (data: URI, same source as the splash) shown in the header.
  const logoUri = useShopLogo();
  const iconEffect = useShopIconEffect();

  const featured = useMemo(() => products.filter((p) => p.active && p.featured), [products]);

  // Per-product average rating + count, grouped from the shop's reviews (client-side).
  const ratings = useMemo(() => {
    const acc = new Map<string, { sum: number; count: number }>();
    for (const r of reviews) {
      const cur = acc.get(r.productId) ?? { sum: 0, count: 0 };
      acc.set(r.productId, { sum: cur.sum + r.rating, count: cur.count + 1 });
    }
    const out = new Map<string, { avg: number; count: number }>();
    acc.forEach((v, k) => out.set(k, { avg: v.sum / v.count, count: v.count }));
    return out;
  }, [reviews]);

  const visibleAnnouncements = useMemo(
    () => announcements.filter((a) => !dismissed.includes(a.id)),
    [announcements, dismissed],
  );

  const dismissAnnouncement = (id: string) =>
    setDismissed((prev) => {
      const next = [...prev, id];
      AsyncStorage.setItem('dismissedAnnouncements', JSON.stringify(next)).catch(() => {});
      return next;
    });

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

  // Apply the in-stock filter + chosen sort on top of search/category (client-side; the
  // whole catalog is already in memory via the realtime subscription).
  const shown = useMemo(() => {
    const list = inStockOnly
      ? visible.filter((p) => !p.trackStock || (p.stock ?? 0) > 0)
      : visible;
    const sorted = [...list];
    if (sortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'priceAsc') sorted.sort((a, b) => effectivePrice(a) - effectivePrice(b));
    else sorted.sort((a, b) => effectivePrice(b) - effectivePrice(a));
    return sorted;
  }, [visible, inStockOnly, sortBy]);

  return (
    <View style={{ flex: 1 }}>
      <Tabs.Screen
        options={{
          headerTitleAlign: 'left',
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              {logoUri || iconEffect !== 'none' ? (
                <OccasionLogo logoUri={logoUri} size={30} effect={iconEffect} borderRadius={6} />
              ) : null}
              <ThemedText style={{ fontWeight: '700', fontSize: 18 }} numberOfLines={1}>
                {shopName}
              </ThemedText>
            </View>
          ),
        }}
      />

      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['left', 'right']}>
        {!loaded ? (
          <View style={styles.loaderWrap}>
            <Loader label={t('home.loading', 'Loading products…')} />
          </View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(p) => p.id}
            renderItem={({ item }) => (
              <ProductCard
                product={item}
                canAdd={open}
                rating={ratings.get(item.id)}
                onOpen={() => openDetail(item.id)}
                onAdd={() => cart.add({ productId: item.id, name: item.name, price: effectivePrice(item), unit: item.unit })}
              />
            )}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={8}
            windowSize={11}
            ListHeaderComponent={
              <View style={{ gap: Spacing.three }}>
                {visibleAnnouncements.map((a) => (
                  <AnnouncementCard
                    key={a.id}
                    announcement={a}
                    onOpen={a.productId ? () => openDetail(a.productId as string) : undefined}
                    onDismiss={() => dismissAnnouncement(a.id)}
                  />
                ))}

                {shop != null && !open ? (
                  <Card style={{ backgroundColor: DANGER + '22' }}>
                    <ThemedText type="smallBold" style={{ color: DANGER }}>
                      {t('home.closed', 'Not accepting orders right now — back soon!')}
                    </ThemedText>
                  </Card>
                ) : null}

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
                  <View style={styles.headerIcons}>
                    <Pressable
                      onPress={toggleFilter}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t('home.filter', 'Sort & filter')}
                      style={[styles.searchIcon, { backgroundColor: filterOpen ? PRIMARY : theme.backgroundElement }]}
                    >
                      <ThemedText style={{ fontSize: 15 }}>{'⇅'}</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={toggleSearch}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t('home.search', 'Search products')}
                      style={[styles.searchIcon, { backgroundColor: searchOpen ? PRIMARY : theme.backgroundElement }]}
                    >
                      <ThemedText style={{ fontSize: 15 }}>{searchOpen ? '✕' : '⌕'}</ThemedText>
                    </Pressable>
                  </View>
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

                {filterOpen ? (
                  <Card style={{ gap: Spacing.two }}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {t('home.sortBy', 'Sort by')}
                    </ThemedText>
                    <View style={styles.pillWrap}>
                      <Pill label={t('home.sortName', 'Name')} active={sortBy === 'name'} onPress={() => setSortBy('name')} />
                      <Pill label={t('home.sortPriceAsc', 'Price ↑')} active={sortBy === 'priceAsc'} onPress={() => setSortBy('priceAsc')} />
                      <Pill label={t('home.sortPriceDesc', 'Price ↓')} active={sortBy === 'priceDesc'} onPress={() => setSortBy('priceDesc')} />
                    </View>
                    <View style={styles.pillWrap}>
                      <Pill
                        label={t('home.inStock', 'In stock only')}
                        active={inStockOnly}
                        onPress={() => setInStockOnly((v) => !v)}
                      />
                    </View>
                  </Card>
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
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                title={t('home.noProducts', 'No products')}
                hint={
                  search.trim()
                    ? t('home.noMatch', 'No products match "{q}"', { q: search.trim() })
                    : t('home.noneInCategory', 'Nothing available in this category yet.')
                }
              />
            }
          />
        )}
      </SafeAreaView>

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

/** A dismissible shop announcement shown at the top of Home. */
function AnnouncementCard({
  announcement,
  onOpen,
  onDismiss,
}: {
  announcement: Announcement;
  onOpen?: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const uri = useCachedImage(announcement.imageId);
  return (
    <Card style={{ gap: Spacing.two, borderLeftWidth: 4, borderLeftColor: PRIMARY }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two }}>
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          {announcement.title}
        </ThemedText>
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel={t('common.dismiss', 'Dismiss')}>
          <ThemedText type="small" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
      </View>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: 150, borderRadius: Spacing.two, backgroundColor: theme.backgroundSelected }}
          contentFit="cover"
        />
      ) : null}
      {announcement.body ? (
        <ThemedText type="small" themeColor="textSecondary">
          {announcement.body}
        </ThemedText>
      ) : null}
      {onOpen ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button title={t('home.viewProduct', 'View product')} variant="secondary" size="sm" onPress={onOpen} />
        </View>
      ) : null}
    </Card>
  );
}

function ProductCard({
  product,
  canAdd,
  rating,
  onAdd,
  onOpen,
}: {
  product: Product;
  canAdd: boolean;
  rating?: { avg: number; count: number };
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
      {rating ? (
        <View style={styles.ratingPill}>
          <ThemedText type="small" style={{ color: RATING_GOLD, fontWeight: '700' }}>
            ★ {rating.avg.toFixed(1)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ({rating.count})
          </ThemedText>
        </View>
      ) : null}
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
  loaderWrap: { padding: Spacing.three },
  listContent: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
  ratingPill: { alignItems: 'flex-end', gap: 2, marginLeft: Spacing.one },
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
