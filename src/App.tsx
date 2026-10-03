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
  DirectoryClient,
  DirectoryError,
  isDirectoryStale,
  matchesDirectoryStore,
  type DirectoryDataClient,
  type DirectoryStore,
  type StoreDirectory,
} from "./directory";
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
  formatOriginalPrice,
  parseOriginalPrice,
  PriceNoteStorageError,
  PriceNoteValidationError,
  readPriceNotes,
  removePriceNote,
  upsertPriceNote,
  writePriceNotes,
  type PriceNote,
} from "./price-notes";
import {
  findReceiptPrice,
  RECEIPT_PRICE_REFERENCES,
  RECEIPT_REFERENCE_DATE,
} from "./receipt-prices";
import {
  distanceMeters,
  formatDistance,
  getNearby,
  matchesStore,
  mergeStores,
  NEARBY_RADIUS_METERS,
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

type DirectoryLoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; directory: StoreDirectory }
  | { status: "error"; message: string };

type Page = "home" | "nearby" | "favorites" | "receipt-prices" | "price-notes" | "about";

function pageFromHash(hash: string, current: Page = "home"): Page {
  switch (hash) {
    case "#nearby":
    case "#location":
      return "nearby";
    case "#favorites":
    case "#manage-favorites":
      return "favorites";
    case "#receipt-prices":
    case "#price-notes":
    case "#about":
      return hash.slice(1) as Page;
    case "#top":
    case "#main-content":
      return current;
    default:
      return "home";
  }
}

function namesAgree(first: string, second: string): boolean {
  return first.normalize("NFKC").replace(/\s+/g, "") ===
    second.normalize("NFKC").replace(/\s+/g, "");
}

const IDENTITY_ERROR = "商品地圖回傳的店代碼、店名或座標與店舖目錄／既有分店資訊不符，已停止顯示這間店的商品；請至官方地圖核對。";

interface SearchCenter {
  position: Coordinates;
  label: string;
}

interface AppProps {
  client?: MapDataClient;
  directoryClient?: DirectoryDataClient;
  imageClient?: ProductImageClient;
  geolocation?: GeolocationClient | null;
  storage?: Storage | null;
}

const defaultClient = new MapClient();
const defaultDirectoryClient = new DirectoryClient();
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

function initialPriceNotes(storageOverride: Storage | null | undefined): {
  notes: PriceNote[];
  storage: Storage | null;
  warning: string | null;
} {
  try {
    const storage = storageOverride === undefined ? window.localStorage : storageOverride;
    if (!storage) {
      throw new PriceNoteStorageError("無法使用裝置儲存空間；本次個人原價紀錄僅保留在目前頁面。");
    }
    return { notes: readPriceNotes(storage), storage, warning: null };
  } catch (error) {
    return {
      notes: [],
      storage: null,
      warning:
        error instanceof Error
          ? error.message
          : "無法讀取裝置中的個人原價紀錄；本次紀錄僅保留在目前頁面。",
    };
  }
}

interface PriceNoteActions {
  byCode: ReadonlyMap<string, PriceNote>;
  storageWarning: string | null;
  save: (note: PriceNote) => void;
  clear: (code: string) => void;
}

