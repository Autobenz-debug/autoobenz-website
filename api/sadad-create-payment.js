const SADAD_LIVE_API = "https://api.sadadpay.net";
const SADAD_LIVE_PAY = "https://sadadpay.net/pay";

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

async function sadadFetch(path, options = {}) {
  const baseUrl = process.env.SADAD_API_BASE_URL || SADAD_LIVE_API;
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok || data?.isValid === false) {
    const message = data?.errorKey || data?.message || text || `Sadad request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function getAccessToken() {
  const clientKey = cleanSecret(process.env.SADAD_CLIENT_KEY);
  const clientSecret = cleanSecret(process.env.SADAD_CLIENT_SECRET);
  if (!clientKey || !clientSecret) {
    throw new Error("SadadPay credentials are missing in Vercel Environment Variables.");
  }

  const basic = Buffer.from(`${clientKey}:${clientSecret}`).toString("base64");
  const refreshData = await sadadFetch("/api/User/GenerateRefreshToken", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const refreshToken = refreshData?.response?.refreshToken;
  if (!refreshToken) throw new Error("SadadPay did not return a refresh token.");

  const accessData = await sadadFetch("/api/User/GenerateAccessToken", {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  });
  const accessToken = accessData?.response?.accessToken;
  if (!accessToken) throw new Error("SadadPay did not return an access token.");

  return accessToken;
}

function cleanSecret(value) {
  return String(value || "").replace(/\s+/g, "");
}

function firstValue(data, names) {
  const candidates = [
    data,
    data?.response,
    Array.isArray(data?.response) ? data.response[0] : null,
    data?.data,
    Array.isArray(data?.data) ? data.data[0] : null,
  ].filter(Boolean);
  for (const item of candidates) {
    for (const name of names) {
      if (item[name] !== undefined && item[name] !== null && item[name] !== "") return item[name];
    }
  }
  return "";
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

  const response = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,total_kwd,customer_name,customer_phone,customer_email&limit=1`, {
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
    const amount = Number(body.amount || 0);
    if (!body.orderNumber || !amount) {
      return json(res, 400, { ok: false, error: "Order number and amount are required." });
    }

    const order = await supabaseGetOrder(body.orderId);
    verifyOrder(order, body, amount);

    const accessToken = await getAccessToken();
    const invoice = {
      ref_Number: body.orderNumber,
      amount: amount.toFixed(3),
      customer_Name: order.customer_name || body.customerName || "Autoobenz Customer",
      customer_Mobile: String(order.customer_phone || body.customerPhone || "").replace(/[^\d+]/g, ""),
      customer_Email: order.customer_email || body.customerEmail || "orders@autoobenz.com",
      lang: "ar",
      currency_Code: "KWD",
      items: (body.items || []).map((item) => ({
        name: String(item.name || "Autoobenz item").slice(0, 120),
        quantity: Number(item.quantity || 1),
        amount: Number(item.amount || 0),
      })),
    };

    let insertData = null;
    let lastInvoiceError = null;
    for (const payload of [{ invoices: [invoice] }, [invoice], invoice]) {
      try {
        insertData = await sadadFetch("/api/Invoice/insert", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        break;
      } catch (error) {
        lastInvoiceError = error;
      }
    }
    if (!insertData && lastInvoiceError) throw lastInvoiceError;

    const invoiceId = firstValue(insertData, ["invoiceId", "InvoiceId", "invoice_id", "id"]);
    if (!invoiceId) throw new Error("SadadPay did not return an invoice ID.");

    const invoiceData = await sadadFetch(`/api/Invoice/getbyid?id=${encodeURIComponent(invoiceId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const key = firstValue(invoiceData, ["key", "Key", "paymentKey", "PaymentKey"]);
    const url = firstValue(invoiceData, ["url", "URL", "paymentURL", "paymentUrl", "PaymentURL"]) || (key ? `${SADAD_LIVE_PAY}/${key}` : "");
    if (!url) throw new Error("SadadPay did not return a payment URL.");

    await supabasePatchOrder(body.orderId, {
      payment_method: "sadadpay",
      payment_status: "payment_link_created",
      sadad_invoice_id: String(invoiceId),
      sadad_payment_url: url,
      sadad_response: invoiceData,
    });

    return json(res, 200, { ok: true, invoiceId, paymentUrl: url });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: "تعذر إنشاء رابط الدفع. تأكد من مفاتيح SadadPay و Supabase في Vercel.",
    });
  }
};
