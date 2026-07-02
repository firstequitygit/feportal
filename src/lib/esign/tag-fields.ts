// Converts the invisible {{...}} text tags rendered inside our PDFs
// into explicit BoldSign FormFields with page coordinates.
//
// WHY: BoldSign's UseTextTags scanning silently fails on our
// white-rendered tags — the send API returns 201, then the document
// dies during async processing: never visible in the dashboard, no
// signer email, unreadable by API (403). Discovered July 2026 after
// every portal send "did nothing". Explicit FormFields (coordinates
// in the send payload) process instantly, so we extract each tag's
// position from the rendered PDF and send fields at those spots.
// The tags themselves stay in the PDFs as invisible position markers.
//
// Tag syntax (matches BoldSign's convention, pipe-separated):
//   {{type|signerIndex|required|label|id}}
//   e.g. {{sign|1|*|Signature|borrower_sig}}, {{datesigned|1|*}}

import { PDFDocument } from 'pdf-lib'

export interface BoldSignFormField {
  fieldType: string
  pageNumber: number
  bounds: { x: number; y: number; width: number; height: number }
  isRequired: boolean
  /** Optional stable field id (used by the fixed-form pipeline). */
  id?: string
}

const TAG_RE = /\{\{([a-z]+)\|(\d+)(?:\|([^|}]*))?(?:\|([^|}]*))?(?:\|([^|}]*))?\}\}/gi

const FIELD_TYPE_MAP: Record<string, string> = {
  sign: 'Signature',
  signature: 'Signature',
  init: 'Initial',
  initial: 'Initial',
  datesigned: 'DateSigned',
  text: 'TextBox',
  checkbox: 'CheckBox',
}

// Field box sizes (points). The extracted tag position anchors the
// field's bottom-left; these control how big the fillable area is.
const FIELD_SIZE: Record<string, { width: number; height: number }> = {
  Signature: { width: 200, height: 40 },
  Initial: { width: 80, height: 40 },
  DateSigned: { width: 120, height: 30 },
  TextBox: { width: 180, height: 24 },
  CheckBox: { width: 16, height: 16 },
}

/**
 * Scan a rendered PDF for {{...}} tags and return BoldSign FormFields
 * positioned where the tags sit. Currently single-signer: all tags are
 * assumed to belong to signer 1 (every portal doc today has exactly
 * one signer).
 */
export async function extractTagFields(pdf: Buffer): Promise<BoldSignFormField[]> {
  // unpdf bundles a serverless-friendly pdfjs build. Dynamic import so
  // it never enters the client bundle.
  const { getDocumentProxy } = await import('unpdf')

  // Page heights from pdf-lib (pdfjs text positions are bottom-origin;
  // BoldSign bounds are top-origin, so we need heights to flip Y).
  const doc = await PDFDocument.load(pdf)
  const pageHeights = doc.getPages().map(p => p.getHeight())

  const proxy = await getDocumentProxy(new Uint8Array(pdf))
  const fields: BoldSignFormField[] = []

  for (let pageNo = 1; pageNo <= proxy.numPages; pageNo++) {
    const page = await proxy.getPage(pageNo)
    const tc = await page.getTextContent()
    const pageHeight = pageHeights[pageNo - 1] ?? 792

    // Group text runs by line (rounded Y) so a tag split across
    // multiple runs is still found. Each run keeps its own X.
    const lines = new Map<number, Array<{ str: string; x: number; y: number; width: number }>>()
    for (const item of tc.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
      if (!item.str || !item.transform) continue
      const x = item.transform[4]
      const y = item.transform[5]
      const key = Math.round(y * 2) / 2
      if (!lines.has(key)) lines.set(key, [])
      lines.get(key)!.push({ str: item.str, x, y, width: item.width ?? 0 })
    }

    for (const runs of lines.values()) {
      runs.sort((a, b) => a.x - b.x)
      const joined = runs.map(r => r.str).join('')
      TAG_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = TAG_RE.exec(joined)) !== null) {
        const fieldType = FIELD_TYPE_MAP[m[1].toLowerCase()]
        if (!fieldType) continue
        // Locate the run containing the tag start to get its X.
        let acc = 0
        let tagX = runs[0].x
        let tagY = runs[0].y
        for (const r of runs) {
          if (m.index < acc + r.str.length) { tagX = r.x; tagY = r.y; break }
          acc += r.str.length
        }
        const size = FIELD_SIZE[fieldType] ?? FIELD_SIZE.TextBox
        fields.push({
          fieldType,
          pageNumber: pageNo,
          // BoldSign bounds: X/Y from the page's TOP-left. Anchor the
          // field so its bottom sits on the tag's baseline.
          bounds: {
            x: Math.max(0, tagX),
            y: Math.max(0, pageHeight - tagY - size.height),
            width: size.width,
            height: size.height,
          },
          isRequired: (m[3] ?? '*') !== '',
        })
      }
    }
  }

  return fields
}
