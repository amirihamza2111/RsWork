// Row -> API DTO mappers. Rows arrive camelCased from the postgres client; the
// DTOs keep the response shape the frontend already consumes (`_id`, singular
// relation names, populated relations as nested objects).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

const toRestaurant = (r) =>
  r && {
    _id: r.id,
    name: r.name,
    type: r.type,
    address: r.address,
    phone: r.phone,
    logo: r.logo,
    isActive: r.isActive,
    location: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : undefined,
    geofenceRadius: r.geofenceRadius,
    sectionsDay: r.sectionsDay,
    owner: r.ownerId,
    settings: r.settings || {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };

const toUser = (p) =>
  p && {
    _id: p.id,
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    phone: p.phone,
    restaurant: p.restaurantId,
    isActive: p.isActive,
    isVerified: Boolean(p.isVerified),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };

const toCategory = (c) =>
  c && {
    _id: c.id,
    name: c.name,
    restaurant: c.restaurantId,
    image: c.image,
    order: c.sortOrder,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };

const toMenuItem = (m, { category, restaurant } = {}) =>
  m && {
    _id: m.id,
    name: m.name,
    description: m.description,
    price: m.price,
    category: category || m.categoryId,
    restaurant: restaurant || m.restaurantId,
    image: m.image,
    isAvailable: m.isAvailable,
    prepStation: m.prepStation,
    isVegetarian: m.isVegetarian,
    isGlutenFree: m.isGlutenFree,
    allergens: m.allergens || [],
    preparationTime: m.preparationTime,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };

const toTable = (t, { restaurant, assignedWaiter } = {}) =>
  t && {
    _id: t.id,
    number: t.number,
    restaurant: restaurant || t.restaurantId,
    capacity: t.capacity,
    status: t.status,
    assignedWaiter: assignedWaiter || t.assignedWaiterId,
    session: { id: t.sessionId, expiresAt: t.sessionExpiresAt },
    qrCode: t.qrCode,
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };

const toOrderItem = (i, menuItem) => ({
  _id: i.id,
  menuItem: menuItem || i.menuItemId,
  quantity: i.quantity,
  price: i.price,
  options: i.options,
  comment: i.comment,
  status: i.status,
  prepStation: i.prepStation,
});

const toOrder = (o, rel = {}) =>
  o && {
    _id: o.id,
    orderNumber: o.orderNumber,
    restaurant: rel.restaurant || o.restaurantId,
    table: rel.table || o.tableId,
    client: rel.client || o.clientId,
    waiter: rel.waiter || o.waiterId,
    preparedBy: o.preparedById,
    preparedByName: o.preparedByName,
    servedBy: o.servedById,
    items: rel.items || [],
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    totalAmount: o.totalAmount,
    notes: o.notes,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };

const toPayment = (p, { order, includeSecret = false } = {}) => {
  if (!p) return p;
  const dto = {
    _id: p.id,
    order: order || p.orderId,
    restaurant: p.restaurantId,
    amount: p.amount,
    method: p.method,
    status: p.status,
    stripePaymentIntentId: p.stripePaymentIntentId,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  if (includeSecret) dto.stripeClientSecret = p.stripeClientSecret;
  return dto;
};

const toFeedback = (f, { table, order } = {}) =>
  f && {
    _id: f.id,
    restaurant: f.restaurantId,
    table: table || f.tableId,
    order: order || f.orderId,
    rating: f.rating,
    category: f.category,
    comment: f.comment,
    status: f.status,
    reviewedAt: f.reviewedAt,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };

module.exports = {
  isUuid,
  toRestaurant,
  toUser,
  toCategory,
  toMenuItem,
  toTable,
  toOrderItem,
  toOrder,
  toPayment,
  toFeedback,
};
