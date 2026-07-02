// Prepares a fixed e-sign form for sending or preview.
//
// prepareFormPdf: stamps the staff-typed fill values (plus any static
// stamps) onto the PDF as black text and builds the explicit BoldSign
// FormFields (signature, date, signer-completed boxes) from the form's
// configured placements. The PDF that goes to BoldSign is the final
// document; fields are sent as coordinates in the API payload, never
// as text tags (BoldSign's tag scanning silently kills documents; see
// boldsign.ts).
//
// renderFormPreview: the same stamped PDF, plus visible outlines where
// every BoldSign field will sit, so staff can check the document
// before sending (and so placement tuning is edit-config, preview).
//
// SSA-89 ships encrypted (no open password), hence ignoreEncryption.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { EsignBox, EsignFillField, EsignForm } from './forms'
import type { BoldSignFormField } from './tag-fields'

const FILL_SIZE = 10
const MIN_FILL_SIZE = 7

interface LoadedForm {
  doc: PDFDocument
  font: PDFFont
  pages: PDFPage[]
}

async function loadAndStamp(
  raw: Uint8Array | Buffer,
  form: EsignForm,
  values: Record<string, string>,
): Promise<LoadedForm> {
  const doc = await PDFDocument.load(raw, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const black = rgb(0.05, 0.05, 0.05)

  for (const field of form.fill) {
    const value = sanitize(values[field.key])
    if (!value) continue
    const page = pages[Math.min(field.page, pages.length) - 1]
    const { lines, size } = layoutValue(font, value, field)
    const lineHeight = field.lineHeight ?? 13
    lines.forEach((line, i) => {
      page.drawText(line, { x: field.x, y: field.y - i * lineHeight, size, font, color: black })
    })
  }

  for (const stamp of form.stamps ?? []) {
    const page = pages[Math.min(stamp.page, pages.length) - 1]
    page.drawText(stamp.text, { x: stamp.x, y: stamp.y, size: stamp.size ?? 10, font, color: black })
  }

  return { doc, font, pages }
}

/** pdf-lib text is WinAnsi-encoded; strip anything outside it (emoji
 *  etc.) so a stray character can't fail the whole send. */
function sanitize(value: string | undefined): string {
  if (!value) return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E -ÿ\n]/g, '')
    .trim()
}

/** Wrap (and if needed shrink) a value to fit its configured box. */
function layoutValue(
  font: PDFFont,
  value: string,
  field: EsignFillField,
): { lines: string[]; size: number } {
  const maxLines = field.maxLines ?? 1
  const maxWidth = field.maxWidth
  if (!maxWidth) return { lines: value.split('\n').slice(0, maxLines), size: FILL_SIZE }

  for (let size = FILL_SIZE; size >= MIN_FILL_SIZE; size--) {
    const lines = wrap(font, value, maxWidth, size)
    if (lines.length <= maxLines) return { lines, size }
  }
  // Still too long at the minimum size: keep the first maxLines lines.
  return { lines: wrap(font, value, maxWidth, MIN_FILL_SIZE).slice(0, maxLines), size: MIN_FILL_SIZE }
}

function wrap(font: PDFFont, value: string, maxWidth: number, size: number): string[] {
  const lines: string[] = []
  for (const paragraph of value.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
  }
  return lines.length ? lines : ['']
}

/** Convert a bottom-left-origin box to BoldSign's top-origin bounds.
 *  pageOffset shifts the form's page numbers when its pages have been
 *  appended after another document's (the Term Sheet + W-9 package). */
function toFormField(
  box: EsignBox,
  fieldType: string,
  id: string,
  required: boolean,
  pages: PDFPage[],
  pageOffset: number,
): BoldSignFormField {
  const pageNumber = Math.min(box.page + pageOffset, pages.length)
  const pageHeight = pages[pageNumber - 1].getHeight()
  return {
    fieldType,
    pageNumber,
    id,
    bounds: {
      x: box.x,
      y: Math.max(0, pageHeight - box.y - box.height),
      width: box.width,
      height: box.height,
    },
    isRequired: required,
  }
}

export function buildFormFields(form: EsignForm, pages: PDFPage[], pageOffset = 0): BoldSignFormField[] {
  const fields: BoldSignFormField[] = [
    toFormField(form.signature, 'Signature', 'signature', true, pages, pageOffset),
    toFormField(form.dateSigned, 'DateSigned', 'date_signed', true, pages, pageOffset),
  ]
  ;(form.signerBoxes ?? []).forEach((box, i) => {
    fields.push(toFormField(
      box,
      box.type === 'checkbox' ? 'CheckBox' : 'TextBox',
      `${box.type}_${i + 1}`,
      box.required ?? false,
      pages,
      pageOffset,
    ))
  })
  return fields
}

