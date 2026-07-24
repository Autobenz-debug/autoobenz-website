const state = {
  products: [],
  categories: [],
  brands: [],
  types: [],
  cart: JSON.parse(localStorage.getItem("autoobenz-cart-v1") || "[]"),
  currency: localStorage.getItem("autoobenz-currency-v1") || "KWD",
  customerSession: null,
  customerProfile: null,
};

const app = document.querySelector("#app");
const cartCount = document.querySelector("#cartCount");
const cartDrawer = document.querySelector("#cartDrawer");
const mobileNav = document.querySelector("#mobileNav");
const CUSTOMER_SESSION_KEY = "autoobenz-customer-session-v1";
const CURRENCY_KEY = "autoobenz-currency-v1";
let revealObserver = null;

document.documentElement.classList.add("app-booting");
app.innerHTML = `
  <section class="app-loading" aria-label="جاري تحميل الموقع">
    <span></span>
  </section>
`;

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

function resetPageScroll() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

const currencyRates = {
  KWD: { label: "الكويت", code: "KWD", symbol: "د.ك", rate: 1, decimals: 1 },
  SAR: { label: "السعودية", code: "SAR", symbol: "ر.س", rate: 12.2, decimals: 0 },
  AED: { label: "الإمارات", code: "AED", symbol: "د.إ", rate: 11.94, decimals: 0 },
  QAR: { label: "قطر", code: "QAR", symbol: "ر.ق", rate: 11.85, decimals: 0 },
  BHD: { label: "البحرين", code: "BHD", symbol: "د.ب", rate: 1.22, decimals: 2 },
  OMR: { label: "عمان", code: "OMR", symbol: "ر.ع", rate: 1.25, decimals: 2 },
  USD: { label: "أمريكا", code: "USD", symbol: "$", rate: 3.25, decimals: 0 },
};
const currencyOrder = ["KWD", "SAR", "AED", "QAR", "BHD", "OMR", "USD"];
if (!currencyRates[state.currency]) state.currency = "KWD";

const selectedCurrency = () => currencyRates[state.currency] || currencyRates.KWD;

const money = (value) => {
  const currency = selectedCurrency();
  if (currency.code !== "KWD") {
    const converted = Number(value || 0) * currency.rate;
    const options = { maximumFractionDigits: currency.decimals };
    const amount = converted.toLocaleString("en-US", options);
    return currency.code === "USD" ? `${currency.symbol}${amount}` : `${amount} ${currency.symbol}`;
  }
  const options = value >= 100 ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 1 };
  return `${Number(value || 0).toLocaleString("en-US", options)} د.ك`;
};

const currencyOptions = () => currencyOrder.map((code) => {
  const currency = currencyRates[code];
  return `<option value="${code}" ${state.currency === code ? "selected" : ""}>${currency.label} - \u200e${currency.code}\u200e</option>`;
}).join("");

function updateCurrencyControls() {
  document.querySelectorAll("[data-currency-select]").forEach((select) => {
    const focused = document.activeElement === select;
    select.innerHTML = currencyOptions();
    select.value = state.currency;
    if (focused) select.focus();
  });
}

function setCurrency(code) {
  state.currency = currencyRates[code] ? code : "KWD";
  localStorage.setItem(CURRENCY_KEY, state.currency);
  updateCurrencyControls();
  render({ resetScroll: false });
}

const imgLocal = (url) => {
  if (!url) return "/assets/images/autoobenz-logo.png";
  if (String(url).includes(".supabase.co/storage/")) return url;
  try {
    return `/assets/images/${new URL(url).pathname.split("/").pop()}`;
  } catch {
    return `/assets/images/${String(url).split("/").pop()}`;
  }
};

const brandLogo = (slug) => {
  const map = {
    "mercedes-benz": "brand-mercedes.svg",
    bmw: "brand-bmw.svg",
    v: "brand-porsche.svg",
    "land-rover": "brand-landrover.svg",
    audi: "brand-audi.svg",
    ferrari: "brand-ferrari.svg",
    lamborghini: "brand-lamborghini.svg",
    mclaren: "brand-mclaren.svg",
    "rolls-royce": "brand-rollsroyce.svg",
    bentley: "brand-bentley.svg",
  };
  return `/assets/images/${map[slug] || "autoobenz-logo.png"}`;
};

const brandMarqueeLogo = (slug) => {
  const map = {
    audi: "brand-audi-marquee.svg",
    ferrari: "brand-ferrari-marquee.svg",
    lamborghini: "brand-lamborghini-marquee.svg",
    mclaren: "brand-mclaren-marquee.svg",
    "rolls-royce": "brand-rollsroyce-marquee.svg",
  };
  return map[slug] ? `/assets/images/${map[slug]}` : brandLogo(slug);
};

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const descendants = (slug) => {
  const root = state.categories.find((cat) => cat.slug === slug && Number(cat.parent) === 0);
  const slugs = new Set([slug]);
  if (!root) return slugs;
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift();
    state.categories.forEach((cat) => {
      if (cat.parent === id) {
        slugs.add(cat.slug);
        queue.push(cat.id);
      }
    });
  }
  return slugs;
};

const inBrand = (product, brandSlug) => {
  if (!brandSlug) return true;
  const allowed = descendants(brandSlug);
  return (product.cat_slugs || []).some((slug) => allowed.has(slug));
};

const productBrand = (product) => state.brands.find((brand) => inBrand(product, brand.slug));

const brandProductCount = (brandSlug) => state.products.filter((product) => inBrand(product, brandSlug)).length;

const productImages = (product) => {
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  return images.length ? images : ["/assets/images/autoobenz-logo.png"];
};

const productCategories = (product) => {
  if (Array.isArray(product.categories) && product.categories.length) return product.categories;
  return (product.cat_slugs || [])
    .map((slug) => state.categories.find((category) => category.slug === slug)?.name || slug)
    .filter(Boolean);
};

const preloadImage = (src) => {
  if (!src) return;
  const image = new Image();
  image.src = src;
};

const brandModels = (brandSlug) => {
  const root = state.categories.find((category) => category.slug === brandSlug && Number(category.parent) === 0);
  if (!root) return [];
  return state.categories
    .filter((category) => category.parent === root.id)
    .sort((a, b) => a.name.localeCompare(b.name));
};

const getCustomerSession = () => {
  try {
    return JSON.parse(localStorage.getItem(CUSTOMER_SESSION_KEY) || "null");
  } catch {
    return null;
  }
};

const setCustomerSession = (session) => {
  state.customerSession = session;
  state.customerProfile = session ? state.customerProfile : null;
  if (session) localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(CUSTOMER_SESSION_KEY);
  updateCustomerLinks();
};

function updateCustomerLinks() {
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    link.textContent = state.customerSession ? "حسابي" : "دخول العملاء";
  });
}

const supabaseHeaders = () => ({
  apikey: window.AUTOOBENZ_SUPABASE.publishableKey,
  Authorization: `Bearer ${state.customerSession?.access_token || window.AUTOOBENZ_SUPABASE.publishableKey}`,
});

async function supabaseAuth(path, body, options = {}) {
  const config = window.AUTOOBENZ_SUPABASE;
  if (!config?.url || !config?.publishableKey) throw new Error("Supabase is not configured.");
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.publishableKey,
      "Content-Type": "application/json",
      ...(state.customerSession?.access_token ? { Authorization: `Bearer ${state.customerSession.access_token}` } : {}),
      ...(options.headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await readResponse(response);
  if (!response.ok) throw new Error(result?.error_description || result?.msg || result?.message || "تعذر تنفيذ العملية.");
  return result;
}

async function validateCustomerSession() {
  if (!state.customerSession?.access_token) return false;
  const config = window.AUTOOBENZ_SUPABASE;
  const response = await fetch(`${config.url}/auth/v1/user`, { headers: supabaseHeaders() });
  const user = await readResponse(response);
  if (!response.ok) {
    setCustomerSession(null);
    return false;
  }
  state.customerSession = { ...state.customerSession, user };
  localStorage.setItem(CUSTOMER_SESSION_KEY, JSON.stringify(state.customerSession));
  return true;
}

async function customerSignIn(email, password) {
  const session = await supabaseAuth("token?grant_type=password", { email, password });
  setCustomerSession(session);
  await loadCustomerProfile();
  return session;
}

async function customerSignUp({ email, password, fullName, phone, shippingCountry, shippingCity, shippingAddress }) {
  const session = await supabaseAuth("signup", {
    email,
    password,
    data: {
      full_name: fullName,
      phone,
      shipping_country: shippingCountry,
      shipping_city: shippingCity,
      shipping_address: shippingAddress,
    },
  });
  if (session?.access_token) {
    setCustomerSession(session);
    await saveCustomerProfile({
      full_name: fullName,
      phone,
      email,
      shipping_country: shippingCountry,
      shipping_city: shippingCity,
      shipping_address: shippingAddress,
    });
    await loadCustomerProfile();
  }
  return session;
}

async function customerSignOut() {
  if (state.customerSession?.access_token) {
    await supabaseAuth("logout", null).catch(() => null);
  }
  setCustomerSession(null);
  navigate("/login");
}

async function loadCustomerProfile() {
  const user = state.customerSession?.user;
  if (!user?.id) return null;
  try {
    const rows = await supabaseFetch(`customer_profiles?select=*&id=eq.${encodeURIComponent(user.id)}&limit=1`);
    state.customerProfile = rows?.[0] || null;
  } catch (error) {
    console.warn("Customer profile is not ready.", error);
    state.customerProfile = null;
  }
  return state.customerProfile;
}

async function saveCustomerProfile(profile = {}) {
  const user = state.customerSession?.user;
  if (!user?.id) return null;
  const payload = {
    id: user.id,
    email: profile.email || user.email || state.customerProfile?.email || "",
    full_name: profile.full_name || state.customerProfile?.full_name || "",
    phone: profile.phone || state.customerProfile?.phone || "",
    shipping_country: profile.shipping_country || state.customerProfile?.shipping_country || "",
    shipping_city: profile.shipping_city || state.customerProfile?.shipping_city || "",
    shipping_address: profile.shipping_address || state.customerProfile?.shipping_address || "",
  };
  const rows = await supabaseWrite("customer_profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(payload),
  });
  state.customerProfile = rows?.[0] || payload;
  return state.customerProfile;
}

