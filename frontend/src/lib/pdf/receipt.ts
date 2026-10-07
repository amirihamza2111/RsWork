import { createPdf, downloadBlob } from './core'

type Name = { fr?: string; en?: string; ar?: string } | string

export interface ReceiptOrder {
  _id: string
  orderNumber?: string
  totalAmount: number
  table?: { number?: number } | null
  restaurant?: { name?: string; address?: string; phone?: string; settings?: { currency?: string } }
  items: { quantity: number; price: number; menuItem?: { name?: Name } | null }[]
}

const itemName = (name?: Name) => {
  if (!name) return 'Item'
  if (typeof name === 'string') return name.trim() || 'Item'
  return name.fr || name.en || name.ar || 'Item'
}

const formatAmount = (value: number) => Number(value || 0).toFixed(2)

const formatDateTime = (value: Date) =>
  value.toLocaleString('fr-TN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

// 80mm thermal receipt, the same layout the cashier printed before.
export async function downloadReceiptPdf(order: ReceiptOrder) {
  const items = order.items.map((item) => {
    const quantity = Number(item.quantity || 1)
    const unitPrice = Number(item.price || 0)
    return { name: itemName(item.menuItem?.name), quantity, unitPrice, lineTotal: quantity * unitPrice }
  })
  const currency = order.restaurant?.settings?.currency || 'TND'
  const money = (value: number) => `${formatAmount(value)} ${currency}`
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const totalAmount = Number(order.totalAmount ?? subtotal)
  const ticketNumber = order.orderNumber || order._id.slice(-8).toUpperCase()

  const width = 226.77 // ~80mm in points
  const margin = 14
  const contentWidth = width - margin * 2
  const estimatedLines = items.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.name.length / 22)), 0)
  const height = Math.max(360, 260 + estimatedLines * 14 + items.length * 6)

  const { doc, done } = await createPdf({ size: [width, height], margin })
  const right = width - margin
  let y = margin

  const divider = () => {
    doc.moveTo(margin, y).lineTo(right, y).lineWidth(0.5).strokeColor('#444444').stroke()
    y += 7
  }

  doc.font('Helvetica-Bold').fontSize(13).text(order.restaurant?.name || 'Restaurant', margin, y, { width: contentWidth, align: 'center' })
  y += 16
  doc.font('Helvetica').fontSize(8.5).text(order.restaurant?.address || '', margin, y, { width: contentWidth, align: 'center' })
  y += 11
  doc.text(order.restaurant?.phone || '', margin, y, { width: contentWidth, align: 'center' })
  y += 13
  divider()

  doc.fontSize(8.8).text(`Table: ${order.table?.number ?? '-'}`, margin, y)
  y += 12
  doc.text(`Ticket: ${ticketNumber}`, margin, y)
  y += 12
  doc.text(`Date: ${formatDateTime(new Date())}`, margin, y)
  y += 12
  divider()

  const nameWidth = 96
  const qtyX = margin + nameWidth + 4
  const qtyWidth = 18
  const unitX = qtyX + qtyWidth + 4
  const unitWidth = 34
  const totalX = unitX + unitWidth + 4
  const totalWidth = right - totalX

  doc.font('Helvetica-Bold').fontSize(8.2)
  doc.text('Item', margin, y, { width: nameWidth })
  doc.text('Qty', qtyX, y, { width: qtyWidth, align: 'right' })
  doc.text('PU', unitX, y, { width: unitWidth, align: 'right' })
  doc.text('Total', totalX, y, { width: totalWidth, align: 'right' })
  y += 10
  doc.moveTo(margin, y).lineTo(right, y).lineWidth(0.3).strokeColor('#666666').stroke()
  y += 6

  doc.font('Helvetica').fontSize(8.5)
  for (const item of items) {
    const lineHeight = doc.heightOfString(item.name, { width: nameWidth })
    doc.text(item.name, margin, y, { width: nameWidth })
    doc.text(String(item.quantity), qtyX, y, { width: qtyWidth, align: 'right' })
    doc.text(formatAmount(item.unitPrice), unitX, y, { width: unitWidth, align: 'right' })
    doc.text(formatAmount(item.lineTotal), totalX, y, { width: totalWidth, align: 'right' })
    y += Math.max(10, lineHeight) + 4
  }
  divider()

  doc.font('Helvetica').fontSize(9)
  doc.text('Sous-total', margin, y)
  doc.text(money(subtotal), margin, y, { width: contentWidth, align: 'right' })
  y += 12
  doc.text('Taxe (0%)', margin, y)
  doc.text(money(0), margin, y, { width: contentWidth, align: 'right' })
  y += 13

  doc.rect(margin, y - 3, contentWidth, 17).lineWidth(0.8).strokeColor('#222222').stroke()
  doc.font('Helvetica-Bold').fontSize(11)
  doc.text('TOTAL', margin + 4, y + 2)
  doc.text(money(totalAmount), margin + 4, y + 2, { width: contentWidth - 8, align: 'right' })
  y += 22
  divider()

  doc.font('Helvetica-Bold').fontSize(10).text('Merci pour votre visite', margin, y, { width: contentWidth, align: 'center' })
  y += 12
  doc.font('Helvetica').fontSize(8.5).text('Heureux de vous servir et de vous revoir', margin, y, { width: contentWidth, align: 'center' })

  doc.end()
  downloadBlob(await done, `facture-${String(ticketNumber).replace(/[^a-z0-9-_]/gi, '_')}.pdf`)
}