/**
 * Append a fixed form (stamped with its fill values) to the end of an
 * existing PDF and return the merged PDF plus the form's BoldSign
 * fields with page numbers shifted past the base document.
 */
export async function appendFormToPdf(
  basePdf: Buffer,
  form: EsignForm,
  formTemplate: Uint8Array | Buffer,
  values: Record<string, string>,
): Promise<PreparedForm> {
  const base = await PDFDocument.load(basePdf)
  const pageOffset = base.getPageCount()
  const { doc: formDoc } = await loadAndStamp(formTemplate, form, values)
  const copied = await base.copyPages(formDoc, formDoc.getPageIndices())
  copied.forEach(p => base.addPage(p))
  const fields = buildFormFields(form, base.getPages(), pageOffset)
  return { pdf: Buffer.from(await base.save()), fields }
}

/**
 * Draw visible dashed outlines for a set of BoldSign fields onto a
 * PDF. Used to preview generated packages (Term Sheet + W-9), where
 * fields come from tag extraction + form config rather than a single
 * form definition. Never send this rendering.
 */
export async function drawFieldOutlines(pdf: Buffer, fields: BoldSignFormField[]): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()
  const blue = rgb(0.15, 0.39, 0.56)
  const amber = rgb(0.72, 0.45, 0.05)

  for (const f of fields) {
    const page = pages[f.pageNumber - 1]
    if (!page) continue
    const pageHeight = page.getHeight()
    const y = pageHeight - f.bounds.y - f.bounds.height
    const isSignerInput = f.fieldType === 'TextBox' || f.fieldType === 'CheckBox'
    const color = isSignerInput ? amber : blue
    page.drawRectangle({
      x: f.bounds.x,
      y,
      width: f.bounds.width,
      height: f.bounds.height,
      borderColor: color,
      borderWidth: 1,
      borderDashArray: [3, 2],
      color,
      opacity: 0.08,
      borderOpacity: 0.9,
    })
    const label =
      f.fieldType === 'Signature' ? 'Signature (signs here)' :
      f.fieldType === 'DateSigned' ? 'Date: auto' :
      f.fieldType === 'TextBox' ? 'Signer fills' : ''
    if (label && f.bounds.height >= 12) {
      page.drawText(label, {
        x: f.bounds.x + 2,
        y: y + Math.max(2, f.bounds.height / 2 - 3),
        size: Math.min(6.5, f.bounds.height - 3),
        font,
        color,
      })
    }
  }
  return Buffer.from(await doc.save())
}

export interface PreparedForm {
  pdf: Buffer
  fields: BoldSignFormField[]
}

/** Final send pipeline: stamped PDF + explicit BoldSign fields. */
export async function prepareFormPdf(
  raw: Uint8Array | Buffer,
  form: EsignForm,
  values: Record<string, string>,
): Promise<PreparedForm> {
  const { doc, pages } = await loadAndStamp(raw, form, values)
  const fields = buildFormFields(form, pages)
  return { pdf: Buffer.from(await doc.save()), fields }
}

/** Preview pipeline: stamped PDF + visible outlines for every field
 *  BoldSign will place. Never send this rendering. */
export async function renderFormPreview(
  raw: Uint8Array | Buffer,
  form: EsignForm,
  values: Record<string, string>,
): Promise<Buffer> {
  const { doc, font, pages } = await loadAndStamp(raw, form, values)

  const blue = rgb(0.15, 0.39, 0.56)
  const amber = rgb(0.72, 0.45, 0.05)

  const drawBox = (box: EsignBox, color: ReturnType<typeof rgb>, label: string) => {
    const page = pages[Math.min(box.page, pages.length) - 1]
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      borderColor: color,
      borderWidth: 1,
      borderDashArray: [3, 2],
      color,
      opacity: 0.08,
      borderOpacity: 0.9,
    })
    if (label) {
      page.drawText(label, {
        x: box.x + 2,
        y: box.y + Math.max(2, box.height / 2 - 3),
        size: Math.min(6.5, box.height - 3),
        font,
        color,
      })
    }
  }

  drawBox(form.signature, blue, 'Signature (borrower signs here)')
  drawBox(form.dateSigned, blue, 'Date: auto')
  for (const box of form.signerBoxes ?? []) {
    drawBox(box, amber, box.type === 'checkbox' ? '' : `Borrower: ${box.label}`)
  }

  return Buffer.from(await doc.save())
}
