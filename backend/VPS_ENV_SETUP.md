# VPS Environment Variables Setup Guide

## Complete .env Configuration for VPS

Based on your current setup, here's the complete `.env` file configuration:

```env
# Supabase Configuration
SUPABASE_URL=https://xqcltxlkicqeyhecmdxg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Server Configuration
PORT=3000
NODE_ENV=production

# Backend URL Configuration
# If you have SSL: https://vps.giodelapiedra.dev or https://api.giodelapiedra.dev
# If no SSL yet: http://vps.giodelapiedra.dev:3000
# You can also just use the domain (without http://) and the code will add it automatically
BACKEND_URL=http://vps.giodelapiedra.dev:3000
# OR if you have SSL:
# BACKEND_URL=https://vps.giodelapiedra.dev

# CORS Configuration (Frontend Domains)
ALLOWED_ORIGINS=https://www.giodelapiedra.dev,https://giodelapiedra.dev,https://new-development-physioward.vercel.app,http://localhost:5173,http://localhost:5174

# OpenAI Configuration (for AI Analysis)
OPENAI_API_KEY=your_openai_api_key_here

# Cloudflare R2 Configuration (for profile images and certificates)
R2_ACCOUNT_ID=57ddbaf90bb7ae7fc6ac9da18b835740
R2_ACCESS_KEY_ID=afa729556f201fcb13eea1544536e4d6
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key_here
R2_BUCKET_NAME=physioward
R2_PUBLIC_URL=https://pub-05d1c2b6e97644ab85a5b81bb4be6a83.r2.dev

# Optional: Force HTTPS (set to 'true' if you have SSL)
# USE_HTTPS=true
```

## Important Notes

### 1. BACKEND_URL Configuration

The `BACKEND_URL` is used for generating absolute URLs in certificates and images. You have three options:

**Option A: Full URL with protocol (Recommended)**
```env
BACKEND_URL=http://vps.giodelapiedra.dev:3000
# OR with SSL:
BACKEND_URL=https://vps.giodelapiedra.dev
```

**Option B: Domain only (Code will auto-add http://)**
```env
BACKEND_URL=vps.giodelapiedra.dev:3000
```

**Option C: If using Nginx reverse proxy (port 80/443)**
```env
BACKEND_URL=http://vps.giodelapiedra.dev
# OR with SSL:
BACKEND_URL=https://vps.giodelapiedra.dev
```

### 2. CORS Configuration

Make sure `ALLOWED_ORIGINS` includes all your frontend domains:
- Production frontend: `https://www.giodelapiedra.dev`
- Alternative domain: `https://giodelapiedra.dev`
- Vercel preview: `https://new-development-physioward.vercel.app`
- Local development: `http://localhost:5173`, `http://localhost:5174`

### 3. SSL/HTTPS Setup

If you don't have SSL yet:
- Use `http://` in `BACKEND_URL`
- Don't set `USE_HTTPS=true`

If you have SSL:
- Use `https://` in `BACKEND_URL`
- Optionally set `USE_HTTPS=true`

### 4. Frontend Configuration

In your frontend `.env` file, set:
```env
VITE_API_BASE_URL=http://vps.giodelapiedra.dev:3000
# OR with SSL:
VITE_API_BASE_URL=https://vps.giodelapiedra.dev
```

## After Updating .env

1. **Restart the backend:**
   ```bash
   pm2 restart workreadines-backend
   # OR
   pm2 restart all
   ```

2. **Check logs:**
   ```bash
   pm2 logs workreadines-backend
   ```

3. **Verify health:**
   ```bash
   curl http://vps.giodelapiedra.dev:3000/health
   ```

## Troubleshooting

### CORS Errors
- Make sure `ALLOWED_ORIGINS` includes your frontend domain
- Check that the frontend is using the correct `VITE_API_BASE_URL`
- Verify the backend is running and accessible

### Image Loading Issues
- Check that `BACKEND_URL` is set correctly
- Verify R2 credentials are correct
- Check backend logs for R2 errors

### Certificate Generation Issues
- Ensure `BACKEND_URL` has the correct protocol (http:// or https://)
- Verify the URL is accessible from the frontend domain

