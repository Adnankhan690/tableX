/**
 * The wire contract, mirroring backend/internal/types.
 *
 * These are hand-mirrored rather than generated. That is a deliberate trade for a v1 with
 * one backend and two frontends: adding protoc or an OpenAPI codegen step to the toolchain
 * costs more than it saves at this size. The trade has one obligation, and it is not
 * optional -- when a DTO changes in backend/internal/types, it changes here in the same
 * commit. See docs/CONTRIBUTING.md.
 */

// --- Envelope ---

/**
 * Every response from the API has this shape, success or failure. One shape means one
 * parser and one error path on the client rather than branching on status codes to decide
 * how to read the body.
 */
export interface Envelope<T> {
  code: string
  message: string
  data?: T
  request_id?: string
}

/** The success code the backend sends on every 2xx. */
export const CODE_SUCCESS = '00000'

// --- Enums, mirroring backend/internal/models/types.go ---

/**
 * The order lifecycle (docs/DECISIONS.md D1). Legal transitions live on the server; the
 * client renders whatever `next_statuses` says rather than reimplementing the state
 * machine, which is what keeps the two from drifting.
 */
export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'completed'
  | 'rejected'
  | 'cancelled'

/** Money tracking, deliberately separate from food tracking. */
/**
 * A status an order can be moved TO.
 *
 * `placed` is excluded because an order is *created* at that status rather than transitioned
 * into it -- there is no edge in the server's state machine whose target is `placed`. Naming
 * that here means `next_statuses` and `TransitionOrderRequest.status` are the same type, so a
 * button rendered from the former can be submitted as the latter with no cast.
 */
export type TransitionTarget = Exclude<OrderStatus, 'placed'>

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'

export type PaymentMethod = 'online_upi' | 'counter'

/** Required on every dish: an unlabelled item is unorderable for many diners in this market. */
export type FoodType = 'veg' | 'non_veg' | 'egg'

export type SpiceLevel = 'mild' | 'medium' | 'hot'

export type StaffRole = 'owner' | 'manager' | 'staff'

export type EntityStatus = 'active' | 'inactive' | 'archived'

export type OrderItemStatus = 'active' | 'cancelled'

export type ActorType = 'guest' | 'staff' | 'system'

// --- Money ---

/**
 * `minor` is the authoritative integer value in paise; `display` is pre-formatted by the
 * server.
 *
 * Both travel together so the client never does currency arithmetic or reimplements Indian
 * digit grouping in JavaScript, and so a diner and the kitchen are guaranteed to be reading
 * the same number (docs/DECISIONS.md D7).
 */
export interface Money {
  minor: number
  currency: string
  display: string
}

// --- Pagination ---

export interface PageMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
}

// --- Restaurant & tables ---

/** The public restaurant header. Carries no operational detail: it is served anonymously. */
export interface RestaurantSummary {
  uid: string
  name: string
  slug: string
  description?: string
  logo_url?: string
  address?: string
  phone?: string
  currency: string
}

/** The staff-only view, including the payout and tax configuration. */
export interface RestaurantSettings extends RestaurantSummary {
  timezone: string
  gst_number?: string
  tax_bps: number
  service_charge_bps: number
  upi_vpa?: string
  upi_payee_name?: string
  payment_provider: string
  status: string
}

export interface UpdateRestaurantRequest {
  name?: string
  description?: string
  logo_url?: string
  address?: string
  phone?: string
  timezone?: string
  gst_number?: string
  /** Basis points: 500 = 5.00%. */
  tax_bps?: number
  service_charge_bps?: number
  upi_vpa?: string
  upi_payee_name?: string
  payment_provider?: string
}

/**
 * A restaurant's own QR code, encoding its table-picker landing page.
 *
 * Distinct from `TableQR`: a table QR embeds an opaque capability token and is staff-only, whereas
 * this embeds only the public slug that already appears in the URL it opens. That is why the
 * endpoint behind it needs no credentials (docs/DECISIONS.md D4, D13).
 */
export interface RestaurantQR {
  name: string
  slug: string
  /** The encoded target: `{diner_base_url}/r/{slug}`. */
  qr_url: string
  /** Base64 PNG, rendered server-side so this app ships no QR library. */
  png_base64?: string
}

