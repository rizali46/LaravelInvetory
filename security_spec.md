# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Strict Ownership & Verified Identity**: Every `Product` and `ProductUpdate` document must belong to an authenticated user (`ownerId == request.auth.uid`) with a verified email (`request.auth.token.email_verified == true`), or an explicitly verified administrator.
2. **Schema & Volumetric Bounds**: All fields are strictly allowlisted via `hasAll` and `hasOnly`. Every string enforces `.size()` limits and regex patterns (`sku` and IDs match `^[a-zA-Z0-9_\-]+$`). Stock quantities must be non-negative integers (`0..1,000,000`), and prices must be non-negative numbers (`0..10,000,000`).
3. **Temporal & Relational Integrity**: `createdAt` and `updatedAt` must equal `request.time`. `ownerId` and `createdAt` are immutable on updates. A `ProductUpdate` audit log entry cannot be created unless its referenced `/products/{productId}` exists (`exists` or `existsAfter`), and `ProductUpdate` documents are strictly immutable once created.
4. **Terminal State Locking**: Once a `Product` reaches `status == 'archived'`, standard updates are blocked unless performed by a verified `isAdmin()`.
5. **Query Enforcer**: `allow list` on `/products` and `/product_updates` strictly enforces `resource.data.ownerId == request.auth.uid` without `get()`/`exists()` calls.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Identity Spoofing on Product Creation**: Authenticated user `user_A` attempts to create `/products/prod_1` with `ownerId: "user_B"`.
2. **Unverified Email Write**: Authenticated user `user_A` with `email_verified: false` attempts to create a valid product.
3. **Shadow / Ghost Field Injection on Create**: User sends a valid product payload plus `"isSuperAdmin": true`.
4. **Shadow Field Injection on Update**: User updates a product with an extra undeclared field `"discountHack": 99`.
5. **Value Poisoning on Whitelisted Update Key**: User updates `stock` with a negative integer `-50` or string `"lots"`.
6. **Denial-of-Wallet Oversized String**: User creates a product with a 500-character `name` (exceeding `maxLength: 120`) or invalid `sku` with spaces/scripts.
7. **Immortal Field Mutation**: User attempts to change `ownerId` or `createdAt` during an `update` on `/products/{productId}`.
8. **Client Timestamp Forgery**: User supplies a backdated `createdAt` or `updatedAt` timestamp instead of `request.time`.
9. **Terminal State Bypass**: Non-admin owner attempts to update price or stock on a product whose existing `status` is `'archived'`.
10. **Orphaned Audit Log Write**: User attempts to create `/product_updates/upd_1` referencing a non-existent `productId: "ghost_prod_999"`.
11. **Audit History Tampering**: User attempts to `update` an existing `/product_updates/{updateId}` record to hide a price change.
12. **Cross-Tenant List Scraping**: Authenticated user `user_A` attempts an unfiltered `list` query across `/products` to read `user_B`'s inventory.
