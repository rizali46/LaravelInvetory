import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  writeBatch,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db, googleProvider, OperationType, handleFirestoreError } from './firebase';

type ProductStatus = 'active' | 'low_stock' | 'out_of_stock' | 'archived';
type ChangeType = 'stock_adjustment' | 'price_update' | 'new_product' | 'product_edit';

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  minStock: number;
  status: ProductStatus;
  ownerId: string;
  lastNote: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

interface UpdateLog {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  changeType: ChangeType;
  previousStock: number;
  newStock: number;
  previousPrice: number;
  newPrice: number;
  note: string;
  ownerId: string;
  createdAt: Timestamp | null;
}

const defaultForm = {
  name: '',
  sku: '',
  category: 'Pakaian',
  price: '',
  stock: '',
  minStock: '5',
  lastNote: '',
};

const contohBarang = [
  {
    name: 'Kemeja Flanel Lengan Panjang',
    sku: 'BRG-001',
    category: 'Pakaian',
    price: 185000,
    stock: 35,
    minStock: 10,
    lastNote: 'Stok awal masuk gudang',
  },
  {
    name: 'Kaos Polos Cotton Combed 30s',
    sku: 'BRG-002',
    category: 'Pakaian',
    price: 65000,
    stock: 4,
    minStock: 10,
    lastNote: 'Sisa stok ukuran L',
  },
  {
    name: 'Tas Selempang Kanvas',
    sku: 'BRG-003',
    category: 'Aksesoris',
    price: 120000,
    stock: 0,
    minStock: 5,
    lastNote: 'Habis terjual',
  },
  {
    name: 'Tumbler Stainless 500ml',
    sku: 'BRG-004',
    category: 'Perlengkapan',
    price: 95000,
    stock: 22,
    minStock: 8,
    lastNote: 'Restock batch baru',
  },
];

const daftarPelanggan = [
  {
    id: 'cust-1',
    nama: 'Budi Santoso',
    email: 'budi.santoso@gmail.com',
    telepon: '0812-3456-7890',
    kota: 'Jakarta Selatan',
    terdaftar: '12 Jan 2026',
    status: 'Aktif',
  },
  {
    id: 'cust-2',
    nama: 'Siti Aminah',
    email: 'sitiaminah99@yahoo.com',
    telepon: '0813-9876-5432',
    kota: 'Bandung',
    terdaftar: '04 Feb 2026',
    status: 'Aktif',
  },
  {
    id: 'cust-3',
    nama: 'Andi Wijaya',
    email: 'andiwijaya@outlook.com',
    telepon: '0857-1122-3344',
    kota: 'Surabaya',
    terdaftar: '19 Mar 2026',
    status: 'Aktif',
  },
  {
    id: 'cust-4',
    nama: 'Rina Lestari',
    email: 'rinalestari.id@gmail.com',
    telepon: '0821-5566-7788',
    kota: 'Yogyakarta',
    terdaftar: '02 Mei 2026',
    status: 'Aktif',
  },
  {
    id: 'cust-5',
    nama: 'Dewi Anggraini',
    email: 'dewi.anggraini@gmail.com',
    telepon: '0811-2233-4455',
    kota: 'Semarang',
    terdaftar: '25 Agu 2026',
    status: 'Nonaktif',
  },
  {
    id: 'cust-6',
    nama: 'Reza Pratama',
    email: 'rezapratama@gmail.com',
    telepon: '0819-8877-6655',
    kota: 'Medan',
    terdaftar: '03 Nov 2026',
    status: 'Aktif',
  },
];

function getStatus(stock: number, minStock: number): ProductStatus {
  if (stock <= 0) return 'out_of_stock';
  if (stock <= minStock) return 'low_stock';
  return 'active';
}

