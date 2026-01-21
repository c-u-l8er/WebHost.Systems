# WebHost Systems Troubleshooting Guide

This comprehensive guide helps you diagnose and resolve common issues across development, deployment, and operations.

## 🚨 Quick Diagnosis

### Symptom → Solution Matrix

| Symptom | Likely Cause | First Check | Solution |
|---------|--------------|-------------|----------|
| **App won't start** | Database connection | `mix ecto.ping` | Check DATABASE_URL |
| **API returns 401** | Invalid API key | API key format | Verify key in dashboard |
| **GPS data not saving** | Missing tenant | Ash query context | Add `tenant: customer_id` |
| **Sync not working** | WebSocket issue | Browser console | Check WebSocket URL |
| **Slow queries** | Missing indexes | Query plan | Run migrations |
| **Deployment fails** | Missing secrets | `flyctl secrets list` | Set required env vars |
| **Backup errors** | Storage full | Disk usage | Clean up old backups |

---

## 🛠️ Development Issues

### Database Connection Problems

#### Issue: `mix ecto.create` fails
```
** (DBConnection.ConnectionError) tcp connect (localhost:5432): connection refused
```

**Diagnosis:**
```bash
# Check if PostgreSQL is running
pg_isready -h localhost -p 5432

# Check if database exists
psql -h localhost -p 5432 -U postgres -l

# Verify extensions
psql -h localhost -p 5432 -U postgres -d webhost_dev -c "\dx"
```

**Solutions:**
```bash
# Start PostgreSQL (Ubuntu/Debian)
sudo systemctl start postgresql

# Start PostgreSQL (macOS with Homebrew)
brew services start postgresql

# Create database
createdb -h localhost -p 5432 -U postgres webhost_dev

# Install missing extensions
psql -h localhost -p 5432 -U postgres -d webhost_dev -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
psql -h localhost -p 5432 -U postgres -d webhost_dev -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

#### Issue: TimescaleDB extension not found
```
ERROR: extension "timescaledb" does not exist
```

**Solution:**
```bash
# Install TimescaleDB (Ubuntu)
# See: https://docs.timescale.com/install/latest/linux/

# Install TimescaleDB (macOS)
brew install timescaledb/tap/timescaledb

# Restart PostgreSQL
sudo systemctl restart postgresql

# Enable extension in database
psql -d webhost_dev -c "CREATE EXTENSION timescaledb;"
```

### Ash Framework Issues

#### Issue: Multi-tenancy errors
```
** (Ash.Error.Forbidden) Cannot read resource without tenant
```

**Diagnosis:**
```elixir
# Check if tenant is set in query
Resource
|> Ash.Query.for_read(:read)  # Missing tenant!
|> Ash.read!()
```

**Solution:**
```elixir
# Always include tenant in queries
Resource
|> Ash.Query.for_read(:read, tenant: customer_id)
|> Ash.read!()

# Or use actor for implicit tenant
Resource
|> Ash.Query.for_read(:read, actor: %{customer_id: customer_id})
|> Ash.read!()
```

#### Issue: Policy authorization failures
```
** (Ash.Error.Forbidden) Policy authorization failed
```

**Diagnosis:**
```elixir
# Check actor is set
Ash.Changeset.for_create(:create, attrs, actor: user)

# Check tenant matches actor
# Actor.customer_id should match resource.customer_id
```

**Solution:**
```elixir
# Set both actor and tenant
Ash.Changeset.for_create(:create, attrs, 
  actor: user, 
  tenant: user.customer_id
)

# Or update policy to relate to actor
policies do
  policy action_type(:read) do
    authorize_if relates_to_actor_via(:customer)
  end
end
```

### Compilation Issues

#### Issue: Module not found
```
** (CompileError) cannot compile file (undefined module WebHost.Accounts.Customer)
```

**Diagnosis:**
```bash
# Check if file exists
find lib -name "*.ex" | grep customer

# Check module name in file
head lib/webhost/accounts/customer.ex
```

**Solution:**
```bash
# Ensure correct module definition
defmodule WebHost.Accounts.Customer do
  # ...
end

