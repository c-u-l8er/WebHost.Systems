# WebHost Systems Database Schema Design

## Overview

This document outlines the database schema design that supports both multi-tenant and single-tenant deployment modes. The schema uses attribute-based multi-tenancy with `customer_id` as the tenant identifier, which works seamlessly across both deployment modes.

## Design Principles

1. **Unified Schema**: Same database structure works for both deployment modes
2. **Tenant Isolation**: All customer data includes `customer_id` for isolation
3. **Performance Optimization**: Proper indexing for multi-tenant queries
4. **Scalability**: Schema supports growth from hobby to enterprise
5. **TimescaleDB Integration**: Optimized for time-series GPS data
6. **PostGIS Support**: Spatial queries for geofencing and routing

---

## Core Schema Architecture

### Multi-Tenancy Strategy

```elixir
# All customer-facing resources use attribute-based multi-tenancy
multitenancy do
  strategy :attribute
  attribute :customer_id
end

# Query example (works in both modes):
Resource
|> Ash.Query.for_read(:read, tenant: customer_id)
|> Ash.read!()
```

### Deployment Mode Compatibility

| Component | Multi-Tenant Mode | Single-Tenant Mode | Notes |
|-----------|-------------------|-------------------|-------|
| **Database Schema** | Shared schema with `customer_id` | Same schema with `customer_id` | Identical structure |
| **Tables** | Single database instance | Dedicated database per customer | Same table definitions |
| **Indexes** | Include `customer_id` | Include `customer_id` | For consistency |
| **Constraints** | Per-customer constraints | Same constraints | Enforced by Ash policies |
| **Migrations** | Single migration process | Same migration process | Unified deployment |

---

## Complete Database Schema

### 1. Accounts Domain

#### customers Table
```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    email CITEXT NOT NULL UNIQUE,
    company_name VARCHAR(255),
    billing_email CITEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    onboarding_completed BOOLEAN DEFAULT false,
    stripe_customer_id VARCHAR(255),
    settings JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX customers_slug_idx ON customers(slug);
CREATE INDEX customers_email_idx ON customers(email);
CREATE INDEX customers_status_idx ON customers(status);
CREATE INDEX customers_stripe_customer_id_idx ON customers(stripe_customer_id);
```

#### platform_users Table
```sql
CREATE TABLE platform_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'staff',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX platform_users_email_idx ON platform_users(email);
CREATE INDEX platform_users_role_idx ON platform_users(role);
CREATE INDEX platform_users_active_idx ON platform_users(active);
```

#### customer_users Table
```sql
CREATE TABLE customer_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    email CITEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant indexes
CREATE INDEX customer_users_customer_id_idx ON customer_users(customer_id);
CREATE INDEX customer_users_customer_email_idx ON customer_users(customer_id, email);
CREATE UNIQUE INDEX customer_users_unique_customer_email ON customer_users(customer_id, email);
```

#### api_keys Table
```sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    key_prefix VARCHAR(20) NOT NULL,
    key VARCHAR(255) NOT NULL, -- Only accessible during creation
    environment VARCHAR(20) NOT NULL DEFAULT 'production',
    permissions TEXT[] DEFAULT '{}',
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant indexes
CREATE INDEX api_keys_customer_id_idx ON api_keys(customer_id);
CREATE INDEX api_keys_key_hash_idx ON api_keys(key_hash);
CREATE INDEX api_keys_customer_active_idx ON api_keys(customer_id, active);
CREATE INDEX api_keys_environment_idx ON api_keys(environment);
```

#### tokens Table
```sql
CREATE TABLE tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL,
    tenant_id UUID, -- Can reference customer or platform_user
    purpose VARCHAR(100),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    extra_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX tokens_token_id_idx ON tokens(token_id);
CREATE INDEX tokens_type_idx ON tokens(type);
CREATE INDEX tokens_tenant_id_idx ON tokens(tenant_id);
CREATE INDEX tokens_expires_at_idx ON tokens(expires_at);
```

### 2. Billing Domain

#### plans Table
```sql
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    price_monthly INTEGER NOT NULL,
    price_yearly INTEGER,
    max_vehicles INTEGER DEFAULT 10,
    max_drivers INTEGER DEFAULT 10,
    gps_points_per_day INTEGER DEFAULT 100000,
    data_retention_days INTEGER DEFAULT 90,
    geofence_limit INTEGER DEFAULT 50,
    features JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    stripe_price_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX plans_slug_idx ON plans(slug);
CREATE INDEX plans_active_idx ON plans(active);
CREATE INDEX plans_stripe_price_id_idx ON plans(stripe_price_id);
```

