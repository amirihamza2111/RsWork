// PDFKit 0.20 browser build (no bundled typings; @types/pdfkit targets the
// older Node API). Only the surface used by src/lib/pdf is declared.
declare module 'pdfkit' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PDFDocument: new (options?: Record<string, unknown>) => any
  export function registerStdFonts(...fonts: unknown[]): void
}

declare module 'pdfkit/standard-fonts/*' {
  const font: unknown
  export default font
}