const supabaseFetch = async (path) => {
  const config = window.AUTOOBENZ_SUPABASE;
  if (!config?.url || !config?.publishableKey) return null;
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json();
};

const readResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const supabaseWrite = async (path, options = {}) => {
  const config = window.AUTOOBENZ_SUPABASE;
  if (!config?.url || !config?.publishableKey) throw new Error("Supabase is not configured.");
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await readResponse(response);
  if (!response.ok) throw new Error(body?.message || body || `Supabase ${response.status}`);
  return body;
};

const localData = async () => {
  const [products, categories, brands, types] = await Promise.all([
    fetch("/assets/data/products.json").then((res) => res.json()),
    fetch("/assets/data/categories.json").then((res) => res.json()),
    fetch("/assets/data/brands.json").then((res) => res.json()),
    fetch("/assets/data/types.json").then((res) => res.json()),
  ]);
  return {
    products: products.sort((a, b) => Number(b.id) - Number(a.id)),
    categories,
    brands,
    types,
  };
};

const normalizeSupabaseProduct = (product) => {
  const brandSlug = product.brands?.slug;
  const categorySlug = product.categories?.slug;
  const typeSlug = product.product_types?.slug;
  const imageUrls = (product.product_images || [])
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((image) => image.image_url);
  return {
    db_id: product.id,
    id: product.old_id ? Number(product.old_id) : product.id,
    name: product.title_ar || product.title_en || "",
    slug: product.slug,
    price: Number(product.price_kwd || 0),
    regular_price: Number(product.compare_at_price_kwd || product.price_kwd || 0),
    images: imageUrls.length ? imageUrls : ["/assets/images/autoobenz-logo.png"],
    cat_slugs: product.cat_slugs?.length ? product.cat_slugs : [brandSlug, categorySlug, typeSlug, product.model].filter(Boolean),
    categories: [product.categories?.name_ar, product.product_types?.name_ar].filter(Boolean),
    description: product.description_ar || product.description_en || "",
  };
};

const supabaseData = async () => {
  const [products, categories, brands, types] = await Promise.all([
    supabaseFetch("products?select=*,brands(slug,name_ar,name_en),categories(slug,name_ar,name_en),product_types(slug,name_ar,name_en),product_images(image_url,sort_order)&is_active=eq.true&order=created_at.desc"),
    supabaseFetch("categories?select=*&order=sort_order.asc"),
    supabaseFetch("brands?select=*&order=sort_order.asc"),
    supabaseFetch("product_types?select=*&order=sort_order.asc"),
  ]);
  if (!products?.length) return null;
  return {
    products: products.map(normalizeSupabaseProduct),
    categories: categories.map((category) => ({
      id: category.old_id || category.id,
      slug: category.slug,
      name: category.name_ar,
      parent: category.parent_old_id || 0,
      count: category.product_count || 0,
    })),
    brands: brands.map((brand) => ({
      slug: brand.slug,
      ar: brand.name_ar,
      en: brand.name_en,
    })),
    types: types.map((type) => ({
      slug: type.slug,
      ar: type.name_ar,
      en: type.name_en,
    })),
  };
};

