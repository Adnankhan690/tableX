import type {
  AdminMenuCategoryView,
  AdminMenuItemView,
  AdminMenuResponse,
  BulkCreateTablesRequest,
  ChangePasswordRequest,
  ConfirmImageUploadRequest,
  ConfirmPaymentRequest,
  CreateCategoryRequest,
  CreateImageUploadRequest,
  CreateMenuItemRequest,
  CreateStaffRequest,
  CreateTableRequest,
  ImageUploadResponse,
  ForgotPasswordRequest,
  ListOrdersQuery,
  MarkPaymentFailedRequest,
  OrderListResponse,
  OrderStatsView,
  OrderView,
  PaymentView,
  RefreshTokenResponse,
  ResetPasswordRequest,
  RestaurantSettings,
  StaffListResponse,
  StaffLoginRequest,
  StaffLoginResponse,
  StaffMember,
  TableInfo,
  TableQR,
  TransitionOrderRequest,
  UpdateCategoryRequest,
  UpdateMenuItemRequest,
  UpdateRestaurantRequest,
  UpdateStaffRequest,
  UpdateTableRequest,
  VerifyResetCodeRequest,
} from '@tablex/shared'
import { HttpClient, type HttpClientConfig } from './http'

const ADMIN = '/api/admin/v1'

/**
 * The staff-facing API.
 *
 * The access token is passed per call rather than held on the client, because it is
 * refreshed on expiry and a stored copy would go stale in whichever component captured the
 * client first.
 */
export class AdminApi {
  private readonly http: HttpClient

  constructor(config: HttpClientConfig) {
    this.http = new HttpClient(config)
  }

  // --- Auth ---

  login(body: StaffLoginRequest): Promise<StaffLoginResponse> {
    return this.http.request(`${ADMIN}/auth/login`, { method: 'POST', body })
  }

  forgotPassword(body: ForgotPasswordRequest): Promise<void> {
    return this.http.request(`${ADMIN}/auth/forgot-password`, { method: 'POST', body })
  }

  verifyResetCode(body: VerifyResetCodeRequest): Promise<void> {
    return this.http.request(`${ADMIN}/auth/verify-reset-code`, { method: 'POST', body })
  }

  resetPassword(body: ResetPasswordRequest): Promise<void> {
    return this.http.request(`${ADMIN}/auth/reset-password`, { method: 'POST', body })
  }

  /**
   * Exchanges a refresh token for a fresh access token.
   *
   * Deliberately not authenticated with the access token: the whole point is that it works
   * once the access token has expired.
   */
  refresh(refreshToken: string): Promise<RefreshTokenResponse> {
    return this.http.request(`${ADMIN}/auth/refresh`, {
      method: 'POST',
      body: { refresh_token: refreshToken },
    })
  }

  me(token: string): Promise<StaffMember> {
    return this.http.request(`${ADMIN}/auth/me`, {
      auth: { kind: 'staff', token },
    })
  }

