const state = {
  products: [],
  categories: [],
  brands: [],
  types: [],
  cart: JSON.parse(localStorage.getItem("autoobenz-cart-v1") || "[]"),
};

const app = document.querySelector("#app");
const cartCount = document.querySelector("#cartCount");
const cartDrawer = document.querySelector("#cartDrawer");
const mobileNav = document.querySelector("#mobileNav");
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

const money = (value) => {
  const options = value >= 100 ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 1 };
  return `${Number(value || 0).toLocaleString("en-US", options)} د.ك`;
};

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

const supabaseHeaders = () => ({
  apikey: window.AUTOOBENZ_SUPABASE.publishableKey,
  Authorization: `Bearer ${window.AUTOOBENZ_SUPABASE.publishableKey}`,
});

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

  const filtered = state.products.filter((product) => {
    return inBrand(product, selectedBrand)
      && (!selectedModel || product.cat_slugs.includes(selectedModel))
      && (!selectedType || product.cat_slugs.includes(selectedType))
      && (!q || product.name.toLowerCase().includes(q.toLowerCase()));
  });

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
    if (event.target.name === "q") updateFilters();
  });
}

function updateFilters() {
  const form = document.querySelector("#filtersForm");
  const data = new FormData(form);
  const params = new URLSearchParams();
  ["brand", "model", "type", "q"].forEach((key) => {
    const value = data.get(key);
    if (value) params.set(key, value);
  });
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

const countryOptions = () => Object.keys(shippingLocations)
  .map((country) => `<option value="${country}">${country}</option>`)
  .join("");

const cityOptions = (country) => (shippingLocations[country] || [])
  .map((city) => `<option value="${city}">${city}</option>`)
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

function syncPhoneDialCode(country, previousCountry = "") {
  const phoneInput = document.querySelector("#customerPhone");
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
  limitPhoneForCountry(country);
}

function limitPhoneForCountry(country) {
  const phoneInput = document.querySelector("#customerPhone");
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

function renderCheckout() {
  const lines = cartLines();
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
            <label>الاسم الكامل<input name="customer_name" required autocomplete="name"></label>
            <label>الدولة<select name="shipping_country" id="shippingCountry" required>${countryOptions()}</select></label>
            <label>المدينة / المنطقة<select name="shipping_city" id="shippingCity" required>${cityOptions("الكويت")}</select></label>
            <label class="span-2">العنوان التفصيلي<textarea name="shipping_address" rows="4" required></textarea></label>
            <label>رقم الهاتف<input name="customer_phone" id="customerPhone" required inputmode="tel" dir="ltr" value="+965 " placeholder="+965 0000 0000"></label>
            <label>البريد الإلكتروني<input name="customer_email" type="email" autocomplete="email"></label>
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
            <div class="summary-total"><span>الإجمالي</span><b>${money(subtotal)}</b></div>
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
  const orderNumber = `AB-${Date.now().toString().slice(-8)}`;
  try {
    const orderRows = await supabaseWrite("orders", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        order_number: orderNumber,
        customer_name: formData.get("customer_name"),
        customer_phone: formData.get("customer_phone"),
        customer_email: formData.get("customer_email"),
        shipping_country: formData.get("shipping_country") || "Kuwait",
        shipping_city: formData.get("shipping_city"),
        shipping_address: formData.get("shipping_address"),
        notes: formData.get("notes"),
        subtotal_kwd: subtotal,
        shipping_kwd: 0,
        total_kwd: subtotal,
        status: "new",
        payment_status: "pending",
        payment_method: paymentMethod,
      }),
    });
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
        amount: subtotal,
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
  else if (location.pathname === "/vin-check") renderVin();
  else if (location.pathname.startsWith("/product/")) renderProduct(decodeURIComponent(location.pathname.split("/product/")[1]));
  else renderNotFound();
  renderCart();
  applyRevealMotion();
  if (options.resetScroll !== false) resetPageScroll();
}

async function boot() {
  resetPageScroll();
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
