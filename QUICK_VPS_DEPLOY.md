# 🚀 Quick VPS Deployment Guide - Hostinger Ubuntu

## 📤 Step 1: Upload Backend Files to VPS

### Option A: Using SCP (from your local Windows machine)

```powershell
# Open PowerShell sa workreadines folder
cd C:\Users\GIO\Desktop\workreadines

# Upload backend folder to VPS
scp -r backend/* root@YOUR_VPS_IP:/root/apps/workreadines-backend/

# Or kung may user account:
scp -r backend/* workreadines@YOUR_VPS_IP:/home/workreadines/apps/workreadines-backend/
```

### Option B: Using Git Clone (mas madali)

```bash
# SSH sa VPS
ssh root@YOUR_VPS_IP

# Create directory
mkdir -p /root/apps/workreadines-backend
cd /root/apps/workreadines-backend

# Clone from GitHub
git clone https://github.com/giodelapiedra/workreadinesnew.git .

# Or kung backend lang:
git clone https://github.com/giodelapiedra/workreadinesnew.git temp
mv temp/backend/* .
rm -rf temp
```

---

## 🔧 Step 2: Initial Setup (First Time Only)

```bash
# 1. Update system
apt update && apt upgrade -y

# 2. Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install PM2
npm install -g pm2

# 4. Install Nginx
apt install -y nginx

# 5. Install Git (kung wala pa)
apt install -y git

# 6. Setup PM2 to start on boot
pm2 startup systemd
# Copy and run the command it shows
```

---

## ⚙️ Step 3: Configure Backend

```bash
# Go to backend directory
cd /root/apps/workreadines-backend

# Install dependencies
npm install --production --legacy-peer-deps

# Create .env file
nano .env
```

**Paste mo yung .env content mo:**
```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Server
PORT=3000
NODE_ENV=production

# CORS - Add your frontend domain
ALLOWED_ORIGINS=https://your-domain.com,http://your-domain.com

# R2 Storage
R2_ACCOUNT_ID=your_r2_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=your_r2_public_url

# OpenAI (optional)
OPENAI_API_KEY=your_openai_key
```

**Save:** `Ctrl+X`, then `Y`, then `Enter`

---

## 🏗️ Step 4: Build and Deploy

```bash
# Build TypeScript
npm run build

# Make deploy script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

**Or manually:**
```bash
# Start with PM2
pm2 start ecosystem.config.cjs

# Save PM2 config
pm2 save

# Check status
pm2 status
pm2 logs workreadines-backend
```

---

## 🌐 Step 5: Setup Nginx Reverse Proxy

```bash
# Create Nginx config
nano /etc/nginx/sites-available/workreadines-backend
```

**Paste this config:**
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    # Increase body size for file uploads
    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**Save:** `Ctrl+X`, then `Y`, then `Enter`

```bash
# Enable site
ln -s /etc/nginx/sites-available/workreadines-backend /etc/nginx/sites-enabled/

# Remove default (optional)
rm /etc/nginx/sites-enabled/default

# Test config
nginx -t

# Reload Nginx
systemctl reload nginx
```

---

## ✅ Step 6: Verify Everything Works

```bash
# Check PM2
pm2 status
pm2 logs workreadines-backend

# Test backend locally
curl http://localhost:3000/health

# Test via Nginx
curl http://YOUR_DOMAIN_OR_IP/health
```

---

## 🔄 Step 7: Update Deployment (Future Updates)

```bash
# SSH sa VPS
ssh root@YOUR_VPS_IP

# Go to backend directory
cd /root/apps/workreadines-backend

# Pull latest changes (kung git)
git pull origin master

# Or upload new files via SCP from local:
# scp -r backend/* root@YOUR_VPS_IP:/root/apps/workreadines-backend/

# Rebuild and redeploy
npm install --production --legacy-peer-deps
npm run build
./deploy.sh
```

---

## 📊 Useful Commands

```bash
# PM2 Commands
pm2 status                          # Check status
pm2 logs workreadines-backend       # View logs
pm2 restart workreadines-backend    # Restart
pm2 stop workreadines-backend       # Stop
pm2 monit                           # Monitor resources

# Nginx Commands
nginx -t                            # Test config
systemctl reload nginx              # Reload
systemctl restart nginx             # Restart
systemctl status nginx              # Check status

# View Logs
pm2 logs workreadines-backend --lines 100
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

---

## 🔒 Step 8: Setup SSL (Optional but Recommended)

```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get SSL certificate
certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal test
certbot renew --dry-run
```

---

## 🐛 Troubleshooting

### Backend not starting
```bash
pm2 logs workreadines-backend --err
cat .env  # Check if .env is correct
```

### Nginx 502 Bad Gateway
```bash
pm2 status  # Check if backend is running
curl http://localhost:3000/health  # Test backend
```

### Port already in use
```bash
lsof -i :3000  # Check what's using port 3000
pm2 delete all  # Stop all PM2 processes
```

---

## 📝 Quick Reference

**First Time Setup:**
1. Upload files (SCP or Git)
2. Install Node.js, PM2, Nginx
3. Configure .env
4. Build and deploy
5. Setup Nginx

**Future Updates:**
1. Upload new files
2. `npm install --production`
3. `npm run build`
4. `./deploy.sh`

---

## 🆘 Need Help?

Check logs:
```bash
pm2 logs workreadines-backend
tail -f /var/log/nginx/error.log
```

