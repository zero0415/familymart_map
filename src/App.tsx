import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  MAP_SOURCES,
  MapApiError,
  MapClient,
  MapProductImageClient,
  SOURCE_IDS,
  type Coordinates,
  type MapDataClient,
  type MapQuery,
  type MapResult,
  type MapSource,
  type OfficialStore,
  type ProductImageClient,
} from "./api";
import {
  FavoriteStorageError,
  readFavorites,
  STORE_CODE_PATTERN,
  writeFavorites,
  type Favorite,
} from "./favorites";
import {
  AREA_PRESETS,
  FAVORITES_REFERENCE_POSITION,
  parseCoordinates,
  requestLocation,
  type GeolocationClient,
} from "./location";
import {
  distanceMeters,
  formatDistance,
  getNearby,
  matchesStore,
  mergeStores,
  type MergedStore,
  type NearbyStore,
  type SourceProducts,
} from "./stores";
import {
  classifyTreasureProduct,
  DEFAULT_TREASURE_FILTERS,
  filterTreasureProducts,
  hasActiveTreasureFilters,
  TREASURE_CATEGORY_LABELS,
  type TreasureFilters,
} from "./treasure";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: MapResult }
  | { status: "error"; message: string };

interface SearchCenter {
  position: Coordinates;
  label: string;
}

interface AppProps {
  client?: MapDataClient;
  imageClient?: ProductImageClient;
  geolocation?: GeolocationClient | null;
  storage?: Storage | null;
}

const defaultClient = new MapClient();
const defaultImageClient = new MapProductImageClient();
const REFRESH_INTERVAL_MS = 60_000;
const CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "food", label: "食品" },
  { value: "supplies", label: "用品" },
  { value: "alcohol", label: "酒品" },
  { value: "unknown", label: "類別未知" },
] as const satisfies readonly { value: TreasureFilters["category"]; label: string }[];
const PREFIX_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "saving", label: "惜-開頭" },
  { value: "regular", label: "非惜-開頭" },
] as const satisfies readonly { value: TreasureFilters["prefix"]; label: string }[];
const DISCOUNT_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "5折", label: "5折" },
  { value: "3折", label: "3折" },
  { value: "未知", label: "未知" },
] as const satisfies readonly { value: TreasureFilters["discount"]; label: string }[];

type ImagePreview =
  | { name: string; status: "loading" }
  | { name: string; status: "ready"; url: string }
  | { name: string; status: "error"; message: string };
const timeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function timeLabel(value: number | string): string {
  return `${timeFormatter.format(new Date(value))}（臺灣時間）`;
}

function emptyStates(): Record<MapSource, LoadState> {
  return { food: { status: "idle" }, treasure: { status: "idle" } };
}

function initialFavorites(storageOverride: Storage | null | undefined): {
  favorites: Favorite[];
  storage: Storage | null;
  warning: string | null;
} {
  try {
    const storage = storageOverride === undefined ? window.localStorage : storageOverride;
    if (!storage) {
      throw new FavoriteStorageError("無法使用裝置儲存空間；本次收藏僅保留在目前頁面。");
    }
    return { favorites: readFavorites(storage), storage, warning: null };
  } catch (error) {
    return {
      favorites: [],
      storage: null,
      warning:
        error instanceof Error
          ? error.message
          : "無法讀取裝置收藏；本次收藏僅保留在目前頁面。",
    };
  }
}

function SourceStatus({
  source,
  state,
  center,
  postalCode,
  favoriteCodes,
}: {
  source: MapSource;
  state: LoadState;
  center: SearchCenter | null;
  postalCode: string | null;
  favoriteCodes: readonly string[];
}) {
  let description = "尚未查詢";
  if (state.status === "loading") {
    description = "正在讀取官方地圖…";
  } else if (state.status === "ready") {
    const count = center || postalCode
      ? state.result.stores.length
      : state.result.stores.filter((store) => favoriteCodes.includes(store.oldPKey)).length;
    description = center
      ? `本次回傳 ${count} 間店（含收藏）`
      : postalCode
        ? `郵遞區號 ${postalCode}：回傳 ${count} 間地圖分店`
        : `本次回傳 ${count} 間收藏店`;
  }

  return (
    <div class={`source-status source-status--${source}`} aria-busy={state.status === "loading"}>
      <div class="source-status__heading">
        <span class="source-status__dot" aria-hidden="true" />
        <strong>{MAP_SOURCES[source].name}</strong>
        <a href={MAP_SOURCES[source].url} target="_blank" rel="noopener noreferrer">
          官方地圖 <span aria-hidden="true">↗</span>
        </a>
      </div>
      {state.status === "error" ? (
        <p class="source-status__error" role="alert">
          {state.message}
        </p>
      ) : (
        <p>{description}</p>
      )}
      {state.status === "ready" && (
        <small>
          查詢於 {timeLabel(state.result.fetchedAt)}
          {state.result.fromCache ? "・本頁快取" : ""}
        </small>
      )}
    </div>
  );
}

