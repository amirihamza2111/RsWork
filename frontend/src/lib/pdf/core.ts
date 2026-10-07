// PDFKit's browser build, loaded on demand (only when a PDF is downloaded).
// Loosely typed: @types/pdfkit predates the 0.20 browser API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfDoc = any

export async function createPdf(options: Record<string, unknown>): Promise<{ doc: PdfDoc; done: Promise<Blob> }> {
  const [{ PDFDocument, registerStdFonts }, helvetica, bold, oblique] = await Promise.all([
    import('pdfkit'),
    import('pdfkit/standard-fonts/Helvetica'),
    import('pdfkit/standard-fonts/HelveticaBold'),
    import('pdfkit/standard-fonts/HelveticaOblique'),
  ])
  registerStdFonts(helvetica.default, bold.default, oblique.default)
  const doc = new PDFDocument(options)
  const chunks: Uint8Array[] = []
  doc.on('data', (chunk: Uint8Array) => chunks.push(chunk))
  const done = new Promise<Blob>((resolve) => {
    doc.on('end', () => resolve(new Blob(chunks as BlobPart[], { type: 'application/pdf' })))
  })
  return { doc, done }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
