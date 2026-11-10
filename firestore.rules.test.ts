import {
  assertFails,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, updateDoc, getDocs, collection, serverTimestamp, Timestamp } from 'firebase/firestore';

/**
 * Firestore Security Rules Test Suite — Verifying all "Dirty Dozen" adversarial payloads
 * return PERMISSION_DENIED.
 */
export async function runDirtyDozenSecurityTests() {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'gen-lang-client-0133847423',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  const aliceCtx = testEnv.authenticatedContext('user_alice', {
    email: 'alice@example.com',
    email_verified: true,
  });
  const unverifiedCtx = testEnv.authenticatedContext('user_unverified', {
    email: 'unverified@example.com',
    email_verified: false,
  });

  const aliceDb = aliceCtx.firestore();
  const unverifiedDb = unverifiedCtx.firestore();

  const baseProduct = {
    name: 'Minimalist Ceramic Mug',
    sku: 'MUG-001',
    category: 'Homeware',
    price: 28,
    stock: 45,
    minStock: 10,
    status: 'active',
    ownerId: 'user_alice',
    lastNote: 'Initial stock entry',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // 1. Identity Spoofing on Product Creation
  await assertFails(
    setDoc(doc(aliceDb, 'products/prod_spoof'), {
      ...baseProduct,
      ownerId: 'user_bob',
    })
  );

  // 2. Unverified Email Write
  await assertFails(
    setDoc(doc(unverifiedDb, 'products/prod_unverified'), {
      ...baseProduct,
      ownerId: 'user_unverified',
    })
  );

  // 3. Shadow / Ghost Field Injection on Create
  await assertFails(
    setDoc(doc(aliceDb, 'products/prod_shadow'), {
      ...baseProduct,
      isSuperAdmin: true,
    })
  );

  // Seed a valid product in test environment to test update & query attacks
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'products/prod_valid'), {
      ...baseProduct,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminDb, 'products/prod_archived'), {
      ...baseProduct,
      status: 'archived',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminDb, 'products/prod_bob'), {
      ...baseProduct,
      ownerId: 'user_bob',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(adminDb, 'product_updates/upd_valid'), {
      productId: 'prod_valid',
      productName: 'Minimalist Ceramic Mug',
      sku: 'MUG-001',
      changeType: 'new_product',
      previousStock: 0,
      newStock: 45,
      previousPrice: 0,
      newPrice: 28,
      note: 'Created product',
      ownerId: 'user_alice',
      createdAt: Timestamp.now(),
    });
  });

  // 4. Shadow Field Injection on Update
  await assertFails(
    updateDoc(doc(aliceDb, 'products/prod_valid'), {
      price: 30,
      discountHack: 99,
      updatedAt: serverTimestamp(),
    })
  );

  // 5. Value Poisoning on Whitelisted Update Key (negative stock)
  await assertFails(
    updateDoc(doc(aliceDb, 'products/prod_valid'), {
      stock: -50,
      updatedAt: serverTimestamp(),
    })
  );

  // 6. Denial-of-Wallet Oversized String
  await assertFails(
    setDoc(doc(aliceDb, 'products/prod_oversized'), {
      ...baseProduct,
      name: 'A'.repeat(500),
    })
  );

  // 7. Immortal Field Mutation (changing ownerId on update)
  await assertFails(
    updateDoc(doc(aliceDb, 'products/prod_valid'), {
      ownerId: 'user_bob',
      updatedAt: serverTimestamp(),
    })
  );

  // 8. Client Timestamp Forgery
  await assertFails(
    setDoc(doc(aliceDb, 'products/prod_forged_time'), {
      ...baseProduct,
      createdAt: Timestamp.fromMillis(1000000),
    })
  );

  // 9. Terminal State Bypass (updating an archived product as non-admin)
  await assertFails(
    updateDoc(doc(aliceDb, 'products/prod_archived'), {
      price: 15,
      lastNote: 'Attempting update on archived item',
      updatedAt: serverTimestamp(),
    })
  );

  // 10. Orphaned Audit Log Write (non-existent productId)
  await assertFails(
    setDoc(doc(aliceDb, 'product_updates/upd_orphan'), {
      productId: 'ghost_prod_999',
      productName: 'Ghost Item',
      sku: 'GHOST-1',
      changeType: 'stock_adjustment',
      previousStock: 10,
      newStock: 5,
      previousPrice: 20,
      newPrice: 20,
      note: 'Orphaned update',
      ownerId: 'user_alice',
      createdAt: serverTimestamp(),
    })
  );

  // 11. Audit History Tampering (updating an immutable ProductUpdate document)
  await assertFails(
    updateDoc(doc(aliceDb, 'product_updates/upd_valid'), {
      newPrice: 1,
    })
  );

  // 12. Cross-Tenant List Scraping (unfiltered list query across all owners)
  await assertFails(getDocs(collection(aliceDb, 'products')));

  await testEnv.cleanup();
}