#### subscriptions Table
```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN DEFAULT false,
    stripe_subscription_id VARCHAR(255),
    addons JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant indexes
CREATE INDEX subscriptions_customer_id_idx ON subscriptions(customer_id);
CREATE INDEX subscriptions_plan_id_idx ON subscriptions(plan_id);
CREATE INDEX subscriptions_status_idx ON subscriptions(status);
CREATE INDEX subscriptions_stripe_subscription_id_idx ON subscriptions(stripe_subscription_id);
CREATE UNIQUE INDEX subscriptions_unique_customer ON subscriptions(customer_id) WHERE status IN ('active', 'trialing');
```

### 3. Fleet Domain

#### vehicles Table
```sql
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    vehicle_identifier VARCHAR(255) NOT NULL,
    vehicle_type VARCHAR(20) NOT NULL,
    make VARCHAR(100),
    model VARCHAR(100),
    year INTEGER,
    color VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    driver_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant indexes
CREATE INDEX vehicles_customer_id_idx ON vehicles(customer_id);
CREATE INDEX vehicles_customer_status_idx ON vehicles(customer_id, status);
CREATE INDEX vehicles_driver_id_idx ON vehicles(driver_id);
CREATE UNIQUE INDEX vehicles_unique_customer_identifier ON vehicles(customer_id, vehicle_identifier);
CREATE INDEX vehicles_type_idx ON vehicles(vehicle_type);
```

#### drivers Table
```sql
CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email CITEXT,
    phone VARCHAR(50),
    license_number VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant indexes
CREATE INDEX drivers_customer_id_idx ON drivers(customer_id);
CREATE INDEX drivers_customer_status_idx ON drivers(customer_id, status);
CREATE INDEX drivers_email_idx ON drivers(email);
```

### 4. Tracking Domain (TimescaleDB)

#### gps_positions Table (TimescaleDB Hypertable)
```sql
CREATE TABLE gps_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    speed DECIMAL(5, 2),
    heading DECIMAL(5, 2),
    accuracy DECIMAL(5, 2),
    altitude DECIMAL(8, 2),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('gps_positions', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Multi-tenant time-series indexes
CREATE INDEX gps_positions_customer_vehicle_time_idx ON gps_positions (customer_id, vehicle_id, time DESC);
CREATE INDEX gps_positions_customer_time_idx ON gps_positions (customer_id, time DESC);
CREATE INDEX gps_positions_vehicle_time_idx ON gps_positions (vehicle_id, time DESC);

-- Spatial index for PostGIS
ALTER TABLE gps_positions ADD COLUMN location geometry(Point, 4326);
UPDATE gps_positions SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);
CREATE INDEX gps_positions_location_idx ON gps_positions USING GIST(location);

-- TimescaleDB compression policy
SELECT add_compression_policy('gps_positions', INTERVAL '7 days', if_not_exists => TRUE);

-- Retention policy (configurable per plan)
-- For hobby plan: 30 days
-- For starter plan: 90 days  
-- For professional plan: 365 days
-- For business plan: 730 days
```

#### usage_metrics Table
```sql
CREATE TABLE usage_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    metric_type VARCHAR(50) NOT NULL,
    metric_value NUMERIC NOT NULL,
    unit VARCHAR(20),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('usage_metrics', 'timestamp',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Multi-tenant indexes
CREATE INDEX usage_metrics_customer_type_time_idx ON usage_metrics (customer_id, metric_type, timestamp DESC);
CREATE INDEX usage_metrics_customer_time_idx ON usage_metrics (customer_id, timestamp DESC);
```

### 5. Spatial Domain (PostGIS)

#### geofences Table
```sql
CREATE TABLE geofences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    fence_type VARCHAR(20) NOT NULL,
    center_lat DECIMAL(10, 8),
    center_lng DECIMAL(11, 8),
    radius_meters INTEGER,
    geometry JSONB,
    center geometry(Point, 4326),
    active BOOLEAN DEFAULT true,
    alert_on_enter BOOLEAN DEFAULT true,
    alert_on_exit BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant spatial indexes
CREATE INDEX geofences_customer_id_idx ON geofences(customer_id);
CREATE INDEX geofences_customer_active_idx ON geofences(customer_id, active);
CREATE INDEX geofences_center_idx ON geofences USING GIST(center);

-- Update center column from lat/lng
UPDATE geofences 
SET center = ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)
WHERE center_lat IS NOT NULL AND center_lng IS NOT NULL;

-- Create function for geofence checking
CREATE OR REPLACE FUNCTION check_geofence(
    lat DECIMAL,
    lng DECIMAL,
    fence_center geometry,
    radius_m INTEGER
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN ST_DWithin(
        fence_center::geography,
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        radius_m
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

#### routes Table
```sql
CREATE TABLE routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    route_geometry geometry(LineString, 4326),
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    distance_meters NUMERIC,
    duration_seconds INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant spatial indexes
