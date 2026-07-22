// #173 Chunk 6 — printable blank restock sheet (owner-only, offline).
//
// Produces a REAL downloadable .pdf FILE (not window.print) so the owner can save it,
// WhatsApp it, or carry it to a print shop (R9). jspdf + autotable are LAZY-imported
// inside generate() so they cost 0 bundle bytes until the owner actually taps "Sheet".
//
// The sheet mirrors the Bulk Restock ENTRY screen exactly (R1): same items, SAME ORDER,
// SAME row numbers — both come from listRestockItems(). Staff writes the DATE at the top
// of a blank column himself (R3 — purchases are irregular, pre-printed dates waste paper)
// and pencils quantities down the column; the owner then types them down the screen in the
// same order without hunting.
//
// PRINT-SAFE (R8): pure black on white, no fills, no theme variables. Everything here is
// jspdf drawing primitives — there is no screen CSS to vanish at print time.

import { listRestockItems, restockSheetVersion } from './restockItems'

// ── Layout (A4 portrait, units = pt; jspdf default A4 = 595.28 × 841.89pt) ──────────
const QTY_COLS = 10 // R3 — ~10 blank narrow columns for handwritten quantities
const MARGIN = 32 // pt — outer margin on all sides
const ROW_MIN_HEIGHT = 22 // pt — generous for handwriting (R4), not screen density
const NAME_FONT = 10
const HEADER_FONT = 9

/** Build and download the blank restock sheet as an A4 PDF.
 *  @param clubName  printed in the header (falls back to "ClubKeeper" if empty).
 *  @param now       generation timestamp (ms) — passed in, never read from a clock here,
 *                   so callers control it and tests stay deterministic.
 *  Returns the number of item rows written (0 ⇒ nothing to print; caller should toast). */
export async function downloadRestockSheet(clubName: string, now: number): Promise<number> {
  const items = await listRestockItems()
  if (items.length === 0) return 0

  // Lazy import — pulls jspdf (~200KB) + autotable (~50KB) only on demand.
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const autoTable = autoTableMod.default

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Month/year + club header (R5). date-fns isn't needed for one label — build it plainly.
  const d = new Date(now)
  const monthYear = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const genDate = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const version = restockSheetVersion(items)

  // Column geometry: "#" + full-name column + QTY_COLS equal blank columns.
  const usableWidth = pageWidth - MARGIN * 2
  const numColW = 26
  const qtyColW = 26 // narrow — just wide enough for a 2-3 digit handwritten number
  const nameColW = usableWidth - numColW - qtyColW * QTY_COLS
  // If the name column would be too thin (many qty cols on A4), it still wraps rather than
  // truncates — autotable's cellWidth:'wrap' + overflow:'linebreak' guarantee full names (R3).

  // Header row: "#", "Item", then BLANK qty headers (R3 — staff writes the date himself).
  const head = [['#', 'Item', ...Array.from({ length: QTY_COLS }, () => '')]]

  const body = items.map((it, i) => [
    String(i + 1), // R1 — row number = sortOrder position; consecutive across pages (R7)
    it.name, // R3 — full name, never truncated (linebreak overflow below)
    ...Array.from({ length: QTY_COLS }, () => ''), // blank cells to write into
  ])

  autoTable(doc, {
    head,
    body,
    startY: MARGIN + 46, // leave room for the header text block drawn in didDrawPage
    margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + 18 }, // bottom clears the footer
    theme: 'grid', // visible cell borders to write between
    styles: {
      font: 'helvetica',
      fontSize: NAME_FONT,
      textColor: [0, 0, 0], // R8 — pure black
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      minCellHeight: ROW_MIN_HEIGHT, // R4 — generous handwriting height
      valign: 'middle',
      overflow: 'linebreak', // R3 — wrap long names, never clip
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
    },
    headStyles: {
      fontSize: HEADER_FONT,
      fontStyle: 'bold',
      textColor: [0, 0, 0],
      fillColor: false, // R8 — no toner-eating header fill; borders only
      lineColor: [0, 0, 0],
      lineWidth: 0.5,
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: numColW, halign: 'center' }, // #
      1: { cellWidth: nameColW, halign: 'left' }, // Item (full name)
      // qty columns (indexes 2 … QTY_COLS+1) — equal narrow width.
      ...Object.fromEntries(
        Array.from({ length: QTY_COLS }, (_, k) => [k + 2, { cellWidth: qtyColW }]),
      ),
    },
    showHead: 'everyPage', // R7 — repeat the header row on every page
    rowPageBreak: 'avoid', // don't split a single item row across a page boundary
    // Per-page header + version footer. Row numbers already run consecutively because
    // body[] is numbered once over the whole list, so pagination keeps them in sequence (R7).
    // NOTE: "Page X of Y" is NOT drawn here — didDrawPage fires DURING layout, when
    // getNumberOfPages() only knows the pages created so far (a 3-page sheet would print
    // "Page 2 of 2"). The total is stamped in a second pass below, once layout is final.
    didDrawPage: () => {
      // ── Header block (top-left): club name + month/year ──
      doc.setTextColor(0, 0, 0)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(15)
      doc.text(clubName.trim() || 'ClubKeeper', MARGIN, MARGIN + 12)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.text(`Stock received — ${monthYear}`, MARGIN, MARGIN + 30)

      // ── Footer left: version code + generation date (R6) — total-independent ──
      doc.setFontSize(8)
      doc.setTextColor(90, 90, 90) // dark grey — still prints clearly, not pure black clutter
      doc.text(`v ${version}  ·  generated ${genDate}`, MARGIN, pageHeight - MARGIN + 6)
    },
  })

  // ── Second pass: stamp "Page X of Y" now that the total page count is final. ──
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(
      `Page ${p} of ${totalPages}`,
      pageWidth - MARGIN,
      pageHeight - MARGIN + 6,
      { align: 'right' },
    )
  }

  const fileName = `restock-sheet-${version}.pdf`
  doc.save(fileName)
  return items.length
}