  changePassword(token: string, body: ChangePasswordRequest): Promise<void> {
    return this.http.request(`${ADMIN}/auth/change-password`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  listStaff(token: string): Promise<StaffListResponse> {
    return this.http.request(`${ADMIN}/staff`, {
      auth: { kind: 'staff', token },
    })
  }

  createStaff(token: string, body: CreateStaffRequest): Promise<StaffMember> {
    return this.http.request(`${ADMIN}/staff`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  updateStaff(token: string, uid: string, body: UpdateStaffRequest): Promise<StaffMember> {
    return this.http.request(`${ADMIN}/staff/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body,
      auth: { kind: 'staff', token },
    })
  }

  // --- Settings ---

  getSettings(token: string): Promise<RestaurantSettings> {
    return this.http.request(`${ADMIN}/settings`, {
      auth: { kind: 'staff', token },
    })
  }

  updateSettings(token: string, body: UpdateRestaurantRequest): Promise<RestaurantSettings> {
    return this.http.request(`${ADMIN}/settings`, {
      method: 'PATCH',
      body,
      auth: { kind: 'staff', token },
    })
  }

  // --- Menu ---

  getMenu(token: string, signal?: AbortSignal): Promise<AdminMenuResponse> {
    return this.http.request(`${ADMIN}/menu`, {
      auth: { kind: 'staff', token },
      signal,
    })
  }

  createCategory(token: string, body: CreateCategoryRequest): Promise<AdminMenuCategoryView> {
    return this.http.request(`${ADMIN}/menu/categories`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  updateCategory(
    token: string,
    uid: string,
    body: UpdateCategoryRequest,
  ): Promise<AdminMenuCategoryView> {
    return this.http.request(`${ADMIN}/menu/categories/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body,
      auth: { kind: 'staff', token },
    })
  }

  createItem(token: string, body: CreateMenuItemRequest): Promise<AdminMenuItemView> {
    return this.http.request(`${ADMIN}/menu/items`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  updateItem(token: string, uid: string, body: UpdateMenuItemRequest): Promise<AdminMenuItemView> {
    return this.http.request(`${ADMIN}/menu/items/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body,
      auth: { kind: 'staff', token },
    })
  }

  /**
   * The one-tap sold-out toggle, available to every staff role.
   *
   * Separate from updateItem so marking a dish unavailable mid-service cannot accidentally
   * submit a stale price from a form a manager left open.
   */
  setAvailability(token: string, uid: string, isAvailable: boolean): Promise<AdminMenuItemView> {
    return this.http.request(`${ADMIN}/menu/items/${encodeURIComponent(uid)}/availability`, {
      method: 'PATCH',
      body: { is_available: isAvailable },
      auth: { kind: 'staff', token },
    })
  }

  // --- Dish photographs (docs/DECISIONS.md D15) ---

  /**
   * Step one: ask for somewhere to put a photograph.
   *
   * Returns a presigned URL the browser PUTs to directly. Nothing about the dish changes
   * until confirmImageUpload runs, so an abandoned upload leaves the menu untouched.
   *
   * Throws with code `TX_IMG_001` on a deployment that hosts no images -- check
   * `image_upload_enabled` on the menu response instead of catching that.
   */
  createImageUpload(
    token: string,
    uid: string,
    body: CreateImageUploadRequest,
  ): Promise<ImageUploadResponse> {
    return this.http.request(`${ADMIN}/menu/items/${encodeURIComponent(uid)}/image/upload`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  /**
   * Step two: attach the finished upload to the dish.
   *
   * This is where the server validates -- size, and the real content type sniffed from the
   * bytes rather than the one the client declared. A key naming another dish or another
   * restaurant is refused here (`TX_IMG_005`).
   */
  confirmImageUpload(
    token: string,
    uid: string,
    body: ConfirmImageUploadRequest,
  ): Promise<AdminMenuItemView> {
    return this.http.request(`${ADMIN}/menu/items/${encodeURIComponent(uid)}/image`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  /** Removes a dish's photograph. Idempotent -- a dish with none answers 200. */
  removeImage(token: string, uid: string): Promise<AdminMenuItemView> {
    return this.http.request(`${ADMIN}/menu/items/${encodeURIComponent(uid)}/image`, {
      method: 'DELETE',
      auth: { kind: 'staff', token },
    })
  }

  // --- Tables & QR ---

  listTables(token: string, signal?: AbortSignal): Promise<{ tables: TableInfo[] }> {
    return this.http.request(`${ADMIN}/tables`, {
      auth: { kind: 'staff', token },
      signal,
    })
  }

  createTable(token: string, body: CreateTableRequest): Promise<TableInfo> {
    return this.http.request(`${ADMIN}/tables`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  bulkCreateTables(token: string, body: BulkCreateTablesRequest): Promise<{ tables: TableInfo[] }> {
    return this.http.request(`${ADMIN}/tables/bulk`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  updateTable(token: string, uid: string, body: UpdateTableRequest): Promise<TableInfo> {
    return this.http.request(`${ADMIN}/tables/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      body,
      auth: { kind: 'staff', token },
    })
  }

  getTableQR(token: string, uid: string, size = 512): Promise<TableQR> {
    return this.http.request(`${ADMIN}/tables/${encodeURIComponent(uid)}/qr`, {
      query: { size },
      auth: { kind: 'staff', token },
    })
  }

  /** Issues a fresh token, invalidating the printed sticker (docs/DECISIONS.md D4). */
  rotateTableQR(token: string, uid: string): Promise<TableQR> {
    return this.http.request(`${ADMIN}/tables/${encodeURIComponent(uid)}/qr/rotate`, {
      method: 'POST',
      auth: { kind: 'staff', token },
    })
  }

  // --- Orders ---

  listOrders(
    token: string,
    query: ListOrdersQuery = {},
    signal?: AbortSignal,
  ): Promise<OrderListResponse> {
    return this.http.request(`${ADMIN}/orders`, {
      query: {
        page: query.page,
        per_page: query.per_page,
        status: query.status,
        table_uid: query.table_uid,
        payment_status: query.payment_status,
        live: query.live,
        search: query.search,
        from: query.from,
        to: query.to,
      },
      auth: { kind: 'staff', token },
      signal,
    })
  }

  getOrder(token: string, uid: string, signal?: AbortSignal): Promise<OrderView> {
    return this.http.request(`${ADMIN}/orders/${encodeURIComponent(uid)}`, {
      auth: { kind: 'staff', token },
      signal,
    })
  }

  /**
   * Moves an order to a new status.
   *
   * A 409 means another device got there first (docs/DECISIONS.md D1). Callers must refetch
   * rather than retry: retrying the same transition would fail identically.
   */
  transitionOrder(token: string, uid: string, body: TransitionOrderRequest): Promise<OrderView> {
    return this.http.request(`${ADMIN}/orders/${encodeURIComponent(uid)}/transition`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  cancelOrderItem(
    token: string,
    orderUid: string,
    itemUid: string,
    reason?: string,
  ): Promise<OrderView> {
    return this.http.request(
      `${ADMIN}/orders/${encodeURIComponent(orderUid)}/items/${encodeURIComponent(itemUid)}/cancel`,
      { method: 'POST', body: { reason }, auth: { kind: 'staff', token } },
    )
  }

  // --- Payments ---

  /** Settles a payment no gateway can confirm: cash, or a static-UPI transfer staff saw land. */
  confirmPayment(
    token: string,
    orderUid: string,
    body: ConfirmPaymentRequest,
  ): Promise<PaymentView> {
    return this.http.request(`${ADMIN}/orders/${encodeURIComponent(orderUid)}/payment/confirm`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  markPaymentFailed(
    token: string,
    orderUid: string,
    body: MarkPaymentFailedRequest,
  ): Promise<PaymentView> {
    return this.http.request(`${ADMIN}/orders/${encodeURIComponent(orderUid)}/payment/fail`, {
      method: 'POST',
      body,
      auth: { kind: 'staff', token },
    })
  }

  // --- Stats ---

  statsToday(token: string, signal?: AbortSignal): Promise<OrderStatsView> {
    return this.http.request(`${ADMIN}/stats/today`, {
      auth: { kind: 'staff', token },
      signal,
    })
  }

  statsRange(token: string, from: string, to: string): Promise<OrderStatsView> {
    return this.http.request(`${ADMIN}/stats/range`, {
      query: { from, to },
      auth: { kind: 'staff', token },
    })
  }
}