function cleanSku(val: string) {
  return val.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '-').slice(0, 40);
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatRupiah(num: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatTanggal(ts: Timestamp | null) {
  if (!ts || typeof ts.toDate !== 'function') return 'Baru saja';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts.toDate());
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submittingAuth, setSubmittingAuth] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [logs, setLogs] = useState<UpdateLog[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [menu, setMenu] = useState<'produk' | 'pelanggan' | 'riwayat'>('produk');
  const [filterStatus, setFilterStatus] = useState<'all' | ProductStatus>('all');
  const [cari, setCari] = useState('');

  const [editStockId, setEditStockId] = useState<string | null>(null);
  const [stockVal, setStockVal] = useState('');
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [priceVal, setPriceVal] = useState('');
  const [hapusId, setHapusId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Product | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [formErr, setFormErr] = useState('');
  const [savingForm, setSavingForm] = useState(false);

  const [notif, setNotif] = useState<{ text: string; isError?: boolean } | null>(null);

  const tampilPesan = (text: string, isError = false) => {
    setNotif({ text, isError });
    setTimeout(() => {
      setNotif((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoadingAuth(false);
      if (!u) {
        setProducts([]);
        setLogs([]);
        setLoadingData(false);
      }
    });
  }, []);

  useEffect(() => {
    if (loadingAuth || !user) return;
    setLoadingData(true);

    const qProducts = query(collection(db, 'products'), where('ownerId', '==', user.uid));
    const unsubProd = onSnapshot(
      qProducts,
      (snap) => {
        const list: Product[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: String(data.name ?? ''),
            sku: String(data.sku ?? ''),
            category: String(data.category ?? 'Umum'),
            price: Number(data.price ?? 0),
            stock: Number(data.stock ?? 0),
            minStock: Number(data.minStock ?? 5),
            status: (data.status as ProductStatus) || 'active',
            ownerId: String(data.ownerId ?? user.uid),
            lastNote: String(data.lastNote ?? ''),
            createdAt: data.createdAt ?? null,
            updatedAt: data.updatedAt ?? null,
          };
        });
        list.sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
        setProducts(list);
        setLoadingData(false);
      },
      (err) => {
        setLoadingData(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'products');
        } catch {
          tampilPesan('Gagal mengambil data barang.', true);
        }
      }
    );

    const qLogs = query(collection(db, 'product_updates'), where('ownerId', '==', user.uid));
    const unsubLogs = onSnapshot(
      qLogs,
      (snap) => {
        const items: UpdateLog[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            productId: String(data.productId ?? ''),
            productName: String(data.productName ?? ''),
            sku: String(data.sku ?? ''),
            changeType: (data.changeType as ChangeType) || 'product_edit',
            previousStock: Number(data.previousStock ?? 0),
            newStock: Number(data.newStock ?? 0),
            previousPrice: Number(data.previousPrice ?? 0),
            newPrice: Number(data.newPrice ?? 0),
            note: String(data.note ?? ''),
            ownerId: String(data.ownerId ?? user.uid),
            createdAt: data.createdAt ?? null,
          };
        });
        items.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setLogs(items);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'product_updates');
        } catch {
          // ignore
        }
      }
    );

    return () => {
      unsubProd();
      unsubLogs();
    };
  }, [loadingAuth, user]);

  const loginGoogle = async () => {
    setAuthError('');
    setSubmittingAuth(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Gagal login dengan Google.');
    } finally {
      setSubmittingAuth(false);
    }
  };

  const submitEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setSubmittingAuth(true);
    try {
      if (isRegister) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setAuthError(
          'Login email belum diaktifkan di Firebase Console. Silakan klik tombol Masuk dengan Google di atas.'
        );
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setAuthError('Email atau password salah.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Gagal masuk.');
      }
    } finally {
      setSubmittingAuth(false);
    }
  };

  const isiContohData = async () => {
    if (!user) return;
    setLoadingData(true);
    const batch = writeBatch(db);

    try {
      for (const item of contohBarang) {
        const pid = makeId('prod');
        const uid = makeId('upd');
        const status = getStatus(item.stock, item.minStock);

        batch.set(doc(db, 'products', pid), {
          name: item.name,
          sku: item.sku,
          category: item.category,
          price: item.price,
          stock: item.stock,
          minStock: item.minStock,
          status,
          ownerId: user.uid,
          lastNote: item.lastNote,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'product_updates', uid), {
          productId: pid,
          productName: item.name,
          sku: item.sku,
          changeType: 'new_product',
          previousStock: 0,
          newStock: item.stock,
          previousPrice: 0,
          newPrice: item.price,
          note: item.lastNote,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      tampilPesan('Data contoh berhasil ditambahkan.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'products');
      } catch {
        tampilPesan('Gagal mengisi data contoh.', true);
      }
    } finally {
      setLoadingData(false);
    }
  };

  const updateStok = async (item: Product, stokBaru: number, catatan?: string) => {
    if (!user) return;
    const nilai = Math.max(0, Math.min(1000000, Math.round(stokBaru)));
    if (nilai === item.stock) {
      setEditStockId(null);
      return;
    }

    setSavingId(item.id);
    const statusBaru = getStatus(nilai, item.minStock);
    const selisih = nilai - item.stock;
    const note = (
      catatan || `Stok diubah (${selisih > 0 ? `+${selisih}` : selisih}) jadi ${nilai}`
    ).slice(0, 200);

    const batch = writeBatch(db);
    batch.update(doc(db, 'products', item.id), {
      stock: nilai,
      status: statusBaru,
      lastNote: note,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'product_updates', makeId('upd')), {
      productId: item.id,
      productName: item.name,
      sku: item.sku,
      changeType: 'stock_adjustment',
      previousStock: item.stock,
      newStock: nilai,
      previousPrice: item.price,
      newPrice: item.price,
      note,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      setEditStockId(null);
      tampilPesan(`Stok ${item.name} disimpan (${nilai}).`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `products/${item.id}`);
      } catch {
        tampilPesan('Gagal mengubah stok.', true);
      }
    } finally {
      setSavingId(null);
    }
  };

  const updateHarga = async (item: Product, inputHarga: string) => {
    if (!user) return;
    const angka = Math.round(parseFloat(inputHarga));
    if (isNaN(angka) || angka < 0 || angka > 10000000) {
      tampilPesan('Masukkan harga antara 0 sampai 10.000.000', true);
      return;
    }
    if (angka === item.price) {
      setEditPriceId(null);
      return;
    }

    setSavingId(item.id);
    const note = `Harga diubah dari ${formatRupiah(item.price)} ke ${formatRupiah(angka)}`.slice(
      0,
      200
    );

    const batch = writeBatch(db);
    batch.update(doc(db, 'products', item.id), {
      price: angka,
      lastNote: note,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'product_updates', makeId('upd')), {
      productId: item.id,
      productName: item.name,
      sku: item.sku,
      changeType: 'price_update',
      previousStock: item.stock,
      newStock: item.stock,
      previousPrice: item.price,
      newPrice: angka,
      note,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      setEditPriceId(null);
      tampilPesan(`Harga ${item.name} diperbarui.`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `products/${item.id}`);
      } catch {
        tampilPesan('Gagal mengubah harga.', true);
      }
    } finally {
      setSavingId(null);
    }
  };

  const bukaModalTambah = () => {
    setEditItem(null);
    const urutan = String(products.length + 1).padStart(3, '0');
    setForm({ ...defaultForm, sku: `BRG-${urutan}` });
    setFormErr('');
    setShowModal(true);
  };

  const bukaModalEdit = (item: Product) => {
    setEditItem(item);
    setForm({
      name: item.name,
      sku: item.sku,
      category: item.category,
      price: String(item.price),
      stock: String(item.stock),
      minStock: String(item.minStock),
      lastNote: '',
    });
    setFormErr('');
    setShowModal(true);
  };

  const simpanProduk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormErr('');

    const name = form.name.trim().slice(0, 120);
    const sku = cleanSku(form.sku);
    const category = form.category.trim().slice(0, 60);
    const price = Math.round(Number(form.price));
    const stock = Math.round(Number(form.stock));
    const minStock = Math.round(Number(form.minStock));

    if (!name || !sku || !category) {
      setFormErr('Nama barang, SKU, dan kategori wajib diisi.');
      return;
    }
    if (isNaN(price) || price < 0 || price > 10000000) {
      setFormErr('Harga tidak valid (maksimal Rp 10.000.000).');
      return;
    }
    if (isNaN(stock) || stock < 0 || stock > 1000000) {
      setFormErr('Jumlah stok tidak valid.');
      return;
    }

    const status = getStatus(stock, minStock);
    setSavingForm(true);
    const batch = writeBatch(db);

    try {
      if (editItem) {
        const note = (form.lastNote.trim() || `Update data barang ${sku}`).slice(0, 200);
        batch.update(doc(db, 'products', editItem.id), {
          name,
          sku,
          category,
          price,
          stock,
          minStock,
          status,
          lastNote: note,
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'product_updates', makeId('upd')), {
          productId: editItem.id,
          productName: name,
          sku,
          changeType: 'product_edit',
          previousStock: editItem.stock,
          newStock: stock,
          previousPrice: editItem.price,
          newPrice: price,
          note,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });

        await batch.commit();
        tampilPesan('Perubahan barang disimpan.');
      } else {
        const pid = makeId('prod');
        const note = (form.lastNote.trim() || `Barang baru (${stock} pcs)`).slice(0, 200);

        batch.set(doc(db, 'products', pid), {
          name,
          sku,
          category,
          price,
          stock,
          minStock,
          status,
          ownerId: user.uid,
          lastNote: note,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'product_updates', makeId('upd')), {
          productId: pid,
          productName: name,
          sku,
          changeType: 'new_product',
          previousStock: 0,
          newStock: stock,
          previousPrice: 0,
          newPrice: price,
          note,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });

        await batch.commit();
        tampilPesan('Barang baru berhasil ditambahkan.');
      }
      setShowModal(false);
    } catch (err) {
      try {
        handleFirestoreError(err, editItem ? OperationType.UPDATE : OperationType.CREATE, 'products');
      } catch {
        setFormErr('Gagal menyimpan data. Pastikan input sudah benar.');
      }
    } finally {
      setSavingForm(false);
    }
  };

  const hapusProduk = async (item: Product) => {
    setSavingId(item.id);
    try {
      await deleteDoc(doc(db, 'products', item.id));
      setHapusId(null);
      tampilPesan(`${item.name} dihapus.`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `products/${item.id}`);
      } catch {
        tampilPesan('Gagal menghapus barang.', true);
      }
    } finally {
      setSavingId(null);
    }
  };

  const ringkasan = useMemo(() => {
    const totalBarang = products.length;
    const totalStok = products.reduce((sum, p) => sum + p.stock, 0);
    const nilaiStok = products.reduce((sum, p) => sum + p.price * p.stock, 0);
    const stokMenipis = products.filter(
      (p) => p.status === 'low_stock' || p.status === 'out_of_stock'
    ).length;
    return { totalBarang, totalStok, nilaiStok, stokMenipis };
  }, [products]);

  const daftarTampil = useMemo(() => {
    return products.filter((p) => {
      if (filterStatus !== 'all' && p.status !== filterStatus) {
        return false;
      }
      if (cari.trim()) {
        const q = cari.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, filterStatus, cari]);

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500">Memuat...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
          <a
            href="#top"
            className="text-base font-bold text-slate-900 whitespace-nowrap shrink-0"
          >
            Admin Toko
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <a
              href="#login"
              onClick={(e) => {
                e.preventDefault();
                emailRef.current?.focus();
              }}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Data Barang
            </a>
            <a
              href="#login"
              onClick={(e) => {
                e.preventDefault();
                emailRef.current?.focus();
              }}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Akun Pelanggan
            </a>
            <a
              href="#login"
              onClick={(e) => {
                e.preventDefault();
                emailRef.current?.focus();
              }}
              className="hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Riwayat Update
            </a>
          </nav>

          <button
            type="button"
            onClick={() => emailRef.current?.focus()}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Login
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div
            id="login"
            className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-6 shadow-xs"
          >
            <h1 className="text-lg font-bold text-slate-900">
              {isRegister ? 'Daftar Admin' : 'Login Admin'}
            </h1>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              Masuk untuk mengatur stok dan harga barang.
            </p>

            {authError && (
              <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700">
                {authError}
              </div>
            )}

            <button
              type="button"
              disabled={submittingAuth}
              onClick={loginGoogle}
              className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer"
            >
              Masuk dengan Google
            </button>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px bg-slate-200 flex-1" />
              <span className="text-xs text-slate-400">atau</span>
              <div className="h-px bg-slate-200 flex-1" />
            </div>

            <form onSubmit={submitEmailAuth} className="space-y-3.5">
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-slate-700 mb-1">
                  Email
                </label>
                <input
                  ref={emailRef}
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@toko.com"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(!isRegister);
                    setAuthError('');
                  }}
                  className="text-xs text-slate-600 hover:text-slate-900 underline cursor-pointer"
                >
                  {isRegister ? 'Sudah punya akun?' : 'Buat akun baru'}
                </button>

                <button
                  type="submit"
                  disabled={submittingAuth}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-md cursor-pointer"
                >
                  {isRegister ? 'Daftar' : 'Masuk'}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        <span className="text-base font-bold text-slate-900 whitespace-nowrap shrink-0">
          Admin Toko
        </span>

        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
          <button
            type="button"
            onClick={() => setMenu('produk')}
            className={`py-1 whitespace-nowrap shrink-0 cursor-pointer ${
              menu === 'produk' ? 'text-red-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            Data Barang ({ringkasan.totalBarang})
          </button>
          <button
            type="button"
            onClick={() => setMenu('pelanggan')}
            className={`py-1 whitespace-nowrap shrink-0 cursor-pointer ${
              menu === 'pelanggan' ? 'text-red-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            Akun Pelanggan ({daftarPelanggan.length})
          </button>
          <button
            type="button"
            onClick={() => setMenu('riwayat')}
            className={`py-1 whitespace-nowrap shrink-0 cursor-pointer ${
              menu === 'riwayat' ? 'text-red-600 font-semibold' : 'hover:text-slate-900'
            }`}
          >
            Riwayat Update
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={bukaModalTambah}
            className="px-3.5 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 whitespace-nowrap cursor-pointer"
          >
            + Barang Baru
          </button>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md whitespace-nowrap cursor-pointer"
          >
            Keluar
          </button>
        </div>
      </header>

      {notif && (
        <div
          className={`px-6 py-2 text-xs flex items-center justify-between border-b ${
            notif.isError
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
        >
          <span>{notif.text}</span>
          <button
            type="button"
            onClick={() => setNotif(null)}
            className="underline ml-4 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      <main className="max-w-6xl w-full mx-auto p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Total Jenis Barang</div>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {ringkasan.totalBarang}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Total Stok Gudang</div>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {ringkasan.totalStok} pcs
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Perlu Restock</div>
            <div className="text-xl font-bold text-amber-700 mt-1 tabular-nums">
              {ringkasan.stokMenipis} barang
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-xs text-slate-500">Nilai Barang</div>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {formatRupiah(ringkasan.nilaiStok)}
            </div>
          </div>
        </div>

        {menu === 'produk' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={cari}
                  onChange={(e) => setCari(e.target.value)}
                  placeholder="Cari nama barang atau SKU..."
                  className="w-full sm:w-60 px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                />

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md text-xs">
                  <button
                    type="button"
                    onClick={() => setFilterStatus('all')}
                    className={`px-2.5 py-1 rounded cursor-pointer ${
                      filterStatus === 'all'
                        ? 'bg-white font-medium text-slate-900'
                        : 'text-slate-600'
                    }`}
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus('active')}
                    className={`px-2.5 py-1 rounded cursor-pointer ${
                      filterStatus === 'active'
                        ? 'bg-white font-medium text-slate-900'
                        : 'text-slate-600'
                    }`}
                  >
                    Ada Stok
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus('low_stock')}
                    className={`px-2.5 py-1 rounded cursor-pointer ${
                      filterStatus === 'low_stock'
                        ? 'bg-white font-medium text-slate-900'
                        : 'text-slate-600'
                    }`}
                  >
                    Menipis
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus('out_of_stock')}
                    className={`px-2.5 py-1 rounded cursor-pointer ${
                      filterStatus === 'out_of_stock'
                        ? 'bg-white font-medium text-slate-900'
                        : 'text-slate-600'
                    }`}
                  >
                    Habis
                  </button>
                </div>
              </div>

              {products.length === 0 && !loadingData && (
                <button
                  type="button"
                  onClick={isiContohData}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                >
                  Isi Data Contoh
                </button>
              )}
            </div>

            {loadingData ? (
              <div className="p-8 text-center text-xs text-slate-500">Memuat data barang...</div>
            ) : daftarTampil.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <p className="text-sm font-medium text-slate-800">Belum ada data barang.</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={bukaModalTambah}
                    className="px-3.5 py-2 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 cursor-pointer"
                  >
                    + Tambah Barang
                  </button>
                  {products.length === 0 && (
                    <button
                      type="button"
                      onClick={isiContohData}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                    >
                      Isi Data Contoh
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Nama Barang</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4 text-right">Harga</th>
                      <th className="py-2.5 px-4 text-right">Stok</th>
                      <th className="py-2.5 px-4">Catatan Terakhir</th>
                      <th className="py-2.5 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {daftarTampil.map((item) => {
                      const sedangSimpan = savingId === item.id;

                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 text-sm">{item.name}</div>
                            <div className="text-slate-500 mt-0.5">
                              <span className="font-mono">{item.sku}</span> · {item.category}
                            </div>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            {item.status === 'active' && (
                              <span className="text-emerald-700 font-medium">Tersedia</span>
                            )}
                            {item.status === 'low_stock' && (
                              <span className="text-amber-700 font-medium">Stok Menipis</span>
                            )}
                            {item.status === 'out_of_stock' && (
                              <span className="text-red-700 font-medium">Habis</span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            {editPriceId === item.id ? (
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  value={priceVal}
                                  onChange={(e) => setPriceVal(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') updateHarga(item, priceVal);
                                    if (e.key === 'Escape') setEditPriceId(null);
                                  }}
                                  className="w-24 px-2 py-1 text-right border border-slate-400 rounded"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  disabled={sedangSimpan}
                                  onClick={() => updateHarga(item, priceVal)}
                                  className="px-2 py-1 bg-slate-900 text-white rounded cursor-pointer"
                                >
                                  OK
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditPriceId(item.id);
                                  setPriceVal(String(item.price));
                                }}
                                className="hover:underline font-medium text-slate-900 cursor-pointer"
                                title="Klik untuk ganti harga"
                              >
                                {formatRupiah(item.price)}
                              </button>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                            {editStockId === item.id ? (
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  value={stockVal}
                                  onChange={(e) => setStockVal(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      updateStok(item, parseInt(stockVal, 10) || 0);
                                    }
                                    if (e.key === 'Escape') setEditStockId(null);
                                  }}
                                  className="w-16 px-2 py-1 text-right border border-slate-400 rounded"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  disabled={sedangSimpan}
                                  onClick={() => updateStok(item, parseInt(stockVal, 10) || 0)}
                                  className="px-2 py-1 bg-slate-900 text-white rounded cursor-pointer"
                                >
                                  OK
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={sedangSimpan || item.stock <= 0}
                                  onClick={() => updateStok(item, item.stock - 1)}
                                  className="w-6 h-6 border border-slate-200 rounded bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditStockId(item.id);
                                    setStockVal(String(item.stock));
                                  }}
                                  className="min-w-10 px-1.5 py-0.5 text-center font-medium hover:bg-slate-100 rounded cursor-pointer"
                                  title="Klik untuk ketik jumlah stok"
                                >
                                  {item.stock}
                                </button>
                                <button
                                  type="button"
                                  disabled={sedangSimpan}
                                  onClick={() => updateStok(item, item.stock + 1)}
                                  className="w-6 h-6 border border-slate-200 rounded bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                            {item.lastNote || '-'}
                            <span className="text-slate-400 ml-1.5">
                              ({formatTanggal(item.updatedAt)})
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {hapusId === item.id ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={sedangSimpan}
                                  onClick={() => hapusProduk(item)}
                                  className="text-red-600 font-semibold hover:underline cursor-pointer"
                                >
                                  Ya, Hapus
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setHapusId(null)}
                                  className="text-slate-500 hover:underline cursor-pointer"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => bukaModalEdit(item)}
                                  className="text-slate-700 hover:text-slate-900 hover:underline cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setHapusId(item.id)}
                                  className="text-red-600 hover:underline cursor-pointer"
                                >
                                  Hapus
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {menu === 'pelanggan' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">Daftar Akun Pelanggan</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Nama Pelanggan</th>
                    <th className="py-2.5 px-4">Email</th>
                    <th className="py-2.5 px-4">No. Telepon</th>
                    <th className="py-2.5 px-4">Kota</th>
                    <th className="py-2.5 px-4">Terdaftar</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {daftarPelanggan.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium text-slate-900">{p.nama}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono">{p.email}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono tabular-nums">
                        {p.telepon}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{p.kota}</td>
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap">{p.terdaftar}</td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {p.status === 'Aktif' ? (
                          <span className="text-emerald-700 font-medium">Aktif</span>
                        ) : (
                          <span className="text-slate-500 font-medium">Nonaktif</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {menu === 'riwayat' && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">Riwayat Perubahan Stok & Harga</h2>
            </div>

            {logs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Belum ada riwayat perubahan.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Waktu</th>
                      <th className="py-2.5 px-4">Barang</th>
                      <th className="py-2.5 px-4 text-right">Stok</th>
                      <th className="py-2.5 px-4 text-right">Harga</th>
                      <th className="py-2.5 px-4">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                          {formatTanggal(log.createdAt)}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {log.productName} <span className="text-slate-400">({log.sku})</span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {log.previousStock} &rarr; {log.newStock}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {formatRupiah(log.previousPrice)} &rarr; {formatRupiah(log.newPrice)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{log.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md p-6 shadow-md">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              {editItem ? 'Edit Barang' : 'Tambah Barang Baru'}
            </h3>

            {formErr && (
              <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 rounded">
                {formErr}
              </div>
            )}

            <form onSubmit={simpanProduk} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Barang
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kode SKU</label>
                  <input
                    type="text"
                    required
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kategori</label>
                  <input
                    type="text"
                    required
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Harga (Rp)
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Stok</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Min. Stok</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={form.minStock}
                    onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Catatan (Opsional)
                </label>
                <input
                  type="text"
                  value={form.lastNote}
                  onChange={(e) => setForm({ ...form, lastNote: e.target.value })}
                  placeholder="Contoh: Barang baru datang"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingForm}
                  className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                >
                  {savingForm ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