function PriceNoteControls({
  code,
  name,
  id,
  manager = false,
  priceNotes,
}: {
  code: string;
  name: string;
  id: string;
  manager?: boolean;
  priceNotes: PriceNoteActions;
}) {
  const note = priceNotes.byCode.get(code);
  const [priceText, setPriceText] = useState(note ? String(note.priceCents / 100) : "");
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editing, setEditing] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const focusAfterAction = useRef<"edit" | "input" | null>(null);

  useLayoutEffect(() => {
    if (confirmClear) cancelClearRef.current?.focus();
  }, [confirmClear]);

  useLayoutEffect(() => {
    if (focusAfterAction.current === "edit") editRef.current?.focus();
    if (focusAfterAction.current === "input") inputRef.current?.focus();
    focusAfterAction.current = null;
  });

  function savePrice(event: Event) {
    event.preventDefault();
    try {
      priceNotes.save({ code, name, priceCents: parseOriginalPrice(priceText) });
      setError(null);
      if (manager) {
        if (detailsRef.current) detailsRef.current.open = false;
        summaryRef.current?.focus();
      } else {
        focusAfterAction.current = "edit";
        setEditing(false);
      }
    } catch (cause) {
      if (!(cause instanceof PriceNoteValidationError)) {
        console.error("Unexpected personal price note error", cause);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "無法更新個人原價紀錄；請稍後重試。",
      );
      inputRef.current?.focus();
    }
  }

  function clearPrice() {
    try {
      priceNotes.clear(code);
      setConfirmClear(false);
      if (manager) {
        document.getElementById("price-notes-title")?.focus();
        if (detailsRef.current) detailsRef.current.open = false;
      } else {
        focusAfterAction.current = "input";
        setEditing(false);
      }
    } catch (cause) {
      if (!(cause instanceof PriceNoteValidationError)) {
        console.error("Unexpected personal price note error", cause);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "無法清除個人原價紀錄；請稍後重試。",
      );
    }
  }

  const inputId = `price-input-${id}`;
  const hintId = `price-hint-${id}`;
  const errorId = `price-error-${id}`;

  const content = (
    <div class="price-note-controls__content">
      {manager && <p>{name}・商品代碼 {code}</p>}
      <form onSubmit={savePrice} noValidate>
        <label for={inputId}>
          {manager ? "商品原價（折扣前，NT$）" : "使用者自行輸入原價（折扣前，非官方，NT$）"}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={priceText}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
          aria-invalid={error ? "true" : undefined}
          onInput={(event) => {
            setPriceText(event.currentTarget.value);
            setError(null);
          }}
        />
        <p id={hintId} class="field-hint">
          僅記自己確認的原價，非官方定價。例：39 或 39.50；限 0.01～99,999.99。
        </p>
        {error && <p id={errorId} class="inline-alert" role="alert">{error}</p>}
        <div class="price-note-controls__actions">
          <button type="submit">儲存原價</button>
          {(manager || note) && (
            <button
              type="button"
              onClick={() => {
                setConfirmClear(false);
                setError(null);
                if (manager) {
                  if (detailsRef.current) detailsRef.current.open = false;
                  summaryRef.current?.focus();
                } else {
                  focusAfterAction.current = "edit";
                  setEditing(false);
                }
              }}
            >
              取消
            </button>
          )}
          {note && !confirmClear && (
            <button type="button" onClick={() => setConfirmClear(true)}>清除紀錄…</button>
          )}
        </div>
      </form>
      {confirmClear && (
        <div class="price-note-controls__confirm" role="group" aria-label={`確認清除${name}的個人原價`}>
          <p>確定清除「{name}」（商品代碼 {code}）的個人原價紀錄？</p>
          <div class="price-note-controls__actions">
            <button type="button" ref={cancelClearRef} onClick={() => setConfirmClear(false)}>
              取消清除
            </button>
            <button type="button" onClick={clearPrice}>確認清除原價</button>
          </div>
        </div>
      )}
      {manager && priceNotes.storageWarning && (
        <p class="inline-alert" role="alert">{priceNotes.storageWarning}</p>
      )}
    </div>
  );

  if (!manager) {
    return (
      <div class="price-note-controls price-note-controls--inline">
        {note ? (
          <>
            <p class="product-list__price">
              使用者自行輸入原價／非官方：<strong>{formatOriginalPrice(note.priceCents)}</strong>
            </p>
            {!editing && (
              <button
                type="button"
                class="price-note-controls__edit"
                ref={editRef}
                onClick={() => {
                  setPriceText(String(note.priceCents / 100));
                  setError(null);
                  setEditing(true);
                }}
              >
                修改個人原價
              </button>
            )}
          </>
        ) : (
          <p class="product-list__unrecorded">尚未記錄個人原價。</p>
        )}
        {(!note || editing) && content}
        {priceNotes.storageWarning && (
          <p class="inline-alert" role="alert">{priceNotes.storageWarning}</p>
        )}
      </div>
    );
  }

  return (
    <details
      ref={detailsRef}
      class="price-note-controls"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setPriceText(note ? String(note.priceCents / 100) : "");
          setError(null);
        } else {
          setConfirmClear(false);
        }
      }}
    >
      <summary ref={summaryRef}>
        {note ? "修改或清除個人原價" : "記錄個人原價"}
      </summary>
      {content}
    </details>
  );
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
  editorScope,
  priceNotes,
  onShowImage,
}: {
  source: MapSource;
  data: SourceProducts | undefined;
  state: LoadState;
  treasureFilters?: TreasureFilters;
  editorScope: string;
  priceNotes: PriceNoteActions;
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
          {source === "treasure" && data.products.length > 0 && (
            <p class="product-panel__discount-note">
              折數依使用者規則估算，非官方折扣或結帳價；不以個人原價計算實付金額。
            </p>
          )}
          {visibleProducts.some((product) => findReceiptPrice(source, product.code)) && (
            <p class="product-panel__receipt-note">
              收據參考價來自使用者提供的 {RECEIPT_REFERENCE_DATE} 收據；該筆五折推算逐件以
              .5 元進位，不是官方定價，也不保證現在或未來的售價／優惠。
            </p>
          )}
          {visibleProducts.length > 0 ? (
            <ul class="product-list">
              {visibleProducts.map((product, index) => {
                const classification =
                  source === "treasure"
                    ? classifyTreasureProduct(product)
                    : null;
                const imageCode = product.code;
                const reference = findReceiptPrice(source, imageCode);
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
                                  : `估算${classification.discount}`}
                              </span>
                            </>
                          )}
                          <span class="product-list__tag">
                            {classification.saving ? "惜-開頭" : "非惜-開頭"}
                          </span>
                        </span>
                      )}
                      <small>{product.category}</small>
                      {imageCode ? (
                        <small>商品代碼 {imageCode}</small>
                      ) : (
                        <small>未提供商品代碼，無法紀錄原價。</small>
                      )}
                      {imageCode && (
                        <div class="product-list__prices">
                          {reference && (
                            <div class="product-list__receipt-price">
                              <p>收據原價：<strong>{formatOriginalPrice(reference.originalCents)}</strong></p>
                              <p>該筆五折推算：<strong>{formatOriginalPrice(reference.halfPriceCents)}</strong></p>
                              <small>{reference.source}資料來源：{reference.receiptDate}</small>
                            </div>
                          )}
                          <PriceNoteControls
                            key={`${editorScope}-${source}-${index}-${imageCode}`}
                            id={`${editorScope}-${source}-${index}-${imageCode}`}
                            code={imageCode}
                            name={product.name}
                            priceNotes={priceNotes}
                          />
                        </div>
                      )}
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
  priceNotes,
  onAdd,
  onShowImage,
}: {
  store: MergedStore;
  isFavorite: boolean;
  distance?: number;
  states: Record<MapSource, LoadState>;
  favoriteView: boolean;
  treasureFilters?: TreasureFilters;
  priceNotes: PriceNoteActions;
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
      editorScope={`${favoriteView ? "favorite" : "nearby"}-${store.code}`}
      priceNotes={priceNotes}
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
  const pixelsPerMeter = 124 / NEARBY_RADIUS_METERS;
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
                : store.sources.treasure
                  ? "treasure"
                  : "directory";
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
        <span>中心為查詢座標・外圈約 3 公里</span>
        <small>不載入第三方地圖圖磚；店家與商品請以清單為準。</small>
      </figcaption>
    </figure>
  );
}

function NearbyRow({
  store,
  distance,
  isFavorite,
  states,
  priceNotes,
  onAdd,
  onExpand,
  onShowImage,
}: {
  store: MergedStore;
  distance?: number;
  isFavorite: boolean;
  states: Record<MapSource, LoadState>;
  priceNotes: PriceNoteActions;
  onAdd: (store: MergedStore) => void;
  onExpand: (store: MergedStore, retry?: boolean) => void;
  onShowImage: (code: string, name: string, opener: HTMLButtonElement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failed = SOURCE_IDS.some((source) => states[source].status === "error");

  return (
    <article class="nearby-row">
      <div class="nearby-row__head">
        <div class="nearby-row__identity">
          <h3>{store.name}</h3>
          <small>{store.address || "地址未提供"}・商品地圖店代碼 {store.code}</small>
        </div>
        <div class="nearby-row__actions">
          {distance !== undefined && (
            <span class="nearby-row__distance" aria-label={`距查詢中心 ${(distance / 1_000).toFixed(2)} 公里`}>
              {(distance / 1_000).toFixed(2)} km
            </span>
          )}
          {isFavorite ? (
            <span class="favorite-button favorite-button--active" aria-label={`${store.name}已收藏`}>已收藏</span>
          ) : (
            <button
              type="button"
              class="favorite-button"
              aria-label={`加入收藏：${store.name}`}
              onClick={() => onAdd(store)}
            >
              +收藏
            </button>
          )}
        </div>
      </div>
      <details
        class="nearby-row__details"
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setExpanded(open);
          if (open) onExpand(store);
        }}
      >
        <summary>{expanded ? "收合商品" : "查看商品（按需查詢）"}</summary>
        {expanded && (
          <>
            {failed && (
              <button type="button" class="nearby-row__retry" onClick={() => onExpand(store, true)}>
                重試商品查詢
              </button>
            )}
            <div class="store-card__badges">
              {SOURCE_IDS.map((source) => (
                <SourceBadge key={source} source={source} data={store.sources[source]} state={states[source]} />
              ))}
            </div>
            <div class="store-card__panels">
              {SOURCE_IDS.map((source) => (
                <SourceDetails
                  key={source}
                  source={source}
                  data={store.sources[source]}
                  state={states[source]}
                  editorScope={`nearby-${store.code}`}
                  priceNotes={priceNotes}
                  onShowImage={onShowImage}
                />
              ))}
            </div>
          </>
        )}
      </details>
    </article>
  );
}