CREATE INDEX routes_customer_id_idx ON routes(customer_id);
CREATE INDEX routes_vehicle_id_idx ON routes(vehicle_id);
CREATE INDEX routes_geometry_idx ON routes USING GIST(route_geometry);
CREATE INDEX routes_start_time_idx ON routes(start_time);
```

### 6. Infrastructure Domain

#### deployments Table
```sql
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    infrastructure_type VARCHAR(20) NOT NULL, -- 'hetzner' or 'flyio'
    deployment_mode VARCHAR(20) NOT NULL, -- 'multi_tenant' or 'single_tenant'
    status VARCHAR(20) NOT NULL DEFAULT 'provisioning',
    
    -- Hetzner fields
    hetzner_server_id INTEGER,
    server_ip_address INET,
    
    -- Fly.io fields
    fly_app_name VARCHAR(255),
    fly_app_id VARCHAR(255),
    fly_regions TEXT[],
    
    -- Database fields
    database_id VARCHAR(255),
    database_url TEXT, -- Encrypted
    database_size_gb INTEGER,
    
    -- Redis fields
    redis_id VARCHAR(255),
    redis_url TEXT, -- Encrypted
    
    -- API endpoints
    api_url VARCHAR(255),
    sync_url VARCHAR(255),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    provisioned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Multi-tenant indexes
CREATE INDEX deployments_customer_id_idx ON deployments(customer_id);
CREATE INDEX deployments_infrastructure_type_idx ON deployments(infrastructure_type);
CREATE INDEX deployments_deployment_mode_idx ON deployments(deployment_mode);
CREATE INDEX deployments_status_idx ON deployments(status);
CREATE UNIQUE INDEX deployments_unique_customer ON deployments(customer_id) WHERE status = 'active';
```

#### infrastructure_events Table
```sql
CREATE TABLE infrastructure_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB NOT NULL,
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX infrastructure_events_customer_id_idx ON infrastructure_events(customer_id);
CREATE INDEX infrastructure_events_deployment_id_idx ON infrastructure_events(deployment_id);
CREATE INDEX infrastructure_events_type_idx ON infrastructure_events(event_type);
CREATE INDEX infrastructure_events_timestamp_idx ON infrastructure_events(timestamp DESC);
```

---

## Ash Resource Definitions

### Example Resource with Multi-Tenancy

```elixir
defmodule WebHost.Fleet.Vehicle do
  use Ash.Resource,
    domain: WebHost.Fleet,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource]

  postgres do
    table "vehicles"
    repo WebHost.Repo

    custom_indexes do
      index [:customer_id, :status]
      index [:customer_id, :vehicle_identifier], unique: true
      index [:driver_id]
    end
  end

  # Multi-tenancy configuration
  multitenancy do
    strategy :attribute
    attribute :customer_id
  end

  attributes do
    uuid_primary_key :id

    attribute :customer_id, :uuid do
      allow_nil? false
      public? true
    end

    attribute :name, :string do
      allow_nil? false
      public? true
    end

    attribute :vehicle_identifier, :string do
      allow_nil? false
      public? true
    end

    attribute :vehicle_type, :atom do
      allow_nil? false
      constraints one_of: [:car, :truck, :van, :motorcycle, :other]
      public? true
    end

    attribute :status, :atom do
      allow_nil? false
      default :active
      constraints one_of: [:active, :maintenance, :inactive]
      public? true
    end

    attribute :metadata, :map, default: %{}, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
      attribute_writable? true
    end

    belongs_to :driver, WebHost.Fleet.Driver

    has_many :gps_positions, WebHost.Tracking.GpsPosition
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:customer_id, :name, :vehicle_identifier, :vehicle_type, 
              :make, :model, :year, :color, :metadata]
      
      validate present([:name, :vehicle_identifier, :vehicle_type])
    end

    read :active do
      filter expr(status == :active)
    end
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via(:customer)
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if relates_to_actor_via(:customer)
    end
  end