function navigate(path) {
  history.pushState(null, "", path);
  mobileNav.classList.remove("open");
  closeCart();
  render();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  if (link.target || link.hasAttribute("download")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith(".html") && url.pathname !== "/index.html") return;
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}${url.hash}`);
});

document.addEventListener("pointerover", (event) => {
  const card = event.target.closest("[data-prefetch-image]");
  if (card) preloadImage(card.dataset.prefetchImage);
});

document.addEventListener("touchstart", (event) => {
  const card = event.target.closest("[data-prefetch-image]");
  if (card) preloadImage(card.dataset.prefetchImage);
}, { passive: true });

document.addEventListener("change", (event) => {
  const select = event.target.closest("[data-currency-select]");
  if (!select) return;
  setCurrency(select.value);
});

const themeToggle = document.querySelector("#themeToggle");
if (themeToggle) {
  const syncThemeToggle = () => {
    const isLight = document.documentElement.dataset.theme === "light";
    themeToggle.setAttribute("aria-pressed", String(isLight));
  };
  syncThemeToggle();
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("autoobenz-theme", nextTheme);
    syncThemeToggle();
  });
}

window.addEventListener("popstate", render);

document.querySelector("#menuButton").addEventListener("click", () => {
  mobileNav.classList.toggle("open");
});

document.querySelector("#cartButton").addEventListener("click", openCart);
document.querySelector("#closeCart").addEventListener("click", closeCart);
cartDrawer.addEventListener("click", (event) => {
  if (event.target === cartDrawer) closeCart();
});

function saveCart() {
  localStorage.setItem("autoobenz-cart-v1", JSON.stringify(state.cart));
  renderCart();
}

function addToCart(id, qty = 1) {
  const product = state.products.find((item) => item.id === Number(id));
  if (!product) return;
  const existing = state.cart.find((item) => item.id === product.id);
  if (existing) existing.qty += qty;
  else state.cart.push({ id: product.id, qty });
  saveCart();
  openCart();
}

function setQty(id, qty) {
  if (qty <= 0) state.cart = state.cart.filter((item) => item.id !== id);
  else state.cart = state.cart.map((item) => item.id === id ? { ...item, qty } : item);
  saveCart();
}

function openCart() {
  cartDrawer.classList.add("open");
  cartDrawer.setAttribute("aria-hidden", "false");
}

function closeCart() {
  cartDrawer.classList.remove("open");
  cartDrawer.setAttribute("aria-hidden", "true");
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.qty, 0);
  cartCount.textContent = count;
  const rows = state.cart.map((item) => {
    const product = state.products.find((entry) => entry.id === item.id);
    if (!product) return "";
    return `
      <div class="cart-item">
        <img src="${imgLocal(productImages(product)[0])}" alt="${escapeHtml(product.name)}">
        <div>
          <h4>${escapeHtml(product.name)}</h4>
          <div class="qty-row">
            <button type="button" data-qty="${product.id}" data-step="-1">-</button>
            <span>${item.qty}</span>
            <button type="button" data-qty="${product.id}" data-step="1">+</button>
            <b>${money(product.price * item.qty)}</b>
          </div>
        </div>
        <button class="remove" type="button" data-remove="${product.id}">حذف</button>
      </div>
    `;
  }).join("");
  document.querySelector("#cartItems").innerHTML = rows || `<div class="empty-state"><b>السلة فارغة</b><p>أضف منتجاتك ثم أرسل الطلب عبر واتساب.</p></div>`;
  const total = state.cart.reduce((sum, item) => {
    const product = state.products.find((entry) => entry.id === item.id);
    return sum + (product ? product.price * item.qty : 0);
  }, 0);
  document.querySelector("#cartTotal").textContent = money(total);
  const message = state.cart.map((item) => {
    const product = state.products.find((entry) => entry.id === item.id);
    return product ? `${item.qty} × ${product.name} - ${money(product.price)}` : "";
  }).filter(Boolean).join("\n");
  const checkoutLink = document.querySelector("#checkoutLink");
  checkoutLink.href = state.cart.length ? "/checkout" : "/shop";
  checkoutLink.textContent = state.cart.length ? "إتمام الطلب" : "تصفح المنتجات";
  checkoutLink.setAttribute("data-link", "");
  checkoutLink.removeAttribute("target");
  checkoutLink.removeAttribute("rel");
}

document.querySelector("#cartItems").addEventListener("click", (event) => {
  const qtyButton = event.target.closest("[data-qty]");
  const removeButton = event.target.closest("[data-remove]");
  if (qtyButton) {
    const id = Number(qtyButton.dataset.qty);
    const current = state.cart.find((item) => item.id === id);
    setQty(id, (current?.qty || 0) + Number(qtyButton.dataset.step));
  }
  if (removeButton) setQty(Number(removeButton.dataset.remove), 0);
});

function productCard(product) {
  const brand = productBrand(product);
  const discount = product.regular_price > product.price ? Math.round((1 - product.price / product.regular_price) * 100) : 0;
  return `
    <a class="product-card" href="/product/${product.slug}" data-link data-prefetch-image="${imgLocal(productImages(product)[0])}">
      <div class="product-image">
        <img src="${imgLocal(productImages(product)[0])}" alt="${escapeHtml(product.name)}" loading="lazy">
        ${discount ? `<span class="sale-badge">خصم ${discount}%</span>` : ""}
      </div>
      <div class="product-body">
        ${brand ? `<span class="product-brand">${escapeHtml(brand.ar)}</span>` : ""}
        <div class="product-title">${escapeHtml(product.name)}</div>
        <div class="price-row">
          <span class="price">${money(product.price)}</span>
          ${discount ? `<span class="old-price">${money(product.regular_price)}</span>` : ""}
        </div>
      </div>
    </a>
  `;
}

function hero() {
  return `
    <section class="hero">
      <div class="container">
        <div class="hero-copy">
          <p class="hero-kicker">AUTOOBENZ — KUWAIT</p>
          <h1>سيارتك تستاهل<br><span>كاربون حقيقي</span></h1>
          <p class="hero-lead">بودي كت، ستيرنق، شاشات وإضاءة بجودة الوكالة للسيارات الفاخرة — توصيل لكل الكويت وشحن عالمي.</p>
          <div class="hero-stats">
            <span><i></i>+216 منتج أصلي</span>
            <span><i></i>10 ماركات فاخرة</span>
            <span><i></i>سجل تجاري 525945</span>
          </div>
        </div>
        <form class="car-finder" id="homeFinder">
          <p>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13M5 13h14M5 13v5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-5"></path>
              <circle cx="8" cy="16" r="0.5"></circle>
              <circle cx="16" cy="16" r="0.5"></circle>
            </svg>
            اختر سيارتك وشوف القطع المتوافقة معها فقط
          </p>
          <div>
            <select name="brand" aria-label="الماركة">
              <option value="">الماركة</option>
              ${state.brands.map((brand) => `<option value="${brand.slug}">${brand.ar} — ${brand.en}</option>`).join("")}
            </select>
            <select name="model" class="h-12 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink outline-none transition focus:border-accent" aria-label="الموديل" disabled>
              <option value="" selected>الموديل</option>
            </select>
            <button type="submit" class="h-12 rounded-lg bg-accent px-8 text-sm font-bold text-accent-ink transition hover:brightness-110 disabled:opacity-40" disabled>عرض القطع</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function brandMarquee() {
  const items = [...state.brands, ...state.brands];
  return `
    <div class="brand-marquee" dir="ltr">
      <div class="marquee-track">
        ${items.map((brand) => `
          <span>
            <img alt="" aria-hidden="true" loading="lazy" src="${brandMarqueeLogo(brand.slug)}">
            <b>${escapeHtml(brand.en.toUpperCase())}</b>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderHome() {
  const featured = state.products.slice(-8).reverse();
  app.innerHTML = `
    ${hero()}
    ${brandMarquee()}
    <section class="brands-section">
      <div class="container">
        <div class="center-title">
          <span></span>
          <h2>تسوق بماركتك</h2>
        </div>
        <div class="brand-strip">
          ${state.brands.map((brand) => `
            <a class="brand-card" href="/shop?brand=${brand.slug}" data-link>
              <span class="brand-logo"><img src="${brandLogo(brand.slug)}" alt="${escapeHtml(brand.ar)}"></span>
              <b>${brand.ar}</b>
              <small>${brand.en} · ${brandProductCount(brand.slug)}</small>
            </a>
          `).join("")}
        </div>
      </div>
    </section>
    <section class="promo-section">
      <div class="container">
        <div class="promo-grid">
          <a class="promo-card" href="/shop?type=body-kit" data-link>
            <img src="/assets/images/26499-0.webp" alt="غيّر شخصية سيارتك كاملة">
            <span class="promo-shade"></span>
            <div>
              <p class="text-xs font-bold tracking-widest text-accent">بودي كت كاربون</p>
              <p class="mt-2 text-2xl font-black md:text-3xl">غيّر شخصية سيارتك كاملة</p>
              <span class="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-accent-ink transition group-hover:brightness-110">تصفح البودي كت ←</span>
            </div>
          </a>
          <a class="promo-card" href="/shop?type=steering-wheel" data-link>
            <img src="/assets/images/26476-0.webp" alt="لمستك الخاصة بين يدينك">
            <span class="promo-shade"></span>
            <div>
              <p class="text-xs font-bold tracking-widest text-accent">ستيرنق مخصص</p>
              <p class="mt-2 text-2xl font-black md:text-3xl">لمستك الخاصة بين يدينك</p>
              <span class="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-accent-ink transition group-hover:brightness-110">تصفح الستيرنق ←</span>
            </div>
          </a>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="section-head demand-head">
          <div><span></span><h2>الأكثر طلباً</h2></div>
          <a href="/shop" data-link>عرض الكل ←</a>
        </div>
        <div class="product-grid">${featured.map(productCard).join("")}</div>
      </div>
    </section>
    <section class="categories-section">
      <div class="container">
        <div class="categories-head">
          <span></span>
          <h2>الأقسام</h2>
        </div>
        <div class="categories-grid">
          ${state.types.map((type, index) => `
            <a class="category-tile" style="transition-delay:${index * 50}ms" href="/shop?type=${type.slug}" data-link>${type.ar}</a>
          `).join("")}
        </div>
      </div>
    </section>
    <section class="benefits-section">
      <div class="container">
        <div class="benefits-grid">
          <div><p>توصيل لكل الكويت</p><span>وشحن عالمي لجميع الدول</span></div>
          <div><p>قسّطها على 4 دفعات</p><span>بدون فوائد مع ديمه أو تالي</span></div>
          <div><p>دفع آمن 100%</p><span>KNET وApple Pay والبطاقات</span></div>
          <div><p>دعم واتساب فوري</p><span>نرد عليك بنفس اليوم</span></div>
        </div>
      </div>
    </section>
    <section class="container-x py-16 text-center md:py-20 instagram-section"><div class="reveal in"><h2 class="text-2xl font-black md:text-4xl">+34 ألف متابع على انستغرام</h2><p class="mt-3 text-ink-2">شوف أحدث القطع وتركيبات عملائنا أول بأول</p><a href="https://www.instagram.com/autoobenz/" target="_blank" rel="noopener noreferrer" class="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent px-8 py-3.5 text-sm font-bold text-accent-ink transition hover:brightness-110">@autoobenz — حساب موثّق ✓</a></div></section>
  `;
  const finder = document.querySelector("#homeFinder");
  const brandSelect = finder.querySelector('select[name="brand"]');
  const modelSelect = finder.querySelector('select[name="model"]');
  const submitButton = finder.querySelector('button[type="submit"]');
  const updateFinderButton = () => {
    submitButton.disabled = !brandSelect.value;
  };
  brandSelect.addEventListener("change", () => {
    const models = brandModels(brandSelect.value);
    modelSelect.disabled = !brandSelect.value;
    modelSelect.innerHTML = `<option value="" selected>الموديل</option>${models.map((model) => `<option value="${model.slug}">${escapeHtml(model.name)}</option>`).join("")}`;
    updateFinderButton();
  });
  modelSelect.addEventListener("change", updateFinderButton);
  finder.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    if (data.get("brand")) params.set("brand", data.get("brand"));
    if (data.get("model")) params.set("model", data.get("model"));
    navigate(`/shop${params.toString() ? `?${params}` : ""}`);
  });
}

