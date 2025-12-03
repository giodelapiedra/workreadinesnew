# 🚀 Vercel Frontend Deployment Update

## ✅ Step 1: Update Vercel Environment Variables

**Go to Vercel Dashboard:**
1. Open: https://vercel.com/giodelapiedras-projects/new-development-physioward
2. Click **Settings** → **Environment Variables**
3. Find `VITE_API_BASE_URL` or create it if it doesn't exist

**Update/Add these variables:**

| Variable Name | Value |
|--------------|-------|
| `VITE_API_BASE_URL` | `https://vps.giodelapiedra.dev` |
| `VITE_SUPABASE_URL` | `https://xqcltxlkicqeyhecmdxg.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxY2x0eGxraWNxZXloZWNtZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MjUxNTIsImV4cCI6MjA3NzUwMTE1Mn0.NmjioEEG73M3r56TPBMXi7VorV4BSPLkoa5nu7PAXhc` |

**Important:**
- Set environment to: **Production, Preview, Development** (all environments)
- Click **Save** after each variable

---

## ⚙️ Step 2: Update Backend CORS (Sa VPS)

**SSH sa VPS at update backend .env:**

```bash
nano /root/apps/workreadines-backend/.env
```

**Add/Update `ALLOWED_ORIGINS`:**

```env
# Add your Vercel domain (get it from Vercel dashboard)
ALLOWED_ORIGINS=https://new-development-physioward.vercel.app,https://new-development-physioward-git-main.vercel.app,https://new-development-physioward-git-*.vercel.app,http://localhost:5173,http://localhost:5174
```

**Or kung may custom domain ka sa Vercel:**
```env
ALLOWED_ORIGINS=https://your-custom-domain.com,https://www.your-custom-domain.com,https://*.vercel.app,http://localhost:5173
```

**Save:** `Ctrl+X`, `Y`, `Enter`

**Restart backend:**
```bash
pm2 restart workreadines-backend
pm2 logs workreadines-backend --lines 20
```

---

## 🔄 Step 3: Redeploy Frontend on Vercel

**Option A: Via Vercel Dashboard**
1. Go to: https://vercel.com/giodelapiedras-projects/new-development-physioward
2. Click **Deployments** tab
3. Click **...** (three dots) on latest deployment
4. Click **Redeploy**
5. Wait for deployment to complete

**Option B: Via Git Push (Recommended)**
```bash
# Commit changes
git add frontend/.env
git commit -m "Update API base URL to VPS backend"

# Push to trigger Vercel deployment
git push origin master
```

**Option C: Via Vercel CLI**
```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Login
vercel login

# Deploy
cd frontend
vercel --prod
```

---

## 🧪 Step 4: Test Deployment

### 1. Check Vercel Deployment
- Go to Vercel dashboard
- Check latest deployment status
- Should be **Ready** ✅

### 2. Test Frontend
- Open your Vercel URL: `https://new-development-physioward.vercel.app`
- Open browser console (F12)
- Check for API errors

### 3. Test API Connection
**In browser console:**
```javascript
fetch('https://vps.giodelapiedra.dev/health')
  .then(r => r.json())
  .then(data => console.log('✅ Backend connected:', data))
  .catch(err => console.error('❌ Error:', err))
```

### 4. Test Login/API Calls
- Try logging in
- Check Network tab for API requests
- Should see requests to `https://vps.giodelapiedra.dev/api/*`

---

## 🔍 Step 5: Verify Backend CORS

**Test from Vercel domain:**

```bash
# From your local PC, test CORS
curl -H "Origin: https://new-development-physioward.vercel.app" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://vps.giodelapiedra.dev/health -v
```

**Dapat may `Access-Control-Allow-Origin` header sa response**

---

## 🐛 Troubleshooting

### CORS Error in Browser

**Error:** `Access to fetch at 'https://vps.giodelapiedra.dev/api' from origin 'https://new-development-physioward.vercel.app' has been blocked by CORS policy`

**Fix:**
1. Check backend `.env` has Vercel domain in `ALLOWED_ORIGINS`
2. Restart backend: `pm2 restart workreadines-backend`
3. Check backend logs: `pm2 logs workreadines-backend`

### 404 Not Found

**Check:**
1. Backend is running: `pm2 status` (sa VPS)
2. Nginx is working: `curl https://vps.giodelapiedra.dev/health`
3. Vercel env vars are set correctly

### Environment Variables Not Updating

**Fix:**
1. Redeploy after updating env vars
2. Clear browser cache
3. Check Vercel build logs for errors

---

## 📝 Quick Checklist

- [ ] Vercel environment variables updated (`VITE_API_BASE_URL`)
- [ ] Backend `.env` has Vercel domain in `ALLOWED_ORIGINS`
- [ ] Backend restarted on VPS
- [ ] Frontend redeployed on Vercel
- [ ] Test frontend → backend connection
- [ ] Check browser console for errors
- [ ] Test login/API calls

---

## 🔗 Important URLs

- **Vercel Dashboard:** https://vercel.com/giodelapiedras-projects/new-development-physioward
- **Backend API:** https://vps.giodelapiedra.dev
- **Backend Health:** https://vps.giodelapiedra.dev/health

---

## 💡 Tips

1. **Vercel automatically redeploys** when you push to Git
2. **Environment variables** need to be set in Vercel dashboard (not just in `.env` file)
3. **Backend CORS** must include all Vercel preview URLs (pattern: `*.vercel.app`)
4. **Always test** after deployment to catch issues early

---

## 🚀 Next Steps

1. **Update Vercel env vars** (Step 1)
2. **Update backend CORS** on VPS (Step 2)
3. **Redeploy frontend** (Step 3)
4. **Test everything** (Step 4)


