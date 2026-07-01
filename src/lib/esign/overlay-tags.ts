// Overlays invisible BoldSign text tags onto a fixed PDF form so the
// provider converts them into fillable Signature + DateSigned fields.
//
// The tags are drawn as white text at the form's configured position;
// BoldSign's UseTextTags scan reads the text layer (color-agnostic), so
// the fields land where the tags sit while staying invisible in the
// document itself. Same tag convention as the generated Term Sheet.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { EsignForm } from './forms'

export async function overlayEsignTags(
  pdfBytes: Uint8Array | Buffer,
  form: EsignForm,
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()

  const idx = form.page === 'last'
    ? pages.length - 1
    : Math.min(Math.max(form.page - 1, 0), pages.length - 1)
  const page = pages[idx]

  const white = rgb(1, 1, 1)
  // Signature field, then the date field to its right. Signer index 1,
  // required (*). White = invisible.
  page.drawText('{{sign|1|*|Signature|borrower_sig}}', { x: form.x, y: form.y, size: 9, font, color: white })
  page.drawText('{{datesigned|1|*}}', { x: form.x + 230, y: form.y, size: 9, font, color: white })

  const out = await doc.save()
  return Buffer.from(out)
}
