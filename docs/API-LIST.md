## should i provide user to enter name/number for order ? or i should use table number combined with unique id for ordering

## On your questions first

**Table number + unique ID vs. name/number entry:**

Go with **table number + a unique session/order ID**, not asking for name/phone. Here's why:

- No login means friction should stay at zero — asking for name/number is still a form to fill before ordering, which defeats the "scan and go" speed advantage.
- Table number alone isn't enough to disambiguate: if two groups scan the same table's QR at different times (or the same table reorders), you need something to tie a specific ordering *session* to a specific *cart/order*. A generated unique ID per scan session (e.g., `tableId + timestamp/UUID`) solves this cleanly.
- You can always ask for **just a name** (not phone) as an *optional*, lightweight field at checkout if you want the admin to be able to call out "Order for Ravi" — but this should be optional, not required, and definitely not a "login."
- Avoid phone number collection unless you have a real reason (e.g., SMS notifications) — it adds friction and, in India, people are wary of giving numbers to random QR scans.

**Recommended approach:** QR encodes `restaurantId + tableId`. On scan, backend generates a `sessionId` (or `orderSessionId`) tied to that table, stored client-side (e.g., in a cookie/localStorage or passed via URL) so cart/order/status calls all reference it — no login, no name required.

---

## API List

### Customer-side APIs (no auth)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/menu/:restaurantId` | Fetch full menu, grouped by category, for the scanned restaurant |
| GET | `/table/:tableId/session` | Validate table QR and create/return a session ID for this ordering session |
| POST | `/cart` | Create/update cart for the current session (add/update items) |
| GET | `/cart/:sessionId` | Fetch current cart contents |
| DELETE | `/cart/:sessionId/item/:itemId` | Remove an item from cart |
| POST | `/order` | Place order (from cart) — includes chosen payment method (`qr` / `counter`) |
| POST | `/payment/initiate` | Generate payment request (UPI QR / payment link) if "Pay via QR" chosen |
| GET | `/payment/status/:paymentId` | Poll/check payment confirmation status |
| GET | `/order/:orderId/status` | Poll order status (Placed → Accepted → Preparing → Served) |

### Admin-side APIs (auth required)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/admin/login` | Staff/admin authentication (this is the *only* login in the system) |
| GET | `/admin/orders` | List all incoming/active orders (filterable by table, status, time) |
| GET | `/admin/orders/:orderId` | Get full detail of a specific order |
| PATCH | `/admin/orders/:orderId/accept` | Accept an order |
| PATCH | `/admin/orders/:orderId/status` | Update order status (Preparing/Served/Completed) — for when you add this beyond just "Accept" |
| PATCH | `/admin/orders/:orderId/reject` | Reject/cancel an order (worth having even in v1, for out-of-stock items etc.) |
| GET | `/admin/menu/:restaurantId` | Fetch menu (for managing items — likely needed even if menu CRUD is v2) |
| PATCH | `/admin/menu/item/:itemId` | Toggle item availability (e.g., mark "out of stock") — very commonly needed on day one in practice |

A couple of things worth deciding now since they affect this list: do you want **real-time push** (WebSocket) for new orders hitting the admin panel instantly, or is **polling** (`GET /admin/orders` every few seconds) acceptable for v1? Polling is far simpler to build first and you can upgrade to WebSockets later without changing your data model.