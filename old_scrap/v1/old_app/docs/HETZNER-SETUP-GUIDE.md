# Hetzner Setup Guide for WebHost Systems

## Overview

This guide walks you through setting up Hetzner infrastructure for WebHost Systems hobby tier customers. Hetzner provides dedicated servers at unbeatable prices, enabling 97% profit margins on the $15/month hobby tier.

## Why Hetzner for Hobby Tier?

- **Cost Efficiency**: $65/month for AX52 (16 cores, 128GB RAM)
- **Customer Capacity**: 150+ hobby customers per server
- **Profit Margin**: 97% ($0.43 cost per $15 customer)
- **US-based Infrastructure**: Ashburn, Hillsboro, or Phoenix locations
- **Predictable Performance**: No noisy neighbors
- **Simple Architecture**: Easy to manage and monitor

---

## 🚀 Quick Start (15 minutes)

### Prerequisites

- Hetzner account (free to create)
- Domain name (optional, for custom URLs)
- Basic Linux knowledge
- SSH client

### Step 1: Create Hetzner Account

1. Visit [hetzner.com](https://hetzner.com)
2. Click "Register" and create account
3. Verify email address
4. Add payment method (credit card or PayPal)
5. Complete identity verification (required by EU law)

### Step 2: Create SSH Key

```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -C "webhost@yourcompany.com"

# Add to SSH agent
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

# Display public key
cat ~/.ssh/id_ed25519.pub
```

### Step 3: Order Server

1. Log into Hetzner Cloud Console
2. Click "Servers" → "Add Server"
3. Configure:
   - **Location**: Ashburn (ash), Hillsboro (hil), Phoenix (phx) for US customers; Nuremberg (nbg1), Falkenstein (fsn1), or Helsinki (hel1) for EU customers
   - **Server Type**: AX52 (recommended) or CAX21 (budget)
   - **Image**: Ubuntu 22.04
   - **SSH Key**: Add your public key
   - **Name**: webhost-hobby-01
4. Click "Create Server" (takes 2-5 minutes)

### Step 4: Connect to Server

```bash
# Get server IP from Hetzner console
SSH_IP=YOUR_SERVER_IP

# Connect to server
ssh root@$SSH_IP

# Update system
apt update && apt upgrade -y

# Set hostname
hostnamectl set-hostname webhost-hobby-01
echo "127.0.0.1 webhost-hobby-01" >> /etc/hosts
```

---

## 📦 Full Setup (60 minutes)

### Step 1: System Configuration

```bash
# Create non-root user
useradd -m -s /bin/bash webhost
usermod -aG sudo webhost

# Configure firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Configure time zone
timedatectl set-timezone America/New_York

# Configure locale
locale-gen en_US.UTF-8
update-locale LANG=en_US.UTF-8

# Create directories
mkdir -p /opt/webhost
mkdir -p /var/log/webhost
mkdir -p /etc/webhost
```

### Step 2: Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Start Docker service
systemctl enable docker
systemctl start docker

# Add webhost user to docker group
usermod -aG docker webhost

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

### Step 3: Install Monitoring

```bash
# Install Node Exporter (for Prometheus)
wget https://github.com/prometheus/node_exporter/releases/download/v1.6.1/node_exporter-1.6.1.linux-amd64.tar.gz
tar xvfz node_exporter-1.6.1.linux-amd64.tar.gz
mv node_exporter-1.6.1.linux-amd64/node_exporter /usr/local/bin/
rm -rf node_exporter-1.6.1.linux-amd64*

# Create node_exporter service
cat > /etc/systemd/system/node_exporter.service << EOF
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

# Create node_exporter user
useradd --no-create-home --shell /bin/false node_exporter

# Enable and start service
systemctl daemon-reload
systemctl enable node_exporter
systemctl start node_exporter
```

### Step 4: Setup WebHost Application

```bash
# Switch to webhost user
su - webhost

# Clone WebHost repository
cd /opt/webhost
git clone https://github.com/c-u-l8er/WebHost.Systems.git .

# Create environment file
cat > .env << EOF
# Database Configuration
POSTGRES_HOST=postgres
POSTGRES_DB=webhost_hobby
POSTGRES_USER=webhost
POSTGRES_PASSWORD=$(openssl rand -base64 32)

# Redis Configuration
REDIS_HOST=redis

# Application Configuration
SECRET_KEY_BASE=$(mix phx.gen.secret 64)
LIVE_VIEW_SIGNING_SALT=$(mix phx.gen.secret 32)
TOKEN_SIGNING_SECRET=$(mix phx.gen.secret 64)

# Hetzner Configuration
HETZNER_MODE=true
INFRASTRUCTURE_PROVIDER=hetzner
SERVER_REGION=ash

# External APIs
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CLOUDFLARE_API_TOKEN=...

# Monitoring
PROMETHEUS_ENABLED=true
NODE_EXPORTER_URL=http://localhost:9100/metrics
EOF

# Create Docker Compose file
cat > docker-compose.yml << EOF
version: '3.8'

services:
  postgres:
    image: timescale/timescaledb-ha:pg16-latest
    environment:
      POSTGRES_DB: \${POSTGRES_DB}
      POSTGRES_USER: \${POSTGRES_USER}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

  webhost:
    image: webhost/webhost:latest
    env_file: .env
    ports:
      - "4000:4000"
    depends_on:
      - postgres
      - redis
    volumes:
      - ./_build:/app/_build
      - ./priv/static:/app/priv/static
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./docker/nginx/ssl:/etc/nginx/ssl
      - ./priv/static:/var/www/static
    depends_on:
      - webhost
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
EOF

# Create nginx configuration
mkdir -p docker/nginx
cat > docker/nginx/nginx.conf << EOF
events {
    worker_connections 1024;
}

http {
    upstream webhost {
        server webhost:4000;
    }

    server {
        listen 80;
        server_name _;
        return 301 https://\$server_name\$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name _;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location / {
            proxy_pass http://webhost;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        location /socket/websocket {
            proxy_pass http://webhost;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
EOF
```

### Step 5: Initialize Database

```bash
# Create database initialization script
mkdir -p docker/postgres
cat > docker/postgres/init.sql << EOF
-- Create extensions
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Create database
CREATE DATABASE webhost_hobby;

-- Connect to database
\c webhost_hobby;

-- Enable extensions in database
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
EOF

# Start services
docker-compose up -d

# Wait for database to be ready
sleep 30

# Run database migrations
docker-compose exec webhost mix ecto.create
docker-compose exec webhost mix ecto.migrate

# Seed initial data
docker-compose exec webhost mix run priv/repo/seeds.exs
```

### Step 6: Setup SSL Certificate

```bash
# Install Certbot
apt install certbot python3-certbot-nginx -y

# Generate SSL certificate (replace with your domain)
certbot --nginx -d webhost-yourcompany.fly.dev

# Setup auto-renewal
echo "0 12 * * * /usr/bin/certbot renew --quiet" | crontab -
```

### Step 7: Configure Backup

```bash
# Create backup script
cat > /opt/webhost/scripts/backup.sh << EOF
#!/bin/bash

BACKUP_DIR="/var/backups/webhost"
DATE=\$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="\$BACKUP_DIR/webhost_backup_\$DATE.sql"

# Create backup directory
mkdir -p \$BACKUP_DIR

# Backup database
docker-compose exec -T postgres pg_dump -U \$POSTGRES_USER \$POSTGRES_DB > \$BACKUP_FILE

# Compress backup
gzip \$BACKUP_FILE

# Remove old backups (keep 7 days)
find \$BACKUP_DIR -name "*.gz" -mtime +7 -delete

echo "Backup completed: \$BACKUP_FILE.gz"
EOF

chmod +x /opt/webhost/scripts/backup.sh

# Add to crontab (daily at 2 AM)
echo "0 2 * * * /opt/webhost/scripts/backup.sh" | crontab -
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Critical variables to configure in .env:
POSTGRES_PASSWORD=your_secure_password
SECRET_KEY_BASE=your_64_char_secret
TOKEN_SIGNING_SECRET=your_64_char_secret
STRIPE_SECRET_KEY=sk_live_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

### Resource Limits

```bash
# Configure PostgreSQL for 150 customers
cat >> docker/postgres/postgresql.conf << EOF
# Memory settings
shared_buffers = 32GB
effective_cache_size = 96GB
work_mem = 256MB
maintenance_work_mem = 2GB

# Connection settings
max_connections = 200
shared_preload_libraries = 'timescaledb,pg_stat_statements'

# TimescaleDB settings
timescaledb.max_background_workers = 8
EOF
```

### Monitoring Configuration

```bash
# Create Prometheus configuration
mkdir -p /opt/webhost/monitoring
cat > /opt/webhost/monitoring/prometheus.yml << EOF
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'webhost'
    static_configs:
      - targets: ['localhost:4000']
    
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
    
  - job_name: 'postgres'
    static_configs:
      - targets: ['localhost:9187']
    
  - job_name: 'redis'
    static_configs:
      - targets: ['localhost:9121']
EOF
```

---

## 📊 Performance Tuning

### System Optimization

```bash
# Optimize system for database workloads
echo 'vm.swappiness=1' >> /etc/sysctl.conf
echo 'vm.dirty_ratio=15' >> /etc/sysctl.conf
echo 'vm.dirty_background_ratio=5' >> /etc/sysctl.conf
sysctl -p

# Configure file limits
echo 'webhost soft nofile 65536' >> /etc/security/limits.conf
echo 'webhost hard nofile 65536' >> /etc/security/limits.conf
```

### PostgreSQL Optimization

```sql
-- Create TimescaleDB hypertables for GPS data
SELECT create_hypertable('gps_positions', 'time', chunk_time_interval => INTERVAL '1 day');

-- Create compression policy
SELECT add_compression_policy('gps_positions', INTERVAL '7 days');

-- Create retention policy
SELECT add_retention_policy('gps_positions', INTERVAL '30 days');

-- Create spatial indexes
CREATE INDEX idx_gps_positions_location ON gps_positions USING GIST (location);
CREATE INDEX idx_gps_positions_vehicle_time ON gps_positions (vehicle_id, time DESC);
```

### Application Optimization

```elixir
# config/prod.exs optimizations
config :webhost, WebHost.Repo,
  pool_size: 20,
  queue_target: 5000,
  queue_interval: 1000

# Enable connection pooling
config :webhost, :redis,
  pool_size: 10,
  pool_max_overflow: 20

# Optimize Phoenix
config :webhost, WebHostWeb.Endpoint,
  server: true,
  http: [port: 4000, compress: true],
  transport_options: [socket_opts: [:inet6]]
```

---

## 🔒 Security Hardening

### SSH Security

```bash
# Configure SSH
cat > /etc/ssh/sshd_config.d/hetzner.conf << EOF
# Disable root login
PermitRootLogin no

# Use key-based authentication only
PasswordAuthentication no
ChallengeResponseAuthentication no

# Limit SSH access
AllowUsers webhost
Port 22
Protocol 2

# Enable fail2ban
MaxAuthTries 3
EOF

systemctl restart sshd
```

### Firewall Configuration

```bash
# Configure UFW
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Install fail2ban
apt install fail2ban -y
systemctl enable fail2ban
systemctl start fail2ban
```

### Application Security

```elixir
# config/prod.exs security settings
config :webhost, WebHostWeb.Endpoint,
  force_ssl: [rewrite_on: [:x_forwarded_proto]],
  secure_browser_headers: %{
    "content-security-policy" => "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    "x-frame-options" => "DENY",
    "x-content-type-options" => "nosniff",
    "x-xss-protection" => "1; mode=block"
  }
```

---

## 📈 Monitoring Setup

### Health Checks

```bash
# Create health check script
cat > /opt/webhost/scripts/health_check.sh << EOF
#!/bin/bash

# Check if services are running
services=("postgres" "redis" "webhost" "nginx")

for service in "\${services[@]}"; do
    if ! docker-compose ps \$service | grep -q "Up"; then
        echo "ALERT: \$service is not running"
        # Send alert (email, Slack, etc.)
    fi
done

# Check disk space
DISK_USAGE=\$(df / | tail -1 | awk '{print \$5}' | sed 's/%//')
if [ \$DISK_USAGE -gt 80 ]; then
    echo "ALERT: Disk usage is \$DISK_USAGE%"
fi

# Check memory usage
MEM_USAGE=\$(free | grep Mem | awk '{printf "%.0f", \$3/\$2 * 100.0}')
if [ \$MEM_USAGE -gt 90 ]; then
    echo "ALERT: Memory usage is \$MEM_USAGE%"
fi
EOF

chmod +x /opt/webhost/scripts/health_check.sh

# Add to crontab (every 5 minutes)
echo "*/5 * * * * /opt/webhost/scripts/health_check.sh" | crontab -
```

### Metrics Collection

```bash
# Install Postgres exporter
docker run -d \
  --name postgres_exporter \
  -p 9187:9187 \
  -e DATA_SOURCE_NAME="postgresql://webhost:password@postgres:5432/webhost_hobby?sslmode=disable" \
  prometheuscommunity/postgres-exporter

# Install Redis exporter
docker run -d \
  --name redis_exporter \
  -p 9121:9121 \
  -e REDIS_ADDR="redis://redis:6379" \
  oliver006/redis_exporter
```

---

## 🚀 Deployment Guide

### Deploying Updates

```bash
# Deploy new version
cd /opt/webhost
git pull origin main

# Build new image
docker-compose build webhost

# Run database migrations
docker-compose exec webhost mix ecto.migrate

# Restart services
docker-compose up -d

# Verify deployment
curl -f http://localhost:4000/api/health || exit 1
```

### Scaling for More Customers

```bash
# When approaching 150 customers:
# 1. Monitor resource usage
docker stats

# 2. Order second server if needed
# 3. Setup load balancer
# 4. Distribute customers across servers

# Check customer distribution
docker-compose exec webhost mix run "WebHost.Infrastructure.CustomerDistribution.analyze()"
```

---

## 📋 Maintenance

### Daily Tasks

```bash
# Check system health
docker-compose ps
df -h
free -h

# Check backups
ls -la /var/backups/webhost/

# Review logs
docker-compose logs --tail=100
```

### Weekly Tasks

```bash
# Update system packages
apt update && apt upgrade -y

# Update Docker images
docker-compose pull

# Restart services if needed
docker-compose up -d

# Check security updates
needrestart -r a
```

### Monthly Tasks

```bash
# Clean up Docker
docker system prune -f

# Review performance metrics
# Check customer growth
# Plan capacity upgrades
```

---

## 🆘 Troubleshooting

### Common Issues

#### Database Connection Failed
```bash
# Check PostgreSQL status
docker-compose logs postgres

# Check network connectivity
docker-compose exec webhost ping postgres

# Restart PostgreSQL
docker-compose restart postgres
```

#### High Memory Usage
```bash
# Check memory usage
docker stats

# Restart services
docker-compose restart

# Optimize PostgreSQL settings
# See Performance Tuning section
```

#### SSL Certificate Issues
```bash
# Check certificate expiry
openssl x509 -in /etc/nginx/ssl/cert.pem -text -noout

# Renew certificate
certbot renew

# Restart nginx
systemctl restart nginx
```

### Performance Issues

```bash
# Check system load
top
htop
iotop

# Check database performance
docker-compose exec postgres psql -U webhost -d webhost_hobby -c "
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;"

# Check slow queries
docker-compose exec postgres psql -U webhost -d webhost_hobby -c "
SELECT query, mean_time, calls 
FROM pg_stat_statements 
WHERE mean_time > 100 
ORDER BY mean_time DESC;"
```

---

## 📞 Support

### Hetzner Support

- **Email**: support@hetzner.com
- **Response Time**: Usually < 1 hour
- **Phone**: +49 (0) 9831 505-0
- **Documentation**: docs.hetzner.com

### WebHost Systems Support

- **Documentation**: webhost.systems/documentation
- **GitHub Issues**: github.com/c-u-l8er/WebHost.Systems/issues
- **Community**: discord.gg/webhost-systems

### Emergency Contacts

```bash
# Create emergency contact script
cat > /opt/webhost/scripts/emergency.sh << EOF
#!/bin/bash

# Send emergency alert
curl -X POST "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" \
  -H 'Content-type: application/json' \
  --data "{\"text\":\"EMERGENCY: WebHost server \$SSH_IP is down!\"}"

# Send email
echo "WebHost server \$SSH_IP is down!" | mail -s "WebHost Alert" admin@yourcompany.com
EOF

chmod +x /opt/webhost/scripts/emergency.sh
```

---

## 📚 Additional Resources

### Documentation Links

- [Hetzner Cloud Docs](https://docs.hetzner.com/cloud)
- [TimescaleDB Docs](https://docs.timescale.com/)
- [PostGIS Docs](https://postgis.net/docs/)
- [Phoenix Docs](https://hexdocs.pm/phoenix/)
- [Ash Framework Docs](https://ash-hq.org/)

### Performance Benchmarks

```
Expected performance per AX52 server:
- 150 hobby customers
- 7.5M GPS points/day (50K per customer)
- 99.9% uptime
- <100ms API response time
- <50ms database query time
```

### Cost Calculator

```
Monthly costs:
- Server: €65 (~$70)
- Storage Box (BX11 1TB): €3.81 (~$4.15)
- Domain: €10 (~$11)
- Monitoring: €5 (~$5)
- Total: €83.81 (~$90)

Revenue at 150 customers:
- 150 × $15 = $2,250/month
- Cost: $90/month
- Profit: $2,160/month
- Margin: 96%
```

---

## ✅ Setup Checklist

- [ ] Hetzner account created
- [ ] SSH key configured
- [ ] Server ordered and running
- [ ] System updated and secured
- [ ] Docker installed
- [ ] WebHost application deployed
- [ ] Database initialized
- [ ] SSL certificate installed
- [ ] Backup system configured
- [ ] Monitoring setup
- [ ] Performance tuned
- [ ] Security hardened
- [ ] Health checks configured
- [ ] Documentation completed

---

## 🎉 Conclusion

Your Hetzner server is now ready to host WebHost Systems hobby tier customers! With this setup, you can:

- Host 150+ customers on a single server
- Achieve 96% profit margins
- Provide reliable, fast service
- Scale easily as needed
- Monitor everything effectively

**Next steps:**
1. Configure your DNS to point to the server
2. Set up your Stripe account for billing
3. Create your first customer
4. Monitor performance and optimize as needed

Welcome to the profitable world of WebHost Systems! 🚀