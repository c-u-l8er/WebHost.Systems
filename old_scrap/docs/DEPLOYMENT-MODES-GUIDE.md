# WebHost Systems Deployment Modes Guide

## Overview

WebHost Systems supports two distinct deployment modes optimized for different customer segments and pricing tiers. This guide details the architectural differences, implementation details, and operational considerations for each mode.

## Deployment Modes Summary

| Mode | Target Plans | Infrastructure | Isolation | Cost per Customer | Performance |
|------|--------------|----------------|-----------|-------------------|-------------|
| **Multi-Tenant** | Hobby ($15/mo) | Shared Hetzner Server | Database-level (customer_id) | $0.59 | Standard |
| **Single-Tenant** | Starter+ ($49-$399/mo) | Dedicated Fly.io Instance | Complete infrastructure | $8-$60 | High |

---

## Multi-Tenant Mode (Hobby Plan)

### Architecture Overview

Multi-tenant mode hosts multiple customers on a single Hetzner dedicated server, with data isolation achieved through database-level partitioning using `customer_id` foreign keys.

### Infrastructure Stack

```
Hetzner AX52 Dedicated Server (€65/month)
├── PostgreSQL 15 + TimescaleDB + PostGIS
├── Redis (shared)
├── WebHost Application (single instance)
├── Nginx (SSL termination)
└── Automated Backups to Storage Box
```

### Database Schema

```elixir
# All customer data includes customer_id for isolation
defmodule WebHost.Fleet.Vehicle do
  multitenancy do
    strategy :attribute
    attribute :customer_id
  end
  
  attributes do
    uuid_primary_key :id
    attribute :customer_id, :uuid  # Foreign key for isolation
    # ... other attributes
  end
end
```

### Resource Allocation

| Resource | Total | Per Customer (avg) | Customer Capacity |
|----------|-------|-------------------|-------------------|
| CPU Cores | 16 | 0.1 cores | 150 customers |
| RAM | 128GB | 850MB | 150 customers |
| Storage | 1TB SSD | 6GB | 150 customers |
| Database Connections | 100 | 0.6 connections | 150 customers |

### Performance Characteristics

| Metric | Value |
|--------|-------|
| API Response Time | <50ms p95 |
| GPS Ingestion Rate | 500/second total |
| Concurrent Users | 50 total |
| Database Queries | 1,000/sec total |
| Data Retention | 30 days |

### Security Model

```elixir
# Ash policies enforce tenant isolation
policies do
  policy action_type(:read) do
    authorize_if relates_to_actor_via(:customer)
  end
  
  policy action_type([:create, :update, :destroy]) do
    authorize_if relates_to_actor_via(:customer)
  end
end
```

### Backup Strategy

```bash
# Daily automated backups
0 2 * * * pg_dump webhost_prod | gzip > /backups/db_$(date +%Y%m%d).sql.gz

# Hourly sync updates backup
0 * * * * tar -czf /backups/sync_$(date +%Y%m%d_%H).tar.gz /var/lib/postgresql/sync_updates/
```

### Monitoring

- Server metrics (CPU, RAM, Disk) via Hetzner API
- Database performance monitoring
- Per-customer usage tracking
- Alert on resource exhaustion (>80% utilization)

---

## Single-Tenant Mode (Starter+ Plans)

### Architecture Overview

Single-tenant mode provisions dedicated Fly.io infrastructure for each customer, providing complete isolation and dedicated resources.

### Infrastructure Stack

```
Fly.io Infrastructure (per customer)
├── Dedicated Machines (per plan)
├── PostgreSQL Cluster (primary + replicas)
├── Upstash Redis (dedicated)
├── WebHost Application (scaled)
├── Cloudflare CDN (global)
└── Managed Backups
```

### Database Schema

```elixir
# Same schema works, but with dedicated database
defmodule WebHost.Fleet.Vehicle do
  multitenancy do
    strategy :attribute
    attribute :customer_id  # Still present for consistency
  end
  
  attributes do
    uuid_primary_key :id
    attribute :customer_id, :uuid
    # ... other attributes
  end
end
```

### Resource Allocation by Plan

| Plan | CPU | RAM | Storage | Database | Redis | Regions |
|------|-----|-----|---------|----------|-------|----------|
| **Starter** | Shared CPU | 512MB | 10GB | Single instance | Shared | 1 region |
| **Professional** | Performance CPU | 1GB | 50GB | Primary + 1 replica | Standard | 2 regions |
| **Business** | Performance CPU | 2GB | 200GB | Multi-region cluster | Premium | 3 regions |

