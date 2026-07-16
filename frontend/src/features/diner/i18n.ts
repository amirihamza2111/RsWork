export type Lang = 'fr' | 'en' | 'ar'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'ع' },
]

export const isRTL = (lang: Lang) => lang === 'ar'

type Trilingual = { fr?: string; en?: string; ar?: string } | string | undefined

// Language-aware menu text with graceful fallback.
export function tri(value: Trilingual, lang: Lang): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[lang] || value.fr || value.en || value.ar || ''
}

const DICT = {
  menu: { fr: 'Menu', en: 'Menu', ar: 'القائمة' },
  all: { fr: 'Tout', en: 'All', ar: 'الكل' },
  table: { fr: 'Table', en: 'Table', ar: 'طاولة' },
  add: { fr: 'Ajouter', en: 'Add', ar: 'أضف' },
  yourOrder: { fr: 'Votre commande', en: 'Your order', ar: 'طلبك' },
  cartEmpty: { fr: 'Votre panier est vide', en: 'Your cart is empty', ar: 'سلتك فارغة' },
  total: { fr: 'Total', en: 'Total', ar: 'المجموع' },
  placeOrder: { fr: 'Commander', en: 'Place order', ar: 'اطلب الآن' },
  emptySection: { fr: 'Aucun plat dans cette catégorie.', en: 'No items in this section.', ar: 'لا توجد أطباق في هذا القسم.' },
  scanPrompt: { fr: 'Scannez le QR de votre table pour commander.', en: "Scan your table's QR code to start ordering.", ar: 'امسح رمز طاولتك لبدء الطلب.' },
  tableNotFound: { fr: "Table introuvable. Veuillez rescanner le QR.", en: 'This table could not be found. Please rescan the QR code.', ar: 'تعذّر العثور على الطاولة. يرجى إعادة المسح.' },
  // Confirmation
  thankYou: { fr: 'Merci !', en: 'Thank you!', ar: 'شكراً !' },
  madeWithLove: { fr: 'Préparé avec amour', en: 'Made with love', ar: 'صُنع بحب' },
  orderPlaced: { fr: 'Votre commande a bien été reçue.', en: 'Your order has been received.', ar: 'تم استلام طلبك.' },
  trackOrder: { fr: 'Suivre ma commande', en: 'Track my order', ar: 'تتبّع طلبي' },
  // Tracking
  orderReceived: { fr: 'Commande reçue', en: 'Order received', ar: 'تم استلام الطلب' },
  confirmed: { fr: 'Confirmée', en: 'Confirmed', ar: 'مؤكَّدة' },
  preparing: { fr: 'En préparation', en: 'Being prepared', ar: 'قيد التحضير' },
  ready: { fr: 'Prête', en: 'Ready', ar: 'جاهزة' },
  served: { fr: 'Servie', en: 'Served', ar: 'تم التقديم' },
  hintReceived: { fr: "En cours d'enregistrement", en: 'Just came in', ar: 'وصلت للتو' },
  hintConfirmed: { fr: 'Envoyée en cuisine', en: 'Sent to the kitchen', ar: 'أُرسلت إلى المطبخ' },
  hintPreparing: { fr: 'La cuisine s\'active', en: 'The kitchen is cooking', ar: 'المطبخ يعمل' },
  hintReady: { fr: 'Un serveur arrive', en: 'A waiter is bringing it over', ar: 'النادل في الطريق' },
  hintServed: { fr: 'Bon appétit !', en: 'Enjoy your meal!', ar: 'بالهناء والشفاء !' },
  yourItems: { fr: 'Vos plats', en: 'Your items', ar: 'أطباقك' },
  autoUpdate: { fr: 'Cette page se met à jour automatiquement.', en: 'This page updates automatically.', ar: 'تُحدَّث هذه الصفحة تلقائياً.' },
  cancelled: { fr: 'Cette commande a été annulée.', en: 'This order was cancelled.', ar: 'تم إلغاء هذا الطلب.' },
  orderMore: { fr: 'Commander plus', en: 'Order more', ar: 'اطلب المزيد' },
  // Payment
  payAtTable: { fr: "Payer à table", en: 'Pay at the table', ar: 'الدفع على الطاولة' },
  choosePayment: { fr: 'Comment souhaitez-vous payer ?', en: 'How would you like to pay?', ar: 'كيف تريد الدفع؟' },
  payCash: { fr: 'Espèces', en: 'Cash', ar: 'نقداً' },
  payCard: { fr: 'Carte', en: 'Card', ar: 'بطاقة' },
  billRequested: { fr: 'Un serveur arrive pour encaisser.', en: 'A staff member is on the way to take payment.', ar: 'النادل قادم لاستلام الدفعة.' },
  requesting: { fr: 'Demande en cours…', en: 'Requesting…', ar: 'جارٍ الطلب…' },
  // Online card payment
  payNow: { fr: 'Payer maintenant', en: 'Pay now', ar: 'ادفع الآن' },
  paymentProcessing: { fr: 'Paiement en cours…', en: 'Processing payment…', ar: 'جارٍ الدفع…' },
  paymentSuccess: { fr: 'Paiement réussi — merci !', en: 'Payment successful — thank you!', ar: 'تم الدفع بنجاح — شكراً !' },
  paymentFailed: { fr: 'Le paiement a échoué. Réessayez ou payez au comptoir.', en: 'Payment failed. Try again or pay with staff.', ar: 'فشل الدفع. حاول مجدداً أو ادفع لدى الموظف.' },
  // Location
  locationNeeded: { fr: 'Activez la localisation pour commander.', en: 'Please enable location to order.', ar: 'يرجى تفعيل الموقع للطلب.' },
} as const

export type TKey = keyof typeof DICT

export function makeT(lang: Lang) {
  return (key: TKey) => DICT[key][lang]
}
