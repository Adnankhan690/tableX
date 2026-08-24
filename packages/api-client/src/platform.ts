import type {
  OnboardRestaurantRequest,
  OnboardRestaurantResponse,
  PlatformRestaurantListResponse,
} from '@tablex/shared'
import { HttpClient, type HttpClientConfig } from './http'

const PLATFORM = '/api/platform/v1'

/**
 * The operator API: it creates restaurants (docs/DECISIONS.md D14).
 *
 * Separate from `AdminApi` rather than a few more methods on it, and the separation is the
 * point. `AdminApi` speaks for one restaurant with a staff JWT (docs/DECISIONS.md D3); this
 * speaks for the deployment with a shared secret. Merging them would put a tenant-creating
 * call one autocomplete away from the client every staff screen already holds.
 *
 * The token is passed per call, never stored on the instance. There is nowhere safe to keep it
 * in a browser: unlike a staff access token it is long-lived and it creates tenants, so it
 * belongs in a field the operator pastes and the page forgets on reload.
 *
 * **Every method here answers 404, not 401, when `TABLEX_PLATFORM_TOKEN` is unset on the
 * server** -- the route group is not mounted at all in that case.
 */
export class PlatformApi {
  private readonly http: HttpClient

  constructor(config: HttpClientConfig) {
    this.http = new HttpClient(config)
  }

  /**
   * Onboards a restaurant: the tenant root, its first owner login, and optionally its tables,
   * in one server-side transaction.
   *
   * Not retryable on a 409. A conflict means either the slug or the owner email is taken, and
   * both need a different value rather than another attempt at the same one.
   */
  onboardRestaurant(
    token: string,
    body: OnboardRestaurantRequest,
  ): Promise<OnboardRestaurantResponse> {
    return this.http.request(`${PLATFORM}/restaurants`, {
      method: 'POST',
      body,
      auth: { kind: 'platform', token },
    })
  }

  /** Every restaurant on the deployment, inactive ones included. */
  listRestaurants(token: string, signal?: AbortSignal): Promise<PlatformRestaurantListResponse> {
    return this.http.request(`${PLATFORM}/restaurants`, {
      auth: { kind: 'platform', token },
      signal,
    })
  }
}