function renderShop() {
  const params = new URLSearchParams(location.search);
  const selectedBrand = params.get("brand") || "";
  const selectedType = params.get("type") || "";
  const selectedModel = params.get("model") || "";
  const q = params.get("q") || "";
  const modelOptions = selectedBrand ? brandModels(selectedBrand) : [];

  const filtered = filterShopProducts({ selectedBrand, selectedModel, selectedType, q });

  app.innerHTML = `
    <section class="shop-layout">
      <div class="container">
        <h1 class="page-title">${selectedBrand ? `قطع ${state.brands.find((brand) => brand.slug === selectedBrand)?.ar || ""}` : "كل المنتجات"}</h1>
        <form class="filters" id="filtersForm">
          <select name="brand" aria-label="الماركة">
            <option value="">كل الماركات</option>
            ${state.brands.map((brand) => `<option value="${brand.slug}" ${brand.slug === selectedBrand ? "selected" : ""}>${brand.ar} — ${brand.en}</option>`).join("")}
          </select>
          <select name="model" aria-label="الموديل" ${!selectedBrand ? "disabled" : ""}>
            <option value="">كل الموديلات</option>
            ${modelOptions.map((model) => `<option value="${model.slug}" ${model.slug === selectedModel ? "selected" : ""}>${model.name}</option>`).join("")}
          </select>
          <select name="type" aria-label="نوع القطعة">
            <option value="">كل الأقسام</option>
            ${state.types.map((type) => `<option value="${type.slug}" ${type.slug === selectedType ? "selected" : ""}>${type.ar}</option>`).join("")}
          </select>
          <input name="q" value="${escapeHtml(q)}" placeholder="ابحث باسم المنتج..." aria-label="بحث">
        </form>
        <div class="results-line">${filtered.length} منتج</div>
        ${filtered.length ? `<div class="product-grid">${filtered.map(productCard).join("")}</div>` : `<div class="empty-state"><b>ما لقينا نتائج</b><p>جرب تغير الفلتر، أو كلمنا واتساب ونوفر لك القطعة اللي تبيها.</p></div>`}
      </div>
    </section>
  `;

  document.querySelector("#filtersForm").addEventListener("change", updateFilters);
  document.querySelector("#filtersForm").addEventListener("input", (event) => {
    if (event.target.name === "q") updateShopSearch();
  });
  document.querySelector("#filtersForm").addEventListener("submit", (event) => {
    event.preventDefault();
    updateFilters();
  });
  document.querySelector('#filtersForm input[name="q"]').addEventListener("keydown", (event) => {
    if (event.key === "Enter") updateFilters();
  });
}

function filterShopProducts({ selectedBrand, selectedModel, selectedType, q }) {
  const query = q.trim().toLowerCase();
  return state.products.filter((product) => {
    return inBrand(product, selectedBrand)
      && (!selectedModel || product.cat_slugs.includes(selectedModel))
      && (!selectedType || product.cat_slugs.includes(selectedType))
      && (!query || product.name.toLowerCase().includes(query));
  });
}

function currentShopFilters() {
  const form = document.querySelector("#filtersForm");
  const data = new FormData(form);
  return {
    selectedBrand: data.get("brand") || "",
    selectedModel: data.get("model") || "",
    selectedType: data.get("type") || "",
    q: data.get("q") || "",
  };
}

function shopResultsMarkup(products) {
  return products.length
    ? `<div class="product-grid">${products.map(productCard).join("")}</div>`
    : `<div class="empty-state"><b>ما لقينا نتائج</b><p>جرب تغير الفلتر، أو كلمنا واتساب ونوفر لك القطعة اللي تبيها.</p></div>`;
}

function currentFilterParams() {
  const filters = currentShopFilters();
  const params = new URLSearchParams();
  [
    ["brand", filters.selectedBrand],
    ["model", filters.selectedModel],
    ["type", filters.selectedType],
    ["q", filters.q],
  ].forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function updateShopSearch() {
  const filters = currentShopFilters();
  const params = currentFilterParams();
  const filtered = filterShopProducts(filters);
  const resultsLine = document.querySelector(".results-line");
  const resultsBlock = resultsLine?.nextElementSibling;
  history.replaceState(null, "", `/shop${params.toString() ? `?${params}` : ""}`);
  if (resultsLine) resultsLine.textContent = `${filtered.length} منتج`;
  if (resultsBlock) {
    resultsBlock.outerHTML = shopResultsMarkup(filtered);
    observeReveals();
  }
}

function updateFilters() {
  const params = currentFilterParams();
  history.replaceState(null, "", `/shop${params.toString() ? `?${params}` : ""}`);
  renderShop();
}

function renderProduct(slug) {
  const product = state.products.find((item) => item.slug === slug);
  if (!product) {
    renderNotFound();
    return;
  }
  const brand = productBrand(product);
  const related = state.products
    .filter((item) => item.id !== product.id && brand && inBrand(item, brand.slug))
    .slice(0, 4);
  const discount = product.regular_price > product.price ? Math.round((1 - product.price / product.regular_price) * 100) : 0;
  const productUrl = `${location.origin}/product/${product.slug}`;
  const whatsappText = encodeURIComponent(`مرحبا، أبي أطلب: ${product.name}\n${productUrl}`);
  app.innerHTML = `
    <section class="product-page">
      <div class="container">
        <nav class="breadcrumbs"><a href="/" data-link>الرئيسية</a> / <a href="/shop" data-link>المتجر</a></nav>
        <div class="product-detail">
          <div>
            <div class="gallery-main"><img id="mainImage" src="${imgLocal(productImages(product)[0])}" alt="${escapeHtml(product.name)}" loading="eager" fetchpriority="high" decoding="async"></div>
            <div class="thumbs">
              ${productImages(product).map((image, index) => `<button class="${index === 0 ? "active" : ""}" data-image="${imgLocal(image)}"><img src="${imgLocal(image)}" alt=""></button>`).join("")}
            </div>
          </div>
          <div class="product-info">
            ${brand ? `<div class="eyebrow">${escapeHtml(brand.ar)}</div>` : ""}
            <h1>${escapeHtml(product.name)}</h1>
            <div class="detail-price">
              <span class="price">${money(product.price)}</span>
              ${discount ? `<span class="old-price">${money(product.regular_price)}</span><span class="sale-badge">خصم ${discount}%</span>` : ""}
            </div>
            <p class="installment">أو قسّطها على 4 دفعات × <b>${money(product.price / 4)}</b> بدون فوائد مع ديمه أو تالي</p>
            <p class="description">${escapeHtml(product.description || "تواصل معنا لمعرفة التفاصيل والتوافق.")}</p>
            <div class="chips"><span>التوافق:</span>${productCategories(product).map((cat) => `<span class="chip">${escapeHtml(cat)}</span>`).join("")}</div>
            <div class="product-buy-box" data-product-buy="${product.id}">
              <div class="product-buy-main">
                <div class="product-qty-control" aria-label="الكمية">
                  <button type="button" data-product-qty-step="-1" aria-label="تقليل الكمية">−</button>
                  <span data-product-qty-value>1</span>
                  <button type="button" data-product-qty-step="1" aria-label="زيادة الكمية">+</button>
                </div>
                <button class="product-buy-now" type="button" data-buy-now>اشترِ الآن</button>
              </div>
              <div class="product-buy-secondary">
                <button class="product-add-cart" type="button" data-add-product-cart>أضف للسلة</button>
                <a class="product-whatsapp-order" href="https://wa.me/96550304591?text=${whatsappText}" target="_blank" rel="noreferrer">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.1c-.2.7-1.3 1.3-1.8 1.3-.5.1-1 .2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.5c-.2.2-.3.4-.1.7.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.1.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.4 0 .1 0 .8-.2 1.5Z"></path></svg>
                  اطلب واتساب
                </a>
              </div>
            </div>
            <ul class="trust-list">
              <li>✓ توصيل لكل مناطق الكويت — وشحن عالمي</li>
              <li>✓ دفع آمن: KNET، Apple Pay، Visa/Mastercard</li>
              <li>✓ متجر موثّق — سجل تجاري 525945</li>
            </ul>
          </div>
        </div>
        ${related.length ? `<section class="section"><div class="section-head"><h2>قطع ثانية لـ ${brand.ar}</h2></div><div class="product-grid">${related.map(productCard).join("")}</div></section>` : ""}
      </div>
    </section>
  `;
  document.querySelectorAll(".thumbs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#mainImage").src = button.dataset.image;
      document.querySelectorAll(".thumbs button").forEach((entry) => entry.classList.remove("active"));
      button.classList.add("active");
    });
  });
  const buyBox = document.querySelector("[data-product-buy]");
  if (buyBox) {
    const qtyValue = buyBox.querySelector("[data-product-qty-value]");
    const currentQty = () => Math.max(1, Number(qtyValue.textContent) || 1);
    const setProductQty = (qty) => {
      qtyValue.textContent = String(Math.max(1, qty));
    };
    buyBox.querySelectorAll("[data-product-qty-step]").forEach((button) => {
      button.addEventListener("click", () => {
        setProductQty(currentQty() + Number(button.dataset.productQtyStep));
      });
    });
    buyBox.querySelector("[data-add-product-cart]").addEventListener("click", () => {
      addToCart(product.id, currentQty());
    });
    buyBox.querySelector("[data-buy-now]").addEventListener("click", () => {
      addToCart(product.id, currentQty());
      navigate("/checkout");
    });
  }
}

