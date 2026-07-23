const TALY_LIVE_API = "https://api.taly.io";

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
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

function buildOrderItems(items) {
  const safeItems = Array.isArray(items) && items.length ? items : [{ name: "Autoobenz order", quantity: 1, amount: 0 }];
  return safeItems.map((item, index) => {
    const quantity = Number(item.quantity || 1);
    const total = amount(item.amount || 0);
    const unitPrice = amount(quantity ? total / quantity : total);
    return {
      itemId: String(index + 1),
      name: String(item.name || `Item ${index + 1}`).slice(0, 120),
      description: String(item.name || `Item ${index + 1}`).slice(0, 250),
      quantity,
      unitPrice,
      totalAmount: total,
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

    const origin = requestOrigin(req);
    const accessToken = await getAccessToken();
    const payload = {
      merchantOrderId: String(body.orderNumber),
      language: "ar",
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
      customerDetails: {
        name: String(body.customerName || "Autoobenz Customer").slice(0, 120),
        email: String(body.customerEmail || "").slice(0, 120),
        phoneNumber: String(body.customerPhone || "").replace(/\s+/g, ""),
      },
      deliveryAddress: {
        country: String(body.customerCountry || "Kuwait"),
        city: String(body.customerCity || "Kuwait City"),
        address: String(body.customerAddress || "Kuwait"),
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

    const paymentUrl = String(pickDeep(talyData, [
      "checkoutUrl",
      "checkout_url",
      "paymentUrl",
      "payment_url",
      "redirectUrl",
      "redirect_url",
      "redirectLink",
      "redirect_link",
      "url",
    ]));
    const talyOrderId = String(pickDeep(talyData, ["talyOrderId", "taly_order_id", "orderId", "order_id", "id"]));
    const orderReference = String(pickDeep(talyData, ["orderReference", "order_reference", "reference"]));

    if (!paymentUrl) throw new Error("Taly did not return a payment link.");

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
