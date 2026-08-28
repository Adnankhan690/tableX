import type {
  CreatePaymentRequest,
  GuestOrdersResponse,
  MenuResponse,
  OrderItemReviewView,
  OrderView,
  PaymentStatusResponse,
  PaymentView,
  PlaceOrderRequest,
  PlaceOrderResponse,
  RateOrderItemRequest,
  RateServiceRequest,
  RestaurantDirectoryResponse,
  RestaurantLandingResponse,
  RestaurantQR,
  ScanTableResponse,
  SelectTableRequest,
  ServiceReviewView,
} from '@tablex/shared'
import { HttpClient, type HttpClientConfig, newIdempotencyKey } from './http'

const PUBLIC = '/api/public/v1'
const GUEST = '/api/guest/v1'

/**
 * The diner-facing API.
 *
 * Every method except the two scan entry points requires a guest session token, which the
 * app holds in localStorage after a scan (docs/DECISIONS.md D5). The token is passed in
 * per call rather than stored on the client so that a single client instance can serve a
 * session that changes -- a diner rescanning a different table mid-visit.
 */
export class DinerApi {
  private readonly http: HttpClient

  constructor(config: HttpClientConfig) {
    this.http = new HttpClient(config)
  }

  /**
   * Resolves a scanned table QR into a session plus the whole menu, in one round trip.
   *
   * This single call is everything that happens between the diner scanning and seeing food,
   * so it is the request that decides whether the product feels fast (PRD 3, PRD 7).
   */
  scanTable(qrToken: string, signal?: AbortSignal): Promise<ScanTableResponse> {
    return this.http.request(`${PUBLIC}/t/${encodeURIComponent(qrToken)}`, {
      signal,
    })
  }

  /**
   * The restaurants taking orders (docs/DECISIONS.md D13).
   *
   * Backs the /qr gallery, which runs before any session exists and therefore has no credentials
   * to present.
   */
  listRestaurants(signal?: AbortSignal): Promise<RestaurantDirectoryResponse> {
    return this.http.request(`${PUBLIC}/restaurants`, { signal })
  }

  /** Renders a restaurant's QR code, pointing at its table-picker landing page. */
  restaurantQR(slug: string, size = 320, signal?: AbortSignal): Promise<RestaurantQR> {
    return this.http.request(`${PUBLIC}/r/${encodeURIComponent(slug)}/qr`, {
      query: { size },
      signal,
    })
  }

  /** The restaurant-level fallback QR: the diner picks their own table (docs/DECISIONS.md D4). */
  restaurantLanding(slug: string, signal?: AbortSignal): Promise<RestaurantLandingResponse> {
    return this.http.request(`${PUBLIC}/r/${encodeURIComponent(slug)}`, {
      signal,
    })
  }

  selectTable(slug: string, body: SelectTableRequest): Promise<ScanTableResponse> {
    return this.http.request(`${PUBLIC}/r/${encodeURIComponent(slug)}/select-table`, {
      method: 'POST',
      body,
    })
  }

  getMenu(token: string, signal?: AbortSignal): Promise<MenuResponse> {
    return this.http.request(`${GUEST}/menu`, {
      auth: { kind: 'guest', token },
      signal,
    })
  }

  /**
   * Places the order.
   *
   * `idempotencyKey` must be created once per cart and reused for every retry of that same
   * order. Passing a fresh key per attempt would let a double-tap on a stalled connection
   * send two tickets to the kitchen, which is the exact failure the mechanism exists to
   * prevent (docs/DECISIONS.md D12).
   */
  placeOrder(
    token: string,
    body: PlaceOrderRequest,
    idempotencyKey: string,
  ): Promise<PlaceOrderResponse> {
    return this.http.request(`${GUEST}/orders`, {
      method: 'POST',
      body,
      auth: { kind: 'guest', token },
      idempotencyKey,
    })
  }

  getOrder(token: string, uid: string, signal?: AbortSignal): Promise<OrderView> {
    return this.http.request(`${GUEST}/orders/${encodeURIComponent(uid)}`, {
      auth: { kind: 'guest', token },
      signal,
    })
  }

  /** "Your orders at this table this sitting" (docs/DECISIONS.md D5). */
  listMyOrders(token: string, signal?: AbortSignal): Promise<GuestOrdersResponse> {
    return this.http.request(`${GUEST}/orders`, {
      auth: { kind: 'guest', token },
      signal,
    })
  }

  /**
   * Withdraws an order the kitchen has not started.
   *
   * Fails with a 409 once staff has accepted (docs/DECISIONS.md D6). Callers should treat
   * that as "refetch and hide the button", not as an error worth alarming the diner about.
   */
  cancelOrder(token: string, uid: string): Promise<OrderView> {
    return this.http.request(`${GUEST}/orders/${encodeURIComponent(uid)}/cancel`, {
      method: 'POST',
      auth: { kind: 'guest', token },
    })
  }

  createPayment(token: string, uid: string, body: CreatePaymentRequest): Promise<PaymentView> {
    return this.http.request(`${GUEST}/orders/${encodeURIComponent(uid)}/payment`, {
      method: 'POST',
      body,
      auth: { kind: 'guest', token },
    })
  }

  /**
   * Rates one dish. This is the whole diner-side review write.
   *
   * PUT rather than POST, and that is the product decision showing through the verb: the diner
   * rates with a single tap and there is no Submit button, so every tap has to be safe to
   * repeat. A double-tap on a stalled connection and a genuine correction from four stars to
   * five both resolve to the same row -- guaranteed by a unique index on the order line rather
   * than by an idempotency key, because this endpoint cannot create a second row at all.
   *
   * Fails with a 409 (`TX_REV_001`) when the window is shut. Callers should treat that as
   * "refetch the order and re-read `can_review`", not as an error worth alarming the diner
   * about -- the commonest cause is simply being early.
   */
  rateOrderItem(
    token: string,
    orderUid: string,
    itemUid: string,
    body: RateOrderItemRequest,
  ): Promise<OrderItemReviewView> {
    return this.http.request(
      `${GUEST}/orders/${encodeURIComponent(orderUid)}/items/${encodeURIComponent(itemUid)}/review`,
      { method: 'PUT', body, auth: { kind: 'guest', token } },
    )
  }

  /**
   * Rates the SERVICE during this sitting.
   *
   * `orderUid` is the warrant, not the subject. What gets written is keyed to the guest session,
   * because service is experienced once per sitting rather than once per order -- a diner who
   * ordered twice has not been served by two different restaurants. The order is what proves this
   * session owns something here and that the rating window is open.
   *
   * The visible consequence, and it is intended: calling this with a different order uid from the
   * same session returns the SAME review, updated. There is one row per sitting.
   */
  rateService(
    token: string,
    orderUid: string,
    body: RateServiceRequest,
  ): Promise<ServiceReviewView> {
    return this.http.request(`${GUEST}/orders/${encodeURIComponent(orderUid)}/service-review`, {
      method: 'PUT',
      body,
      auth: { kind: 'guest', token },
    })
  }

  /** One poll answers both "did my payment land" and "has the kitchen started". */
  getPaymentStatus(
    token: string,
    uid: string,
    signal?: AbortSignal,
  ): Promise<PaymentStatusResponse> {
    return this.http.request(`${GUEST}/orders/${encodeURIComponent(uid)}/payment`, {
      auth: { kind: 'guest', token },
      signal,
    })
  }
}

export { newIdempotencyKey }