function renderVin() {
  app.innerHTML = `
    <section class="shop-layout">
      <div class="container">
        <h1 class="page-title">افحص سيارتك VIN</h1>
        <div class="vin-panel">
          <label>اكتب رقم الشاصي (VIN) ونجيب لك القطع المتوافقة مع سيارتك بالضبط</label>
          <div class="vin-row">
            <input id="vinInput" maxlength="20" placeholder="مثال: WDD2130421A123456">
            <button class="primary-button" id="vinButton">افحص سيارتي</button>
          </div>
          <div class="vin-result" id="vinResult">رقم الشاصي تلقاه بالاستمارة أو خلف الزجاج الأمامي.</div>
        </div>
      </div>
    </section>
  `;
  document.querySelector("#vinButton").addEventListener("click", () => {
    const vin = document.querySelector("#vinInput").value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    const result = document.querySelector("#vinResult");
    if (vin.length !== 17) {
      result.textContent = `${vin.length}/17 خانة — تأكد من إدخال رقم الشاصي كامل.`;
      return;
    }
    result.innerHTML = `تم استلام رقم الشاصي <b dir="ltr">${vin}</b>. تواصل معنا على واتساب لإرسال القطع المتوافقة بدقة.`;
  });
}

const cartLines = () => state.cart.map((item) => {
  const product = state.products.find((entry) => entry.id === item.id);
  return product ? {
    product,
    qty: item.qty,
    lineTotal: Number(product.price || 0) * item.qty,
  } : null;
}).filter(Boolean);

const cartSubtotal = () => cartLines().reduce((sum, item) => sum + item.lineTotal, 0);

const normalizeCouponCode = (value = "") => String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const eligibleCouponTotal = (coupon, lines) => {
  if (!coupon || coupon.scope === "cart") return cartSubtotal();
  return lines.reduce((sum, { product, lineTotal }) => {
    const matchesDbId = coupon.product_id && product.db_id && String(coupon.product_id) === String(product.db_id);
    const matchesOldId = coupon.product_old_id && String(coupon.product_old_id) === String(product.id);
    return sum + (matchesDbId || matchesOldId ? lineTotal : 0);
  }, 0);
};

async function validateCouponCode(rawCode, lines = cartLines(), subtotal = cartSubtotal()) {
  const code = normalizeCouponCode(rawCode);
  if (!code) throw new Error("اكتب كود الخصم أولاً.");
  const coupons = await supabaseFetch(`coupons?select=*&code=eq.${encodeURIComponent(code)}&is_active=eq.true&limit=1`);
  const coupon = coupons?.[0];
  if (!coupon) throw new Error("كود الخصم غير صحيح أو غير مفعل.");
  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) throw new Error("كود الخصم لم يبدأ بعد.");
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now) throw new Error("انتهت صلاحية كود الخصم.");
  const eligibleTotal = eligibleCouponTotal(coupon, lines);
  if (coupon.scope === "product" && eligibleTotal <= 0) throw new Error("هذا الكود مخصص لمنتج غير موجود في السلة.");
  const discount = Math.min(Number(coupon.discount_kwd || 0), eligibleTotal, subtotal);
  if (discount <= 0) throw new Error("لا يمكن تطبيق هذا الكود على السلة الحالية.");
  return { coupon, discount };
}

const shippingLocations = {
  "الكويت": [
    "مدينة الكويت",
    "العاصمة",
    "حولي",
    "السالمية",
    "الجهراء",
    "العيون",
    "النسيم",
    "الأحمدي",
    "الفروانية",
    "مبارك الكبير",
    "صباح السالم",
    "الفحيحيل",
    "المنقف",
    "الرميثية",
    "العارضية",
    "خيطان",
  ],
  "السعودية": [
    "الرياض",
    "النظيم",
    "جدة",
    "مكة",
    "المدينة المنورة",
    "الدمام",
    "الخبر",
    "الظهران",
    "الأحساء",
    "بريدة",
    "الطائف",
    "تبوك",
  ],
  "الإمارات": [
    "دبي",
    "أبوظبي",
    "الشارقة",
    "عجمان",
    "رأس الخيمة",
    "الفجيرة",
    "أم القيوين",
    "العين",
  ],
  "قطر": [
    "الدوحة",
    "الريان",
    "الوكرة",
    "لوسيل",
    "الخور",
    "أم صلال",
  ],
  "البحرين": [
    "المنامة",
    "المحرق",
    "الرفاع",
    "مدينة عيسى",
    "سترة",
    "حمد تاون",
  ],
  "عمان": [
    "مسقط",
    "صلالة",
    "صحار",
    "نزوى",
    "السيب",
    "بركاء",
  ],
};

const countryOptions = (selectedCountry = "الكويت") => Object.keys(shippingLocations)
  .map((country) => `<option value="${country}" ${country === selectedCountry ? "selected" : ""}>${country}</option>`)
  .join("");

const cityOptions = (country, selectedCity = "") => (shippingLocations[country] || [])
  .map((city) => `<option value="${city}" ${city === selectedCity ? "selected" : ""}>${city}</option>`)
  .join("");

const countryDialCodes = {
  "الكويت": "+965",
  "السعودية": "+966",
  "الإمارات": "+971",
  "قطر": "+974",
  "البحرين": "+973",
  "عمان": "+968",
};

const countryPhoneLengths = {
  "الكويت": 8,
  "السعودية": 9,
  "الإمارات": 9,
  "قطر": 8,
  "البحرين": 8,
  "عمان": 8,
};

function syncPhoneDialCode(country, previousCountry = "", inputSelector = "#customerPhone") {
  const phoneInput = document.querySelector(inputSelector);
  if (!phoneInput) return;
  const nextCode = countryDialCodes[country] || "+965";
  const expectedLength = countryPhoneLengths[country] || 8;
  phoneInput.placeholder = `${nextCode} ${"0".repeat(expectedLength)}`;
  const previousCode = countryDialCodes[previousCountry] || "";
  const current = phoneInput.value.trim();
  if (!current || current === previousCode) {
    phoneInput.value = `${nextCode} `;
    return;
  }
  if (previousCode && current.startsWith(previousCode)) {
    phoneInput.value = `${nextCode} ${current.slice(previousCode.length).trim()}`.trimEnd() + " ";
    return;
  }
  if (!current.startsWith("+")) {
    phoneInput.value = `${nextCode} ${current}`;
  }
  limitPhoneForCountry(country, inputSelector);
}

function limitPhoneForCountry(country, inputSelector = "#customerPhone") {
  const phoneInput = document.querySelector(inputSelector);
  if (!phoneInput) return;
  const dialCode = countryDialCodes[country] || "+965";
  const expectedLength = countryPhoneLengths[country] || 8;
  const digits = phoneInput.value.replace(/\D/g, "");
  const dialDigits = dialCode.replace(/\D/g, "");
  const localDigits = (digits.startsWith(dialDigits) ? digits.slice(dialDigits.length) : digits).slice(0, expectedLength);
  phoneInput.value = `${dialCode} ${localDigits}`.trimEnd() + (localDigits.length ? "" : " ");
}

function validatePhoneForCountry(phone, country) {
  const dialCode = countryDialCodes[country] || "+965";
  const expectedLength = countryPhoneLengths[country] || 8;
  const digits = String(phone || "").replace(/\D/g, "");
  const dialDigits = dialCode.replace(/\D/g, "");
  const localDigits = digits.startsWith(dialDigits) ? digits.slice(dialDigits.length) : digits;
  if (localDigits.length !== expectedLength) {
    return `رقم الهاتف يجب أن يكون ${expectedLength} أرقام بعد مفتاح الدولة ${dialCode}.`;
  }
  if (/^(\d)\1+$/.test(localDigits)) {
    return "رقم الهاتف غير صحيح، لا يمكن استخدام رقم مكرر بالكامل.";
  }
  return "";
}

