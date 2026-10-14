import { useState, type FormEvent } from 'react'
import { Check, Loader2, MessageSquareHeart, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiError } from '@/lib/backend'
import { useSubmitFeedback } from './hooks'
import { useDiner } from './diner-context'
import type { TKey } from './i18n'

// Stored in English so the manager's Feedback page reads the same whatever
// language the diner used; only the labels are translated.
const CATEGORIES: { value: string; label: TKey }[] = [
  { value: 'Overall', label: 'fbOverall' },
  { value: 'Food', label: 'fbFood' },
  { value: 'Service', label: 'fbService' },
  { value: 'Speed', label: 'fbSpeed' },
  { value: 'Ambiance', label: 'fbAmbiance' },
]
const MAX_COMMENT = 500

// Remembered per order so the thank-you survives a reload (best effort: the
// database is the real guard, it accepts one feedback per order).
const sentKey = (orderId: string) => `rswork_feedback_${orderId}`
const wasSent = (orderId: string) => {
  try {
    return localStorage.getItem(sentKey(orderId)) === '1'
  } catch {
    return false
  }
}
const markSent = (orderId: string) => {
  try {
    localStorage.setItem(sentKey(orderId), '1')
  } catch {
    // Storage unavailable (private mode): the in-memory state still works.
  }
}

export function FeedbackCard({ orderId, tableId }: { orderId: string; tableId?: string }) {
  const { t } = useDiner()
  const submit = useSubmitFeedback()
  const [sent, setSent] = useState(() => wasSent(orderId))
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [category, setCategory] = useState('Overall')
  const [comment, setComment] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!rating) return
    try {
      await submit.mutateAsync({ orderId, tableId, rating, category, comment: comment.trim() })
    } catch (err) {
      // 409: this order already has feedback (another tab or device) — same outcome.
      if ((err as ApiError).status !== 409) return
    }
    markSent(orderId)
    setSent(true)
  }

  if (sent) {
    return (
      <section className="mt-4 flex items-center gap-3 rounded-2xl border border-[#F3D9CF] bg-white p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#D6402C]/10">
          <Check className="h-5 w-5 text-[#D6402C]" />
        </span>
        <p className="text-sm font-medium">{t('feedbackThanks')}</p>
      </section>
    )
  }

  const shown = hover || rating
  const error = submit.error as unknown as ApiError | null
  return (
    <form onSubmit={onSubmit} className="mt-4 rounded-2xl border border-[#F3D9CF] bg-white p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <MessageSquareHeart className="h-4 w-4 text-[#D6402C]" /> {t('feedbackTitle')}
      </h2>
      <p className="mb-3 text-sm text-[#8A6A62]">{t('feedbackPrompt')}</p>

      <div className="mb-4 flex justify-center gap-1" role="radiogroup" aria-label={t('feedbackPrompt')} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${t('starLabel')}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            className="rounded-full p-1 transition-transform active:scale-90"
          >
            <Star className={cn('h-8 w-8', n <= shown ? 'fill-[#F2A93B] text-[#F2A93B]' : 'text-[#E4D3CC]')} />
          </button>
        ))}
      </div>

      <p className="mb-2 text-xs text-[#8A6A62]">{t('feedbackAbout')}</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategory(c.value)}
            aria-pressed={category === c.value}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium',
              category === c.value ? 'border-[#D6402C] bg-[#D6402C] text-white' : 'border-[#F3D9CF] text-[#3F1D1B]'
            )}
          >
            {t(c.label)}
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
        maxLength={MAX_COMMENT}
        rows={3}
        placeholder={t('feedbackComment')}
        className="w-full resize-none rounded-xl border border-[#F3D9CF] bg-[#FFF8F5] p-3 text-sm outline-none focus:border-[#D6402C]"
      />
      <div className="mb-3 text-right text-[11px] text-[#B49A93]">
        {comment.length}/{MAX_COMMENT}
      </div>

      {error && error.status !== 409 && (
        <p className="mb-2 text-center text-xs text-[#D6402C]">{error.message || t('feedbackError')}</p>
      )}
      <button
        type="submit"
        disabled={!rating || submit.isPending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#D6402C] font-medium text-white active:scale-[0.99] disabled:opacity-50"
      >
        {submit.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t('feedbackSend')}
      </button>
    </form>
  )
}
