# Firestore query budget

Added Nov 2026 after a 500-product catalogue made several screens unusable.

## The rule

**No unbounded `onSnapshot` on a collection that grows without limit.**

A listener without `limit()` re-downloads and re-renders the entire matched set on *every*
write to it. That is fine at 20 orders and fatal at 2 000 — and it degrades silently, so it
is discovered in production.

## Current state

| Query | Bound |
|---|---|
| `subscribeOrders` | `limit(max)`, default 25 |
| `subscribeOpenOrders` | `status in [new, accepted, out_for_delivery]`, `limit(50)` |
| `fetchOrdersPage` | cursor paging, caller-set page size |
| `fetchOrdersInRange` | date window, pages of 300, `hardCap` 2000 |
| `subscribeOrder` | single doc |
| `fetchCustomerOrdersPage` | cursor paging |
| `subscribeProducts` | **unbounded** — acceptable: a catalogue is a few thousand at worst and every screen needs it. Mitigated by `thumb` so rows don't fetch image blobs. |
| `subscribeCustomers` / `subscribeEmployees` | unbounded — revisit if either passes ~1 000 |

## Companion rules

- Anything paginated needs a **single-doc listener** for its detail screen, or deep links
  break once the list window no longer contains the item (this exact bug shipped briefly).
- When merging a live head with fetched pages, key by id and let the **live copy win**.
- Prefer `getCountFromServer` / `getAggregateFromServer` over reading docs to count or sum:
  billed one read per 1 000 scanned, and `sum('bytes')` measures image storage without
  downloading a single blob.
- Client-side `fuzzyFilter` over the whole catalogue runs per keystroke — always feed it
  `useDeferredValue(search)`.