/** The restaurants taking orders on this deployment (docs/DECISIONS.md D13). */
export interface RestaurantDirectoryResponse {
  restaurants: RestaurantSummary[]
}

/** A table as the diner sees it: the label, never the QR token. */
export interface TableView {
  uid: string
  label: string
}

/** A table as the admin panel sees it. `qr_url` is staff-only. */
export interface TableInfo {
  uid: string
  label: string
  seats?: number
  status: string
  qr_url?: string
  live_order_count: number
}

export interface CreateTableRequest {
  label: string
  seats?: number
}

export interface UpdateTableRequest {
  label?: string
  seats?: number
  status?: EntityStatus
}

export interface BulkCreateTablesRequest {
  prefix?: string
  from: number
  to: number
  seats?: number
}

export interface TableQR {
  table_uid: string
  label: string
  qr_url: string
  /** Base64 PNG, ready for a data URI. Rendered server-side so the print sheet is one request. */
  png_base64?: string
}

// --- Menu ---

export interface MenuItemView {
  uid: string
  name: string
  description?: string
  image_url?: string
  price: Money
  food_type: FoodType
  spice_level?: SpiceLevel
  /**
   * Sold-out items are returned with this false rather than omitted, so the menu greys
   * them out in place. A dish that silently vanishes reads as a broken page.
   */
  is_available: boolean
  is_bestseller: boolean
  prep_time_mins?: number
  category_uid: string
  /**
   * The dish's aggregate score, absent rather than zeroed when there is nothing to report.
   *
   * On the DINER menu the server withholds this until the dish has enough ratings to mean
   * something (`MIN_RATINGS_TO_PUBLISH`). A "5.0" from one tap is not a smaller truth, it is
   * noise that ranks an untried dish above a consistently good one. The admin menu applies
   * no threshold: staff are owed the raw count.
   */
  rating?: RatingSummary
}

export interface MenuCategoryView {
  uid: string
  name: string
  description?: string
  items: MenuItemView[]
}

/** The whole diner menu in one response (PRD 6.2, PRD 7). */
export interface MenuResponse {
  restaurant: RestaurantSummary
  categories: MenuCategoryView[]
  /**
   * Sent so the cart can show an accurate total without a round trip per quantity tap.
   * Display only -- the server re-prices authoritatively at placement.
   */
  tax_bps: number
  service_charge_bps: number
}

export interface AdminMenuItemView extends MenuItemView {
  status: string
  sort_order: number
}

export interface AdminMenuCategoryView {
  uid: string
  name: string
  description?: string
  sort_order: number
  status: string
  items: AdminMenuItemView[]
}

export interface AdminMenuResponse {
  categories: AdminMenuCategoryView[]
  /**
   * Whether this DEPLOYMENT has an object store configured (docs/DECISIONS.md D15).
   *
   * A deployment fact, not a restaurant one, which is why it rides here rather than on
   * RestaurantSettings. The menu screen hides its upload control when this is false, so a
   * manager never presses a button that can only answer TX_IMG_001.
   */
  image_upload_enabled: boolean
  /**
   * This deployment's per-photo ceiling in bytes, so the panel downscales to a size that
   * will actually be accepted. Zero when uploads are disabled.
   *
   * Without it the client can only assume the default: a deployment that lowered the limit
   * would produce a dead end, where a photo small enough to pass the client's check is
   * refused by the server and retrying fails identically.
   */
  image_max_upload_bytes: number
}

// --- Dish photographs (docs/DECISIONS.md D15) ---
//
// Uploading is two calls. The first mints a presigned URL and the browser PUTs the file
// straight to Cloudflare R2, so a 5MB photograph never passes through the API. The second
// attaches the finished object, and is where the server checks what actually landed --
// its size, and its real content type sniffed from the leading bytes.

/** JPEG, PNG and WebP only. SVG is refused by the server: it executes script. */
export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface CreateImageUploadRequest {
  content_type: ImageContentType
  size_bytes: number
}

