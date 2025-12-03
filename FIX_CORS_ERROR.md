# 🔧 Fix CORS Error - www.giodelapiedra.dev

## ❌ Error:
```
Access to fetch at 'https://vps.giodelapiedra.dev/api/auth/login' 
from origin 'https://www.giodelapiedra.dev' 
has been blocked by CORS policy
```

## ✅ Solution: Update Backend CORS on VPS

### Step 1: SSH to VPS
```bash
ssh root@YOUR_VPS_IP
```

### Step 2: Edit Backend .env
```bash
nano /root/apps/workreadines-backend/.env
```

### Step 3: Add/Update ALLOWED_ORIGINS
**Add this line (or update if exists):**
```env
ALLOWED_ORIGINS=https://www.giodelapiedra.dev,https://giodelapiedra.dev,https://new-development-physioward.vercel.app,http://localhost:5173,http://localhost:5174
```

**Important:**
- Include both `www.giodelapiedra.dev` and `giodelapiedra.dev` (without www)
- Include Vercel domain if still using it
- Include localhost for local development
- Separate with commas, NO spaces after commas

**Save:** `Ctrl+X`, then `Y`, then `Enter`

### Step 4: Restart Backend
```bash
pm2 restart workreadines-backend
pm2 logs workreadines-backend --lines 20
```

### Step 5: Verify CORS is Working
```bash
# Test CORS from your local PC
curl -H "Origin: https://www.giodelapiedra.dev" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://vps.giodelapiedra.dev/api/auth/login -v
```

**Dapat may `Access-Control-Allow-Origin: https://www.giodelapiedra.dev` sa response**

---

## 🔍 Check Current CORS Configuration

**On VPS, check current .env:**
```bash
cat /root/apps/workreadines-backend/.env | grep ALLOWED_ORIGINS
```

**Check if NODE_ENV is production:**
```bash
cat /root/apps/workreadines-backend/.env | grep NODE_ENV
```

**Dapat:**
```env
NODE_ENV=production
```

---

## 🐛 Troubleshooting

### Still Getting CORS Error?

1. **Check backend logs:**
   ```bash
   pm2 logs workreadines-backend --lines 50
   ```

2. **Verify .env was updated:**
   ```bash
   cat /root/apps/workreadines-backend/.env
   ```

3. **Check if backend restarted:**
   ```bash
   pm2 status
   pm2 restart workreadines-backend
   ```

4. **Test backend directly:**
   ```bash
   curl https://vps.giodelapiedra.dev/health
   ```

5. **Clear browser cache** and try again

---

## 📝 Complete .env Example

```env
# Supabase
SUPABASE_URL=https://xqcltxlkicqeyhecmdxg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key_here

# Server
PORT=3000
NODE_ENV=production

# CORS - Add all your frontend domains
ALLOWED_ORIGINS=https://www.giodelapiedra.dev,https://giodelapiedra.dev,https://new-development-physioward.vercel.app,http://localhost:5173,http://localhost:5174

# R2 Storage
R2_ACCOUNT_ID=your_r2_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=your_r2_public_url

# OpenAI
OPENAI_API_KEY=your_openai_key
```

---

## ✅ Quick Fix Commands

**Copy-paste this sa VPS:**
```bash
# Backup current .env
cp /root/apps/workreadines-backend/.env /root/apps/workreadines-backend/.env.backup

# Add ALLOWED_ORIGINS (if not exists) or update it
# Edit manually:
nano /root/apps/workreadines-backend/.env

# After editing, restart
pm2 restart workreadines-backend

# Check logs
pm2 logs workreadines-backend --lines 20
```

---

## 🎯 Important Notes

1. **Backend code automatically allows `*.vercel.app` domains** (line 29-30, 48-50 in index.ts)
2. **But custom domains need to be explicitly added** to `ALLOWED_ORIGINS`
3. **Always restart backend** after changing `.env`
4. **Check both www and non-www** versions of your domain
5. **No trailing slashes** in domain URLs

