# WebHost Systems Environment Variables

This document lists all environment variables required for WebHost Systems operation across different deployment environments.

## Required Environment Variables

### Core Application

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` | Yes |
| `SECRET_KEY_BASE` | Phoenix secret key base | `your_64_char_secret_here` | Yes |
| `TOKEN_SIGNING_SECRET` | JWT signing secret | `your_64_char_secret_here` | Yes |
| `PHX_HOST` | Phoenix server host | `webhost-prod.fly.dev` | Yes |
| `PORT` | Phoenix server port | `4000` | Yes |

### Database Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `POOL_SIZE` | Database connection pool size | `10` | No (default: 10) |
| `ECTO_IPV6` | Enable IPv6 for database | `true` | No |
| `DNS_CLUSTER_QUERY` | DNS cluster query for distributed systems | `_dns._tcp.webhost.internal` | No |

### Redis Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `REDIS_HOST` | Redis server host | `localhost` | No (default: localhost) |
| `REDIS_PORT` | Redis server port | `6379` | No (default: 6379) |
| `REDIS_URL` | Full Redis connection string | `redis://user:pass@host:6379` | No |

### External API Services

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `HETZNER_API_TOKEN` | Hetzner Cloud API token | `your_hetzner_token` | Yes (for Hetzner) |
| `FLY_API_TOKEN` | Fly.io API token | `your_fly_token` | Yes (for Fly.io) |
| `FLY_ORG_ID` | Fly.io organization ID | `your_org_id` | Yes (for Fly.io) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | `your_cf_token` | Yes (for DNS) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | `your_cf_account_id` | Yes (for DNS) |

### Payment & Billing

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `STRIPE_SECRET_KEY` | Stripe secret key | `sk_live_your_key` | Yes (production) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | `pk_live_your_key` | Yes (production) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | `whsec_your_secret` | Yes (production) |
| `STRIPE_SECRET_KEY_TEST` | Test Stripe secret key | `sk_test_your_key` | Yes (development) |
| `STRIPE_PUBLISHABLE_KEY_TEST` | Test Stripe publishable key | `pk_test_your_key` | Yes (development) |

### Email Service

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `POSTMARK_API_TOKEN` | Postmark API token | `your_postmark_token` | Yes (production) |
| `SMTP_HOST` | SMTP server host | `localhost` | No (development) |
| `SMTP_PORT` | SMTP server port | `1025` | No (development) |
| `SMTP_USERNAME` | SMTP username | `user@example.com` | No |
| `SMTP_PASSWORD` | SMTP password | `your_smtp_password` | No |

### Monitoring & Observability

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `SENTRY_DSN` | Sentry error tracking DSN | `https://your_dsn@sentry.io/project` | No (recommended) |
| `HETZNER_MONITORING_WEBHOOK` | Hetzner monitoring webhook URL | `https://your-webhook.url` | No |
| `FLIO_METRICS_ENABLED` | Enable Fly.io metrics | `true` | No |
| `LOG_LEVEL` | Application log level | `info` | No (default: info) |

### Backup Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `BACKUP_ENABLED` | Enable automated backups | `true` | No (default: false) |
| `BACKUP_SCHEDULE` | Backup cron schedule | `0 2 * * *` | No |
| `BACKUP_RETENTION_DAYS` | Backup retention period | `30` | No (default: 30) |
| `S3_BUCKET` | S3 bucket for offsite backups | `webhost-backups` | No |
| `AWS_ACCESS_KEY_ID` | AWS access key for S3 | `your_access_key` | No |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for S3 | `your_secret_key` | No |
| `AWS_REGION` | AWS region for S3 | `us-east-1` | No |

### Security & Rate Limiting

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `UPSTASH_API_KEY` | Upstash Redis API key | `your_upstash_key` | No |
| `UPSTASH_REST_URL` | Upstash Redis REST URL | `https://your-redis.upstash.io` | No |
| `CORS_ORIGINS` | Allowed CORS origins | `https://yourdomain.com` | No |

### Scaling Configuration (Fly.io)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `AUTOSCALING_ENABLED` | Enable autoscaling | `true` | No |
| `MIN_INSTANCES` | Minimum number of instances | `1` | No |
| `MAX_INSTANCES` | Maximum number of instances | `10` | No |
| `CPU_THRESHOLD` | CPU threshold for scaling | `70` | No |
| `MEMORY_THRESHOLD` | Memory threshold for scaling | `80` | No |
| `PRIMARY_REGION` | Primary region for Fly.io | `us-east` | No |
| `REPLICA_REGIONS` | Replica regions for Fly.io | `fra,sin` | No |

## Environment-Specific Examples

### Local Development (.env.local)

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webhost_dev

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Phoenix
SECRET_KEY_BASE=dev_secret_key_base_minimum_64_characters_long_required_here
TOKEN_SIGNING_SECRET=dev_token_secret_min_64_chars_long_for_jwt_signing_replace_in_prod
PHX_HOST=localhost
PORT=4000

# Email (Development)
SMTP_HOST=localhost
SMTP_PORT=1025

