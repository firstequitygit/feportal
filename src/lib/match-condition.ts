/**
 * Suggests a condition for a filename by substring match on condition titles.
 *
 * Algorithm:
 *   1. Normalize filename: strip extension, lowercase, replace `_-` with spaces, collapse whitespace.
 *   2. For each condition, check if the normalized filename contains the lowercased condition title.
 *   3. Of all matches, return the one with the longest title (most specific wins).
 *   4. Return null if no condition title is a substring.
 *
 * Examples:
 *   "operating_agreement_v2.pdf"           -> "Operating Agreement"     (substring)
 *   "2023_tax_return_borrower.pdf"         -> "Tax Return"              (substring)
 *   "OA_LLC_signed.pdf"                    -> null                      (no title contains "oa")
 *   "Bank Statements - Jan 2024.pdf"       -> "Bank Statements"         (case + space normalization)
 *   "operating_agreement_articles.pdf"     -> "Articles of Incorporation"
 *                                            IF that title is the longer match - tie-break by length.
 */
export function suggestConditionId(
  filename: string,
  conditions: { id: string; title: string }[],
): string | null {
  const normalized = normalizeFilename(filename)
  let best: { id: string; titleLength: number } | null = null
  for (const c of conditions) {
    const title = normalizeTitle(c.title)
    if (!title) continue
    if (normalized.includes(title)) {
      if (!best || title.length > best.titleLength) {
        best = { id: c.id, titleLength: title.length }
      }
    }
  }
  return best?.id ?? null
}

function normalizeFilename(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '')   // strip last extension
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')    // underscores/hyphens to spaces
    .replace(/\s+/g, ' ')       // collapse whitespace
    .trim()
}

// Titles get the same hyphen-to-space treatment as filenames so a title like
// "Government-Issued Photo ID" matches a filename like "government_issued_photo_id.pdf".
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ----- Self-test (run via `npx tsx src/lib/match-condition.ts`) -----
// This block runs only when the file is invoked directly, not when imported.
if (typeof require !== 'undefined' && require.main === module) {
  const cases: { filename: string; conditions: { id: string; title: string }[]; expected: string | null }[] = [
    {
      filename: 'operating_agreement_v2.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }, { id: 'b', title: 'Tax Return' }],
      expected: 'a',
    },
    {
      filename: '2023_tax_return.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }, { id: 'b', title: 'Tax Return' }],
      expected: 'b',
    },
    {
      filename: 'OA_LLC_signed.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }],
      expected: null,
    },
    {
      filename: 'Bank Statements - Jan 2024.pdf',
      conditions: [{ id: 'a', title: 'Bank Statements' }],
      expected: 'a',
    },
    {
      filename: 'operating_agreement_articles_of_incorporation.pdf',
      conditions: [
        { id: 'short', title: 'Operating Agreement' },
        { id: 'long',  title: 'Articles of Incorporation' },
      ],
      expected: 'long',
    },
    {
      filename: 'random_file_no_match.pdf',
      conditions: [{ id: 'a', title: 'Operating Agreement' }],
      expected: null,
    },
    {
      filename: 'Government-Issued Photo ID.pdf',
      conditions: [{ id: 'a', title: 'Government-Issued Photo ID' }],
      expected: 'a',
    },
  ]
  let failed = 0
  for (const tc of cases) {
    const got = suggestConditionId(tc.filename, tc.conditions)
    if (got !== tc.expected) {
      console.error(`FAIL: ${tc.filename} -> ${got}, expected ${tc.expected}`)
      failed++
    }
  }
  if (failed > 0) { console.error(`${failed} of ${cases.length} cases failed`); process.exit(1) }
  console.log(`OK: ${cases.length} cases passed`)
}
