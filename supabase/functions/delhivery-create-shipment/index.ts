// mistiCRAFT — Auto-create a Delhivery shipment (waybill + label) for an order
//
// Called directly by an admin from admin.html's Shipping Logistics modal
// (via supabase.functions.invoke, which forwards the admin's own session
// token) instead of the admin manually creating the shipment on
// Delhivery's own site and copy-pasting the waybill number in.
//
// Two actions, both POST with a JSON body:
//   { order_id, action: "create" }  (default) — creates the shipment on
//     Delhivery, gets back a waybill, and sets customer_orders.transporter
//     = 'Delhivery' / tracking_id = <waybill>.
//   { order_id, action: "label" } — fetches that order's packing-slip PDF
//     from Delhivery and returns it base64-encoded, so the DELHIVERY_API_TOKEN
//     never has to leave the server (a plain link with the token embedded
//     would leak it into the admin's browser history).
//
// Every request must carry the calling admin's own Authorization header —
// this function creates its Supabase client with the ANON key plus that
// forwarded header, so every read/write below runs as that admin and is
// governed by the normal RLS policies (customer_orders "read own or
// admin" / "admin update", admins "self read"). There is no service-role
// bypass here — if the caller isn't in the admins table, nothing works.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, getAnonKey, getSupabaseUrl, json } from "../_shared/utils.ts";