### Performance Characteristics by Plan

| Metric | Starter | Professional | Business |
|--------|---------|---------------|----------|
| API Response Time | <80ms p95 | <60ms p95 | <40ms p95 |
| GPS Ingestion Rate | 2,000/second | 5,000/second | 10,000/second |
| Concurrent Users | 100 | 250 | 500 |
| Database Queries | 5,000/sec | 10,000/sec | 20,000/sec |
| Data Retention | 90 days | 365 days | 730 days |

### Security Model

```elixir
# Infrastructure-level isolation + database policies
policies do
  policy action_type(:read) do
    authorize_if relates_to_actor_via(:customer)  # Database-level
  end
end

# Additional infrastructure isolation:
# - Separate containers
# - Dedicated database instances
# - Isolated networks
# - Individual SSL certificates
```

### Backup Strategy

```elixir
# Fly.io managed backups
config :webhost, WebHost.Repo,
  backup_enabled: true,
  backup_retention: 30,  # days
  point_in_time_recovery: true
```

### Monitoring

- Fly.io application metrics
- Database cluster health
- CDN performance
- Global latency tracking
- Per-customer resource utilization

---

## Deployment Mode Selection Logic

### Automatic Infrastructure Routing

```elixir
defmodule WebHost.Infrastructure.Router do
  def provision_infrastructure(customer) do
    plan = customer.subscription.plan.name
    
    case plan do
      :hobby ->
        # Multi-tenant mode
        {:multi_tenant, provision_hetzner_slot(customer)}
      
      plan when plan in [:starter, :professional, :business] ->
        # Single-tenant mode
        {:single_tenant, provision_flyio_instance(customer, plan)}
    end
  end
end
```

### Decision Matrix

| Factor | Multi-Tenant (Hobby) | Single-Tenant (Starter+) |
|--------|----------------------|---------------------------|
| **Customer Budget** | < $50/month | > $50/month |
| **Vehicle Count** | 1-5 vehicles | 10-500 vehicles |
| **Performance Requirements** | Standard | High/Real-time |
| **Compliance Needs** | Basic | SOC 2/HIPAA |
| **Geographic Distribution** | Single region | Multi-region |
| **Support SLA** | Best effort | Guaranteed |

---

## Configuration Differences

### Multi-Tenant Configuration

```elixir
# config/prod.exs - Multi-tenant mode
config :webhost, WebHost.Repo,
  pool_size: 20,
  queue_target: 5000,
  shared_pool: true,
  tenant_aware: true

config :webhost, :infrastructure,
  mode: :multi_tenant,
  provider: :hetzner,
  max_customers_per_server: 150

config :webhost, :billing,
  enforce_plan_limits: true,
  auto_upgrade_threshold: 0.8
```

### Single-Tenant Configuration

```elixir
# config/prod.exs - Single-tenant mode
config :webhost, WebHost.Repo,
  pool_size: 10,
  queue_target: 1000,
  shared_pool: false,
  tenant_aware: false  # Single customer per DB

config :webhost, :infrastructure,
  mode: :single_tenant,
  provider: :flyio,
  dedicated_resources: true

config :webhost, :billing,
  enforce_plan_limits: false,  # Customer has dedicated resources
  auto_scaling: true
```

### Environment Variables

| Variable | Multi-Tenant | Single-Tenant |
|----------|--------------|---------------|
| `DEPLOYMENT_MODE` | `multi_tenant` | `single_tenant` |
| `INFRASTRUCTURE_PROVIDER` | `hetzner` | `flyio` |
| `SHARED_DATABASE_URL` | ✅ Set | ❌ Not used |
| `DEDICATED_DATABASE_URL` | ❌ Not used | ✅ Set |
| `MAX_CUSTOMERS` | `150` | `1` |
| `TENANT_ISOLATION` | `database_level` | `infrastructure_level` |

---

## Migration Between Modes

### Upgrade Path: Multi-Tenant → Single-Tenant

