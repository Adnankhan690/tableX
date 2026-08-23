# Product Requirements Document — Restaurant QR Table Ordering Platform

**Version:** 1.0 · **Status:** Draft · **Owner:** Adnan

> Checked in verbatim as the source requirement. Where v1 resolves an open question or
> makes a design call, see [DECISIONS.md](./DECISIONS.md).

## 1. Overview

A mobile-first web platform that lets restaurant customers scan a QR code placed on their
table to browse the menu, place an order, pay (online or at counter), and track order
progress in real time. Restaurant staff manage incoming orders through an admin panel.

**Target market:** Indian restaurants and their dine-in customers.
**Primary device:** Smartphone (mobile-first design is mandatory — desktop is secondary/not a priority for v1).

## 2. Problem Statement

Dine-in ordering in most Indian restaurants is still manual — customers wait for a waiter
to take orders, and staff manually relay them to the kitchen and cashier. This is slow,
error-prone, and doesn't scale during peak hours. A QR-based self-ordering system reduces
wait time, cuts staff load, and gives customers control over their order.

## 3. Goals & Success Metrics

| Goal | Metric |
| --- | --- |
| Reduce order-taking time | Time from QR scan to order placed |
| Reduce order errors | % of orders modified/cancelled after placement |
| Increase order throughput | Orders processed per hour per restaurant |
| High mobile usability | Task completion rate on mobile (target >90%) |

## 4. User Personas

- **Diner (Customer)** — Sits at a restaurant table, scans QR, orders food/drinks from their phone, pays, and tracks order status.
- **Restaurant Admin/Staff** — Views incoming orders, accepts or manages them, and (implicitly) updates order status as it's prepared/served.

## 5. User Flows

### 5.1 Customer Flow

1. Customer scans table QR code → lands directly on that restaurant's menu (table number captured from QR).
2. Browses menu, organized by categories (e.g., Starters, Main Course, Beverages, Desserts).
3. Adds items to cart.
4. Goes to Cart page → reviews items, quantities, price breakdown.
5. Proceeds to Payment page → chooses **Pay via QR** (online payment) or **Pay at Counter** (cash/card offline).
6. Places order.
7. Sees Order Progress/Status screen.

### 5.2 Admin Flow

1. Admin logs into Admin Panel.
2. Sees list of placed/incoming orders (likely per table).
3. Opens an order → reviews items.
4. Accepts the order (triggers status update visible to customer).

## 6. Functional Requirements

### 6.1 QR Code & Table Identification
- Each table has a unique QR code.
- Scanning the QR opens the web app directly to that restaurant's menu, with the table number auto-attached to the session/order (no manual table entry by customer).
- No login required for customers to browse/order (guest flow).

### 6.2 Menu Page
- Displays all items offered by the restaurant.
- Items grouped/divided by category (e.g., tabs or collapsible sections).
- Each item shows: name, price, image (optional), short description, veg/non-veg indicator (important for Indian market), "Add to Cart" control with quantity selector.
- Search/filter by category at minimum for v1.

### 6.3 Cart Page
- Lists all added items with quantity, per-item price, and subtotal.
- Ability to increase/decrease quantity or remove an item.
- Shows total bill (with taxes if applicable).
- "Proceed to Payment" CTA.

### 6.4 Payment Page
- Two payment options: **Pay via QR** (UPI QR is the natural default for India) and **Pay at Counter** (order placed, payment collected offline by staff).
- On successful payment (or on choosing "Pay at Counter"), order is confirmed and submitted.

### 6.5 Order Tracking (Customer)
- After placing the order, customer sees an order status/progress screen.
- Status states (minimum): Placed → Accepted → Preparing → Served/Completed.
- This screen should auto-update or be refreshable so the customer doesn't need to ask staff for order status.

### 6.6 Admin Panel
- Authenticated access for restaurant staff/owner.
- View list of all placed orders (ideally real-time or near real-time), filterable/sortable by table number and time.
- Each order shows: table number, items ordered, quantities, total amount, payment method chosen.
- Action: Accept Order button/control.

## 7. Non-Functional Requirements

- **Mobile-first design:** All customer-facing pages must be optimized primarily for smartphone screens; desktop is a nice-to-have, not a target for v1.
- **Performance:** Menu should load quickly on average Indian mobile networks (3G/4G) — optimize images and payload size.
- **Localization:** Currency in INR (₹); language — at minimum English, with Hindi as a strong future consideration.
- **No app install required:** Must work as a responsive web app accessed via browser (QR → web link), not a native app.
- **Reliability:** Order data must not be lost between placing an order and it reaching the admin panel — this is core to trust in the system.

## 8. Out of Scope (v1)

- Table reservation system
- Loyalty/rewards program
- Multi-restaurant/franchise management from a single admin account
- Native mobile apps (iOS/Android)
- Waiter-assisted ordering flow (replaced by self-ordering)

## 9. Open Questions

1. What happens after "Accept" — does admin need further controls (Reject order, mark Preparing/Ready/Served, cancel item)?
2. Is the online payment ("Pay via QR") a single restaurant UPI ID, or does it need a payment gateway integration (Razorpay/PayU/etc.) for tracking/reconciliation?
3. Is this multi-restaurant (a platform onboarding many restaurants) or single-restaurant? This significantly affects the data model (restaurant_id scoping) and admin auth design.
4. Does each table need a distinct QR, or is one QR per restaurant with manual table number entry acceptable as fallback?
5. Any requirement for order history for customers (past orders) or is each session stateless/guest-only?
6. Should customers be able to edit/cancel an order after placing it but before it's accepted?

> **All six are resolved in [DECISIONS.md](./DECISIONS.md) (D1–D6).**

## 10. Suggested Tech Considerations

- **Frontend:** Next.js (mobile-first responsive), React
- **Backend:** Go/Gin for order APIs, real-time updates via WebSockets or polling
- **Payments:** UPI-based gateway integration (Razorpay/PhonePe/Paytm) for "Pay via QR" if reconciliation is needed