export interface ImageUploadResponse {
  upload_url: string
  method: string
  /**
   * Must be replayed on the PUT verbatim -- they are inside the signature, so adding,
   * dropping or renaming one produces a 403 rather than a partial upload.
   *
   * Host and Content-Length are deliberately absent: browsers forbid script from setting
   * either and supply both themselves.
   */
  headers: Record<string, string>
  /**
   * Encodes the restaurant and the menu item:
   * `menu/{restaurant_uid}/{item_uid}/{image_uid}.{ext}`. Handed back to confirmImageUpload,
   * which refuses any key naming a different dish or a different restaurant.
   */
  object_key: string
  expires_at: string
  /** The server's ceiling, echoed so a too-large file can be refused before it is uploaded. */
  max_bytes: number
}

export interface ConfirmImageUploadRequest {
  object_key: string
}

export interface CreateCategoryRequest {
  name: string
  description?: string
  sort_order?: number
}

export interface UpdateCategoryRequest {
  name?: string
  description?: string
  sort_order?: number
  status?: EntityStatus
}

export interface CreateMenuItemRequest {
  category_uid: string
  name: string
  description?: string
  image_url?: string
  /** Paise, as an integer. No float ever reaches the server. */
  price_minor: number
  food_type: FoodType
  spice_level?: SpiceLevel
  is_available?: boolean
  is_bestseller?: boolean
  prep_time_mins?: number
  sort_order?: number
}

export interface UpdateMenuItemRequest {
  category_uid?: string
  name?: string
  description?: string
  image_url?: string
  price_minor?: number
  food_type?: FoodType
  spice_level?: SpiceLevel
  is_available?: boolean
  is_bestseller?: boolean
  prep_time_mins?: number
  sort_order?: number
  status?: EntityStatus
}

// --- Session (QR scan) ---

/** The diner's anonymous identity (docs/DECISIONS.md D5). */
export interface GuestSessionView {
  uid: string
  /** Returned exactly once, on scan, and stored in the browser. */
  token: string
  expires_at: string
}

/** Everything the diner app needs from a scan, in one round trip. */
export interface ScanTableResponse {
  session: GuestSessionView
  table: TableView
  menu: MenuResponse
}

/** The restaurant-level fallback QR landing (docs/DECISIONS.md D4). */
export interface RestaurantLandingResponse {
  restaurant: RestaurantSummary
  tables: TableView[]
}

export interface SelectTableRequest {
  table_uid: string
}

// --- Orders ---

/**
 * Note what this does not contain: any amount. The client sends items and quantities and
 * the server prices the order from the live menu -- a client-supplied total would let a
 * diner order a thali for one rupee.
 */
export interface PlaceOrderRequest {
  items: OrderItemRequest[]
  payment_method: PaymentMethod
  customer_name?: string
  customer_phone?: string
  note?: string
}

export interface OrderItemRequest {
  menu_item_uid: string
  quantity: number
  note?: string
}

// --- Rating and reviews ---
//
// The constraint that shapes these: a diner rates with ONE TAP and never sees a form. That
// is why the write is a PUT of a single line's rating rather than a POST of a whole order's
// worth -- a batch body would need a Submit button to know when it was complete, and that
// button is the step diners abandon.

/** A dish's aggregate score. */
export interface RatingSummary {
  /**
   * Rounded to one decimal by the SERVER, so every client renders the same "4.3" without
   * reimplementing the rule -- the same argument that puts a formatted `display` on Money.
   */
  average: number
  count: number
}

/**
 * The closed vocabulary of one-tap reasons.
 *
 * Mirrors `models.ReviewTag`. A fixed set rather than free text is what makes this feature
 * answerable without typing, and the only form of the data a kitchen can act on in
 * aggregate: "9 people said cold this week" is a service problem with an address, where
 * nine sentences of prose are an afternoon of reading.
 *
 * The server REJECTS a tag outside this set rather than dropping it, so a typo here fails
 * loudly in development instead of producing a bucket nobody looks in.
 */