export function App({
  client = defaultClient,
  directoryClient = defaultDirectoryClient,
  imageClient = defaultImageClient,
  geolocation,
  storage,
}: AppProps) {
  const [saved] = useState(() => initialFavorites(storage));
  const [savedPrices] = useState(() => initialPriceNotes(storage));
  const storageRef = useRef<Storage | null>(saved.storage);
  const priceStorageRef = useRef<Storage | null>(savedPrices.storage);
  const [favorites, setFavorites] = useState<Favorite[]>(saved.favorites);
  const [storageWarning, setStorageWarning] = useState<string | null>(saved.warning);
  const [priceNotes, setPriceNotes] = useState<PriceNote[]>(savedPrices.notes);
  const [priceStorageWarning, setPriceStorageWarning] = useState<string | null>(savedPrices.warning);
  const [priceActionMessage, setPriceActionMessage] = useState<string | null>(null);
  const priceNotesByCode = useMemo(
    () => new Map(priceNotes.map((note) => [note.code, note])),
    [priceNotes],
  );
  const [navigation, setNavigation] = useState(() => ({
    page: pageFromHash(window.location.hash),
    hash: window.location.hash,
  }));
  const activePage = navigation.page;
  const [directoryState, setDirectoryState] = useState<DirectoryLoadState>({ status: "idle" });
  const [lookups, setLookups] = useState<Record<string, Record<MapSource, LoadState>>>({});
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
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [postalInput, setPostalInput] = useState("");
  const [postalError, setPostalError] = useState<string | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
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
  const pendingLookups = useRef(new Set<string>());
  const lookupVersions = useRef(new Map<string, number>());
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

  function requestDirectory() {
    if (directoryState.status === "ready") return;
    setDirectoryState({ status: "loading" });
    void directoryClient.load()
      .then((directory) => setDirectoryState({ status: "ready", directory }))
      .catch((error: unknown) => {
        if (!(error instanceof DirectoryError)) console.error("Unexpected store directory error", error);
        setDirectoryState({
          status: "error",
          message: error instanceof DirectoryError
            ? error.message
            : "讀取店舖目錄時發生未預期錯誤；3 公里名單暫時無法確認。",
        });
      });
  }

  useEffect(() => {
    const syncHash = () => setNavigation((current) => ({
      page: pageFromHash(window.location.hash, current.page),
      hash: window.location.hash,
    }));
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useLayoutEffect(() => {
    if (!navigation.hash) return;
    const id = navigation.hash === "#manage-favorites"
      ? "manage-favorites-title"
      : navigation.hash === "#location"
        ? "location-title"
        : navigation.hash === "#nearby"
          ? "nearby-page-title"
        : navigation.hash === "#top"
          ? "top"
          : navigation.hash === "#main-content"
            ? "main-content"
            : `${activePage}-title`;
    const target = document.getElementById(id);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [activePage, navigation.hash]);

  useEffect(() => {
    if (center) requestDirectory();
  }, [directoryClient, center?.position.latitude, center?.position.longitude]);

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

  const catalogByCode = useMemo(
    () => new Map(
      directoryState.status === "ready"
        ? directoryState.directory.stores.map((store) => [store.code, store] as const)
        : [],
    ),
    [directoryState],
  );

  const verifiedMap = useMemo(() => {
    const primary: Partial<Record<MapSource, OfficialStore[]>> = {};
    const saved: Partial<Record<MapSource, OfficialStore[]>> = {};
    const mismatched: Record<MapSource, Set<string>> = {
      food: new Set(), treasure: new Set(),
    };
    const known = new Map<string, OfficialStore>();
    const favoritesByCode = new Map(favorites.map((favorite) => [favorite.code, favorite]));

    function verified(row: OfficialStore, source: MapSource): boolean {
      const catalog = catalogByCode.get(row.oldPKey);
      const favorite = favoritesByCode.get(row.oldPKey);
      const previous = known.get(row.oldPKey);
      const valid = catalog
        ? matchesDirectoryStore(catalog, row)
        : (!favorite || favorite.name === `店代碼 ${favorite.code}` || namesAgree(favorite.name, row.name)) &&
          (!previous || (
            namesAgree(previous.name, row.name) &&
            distanceMeters(previous, row) <= 150
          ));
      if (!valid) {
        mismatched[source].add(row.oldPKey);
        return false;
      }
      known.set(row.oldPKey, row);
      return true;
    }

    for (const source of SOURCE_IDS) {
      const rows = states[source].status === "ready" ? states[source].result.stores : [];
      primary[source] = rows.filter((row) => verified(row, source));
      const favoriteRows = favoriteStates[source].status === "ready"
        ? favoriteStates[source].result.stores
        : [];
      saved[source] = favoriteRows.filter((row) => verified(row, source));
    }
    return { primary, saved, mismatched };
  }, [catalogByCode, favoriteStates, favorites, states]);

  function withDirectoryMetadata(store: MergedStore): MergedStore {
    const catalog = catalogByCode.get(store.code);
    return catalog
      ? {
          ...store,
          name: catalog.name,
          address: catalog.address,
          latitude: catalog.latitude ?? undefined,
          longitude: catalog.longitude ?? undefined,
        }
      : store;
  }

  const mapStores = useMemo(() => {
    const results: Partial<Record<MapSource, OfficialStore[]>> = {};
    for (const source of SOURCE_IDS) {
      const rows = center || postalCode
        ? verifiedMap.primary[source] ?? []
        : (verifiedMap.primary[source] ?? []).filter((row) => favoriteCodes.includes(row.oldPKey));
      const onDemand = postalCode
        ? []
        : Object.values(lookups).flatMap((entry) =>
            entry[source].status === "ready" ? entry[source].result.stores : [],
          );
      results[source] = [...new Map(
        [...onDemand, ...rows].map((row) => [row.oldPKey, row]),
      ).values()];
    }
    return mergeStores(results, postalCode ? [] : favorites).map(withDirectoryMetadata);
  }, [verifiedMap, favorites, center, postalCode, catalogByCode, lookups]);

  const savedStores = useMemo(() => {
    const codes = new Set(favorites.map((favorite) => favorite.code));
    if (!postalCode) return mapStores.filter((store) => codes.has(store.code));
    const results: Partial<Record<MapSource, OfficialStore[]>> = {};
    for (const source of SOURCE_IDS) {
      const postalRows = (verifiedMap.primary[source] ?? []).filter((row) => codes.has(row.oldPKey));
      const onDemand = Object.values(lookups).flatMap((entry) =>
        entry[source].status === "ready" ? entry[source].result.stores : [],
      );
      results[source] = [...new Map(
        [...onDemand, ...(verifiedMap.saved[source] ?? []), ...postalRows]
          .filter((row) => codes.has(row.oldPKey))
          .map((row) => [row.oldPKey, row]),
      ).values()];
    }
    return mergeStores(results, favorites).map(withDirectoryMetadata);
  }, [postalCode, mapStores, verifiedMap, favorites, catalogByCode, lookups]);

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

  function savePriceNotes(next: PriceNote[]): boolean {
    if (!priceStorageRef.current) {
      setPriceNotes(next);
      return false;
    }
    try {
      writePriceNotes(priceStorageRef.current, next);
      setPriceNotes(next);
      return true;
    } catch (error) {
      if (!(error instanceof PriceNoteStorageError)) throw error;
      priceStorageRef.current = null;
      setPriceStorageWarning(error.message);
      setPriceNotes(next);
      return false;
    }
  }

  function recordPrice(note: PriceNote) {
    const persisted = savePriceNotes(upsertPriceNote(priceNotes, note));
    setPriceActionMessage(
      `「${note.name}」（商品代碼 ${note.code}）的個人原價已${persisted ? "儲存於此裝置" : "更新於目前頁面；重新載入後不會保留這次變更"}。`,
    );
  }

  function clearPrice(code: string) {
    const note = priceNotesByCode.get(code);
    if (!note) throw new PriceNoteValidationError("此商品沒有可清除的個人原價紀錄。");
    const persisted = savePriceNotes(removePriceNote(priceNotes, code));
    setPriceActionMessage(
      `「${note.name}」（商品代碼 ${code}）的個人原價已${persisted ? "從此裝置清除" : "在目前頁面清除；重新載入後可能仍存在"}。`,
    );
  }

  const priceNoteActions: PriceNoteActions = {
    byCode: priceNotesByCode,
    storageWarning: priceStorageWarning,
    save: recordPrice,
    clear: clearPrice,
  };

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
  const searchMatches = directoryState.status === "ready" && submittedSearch
    ? directoryState.directory.stores.filter((store) => matchesStore(store, submittedSearch))
    : [];
  const readyTreasureFavorites = savedStores.filter(
    (store) => favoriteSourceState(store, "treasure").status === "ready",
  );
  const countableTreasureProducts = readyTreasureFavorites.flatMap(
    (store) => store.sources.treasure?.products ?? [],
  );
  const matchingTreasureCount =
    filterTreasureProducts(countableTreasureProducts, treasureFilters).length;
  const nearby = useMemo(() => {
    if (!center) return [];
    if (directoryState.status !== "ready") return getNearby(mapStores, center.position);
    const mapOnly = mapStores.filter((store) => !catalogByCode.has(store.code));
    const stores = directoryState.directory.stores.flatMap((catalog): MergedStore[] => {
      const { latitude, longitude } = catalog;
      if (latitude === null || longitude === null) return [];
      if (mapOnly.some((store) =>
        store.latitude !== undefined && store.longitude !== undefined &&
        namesAgree(store.name, catalog.name) &&
        distanceMeters({
          latitude,
          longitude,
        }, {
          latitude: store.latitude,
          longitude: store.longitude,
        }) <= 150,
      )) return [];
      const mapped = byCode.get(catalog.code);
      return [{
        code: catalog.code,
        name: catalog.name,
        address: catalog.address,
        latitude,
        longitude,
        sources: mapped?.sources ?? {},
      }];
    });
    stores.push(...mapOnly);
    return getNearby(stores, center.position);
  }, [center, directoryState, mapStores, catalogByCode]);
  const postalStores = postalCode
    ? [...mapStores].sort((first, second) => first.name.localeCompare(second.name, "zh-TW"))
    : [];
  const visibleStores = postalCode
    ? postalStores.map((store) => ({ store, distance: undefined }))
    : nearby.map(({ store, distanceMeters: distance }) => ({ store, distance }));
  const loading = SOURCE_IDS.some((source) => states[source].status === "loading");
  const errorCount = SOURCE_IDS.filter((source) => states[source].status === "error").length;

  function favoriteSourceState(store: MergedStore, source: MapSource): LoadState {
    if (verifiedMap.primary[source]?.some((row) => row.oldPKey === store.code)) {
      return states[source];
    }
    if (verifiedMap.saved[source]?.some((row) => row.oldPKey === store.code)) {
      return favoriteStates[source];
    }
    const onDemand = lookups[store.code]?.[source];
    if (onDemand && onDemand.status !== "idle") return onDemand;
    if (verifiedMap.mismatched[source].has(store.code)) {
      return { status: "error", message: IDENTITY_ERROR };
    }
    if (!postalCode) return states[source];
    const mapState = states[source];
    return mapState.status === "ready" &&
      mapState.result.stores.some((row) => row.oldPKey === store.code)
      ? mapState
      : favoriteStates[source];
  }

  function nearbySourceState(store: MergedStore, source: MapSource): LoadState {
    if (verifiedMap.primary[source]?.some((row) => row.oldPKey === store.code)) {
      return states[source];
    }
    const onDemand = lookups[store.code]?.[source];
    if (onDemand && onDemand.status !== "idle") return onDemand;
    return verifiedMap.mismatched[source].has(store.code)
      ? { status: "error", message: IDENTITY_ERROR }
      : states[source];
  }

  function chooseCenter(position: Coordinates, label: string) {
    locationAttempt.current += 1;
    setLocating(false);
    setLocationError(null);
    setFormError(null);
    setPostalError(null);
    setPostalCode(null);
    setPostalInput("");
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

  function choosePostalCode(event: Event) {
    event.preventDefault();
    const zip = postalInput.trim();
    if (!/^\d{3}$/.test(zip)) {
      setPostalError("請輸入三位數郵遞區號，例如 100。");
      postalInputRef.current?.focus();
      return;
    }
    locationAttempt.current += 1;
    setLocating(false);
    setLocationError(null);
    setFormError(null);
    setPostalError(null);
    setCenter(null);
    setPostalCode(zip);
  }

  function submitNameSearch(event: Event) {
    event.preventDefault();
    const term = search.trim();
    if (!term) {
      setSearchNotice("請先輸入要尋找的新分店名稱、地址或商品地圖舊店碼。");
      document.getElementById("store-search")?.focus();
      return;
    }
    setSearchNotice(null);
    setSubmittedSearch(term);
    requestDirectory();
  }

  function lookupStoreProducts(store: MergedStore, retry = false) {
    const catalog = catalogByCode.get(store.code);
    const version = lookupVersions.current.get(store.code) ?? 0;
    if (!catalog && Object.keys(store.sources).length > 0) return;
    if (catalog?.latitude === null || catalog?.longitude === null) {
      setLookups((current) => ({
        ...current,
        [store.code]: {
          food: { status: "error", message: "店舖目錄座標異常，無法核對商品地圖；請至官方地圖確認。" },
          treasure: { status: "error", message: "店舖目錄座標異常，無法核對商品地圖；請至官方地圖確認。" },
        },
      }));
      return;
    }
    for (const source of SOURCE_IDS) {
      const state = lookups[store.code]?.[source];
      const key = `${store.code}:${source}`;
      if (
        store.sources[source] || pendingLookups.current.has(key) ||
        (state && state.status !== "idle" && !(retry && state.status === "error"))
      ) continue;
      pendingLookups.current.add(key);
      setLookups((current) => ({
        ...current,
        [store.code]: { ...(current[store.code] ?? emptyStates()), [source]: { status: "loading" } },
      }));
      void client.load({
        source,
        position: FAVORITES_REFERENCE_POSITION,
        favoriteCodes: [store.code],
      }).then((result) => {
        if ((lookupVersions.current.get(store.code) ?? 0) !== version) return;
        const row = result.stores.find((candidate) => candidate.oldPKey === store.code);
        const verified = row && (catalog
          ? matchesDirectoryStore(catalog, row)
          : namesAgree(store.name, row.name) &&
            store.latitude !== undefined && store.longitude !== undefined &&
            distanceMeters({
              latitude: store.latitude,
              longitude: store.longitude,
            }, row) <= 150);
        const wrongCode = !row && result.stores.some((candidate) =>
          namesAgree(candidate.name, store.name) && candidate.oldPKey !== store.code,
        );
        setLookups((current) => ({
          ...current,
          [store.code]: {
            ...(current[store.code] ?? emptyStates()),
            [source]: row && !verified || wrongCode
              ? { status: "error", message: IDENTITY_ERROR }
              : { status: "ready", result: { ...result, stores: row ? [row] : [] } },
          },
        }));
      }).catch((error: unknown) => {
        if ((lookupVersions.current.get(store.code) ?? 0) !== version) return;
        if (!(error instanceof MapApiError)) console.error("Unexpected store product lookup error", error);
        setLookups((current) => ({
          ...current,
          [store.code]: {
            ...(current[store.code] ?? emptyStates()),
            [source]: {
              status: "error",
              message: error instanceof MapApiError
                ? error.message
                : "查詢這間店的商品時發生未預期錯誤；請稍後重試。",
            },
          },
        }));
      }).finally(() => pendingLookups.current.delete(key));
    }
  }

  function addFavorite(store: MergedStore | DirectoryStore) {
    if (favorites.some((favorite) => favorite.code === store.code)) return;
    save([
      { code: store.code, name: store.name, address: store.address },
      ...favorites,
    ]);
    if (catalogByCode.has(store.code)) {
      const mapped = byCode.get(store.code);
      if (!mapped || !Object.keys(mapped.sources).length) {
        lookupStoreProducts(mapped ?? {
          ...store,
          latitude: store.latitude ?? undefined,
          longitude: store.longitude ?? undefined,
          sources: {},
        });
      }
    }
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
    if (opener?.isConnected && !opener.closest("[hidden]")) {
      opener.focus();
    } else {
      document.getElementById(activePage === "nearby" ? "nearby-page-title" : `${activePage}-title`)?.focus();
    }
  }

  function addCode(event: Event) {
    event.preventDefault();
    const code = storeCode.trim();
    if (!STORE_CODE_PATTERN.test(code)) {
      setCodeMessage("請輸入商品地圖上的數字舊店碼（例如 018558）。");
      return;
    }
    if (favorites.some((favorite) => favorite.code === code)) {
      setCodeMessage("這間店已在收藏清單中。");
      return;
    }
    const matched = byCode.get(code) ?? catalogByCode.get(code);
    if (matched) {
      addFavorite(matched);
    } else {
      save([{ code, name: `店代碼 ${code}` }, ...favorites]);
      if (!postalCode) setLookupToken((previous) => previous + 1);
    }
    setStoreCode("");
    setCodeMessage(
      matched
        ? "已加入收藏。"
        : "已保留這個商品地圖舊店碼並查詢官方地圖；若地圖暫無資料，收藏仍會保留。",
    );
  }

  function refresh() {
    const now = Date.now();
    if (now - lastManualRefresh.current < REFRESH_INTERVAL_MS) {
      setRefreshMessage("請至少間隔 1 分鐘再手動重新查詢，以減少對官方服務的請求。");
      return;
    }
    lastManualRefresh.current = now;
    for (const favorite of favorites) {
      lookupVersions.current.set(favorite.code, (lookupVersions.current.get(favorite.code) ?? 0) + 1);
    }
    const favoriteCodes = new Set(favorites.map((favorite) => favorite.code));
    setLookups((current) => Object.fromEntries(
      Object.entries(current).filter(([code]) => !favoriteCodes.has(code)),
    ));
    setRefreshMessage("正在重新查詢兩張官方地圖…");
    setRefreshToken((previous) => previous + 1);
  }

  return (
    <>
      <header id="top" class="site-header" tabIndex={-1}>
        <div class="container site-header__inner">
          <a class="brand" href="#home" aria-label="全家附近好物，回首頁">
            <span class="brand__mark" aria-hidden="true"><span /></span>
            <span>附近好物<span class="brand__suffix"> / FAMILY STORE MAP</span></span>
            <span class="brand__disclaimer">非官方</span>
          </a>
          <nav aria-label="分頁導覽">
            <a href="#nearby" aria-current={activePage === "nearby" ? "page" : undefined}>附近店家</a>
            <a href="#favorites" aria-current={activePage === "favorites" ? "page" : undefined}>收藏店家</a>
            <a href="#receipt-prices" aria-current={activePage === "receipt-prices" ? "page" : undefined}>收據參考</a>
            <a href="#price-notes" aria-current={activePage === "price-notes" ? "page" : undefined}>原價紀錄</a>
            <a href="#about" aria-current={activePage === "about" ? "page" : undefined}>資料說明</a>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section id="home" class="hero" hidden={activePage !== "home"}>
          <div class="container hero__inner">
            <div>
              <span class="eyebrow">兩張地圖，一眼看懂</span>
              <h1 id="home-title" tabIndex={-1}>常去的全家，<br /><em>好物不錯過。</em></h1>
              <p>收藏分店，快速查看「友善食光」與「挖寶專區」回傳的商品；也能查看 3 公里內的全家店舖清單。</p>
              <div class="hero__actions">
                <a class="hero__link" href="#nearby">開始找附近 <span aria-hidden="true">↗</span></a>
                <a class="hero__link hero__link--secondary" href="#favorites">
                  開始找收藏店家 <span aria-hidden="true">↗</span>
                </a>
              </div>
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
          {activePage === "nearby" && (
            <div class="page-heading">
              <div class="section-label"><span>⌖</span> 店舖目錄與官方商品地圖</div>
              <h2 id="nearby-page-title" tabIndex={-1}>附近店家</h2>
              <p>選擇位置後列出 3 公里內分店，依距離排序；商品須展開才按需查詢，資料可能缺漏。</p>
              <a href="#home">回首頁</a>
            </div>
          )}
          <div
            class="source-grid"
            aria-label="官方商品地圖資料狀態"
            hidden={activePage !== "home"}
          >
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
          <p class="source-note" hidden={activePage !== "home"}>
            兩張地圖僅提供查詢時回傳的商品，不是 3 公里完整商品庫存；未回傳不等於缺貨。
          </p>
          <section class="home-intro" aria-labelledby="home-intro-title" hidden={activePage !== "home"}>
            <h2 id="home-intro-title">怎麼使用附近好物？</h2>
            <div class="home-intro__cards">
              <div>
                <h3>附近店家</h3>
                <p>同意定位、選地區中心或輸入座標，查看 3 公里內店名、距離並直接收藏；不需定位也可查郵遞區號的地圖結果。</p>
              </div>
              <div>
                <h3>收藏店家</h3>
                <p>搜尋全臺官方店舖目錄新增收藏，或直接輸入商品地圖店代碼；可篩選收藏店的挖寶商品，移除時需要再次確認。</p>
              </div>
              <div>
                <h3>價格與資料說明</h3>
                <p>收據參考價不是官方定價；個人原價與收藏只存於本機。店舖目錄為公開快照，商品與圖片依官方地圖按需查詢。</p>
              </div>
            </div>
            <p>本站非全家官方網站，店舖快照與商品地圖可能延遲或缺漏；實際販售請以官方與現場為準。</p>
          </section>
          {activePage !== "home" && activePage !== "nearby" && (
            <div class="page-context">
              <span>目前分頁：{{
                favorites: "收藏店家",
                "receipt-prices": "收據參考",
                "price-notes": "原價紀錄",
                about: "資料說明",
              }[activePage]}</span>
              <a href="#home">回首頁</a>
            </div>
          )}

          <div class={`page-grid page-grid--${activePage}`} hidden={activePage === "home"}>
            <aside class="controls" aria-label="附近位置選擇" hidden={activePage !== "nearby"}>
              <section id="location" class="control-panel">
                <div class="section-label"><span>01</span> 選擇查詢位置</div>
                <h2 id="location-title" tabIndex={-1}>你想從哪裡找？</h2>
                <p class="muted">以選定位置為中心列出 3 公里內的店舖，商品資料另向地圖查詢。</p>
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
                <p class="field-hint">以標示地點為中心計算 3 公里，非整個行政區。</p>

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

              <section class="control-panel control-panel--postal">
                <div class="section-label"><span>02</span> 郵遞區號備用查詢</div>
                <h2>不提供位置也能找</h2>
                <p class="muted">三位數郵碼只查官方商品地圖的該區結果，並非完整店舖名錄或 3 公里範圍。</p>
                <form onSubmit={choosePostalCode}>
                  <label for="postal-code">三位數郵遞區號</label>
                  <input
                    id="postal-code"
                    ref={postalInputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="例如：100"
                    value={postalInput}
                    onInput={(event) => {
                      setPostalInput(event.currentTarget.value);
                      setPostalError(null);
                    }}
                  />
                  <button class="secondary-button" type="submit">查詢此郵遞區號</button>
                </form>
                {postalError && <p class="inline-alert" role="alert">{postalError}</p>}
                <a
                  class="store-directory-link"
                  href="https://www.family.com.tw/Marketing/zh/Map"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看全家官方店舖查詢 <span aria-hidden="true">↗</span>
                </a>
                {postalCode && (
                  <div class="current-center">
                    <span>查詢郵遞區號：<strong>{postalCode}</strong></span>
                    <button
                      type="button"
                      onClick={() => {
                        setPostalCode(null);
                        setPostalInput("");
                      }}
                    >
                      清除此區域
                    </button>
                  </div>
                )}
              </section>
            </aside>

            <div class="results">
              <section
                id="favorites"
                class="result-section"
                aria-labelledby="favorites-title"
                hidden={activePage !== "favorites"}
              >
                <div class="result-section__heading">
                  <div>
                    <div class="section-label"><span>★</span> 快速查看</div>
                    <h2 id="favorites-title" tabIndex={-1}>收藏店家・我的收藏 <span>{favorites.length}</span></h2>
                  </div>
                  {favorites.length > 0 && (
                    <a class="manage-favorites-link" href="#manage-favorites">管理收藏 <span aria-hidden="true">→</span></a>
                  )}
                </div>
                {storageWarning && <p class="inline-alert" role="alert">{storageWarning}</p>}
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
                    折數自動估算顯示於挖寶商品，非官方折扣或實際結帳價。
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
                ) : (
                  <div class="store-list">
                    {savedStores.map((store) => (
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
                        priceNotes={priceNoteActions}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section
                class="control-panel control-panel--search"
                aria-labelledby="new-store-title"
                hidden={activePage !== "favorites"}
              >
                <div class="section-label"><span>＋</span> 店名搜尋・新增收藏</div>
                <h2 id="new-store-title">找新的全家分店</h2>
                <p class="muted">從官方店舖目錄快照搜尋全臺分店並按「+收藏」；這不會過濾我的收藏、附近店家或商品。</p>
                <form class="name-search" onSubmit={submitNameSearch}>
                  <label for="store-search">搜尋店名、地址或商品地圖舊店碼</label>
                  <div class="name-search__row">
                    <input
                      id="store-search"
                      type="search"
                      placeholder="例如：龍潭大草坪"
                      value={search}
                      onInput={(event) => {
                        setSearch(event.currentTarget.value);
                        setSubmittedSearch("");
                        setSearchNotice(null);
                      }}
                    />
                    <button type="submit">搜尋新分店</button>
                  </div>
                  <p class="field-hint">
                    不須定位或郵遞區號；目錄店碼與商品地圖舊店碼不同，加入時會使用已核對的舊店碼。
                  </p>
                </form>
                {searchNotice && (
                  <p class="inline-alert" role="alert">{searchNotice}</p>
                )}
                {directoryState.status === "ready" && (
                  <p class="directory-meta">
                    官方店舖目錄快照：{timeLabel(directoryState.directory.updatedAt)}・
                    共 {directoryState.directory.stores.length} 間。
                    {directoryState.directory.unlocatedCount > 0 &&
                      `其中 ${directoryState.directory.unlocatedCount} 間座標異常，不列入附近距離計算。`}
                    {" "}快照可能延遲／缺漏，不等於商品庫存。
                  </p>
                )}
                {directoryState.status === "error" && (
                  <p class="inline-alert" role="alert">{directoryState.message} 請重新搜尋，或直接輸入已知舊店碼。</p>
                )}
                {submittedSearch && (
                  <div class="search-preview" aria-labelledby="search-results-title">
                    <h3 id="search-results-title">新分店搜尋結果</h3>
                    <p role="status">
                      {directoryState.status === "loading"
                        ? "正在載入全臺店舖目錄快照…"
                        : directoryState.status === "error"
                          ? "店舖目錄讀取失敗，無法確認搜尋結果。"
                          : directoryState.status === "ready"
                            ? searchMatches.length > 0
                              ? `找到 ${searchMatches.length} 間分店${searchMatches.length > 30 ? "；先顯示前 30 間，請縮小搜尋條件" : ""}。`
                              : "目錄快照沒有符合的店；可能延遲或缺漏，請至官方店舖查詢核對。"
                            : "尚未查詢。"}
                    </p>
                    {directoryState.status === "ready" && searchMatches.length > 0 && (
                      <ul>
                        {searchMatches.slice(0, 30).map((store) => (
                          <li key={store.code}>
                            <div>
                              <strong>{store.name}</strong>
                              <small>{store.address}・商品地圖店代碼 {store.code}</small>
                              {store.latitude === null && <small>目錄座標異常，無法核對商品。</small>}
                            </div>
                            {favorites.some((favorite) => favorite.code === store.code) ? (
                              <span class="search-preview__saved" aria-label={`${store.name}已收藏`}>已收藏</span>
                            ) : (
                              <button
                                type="button"
                                aria-label={`加入收藏：${store.name}`}
                                onClick={() => addFavorite(store)}
                              >
                                +收藏
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <form class="code-form" onSubmit={addCode}>
                  <label for="store-code">已知商品地圖舊店碼？直接收藏</label>
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
                  <p class="field-hint">即使地圖暫未回傳商品，店代碼仍會保留在此裝置；請勿輸入目錄的新店碼。</p>
                  {codeMessage && <p class="form-message" role="status">{codeMessage}</p>}
                </form>
              </section>

              <section
                id="manage-favorites"
                class="result-section"
                aria-labelledby="manage-favorites-title"
                hidden={activePage !== "favorites"}
              >
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

              <section
                id="receipt-prices"
                class="result-section"
                aria-labelledby="receipt-prices-title"
                hidden={activePage !== "receipt-prices"}
              >
                <div class="result-section__heading">
                  <div>
                    <div class="section-label"><span>NT$</span> 公開內建・所有訪客可見</div>
                    <h2 id="receipt-prices-title" tabIndex={-1}>
                      收據參考價 <span>{Object.keys(RECEIPT_PRICE_REFERENCES).length}</span>
                    </h2>
                    <p>
                      使用者提供的 {RECEIPT_REFERENCE_DATE} 收據：原價是當時標示單價，折後價是該筆
                      逐件五折並將 .5 元進位的推算；非官方定價，不保證現在或未來售價／優惠。
                      僅按官方商品代碼對照挖寶明細；個人原價紀錄不受影響，仍只存在本機。
                    </p>
                  </div>
                </div>
                <details class="price-list-details">
                  <summary>
                    <span class="price-list-details__expand">
                      展開收據參考價清單（{Object.keys(RECEIPT_PRICE_REFERENCES).length} 筆）
                    </span>
                    <span class="price-list-details__collapse">
                      收合收據參考價清單（{Object.keys(RECEIPT_PRICE_REFERENCES).length} 筆）
                    </span>
                  </summary>
                  <ul class="receipt-price-list">
                    {Object.entries(RECEIPT_PRICE_REFERENCES)
                      .sort(([first], [second]) => first.localeCompare(second))
                      .map(([code, reference]) => (
                        <li key={code}>
                          <strong>{reference.name}</strong>
                          <small>商品代碼 {code}</small>
                          <p>收據原價：<strong>{formatOriginalPrice(reference.originalCents)}</strong></p>
                          <p>該筆五折推算：<strong>{formatOriginalPrice(reference.halfPriceCents)}</strong></p>
                        </li>
                      ))}
                  </ul>
                </details>
              </section>

              <section
                id="price-notes"
                class="result-section"
                aria-labelledby="price-notes-title"
                hidden={activePage !== "price-notes"}
              >
                <div class="result-section__heading">
                  <div>
                    <div class="section-label"><span>NT$</span> 只存在本機</div>
                    <h2 id="price-notes-title" tabIndex={-1}>
                      個人原價紀錄 <span>{priceNotes.length}</span>
                    </h2>
                    <p>
                      商品原價（折扣前）只由你輸入，以商品代碼跨分店共用；
                      與公開的收據參考價分開，非官方定價、不送往 API，換裝置不會同步。
                    </p>
                  </div>
                </div>
                {priceStorageWarning && <p class="inline-alert" role="alert">{priceStorageWarning}</p>}
                {priceActionMessage && <p class="form-message" role="status">{priceActionMessage}</p>}
                <details class="price-list-details">
                  <summary>
                    <span class="price-list-details__expand">
                      展開個人原價紀錄清單（{priceNotes.length} 筆）
                    </span>
                    <span class="price-list-details__collapse">
                      收合個人原價紀錄清單（{priceNotes.length} 筆）
                    </span>
                  </summary>
                  {priceNotes.length > 0 ? (
                    <ul class="price-manager">
                      {priceNotes.map((note) => (
                        <li key={note.code}>
                          <div class="price-manager__identity">
                            <strong>{note.name}</strong>
                            <small>商品代碼 {note.code}</small>
                            <span>個人紀錄原價／非官方：{formatOriginalPrice(note.priceCents)}</span>
                          </div>
                          <PriceNoteControls
                            id={`manager-${note.code}`}
                            code={note.code}
                            name={note.name}
                            manager
                            priceNotes={priceNoteActions}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div class="empty-state">
                      <h3>尚無個人原價紀錄</h3>
                      <p>
                        展開收藏或附近分店的商品，在有商品代碼的品項價錢區塊輸入並儲存原價；
                        未提供代碼的品項不會依名稱混記。
                      </p>
                    </div>
                  )}
                </details>
              </section>

              <section
                id="nearby"
                class="result-section"
                aria-labelledby="nearby-title"
                hidden={activePage !== "nearby"}
              >
                <div class="result-section__heading">
                  <div>
                    <div class="section-label">
                      <span>{postalCode ? "⌕" : "⌖"}</span>
                      {postalCode ? "郵遞區號地圖結果" : "3 公里店舖清單"}
                    </div>
                    <h2 id="nearby-title" tabIndex={-1}>{postalCode ? "分店搜尋結果" : "依距離排序的店家"}</h2>
                    <p>
                      {postalCode
                        ? `郵遞區號 ${postalCode}・依店名排序・僅含商品地圖回傳的店，不是完整店舖名錄`
                        : center
                          ? `${center.label}周邊 3 公里・依距離排序・+收藏或展開按需查詢商品`
                          : "先使用目前位置，或選擇地區／輸入座標；也可用郵遞區號搜尋。"}
                    </p>
                  </div>
                  {(center || postalCode) && (
                    <button
                      type="button"
                      class="refresh-button"
                      disabled={loading}
                      onClick={refresh}
                    >
                      <span aria-hidden="true">↻</span> 重新查詢商品地圖
                    </button>
                  )}
                </div>
                <div class="source-grid source-grid--nearby" aria-label="本次商品地圖查詢狀態">
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
                  商品地圖與店舖目錄不同；地圖未回傳商品不等於缺貨，店舖清單也不是即時庫存。
                </p>
                {refreshMessage && <p class="refresh-message" role="status">{refreshMessage}</p>}
                {center && directoryState.status === "loading" && (
                  <p class="loading-state" role="status">
                    正在載入全臺店舖目錄快照；目前地圖若有結果也僅為部分店家，不是 3 公里完整名單。
                  </p>
                )}
                {center && directoryState.status === "error" && (
                  <div class="directory-error" role="alert">
                    <p>{directoryState.message} 以下若有商品地圖結果也只是部分店家，並非 3 公里完整名單。</p>
                    <button type="button" onClick={requestDirectory}>重試店舖目錄</button>
                  </div>
                )}
                {center && directoryState.status === "ready" && (
                  <>
                    <p class="directory-meta">
                      官方店舖目錄快照更新於 {timeLabel(directoryState.directory.updatedAt)}；
                      共 {directoryState.directory.stores.length} 間，
                      {directoryState.directory.unlocatedCount} 間座標異常未納入距離計算。
                      快照可能延遲／缺漏，不等於商品庫存。
                    </p>
                    {isDirectoryStale(directoryState.directory.updatedAt) && (
                      <p class="inline-alert" role="alert">
                        店舖目錄快照已超過 48 小時；資料可能過期，請以官方店舖查詢為準。
                      </p>
                    )}
                  </>
                )}
                {!center && !postalCode ? (
                  <div class="empty-state empty-state--location">
                    <span class="empty-state__icon" aria-hidden="true">⌖</span>
                    <h3>選個位置，看看附近有什麼</h3>
                    <p>不用授權定位也能選地區中心、手動座標或郵遞區號；已收藏的分店請見收藏店家分頁。</p>
                    <a href="#location">前往位置選擇 <span aria-hidden="true">↑</span></a>
                  </div>
                ) : (
                  <>
                    {center && directoryState.status === "ready" && nearby.length > 0 && (
                      <details class="nearby-diagram-details">
                        <summary>查看 3 公里內店家的位置示意</summary>
                        <NearbyDiagram center={center.position} nearby={nearby} />
                      </details>
                    )}
                    {loading && <p class="loading-state" role="status">正在讀取兩張官方地圖資料…</p>}
                    {visibleStores.length > 0 ? (
                      <>
                        <p class="result-count">
                          {postalCode
                            ? `郵遞區號 ${postalCode}：商品地圖回傳 ${visibleStores.length} 間店（非完整名錄）`
                            : directoryState.status === "ready"
                              ? `3 公里內 ${visibleStores.length} 間店（含商品地圖額外回傳的店）`
                              : `目前僅有 ${visibleStores.length} 間商品地圖回傳的部分店家（非 3 公里完整名單）`}
                          {errorCount > 0 && "・部分商品地圖讀取失敗，商品資料可能缺漏"}
                        </p>
                        <div class="store-list">
                          {visibleStores.map(({ store, distance }) => (
                            <NearbyRow
                              key={store.code}
                              store={store}
                              isFavorite={favorites.some((favorite) => favorite.code === store.code)}
                              distance={distance}
                              states={{
                                food: nearbySourceState(store, "food"),
                                treasure: nearbySourceState(store, "treasure"),
                              }}
                              onAdd={addFavorite}
                              onExpand={lookupStoreProducts}
                              onShowImage={showImage}
                              priceNotes={priceNoteActions}
                            />
                          ))}
                        </div>
                      </>
                    ) : !loading && !(center && directoryState.status === "loading") ? (
                      <div class="empty-state">
                        <h3>
                          {center && directoryState.status === "error"
                            ? "3 公里店舖名單暫時無法確認"
                            : errorCount > 0 && (postalCode || directoryState.status !== "ready")
                              ? "部分地圖資料暫時無法確認"
                              : center ? "3 公里內沒有可定位的店舖資料" : "目前沒有回傳此郵遞區號的店"}
                        </h3>
                        <p>
                          {center && directoryState.status === "error"
                            ? "目錄無法載入，商品地圖未提供完整 3 公里清單；請重試目錄或前往官方店舖查詢。"
                            : errorCount === 2
                              ? "兩張商品地圖都無法讀取；請稍後重試，不代表店家缺貨。"
                              : postalCode && errorCount === 1
                                ? "一張商品地圖讀取失敗，另一張未回傳此郵碼的店家；結果不完整，不能推斷缺貨。"
                              : postalCode
                                ? "地圖未回傳此郵遞區號的店家商品；資料可能缺漏，不代表店家缺貨。"
                                : "目錄沒有可定位的店舖；資料可能延遲或缺漏，不代表附近店家缺貨。"}
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              <section
                id="about"
                class="result-section about-panel"
                aria-labelledby="about-title"
                hidden={activePage !== "about"}
              >
                <div class="result-section__heading">
                  <div>
                    <div class="section-label"><span>i</span> 來源・限制・隱私</div>
                    <h2 id="about-title" tabIndex={-1}>資料說明</h2>
                    <p>這是非官方網站；店舖目錄與商品地圖是兩種不同資料來源，均不能保證即時庫存。</p>
                  </div>
                </div>
                <div class="about-panel__cards">
                  <section>
                    <h3>店舖清單與更新時間</h3>
                    <p>
                      3 公里清單使用公開的全家店舖目錄，每次 GitHub Pages 發布前重新取得、
                      驗證代碼與座標後產生靜態快照；網站只在查附近或新增收藏時載入，
                      不會把你的座標送給店舖目錄。目錄可能延遲、缺漏或有錯誤座標，
                      店舖名單不等於商品庫存。
                    </p>
                    {directoryState.status === "ready" ? (
                      <p>本次快照更新：{timeLabel(directoryState.directory.updatedAt)}，
                        共 {directoryState.directory.stores.length} 間，
                        {directoryState.directory.unlocatedCount} 間座標異常未計距離。
                      </p>
                    ) : (
                      <p>尚未載入本次店舖目錄；到附近店家選擇位置或在收藏店家搜尋後才會載入更新時間。</p>
                    )}
                    <a href="https://www.family.com.tw/Marketing/zh/Map" target="_blank" rel="noopener noreferrer">
                      全家官方店舖查詢 ↗
                    </a>
                  </section>
                  <section>
                    <h3>兩張商品地圖</h3>
                    <p>
                      商品名稱、數量與資料時間來自
                      <a href={MAP_SOURCES.food.url} target="_blank" rel="noopener noreferrer">友善食光</a>
                      {" 與 "}
                      <a href={MAP_SOURCES.treasure.url} target="_blank" rel="noopener noreferrer">挖寶專區</a>
                      的公開查詢；座標直接查詢僅約 1 公里，因此 3 公里店舖目錄的商品
                      會在展開或收藏後依舊店碼個別查詢。沒有回傳、暫時讀取失敗、
                      店碼或地點對不上，都不代表缺貨。圖片只在按「查看圖片」時向官方讀取。
                    </p>
                  </section>
                  <section>
                    <h3>參考價與個人資料</h3>
                    <p>
                      八筆公開收據參考價不是現在的官方售價；挖寶折數依使用者規則估算，
                      不是實際結帳價。收藏與個人原價紀錄各自只存於此瀏覽器的 localStorage，
                      不需登入、不傳給 API，也不跨裝置同步。清除網站資料後無法復原。
                      瀏覽器定位只在主動按「使用目前位置」後請求；查商品時座標
                      四捨五入至小數第四位送給全家商品地圖，不保存定位，也不載入第三方圖磚。
                    </p>
                  </section>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>

      <footer class="site-footer">
        <div class="container site-footer__inner">
          <p>附近好物非全家官方網站；快照和地圖資料可能延遲或缺漏，實際資訊以官方／現場為準。</p>
          <a href="#about">查看資料來源、限制與隱私說明</a>
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
