/* ============================================================
   mistiCRAFT — combined shipping label + invoice, one A4 page
   Requires, loaded before this file:
   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.0.0/jspdf.umd.min.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3/dist/JsBarcode.all.min.js"></script>
   <script src="label.js"></script>
   Optional (only needed to embed a courier's real label instead of
   mistiCRAFT's own drawn one — see below):
   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>

   For printing the label and the invoice from a single sheet instead
   of two separate downloads.

   generate(order, settings, courierPdfBase64) — pass the courier's own
   label PDF (base64, as returned by delhivery-create-shipment's
   "label" action) as the third argument to embed THAT as a flattened
   image instead of drawing mistiCRAFT's own label — e.g. so the
   printed sheet carries Delhivery's actual barcode/waybill format.
   Rendering it needs pdf.js (only loaded on pages that use this);
   if courierPdfBase64 is omitted, or pdf.js isn't loaded, or the PDF
   fails to render, this silently falls back to mistiCRAFT's own drawn
   label (via label.js's drawLabel()) rather than failing the whole
   document — a combined slip with our own label is much better than
   no combined slip at all.

   Places the label (courier image or drawn) top-left, a compact
   invoice header top-right, and the itemized order table spanning the
   full width below both.
   ============================================================ */
(function (root) {
  function esc(s) { return String(s == null ? '' : s); }
  function money(n) { return 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

  // Renders page 1 of a base64 PDF to a PNG data URL via pdf.js, high
  // enough resolution (scale 3 ≈ 216 DPI at 4x6") to keep a barcode
  // scannable after being flattened into an image.
  async function renderPdfFirstPageToImage(pdfBase64, scale) {
    if (!window.pdfjsLib) throw new Error('pdf.js not loaded');
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      // Best-effort default matching the CDN path used for pdf.min.js
      // above; a page that loads pdf.js differently should set this
      // itself before calling generate().
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    var binary = atob(pdfBase64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    var page = await pdf.getPage(1);
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    var v = page.view; // [x0, y0, x1, y1] in PDF points (1/72")
    return {
      dataUrl: canvas.toDataURL('image/png'),
      widthMM: (v[2] - v[0]) / 72 * 25.4,
      heightMM: (v[3] - v[1]) / 72 * 25.4,
    };
  }

  async function buildDoc(order, settings, courierPdfBase64) {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      console.error('mistiCRAFT combo slip: jsPDF did not load — check your network connection.');
      return null;
    }
    if (!window.mistiLabel || typeof window.mistiLabel.drawLabel !== 'function') {
      console.error('mistiCRAFT combo slip: label.js must be loaded first.');
      return null;
    }
    settings = settings || {};
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var pageW = doc.internal.pageSize.getWidth();
    var marginX = 12;

    // ---------- Top: label (left) + invoice header (right) ----------
    var targetLabelH = 118.87; // = mistiCRAFT's own drawn label at scale 0.78
    var labelW, labelBottom;

    var courierImg = null;
    if (courierPdfBase64) {
      try {
        courierImg = await renderPdfFirstPageToImage(courierPdfBase64, 3);
      } catch (e) {
        console.error('mistiCRAFT combo slip: could not render courier PDF, falling back to mistiCRAFT\'s own label', e);
      }
    }

    if (courierImg) {
      var aspect = courierImg.widthMM / courierImg.heightMM;
      labelW = targetLabelH * aspect;
      doc.addImage(courierImg.dataUrl, 'PNG', marginX, 10, labelW, targetLabelH);
      labelBottom = 10 + targetLabelH;
    } else {
      var labelScale = 0.78;
      labelW = window.mistiLabel.NATIVE_W * labelScale;
      labelBottom = window.mistiLabel.drawLabel(doc, order, settings, marginX, 10, labelScale);
    }

    var col2X = marginX + labelW + 8;
    var col2W = pageW - marginX - col2X;
    var hy = 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('TAX INVOICE', col2X, hy); hy += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Invoice #: ' + esc(order.orderNumber), col2X, hy); hy += 6;
    var dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    if (dateStr) { doc.text('Date: ' + dateStr, col2X, hy); hy += 6; }
    var payMethod = (order.payment && order.payment.method) ? order.payment.method.toUpperCase() : 'PREPAID';
    doc.text('Payment: ' + payMethod, col2X, hy); hy += 6;
    if (order.transporter) {
      doc.text('Transporter: ' + esc(order.transporter) + (order.trackingId ? (' · ' + esc(order.trackingId)) : ''), col2X, hy, { maxWidth: col2W });
      hy += 6;
    }
    hy += 4;
    doc.setDrawColor(200); doc.line(col2X, hy, col2X + col2W, hy); hy += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(90);
    doc.text('SHIP TO', col2X, hy); hy += 5;
    doc.setTextColor(0);
    var addr = order.address || {};
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (addr.name) { doc.text(esc(addr.name), col2X, hy, { maxWidth: col2W }); hy += 5; }
    if (addr.street) { doc.text(esc(addr.street), col2X, hy, { maxWidth: col2W }); hy += 5; }
    var cityLine = [addr.city, addr.state, addr.pin].filter(Boolean).join(', ');
    if (cityLine) { doc.text(cityLine, col2X, hy, { maxWidth: col2W }); hy += 5; }
    if (settings.store_email || settings.store_phone) {
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(esc([settings.store_email, settings.store_phone].filter(Boolean).join('  ·  ')), col2X, labelBottom - 2, { maxWidth: col2W });
      doc.setTextColor(0);
    }

    // ---------- Below both: itemized table, full width ----------
    var y = labelBottom + 10;
    var right = pageW - marginX;
    function line(y1) { doc.setDrawColor(200); doc.line(marginX, y1, right, y1); }

    var col = { item: marginX, qty: right - 62, price: right - 42, total: right };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0);
    doc.text('Item', col.item, y);
    doc.text('Qty', col.qty, y, { align: 'right' });
    doc.text('Price', col.price, y, { align: 'right' });
    doc.text('Total', col.total, y, { align: 'right' });
    y += 3;
    line(y); y += 6;
    doc.setFont('helvetica', 'normal');

    (order.items || []).forEach(function (it) {
      var itLabel = esc(it.name) + (it.size ? (' (Size ' + esc(it.size) + ')') : '');
      doc.text(itLabel, col.item, y, { maxWidth: right - marginX - 70 });
      doc.text(String(it.qty), col.qty, y, { align: 'right' });
      doc.text(money(it.price), col.price, y, { align: 'right' });
      doc.text(money(it.price * it.qty), col.total, y, { align: 'right' });
      y += 7;
    });

    y += 2;
    line(y); y += 8;

    doc.text('Subtotal', col.price, y, { align: 'right' });
    doc.text(money(order.subtotal), col.total, y, { align: 'right' });
    y += 6;
    doc.text('Shipping', col.price, y, { align: 'right' });
    doc.text(money(order.shipping), col.total, y, { align: 'right' });
    y += 7;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('TOTAL', col.price, y, { align: 'right' });
    doc.text(money(order.total), col.total, y, { align: 'right' });

    y += 14;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text('Thank you for shopping with mistiCRAFT.', marginX, y); y += 5;
    doc.text('This is a system-generated document and does not require a signature.', marginX, y);

    return doc;
  }

  async function generate(order, settings, courierPdfBase64) {
    var doc = await buildDoc(order, settings, courierPdfBase64);
    if (!doc) return false;
    doc.save('mistiCRAFT-Slip-' + (order.orderNumber || 'order') + '.pdf');
    return true;
  }

  async function generateBlob(order, settings, courierPdfBase64) {
    var doc = await buildDoc(order, settings, courierPdfBase64);
    return doc ? doc.output('blob') : null;
  }

  root.mistiComboSlip = { generate: generate, generateBlob: generateBlob };
})(window);
