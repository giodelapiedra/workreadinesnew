import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { securityHeaders, requestSizeLimit, rateLimiter } from './middleware/security.js'
import auth from './routes/auth.js'
import teams from './routes/teams.js'
import checkins from './routes/checkins.js'
import supervisor from './routes/supervisor.js'
import schedules from './routes/schedules.js'
import whs from './routes/whs.js'
import clinician from './routes/clinician.js'
import worker from './routes/worker.js'
import admin from './routes/admin.js'
import executive from './routes/executive.js'

const app = new Hono()

// Security middleware - apply to all routes
app.use('*', securityHeaders)
app.use('*', requestSizeLimit)
app.use('*', rateLimiter)

// Enable CORS for frontend
const productionOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || []
const developmentOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000']

// Vercel preview URLs pattern - allow all Vercel preview and production URLs
const vercelPattern = /^https:\/\/.*\.vercel\.app$/

// In production, use configured origins + localhost + Vercel URLs
// In development, use localhost origins
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [...productionOrigins, ...developmentOrigins]
  : developmentOrigins

app.use('/*', cors({
  origin: (origin) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return origin
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return origin
    }
    
    // In production, also allow Vercel URLs (preview and production)
    if (process.env.NODE_ENV === 'production' && vercelPattern.test(origin)) {
      return origin
    }
    
    // Not allowed
    return undefined
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'Expires', 'Accept', 'X-Requested-With'],
  exposeHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400, // 24 hours
}))

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ status: 'ok', message: 'Server is running' })
})

// Auth routes
app.route('/api/auth', auth)

// Teams routes
app.route('/api/teams', teams)

// Check-ins routes
app.route('/api/checkins', checkins)

// Supervisor routes
app.route('/api/supervisor', supervisor)

// Schedules routes
app.route('/api/schedules', schedules)

// WHS routes
app.route('/api/whs', whs)

// Clinician routes
app.route('/api/clinician', clinician)

// Worker routes
app.route('/api/worker', worker)

// Admin routes
app.route('/api/admin', admin)

// Executive routes
app.route('/api/executive', executive)

// Example API route
app.get('/api', (c) => {
  return c.json({ message: 'Hello from Hono backend!' })
})

const port = Number(process.env.PORT) || 3000
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port,
})

