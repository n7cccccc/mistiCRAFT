/* ============================================================
   mistiCRAFT — custom shipping label (client-side PDF)
   Requires, loaded before this file:
   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.0.0/jspdf.umd.min.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3/dist/JsBarcode.all.min.js"></script>

   A fallback for when a courier's own label/packing-slip API isn't
   available (e.g. Delhivery's Packing Slip API needs a separate
   permission some accounts don't have yet) — this generates a
   self-contained 4x6" shipping label straight from the order data
   already on file, no external API call needed. Laid out as bordered
   grid sections (header / barcode+pincode / ship-to+order / ship-from
   / itemized total) like a real courier label, using jsPDF rect()
   for the borders and JsBarcode (rendered to a canvas, embedded as an
   image — jsPDF has no barcode support of its own) for the Code128
   waybill barcode. Degrades gracefully — no fabricated data: a field
   with nothing on file is simply left off rather than shown blank or
   invented, and if JsBarcode didn't load, the waybill still prints as
   plain text.
   ============================================================ */
(function (root) {
  function esc(s) { return String(s == null ? '' : s); }
  function money(n) { return 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

  function barcodeDataUrl(text) {
    if (typeof window.JsBarcode === 'undefined' || !text) return null;
    try {
      var canvas = document.createElement('canvas');
      window.JsBarcode(canvas, text, { format: 'CODE128', displayValue: false, margin: 0, height: 70, width: 2 });
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('mistiCRAFT label: barcode render failed', e);
      return null;
    }
  }

  function buildDoc(order, settings) {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      console.error('mistiCRAFT label: jsPDF did not load — check your network connection.');
      return null;
    }
    settings = settings || {};
    var jsPDF = window.jspdf.jsPDF;
    // Standard 4x6" shipping label.
    var doc = new jsPDF({ unit: 'mm', format: [101.6, 152.4] });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var left = 3, right = pageW - 3;
    var innerW = right - left;
    var y = 3;

    doc.setDrawColor(0);

    function hLine(yPos) { doc.setLineWidth(0.35); doc.line(left, yPos, right, yPos); }
    function vLine(xPos, y1, y2) { doc.setLineWidth(0.35); doc.line(xPos, y1, xPos, y2); }
    function box(x1, y1, x2, y2) { doc.setLineWidth(0.35); doc.rect(x1, y1, x2 - x1, y2 - y1); }
    function label(text, x, yPos, opts) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(110);
      doc.text(text, x, yPos, opts || {});
      doc.setTextColor(0);
    }
    // Prints text wrapped to maxW and returns the y position after it, so a
    // wrapped line doesn't get overwritten by whatever prints next.
    function wrapped(text, x, yStart, maxW, lineH) {
      var lines = doc.splitTextToSize(esc(text), maxW);
      doc.text(lines, x, yStart);
      return yStart + lines.length * lineH;
    }

    // Outer border, like a real courier label.
    box(2, 2, pageW - 2, pageH - 2);

    var addr = order.address || {};
    var contact = order.contact || {};
    var payMethod = (order.payment && order.payment.method) ? order.payment.method.toUpperCase() : 'PREPAID';

    // ---------- Row: Store name | Payment mode ----------
    var row1Bottom = y + 15;
    var col1X = left + innerW * 0.62;
    vLine(col1X, y, row1Bottom);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('mistiCRAFT', left + 3, y + 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text('Handcrafted goods', left + 3, y + 12.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(esc(payMethod), col1X + (right - col1X) / 2, y + 9.5, { align: 'center' });
    y = row1Bottom;
    hLine(y);

    // ---------- Row: Barcode + waybill | Destination PIN ----------
    var row2Bottom = y + 38;
    var col2X = left + innerW * 0.6;
    vLine(col2X, y, row2Bottom);

    var waybill = String(order.trackingId || '').trim();
    var barcode = barcodeDataUrl(waybill);
    var bcCenterX = left + (col2X - left) / 2;
    var by = y + 4;
    if (barcode) {
      var bw = (col2X - left) - 8, bh = 16;
      doc.addImage(barcode, 'PNG', left + 4, by, bw, bh);
      by += bh + 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(waybill || '—', bcCenterX, by, { align: 'center' });
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
      doc.text(waybill || '—', bcCenterX, y + 18, { align: 'center', maxWidth: col2X - left - 6 });
    }
    by += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(esc(order.transporter || 'Courier not yet assigned'), bcCenterX, by, { align: 'center' });

    var pinCenterX = col2X + (right - col2X) / 2;
    label('DESTINATION PIN', pinCenterX, y + 6, { align: 'center' });
    if (addr.pin) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(24);
      doc.text(esc(addr.pin), pinCenterX, y + 20, { align: 'center' });
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    var cityState = [addr.city, addr.state].filter(Boolean).join(', ');
    if (cityState) doc.text(cityState, pinCenterX, y + 27, { align: 'center', maxWidth: right - col2X - 4 });

    y = row2Bottom;
    hLine(y);

    // ---------- Row: Ship To | Order info ----------
    var row3Bottom = y + 36;
    var col3X = left + innerW * 0.66;
    vLine(col3X, y, row3Bottom);

    label('SHIP TO', left + 3, y + 4.5);
    var addrColW = col3X - left - 6;
    var sy = y + 10;
    if (addr.name) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); sy = wrapped(addr.name, left + 3, sy, addrColW, 5); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    if (addr.street) sy = wrapped(addr.street, left + 3, sy, addrColW, 4.2);
    var cityLine = [addr.city, addr.state, addr.pin].filter(Boolean).join(', ');
    if (cityLine) sy = wrapped(cityLine, left + 3, sy, addrColW, 4.2);
    if (contact.phone) { doc.setFont('helvetica', 'bold'); doc.text('Ph: ' + esc(contact.phone), left + 3, sy); doc.setFont('helvetica', 'normal'); }

    label('ORDER', col3X + 3, y + 4.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text(esc(order.orderNumber), col3X + 3, y + 10, { maxWidth: right - col3X - 6 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    var dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    if (dateStr) doc.text(dateStr, col3X + 3, y + 15);

    y = row3Bottom;
    hLine(y);

    // ---------- Row: Ship From (seller) ----------
    var row4Bottom = y + 13;
    label('SHIP FROM', left + 3, y + 4.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('mistiCRAFT', left + 3, y + 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    var fromLoc = settings.delhivery_pickup_location || '';
    var fromContact = [settings.store_phone, settings.store_email].filter(Boolean).join('  ·  ');
    var fromLine = [fromLoc, fromContact].filter(Boolean).join('   —   ');
    if (fromLine) doc.text(fromLine, left + 28, y + 9.5, { maxWidth: innerW - 28 });

    y = row4Bottom;
    hLine(y);

    // ---------- Row: Itemized products ----------
    var items = order.items || [];
    var maxRows = 5;
    var shown = items.slice(0, maxRows);
    var rowH = 5;
    var extraRow = items.length > maxRows ? 1 : 0; // "+ N more items" line
    var tableBodyH = (Math.max(shown.length, 1) + extraRow) * rowH;
    var tableBottom = y + 6 + tableBodyH + 6; // header + rows + total row

    var priceColX = right - 32, totalColX = right - 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(0);
    doc.text('PRODUCT', left + 3, y + 4.5);
    doc.text('PRICE', priceColX, y + 4.5, { align: 'right' });
    doc.text('TOTAL', totalColX, y + 4.5, { align: 'right' });
    hLine(y + 6);

    // Truncate with an ellipsis rather than letting jsPDF wrap a long name
    // to a second line — every row here is a fixed height, so a wrapped
    // line would print on top of the row below it. The available width
    // depends on this row's own price text, not a fixed guess, since
    // right-aligned text at priceColX extends left by its own width.
    function truncate(text, maxW) {
      if (doc.getTextWidth(text) <= maxW) return text;
      while (text.length > 1 && doc.getTextWidth(text + '…') > maxW) text = text.slice(0, -1);
      return text + '…';
    }

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    var ry = y + 6 + rowH - 1.5;
    shown.forEach(function (it) {
      var qty = Number(it.qty) || 1;
      var name = esc(it.name) + (qty > 1 ? (' (' + qty + ')') : '') + (it.size ? (' · ' + esc(it.size)) : '');
      var priceText = money(it.price);
      var nameColW = priceColX - doc.getTextWidth(priceText) - left - 6;
      doc.text(truncate(name, nameColW), left + 3, ry);
      doc.text(priceText, priceColX, ry, { align: 'right' });
      doc.text(money((Number(it.price) || 0) * qty), totalColX, ry, { align: 'right' });
      ry += rowH;
    });
    if (items.length > maxRows) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7);
      doc.text('+ ' + (items.length - maxRows) + ' more item' + (items.length - maxRows === 1 ? '' : 's'), left + 3, ry);
      ry += rowH;
    }

    hLine(y + 6 + tableBodyH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text('TOTAL', priceColX, y + 6 + tableBodyH + 4.5, { align: 'right' });
    doc.text(money(order.total), totalColX, y + 6 + tableBodyH + 4.5, { align: 'right' });

    y = tableBottom;
    hLine(y);

    return doc;
  }

  function generate(order, settings) {
    var doc = buildDoc(order, settings);
    if (!doc) return false;
    doc.save('mistiCRAFT-Label-' + (order.orderNumber || 'order') + '.pdf');
    return true;
  }

  function generateBlob(order, settings) {
    var doc = buildDoc(order, settings);
    return doc ? doc.output('blob') : null;
  }

  root.mistiLabel = { generate: generate, generateBlob: generateBlob };
})(window);
