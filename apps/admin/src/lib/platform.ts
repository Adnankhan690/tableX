import { PlatformApi } from '@tablex/api-client'
import { env } from './env'

/**
 * The operator client (docs/DECISIONS.md D14).
 *
 * A second instance rather than more methods on `api`, mirroring the split on the server: `api`
 * speaks for one restaurant with a staff JWT, this speaks for the deployment with a shared
 * secret. Keeping them apart is what stops a tenant-creating call from being one autocomplete
 * away inside a staff screen.
 *
 * Stateless, like `api`: the token is passed per call. It is deliberately never written to
 * localStorage. A staff access token stored there is a bounded risk -- it is short-lived and
 * scoped to one restaurant (see lib/auth.ts) -- whereas this one does not expire and can create
 * tenants, so it lives in React state for the length of one page visit and is gone on reload.
 */
export const platformApi = new PlatformApi({ baseUrl: env.apiBaseUrl })
