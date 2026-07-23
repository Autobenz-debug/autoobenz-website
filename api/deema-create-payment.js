const DEEMA_LIVE_API = "https://api.deema.me";

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

async function deemaFetch(path, options = {}) {
  const baseUrl = String(process.env.DEEMA_API_BASE_URL || DEEMA_LIVE_API).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.message || data?.error || text || `Deema request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
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

  const response = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,total_kwd&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows?.[0] || null;
}

function verifyOrder(order, body, amount) {
  if (!order) throw new Error("Order not found.");
  if (String(order.order_number || "") !== String(body.orderNumber || "")) {
    throw new Error("Order number mismatch.");
  }
  const expectedAmount = Number(order.total_kwd || 0);
  if (!expectedAmount || Math.abs(expectedAmount - amount) > 0.001) {
    throw new Error("Order amount mismatch.");
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = await readBody(req);
    const apiKey = cleanSecret(process.env.DEEMA_API_KEY);
    const amount = Number(body.amount || 0);
    if (!apiKey) throw new Error("Deema API key is missing in Vercel Environment Variables.");
    if (!body.orderNumber || !amount) throw new Error("Order number and amount are required.");

    const order = await supabaseGetOrder(body.orderId);
    verifyOrder(order, body, amount);

    const origin = requestOrigin(req);
    const payload = {
      amount: Number(amount.toFixed(3)),
      currency_code: "KWD",
      merchant_order_id: String(body.orderNumber),
      merchant_urls: {
        success: `${origin}/order-success?order=${encodeURIComponent(body.orderNumber)}&payment=deema`,
        failure: `${origin}/checkout?payment=deema&status=failed&order=${encodeURIComponent(body.orderNumber)}`,
      },
    };

    const deemaData = await deemaFetch("/api/merchant/v1/purchase", {
      method: "POST",
      headers: {
        Authorization: `Basic ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const orderReference = deemaData?.data?.order_reference || deemaData?.order_reference || "";
    const paymentUrl = deemaData?.data?.redirect_link || deemaData?.redirect_link || "";
    if (!orderReference || !paymentUrl) throw new Error("Deema did not return a payment link.");

    await supabasePatchOrder(body.orderId, {
      payment_method: "deema",
      payment_status: "payment_link_created",
      deema_order_reference: String(orderReference),
      deema_payment_url: paymentUrl,
      deema_status: "pending",
      deema_response: deemaData,
    });

    return json(res, 200, { ok: true, orderReference, paymentUrl });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: error.message || "تعذر إنشاء رابط دفع ديمه.",
    });
  }
};