# Recompile
mix compile
```

#### Issue: Dependency conflicts
```
** (Mix.DependencyMismatchError) Dependencies have diverged
```

**Solution:**
```bash
# Clean and reinstall
mix clean --deps
mix deps.get
mix deps.compile

# Update lockfile if needed
mix deps.update
```

---

## 🌐 Frontend Issues

### Phoenix LiveView Problems

#### Issue: LiveView doesn't connect
```
[info] CONNECTED TO Phoenix.LiveView.Socket in 123ms
[error] LiveView crashed
```

**Diagnosis:**
```elixir
# Check browser console for JavaScript errors
# Check network tab for WebSocket connection
# Check Phoenix logs for mount errors
```

**Solution:**
```elixir
# Ensure mount/3 returns {:ok, socket}
def mount(_params, _session, socket) do
  {:ok, socket}
end

# Check for missing assigns in template
<%= @some_assign %>  # Ensure this exists in socket.assigns
```

#### Issue: LiveView form not submitting
```
[error] undefined function &some_function/1
```

**Diagnosis:**
```elixir
# Check handle_event/3 exists
def handle_event("submit", %{"field" => value}, socket) do
  # ...
end
```

**Solution:**
```elixir
# Add missing handle_event
def handle_event("submit", params, socket) do
  # Process form data
  {:noreply, socket}
end
```

### JavaScript SDK Issues

#### Issue: SDK connection fails
```javascript
Error: WebSocket connection failed
```

**Diagnosis:**
```javascript
// Check API key format
const apiKey = "whs_live_...";  // Should start with whs_live_ or whs_test_

// Check API URL
const apiUrl = "https://your-app.fly.dev";  // Should not end with /
```

**Solution:**
```javascript
// Verify configuration
const client = new WebHostClient({
  apiUrl: 'https://your-app.fly.dev',
  apiKey: 'whs_live_your_key_here'
});

// Test connection
try {
  await client.connect({ vehicles: '++id, name' });
  console.log('Connected successfully');
} catch (error) {
  console.error('Connection failed:', error);
}
```

#### Issue: Data not syncing
```javascript
// Data added locally but not syncing to server
```

**Diagnosis:**
```javascript
// Check if WebSocket is connected
console.log(client.syncManager.connected);

// Check for sync errors in console
```

**Solution:**
```javascript
// Ensure WebSocket is connected before adding data
if (client.syncManager.connected) {
  await db.vehicles.add({ name: 'Test Vehicle' });
} else {
  console.error('WebSocket not connected');
}
```

---

## 🚀 Deployment Issues

### Fly.io Deployment Problems

#### Issue: Build fails during deployment
```
ERROR: failed to fetch an image or build from source
```

**Diagnosis:**
```bash
# Check fly.toml configuration
cat fly.toml

# Check Dockerfile exists
ls -la Dockerfile

# Check build logs
fly logs --build
```

**Solution:**
```bash
# Ensure Dockerfile is present and valid
FROM elixir:1.15-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY mix.exs mix.lock ./
RUN mix local.hex --force && mix local.rebar --force
RUN mix deps.get --only prod

# Copy application
COPY . .

# Build release
RUN mix release

# Start application
CMD ["app/bin/webhost", "start"]
```

#### Issue: Application crashes on startup
```
ERROR: failed to start VM
```

**Diagnosis:**
```bash
# Check application logs
fly logs

# Check secrets are set
flyctl secrets list

# Check database connection
flyctl ssh console -C "mix ecto.ping"
```

**Solution:**
```bash
# Set required secrets
flyctl secrets set DATABASE_URL="postgresql://..."
flyctl secrets set SECRET_KEY_BASE="..."
flyctl secrets set TOKEN_SIGNING_SECRET="..."

# Restart application
fly restart
```

#### Issue: Database connection failed
```
** (DBConnection.ConnectionError) tcp connect: connection refused
```

**Diagnosis:**
```bash
# Check database status
flyctl pg status

# Check database URL format
flyctl secrets list | grep DATABASE_URL
```

**Solution:**
```bash
# Attach database
flyctl pg attach

