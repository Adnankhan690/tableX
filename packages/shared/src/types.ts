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

export interface OrderItemView {
  uid: string
  name: string
  unit_price: Money
  quantity: number
  total: Money
  food_type: FoodType
  note?: string
  status: OrderItemStatus
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
  at: string
}