function renderAuth(mode = "login", notice = "") {
  const isRegister = mode === "register";
  const defaultCountry = "الكويت";
  app.innerHTML = `
    <section class="auth-page">
      <div class="container">
        <div class="auth-card">
          <div class="auth-head">
            <span></span>
            <h1>${isRegister ? "إنشاء حساب عميل" : "دخول العملاء"}</h1>
            <p>${isRegister ? "أنشئ حسابك لمتابعة طلباتك وحفظ بياناتك للطلبات القادمة." : "ادخل بحسابك لمتابعة الطلبات وحالة الدفع والشحن."}</p>
          </div>
          <div class="auth-tabs">
            <a class="${!isRegister ? "active" : ""}" href="/login" data-link>دخول</a>
            <a class="${isRegister ? "active" : ""}" href="/register" data-link>تسجيل جديد</a>
          </div>
          ${notice ? `<p class="auth-notice">${escapeHtml(notice)}</p>` : ""}
          <form class="auth-form" id="customerAuthForm">
            ${isRegister ? `
              <label>الاسم الكامل<input name="full_name" autocomplete="name" required></label>
              <label>الدولة<select name="shipping_country" id="registerCountry" required>${countryOptions(defaultCountry)}</select></label>
              <label>المدينة / المنطقة<select name="shipping_city" id="registerCity" required>${cityOptions(defaultCountry)}</select></label>
              <label>رقم الهاتف<input name="phone" id="registerPhone" inputmode="tel" dir="ltr" autocomplete="tel" placeholder="+965 0000 0000" required></label>
              <label class="span-2">العنوان التفصيلي<textarea name="shipping_address" rows="3" autocomplete="street-address" required></textarea></label>
            ` : ""}
            <label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" required></label>
            <label>كلمة المرور<input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="6" required></label>
            <button class="primary-button" type="submit">${isRegister ? "إنشاء الحساب" : "دخول"}</button>
            <p class="form-message" id="customerAuthMessage"></p>
          </form>
        </div>
      </div>
    </section>
  `;
  if (isRegister) {
    const registerCountry = document.querySelector("#registerCountry");
    const registerCity = document.querySelector("#registerCity");
    const registerPhone = document.querySelector("#registerPhone");
    registerCountry.dataset.previousCountry = registerCountry.value;
    syncPhoneDialCode(registerCountry.value, "", "#registerPhone");
    registerPhone.addEventListener("input", () => {
      limitPhoneForCountry(registerCountry.value, "#registerPhone");
    });
    registerPhone.addEventListener("focus", () => {
      syncPhoneDialCode(registerCountry.value, "", "#registerPhone");
    });
    registerCountry.addEventListener("change", (event) => {
      const previousCountry = event.currentTarget.dataset.previousCountry || "";
      registerCity.innerHTML = cityOptions(event.target.value);
      syncPhoneDialCode(event.target.value, previousCountry, "#registerPhone");
      event.currentTarget.dataset.previousCountry = event.target.value;
    });
  }
  document.querySelector("#customerAuthForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const message = document.querySelector("#customerAuthMessage");
    const formData = new FormData(form);
    message.className = "form-message";
    message.textContent = isRegister ? "جاري إنشاء الحساب..." : "جاري تسجيل الدخول...";
    button.disabled = true;
    try {
      if (isRegister) {
        const result = await customerSignUp({
          email: formData.get("email").trim(),
          password: formData.get("password"),
          fullName: formData.get("full_name").trim(),
          phone: formData.get("phone").trim(),
          shippingCountry: formData.get("shipping_country"),
          shippingCity: formData.get("shipping_city"),
          shippingAddress: formData.get("shipping_address").trim(),
        });
        if (!result?.access_token) {
          message.classList.add("success");
          message.textContent = "تم إنشاء الحساب. إذا طلب Supabase تأكيد البريد، افتح بريدك ثم سجل الدخول.";
          return;
        }
      } else {
        await customerSignIn(formData.get("email").trim(), formData.get("password"));
      }
      navigate("/account");
    } catch (error) {
      message.classList.add("error");
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function loadCustomerOrders() {
  const user = state.customerSession?.user;
  if (!user?.id) return [];
  const id = encodeURIComponent(user.id);
  const email = encodeURIComponent(user.email || "");
  try {
    return await supabaseFetch(`orders?select=*,order_items(*)&or=(customer_id.eq.${id},customer_email.eq.${email})&order=created_at.desc`);
  } catch (error) {
    console.warn("Customer orders are not ready.", error);
    return [];
  }
}

function customerOrderStatus(order) {
  const labels = {
    new: "جديد",
    processing: "قيد التجهيز",
    shipped: "تم الشحن",
    completed: "مكتمل",
    cancelled: "ملغي",
  };
  return labels[order.status] || order.status || "جديد";
}

function renderCustomerOrders(orders) {
  const target = document.querySelector("#customerOrders");
  if (!target) return;
  if (!orders.length) {
    target.innerHTML = `
      <div class="empty-state compact">
        <b>لا توجد طلبات حتى الآن</b>
        <p>طلباتك الجديدة ستظهر هنا بعد إتمام الطلب من المتجر.</p>
        <a class="primary-button" href="/shop" data-link>تصفح المنتجات</a>
      </div>
    `;
    return;
  }
  target.innerHTML = orders.map((order) => `
    <article class="account-order">
      <div>
        <small>${new Date(order.created_at).toLocaleString("ar-KW")}</small>
        <h3 dir="ltr">${escapeHtml(order.order_number || order.id)}</h3>
        <p>${escapeHtml([order.shipping_country, order.shipping_city].filter(Boolean).join(" - "))}</p>
      </div>
      <div>
        <span class="status-pill">${escapeHtml(customerOrderStatus(order))}</span>
        <b>${money(order.total_kwd)}</b>
      </div>
      <details>
        <summary>تفاصيل الطلب</summary>
        <div class="account-items">
          ${(order.order_items || []).map((item) => `
            <div>
              <span>${escapeHtml(item.product_title || item.product_slug || "-")}</span>
              <strong>${Number(item.quantity || 0)} × ${money(item.unit_price_kwd)}</strong>
            </div>
          `).join("") || `<p>لا توجد منتجات مرفقة.</p>`}
        </div>
      </details>
    </article>
  `).join("");
}

function renderAccount() {
  if (!state.customerSession?.user) {
    renderAuth("login", "سجل دخولك أو أنشئ حساباً لمتابعة طلباتك.");
    return;
  }
  const user = state.customerSession.user;
  const profile = state.customerProfile || {};
  const profileCountry = profile.shipping_country || user.user_metadata?.shipping_country || "الكويت";
  const profileCity = profile.shipping_city || user.user_metadata?.shipping_city || "";
  app.innerHTML = `
    <section class="account-page">
      <div class="container">
        <div class="account-head">
          <div>
            <span></span>
            <h1>حسابي</h1>
            <p>تابع طلباتك وحدث بياناتك الأساسية.</p>
          </div>
          <button class="ghost-button" id="customerLogoutButton" type="button">تسجيل خروج</button>
        </div>
        <div class="account-grid">
          <form class="account-card" id="customerProfileForm">
            <h2>بيانات العميل</h2>
            <label>الاسم الكامل<input name="full_name" autocomplete="name" value="${escapeHtml(profile.full_name || user.user_metadata?.full_name || "")}"></label>
            <label>الدولة<select name="shipping_country" id="profileCountry">${countryOptions(profileCountry)}</select></label>
            <label>المدينة / المنطقة<select name="shipping_city" id="profileCity">${cityOptions(profileCountry, profileCity)}</select></label>
            <label>رقم الهاتف<input name="phone" inputmode="tel" dir="ltr" autocomplete="tel" value="${escapeHtml(profile.phone || user.user_metadata?.phone || "")}"></label>
            <label>البريد الإلكتروني<input name="email" type="email" value="${escapeHtml(profile.email || user.email || "")}" readonly></label>
            <label class="span-2">العنوان التفصيلي<textarea name="shipping_address" rows="3" autocomplete="street-address">${escapeHtml(profile.shipping_address || user.user_metadata?.shipping_address || "")}</textarea></label>
            <button class="primary-button" type="submit">حفظ البيانات</button>
            <p class="form-message" id="profileMessage"></p>
          </form>
          <div class="account-card account-orders-card">
            <h2>طلباتي</h2>
            <div id="customerOrders" class="account-orders-loading">جاري تحميل الطلبات...</div>
          </div>
        </div>
      </div>
    </section>
  `;
  document.querySelector("#customerLogoutButton").addEventListener("click", customerSignOut);
  document.querySelector("#profileCountry").addEventListener("change", (event) => {
    document.querySelector("#profileCity").innerHTML = cityOptions(event.target.value);
  });
  document.querySelector("#customerProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#profileMessage");
    const button = event.currentTarget.querySelector("button");
    const formData = new FormData(event.currentTarget);
    message.className = "form-message";
    message.textContent = "جاري الحفظ...";
    button.disabled = true;
    try {
      await saveCustomerProfile({
        full_name: formData.get("full_name").trim(),
        phone: formData.get("phone").trim(),
        email: user.email,
        shipping_country: formData.get("shipping_country"),
        shipping_city: formData.get("shipping_city"),
        shipping_address: formData.get("shipping_address").trim(),
      });
      message.classList.add("success");
      message.textContent = "تم حفظ البيانات.";
    } catch (error) {
      message.classList.add("error");
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  loadCustomerOrders().then(renderCustomerOrders);
}

function renderCheckout() {
  const lines = cartLines();
  const profile = state.customerProfile || {};
  const customerName = profile.full_name || state.customerSession?.user?.user_metadata?.full_name || "";
  const customerPhoneValue = profile.phone || "+965 ";
  const customerEmail = profile.email || state.customerSession?.user?.email || "";
  const customerCountry = profile.shipping_country || state.customerSession?.user?.user_metadata?.shipping_country || "الكويت";
  const customerCity = profile.shipping_city || state.customerSession?.user?.user_metadata?.shipping_city || "";
  const customerAddress = profile.shipping_address || state.customerSession?.user?.user_metadata?.shipping_address || "";
  if (!lines.length) {
    app.innerHTML = `
      <section class="checkout-page">
        <div class="container">
          <div class="empty-state">
            <b>السلة فارغة</b>
            <p>أضف المنتجات أولاً ثم ارجع لإتمام الطلب.</p>
            <a class="primary-button" href="/shop" data-link>تصفح المنتجات</a>
          </div>
        </div>
      </section>
    `;
    return;
  }
  const subtotal = cartSubtotal();
  app.innerHTML = `
    <section class="checkout-page">
      <div class="container">
        <div class="section-head">
          <div>
            <h1 class="page-title">إتمام الطلب</h1>
            <p>اكتب بياناتك، ونستلم الطلب في لوحة التحكم مباشرة.</p>
          </div>
        </div>
        <div class="checkout-grid">
          <form class="checkout-form" id="checkoutForm">
            ${state.customerSession?.user ? `<p class="checkout-account-note span-2">الطلب سيتم ربطه بحسابك: ${escapeHtml(state.customerSession.user.email || "")}</p>` : `<p class="checkout-account-note span-2">لديك حساب؟ <a href="/login" data-link>سجل الدخول</a> لمتابعة الطلب لاحقاً.</p>`}
            <label>الاسم الكامل<input name="customer_name" required autocomplete="name" value="${escapeHtml(customerName)}"></label>
            <label>الدولة<select name="shipping_country" id="shippingCountry" required>${countryOptions(customerCountry)}</select></label>
            <label>المدينة / المنطقة<select name="shipping_city" id="shippingCity" required>${cityOptions(customerCountry, customerCity)}</select></label>
            <label class="span-2">العنوان التفصيلي<textarea name="shipping_address" rows="4" required>${escapeHtml(customerAddress)}</textarea></label>
            <label>رقم الهاتف<input name="customer_phone" id="customerPhone" required inputmode="tel" dir="ltr" value="${escapeHtml(customerPhoneValue)}" placeholder="+965 0000 0000"></label>
            <label>البريد الإلكتروني<input name="customer_email" type="email" autocomplete="email" value="${escapeHtml(customerEmail)}"></label>
            <label class="span-2">ملاحظات إضافية<textarea name="notes" rows="3" placeholder="موديل السيارة، وقت التواصل المناسب، أو أي ملاحظات"></textarea></label>
            <div class="payment-options span-2" role="radiogroup" aria-label="طريقة الدفع">
              <p>طريقة الدفع</p>
              <label class="payment-option">
                <input type="radio" name="payment_method" value="sadadpay" checked>
                <span>
                  <b>SadadPay Payment</b>
                  <small>دفع إلكتروني آمن عبر سداد</small>
                </span>
              </label>
              <label class="payment-option">
                <input type="radio" name="payment_method" value="deema">
                <span>
                  <b>Deema Payment</b>
                  <small>أقساط ميسرة، بدون فوائد</small>
                </span>
              </label>
              <label class="payment-option">
                <input type="radio" name="payment_method" value="taly">
                <span>
                  <b>Taly Payment</b>
                  <small>أقساط ميسرة، بدون فوائد</small>
                </span>
              </label>
            </div>
            <input type="hidden" name="coupon_code" id="appliedCouponCode" value="">
            <input type="hidden" name="discount_kwd" id="appliedCouponDiscount" value="0">
            <button class="primary-button span-2" type="submit">تأكيد الطلب</button>
            <p class="checkout-message span-2" id="checkoutMessage"></p>
          </form>
          <aside class="checkout-summary">
            <h2>ملخص الطلب</h2>
            <div class="summary-lines">
              ${lines.map(({ product, qty, lineTotal }) => `
                <div class="summary-line">
                  <img src="${imgLocal(productImages(product)[0])}" alt="">
                  <div>
                    <b>${escapeHtml(product.name)}</b>
                    <span>${qty} × ${money(product.price)}</span>
                  </div>
                  <strong>${money(lineTotal)}</strong>
                </div>
              `).join("")}
            </div>
            <div class="coupon-box">
              <label for="couponCode">كود الخصم</label>
              <div>
                <input id="couponCode" inputmode="text" autocomplete="off" placeholder="مثال: KW1234" dir="ltr">
                <button id="applyCouponButton" type="button">تطبيق</button>
              </div>
              <p id="couponMessage"></p>
            </div>
            <div class="summary-row"><span>المجموع</span><b>${money(subtotal)}</b></div>
            <div class="summary-row discount hidden" id="couponDiscountLine"><span>الخصم</span><b id="couponDiscountAmount">-${money(0)}</b></div>
            <div class="summary-total"><span>الإجمالي</span><b id="checkoutTotalAmount">${money(subtotal)}</b></div>
          </aside>
        </div>
      </div>
    </section>
  `;
  const shippingCountry = document.querySelector("#shippingCountry");
  const customerPhone = document.querySelector("#customerPhone");
  shippingCountry.dataset.previousCountry = shippingCountry.value;
  syncPhoneDialCode(shippingCountry.value);
  customerPhone.addEventListener("input", () => {
    limitPhoneForCountry(shippingCountry.value);
  });
  customerPhone.addEventListener("focus", () => {
    syncPhoneDialCode(shippingCountry.value);
  });
  shippingCountry.addEventListener("change", (event) => {
    const previousCountry = event.currentTarget.dataset.previousCountry || "";
    document.querySelector("#shippingCity").innerHTML = cityOptions(event.target.value);
    syncPhoneDialCode(event.target.value, previousCountry);
    event.currentTarget.dataset.previousCountry = event.target.value;
  });
  document.querySelector("#applyCouponButton").addEventListener("click", async () => {
    const codeInput = document.querySelector("#couponCode");
    const button = document.querySelector("#applyCouponButton");
    const couponMessage = document.querySelector("#couponMessage");
    button.disabled = true;
    couponMessage.className = "";
    couponMessage.textContent = "جاري التحقق من الكود...";
    try {
      const result = await validateCouponCode(codeInput.value, lines, subtotal);
      document.querySelector("#appliedCouponCode").value = normalizeCouponCode(result.coupon.code);
      document.querySelector("#appliedCouponDiscount").value = result.discount;
      document.querySelector("#couponDiscountLine").classList.remove("hidden");
      document.querySelector("#couponDiscountAmount").textContent = `-${money(result.discount)}`;
      document.querySelector("#checkoutTotalAmount").textContent = money(Math.max(subtotal - result.discount, 0));
      couponMessage.classList.add("success");
      couponMessage.textContent = `تم تطبيق كود ${normalizeCouponCode(result.coupon.code)}.`;
    } catch (error) {
      document.querySelector("#appliedCouponCode").value = "";
      document.querySelector("#appliedCouponDiscount").value = "0";
      document.querySelector("#couponDiscountLine").classList.add("hidden");
      document.querySelector("#checkoutTotalAmount").textContent = money(subtotal);
      couponMessage.classList.add("error");
      couponMessage.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector("#checkoutForm").addEventListener("submit", submitCheckout);
}

async function submitCheckout(event) {
  event.preventDefault();
  const message = document.querySelector("#checkoutMessage");
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const lines = cartLines();
  if (!lines.length) return;
  message.className = "checkout-message";
  message.textContent = "جاري حفظ الطلب...";
  if (submitButton) submitButton.disabled = true;
  const formData = new FormData(event.currentTarget);
  const phoneError = validatePhoneForCountry(formData.get("customer_phone"), formData.get("shipping_country"));
  if (phoneError) {
    if (submitButton) submitButton.disabled = false;
    message.classList.add("error");
    message.textContent = phoneError;
    document.querySelector("#customerPhone")?.focus();
    return;
  }
  const paymentMethod = formData.get("payment_method") || "sadadpay";
  const subtotal = cartSubtotal();
  const couponCode = normalizeCouponCode(formData.get("coupon_code"));
  let appliedCoupon = null;
  let discountKwd = 0;
  let totalKwd = subtotal;
  const orderNumber = `AB-${Date.now().toString().slice(-8)}`;
  const customerEmail = formData.get("customer_email") || state.customerSession?.user?.email || "";
  try {
    if (couponCode) {
      const couponResult = await validateCouponCode(couponCode, lines, subtotal);
      appliedCoupon = couponResult.coupon;
      discountKwd = couponResult.discount;
      totalKwd = Math.max(subtotal - discountKwd, 0);
    }
    if (state.customerSession?.user?.id) {
      await saveCustomerProfile({
        full_name: formData.get("customer_name"),
        phone: formData.get("customer_phone"),
        email: customerEmail,
        shipping_country: formData.get("shipping_country"),
        shipping_city: formData.get("shipping_city"),
        shipping_address: formData.get("shipping_address"),
      }).catch((error) => console.warn("Could not update customer profile.", error));
    }
    const orderPayload = {
      order_number: orderNumber,
      customer_id: state.customerSession?.user?.id || null,
      customer_name: formData.get("customer_name"),
      customer_phone: formData.get("customer_phone"),
      customer_email: customerEmail,
      shipping_country: formData.get("shipping_country") || "Kuwait",
      shipping_city: formData.get("shipping_city"),
      shipping_address: formData.get("shipping_address"),
      notes: formData.get("notes"),
      subtotal_kwd: subtotal,
      shipping_kwd: 0,
      discount_kwd: discountKwd,
      coupon_code: appliedCoupon ? normalizeCouponCode(appliedCoupon.code) : null,
      total_kwd: totalKwd,
      status: "new",
      payment_status: "pending",
      payment_method: paymentMethod,
    };
    let orderRows;
    try {
      orderRows = await supabaseWrite("orders", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(orderPayload),
      });
    } catch (error) {
      if (!String(error.message || "").includes("customer_id")) throw error;
      delete orderPayload.customer_id;
      orderRows = await supabaseWrite("orders", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(orderPayload),
      });
    }
    const order = orderRows?.[0];
    if (!order?.id) throw new Error("تعذر إنشاء رقم الطلب.");
    await supabaseWrite("order_items", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(lines.map(({ product, qty, lineTotal }) => ({
        order_id: order.id,
        product_id: product.db_id || null,
        product_old_id: String(product.id),
        product_slug: product.slug,
        product_title: product.name,
        quantity: qty,
        unit_price_kwd: Number(product.price || 0),
        total_kwd: lineTotal,
      }))),
    });
    if (totalKwd <= 0) {
      state.cart = [];
      saveCart();
      navigate(`/order-success?order=${encodeURIComponent(orderNumber)}&payment=${encodeURIComponent(paymentMethod)}`);
      return;
    }

    if (paymentMethod === "deema") {
      message.textContent = "جاري تحويلك إلى صفحة دفع ديمه...";
      const deemaResponse = await fetch("/api/deema-create-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          orderNumber,
          amount: totalKwd,
          customerName: formData.get("customer_name"),
          customerPhone: formData.get("customer_phone"),
          customerEmail: formData.get("customer_email"),
          customerCountry: formData.get("shipping_country"),
          customerCity: formData.get("shipping_city"),
          customerAddress: formData.get("shipping_address"),
          items: lines.map(({ product, qty, lineTotal }) => ({
            name: product.name,
            quantity: qty,
            amount: lineTotal,
          })),
        }),
      });
      const deemaData = await deemaResponse.json();
      if (!deemaResponse.ok || !deemaData?.paymentUrl) {
        throw new Error(deemaData?.error || "تعذر إنشاء رابط دفع ديمه.");
      }
      state.cart = [];
      saveCart();
      window.location.href = deemaData.paymentUrl;
      return;
    }

    if (paymentMethod === "taly") {
      message.textContent = "جاري تحويلك إلى صفحة دفع تالي...";
      const talyResponse = await fetch("/api/taly-create-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          orderNumber,
          amount: totalKwd,
          customerName: formData.get("customer_name"),
          customerPhone: formData.get("customer_phone"),
          customerEmail: customerEmail,
          customerCountry: formData.get("shipping_country"),
          customerCity: formData.get("shipping_city"),
          customerAddress: formData.get("shipping_address"),
          items: lines.map(({ product, qty, lineTotal }) => ({
            name: product.name,
            quantity: qty,
            amount: lineTotal,
          })),
        }),
      });
      const talyData = await talyResponse.json();
      if (!talyResponse.ok || !talyData?.paymentUrl) {
        const details = talyData?.details ? ` - ${JSON.stringify(talyData.details)}` : "";
        throw new Error(`${talyData?.error || "تعذر إنشاء رابط دفع تالي."}${details}`);
      }
      state.cart = [];
      saveCart();
      window.location.href = talyData.paymentUrl;
      return;
    }

    if (paymentMethod !== "sadadpay") {
      state.cart = [];
      saveCart();
      navigate(`/order-success?order=${encodeURIComponent(orderNumber)}&payment=${encodeURIComponent(paymentMethod)}`);
      return;
    }

    message.textContent = "جاري تحويلك إلى صفحة الدفع...";
    const sadadResponse = await fetch("/api/sadad-create-payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        orderNumber,
        amount: totalKwd,
        customerName: formData.get("customer_name"),
        customerPhone: formData.get("customer_phone"),
        customerEmail: formData.get("customer_email"),
        items: lines.map(({ product, qty, lineTotal }) => ({
          name: product.name,
          quantity: qty,
          amount: lineTotal,
        })),
      }),
    });
    const sadadData = await sadadResponse.json();
    if (!sadadResponse.ok || !sadadData?.paymentUrl) {
      throw new Error(sadadData?.error || "تعذر إنشاء رابط الدفع.");
    }
    state.cart = [];
    saveCart();
    window.location.href = sadadData.paymentUrl;
  } catch (error) {
    if (submitButton) submitButton.disabled = false;
    message.classList.add("error");
    message.textContent = `تعذر حفظ الطلب: ${error.message}`;
  }
}

