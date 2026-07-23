const TALY_LIVE_API = "https://api.taly.io";
let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function cleanSecret(value) {
  return String(value || "").replace(/\s+/g, "");
}

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "www.autoobenz.com";
  return `${proto}://${host}`;
}

function amount(value) {
  return Number(Number(value || 0).toFixed(3));
}

function splitName(name) {
  const parts = String(name || "Autoobenz Customer").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: (parts.shift() || "Autoobenz").slice(0, 60),
    lastName: (parts.join(" ") || "Customer").slice(0, 60),
  };
}

function splitPhone(phone) {
  const cleaned = String(phone || "").replace(/[^\d+]/g, "");
  const match = cleaned.match(/^(\+\d{1,3})(\d+)$/);
  if (match) return { countryCode: match[1], phoneNumber: match[2] };
  return { countryCode: "+965", phoneNumber: cleaned.replace(/\D/g, "") };
}

function pickDeep(obj, names) {
  if (!obj || typeof obj !== "object") return "";
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== "") return obj[name];
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = pickDeep(value, names);
      if (nested) return nested;
    }
  }
  return "";
}

async function talyFetch(path, options = {}) {
  const baseUrl = String(process.env.TALY_API_BASE_URL || TALY_LIVE_API).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || text || `Taly request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) {
    return cachedAccessToken;
  }

  const merchantKey = cleanSecret(process.env.TALY_MERCHANT_KEY);
  const secretKey = cleanSecret(process.env.TALY_SECRET_KEY);
  if (!merchantKey || !secretKey) {
    throw new Error("Taly merchant key or secret key is missing in Vercel Environment Variables.");
  }

  const form = new URLSearchParams();
  form.set("username", merchantKey);
  form.set("password", secretKey);
  form.set("grant_type", "password");
  form.set("scope", "ui");

  const authPath = process.env.TALY_AUTH_PATH || "/uaa/oauth/token";
  const authData = await talyFetch(authPath, {
    method: "POST",
    headers: {
      Authorization: "Basic bWVyY2hhbnQ6c2VjcmV0",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const token = pickDeep(authData, ["access_token", "accessToken", "token"]);
  if (!token) throw new Error("Taly did not return an access token.");
  const expiresInSeconds = Number(pickDeep(authData, ["expires_in", "expiresIn"])) || 900;
  cachedAccessToken = String(token);
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000;
  return token;
}

async function supabasePatchOrder(orderId, payload) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const serviceKey = cleanSecret(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!supabaseUrl || !serviceKey || !orderId) return;

  await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
}

async function supabaseGetOrder(orderId) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const serviceKey = cleanSecret(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!supabaseUrl || !serviceKey || !orderId) return null;

  const response = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,total_kwd,customer_name,customer_phone,customer_email,shipping_country,shipping_city,shipping_address&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

function verifyOrder(order, body, total) {
  if (!order) throw new Error("Order not found.");
  if (String(order.order_number || "") !== String(body.orderNumber || "")) {
    throw new Error("Order number mismatch.");
  }
  const expectedAmount = Number(order.total_kwd || 0);
  if (!expectedAmount || Math.abs(expectedAmount - total) > 0.001) {
    throw new Error("Order amount mismatch.");
  }
}

function buildOrderItems(items) {
  const safeItems = Array.isArray(items) && items.length ? items : [{ name: "Autoobenz order", quantity: 1, amount: 0 }];
  return safeItems.map((item, index) => {
    const quantity = Number(item.quantity || 1);
    const total = amount(item.amount || 0);
    const unitPrice = amount(quantity ? total / quantity : total);
    return {
      sku: `AUTOOBENZ-${index + 1}`,
      type: "physical",
      name: String(item.name || `Item ${index + 1}`).slice(0, 120),
      itemDescription: String(item.name || `Item ${index + 1}`).slice(0, 250),
      quantity,
      itemPrice: unitPrice,
      imageUrl: "",
      itemUrl: "",
      itemUnit: "pc",
      itemSize: "",
      itemColor: "",
      itemGender: "",
      itemBrand: "Autoobenz",
      itemCategory: "Car accessories",
      currency: "KWD",
    };
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = await readBody(req);
    const total = amount(body.amount);
    if (!body.orderNumber || !total) throw new Error("Order number and amount are required.");

    const order = await supabaseGetOrder(body.orderId);
    verifyOrder(order, body, total);

    const origin = requestOrigin(req);
    const accessToken = await getAccessToken();
    const { firstName, lastName } = splitName(order.customer_name || body.customerName);
    const { countryCode, phoneNumber } = splitPhone(order.customer_phone || body.customerPhone);
    const payload = {
      merchantOrderId: String(body.orderNumber),
      language: "AR",
      merchantBranch: "Autoobenz",
      subTotal: total,
      totalAmount: total,
      currency: "KWD",
      discountAmount: 0,
      taxAmount: 0,
      deliveryAmount: 0,
      deliveryMethod: "home delivery",
      otherFee: 0,
      merchantRedirectUrl: `${origin}/order-success?order=${encodeURIComponent(body.orderNumber)}&payment=taly`,
      postBackUrl: `${origin}/wc-api/wc_taly`,
      merchantLogo: `${origin}/assets/images/autoobenz-logo.png`,
      platform: "website",
      isDigitalOrder: false,
      customerDetails: {
        firstName,
        lastName,
        gender: "Male",
        countryCode,
        phoneNumber,
        customerEmail: String(order.customer_email || body.customerEmail || "").slice(0, 120),
        registeredSince: new Date().toISOString().slice(0, 10),
        loyaltyMember: false,
        loyaltyLevel: "Standard",
      },
      deliveryAddress: {
        city: String(order.shipping_city || body.customerCity || "Kuwait City"),
        area: String(order.shipping_country || body.customerCountry || "Kuwait"),
        fullAddress: String(order.shipping_address || body.customerAddress || "Kuwait"),
        phoneNumber,
        customerEmail: String(order.customer_email || body.customerEmail || "").slice(0, 120),
      },
      orderItems: buildOrderItems(body.items),
    };

    const orderPath = process.env.TALY_ORDER_PATH || "/accounts/payment/v2/initiate";
    const talyData = await talyFetch(orderPath, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const paymentUrl = String(pickDeep(talyData, ["secureCheckoutUrl", "checkout_url", "checkoutUrl"]));
    const talyOrderId = String(pickDeep(talyData, ["OrderID", "orderID", "orderId", "order_id", "id"]));
    const orderReference = String(pickDeep(talyData, ["orderToken", "order_token", "orderReference", "order_reference", "reference"]));

    if (!paymentUrl) {
      throw new Error("Taly did not return a payment link.");
    }

    await supabasePatchOrder(body.orderId, {
      payment_method: "taly",
      payment_status: "payment_link_created",
      taly_order_id: talyOrderId || null,
      taly_order_reference: orderReference || String(body.orderNumber),
      taly_payment_url: paymentUrl,
      taly_status: "pending",
      taly_response: talyData,
    });

    return json(res, 200, { ok: true, talyOrderId, orderReference, paymentUrl });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error.message || "تعذر إنشاء رابط دفع تالي.",
    });
  }
};
