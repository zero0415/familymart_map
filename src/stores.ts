import { SOURCE_IDS, type Coordinates, type MapSource, type OfficialStore } from "./api";
import type { Favorite } from "./favorites";

export const NEARBY_RADIUS_METERS = 1_000;

export interface ListedProduct {
  name: string;
  quantity?: number;
  category: string;
  groupName: string;
  code?: string;
}

export interface SourceProducts {
  updatedAt?: string;
  products: ListedProduct[];
}

export interface MergedStore {
  code: string;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  sources: Partial<Record<MapSource, SourceProducts>>;
}

export interface NearbyStore {
  store: MergedStore;
  distanceMeters: number;
}

export function mergeStores(
  results: Partial<Record<MapSource, readonly OfficialStore[]>>,
  favorites: readonly Favorite[],
): MergedStore[] {
  const merged = new Map<string, MergedStore>(
    favorites.map((favorite) => [
      favorite.code,
      {
        code: favorite.code,
        name: favorite.name,
        address: favorite.address,
        sources: {},
      },
    ]),
  );
  const metadataDates = new Map<string, number>();

  for (const source of SOURCE_IDS) {
    for (const row of results[source] ?? []) {
      const existing = merged.get(row.oldPKey) ?? {
        code: row.oldPKey,
        name: row.name,
        sources: {},
      };
      const updatedAt = row.updateDate ?? undefined;
      const date = updatedAt ? Date.parse(updatedAt) : -Infinity;
      if (!metadataDates.has(row.oldPKey) || date > (metadataDates.get(row.oldPKey) ?? -Infinity)) {
        existing.name = row.name;
        existing.address = row.address ?? undefined;
        existing.latitude = row.latitude;
        existing.longitude = row.longitude;
        metadataDates.set(row.oldPKey, date);
      }
      existing.sources[source] = {
        updatedAt,
        products: row.info.flatMap((group) =>
          group.categories.flatMap((category) =>
            category.products.map((product) => ({
              name: product.name,
              quantity: product.qty ?? undefined,
              category: category.name,
              groupName: group.name,
              code: product.code ?? undefined,
            })),
          ),
        ),
      };
      merged.set(row.oldPKey, existing);
    }
  }

  return [...merged.values()];
}

export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (to.latitude - from.latitude) * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(from.latitude * radians) *
      Math.cos(to.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getNearby(stores: readonly MergedStore[], position: Coordinates): NearbyStore[] {
  return stores
    .flatMap((store) =>
      store.latitude === undefined || store.longitude === undefined
        ? []
        : [{
            store,
            distanceMeters: distanceMeters(position, {
              latitude: store.latitude,
              longitude: store.longitude,
            }),
          }],
    )
    .filter((entry) => entry.distanceMeters <= NEARBY_RADIUS_METERS)
    .sort((first, second) => first.distanceMeters - second.distanceMeters);
}

export function matchesStore(store: MergedStore, search: string): boolean {
  const text = search.trim().normalize("NFKC").toLocaleLowerCase("zh-TW");
  if (!text) return true;
  return [store.name, store.address ?? "", store.code].some((field) =>
    field.normalize("NFKC").toLocaleLowerCase("zh-TW").includes(text),
  );
}

export function formatDistance(meters: number): string {
  return meters < 1_000
    ? `${Math.round(meters)} 公尺`
    : `${(meters / 1_000).toFixed(1)} 公里`;
}