export type ReviewTag =
  | 'tasty'
  | 'fresh'
  | 'good_portion'
  | 'well_presented'
  | 'worth_the_wait'
  | 'bland'
  | 'too_spicy'
  | 'served_cold'
  | 'small_portion'
  | 'slow_to_arrive'
  | 'not_as_described'

/** One tap on one dish. `rating` is the only required field. */
export interface RateOrderItemRequest {
  rating: number
  tags?: ReviewTag[]
  comment?: string
}

/** A diner's own rating, echoed back on the line it belongs to. */
export interface OrderItemReviewView {
  uid: string
  rating: number
  tags?: ReviewTag[]
  comment?: string
  /**
   * Lets the client tell a rating it just wrote from one it loaded, which is what stops an
   * in-flight optimistic update being overwritten by a slower refetch.
   */
  updated_at: string
}

/** One review as the admin feed renders it. */
export interface ReviewView {
  uid: string
  rating: number
  tags?: ReviewTag[]
  comment?: string
  menu_item_uid: string
  /**
   * The name SNAPSHOTTED on the order line, not the dish's current one
   * (docs/DECISIONS.md D8). A dish renamed since is shown as the diner saw it, or the review
   * appears to be about something they never ordered.
   */
  item_name: string
  food_type: FoodType
  order_uid: string
  order_number: string
  table_label?: string
  created_at: string
  updated_at: string
}

export interface ListReviewsQuery {
  page?: number
  per_page?: number
  menu_item_uid?: string
  /** A ceiling, because "3 and below" is the actual question a manager has. */
  max_rating?: number
  min_rating?: number
  has_comment?: boolean
  from?: string
  to?: string
}

export interface ReviewListResponse {
  reviews: ReviewView[]
  meta: PageMeta
}

/** One dish in the best/worst tables on the reviews dashboard. */
export interface RatedDishView {
  menu_item_uid: string
  name: string
  food_type: FoodType
  rating: RatingSummary
}

export interface ReviewSummaryResponse {
  overall: RatingSummary
  /**
   * Counts at each star, indexed 0..4 for 1..5.
   *
   * Sent as well as the average because the two answer different questions: a 3.0 of straight
   * 3s is a dull menu, and a 3.0 of 5s and 1s is an inconsistent kitchen. Those need opposite
   * responses, and an average alone cannot tell them apart.
   */
  distribution: [number, number, number, number, number]
  /** The lowest-rated dishes, worst first -- the working list. */
  needs_attention: RatedDishView[]
  top_rated: RatedDishView[]
  /**
   * The review count a dish needed to be ranked at all, sent so an empty list reads as "not
   * enough data yet" rather than as a broken panel on a restaurant's first night.
   */
  min_reviews_for_ranking: number
}

export interface OrderItemView {
  uid: string
  name: string
  unit_price: Money
  quantity: number
  total: Money
  food_type: FoodType
  note?: string
  status: OrderItemStatus
  /**
   * This diner's own rating of this line, when they have left one -- so the tracking screen
   * renders the stars already given rather than an empty row to re-fill after a refresh.
   */
  review?: OrderItemReviewView
}

export interface OrderTotals {
  subtotal: Money
  tax: Money
  service_charge: Money
  discount: Money
  total: Money
}

export interface OrderStatusEventView {
  status: OrderStatus
  actor_type: ActorType
  note?: string
  at: string
}

export interface OrderView {
  uid: string
  order_number: string
  status: OrderStatus
  table_label: string
  items: OrderItemView[]
  totals: OrderTotals
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  customer_name?: string
  customer_phone?: string
  note?: string
  cancel_reason?: string

  placed_at: string
  accepted_at?: string
  preparing_at?: string
  ready_at?: string
  served_at?: string
  completed_at?: string
  cancelled_at?: string

  timeline?: OrderStatusEventView[]

  /**
   * The transitions legal from here, computed server-side. The admin panel renders exactly
   * these buttons instead of reimplementing the state machine (docs/DECISIONS.md D1).
   */
  next_statuses?: TransitionTarget[]
  /** Whether the diner may still withdraw this order themselves (docs/DECISIONS.md D6). */
  can_guest_cancel: boolean