# Or set correct DATABASE_URL
flyctl secrets set DATABASE_URL="postgresql://postgres:password@db.internal:5432/webhost_prod"
```

### Hetzner Deployment Problems

#### Issue: Server not accessible
```
ssh: connect to host xxx.xxx.xxx.xxx port 22: Connection refused
```

**Diagnosis:**
```bash
# Check server status via Hetzner API
curl -H "Authorization: Bearer $HETZNER_API_TOKEN" \
     https://api.hetzner.cloud/v1/servers/$SERVER_ID

# Check firewall rules
curl -H "Authorization: Bearer $HETZNER_API_TOKEN" \
     https://api.hetzner.cloud/v1/firewalls
```

**Solution:**
```bash
# Enable SSH in firewall
# Add rule for port 22 from your IP

# Restart server if needed
curl -X POST \
     -H "Authorization: Bearer $HETZNER_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reboot_type":"soft"}' \
     https://api.hetzner.cloud/v1/servers/$SERVER_ID/actions/reboot
```

#### Issue: Docker containers not starting
```
ERROR: for webhost-app Cannot start service webhost-app
```

**Diagnosis:**
```bash
# Check Docker logs
docker-compose logs webhost-app

# Check container status
docker ps -a

# Check resource usage
docker stats
```

**Solution:**
```bash
# Check docker-compose.yml
version: '3.8'
services:
  webhost-app:
    build: .
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=postgresql://...
      - SECRET_KEY_BASE=...
    depends_on:
      - db

# Restart services
docker-compose down
docker-compose up -d
```

---

## 📊 Performance Issues

### Slow Database Queries

#### Issue: GPS position queries are slow
```
Query took 5.2 seconds
```

**Diagnosis:**
```sql
-- Check query plan
EXPLAIN ANALYZE 
SELECT * FROM gps_positions 
WHERE customer_id = 'uuid' 
  AND time >= NOW() - INTERVAL '24 hours';

-- Check if indexes exist
\d gps_positions;

-- Check table size
SELECT pg_size_pretty(pg_total_relation_size('gps_positions'));
```

**Solution:**
```sql
-- Create missing indexes
CREATE INDEX CONCURRENTLY gps_positions_customer_time_idx 
ON gps_positions (customer_id, time DESC);

-- Ensure hypertable is created
SELECT create_hypertable('gps_positions', 'time', if_not_exists => TRUE);

-- Add compression policy
SELECT add_compression_policy('gps_positions', INTERVAL '7 days');
```

#### Issue: High memory usage
```
Memory usage: 85% of 16GB
```

**Diagnosis:**
```bash
# Check memory usage by process
ps aux --sort=-%mem | head

# Check PostgreSQL memory
SELECT * FROM pg_stat_activity WHERE state = 'active';

# Check Elixir process memory
:observer.start()  # in IEx
```

**Solution:**
```elixir
# Reduce connection pool size
config :webhost, WebHost.Repo,
  pool_size: 5,  # Reduce from default 10
  queue_target: 5000

# Enable query timeouts
config :webhost, WebHost.Repo,
  queue_interval: 1000,
  ownership_timeout: 60_000
```

### API Performance Issues

#### Issue: API response times > 1 second
```
GET /api/vehicles - 1234ms
```

**Diagnosis:**
```elixir
# Add telemetry to track performance
:telemetry.execute([:phoenix, :endpoint, :stop], %{
  duration: System.monotonic_time() - start_time
}, %{route: "/api/vehicles"})
```

**Solution:**
```elixir
# Add database indexes
CREATE INDEX vehicles_customer_idx ON vehicles(customer_id);

# Use database limits
vehicles = Vehicle
|> Ash.Query.for_read(:read, tenant: customer_id)
|> Ash.Query.limit(50)
|> Ash.read!()

# Add caching
def list_vehicles(customer_id) do
  Cachex.fetch(:vehicles_cache, customer_id, fn ->
    Vehicle |> Ash.Query.for_read(:read, tenant: customer_id) |> Ash.read!()
  end)
end
```

---

## 🔒 Security Issues

### API Key Problems

#### Issue: API key authentication failing
```
401 Unauthorized
```

**Diagnosis:**
```elixir
# Check API key format
def validate_api_key(key) do
  case String.split(key, "_") do
    ["whs_live" | _] -> :ok
    ["whs_test" | _] -> :ok
    _ -> :error
  end
