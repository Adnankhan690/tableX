import type {
  CreatePaymentRequest,
  GuestOrdersResponse,
  MenuResponse,
  OrderView,
  PaymentStatusResponse,
  PaymentView,
  PlaceOrderRequest,
  PlaceOrderResponse,
  RestaurantLandingResponse,
  ScanTableResponse,
  SelectTableRequest,
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
