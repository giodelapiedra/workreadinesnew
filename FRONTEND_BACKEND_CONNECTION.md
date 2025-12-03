# 🔗 Frontend-Backend Connection Setup

## ✅ Step 1: Frontend .env Updated

Already updated `frontend/.env`:
```
VITE_API_BASE_URL=https://vps.giodelapiedra.dev
```

---

## ⚙️ Step 2: Update Backend CORS (IMPORTANT!)

**Sa VPS, edit mo yung backend .env:**

```bash
nano /root/apps/workreadines-backend/.env
```

**Add mo yung `ALLOWED_ORIGINS` variable:**

```env
# Add this line (replace with your actual frontend domain)
ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:5173,http://localhost:5174

# Or kung local development lang muna:
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:3000
```

**Examples:**
- **Kung Vercel frontend:** `ALLOWED_ORIGINS=https://your-app.vercel.app,https://your-app-git-main.vercel.app`
- **Kung local dev:** `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174`
- **Kung may production domain:** `ALLOWED_ORIGINS=https://workreadines.com,https://www.workreadines.com`

**Save:** `Ctrl+X`, `Y`, `Enter`

**Restart backend:**
```bash
pm2 restart workreadines-backend
pm2 logs workreadines-backend --lines 20
```

---

## 🧪 Step 3: Test Connection

### From Frontend (Browser Console):

```javascript
// Test API connection
fetch('https://vps.giodelapiedra.dev/health')
  .then(res => res.json())
  .then(data => console.log('✅ Backend connected:', data))
  .catch(err => console.error('❌ Error:', err))
```

### From Terminal:

```bash
# Test health endpoint
curl https://vps.giodelapiedra.dev/health

# Test API endpoint
curl https://vps.giodelapiedra.dev/api
```

---

## 🔍 Step 4: Verify Backend is Accessible

**Check if backend responds:**

```bash
# From VPS
curl http://localhost:3000/health

# From your local PC (should work)
curl https://vps.giodelapiedra.dev/health
```

**Expected response:**
```json
{"status":"ok","message":"Server is running"}
```

---

## 🐛 Troubleshooting

### CORS Error in Browser

**Error:** `Access to fetch at 'https://vps.giodelapiedra.dev/api' from origin 'http://localhost:5173' has been blocked by CORS policy`

**Fix:**
1. Check backend `.env` has `ALLOWED_ORIGINS` with your frontend URL
2. Restart backend: `pm2 restart workreadines-backend`
3. Check backend logs: `pm2 logs workreadines-backend`

### 404 Not Found

**Check:**
1. Backend is running: `pm2 status`
2. Nginx is proxying correctly: `nginx -t`
3. Test direct backend: `curl http://localhost:3000/health`

### SSL Certificate Error

**If using HTTPS:**
- Make sure SSL certificate is valid: `certbot certificates`
- Check nginx SSL config: `cat /etc/nginx/sites-available/workreadines-backend | grep ssl`

---

## 📝 Quick Checklist

- [ ] Frontend `.env` updated with `VITE_API_BASE_URL=https://vps.giodelapiedra.dev`
- [ ] Backend `.env` has `ALLOWED_ORIGINS` with frontend domain
- [ ] Backend restarted: `pm2 restart workreadines-backend`
- [ ] Nginx config correct and reloaded
- [ ] Test `curl https://vps.giodelapiedra.dev/health` works
- [ ] Frontend can connect (check browser console)

---

## 🚀 Next Steps

1. **Update backend CORS** (add your frontend domain)
2. **Restart backend** on VPS
3. **Test from frontend** (open browser console)
4. **Check for errors** in browser console and backend logs

---

## 💡 Tips

- **Development:** Use `http://localhost:5173` in `ALLOWED_ORIGINS`
- **Production:** Use your actual frontend domain (e.g., `https://workreadines.com`)
- **Multiple domains:** Separate with commas: `domain1.com,domain2.com`
- **Always restart backend** after changing `.env` file