```elixir
defmodule WebHost.Workers.UpgradeToSingleTenantWorker do
  use Oban.Worker, queue: :infrastructure_migration

  def perform(%Oban.Job{args: %{"customer_id" => customer_id}}) do
    customer = WebHost.Accounts.Customer |> Ash.get!(customer_id)
    
    with {:ok, deployment} <- provision_single_tenant_infrastructure(customer),
         {:ok, _} <- export_data_from_multi_tenant(customer),
         {:ok, _} <- import_data_to_single_tenant(customer, deployment),
         {:ok, _} -> update_dns_to_point_to_new_infrastructure(customer),
         {:ok, _} -> verify_migration_success(customer) do
      
      # Update customer metadata
      customer
      |> Ash.Changeset.for_update(:update, %{
        metadata: Map.merge(customer.metadata || %{}, %{
          "deployment_mode" => "single_tenant",
          "migrated_at" => DateTime.utc_now() |> DateTime.to_iso8601()
        })
      })
      |> Ash.update!()
      
      send_upgrade_success_notification(customer)
      :ok
    else
      {:error, reason} ->
        send_upgrade_failure_notification(customer, reason)
        {:error, reason}
    end
  end
end
```

### Downgrade Path: Single-Tenant → Multi-Tenant

```elixir
defmodule WebHost.Workers.DowngradeToMultiTenantWorker do
  use Oban.Worker, queue: :infrastructure_migration

  def perform(%Oban.Job{args: %{"customer_id" => customer_id}}) do
    customer = WebHost.Accounts.Customer |> Ash.get!(customer_id)
    
    with {:ok, _} -> export_recent_data(customer),  # Based on plan limits
         {:ok, _} -> find_available_multi_tenant_slot(customer),
         {:ok, _} -> import_data_to_multi_tenant(customer),
         {:ok, _} -> update_dns_to_point_to_multi_tenant(customer),
         {:ok, _} -> cleanup_single_tenant_infrastructure(customer) do
      
      # Update customer metadata
      customer
      |> Ash.Changeset.for_update(:update, %{
        metadata: Map.merge(customer.metadata || %{}, %{
          "deployment_mode" => "multi_tenant",
          "downgraded_at" => DateTime.utc_now() |> DateTime.to_iso8601()
        })
      })
      |> Ash.update!()
      
      send_downgrade_success_notification(customer)
      :ok
    else
      {:error, reason} ->
        send_downgrade_failure_notification(customer, reason)
        {:error, reason}
    end
  end
end
```

---

## Operational Considerations

### Multi-Tenant Operations

#### Pros
- **Cost Efficiency**: 97% profit margins
- **Resource Optimization**: High density
- **Simplified Management**: Single server
- **Fast Provisioning**: <10 minutes

#### Cons
- **Noisy Neighbor Risk**: Shared resources
- **Limited Scaling**: Fixed capacity
- **Security Boundaries**: Database-level only
- **Compliance Limitations**: Not suitable for regulated industries

#### Monitoring Requirements
```elixir
# Per-customer resource usage tracking
defmodule WebHost.Monitoring.MultiTenantMonitor do
  def check_customer_usage(customer_id) do
    usage_metrics = %{
      gps_points_today: count_gps_points_today(customer_id),
      api_calls_today: count_api_calls_today(customer_id),
      storage_used: calculate_storage_usage(customer_id),
      concurrent_connections: get_connection_count(customer_id)
    }
    
    plan_limits = get_plan_limits(customer_id)
    
    if exceeds_limits?(usage_metrics, plan_limits) do
      trigger_usage_alert(customer_id, usage_metrics, plan_limits)
    end
  end
end
```

### Single-Tenant Operations

#### Pros
- **Performance Isolation**: No resource contention
- **Security Compliance**: Complete data separation
- **Flexible Scaling**: Independent per customer
- **Premium Features**: Multi-region, dedicated resources

#### Cons
- **Higher Costs**: More infrastructure per customer
- **Management Complexity**: More instances to monitor
- **Provisioning Time**: Longer setup process
- **Resource Waste**: Potential underutilization

#### Monitoring Requirements
```elixir
# Infrastructure health monitoring
defmodule WebHost.Monitoring.SingleTenantMonitor do
  def check_infrastructure_health(customer_id) do
    deployment = get_deployment(customer_id)
    
    health_checks = [
      check_application_health(deployment),
      check_database_health(deployment),
      check_redis_health(deployment),
      check_cdn_performance(deployment)
    ]
    
    overall_health = calculate_overall_health(health_checks)
    
    if overall_health.status != :healthy do
      trigger_infrastructure_alert(customer_id, overall_health)
    end
  end
end
```

---

## Cost Analysis

### Multi-Tenant Cost Structure

| Cost Component | Monthly Cost | Per Customer (150 total) |
|----------------|--------------|---------------------------|
| Hetzner AX52 Server | €65 ($70) | $0.47 |
| Storage Box | €3.81 ($4.15) | $0.03 |
| Domain & SSL | €10 ($11) | $0.07 |
| Monitoring | €5 ($5) | $0.03 |
| **Total** | **€83 ($89)** | **$0.59** |

