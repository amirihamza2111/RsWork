// Great-circle distance between two {lat,lng} points, in metres (haversine).
const distanceMeters = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// True when `point` is within `radiusMeters` of `center`.
const isWithinRadius = (center, point, radiusMeters) =>
  distanceMeters(center, point) <= radiusMeters;

module.exports = { distanceMeters, isWithinRadius };