  /**
   * Whether the diner may rate their food right now.
   *
   * Computed server-side for the same reason as the two flags above: the app renders the
   * rating card exactly when submitting will work. Do NOT reimplement this as
   * `status === 'served'` -- the window also opens on a settled counter payment, and on a
   * timeout after the kitchen stops updating the order at all, precisely so that a diner at
   * a restaurant whose floor staff forget that last tap is still asked.
   * `backend/internal/services/review_window.go` is the single authority.
   */
  can_review: boolean
  /**
   * When the window will open, sent only while it is still shut. The diner app sets one timer
   * for that instant rather than waiting to notice on its next poll.
   */
  review_opens_at?: string
  /** When it shuts, so a late arrival is told "too late" rather than shown a card that fails. */
  review_closes_at?: string
}

export interface PlaceOrderResponse {
  order: OrderView
  /** Present when the diner chose online_upi. */
  payment?: PaymentView
}

export interface OrderListResponse {
  orders: OrderView[]
  meta: PageMeta
}

export interface GuestOrdersResponse {
  orders: OrderView[]
}

export interface ListOrdersQuery {
  page?: number
  per_page?: number
  status?: OrderStatus[]
  table_uid?: string
  payment_status?: PaymentStatus
  /** Shorthand for every non-terminal status -- the kitchen board's only query. */
  live?: boolean
  search?: string
  from?: string
  to?: string
}

export interface TransitionOrderRequest {
  status: TransitionTarget
  /** Required for `rejected` and `cancelled`, so the diner can be told why. */
  reason?: string
}

export interface CancelOrderItemRequest {
  reason?: string
}

// --- Payments ---

export interface PaymentView {
  uid: string
  provider: string
  method: PaymentMethod
  amount: Money
  status: PaymentStatus
  /** Shown to both diner and staff; it is what staff match against a bank notification. */
  reference: string
  /** The `upi://pay?...` deep link, for static UPI. */
  upi_intent_url?: string
  /** The same intent as a scannable QR, for paying from a second device. */
  qr_png_base64?: string
  provider_order_id?: string
  provider_key_id?: string
  /**
   * True for static UPI, which cannot detect that money arrived. Drives "awaiting
   * confirmation from staff" instead of a spinner that will never resolve
   * (docs/DECISIONS.md D2).
   */
  requires_manual_confirmation: boolean
  paid_at?: string
  created_at: string
}

export interface CreatePaymentRequest {
  method: PaymentMethod
}

export interface ConfirmPaymentRequest {
  reference?: string
  note?: string
}

export interface MarkPaymentFailedRequest {
  reason?: string
}

/** One poll answers both "did my payment land" and "has the kitchen started". */
export interface PaymentStatusResponse {
  payment: PaymentView
  order_status: OrderStatus
  payment_status: PaymentStatus
}

// --- Auth ---

export interface StaffLoginRequest {
  email: string
  password: string
}

export interface ForgotPasswordRequest {
  email: string
}

export interface VerifyResetCodeRequest {
  email: string
  code: string
}

export interface ResetPasswordRequest {
  email: string
  code: string
  new_password: string
}

export interface StaffMember {
  uid: string
  name: string
  email: string
  role: StaffRole
  status: string
  last_login_at?: string
  created_at: string
}

export interface StaffLoginResponse {
  access_token: string
  refresh_token: string
  expires_at: string
  staff: StaffMember
  restaurant: RestaurantSummary
}

export interface RefreshTokenRequest {
  refresh_token: string
}

export interface RefreshTokenResponse {
  access_token: string
  expires_at: string
}

export interface CreateStaffRequest {
  name: string
  email: string
  password: string
  role: StaffRole
}