### Single-Tenant Cost Structure by Plan

| Plan | Infrastructure Cost | Customer Revenue | Profit Margin |
|------|---------------------|------------------|---------------|
| **Starter** | $400/month | $49/month | 83.7% |
| **Professional** | $800/month | $149/month | 94.6% |
| **Business** | $1,200/month | $399/month | 85.0% |

---

## Decision Framework

### Customer Selection Algorithm

```elixir
defmodule WebHost.Infrastructure.DecisionEngine do
  def recommend_deployment_mode(customer_profile) do
    %{
      budget: budget,
      vehicle_count: vehicles,
      compliance_requirements: compliance,
      performance_needs: performance,
      geographic_distribution: geo_dist
    } = customer_profile
    
    cond do
      # Clear multi-tenant signals
      budget < 50 and vehicles <= 5 and compliance == [] ->
        {:multi_tenant, :hobby_tier}
      
      # Clear single-tenant signals
      vehicles > 10 or :soc2 in compliance or :hipaa in compliance ->
        {:single_tenant, determine_plan(vehicles, performance)}
      
      # Edge cases - consider performance requirements
      performance.latency_requirement < 50 and vehicles > 5 ->
        {:single_tenant, :professional_tier}
      
      # Default based on vehicle count
      vehicles <= 5 ->
        {:multi_tenant, :hobby_tier}
      
      true ->
        {:single_tenant, :starter_tier}
    end
  end
end
```

### Automated Plan Recommendations

```elixir
defmodule WebHost.Billing.PlanRecommendationEngine do
  def analyze_and_recommend(customer_id) do
    customer = WebHost.Accounts.Customer |> Ash.get!(customer_id)
    usage_metrics = get_usage_metrics(customer_id)
    
    recommendations = [
      check_for_upgrade_opportunity(customer, usage_metrics),
      check_for_downgrade_opportunity(customer, usage_metrics),
      check_for_mode_change_opportunity(customer, usage_metrics)
    ]
    
    Enum.filter(recommendations, & &1)
  end
  
  defp check_for_mode_change_opportunity(customer, usage) do
    current_mode = get_deployment_mode(customer)
    
    case current_mode do
      :multi_tenant ->
        if usage.utilization > 0.8 or usage.vehicle_count > 5 do
          {:upgrade_mode, :single_tenant, "High usage suggests dedicated resources"}
        end
      
      :single_tenant ->
        if usage.utilization < 0.2 and usage.vehicle_count <= 5 do
          {:downgrade_mode, :multi_tenant, "Low usage suggests shared resources"}
        end
    end
  end
end
```

---

## Implementation Checklist

### Multi-Tenant Mode Setup

- [ ] Configure Hetzner server with TimescaleDB + PostGIS
- [ ] Set up shared Redis instance
- [ ] Implement customer isolation with Ash policies
- [ ] Configure resource monitoring and limits
- [ ] Set up automated backups to Storage Box
- [ ] Implement usage tracking and alerting
- [ ] Configure Nginx for SSL termination
- [ ] Set up log aggregation per customer

### Single-Tenant Mode Setup

- [ ] Configure Fly.io organization and apps
- [ ] Set up automated provisioning pipeline
- [ ] Configure dedicated database clusters
- [ ] Set up Upstash Redis instances
- [ ] Configure Cloudflare CDN
- [ ] Implement infrastructure monitoring
- [ ] Set up automated scaling rules
- [ ] Configure multi-region deployment

### Migration Readiness

- [ ] Implement data export/import utilities
- [ ] Create infrastructure provisioning workers
- [ ] Set up DNS management automation
- [ ] Configure migration monitoring
- [ ] Create rollback procedures
- [ ] Set up customer notification system
- [ ] Test migration procedures end-to-end
- [ ] Document migration runbooks

---

## Conclusion

The dual-mode deployment architecture provides WebHost Systems with the flexibility to serve different market segments optimally:

- **Multi-tenant mode** maximizes cost efficiency for price-sensitive hobby users
- **Single-tenant mode** provides premium performance and isolation for professional users
- **Automated migration** allows customers to move between modes as their needs evolve
- **Unified codebase** reduces maintenance overhead while supporting both models
- **Intelligent routing** ensures customers are always on the optimal infrastructure

This architecture positions WebHost Systems to capture the entire market spectrum from individual hobbyists to enterprise fleets while maintaining excellent profit margins and operational efficiency.

---

**Last Updated**: 10/14/2025
**Author**: WebHost Systems Team  
**Version**: 1.0.0