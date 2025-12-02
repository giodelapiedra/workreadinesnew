/**
 * PM2 Ecosystem Configuration
 * Run: pm2 start ecosystem.config.cjs
 * Or: pm2 start npm --name "backend" -- start
 */

module.exports = {
  apps: [{
    name: 'workreadines-backend',
    script: 'dist/index.js',
    instances: 1, // Start with 1, can increase for load balancing
    exec_mode: 'fork', // Use 'cluster' mode if instances > 1
    watch: false, // Set to true for development, false for production
    max_memory_restart: '500M', // Restart if memory exceeds 500MB
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true, // Add timestamp to logs
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
}