const DELHIVERY_API_TOKEN = Deno.env.get("DELHIVERY_API_TOKEN");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!DELHIVERY_API_TOKEN) {
    return json({ error: "DELHIVERY_API_TOKEN is not set — add it under Edge Functions > Secrets in the Supabase dashboard." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

  const supabase = createClient(getSupabaseUrl(), getAnonKey(), {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not signed in." }, 401);

  const { data: adminRow } = await supabase.from("admins").select("uid").eq("uid", userData.user.id).maybeSingle();
  if (!adminRow) return json({ error: "Admin access required." }, 403);

  let body: { order_id?: string; action?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const orderId = body.order_id;
  const action = body.action || "create";
  if (!orderId) return json({ error: "order_id is required." }, 400);

  const { data: order, error: orderError } = await supabase
    .from("customer_orders")
    .select("id, order_number, items, total, contact, address, transporter, tracking_id, created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) return json({ error: orderError.message }, 500);
  if (!order) return json({ error: "Order not found." }, 404);

  if (action === "label") {
    const waybill = String(order.tracking_id || "").trim();
    if (!waybill) return json({ error: "This order has no tracking ID yet — create the shipment first." }, 400);
    const res = await fetch(
      `https://track.delhivery.com/api/p/packing_slip?wbns=${encodeURIComponent(waybill)}&pdf=true&pdf_size=4R`,
      { headers: { Authorization: `Token ${DELHIVERY_API_TOKEN}` } }
    );
    if (!res.ok) {
      if (res.status === 401) {
        return json({
          error: `Delhivery rejected the label request (waybill ${waybill} was created fine, so this isn't an order problem). Your API token doesn't have Packing Slip API access — this is a separate permission from Track/Shipment-Create in Delhivery's dashboard. Ask your Delhivery account manager to enable "Packing Slip API" for your token, or download the label manually from your Delhivery dashboard using this waybill in the meantime.`,
        }, 502);
      }
      return json({ error: `Delhivery label HTTP ${res.status}` }, 502);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const isPdfBytes = (b: Uint8Array) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // "%PDF"

    let pdfBytes: Uint8Array;
    if (isPdfBytes(buf)) {
      pdfBytes = buf;
    } else {
      // packing_slip?pdf=true doesn't actually return the PDF bytes — it
      // returns JSON with a pre-signed S3 link (packages[0].pdf_download_link)
      // to fetch the real file from. Follow that instead of handing the
      // browser this JSON body as if it were "label.pdf".
      const text = new TextDecoder().decode(buf);
      let downloadLink: string | undefined;
      try {
        const parsed = JSON.parse(text);
        downloadLink = parsed?.packages?.[0]?.pdf_download_link;
      } catch (_e) { /* not JSON either — fall through to the error below */ }

      if (!downloadLink) {
        return json({
          error: `Delhivery didn't return a label or a download link for waybill ${waybill}. This usually means the manifest is still processing — wait a minute and try again. Response: ${text.slice(0, 300) || "(empty)"}`,
        }, 502);
      }

      const pdfRes = await fetch(downloadLink);
      if (!pdfRes.ok) {
        return json({ error: `Could not download the label PDF from Delhivery's storage (HTTP ${pdfRes.status}).` }, 502);
      }
      pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
      if (!isPdfBytes(pdfBytes)) {
        return json({ error: `The file at Delhivery's download link for waybill ${waybill} wasn't a valid PDF either.` }, 502);
      }
    }

    let binary = "";
    for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
    return json({ waybill, pdfBase64: btoa(binary) });
  }

  if (order.transporter && order.tracking_id) {
    return json({ error: `Order already has a tracking ID (${order.tracking_id}) — remove it in Shipping Logistics first if you need to recreate the shipment.` }, 400);
  }

  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (!settings?.delhivery_pickup_location) {
    return json({ error: "No Delhivery pickup location configured — set it under Settings first (must exactly match a location registered in your Delhivery dashboard)." }, 400);
  }

  const addr = order.address || {};
  const contact = order.contact || {};
  const missing = ["name", "street", "city", "state", "pin"].filter((f) => !String(addr[f] || "").trim());
  if (!String(contact.phone || "").trim()) missing.push("phone");
  if (missing.length) return json({ error: `Order is missing address fields: ${missing.join(", ")}.` }, 400);

  const items: Array<{ id?: string; name?: string; qty?: number }> = order.items || [];
  const productIds = items.map((it) => it.id).filter(Boolean) as string[];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, weight_grams").in("id", productIds)
    : { data: [] as Array<{ id: string; weight_grams: number | null }> };
  const weightById = new Map((products || []).map((p) => [p.id, p.weight_grams]));

  const defaultWeight = Number(settings.default_package_weight_grams) || 500;
  const totalWeight = items.reduce((sum, it) => {
    const qty = Number(it.qty) || 1;
    const perItem = it.id && weightById.has(it.id) && weightById.get(it.id) != null ? Number(weightById.get(it.id)) : defaultWeight;
    return sum + perItem * qty;
  }, 0) || defaultWeight;
  const totalQty = items.reduce((sum, it) => sum + (Number(it.qty) || 1), 0) || 1;
  const productsDesc = items.map((it) => it.name).filter(Boolean).join(", ") || order.order_number;

  const shipmentPayload = {
    shipments: [
      {
        waybill: "",
        order: order.order_number,
        order_date: new Date(order.created_at).toISOString().slice(0, 19).replace("T", " "),
        total_amount: Number(order.total) || 0,
        name: addr.name,
        add: addr.street,
        city: addr.city,
        state: addr.state,
        country: addr.country || "India",
        phone: contact.phone,
        pin: addr.pin,
        payment_mode: "Prepaid",
        products_desc: productsDesc,
        cod_amount: 0,
        shipment_width: Number(settings.default_package_width_cm) || 25,
        shipment_height: Number(settings.default_package_height_cm) || 5,
        shipment_length: Number(settings.default_package_length_cm) || 30,
        weight: totalWeight,
        quantity: totalQty,
      },
    ],
    pickup_location: { name: settings.delhivery_pickup_location },
  };

  const res = await fetch("https://track.delhivery.com/api/cmu/create.json", {
    method: "POST",
    headers: {
      Authorization: `Token ${DELHIVERY_API_TOKEN}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `format=json&data=${encodeURIComponent(JSON.stringify(shipmentPayload))}`,
  });

  const resText = await res.text();
  let resData: Record<string, unknown>;
  try {
    resData = JSON.parse(resText);
  } catch (_e) {
    return json({ error: `Delhivery returned a non-JSON response (HTTP ${res.status}): ${resText.slice(0, 500)}` }, 502);
  }

  const pkg = (resData.packages as Array<Record<string, unknown>> | undefined)?.[0];
  const waybill = pkg?.waybill as string | undefined;
  if (!res.ok || !waybill || pkg?.status === "Fail" || resData.success === false) {
    const remark = Array.isArray(pkg?.remarks) ? (pkg?.remarks as string[]).join("; ") : (pkg?.remarks as string | undefined);
    return json({ error: remark || pkg?.status || JSON.stringify(resData).slice(0, 500) || "Delhivery rejected the shipment.", raw: resData }, 502);
  }

  const { error: updateError } = await supabase
    .from("customer_orders")
    .update({ transporter: "Delhivery", tracking_id: waybill })
    .eq("id", orderId);
  if (updateError) return json({ error: `Shipment created (waybill ${waybill}) but saving it to the order failed: ${updateError.message}` }, 500);

  return json({ success: true, waybill });
});
