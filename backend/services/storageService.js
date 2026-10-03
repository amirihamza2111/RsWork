const crypto = require('crypto');
const sharp = require('sharp');
const config = require('../config');
const { supabaseAdmin } = require('../config/supabase');

const bucket = config.supabase.storageBucket;
const PUBLIC_PREFIX = `${config.supabase.url}/storage/v1/object/public/${bucket}/`;

// Caps oversized phone photos to 1600px on the long edge and re-encodes as WebP
// (Supabase's on-the-fly image transforms are a paid feature).
const optimize = (buffer) =>
  sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

async function uploadMenuImage(buffer, restaurantId) {
  const body = await optimize(buffer);
  const path = `${restaurantId || 'shared'}/${crypto.randomUUID()}.webp`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, body, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  return supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// Only removes objects we own (URLs inside our bucket); other URLs are ignored.
async function deleteByPublicUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(PUBLIC_PREFIX)) return;
  const path = decodeURIComponent(url.slice(PUBLIC_PREFIX.length).split('?')[0]);
  try {
    await supabaseAdmin.storage.from(bucket).remove([path]);
  } catch {
    // Cleanup failures must never block menu CRUD.
  }
}

module.exports = { uploadMenuImage, deleteByPublicUrl };