# Stripe (Test)
STRIPE_SECRET_KEY_TEST=sk_test_your_test_key
STRIPE_PUBLISHABLE_KEY_TEST=pk_test_your_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_test_webhook_secret

# Log level
LOG_LEVEL=debug
```

### Hetzner Production (.env.hetzner)

```bash
# Database
DATABASE_URL=postgresql://webhost:password@hetzner-db:5432/webhost_prod
POOL_SIZE=20

# Redis
REDIS_URL=redis://hetzner-redis:6379

# Phoenix
SECRET_KEY_BASE=prod_secret_key_base_minimum_64_characters_long_required_here
TOKEN_SIGNING_SECRET=prod_token_secret_min_64_chars_long_for_jwt_signing_replace_in_prod
PHX_HOST=webhost.systems
PORT=4000

# Hetzner APIs
HETZNER_API_TOKEN=your_hetzner_api_token
HETZNER_SERVER_ID=your_server_id
HETZNER_FIREWALL_ID=your_firewall_id

# External APIs
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id

# Stripe (Production)
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Email
POSTMARK_API_TOKEN=your_postmark_api_token

# Monitoring
SENTRY_DSN=https://your_dsn@sentry.io/project
HETZNER_MONITORING_WEBHOOK=https://your-monitoring.webhook.url

# Backup
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 2 * * *"
BACKUP_RETENTION_DAYS=30
S3_BUCKET=webhost-backups
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1

# Log level
LOG_LEVEL=info
```

### Fly.io Production (.env.flyio)

```bash
# Database (Fly.io Postgres)
DATABASE_URL=postgresql://webhost:password@webhost-db.internal:5432/webhost_prod
POOL_SIZE=10

# Redis (Fly.io Redis)
REDIS_URL=redis://webhost-redis.internal:6379

# Phoenix
SECRET_KEY_BASE=prod_secret_key_base_minimum_64_characters_long_required_here
TOKEN_SIGNING_SECRET=prod_token_secret_min_64_chars_long_for_jwt_signing_replace_in_prod
PHX_HOST=webhost-prod.fly.dev
PORT=8080

# Fly.io Configuration
FLY_APP_NAME=webhost-prod
FLY_REGION=us-east
FLY_API_TOKEN=your_fly_api_token
FLY_ORG_ID=your_fly_org_id

# Multi-region
PRIMARY_REGION=us-east
REPLICA_REGIONS=fra,sin

# External APIs
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id

# Stripe (Production)
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Email
POSTMARK_API_TOKEN=your_postmark_api_token

# Monitoring
SENTRY_DSN=https://your_dsn@sentry.io/project
FLIO_METRICS_ENABLED=true

# Scaling
AUTOSCALING_ENABLED=true
MIN_INSTANCES=1
MAX_INSTANCES=10
CPU_THRESHOLD=70
MEMORY_THRESHOLD=80

# Rate Limiting
UPSTASH_API_KEY=your_upstash_api_key
UPSTASH_REST_URL=https://your-redis.upstash.io

# Backup
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 2 * * *"
BACKUP_RETENTION_DAYS=30

# Log level
LOG_LEVEL=info
```

## GitHub Secrets (CI/CD)

Required secrets for automated deployments:

```bash
# Docker & Registry
DOCKER_USERNAME=your_dockerhub_username
DOCKER_PASSWORD=your_dockerhub_password

# SSH Access (Hetzner)
HETZNER_HOST=your_hetzner_server_ip
HETZNER_SSH_KEY=-----BEGIN OPENSSH PRIVATE KEY-----
your_private_key_content_here
-----END OPENSSH PRIVATE KEY-----

# Application Secrets
SECRET_KEY_BASE=prod_secret_key_base_minimum_64_characters_long_required_here
TOKEN_SIGNING_SECRET=prod_token_secret_min_64_chars_long_for_jwt_signing_replace_in_prod

# Third-party Services
FLY_API_TOKEN=your_fly_api_token
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
POSTMARK_API_TOKEN=your_postmark_api_token
SENTRY_DSN=your_sentry_dsn

# External APIs
HETZNER_API_TOKEN=your_hetzner_api_token
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id

# Backup & Storage
S3_BUCKET=webhost-backups
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
```

## Security Considerations

1. **Never commit secrets to version control**
2. **Use different secrets for each environment**
3. **Rotate secrets regularly**
4. **Use environment-specific secrets management**
5. **Limit access to production secrets**
6. **Audit secret access regularly**

## Secret Generation

Generate secure secrets with:

```bash
# Phoenix secret key base
mix phx.gen.secret 64

# JWT signing secret
openssl rand -base64 64

# Stripe webhook secrets are generated in Stripe dashboard
# API tokens are generated in respective service dashboards
```

## Validation

Validate your environment setup:

```bash
# Check required variables
mix phx.server  # Will fail if required variables are missing

# Test database connection
mix ecto.create

# Test Redis connection
mix run -e "Redix.command(:redix, [\"PING\"])"

# Verify external API tokens
curl -H "Authorization: Bearer $HETZNER_API_TOKEN" https://api.hetzner.cloud/v1/servers