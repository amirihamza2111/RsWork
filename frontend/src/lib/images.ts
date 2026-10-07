import { supabase } from './supabase'

const BUCKET = 'menu-images'
const MAX_EDGE = 1600

// Downscales phone photos to ≤1600px and re-encodes as WebP before upload
// (Supabase's on-the-fly image transforms are a paid feature).
async function toWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))), 'image/webp', 0.8)
  )
}

// Stored at <restaurant_id>/<uuid>.webp — Storage RLS lets managers write
// only inside their own restaurant's folder.
export async function uploadMenuImage(file: File, restaurantId: string): Promise<string> {
  if (!file.type.startsWith('image/')) throw { status: 400, message: 'Only image files are allowed' }
  const path = `${restaurantId}/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, await toWebp(file), { contentType: 'image/webp', cacheControl: '31536000' })
  if (error) throw { status: 400, message: `Image upload failed: ${error.message}` }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// Removes an image we stored; external URLs (e.g. seeded photos) are ignored.
export async function deleteMenuImage(url: string) {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const index = url.indexOf(marker)
  if (index === -1) return
  const path = decodeURIComponent(url.slice(index + marker.length).split('?')[0])
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
}
