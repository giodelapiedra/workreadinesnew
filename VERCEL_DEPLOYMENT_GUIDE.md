# Vercel Deployment Guide - Frontend

## Step-by-Step Guide para sa Pag-deploy ng Frontend sa Vercel

### 1. **Prepare Your Repository**

✅ **Dapat naka-commit na ang lahat ng changes:**
```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push origin master
```

### 2. **Deploy sa Vercel**

#### **Option A: Via Vercel Dashboard (Recommended)**

1. **Pumunta sa [Vercel Dashboard](https://vercel.com/dashboard)**
2. **Click "Add New..." → "Project"**
3. **I-import ang GitHub Repository:**
   - Piliin ang repository: `NEW-DEVELOPMENT-PHYSIOWARD`
   - O i-connect ang GitHub account kung hindi pa connected

4. **Configure Project Settings:**
   - **Framework Preset**: `Vite` (auto-detected)
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)

5. **Environment Variables:**
   I-add ang mga environment variables:
   ```
   VITE_API_BASE_URL=https://new-development-physioward.onrender.com
   VITE_SUPABASE_URL=https://xqcltxlkicqeyhecmdxg.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxY2x0eGxraWNxZXloZWNtZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MjUxNTIsImV4cCI6MjA3NzUwMTE1Mn0.NmjioEEG73M3r56TPBMXi7VorV4BSPLkoa5nu7PAXhc
   ```

6. **Click "Deploy"**

#### **Option B: Via Vercel CLI**

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel:**
   ```bash
   vercel login
   ```

3. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

4. **Deploy:**
   ```bash
   vercel
   ```

5. **Follow the prompts:**
   - Set up and deploy? **Yes**
   - Which scope? **Select your account**
   - Link to existing project? **No** (first time)
   - Project name? **workreadines-frontend** (o kahit anong name)
   - Directory? **./** (current directory)
   - Override settings? **No**

6. **Set Environment Variables:**
   ```bash
   vercel env add VITE_API_BASE_URL
   # Enter: https://new-development-physioward.onrender.com
   
   vercel env add VITE_SUPABASE_URL
   # Enter: https://xqcltxlkicqeyhecmdxg.supabase.co
   
   vercel env add VITE_SUPABASE_ANON_KEY
   # Enter: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

7. **Redeploy with environment variables:**
   ```bash
   vercel --prod
   ```

### 3. **After Deployment**

1. **Get Your Frontend URL:**
   - Makikita mo ang URL sa Vercel dashboard
   - Example: `https://workreadines-frontend.vercel.app`

2. **Update Backend CORS:**
   - Pumunta sa Render Dashboard → Backend Service → Environment
   - I-update ang `ALLOWED_ORIGINS`:
     ```
     ALLOWED_ORIGINS=https://your-frontend-app.vercel.app,https://your-frontend-app-git-main-your-team.vercel.app
     ```
   - **Note:** I-add ang both preview at production URLs

3. **Test the Deployment:**
   - Open ang frontend URL
   - Try mag-login
   - Check browser console para sa errors

### 4. **Configuration Files**

✅ **`frontend/vercel.json`** - Already created
- Handles SPA routing (React Router)
- Sets proper cache headers
- Configures build settings

### 5. **Environment Variables sa Vercel**

**Required Environment Variables:**
- `VITE_API_BASE_URL` - Backend API URL
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

**How to Add:**
1. Vercel Dashboard → Project → Settings → Environment Variables
2. I-add ang bawat variable
3. Select environment: **Production, Preview, Development** (o lahat)
4. Click "Save"
5. **Redeploy** para ma-apply ang changes

### 6. **Custom Domain (Optional)**

1. Vercel Dashboard → Project → Settings → Domains
2. I-add ang custom domain
3. Follow ang DNS configuration instructions
4. Update `ALLOWED_ORIGINS` sa backend para isama ang custom domain

### 7. **Auto-Deploy**

✅ **Automatic na ang auto-deploy kapag:**
- May bagong push sa `master` branch
- May bagong pull request

**To Configure:**
- Vercel Dashboard → Project → Settings → Git
- I-verify ang connected repository
- I-configure ang production branch (usually `master`)

### 8. **Troubleshooting**

#### **Build Fails:**
- Check build logs sa Vercel dashboard
- Verify na lahat ng dependencies ay naka-install
- Check TypeScript errors

#### **404 Errors on Routes:**
- Verify na ang `vercel.json` ay may `rewrites` configuration
- Check na ang `outputDirectory` ay `dist`

#### **API Connection Errors:**
- Verify environment variables
- Check backend CORS configuration
- Test backend health endpoint

#### **Environment Variables Not Working:**
- Make sure ang variable names ay nagsisimula sa `VITE_`
- Redeploy after adding variables
- Check na ang variables ay naka-set sa correct environment

### 9. **Deployment Checklist**

- [ ] Repository pushed to GitHub
- [ ] `vercel.json` created
- [ ] Environment variables configured
- [ ] Project deployed sa Vercel
- [ ] Frontend URL obtained
- [ ] Backend CORS updated with frontend URL
- [ ] Test login functionality
- [ ] Test all routes
- [ ] Check browser console for errors

### 10. **Quick Commands**

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View deployment logs
vercel logs

# List all deployments
vercel ls

# Remove deployment
vercel remove
```

---

## 📚 Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vite on Vercel](https://vercel.com/guides/deploying-vite-with-vercel)
- [Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

---

## 🎯 Current Configuration Summary

✅ **Frontend Setup:**
- Framework: Vite + React
- Router: React Router (SPA)
- Build Output: `dist/`
- Configuration: `vercel.json` created

✅ **Backend Integration:**
- API URL: `https://new-development-physioward.onrender.com`
- CORS: Configured to allow Vercel domains

✅ **Ready for Deployment:**
- Build scripts configured
- Environment variables documented
- Routing configured for SPA