end
```

**Solution:**
```elixir
# Generate valid API key
prefix = "whs_live_"
random_part = Base.encode16(:crypto.strong_rand_bytes(32), case: :lower)
api_key = prefix <> random_part

# Store hash, not plaintext
key_hash = :crypto.hash(:sha256, api_key) |> Base.encode16(case: :lower)
```

#### Issue: Rate limiting not working
```
Too many requests from single IP
```

**Diagnosis:**
```elixir
# Check Redis connection
Redix.command(:redix, ["PING"])

# Check rate limit configuration
config :webhost, WebHostWeb.Plugs.RateLimit,
  limits: [
    {"api", {100, 60}},  # 100 requests per minute
    {"upload", {10, 60}}  # 10 uploads per minute
  ]
```

**Solution:**
```elixir
# Add rate limiting plug
plug WebHostWeb.Plugs.RateLimit,
  bucket_name: "api",
  limit: {100, 60}  # 100 requests per minute

# Ensure Redis is configured
config :webhost, Redix,
  name: :redix,
  host: System.get_env("REDIS_HOST", "localhost"),
  port: String.to_integer(System.get_env("REDIS_PORT", "6379"))
```

---

## 📱 Real-time Sync Issues

### WebSocket Connection Problems

#### Issue: WebSocket connection drops
```
WebSocket connection closed: 1006
```

**Diagnosis:**
```javascript
// Check browser console
// Check network tab for WebSocket status
// Check server logs for disconnect reasons
```

**Solution:**
```elixir
# Add heartbeat
defmodule WebHostWeb.UserSocket do
  use Phoenix.Socket

  def connect(_params, socket, connect_info) do
    :timer.send_interval(30_000, :heartbeat)
    {:ok, socket}
  end

  def handle_info(:heartbeat, socket) do
    push(socket, "heartbeat", %{})
    {:noreply, socket}
  end
end
```

#### Issue: Yjs sync conflicts
```
Yjs update conflicts detected
```

**Diagnosis:**
```elixir
# Check sync update order
# Check for concurrent edits
# Verify Yjs document state
```

**Solution:**
```elixir
# Add conflict resolution
def handle_in("sync_update", %{"update" => update, "timestamp" => timestamp}, socket) do
  # Apply updates in order
  case apply_update_in_order(update, timestamp) do
    :ok -> 
      broadcast!(socket, "sync_update", %{update: update, timestamp: timestamp})
    {:error, reason} -> 
      {:reply, {:error, %{message: reason}}, socket}
  end
end
```

---

## 🔍 Monitoring & Debugging

### Log Analysis

#### Issue: Too many log messages
```
Log volume: 1GB/day
```

**Solution:**
```elixir
# Configure log level
config :logger, level: :info  # Change from :debug

# Add structured logging
Logger.info("Vehicle position received", %{
  vehicle_id: vehicle.id,
  customer_id: customer_id,
  timestamp: DateTime.utc_now()
})
```

#### Issue: Missing important logs
```
Cannot find error details
```

**Solution:**
```elixir
# Add debug logging for critical paths
def create_vehicle(attrs) do
  Logger.debug("Creating vehicle", %{attrs: attrs})
  
  case Vehicle.create(attrs) do
    {:ok, vehicle} -> 
      Logger.info("Vehicle created successfully", %{vehicle_id: vehicle.id})
      {:ok, vehicle}
    {:error, changeset} -> 
      Logger.error("Vehicle creation failed", %{errors: changeset.errors})
      {:error, changeset}
  end
end
```

### Health Checks

#### Issue: Health check failing
```
GET /health - 500 Internal Server Error
```

**Diagnosis:**
```elixir
# Check health endpoint implementation
defmodule WebHostWeb.HealthController do
  use WebHostWeb, :controller

  def health(conn, _params) do
    # Check database
    db_status = case Repo.query("SELECT 1") do
      {:ok, _} -> "healthy"
      {:error, _} -> "unhealthy"
    end

    # Check Redis
    redis_status = case Redix.command(:redix, ["PING"]) do
      {:ok, "PONG"} -> "healthy"
      {:error, _} -> "unhealthy"
    end

    json(conn, %{
      status: if(db_status == "healthy" and redis_status == "healthy", do: "healthy", else: "unhealthy"),
      database: db_status,
      redis: redis_status,
      timestamp: DateTime.utc_now()
    })
  end