end
```

---

## Deployment Mode Specific Considerations

### Multi-Tenant Mode Optimizations

#### 1. Resource Limits Enforcement
```sql
-- Function to check customer resource usage
CREATE OR REPLACE FUNCTION check_customer_resource_usage(
    p_customer_id UUID,
    p_resource_type TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    current_usage INTEGER;
    max_limit INTEGER;
BEGIN
    -- Get current usage
    CASE p_resource_type
        WHEN 'vehicles' THEN
            SELECT COUNT(*) INTO current_usage 
            FROM vehicles 
            WHERE customer_id = p_customer_id AND status = 'active';
        WHEN 'gps_points_today' THEN
            SELECT COUNT(*) INTO current_usage
            FROM gps_positions
            WHERE customer_id = p_customer_id 
              AND time >= DATE_TRUNC('day', NOW());
        ELSE
            current_usage := 0;
    END CASE;
    
    -- Get plan limits
    SELECT p.max_vehicles INTO max_limit
    FROM plans p
    JOIN subscriptions s ON s.plan_id = p.id
    WHERE s.customer_id = p_customer_id AND s.status = 'active';
    
    RETURN current_usage <= max_limit;
END;
$$ LANGUAGE plpgsql;
```

#### 2. Performance Monitoring
```sql
-- View for monitoring customer resource usage
CREATE VIEW customer_usage_stats AS
SELECT 
    c.id as customer_id,
    c.name as customer_name,
    p.slug as plan_slug,
    COUNT(DISTINCT v.id) as vehicle_count,
    COUNT(DISTINCT CASE WHEN gp.time >= DATE_TRUNC('day', NOW()) THEN gp.id END) as gps_points_today,
    COUNT(DISTINCT g.id) as geofence_count,
    pg_size_pretty(pg_total_relation_size('gps_positions')) as gps_data_size
FROM customers c
LEFT JOIN subscriptions s ON s.customer_id = c.id AND s.status = 'active'
LEFT JOIN plans p ON p.id = s.plan_id
LEFT JOIN vehicles v ON v.customer_id = c.id AND v.status = 'active'
LEFT JOIN gps_positions gp ON gp.customer_id = c.id
LEFT JOIN geofences g ON g.customer_id = c.id AND g.active = true
GROUP BY c.id, c.name, p.slug;
```

### Single-Tenant Mode Optimizations

#### 1. Dedicated Database Configuration
```elixir
# Configuration for single-tenant deployments
config :webhost, WebHost.Repo,
  pool_size: 10,
  queue_target: 1000,
  ownership_timeout: 60_000,
  # Single-tenant specific settings
  prepare: :named,
  parameters: [
    application_name: "webhost_single_tenant",
    statement_timeout: "30s"
  ]
```

#### 2. Connection Pool Management
```elixir
defmodule WebHost.Repo.SingleTenant do
  use Ecto.Repo,
    otp_app: :webhost,
    adapter: Ecto.Adapters.Postgres

  def init(_type, config) do
    # Single-tenant specific initialization
    {:ok, Keyword.put(config, :pool_size, 5)}
  end
end
```

---

## Migration Strategy

### Unified Migration Approach

```elixir
# priv/repo/migrations/20240101000000_create_initial_schema.exs
defmodule WebHost.Repo.Migrations.CreateInitialSchema do
  use Ecto.Migration

  def up do
    # Create all tables with unified schema
    create table(:customers, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :slug, :string, null: false
      # ... other fields
      timestamps()
    end

    # Create indexes that work for both modes
    create index(:customers, [:slug])
    create index(:customers, [:email])

    # Create multi-tenant resources
    create table(:vehicles, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :customer_id, :binary_id, null: false  # Always present
      # ... other fields
      timestamps()
    end

    # Multi-tenant indexes
    create index(:vehicles, [:customer_id])
    create index(:vehicles, [:customer_id, :status])
    create unique_index(:vehicles, [:customer_id, :vehicle_identifier])

    # TimescaleDB hypertable (works in both modes)
    execute """
    CREATE TABLE gps_positions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL,
        vehicle_id UUID NOT NULL,
        time TIMESTAMP WITH TIME ZONE NOT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    """

    execute """
    SELECT create_hypertable('gps_positions', 'time', if_not_exists => TRUE);
    """

    # Add multi-tenant indexes
    create index(:gps_positions, [:customer_id, :time, :desc])
    create index(:gps_positions, [:vehicle_id, :time, :desc])
  end

  def down do
    # Drop all tables in reverse order
    drop table(:gps_positions)
    drop table(:vehicles)
    drop table(:customers)
  end
end
```

---

## Performance Optimization

### Index Strategy

#### Multi-Tenant Query Patterns
```sql
-- Common query patterns and their indexes
-- 1. Get all vehicles for a customer
CREATE INDEX vehicles_customer_active_idx ON vehicles(customer_id, status) WHERE status = 'active';

-- 2. Get recent GPS positions for customer's vehicles
CREATE INDEX gps_positions_customer_recent_idx ON gps_positions(customer_id, time DESC) 
WHERE time >= NOW() - INTERVAL '7 days';

-- 3. Geofence queries for customer
CREATE INDEX geofences_customer_active_idx ON geofences(customer_id, active) WHERE active = true;
```

#### Partitioning Strategy (for large scale)
```sql
-- Optional partitioning for very large multi-tenant deployments
-- Partition gps_positions by customer_id for better performance
CREATE TABLE gps_positions_partitioned (
    LIKE gps_positions INCLUDING ALL
) PARTITION BY HASH (customer_id);

-- Create partitions (example for 16 partitions)
DO $$
BEGIN
    FOR i IN 0..15 LOOP
        EXECUTE format('CREATE TABLE gps_positions_part_%s PARTITION OF gps_positions_partitioned FOR VALUES WITH (modulus 16, remainder %s)', i, i);
    END LOOP;
END $$;
```

---

## Backup and Recovery

### Multi-Tenant Backup Strategy
```bash
#!/bin/bash
# backup_multi_tenant.sh

# Full database backup
pg_dump --format=custom --no-owner --no-privileges \
    --exclude-table-data=gps_positions \
    webhost_prod > backup_$(date +%Y%m%d).dump

# Separate GPS data backup (compressed)
pg_dump --format=custom --no-owner --no-privileges \
    --table=gps_positions \
    --where="time >= NOW() - INTERVAL '30 days'" \
    webhost_prod | gzip > gps_backup_$(date +%Y%m%d).dump.gz
```

### Single-Tenant Backup Strategy
```bash
#!/bin/bash
# backup_single_tenant.sh

# Each customer gets individual backup
CUSTOMER_ID=$1
BACKUP_DIR="/backups/customers/$CUSTOMER_ID"

mkdir -p $BACKUP_DIR

# Full backup for customer
pg_dump --format=custom --no-owner --no-privileges \
    --filter="customer_id = '$CUSTOMER_ID'" \
    webhost_customer_$CUSTOMER_ID > $BACKUP_DIR/full_$(date +%Y%m%d).dump
```

---

## Security Considerations

### Row-Level Security (Optional Enhancement)
```sql
-- Enable RLS for additional security in multi-tenant mode
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Policy to ensure customers can only access their own data
CREATE POLICY customer_isolation ON vehicles
    FOR ALL TO webhost_app
    USING (customer_id = current_setting('app.current_customer_id')::UUID);
```

### Data Encryption
```elixir
# Encryption for sensitive fields
config :webhost, WebHost.Vault,
  ciphers: [
    default: {
      module: Cloak.Ciphers.AES.GCM,
      tag: "AES.GCM.V1",
      key: Base.decode64!(System.get_env("ENCRYPTION_KEY"))
    }
  ]
```

---

## Monitoring and Metrics

### Key Performance Indicators
```sql
-- Query performance monitoring view
CREATE TABLE query_performance_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID,
    query_type VARCHAR(50),
    execution_time_ms INTEGER,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Function to log query performance
CREATE OR REPLACE FUNCTION log_query_performance(
    p_customer_id UUID,
    p_query_type VARCHAR(50),
    p_execution_time_ms INTEGER
) RETURNS VOID AS $$
BEGIN
    INSERT INTO query_performance_log (customer_id, query_type, execution_time_ms)
    VALUES (p_customer_id, p_query_type, p_execution_time_ms);
END;
$$ LANGUAGE plpgsql;
```

---

## Conclusion

This database schema design provides a unified foundation that supports both multi-tenant and single-tenant deployment modes seamlessly. The key advantages are:

1. **Schema Consistency**: Same structure across all deployment modes
2. **Performance Optimization**: Proper indexing for multi-tenant queries
3. **Scalability**: TimescaleDB and PostGIS integration for growth
4. **Isolation**: Attribute-based multi-tenancy ensures data separation
5. **Flexibility**: Easy migration between deployment modes
6. **Monitoring**: Built-in performance tracking and resource management

The design leverages Ash Framework's multi-tenancy features while maintaining compatibility with both Hetzner (multi-tenant) and Fly.io (single-tenant) infrastructure, ensuring optimal performance and cost efficiency across all customer segments.

---

**Last Updated**: 2024-01-01  
**Author**: WebHost Systems Team  
**Version**: 1.0.0