// Parses ?page & ?limit into safe skip/limit values (capped to protect the DB),
// and builds the pagination metadata returned alongside a page of results.
const parsePagination = (query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

const meta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

module.exports = { parsePagination, meta };