function SourceDetails({
  source,
  data,
  state,
  treasureFilters,
  onShowImage,
}: {
  source: MapSource;
  data: SourceProducts | undefined;
  state: LoadState;
  treasureFilters?: TreasureFilters;
  onShowImage: (code: string, name: string, opener: HTMLButtonElement) => void;
}) {
  const products = data?.products ?? [];
  const visibleProducts =
    source === "treasure" && treasureFilters
      ? filterTreasureProducts(products, treasureFilters)
      : products;
  const filtered =
    source === "treasure" && treasureFilters
      ? hasActiveTreasureFilters(treasureFilters)
      : false;

  return (
    <section class={`product-panel product-panel--${source}`} aria-label={`${MAP_SOURCES[source].name}商品`}>
      <div class="product-panel__heading">
        <h4>{MAP_SOURCES[source].name}</h4>
        {data && (
          <span>
            {filtered && products.length > 0
              ? `${visibleProducts.length} / ${products.length} 項符合`
              : `${products.length} 項商品明細`}
          </span>
        )}
      </div>
      {state.status === "loading" ? (
        <p class="muted">正在查詢這張地圖…</p>
      ) : state.status === "error" ? (
        <p class="muted">{state.message} 此店的商品資料暫時無法確認。</p>
      ) : state.status === "idle" ? (
        <p class="muted">尚未查詢這張地圖。</p>
      ) : !data ? (
        <p class="muted">這張地圖目前未回傳此店商品資料，不代表缺貨。</p>
      ) : (
        <>
          <p class="product-panel__time">
            資料時間：{data.updatedAt ? timeLabel(data.updatedAt) : "官方未提供"}
          </p>
          {visibleProducts.length > 0 ? (
            <ul class="product-list">
              {visibleProducts.map((product, index) => {
                const classification =
                  source === "treasure" && treasureFilters
                    ? classifyTreasureProduct(product)
                    : null;
                const imageCode = product.code;
                return (
                  <li key={`${product.groupName}-${product.name}-${index}`}>
                    <div class="product-list__details">
                      <span class="product-list__name">{product.name}</span>
                      {classification && (
                        <span class="product-list__labels">
                          {classification.category === "unknown" ? (
                            <span class="product-list__tag">類別／折扣未知</span>
                          ) : (
                            <>
                              <span class="product-list__tag">
                                {TREASURE_CATEGORY_LABELS[classification.category]}
                              </span>
                              <span class="product-list__tag product-list__tag--discount">
                                {classification.discount === "未知"
                                  ? "折扣未知"
                                  : classification.discount}
                              </span>
                            </>
                          )}
                          <span class="product-list__tag">
                            {classification.saving ? "惜-開頭" : "非惜-開頭"}
                          </span>
                        </span>
                      )}
                      <small>{product.category}</small>
                    </div>
                    <div class="product-list__side">
                      <span class="product-list__quantity">
                        {product.quantity === undefined ? "數量未提供" : `${product.quantity} 件`}
                      </span>
                      {imageCode ? (
                        <button
                          type="button"
                          class="product-list__image-button"
                          aria-label={`查看圖片：${product.name}`}
                          aria-haspopup="dialog"
                          onClick={(event) => onShowImage(imageCode, product.name, event.currentTarget)}
                        >
                          查看圖片
                        </button>
                      ) : (
                        <span class="product-list__image-unavailable">未提供圖片代碼</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : filtered && products.length > 0 ? (
            <p class="muted">目前沒有符合篩選的挖寶商品；請調整或清除篩選。</p>
          ) : (
            <p class="muted">地圖回傳此店，但未提供可列出的商品明細；請至官方地圖確認。</p>
          )}
        </>
      )}
    </section>
  );
}

function SourceBadge({ source, data, state, treasureFilters }: {
  source: MapSource;
  data: SourceProducts | undefined;
  state: LoadState;
  treasureFilters?: TreasureFilters;
}) {
  const matched =
    source === "treasure" && treasureFilters && data?.products.length &&
    hasActiveTreasureFilters(treasureFilters)
      ? filterTreasureProducts(data.products, treasureFilters).length
      : null;
  const text =
    state.status === "loading"
      ? "查詢中"
      : state.status === "error"
        ? "讀取失敗"
        : state.status === "idle"
          ? "未查詢"
          : data
            ? matched === null
              ? `${data.products.length} 項明細`
              : `${matched} / ${data.products.length} 項符合`
            : "未回傳此店";
  return (
    <span class={`source-badge source-badge--${source}`}>
      {MAP_SOURCES[source].name}・{text}
    </span>
  );
}

function StoreCard({
  store,
  isFavorite,
  distance,
  states,
  favoriteView,
  treasureFilters,
  onAdd,
  onShowImage,
}: {
  store: MergedStore;
  isFavorite: boolean;
  distance?: number;
  states: Record<MapSource, LoadState>;
  favoriteView: boolean;
  treasureFilters?: TreasureFilters;
  onAdd: (store: MergedStore) => void;
  onShowImage: (code: string, name: string, opener: HTMLButtonElement) => void;
}) {
  const panels = SOURCE_IDS.map((source) => (
    <SourceDetails
      key={source}
      source={source}
      data={store.sources[source]}
      state={states[source]}
      treasureFilters={source === "treasure" ? treasureFilters : undefined}
      onShowImage={onShowImage}
    />
  ));

  return (
    <article class={`store-card${favoriteView ? " store-card--favorite" : ""}`}>
      <div class="store-card__head">
        <div class="store-card__identity">
          <h3>{store.name}</h3>
          <p>{store.address || "地址未提供"}</p>
          <small>
            店代碼 {store.code}
            {distance !== undefined && `・距查詢中心約 ${formatDistance(distance)}`}
          </small>
        </div>
        {isFavorite ? (
          <span class="favorite-button favorite-button--active" aria-label={`${store.name}已收藏`}>
            <span aria-hidden="true">★</span> 已收藏
          </span>
        ) : (
          <button
            type="button"
            class="favorite-button"
            aria-label={`加入收藏：${store.name}`}
            onClick={() => onAdd(store)}
          >
            <span aria-hidden="true">☆</span> 收藏
          </button>
        )}
      </div>
      <div class="store-card__badges">
        {SOURCE_IDS.map((source) => (
          <SourceBadge
            key={source}
            source={source}
            data={store.sources[source]}
            state={states[source]}
            treasureFilters={source === "treasure" ? treasureFilters : undefined}
          />
        ))}
      </div>
      <details class="store-card__details">
        <summary>
          {favoriteView
            ? "展開或收合兩張地圖的商品與資料時間"
            : "查看兩張地圖的商品與資料時間"}
        </summary>
        <div class="store-card__panels">{panels}</div>
      </details>
    </article>
  );
}

function NearbyDiagram({
  center,
  nearby,
}: {
  center: Coordinates;
  nearby: readonly NearbyStore[];
}) {
  const pixelsPerMeter = 124 / 1_000;
  const longitudeScale = 111_320 * Math.cos((center.latitude * Math.PI) / 180);

  return (
    <figure class="nearby-diagram">
      <svg
        viewBox="0 0 300 300"
        role="img"
        aria-label={`附近 ${nearby.length} 間店的相對位置示意，北方在上；店家明細請看下方清單`}
      >
        <circle cx="150" cy="150" r="124" class="nearby-diagram__boundary" />
        <circle cx="150" cy="150" r="62" class="nearby-diagram__ring" />
        <path d="M150 22v256M22 150h256" class="nearby-diagram__axis" />
        <text x="150" y="16" text-anchor="middle" class="nearby-diagram__north">北 N</text>
        {nearby.map(({ store }) => {
          if (store.latitude === undefined || store.longitude === undefined) return null;
          const x = 150 + (store.longitude - center.longitude) * longitudeScale * pixelsPerMeter;
          const y = 150 - (store.latitude - center.latitude) * 111_320 * pixelsPerMeter;
          const sourceClass =
            store.sources.food && store.sources.treasure
              ? "both"
              : store.sources.food
                ? "food"
                : "treasure";
          return (
            <circle
              key={store.code}
              cx={x}
              cy={y}
              r="5"
              class={`nearby-diagram__store nearby-diagram__store--${sourceClass}`}
            >
              <title>{store.name}</title>
            </circle>
          );
        })}
        <circle cx="150" cy="150" r="8" class="nearby-diagram__center" />
        <circle cx="150" cy="150" r="2" class="nearby-diagram__center-dot" />
      </svg>
      <figcaption>
        <strong>附近位置示意</strong>
        <span>中心為查詢座標・外圈約 1 公里</span>
        <small>不載入第三方地圖圖磚；店家與商品請以清單為準。</small>
      </figcaption>
    </figure>
  );
}

export function App({
  client = defaultClient,
  imageClient = defaultImageClient,
  geolocation,
  storage,
}: AppProps) {
  const [saved] = useState(() => initialFavorites(storage));
  const storageRef = useRef<Storage | null>(saved.storage);
  const [favorites, setFavorites] = useState<Favorite[]>(saved.favorites);
  const [storageWarning, setStorageWarning] = useState<string | null>(saved.warning);
  const [center, setCenter] = useState<SearchCenter | null>(null);
  const [postalCode, setPostalCode] = useState<string | null>(null);
  const [states, setStates] = useState<Record<MapSource, LoadState>>(emptyStates);
  const [favoriteStates, setFavoriteStates] = useState<Record<MapSource, LoadState>>(emptyStates);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedArea, setSelectedArea] = useState("");
  const [latitudeText, setLatitudeText] = useState("");
  const [longitudeText, setLongitudeText] = useState("");
  const [search, setSearch] = useState("");
  const [postalInput, setPostalInput] = useState("");
  const [searchNotice, setSearchNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [treasureFilters, setTreasureFilters] = useState<TreasureFilters>(DEFAULT_TREASURE_FILTERS);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [storeCode, setStoreCode] = useState("");
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [lookupToken, setLookupToken] = useState(0);
  const lastRefreshToken = useRef(0);
  const lastFavoriteRefreshToken = useRef(0);
  const lastManualRefresh = useRef(0);
  const locationAttempt = useRef(0);
  const areaSelectRef = useRef<HTMLSelectElement>(null);
  const postalInputRef = useRef<HTMLInputElement>(null);
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRemovalRef = useRef<HTMLButtonElement>(null);
  const managerSummaryRef = useRef<HTMLElement>(null);
  const managerTitleRef = useRef<HTMLHeadingElement>(null);
  const imageDialogRef = useRef<HTMLDialogElement>(null);
  const imageRequestRef = useRef<AbortController | null>(null);
  const imageTriggerRef = useRef<HTMLButtonElement | null>(null);

  const favoriteCodesKey = favorites.map((favorite) => favorite.code).sort().join(",");
  const favoriteCodes = favoriteCodesKey ? favoriteCodesKey.split(",") : [];

  useEffect(() => {
    const update = () => setShowBackToTop(window.scrollY > 420);
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => window.removeEventListener("scroll", update);
  }, []);

  useLayoutEffect(() => {
    if (pendingRemoval) cancelRemovalRef.current?.focus();
  }, [pendingRemoval]);

  useLayoutEffect(() => {
    if (imagePreview && imageDialogRef.current && !imageDialogRef.current.open) {
      imageDialogRef.current.showModal();
    }
  }, [imagePreview !== null]);

  useEffect(() => () => imageRequestRef.current?.abort(), []);

  useLayoutEffect(() => {
    if (!center && !postalCode && !favoriteCodesKey) {
      setStates(emptyStates());
      return;
    }

    const controller = new AbortController();
    setStates({
      food: { status: "loading" },
      treasure: { status: "loading" },
    });
    const force = refreshToken !== lastRefreshToken.current;
    lastRefreshToken.current = refreshToken;
    const timer = window.setTimeout(() => {
      for (const source of SOURCE_IDS) {
        const favoriteCodes = postalCode
          ? []
          : favoriteCodesKey
            ? favoriteCodesKey.split(",")
            : [];
        const query: MapQuery = postalCode
          ? { source, postalCode, favoriteCodes, signal: controller.signal, force }
          : {
              source,
              position: center?.position ?? FAVORITES_REFERENCE_POSITION,
              favoriteCodes,
              signal: controller.signal,
              force,
            };
        void client
          .load(query)
          .then((result) => {
            if (controller.signal.aborted) return;
            setStates((previous) => ({
              ...previous,
              [source]: { status: "ready", result } as LoadState,
            }));
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            if (!(error instanceof MapApiError)) {
              console.error("Unexpected FamilyMart map error", error);
            }
            const message =
              error instanceof MapApiError
                ? error.message
                : "讀取官方地圖時發生未預期錯誤。請稍後重試。";
            setStates((previous) => ({
              ...previous,
              [source]: { status: "error", message } as LoadState,
            }));
          });
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    client,
    center?.position.latitude,
    center?.position.longitude,
    postalCode,
    // Loaded stores can be favorited without querying again; only an unknown code advances this token.
    lookupToken,
    refreshToken,
  ]);

  useLayoutEffect(() => {
    if (!postalCode || !favoriteCodesKey) {
      setFavoriteStates(emptyStates());
      return;
    }

    const controller = new AbortController();
    setFavoriteStates({ food: { status: "loading" }, treasure: { status: "loading" } });
    const force = refreshToken !== lastFavoriteRefreshToken.current;
    lastFavoriteRefreshToken.current = refreshToken;
    const timer = window.setTimeout(() => {
      for (const source of SOURCE_IDS) {
        void client
          .load({
            source,
            position: FAVORITES_REFERENCE_POSITION,
            favoriteCodes: favoriteCodesKey.split(","),
            signal: controller.signal,
            force,
          })
          .then((result) => {
            if (controller.signal.aborted) return;
            setFavoriteStates((previous) => ({
              ...previous,
              [source]: { status: "ready", result } as LoadState,
            }));
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            if (!(error instanceof MapApiError)) {
              console.error("Unexpected FamilyMart map error", error);
            }
            setFavoriteStates((previous) => ({
              ...previous,
              [source]: {
                status: "error",
                message: error instanceof MapApiError
                  ? error.message
                  : "讀取收藏店的官方地圖資料時發生未預期錯誤。請稍後重試。",
              } as LoadState,
            }));
          });
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, favoriteCodesKey, postalCode, refreshToken]);

  const mapStores = useMemo(() => {
    const results: Partial<Record<MapSource, OfficialStore[]>> = {};
    for (const source of SOURCE_IDS) {
      if (states[source].status === "ready") {
        const rows = states[source].result.stores;
        results[source] = center || postalCode
          ? rows
          : rows.filter((row) => favoriteCodes.includes(row.oldPKey));
      }
    }
    return mergeStores(results, postalCode ? [] : favorites);
  }, [states, favorites, center, postalCode]);

  const savedStores = useMemo(() => {
    if (!postalCode) {
      const codes = new Set(favorites.map((favorite) => favorite.code));
      return mapStores.filter((store) => codes.has(store.code));
    }
    const results: Partial<Record<MapSource, OfficialStore[]>> = {};
    const codes = new Set(favorites.map((favorite) => favorite.code));
    for (const source of SOURCE_IDS) {
      const favoriteRows = favoriteStates[source].status === "ready"
        ? favoriteStates[source].result.stores
        : [];
      const postalRows = states[source].status === "ready"
        ? states[source].result.stores.filter((row) => codes.has(row.oldPKey))
        : [];
      results[source] = [...new Map(
        [...favoriteRows, ...postalRows].map((row) => [row.oldPKey, row]),
      ).values()];
    }
    return mergeStores(results, favorites);
  }, [postalCode, mapStores, states, favoriteStates, favorites]);

  function save(next: Favorite[]) {
    setFavorites(next);
    if (!center && !postalCode && next.length === 0) setStates(emptyStates());
    if (!storageRef.current) return;
    try {
      writeFavorites(storageRef.current, next);
    } catch (error) {
      storageRef.current = null;
      setStorageWarning(
        error instanceof Error
          ? error.message
          : "無法儲存收藏；本次收藏僅保留在目前頁面。",
      );
    }
  }

  useEffect(() => {
    const matched = new Map(savedStores.map((store) => [store.code, store]));
    const updated = favorites.map((favorite) => {
      const row = matched.get(favorite.code);
      if (!row || !Object.keys(row.sources).length) return favorite;
      if (favorite.name === row.name && favorite.address === row.address) return favorite;
      return { code: favorite.code, name: row.name, address: row.address };
    });
    if (updated.some((item, index) => item !== favorites[index])) save(updated);
  }, [savedStores, favorites]);

  const byCode = new Map(
    [...savedStores, ...mapStores].map((store) => [store.code, store]),
  );
  const hasSearch = search.trim().length > 0;
  const previewMatches = hasSearch
    ? [...byCode.values()].filter((store) => matchesStore(store, search))
    : [];
  const favoriteStores = savedStores.filter((store) => matchesStore(store, search));
  const readyTreasureFavorites = favoriteStores.filter(
    (store) => favoriteSourceState(store, "treasure").status === "ready",
  );
  const countableTreasureProducts = readyTreasureFavorites.flatMap(
    (store) => store.sources.treasure?.products ?? [],
  );
  const matchingTreasureCount =
    filterTreasureProducts(countableTreasureProducts, treasureFilters).length;
  const nearby = center
    ? getNearby(mapStores, center.position).filter(({ store }) => matchesStore(store, search))
    : [];
  const postalStores = postalCode
    ? mapStores
        .filter((store) => matchesStore(store, search))
        .sort((first, second) => first.name.localeCompare(second.name, "zh-TW"))
    : [];
  const visibleStores = postalCode
    ? postalStores.map((store) => ({ store, distance: undefined }))
    : nearby.map(({ store, distanceMeters: distance }) => ({ store, distance }));
  const loading = SOURCE_IDS.some((source) => states[source].status === "loading");
  const errorCount = SOURCE_IDS.filter((source) => states[source].status === "error").length;

  function favoriteSourceState(store: MergedStore, source: MapSource): LoadState {
    if (!postalCode) return states[source];
    const mapState = states[source];
    return mapState.status === "ready" &&
      mapState.result.stores.some((row) => row.oldPKey === store.code)
      ? mapState
      : favoriteStates[source];
  }

  function chooseCenter(position: Coordinates, label: string) {
    locationAttempt.current += 1;
    setLocating(false);
    setLocationError(null);
    setFormError(null);
    setPostalCode(null);
    setPostalInput("");
    setSearchNotice(null);
    setCenter({ position, label });
  }

  async function findMyLocation() {
    const attempt = ++locationAttempt.current;
    setLocating(true);
    setLocationError(null);
    try {
      const browserLocation =
        geolocation === undefined ? navigator.geolocation : geolocation ?? undefined;
      const position = await requestLocation(browserLocation);
      if (attempt !== locationAttempt.current) return;
      chooseCenter(position, "目前位置");
    } catch (error) {
      if (attempt !== locationAttempt.current) return;
      setLocating(false);
      setLocationError(
        error instanceof Error
          ? error.message
          : "無法取得定位；請選擇地區中心或手動座標搜尋。",
      );
      areaSelectRef.current?.focus();
    }
  }

  function chooseArea(event: Event) {
    event.preventDefault();
    const area = AREA_PRESETS.find((preset) => preset.id === selectedArea);
    if (!area) {
      setFormError("請先選擇一個地區中心。");
      return;
    }
    chooseCenter(
      { latitude: area.latitude, longitude: area.longitude },
      area.label,
    );
  }

  function chooseCoordinates(event: Event) {
    event.preventDefault();
    try {
      const position = parseCoordinates(latitudeText, longitudeText);
      chooseCenter(position, "手動座標");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "座標無效，請檢查後重試。");
    }
  }

  function focusResults(id: "nearby-title" | "favorites-title") {
    window.setTimeout(() => {
      const heading = document.getElementById(id);
      heading?.scrollIntoView?.({ block: "start" });
      heading?.focus({ preventScroll: true });
    }, 0);
  }

  function submitNameSearch(event: Event) {
    event.preventDefault();
    const zip = postalInput.trim();
    if (zip && !/^\d{3}$/.test(zip)) {
      setSearchNotice({ text: "請輸入三位數郵遞區號，例如 100。", error: true });
      postalInputRef.current?.focus();
      return;
    }
    if (!zip && !hasSearch) {
      setSearchNotice({
        text: "請先輸入店名、地址或店代碼；也可以輸入三位數郵遞區號查看該區的地圖資料。",
        error: true,
      });
      document.getElementById("store-search")?.focus();
      return;
    }
    if (zip) {
      locationAttempt.current += 1;
      setLocating(false);
      setLocationError(null);
      setCenter(null);
      setPostalCode(zip);
      setSearchNotice({
        text: `已選擇郵遞區號 ${zip}；符合店名的地圖結果在下方。`,
        error: false,
      });
      focusResults("nearby-title");
      return;
    }
    if (!center && !postalCode && previewMatches.length === 0) {
      setSearchNotice({
        text: "目前只載入收藏店；請先選擇附近位置，或填三位數郵遞區號後再搜尋其他分店。",
        error: true,
      });
      postalInputRef.current?.focus();
      return;
    }
    setSearchNotice(
      loading
        ? { text: "正在搜尋官方地圖；結果會顯示在下方。", error: false }
        : errorCount > 0 && previewMatches.length === 0
          ? { text: "部分地圖讀取失敗，無法確認是否有符合的分店。", error: true }
          : {
              text: previewMatches.length > 0
                ? `已載入清單符合 ${previewMatches.length} 間店；完整資料請見下方結果。`
                : "已載入清單沒有符合的店；可更換區域或直接輸入店代碼收藏。",
              error: false,
            },
    );
    focusResults(visibleStores.length > 0 || favoriteStores.length === 0
      ? "nearby-title"
      : "favorites-title");
  }

  function addFavorite(store: MergedStore) {
    save([
      { code: store.code, name: store.name, address: store.address },
      ...favorites.filter((favorite) => favorite.code !== store.code),
    ]);
  }

  function confirmRemoval(code: string) {
    if (pendingRemoval !== code) throw new Error("收藏移除確認狀態不一致。");
    save(favorites.filter((favorite) => favorite.code !== code));
    setPendingRemoval(null);
    removeTriggerRef.current = null;
    if (favorites.length === 1) {
      managerTitleRef.current?.focus();
    } else {
      managerSummaryRef.current?.focus();
    }
  }

  function cancelRemoval() {
    setPendingRemoval(null);
    removeTriggerRef.current?.focus();
    removeTriggerRef.current = null;
  }

  function chooseTreasureFilter<Key extends keyof TreasureFilters>(
    field: Key,
    value: string,
    options: readonly { value: TreasureFilters[Key] }[],
  ) {
    const selected = options.find((option) => option.value === value);
    if (!selected) throw new Error(`無效的挖寶篩選條件：${field}=${value}`);
    setTreasureFilters((current) => ({ ...current, [field]: selected.value }));
  }

  function showImage(code: string, name: string, opener: HTMLButtonElement) {
    imageRequestRef.current?.abort();
    const controller = new AbortController();
    imageRequestRef.current = controller;
    imageTriggerRef.current = opener;
    setImageLoaded(false);
    setImagePreview({ name, status: "loading" });
    void imageClient.loadImage(code, controller.signal)
      .then((url) => {
        if (!controller.signal.aborted) setImagePreview({ name, status: "ready", url });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof MapApiError)) {
          console.error("Unexpected FamilyMart product image error", error);
        }
        setImagePreview({
          name,
          status: "error",
          message: error instanceof MapApiError
            ? error.message
            : "讀取商品圖片時發生未預期錯誤。請稍後重試。",
        });
      });
  }

  function closeImage() {
    imageRequestRef.current?.abort();
    imageRequestRef.current = null;
    setImagePreview(null);
    const opener = imageTriggerRef.current;
    imageTriggerRef.current = null;
    if (opener?.isConnected) {
      opener.focus();
    } else {
      document.getElementById("main-content")?.focus();
    }
  }

  function addCode(event: Event) {
    event.preventDefault();
    const code = storeCode.trim();
    if (!STORE_CODE_PATTERN.test(code)) {
      setCodeMessage("請輸入官方地圖或收據上的數字店代碼（例如 018558）。");
      return;
    }
    if (favorites.some((favorite) => favorite.code === code)) {
      setCodeMessage("這間店已在收藏清單中。");
      return;
    }
    const matched = byCode.get(code);
    save([
      {
        code,
        name: matched?.name ?? `店代碼 ${code}`,
        address: matched?.address,
      },
      ...favorites,
    ]);
    if (!matched && !postalCode) setLookupToken((previous) => previous + 1);
    setStoreCode("");
    setCodeMessage(
      matched
        ? "已加入收藏。"
        : "已保留這個店代碼並查詢官方地圖；若地圖暫無資料，收藏仍會保留。",
    );
  }

  function refresh() {
    const now = Date.now();
    if (now - lastManualRefresh.current < REFRESH_INTERVAL_MS) {
      setRefreshMessage("請至少間隔 1 分鐘再手動重新查詢，以減少對官方服務的請求。");
      return;
    }
    lastManualRefresh.current = now;
    setRefreshMessage("正在重新查詢兩張官方地圖…");
    setRefreshToken((previous) => previous + 1);
  }

  return (
    <>
      <header id="top" class="site-header">
        <div class="container site-header__inner">
          <a class="brand" href="#main-content" aria-label="全家附近好物，回到主要內容">
            <span class="brand__mark" aria-hidden="true"><span /></span>
            <span>附近好物<span class="brand__suffix"> / FAMILY STORE MAP</span></span>
            <span class="brand__disclaimer">非官方</span>
          </a>
          <nav aria-label="頁面導覽">
            <a href="#favorites">我的收藏</a>
            <a href="#nearby">附近店家</a>
            <a href="#about">資料說明</a>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section class="hero">
          <div class="container hero__inner">
            <div>
              <span class="eyebrow">兩張地圖，一眼看懂</span>
              <h1>常去的全家，<br /><em>好物不錯過。</em></h1>
              <p>收藏分店，快速查看「友善食光」與「挖寶專區」回傳的商品；或用目前位置找附近店家。</p>
              <a class="hero__link" href="#location">開始找附近 <span aria-hidden="true">↗</span></a>
            </div>
            <div class="hero__art" aria-hidden="true">
              <span class="hero__orbit hero__orbit--one" />
              <span class="hero__orbit hero__orbit--two" />
              <span class="hero__pin hero__pin--one">★</span>
              <span class="hero__pin hero__pin--two">◎</span>
              <span class="hero__pin hero__pin--three">◆</span>
              <span class="hero__center">好</span>
            </div>
          </div>
        </section>

        <div class="container">
          <div class="source-grid" aria-label="官方地圖資料狀態">
            {SOURCE_IDS.map((source) => (
              <SourceStatus
                key={source}
                source={source}
                state={states[source]}
                center={center}
                postalCode={postalCode}
                favoriteCodes={favoriteCodes}
              />
            ))}
          </div>
          <p class="source-note">
            僅顯示地圖目前回傳的商品資料，並非所有分店或完整／即時庫存；未回傳資料不等於缺貨。
          </p>

          <div class="page-grid">
            <aside class="controls" aria-label="搜尋條件">
              <section id="location" class="control-panel">
                <div class="section-label"><span>01</span> 選擇查詢位置</div>
                <h2>你想從哪裡找？</h2>
                <p class="muted">搜尋中心約 1 公里內、兩張地圖有回傳的店家。</p>
                <button
                  class="primary-button"
                  type="button"
                  disabled={locating}
                  onClick={() => void findMyLocation()}
                >
                  <span aria-hidden="true">⌖</span> {locating ? "正在取得位置…" : "使用目前位置"}
                </button>
                <p class="privacy-note">
                  只有按下此按鈕才會向瀏覽器請求定位；座標僅送往全家地圖資料 API，不儲存在裝置。
                </p>
                {locationError && <p class="inline-alert" role="alert">{locationError}</p>}
                {center && (
                  <div class="current-center">
                    <span>目前查詢：<strong>{center.label}</strong></span>
                    <button
                      type="button"
                      onClick={() => {
                        locationAttempt.current += 1;
                        setCenter(null);
                        setLocating(false);
                        setLocationError(null);
                      }}
                    >
                      清除位置
                    </button>
                  </div>
                )}

                <div class="control-divider"><span>不使用定位，也能搜尋</span></div>
                <form onSubmit={chooseArea}>
                  <label for="area">選擇地區中心</label>
                  <select
                    id="area"
                    ref={areaSelectRef}
                    value={selectedArea}
                    onChange={(event) => setSelectedArea(event.currentTarget.value)}
                  >
                    <option value="">請選擇地區</option>
                    {AREA_PRESETS.map((area) => (
                      <option key={area.id} value={area.id}>{area.label}</option>
                    ))}
                  </select>
                  <button class="secondary-button" type="submit">搜尋此區域附近</button>
                </form>
                <p class="field-hint">以標示地點為中心查詢約 1 公里，非整個行政區。</p>

                <form class="coordinate-form" onSubmit={chooseCoordinates}>
                  <div class="coordinate-form__fields">
                    <div>
                      <label for="latitude">緯度</label>
                      <input
                        id="latitude"
                        type="text"
                        inputMode="decimal"
                        placeholder="25.0479"
                        value={latitudeText}
                        onInput={(event) => setLatitudeText(event.currentTarget.value)}
                      />
                    </div>
                    <div>
                      <label for="longitude">經度</label>
                      <input
                        id="longitude"
                        type="text"
                        inputMode="decimal"
                        placeholder="121.5171"
                        value={longitudeText}
                        onInput={(event) => setLongitudeText(event.currentTarget.value)}
                      />
                    </div>
                  </div>
                  <button class="text-button" type="submit">以座標搜尋 <span aria-hidden="true">→</span></button>
                </form>
                {formError && <p class="inline-alert" role="alert">{formError}</p>}
              </section>

              <section class="control-panel control-panel--search">
                <div class="section-label"><span>02</span> 店名搜尋</div>
                <h2>找你的分店</h2>
                <form class="name-search" onSubmit={submitNameSearch}>
                  <label for="store-search">搜尋店名、地址或店代碼</label>
                  <div class="name-search__row">
                    <input
                      id="store-search"
                      type="search"
                      placeholder="例如：台鐵西"
                      value={search}
                      onInput={(event) => {
                        setSearch(event.currentTarget.value);
                        setSearchNotice(null);
                      }}
                    />
                    <button type="submit">搜尋分店</button>
                  </div>
                  <label for="postal-code">三位數郵遞區號（未選位置時請填寫）</label>
                  <input
                    id="postal-code"
                    ref={postalInputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="例如：100"
                    value={postalInput}
                    onInput={(event) => {
                      setPostalInput(event.currentTarget.value);
                      setSearchNotice(null);
                    }}
                  />
                  <p class="field-hint">
                    先選附近位置，或輸入郵遞區號；只搜尋兩張地圖目前回傳的店，非全臺完整名錄。
                  </p>
                  <a
                    class="store-directory-link"
                    href="https://www.family.com.tw/Marketing/zh/Map"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    不知道郵遞區號？查看全家官方店舖查詢 <span aria-hidden="true">↗</span>
                  </a>
                  {postalCode && (
                    <div class="current-center">
                      <span>查詢郵遞區號：<strong>{postalCode}</strong></span>
                      <button
                        type="button"
                        onClick={() => {
                          setPostalCode(null);
                          setPostalInput("");
                          setSearchNotice(null);
                        }}
                      >
                        清除此區域
                      </button>
                    </div>
                  )}
                  {searchNotice && (
                    <p
                      class={searchNotice.error ? "inline-alert" : "form-message"}
                      role={searchNotice.error ? "alert" : "status"}
                    >
                      {searchNotice.text}
                    </p>
                  )}
                  {hasSearch && (
                    <div class="search-preview">
                      <p role="status">
                        {loading
                          ? "正在搜尋官方地圖…"
                          : previewMatches.length > 0
                            ? `已載入清單符合 ${previewMatches.length} 間分店`
                            : errorCount > 0
                              ? "部分地圖讀取失敗，搜尋結果不完整。"
                              : center || postalCode
                                ? "目前地圖未回傳符合店名的店家；可換區域或輸入店代碼收藏。"
                                : "尚未載入其他分店；請先選附近位置或輸入郵遞區號。"}
                      </p>
                      {previewMatches.length > 0 && (
                        <ul>
                          {previewMatches.slice(0, 5).map((store) => {
                            const isFavorite = favorites.some((favorite) => favorite.code === store.code);
                            return (
                              <li key={store.code}>
                                <div>
                                  <strong>{store.name}</strong>
                                  <small>
                                    {visibleStores.some((entry) => entry.store.code === store.code)
                                      ? store.address || `店代碼 ${store.code}`
                                      : `收藏店（不一定在查詢區域）・${store.address || store.code}`}
                                  </small>
                                </div>
                                {isFavorite ? (
                                  <span class="search-preview__saved" aria-label={`${store.name}已收藏`}>
                                    已收藏
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    aria-label={`加入收藏：${store.name}`}
                                    onClick={() => addFavorite(store)}
                                  >
                                    收藏
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {previewMatches.length > 0 && (
                        <a href={visibleStores.length > 0 ? "#nearby" : "#favorites"}>
                          查看商品與完整結果 ↓
                        </a>
                      )}
                    </div>
                  )}
                </form>
                <form class="code-form" onSubmit={addCode}>
                  <label for="store-code">已有店代碼？直接收藏</label>
                  <div class="code-form__row">
                    <input
                      id="store-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={12}
                      placeholder="例如 018558"
                      value={storeCode}
                      onInput={(event) => setStoreCode(event.currentTarget.value)}
                    />
                    <button type="submit" aria-label="收藏輸入的店代碼">加入</button>
                  </div>
                  <p class="field-hint">即使地圖暫未回傳商品，這個店代碼仍會保留在收藏。</p>
                  {codeMessage && <p class="form-message" role="status">{codeMessage}</p>}
                </form>
                {storageWarning && <p class="inline-alert" role="alert">{storageWarning}</p>}
              </section>
            </aside>

            <div class="results">
              <section id="favorites" class="result-section" aria-labelledby="favorites-title">
                <div class="result-section__heading">
                  <div>
                    <div class="section-label"><span>★</span> 快速查看</div>
                    <h2 id="favorites-title" tabIndex={-1}>我的收藏 <span>{favorites.length}</span></h2>
                  </div>
                  {favorites.length > 0 && (
                    <a class="manage-favorites-link" href="#manage-favorites">管理收藏 <span aria-hidden="true">→</span></a>
                  )}
                </div>
                <div class="favorite-filters" aria-labelledby="favorite-filters-title">
                  <div class="favorite-filters__heading">
                    <h3 id="favorite-filters-title">篩選收藏中的挖寶商品</h3>
                    {hasActiveTreasureFilters(treasureFilters) && (
                      <button
                        type="button"
                        class="favorite-filters__reset"
                        onClick={() => setTreasureFilters(DEFAULT_TREASURE_FILTERS)}
                      >
                        清除篩選
                      </button>
                    )}
                  </div>
                  <p class="favorite-filters__note">
                    只篩選收藏中的挖寶商品，不影響分店、友善食光或附近清單。
                    折數依使用者提供規則判讀，實際優惠以官方／現場為準。
                  </p>
                  <div class="favorite-filters__fields">
                    <div>
                      <label for="favorite-category">商品分類</label>
                      <select
                        id="favorite-category"
                        value={treasureFilters.category}
                        onChange={(event) =>
                          chooseTreasureFilter("category", event.currentTarget.value, CATEGORY_FILTER_OPTIONS)
                        }
                      >
                        {CATEGORY_FILTER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label for="favorite-prefix">惜字開頭</label>
                      <select
                        id="favorite-prefix"
                        value={treasureFilters.prefix}
                        onChange={(event) =>
                          chooseTreasureFilter("prefix", event.currentTarget.value, PREFIX_FILTER_OPTIONS)
                        }
                      >
                        {PREFIX_FILTER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label for="favorite-discount">自訂折數</label>
                      <select
                        id="favorite-discount"
                        value={treasureFilters.discount}
                        onChange={(event) =>
                          chooseTreasureFilter("discount", event.currentTarget.value, DISCOUNT_FILTER_OPTIONS)
                        }
                      >
                        {DISCOUNT_FILTER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {readyTreasureFavorites.length > 0 && (
                    <p class="favorite-filters__count" role="status">
                      已取得明細的收藏店：符合 {matchingTreasureCount} / {countableTreasureProducts.length}
                      {" "}項挖寶商品（未回傳資料不計入）。
                    </p>
                  )}
                </div>
                {favorites.length === 0 ? (
                  <div class="empty-state">
                    <span class="empty-state__icon" aria-hidden="true">☆</span>
                    <h3>還沒有收藏的分店</h3>
                    <p>從附近清單按「收藏」，或輸入已知店代碼；收藏會留在這台裝置。</p>
                  </div>
                ) : favoriteStores.length === 0 ? (
                  <div class="empty-state">
                    <h3>收藏裡沒有符合搜尋的店</h3>
                    <p>清除店名搜尋即可看見所有收藏，資料不會被刪除。</p>
                  </div>
                ) : (
                  <div class="store-list">
                    {favoriteStores.map((store) => (
                      <StoreCard
                        key={store.code}
                        store={store}
                        isFavorite
                        favoriteView
                        treasureFilters={treasureFilters}
                        states={{
                          food: favoriteSourceState(store, "food"),
                          treasure: favoriteSourceState(store, "treasure"),
                        }}
                        distance={
                          center && store.latitude !== undefined && store.longitude !== undefined
                            ? distanceMeters(center.position, {
                                latitude: store.latitude,
                                longitude: store.longitude,
                              })
                            : undefined
                        }
                        onAdd={addFavorite}
                        onShowImage={showImage}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section id="manage-favorites" class="result-section" aria-labelledby="manage-favorites-title">
                <div class="result-section__heading">
                  <div>
                    <div class="section-label"><span>✎</span> 獨立管理</div>
                    <h2 id="manage-favorites-title" ref={managerTitleRef} tabIndex={-1}>管理收藏</h2>
                    <p>瀏覽收藏或附近店家時不會一鍵移除；只能在這裡確認後刪除。</p>
                  </div>
                </div>
                {favorites.length > 0 ? (
                  <details
                    class="favorite-manager"
                    onToggle={(event) => {
                      if (!event.currentTarget.open) setPendingRemoval(null);
                    }}
                  >
                    <summary ref={managerSummaryRef}>展開管理清單（{favorites.length} 間）</summary>
                    <ul class="favorite-manager__list">
                      {favorites.map((favorite) => (
                        <li key={favorite.code}>
                          <div class="favorite-manager__identity">
                            <strong>{favorite.name}</strong>
                            <small>店代碼 {favorite.code}</small>
                          </div>
                          <button
                            type="button"
                            class="favorite-manager__remove"
                            aria-label={`準備移除收藏：${favorite.name}`}
                            aria-expanded={pendingRemoval === favorite.code}
                            aria-controls={
                              pendingRemoval === favorite.code
                                ? `confirm-remove-${favorite.code}`
                                : undefined
                            }
                            onClick={(event) => {
                              removeTriggerRef.current = event.currentTarget;
                              setPendingRemoval(favorite.code);
                            }}
                          >
                            移除…
                          </button>
                          {pendingRemoval === favorite.code && (
                            <div
                              id={`confirm-remove-${favorite.code}`}
                              class="favorite-manager__confirm"
                              role="group"
                              aria-label={`確認移除${favorite.name}`}
                            >
                              <p>
                                確定要從此裝置的收藏移除「{favorite.name}」
                                （店代碼 {favorite.code}）嗎？
                              </p>
                              <div class="favorite-manager__actions">
                                <button type="button" ref={cancelRemovalRef} onClick={cancelRemoval}>取消</button>
                                <button
                                  type="button"
                                  class="favorite-manager__confirm-remove"
                                  onClick={() => confirmRemoval(favorite.code)}
                                >
                                  確認移除
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p class="muted">尚未收藏分店；可從附近店家或店代碼加入。</p>
                )}
              </section>

              <section id="nearby" class="result-section" aria-labelledby="nearby-title">
                <div class="result-section__heading">
                  <div>
                    <div class="section-label">
                      <span>{postalCode ? "⌕" : "⌖"}</span>
                      {postalCode ? "郵遞區號查詢" : "一公里內"}
                    </div>
                    <h2 id="nearby-title" tabIndex={-1}>{postalCode ? "分店搜尋結果" : "附近店家"}</h2>
                    <p>
                      {postalCode
                        ? `郵遞區號 ${postalCode}・依店名排序・僅含地圖回傳的本區店家`
                        : center
                          ? `${center.label}周邊・依距離排序・僅含地圖有回傳的店`
                          : "先使用目前位置，或選擇地區／輸入座標；也可用郵遞區號搜尋。"}
                    </p>
                  </div>
                  {(center || postalCode || favorites.length > 0) && (
                    <button
                      type="button"
                      class="refresh-button"
                      disabled={loading}
                      onClick={refresh}
                    >
                      <span aria-hidden="true">↻</span> 重新查詢
                    </button>
                  )}
                </div>
                {refreshMessage && <p class="refresh-message" role="status">{refreshMessage}</p>}
                {!center && !postalCode ? (
                  <div class="empty-state empty-state--location">
                    <span class="empty-state__icon" aria-hidden="true">⌖</span>
                    <h3>選個位置，看看附近有什麼</h3>
                    <p>不用授權定位也能選地區中心或輸入郵遞區號；若有收藏，已在上方獨立查詢。</p>
                    <a href="#location">前往位置選擇 <span aria-hidden="true">↑</span></a>
                  </div>
                ) : (
                  <>
                    {center && nearby.length > 0 && (
                      <NearbyDiagram center={center.position} nearby={nearby} />
                    )}
                    {loading && <p class="loading-state" role="status">正在讀取兩張官方地圖資料…</p>}
                    {visibleStores.length > 0 ? (
                      <>
                        <p class="result-count">
                          此清單 {visibleStores.length} 間地圖回傳的店
                          {errorCount > 0 && "・部分地圖讀取失敗，結果不完整"}
                        </p>
                        <div class="store-list">
                          {visibleStores.map(({ store, distance }) => (
                            <StoreCard
                              key={store.code}
                              store={store}
                              isFavorite={favorites.some((favorite) => favorite.code === store.code)}
                              distance={distance}
                              states={states}
                              favoriteView={false}
                              onAdd={addFavorite}
                              onShowImage={showImage}
                            />
                          ))}
                        </div>
                      </>
                    ) : !loading ? (
                      <div class="empty-state">
                        <h3>
                          {errorCount > 0
                            ? "部分地圖資料暫時無法確認"
                            : hasSearch
                              ? "目前沒有符合搜尋的地圖資料"
                              : "目前未找到可列出的附近商品"}
                        </h3>
                        <p>
                          {errorCount === 2
                            ? "兩張地圖都無法讀取；請稍後重新查詢或前往官方地圖。"
                            : errorCount === 1
                              ? "可讀取的地圖未回傳符合條件的附近店家；另一張地圖讀取失敗，結果不完整。"
                              : hasSearch
                                ? "僅搜尋本次兩張地圖回傳的店；未回傳不代表店家缺貨。可清除搜尋、更換區域或輸入店代碼收藏。"
                                : postalCode
                                  ? "兩張地圖目前未回傳此郵遞區號的店家商品資料；不代表店家缺貨。"
                                  : "兩張地圖目前未回傳此範圍的店家商品資料；不代表店家缺貨。"}
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      </main>

      <footer id="about" class="site-footer">
        <div class="container site-footer__inner">
          <div>
            <strong>關於這份地圖</strong>
            <p>
              非全家官方網站，資料來源：全家地圖。
              <a href={MAP_SOURCES.food.url} target="_blank" rel="noopener noreferrer">友善食光</a>
              {" ／ "}
              <a href={MAP_SOURCES.treasure.url} target="_blank" rel="noopener noreferrer">挖寶專區</a>。
            </p>
            <p>商品名稱、數量與資料時間以官方地圖回傳為準；資料可能延遲、不完整或暫無回應，不能作為即時庫存保證。</p>
          </div>
          <p class="site-footer__privacy">
            收藏僅存於此裝置的 localStorage。定位須由你主動同意，僅用於查詢全家地圖，不使用會員認證或第三方圖磚。
          </p>
        </div>
      </footer>
      <dialog
        ref={imageDialogRef}
        class="image-dialog"
        aria-labelledby="image-dialog-title"
        onClose={closeImage}
      >
        <div class="image-dialog__heading">
          <h2 id="image-dialog-title">商品圖片</h2>
          <button
            type="button"
            aria-label="關閉商品圖片視窗"
            onClick={() => imageDialogRef.current?.close()}
          >
            關閉
          </button>
        </div>
        {imagePreview && (
          <>
            <p class="image-dialog__name">{imagePreview.name}</p>
            {imagePreview.status === "loading" ? (
              <p class="muted" role="status">正在向官方查詢圖片…</p>
            ) : imagePreview.status === "error" ? (
              <p class="inline-alert" role="alert">{imagePreview.message}</p>
            ) : (
              <>
                {!imageLoaded && <p class="muted" role="status">正在載入官方圖片…</p>}
                <img
                  src={imagePreview.url}
                  alt={`${imagePreview.name} 的商品圖片`}
                  referrerPolicy="no-referrer"
                  onLoad={() => setImageLoaded(true)}
                  onError={() =>
                    setImagePreview((current) =>
                      current?.status === "ready"
                        ? {
                            name: current.name,
                            status: "error",
                            message: "官方圖片連結無法載入；請至官方地圖查看。",
                          }
                        : current
                    )
                  }
                />
              </>
            )}
            <p class="image-dialog__note">
              圖片由官方商品圖片服務提供；不代表即時庫存或實際優惠。
            </p>
          </>
        )}
      </dialog>
      {showBackToTop && (
        <a class="back-to-top" href="#top" aria-label="返回頁首">
          <span class="back-to-top__arrow" aria-hidden="true">↑</span>
          <span class="back-to-top__text">返回頁首</span>
        </a>
      )}
    </>
  );
}