end
```

---

## 🆘 Emergency Procedures

### Complete System Outage

#### Step 1: Assess Impact
```bash
# Check all services
flyctl status
flyctl pg status
curl https://your-app.fly.dev/health

# Check monitoring dashboard
# Check error rates
# Check user reports
```

#### Step 2: Identify Root Cause
```bash
# Check recent deployments
flyctl deployments

# Check recent changes
git log --oneline -10

# Check infrastructure status
# Hetzner: Check server status
# Fly.io: Check region status
```

#### Step 3: Implement Fix
```bash
# Rollback if needed
flyctl rollback <deployment-id>

# Restart services
flyctl restart

# Scale up if needed
flyctl scale count 3
```

#### Step 4: Verify Recovery
```bash
# Test all endpoints
curl https://your-app.fly.dev/api/health

# Test database connectivity
mix ecto.ping

# Test real-time features
# Connect WebSocket client
```

### Data Corruption

#### Step 1: Stop Writes
```elixir
# Enable maintenance mode
Application.put_env(:webhost, :maintenance_mode, true)

# Stop accepting new data
# Update load balancer to return 503
```

#### Step 2: Assess Damage
```bash
# Check data integrity
mix run priv/repo/scripts/check_data_integrity.exs

# Identify corrupted records
SELECT COUNT(*) FROM gps_positions WHERE latitude IS NULL;
```

#### Step 3: Restore from Backup
```bash
# Restore latest backup
./scripts/restore-from-backup.sh latest

# Verify restored data
mix run priv/repo/scripts/verify_restore.exs
```

#### Step 4: Resume Operations
```elixir
# Disable maintenance mode
Application.put_env(:webhost, :maintenance_mode, false)

# Monitor for issues
# Alert team of recovery
```

---

## 📞 Getting Help

### When to Ask for Help

- **Critical Issues**: System down, data loss, security breach
- **Complex Problems**: Performance issues, architectural decisions
- **Documentation Gaps**: Missing information, unclear procedures

### How to Get Help

1. **Check Documentation First**
   - [DOCUMENTATION-INDEX.md](DOCUMENTATION-INDEX.md)
   - [GETTING-STARTED-DEVELOPERS.md](GETTING-STARTED-DEVELOPERS.md)

2. **Search Existing Issues**
   - GitHub issues
   - Internal knowledge base

3. **Create Detailed Issue Report**
   ```
   ## Issue Description
   Clear description of the problem
   
   ## Steps to Reproduce
   1. Step one
   2. Step two
   3. Step three
   
   ## Expected Behavior
   What should happen
   
   ## Actual Behavior
   What actually happens
   
   ## Environment
   - OS: 
   - Elixir version:
   - Database version:
   - Browser (if applicable):
   
   ## Logs
   Relevant error messages and logs
   
   ## What You've Tried
   List of troubleshooting steps attempted
   ```

### Emergency Contacts

- **System Outage**: Create GitHub issue with "urgent" label
- **Security Issue**: Email security@webhost.systems
- **Data Loss**: Page on-call engineer immediately

---

## 🔧 Prevention Strategies

### Monitoring Setup

```elixir
# Add comprehensive monitoring
:telemetry.execute([:webhost, :request, :success], %{
  count: 1,
  duration: duration
}, %{
  route: route,
  customer_id: customer_id
})

# Set up alerts
# Response time > 500ms
# Error rate > 5%
# Database connections > 80%
# Memory usage > 85%
```

### Regular Maintenance

```bash
# Weekly tasks
- Check log volumes
- Review error rates
- Update dependencies
- Test backup restoration

# Monthly tasks
- Performance review
- Security audit
- Documentation update
- Capacity planning

# Quarterly tasks
- Architecture review
- Disaster recovery drill
- Cost optimization
- Technology assessment
```

---

**Remember**: Most issues have been encountered before. Check the documentation, search for similar problems, and don't hesitate to ask for help when needed!

**Last Updated**: 10/14/2025
**Maintainer**: WebHost Systems Team