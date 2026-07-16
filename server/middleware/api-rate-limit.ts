import { createRateLimiter } from '../utils/rateLimit'

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const SKIP_METHODS = new Set(['OPTIONS'])
const STRIPE_WEBHOOK_PATH = '/api/auth/stripe/webhook'
const RESEND_WEBHOOK_PATH = '/api/webhooks/resend'

// Baseline global API limits (per IP)
const globalReadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 300,
  message: 'Too many API requests. Please try again shortly.',
})

const globalWriteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 80,
  message: 'Too many write requests. Please try again shortly.',
})

// Auth endpoints get their own buckets to reduce brute-force risk without
// starving the rest of the API traffic from the same IP.
const authReadLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 600,
  message: 'Too many auth requests. Please try again shortly.',
})

const authWriteLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 40,
  message: 'Too many sign-in attempts. Please wait before trying again.',
})

export default defineEventHandler(async (event) => {
  // Skip all rate limiting in development and CI for E2E test stability
  if (process.env.NODE_ENV !== 'production' || process.env.CI || process.env.GITHUB_ACTIONS) return

  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  // Provider webhooks have verified signatures and retry from shared provider
  // IPs, so putting them in the user-facing IP bucket can drop valid events.
  if (path === STRIPE_WEBHOOK_PATH || path === RESEND_WEBHOOK_PATH) return

  const method = event.method.toUpperCase()
  if (SKIP_METHODS.has(method)) return

  if (path.startsWith('/api/auth/')) {
    if (SAFE_METHODS.has(method)) {
      await authReadLimiter(event)
      return
    }

    await authWriteLimiter(event)
    return
  }

  if (SAFE_METHODS.has(method)) {
    await globalReadLimiter(event)
    return
  }

  await globalWriteLimiter(event)
})
