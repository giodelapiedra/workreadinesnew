/**
 * Caching Utility
 * Provides in-memory caching with TTL support
 * Can be easily extended to use Redis in the future
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map()
  public defaultTTL: number = 5 * 60 * 1000 // 5 minutes default

  /**
   * Get value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return null
    }

    const now = Date.now()
    const age = now - entry.timestamp

    // Check if entry has expired
    if (age > entry.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  /**
   * Set value in cache
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const cacheTTL = ttl || this.defaultTTL
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: cacheTTL,
    })
  }

  /**
   * Delete specific key from cache
   */
  delete(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Clear expired entries (useful for cleanup)
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp
      if (age > entry.ttl) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now()
    let expired = 0
    let active = 0

    for (const entry of this.cache.values()) {
      const age = now - entry.timestamp
      if (age > entry.ttl) {
        expired++
      } else {
        active++
      }
    }

    return {
      total: this.cache.size,
      active,
      expired,
    }
  }

  /**
   * Generate cache key from parameters
   */
  static generateKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|')
    return `${prefix}:${sortedParams}`
  }

  /**
   * Delete all cache entries matching a prefix pattern
   * Useful for invalidating related cache entries
   */
  deleteByPrefix(prefix: string): number {
    let deleted = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix + ':')) {
        this.cache.delete(key)
        deleted++
      }
    }
    return deleted
  }

  /**
   * Delete cache entries for a specific user (by userId)
   * Useful when user-specific data changes
   */
  deleteByUserId(userId: string, prefixes?: string[]): number {
    let deleted = 0
    const prefixesToCheck = prefixes || ['analytics', 'supervisor-analytics']
    
    for (const prefix of prefixesToCheck) {
      for (const key of this.cache.keys()) {
        if (key.includes(`userId:${userId}`) && key.startsWith(prefix + ':')) {
          this.cache.delete(key)
          deleted++
        }
      }
    }
    return deleted
  }

  /**
   * Delete cache entries for a specific team (by teamId)
   * Useful when team data changes
   */
  deleteByTeamId(teamId: string): number {
    let deleted = 0
    // This would require storing teamId in cache keys
    // For now, we'll delete all analytics for team leaders
    for (const key of this.cache.keys()) {
      if (key.startsWith('analytics:') || key.startsWith('supervisor-analytics:')) {
        this.cache.delete(key)
        deleted++
      }
    }
    return deleted
  }
}

// Singleton instance
export const cache = new CacheManager()

// Cleanup expired entries every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    cache.cleanup()
  }, 10 * 60 * 1000)
}

/**
 * Cache decorator for functions
 * Usage: const cachedFunction = withCache(myFunction, { ttl: 60000 })
 */
export function withCache<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options?: { ttl?: number; keyPrefix?: string }
): T {
  const ttl = options?.ttl || cache.defaultTTL
  const prefix = options?.keyPrefix || fn.name || 'cache'

  return (async (...args: any[]) => {
    const cacheKey = CacheManager.generateKey(prefix, { args: JSON.stringify(args) })
    
    // Try to get from cache
    const cached = cache.get(cacheKey)
    if (cached !== null) {
      return cached
    }

    // Execute function
    const result = await fn(...args)
    
    // Store in cache
    cache.set(cacheKey, result, ttl)
    
    return result
  }) as T
}

/**
 * Cache middleware for Hono routes
 * Usage: app.get('/route', cacheMiddleware({ ttl: 300000 }), handler)
 */
export function cacheMiddleware(options?: { ttl?: number; keyPrefix?: string }) {
  return async (c: any, next: () => Promise<void>) => {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
      return next()
    }

    const ttl = options?.ttl || 5 * 60 * 1000 // 5 minutes default
    const prefix = options?.keyPrefix || c.req.path

    // Generate cache key from URL and query params
    const url = new URL(c.req.url)
    const params: Record<string, any> = {}
    url.searchParams.forEach((value, key) => {
      params[key] = value
    })

    const cacheKey = CacheManager.generateKey(prefix, params)
    
    // Try to get from cache
    const cached = cache.get(cacheKey)
    if (cached !== null) {
      return c.json(cached, 200, {
        'X-Cache': 'HIT',
        'Cache-Control': `public, max-age=${Math.floor(ttl / 1000)}`,
      })
    }

    // Execute handler
    await next()

    // Store response in cache if status is 200
    if (c.res.status === 200) {
      const responseData = await c.res.clone().json().catch(() => null)
      if (responseData) {
        cache.set(cacheKey, responseData, ttl)
      }
    }
  }
}

