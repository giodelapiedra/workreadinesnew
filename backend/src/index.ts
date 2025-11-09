import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { securityHeaders, requestSizeLimit, rateLimiter } from './middleware/security'
import auth from './routes/auth'
import teams from './routes/teams'
import checkins from './routes/checkins'
import supervisor from './routes/supervisor'
import schedules from './routes/schedules'
import whs from './routes/whs'
import clinician from './routes/clinician'
import worker from './routes/worker'
import admin from './routes/admin'

const app = new Hono()

// Security middleware - apply to all routes
app.use('*', securityHeaders)
app.use('*', requestSizeLimit)
app.use('*', rateLimiter)

// Enable CORS for frontend
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS?.split(',') || [])
  : ['http://localhost:5173', 'http://localhost:5174']

app.use('/*', cors({
  origin: allowedOrigins,
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

