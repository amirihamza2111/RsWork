import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Admin dashboard i18n (fr / en / ar). Covers the app chrome — nav, headers,
// dashboard stats, page titles. Deep dialog/error strings fall back to English
// and can be added key-by-key.
export const ADMIN_LANG_KEY = 'rswork_admin_lang'

const resources = {
  en: {
    translation: {
      nav: {
        dashboard: 'Dashboard', menu: 'Menu', tables: 'Tables', staff: 'Staff',
        payments: 'Payments', feedback: 'Feedback', settings: 'Settings',
      },
      layout: { signedInAs: 'Signed in as', signOut: 'Sign out' },
      overview: {
        title: 'Overview',
        welcome: "Welcome back{{name}} — here's how your restaurant is doing today.",
        downloadReport: 'Download AI report',
        revenueToday: 'Revenue today', ordersToday: 'Orders today',
        pendingOrders: 'Pending orders', tablesOccupied: 'Tables occupied',
      },
      menu: { title: 'Menu', subtitle: 'Manage your categories and menu items.' },
      tables: { title: 'Tables', subtitle: 'Manage tables and their QR codes.' },
      staff: { title: 'Staff', subtitle: 'Manage your team accounts and roles.' },
      payments: { title: 'Payments', subtitle: 'Every cash and card transaction for your restaurant.' },
      feedback: { title: 'Feedback', subtitle: 'What your customers are saying.' },
      settings: { title: 'Settings', subtitle: 'Manage your restaurant profile and account.' },
    },
  },
  fr: {
    translation: {
      nav: {
        dashboard: 'Tableau de bord', menu: 'Menu', tables: 'Tables', staff: 'Équipe',
        payments: 'Paiements', feedback: 'Avis', settings: 'Paramètres',
      },
      layout: { signedInAs: 'Connecté en tant que', signOut: 'Déconnexion' },
      overview: {
        title: "Vue d'ensemble",
        welcome: "Bon retour{{name}} — voici l'état de votre restaurant aujourd'hui.",
        downloadReport: 'Télécharger le rapport IA',
        revenueToday: 'Revenus du jour', ordersToday: 'Commandes du jour',
        pendingOrders: 'Commandes en attente', tablesOccupied: 'Tables occupées',
      },
      menu: { title: 'Menu', subtitle: 'Gérez vos catégories et vos plats.' },
      tables: { title: 'Tables', subtitle: 'Gérez les tables et leurs codes QR.' },
      staff: { title: 'Équipe', subtitle: 'Gérez les comptes et rôles de votre équipe.' },
      payments: { title: 'Paiements', subtitle: 'Toutes les transactions espèces et carte de votre restaurant.' },
      feedback: { title: 'Avis', subtitle: 'Ce que vos clients pensent de vous.' },
      settings: { title: 'Paramètres', subtitle: 'Gérez le profil du restaurant et votre compte.' },
    },
  },
  ar: {
    translation: {
      nav: {
        dashboard: 'لوحة التحكم', menu: 'القائمة', tables: 'الطاولات', staff: 'الموظفون',
        payments: 'المدفوعات', feedback: 'التقييمات', settings: 'الإعدادات',
      },
      layout: { signedInAs: 'مسجّل الدخول باسم', signOut: 'تسجيل الخروج' },
      overview: {
        title: 'نظرة عامة',
        welcome: 'مرحباً بعودتك{{name}} — إليك أداء مطعمك اليوم.',
        downloadReport: 'تحميل تقرير الذكاء الاصطناعي',
        revenueToday: 'إيرادات اليوم', ordersToday: 'طلبات اليوم',
        pendingOrders: 'طلبات قيد الانتظار', tablesOccupied: 'الطاولات المشغولة',
      },
      menu: { title: 'القائمة', subtitle: 'إدارة الفئات والأطباق.' },
      tables: { title: 'الطاولات', subtitle: 'إدارة الطاولات ورموز QR الخاصة بها.' },
      staff: { title: 'الموظفون', subtitle: 'إدارة حسابات فريقك وأدوارهم.' },
      payments: { title: 'المدفوعات', subtitle: 'جميع معاملات النقد والبطاقات في مطعمك.' },
      feedback: { title: 'التقييمات', subtitle: 'ما يقوله عملاؤك عنك.' },
      settings: { title: 'الإعدادات', subtitle: 'إدارة ملف المطعم وحسابك.' },
    },
  },
}

void i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem(ADMIN_LANG_KEY) || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export function setAdminLanguage(lang: 'fr' | 'en' | 'ar') {
  localStorage.setItem(ADMIN_LANG_KEY, lang)
  void i18n.changeLanguage(lang)
}

export default i18n