function renderOrderSuccess() {
  const params = new URLSearchParams(location.search);
  const orderNumber = params.get("order") || "تم استلام الطلب";
  app.innerHTML = `
    <section class="checkout-page">
      <div class="container">
        <div class="success-panel">
          <span>✓</span>
          <h1>تم استلام طلبك</h1>
          <p>رقم الطلب: <b dir="ltr">${escapeHtml(orderNumber)}</b></p>
          <p>راح نتواصل معك قريباً لتأكيد التفاصيل والدفع.</p>
          <div class="product-actions">
            <a class="primary-button" href="/shop" data-link>متابعة التسوق</a>
            <a class="secondary-button" href="https://wa.me/96550304591?text=${encodeURIComponent(`مرحباً، أريد متابعة الطلب ${orderNumber}`)}" target="_blank" rel="noreferrer">متابعة عبر واتساب</a>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderNotFound() {
  app.innerHTML = `<div class="container"><div class="empty-state"><b>الصفحة غير موجودة</b><p>ارجع للمتجر وتصفح المنتجات.</p><a class="primary-button" href="/shop" data-link>المتجر</a></div></div>`;
}

function renderFooterLinks() {
  document.querySelector("#footerTypes").innerHTML = state.types.map((type) => `<li><a href="/shop?type=${type.slug}" data-link>${type.ar}</a></li>`).join("");
  document.querySelector("#footerBrands").innerHTML = state.brands.slice(0, 6).map((brand) => `<li><a href="/shop?brand=${brand.slug}" data-link>${brand.ar}</a></li>`).join("");
}

function setSiteData(data) {
  state.products = data.products;
  state.categories = data.categories;
  state.brands = data.brands;
  state.types = data.types;
  renderFooterLinks();
}

function setActiveNav() {
  const path = location.pathname;
  document.querySelectorAll(".desktop-nav a").forEach((link) => {
    link.classList.toggle("active", new URL(link.href).pathname === path);
  });
}

function applyRevealMotion() {
  if (revealObserver) revealObserver.disconnect();
  const selector = [
    ".center-title",
    ".section-head",
    ".categories-head",
    ".brand-card",
    ".promo-card",
    ".product-card",
    ".category-tile",
    ".benefits-grid > div",
    ".instagram-section .container",
    ".product-detail",
    ".checkout-form",
    ".checkout-summary",
    ".success-panel",
    ".auth-card",
    ".account-card",
    ".account-order",
  ].join(",");
  const elements = [...app.querySelectorAll(selector)];
  elements.forEach((element, index) => {
    element.classList.add("reveal-item");
    element.style.setProperty("--reveal-delay", `${Math.min(index % 10, 7) * 45}ms`);
  });
  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" });
  elements.forEach((element) => revealObserver.observe(element));
}

function render(options = {}) {
  setActiveNav();
  if (location.pathname === "/" || location.pathname === "/index.html") renderHome();
  else if (location.pathname === "/shop") renderShop();
  else if (location.pathname === "/checkout") renderCheckout();
  else if (location.pathname === "/order-success") renderOrderSuccess();
  else if (location.pathname === "/login") renderAuth("login");
  else if (location.pathname === "/register") renderAuth("register");
  else if (location.pathname === "/account") renderAccount();
  else if (location.pathname === "/vin-check") renderVin();
  else if (location.pathname.startsWith("/product/")) renderProduct(decodeURIComponent(location.pathname.split("/product/")[1]));
  else renderNotFound();
  renderCart();
  updateCurrencyControls();
  applyRevealMotion();
  if (options.resetScroll !== false) resetPageScroll();
}

async function boot() {
  resetPageScroll();
  setCustomerSession(getCustomerSession());
  if (state.customerSession?.access_token && await validateCustomerSession()) {
    await loadCustomerProfile();
  }
  const data = await localData().catch(async (error) => {
    console.warn("Local data is not ready, trying Supabase.", error);
    return supabaseData();
  });
  setSiteData(data);
  render();
  document.documentElement.classList.remove("app-booting");
  requestAnimationFrame(resetPageScroll);
  setTimeout(resetPageScroll, 120);
  supabaseData().then((freshData) => {
    if (!freshData) return;
    if (location.pathname === "/checkout") return;
    if (app.querySelector("input:focus, select:focus, textarea:focus")) return;
    setSiteData(freshData);
    render({ resetScroll: false });
  }).catch((error) => {
    console.warn("Supabase data refresh failed.", error);
  });
}

boot().catch((error) => {
  document.documentElement.classList.remove("app-booting");
  app.innerHTML = `<div class="container"><div class="empty-state"><b>تعذر تحميل بيانات الموقع</b><p>${escapeHtml(error.message)}</p></div></div>`;
});