export interface UpdateStaffRequest {
  name?: string
  role?: StaffRole
  status?: 'active' | 'inactive'
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface StaffListResponse {
  staff: StaffMember[]
}

// --- Platform (operator) ---
//
// The fourth trust level, and the only one scoped to no restaurant -- it is what creates them
// (docs/DECISIONS.md D14). Authorised by the deployment's platform token, not by a staff JWT: a
// staff token carries exactly one `restaurant_id` (D3), so no staff role can describe an
// operator acting across all of them.

/**
 * Creates a restaurant, its first owner login, and optionally its floor of tables.
 *
 * `name` and `owner` are the only required fields. `slug` is derived from the name when
 * omitted, and normalised either way -- it becomes the restaurant's permanent public URL
 * segment, `/r/{slug}` (docs/DECISIONS.md D4).
 */
export interface OnboardRestaurantRequest {
  name: string
  slug?: string
  description?: string
  logo_url?: string
  address?: string
  phone?: string
  /** IANA name. Decides when the daily order-number counter rolls over (docs/DECISIONS.md D9). */
  timezone?: string
  currency?: string
  gst_number?: string
  /**
   * Basis points: 500 = 5.00%.
   *
   * Omit to inherit the 5% GST default. Sending `0` is different and means tax-free -- the
   * server distinguishes the two, so a form that sends 0 for an empty input onboards a
   * restaurant that charges no tax.
   */
  tax_bps?: number
  service_charge_bps?: number
  upi_vpa?: string
  upi_payee_name?: string
  payment_provider?: string
  owner: OnboardOwnerRequest
  /** Omit for a restaurant with no tables yet; the restaurant-level fallback QR still works. */
  tables?: OnboardTablesRequest
}

/**
 * The first staff login. Always created with the `owner` role -- there is no role field,
 * because the first account has to be able to create the others.
 */
export interface OnboardOwnerRequest {
  name: string
  email: string
  password: string
}

/** A numbered range of tables to create with the restaurant. Both ends inclusive. */
export interface OnboardTablesRequest {
  /** Prepended to each label: `"T-"` with 1..12 gives `T-1` .. `T-12`. */
  prefix?: string
  from: number
  to: number
  seats?: number
}

/**
 * Everything needed to hand the restaurant over.
 *
 * Carries the table QR URLs because those are the deliverable. No password of any kind comes
 * back: whoever made the call already has it, and echoing it would write it into every proxy
 * log on the way home.
 */
export interface OnboardRestaurantResponse {
  restaurant: RestaurantSettings
  owner: StaffMember
  /** Empty when no tables were requested, never null. */
  tables: TableInfo[]
  /** The restaurant-level landing page: the one QR that works before any sticker is printed. */
  diner_url: string
  /** Where the owner signs in. Empty when the server has no admin base URL configured. */
  admin_url?: string
}

/**
 * Every tenant on the deployment, inactive ones included.
 *
 * `RestaurantSettings`, not `RestaurantSummary`: an operator's first question about a
 * restaurant that is not taking orders is what its status and configuration are, which is
 * exactly what the public directory withholds (docs/DECISIONS.md D13).
 */
export interface PlatformRestaurantListResponse {
  restaurants: RestaurantSettings[]
}

// --- Stats ---

export interface OrderStatsView {
  business_date: string
  orders_placed: number
  orders_completed: number
  orders_cancelled: number
  orders_live: number
  revenue: Money
  unpaid_amount: Money
  /**
   * The PRD's order-taking-time and throughput metrics (PRD 3). Null rather than 0 when
   * there is no data -- "0 seconds" is a different and false claim.
   */
  avg_accept_secs?: number | null
  avg_fulfil_secs?: number | null
}

// --- Realtime ---

export type RealtimeEventType =
  | 'order.placed'
  | 'order.status_changed'
  | 'payment.updated'
  | 'menu.availability_changed'
  | 'review.submitted'
  | 'ping'

/**
 * Realtime payloads are thin on purpose: identifiers and a status, not a whole order. A
 * client that receives one refetches over HTTP, which is what makes a dropped frame
 * harmless and stops the socket becoming a second, divergent source of truth
 * (docs/DECISIONS.md D10).
 */
export interface RealtimeEvent {
  type: RealtimeEventType
  topic: string
  order_uid?: string
  status?: OrderStatus
  table_label?: string
  /**
   * Rides on `review.submitted`, and is the one payload field that is a value rather than an
   * identifier. It earns the exception because the panel highlights a low rating on arrival,
   * and a refetch-first round trip would spend the seconds in which staff could still walk
   * over to the table.
   */
  rating?: number
  at: string
}
