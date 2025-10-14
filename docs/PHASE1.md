# Phase 1: WebHost Core Resources with Multi-Tenancy (Revised)

## Overview
Define all core Ash resources with built-in multi-tenancy for GPS tracking platform. This phase establishes customer isolation, TimescaleDB hypertables for GPS data, PostGIS for geofencing, and prepares for Yjs sync integration.

## Goals
- Define multi-tenant Ash resources for all domains
- Configure TimescaleDB hypertables for GPS data
- Set up PostGIS for geofencing and spatial queries
- Implement declarative authorization policies
- Generate and run migrations
- Create seed data for testing

## Resource Overview

```
Domains:
├── Accounts (5 resources)
│   ├── PlatformUser (staff/admin)
│   ├── Customer (tenants)
│   ├── CustomerUser (tenant users)
│   ├── ApiKey (API authentication)
│   └── Token (JWT tokens)
├── Billing (2 resources)
│   ├── Plan
│   └── Subscription
├── Fleet (2 resources) - NEW
│   ├── Vehicle (GPS tracking targets)
│   └── Driver (assigned to vehicles)
├── Tracking (2 resources - TimescaleDB)
│   ├── GpsPosition (hypertable for GPS data)
│   └── UsageMetric (system metrics)
└── Spatial (2 resources - PostGIS)
    ├── Geofence (geographic boundaries)
    └── Route (computed paths)
```

## 🏗️ Multi-Cloud Tenant Strategy

### Overview

WebHost Systems uses **attribute-based multi-tenancy** combined with **intelligent infrastructure routing** to ensure optimal performance and cost efficiency:

- **Hobby Tier customers**: Routed to Hetzner dedicated servers
- **Starter+ Tier customers**: Routed to Fly.io multi-region
- **Automatic routing**: Based on subscription plan
- **Data isolation**: Maintained across all infrastructure

### Infrastructure-Aware Multi-Tenancy

```elixir
# Every resource with customer data:
multitenancy do
  strategy :attribute
  attribute :customer_id
end

# Infrastructure routing logic:
defmodule WebHost.Infrastructure.Router do
  def route_customer(customer) do
    case customer.subscription.plan.name do
      :hobby ->
        {:ok, get_hetzner_server(customer)}
      
      :starter ->
        {:ok, get_flyio_region(customer, "us-east")}
      
      :professional ->
        {:ok, get_flyio_region(customer, "global")}
      
      :business ->
        {:ok, get_flyio_region(customer, "multi-region")}
    end
  end
end

# Query syntax (same across all infrastructure):
Resource
|> Ash.Query.for_read(:read, tenant: customer_id)
|> Ash.read!()

# Impossible to query without tenant! Compile-time safety!
```

### Database Strategy by Tier

#### Hobby Tier (Hetzner)
```
- Single database on Hetzner dedicated server
- TimescaleDB hypertables for GPS data
- PostGIS for spatial queries
- Local backups to Hetzner Storage Box
- Customer isolation via customer_id
```

#### Starter+ Tiers (Fly.io)
```
- Regional databases (primary: us-east)
- Read replicas in fra, sin regions
- Automatic failover between regions
- Point-in-time recovery
- Customer isolation via customer_id
```

### Data Synchronization Strategy

```elixir
defmodule WebHost.Infrastructure.Sync do
  # For customers upgrading from Hobby to Starter+
  def migrate_customer_to_flyio(customer) do
    # 1. Export data from Hetzner
    data = export_customer_data(customer)
    
    # 2. Import to Fly.io
    import_customer_data_to_flyio(customer, data)
    
    # 3. Update routing configuration
    update_customer_routing(customer, :flyio)
    
    # 4. Verify migration
    verify_data_integrity(customer)
  end
  
  # For customers downgrading from Starter+ to Hobby
  def migrate_customer_to_hetzner(customer) do
    # Similar process in reverse
    # Only recent data (based on plan limits)
  end
end
```

### Performance Characteristics by Tier

| Feature | Hobby (Hetzner) | Starter (Fly.io) | Professional (Fly.io) | Business (Fly.io) |
|---------|------------------|------------------|----------------------|-------------------|
| **Database** | Single instance | Regional + 1 replica | Regional + 2 replicas | Multi-region |
| **GPS Points/Day** | 50K | 500K | 2M | 10M |
| **Query Latency** | ~10ms | ~50ms | ~30ms | ~20ms |
| **Data Retention** | 30 days | 90 days | 365 days | 730 days |
| **Backup Frequency** | Daily | Hourly | Continuous | Continuous |
| **Geofence Queries** | Sub-50ms | Sub-100ms | Sub-75ms | Sub-50ms |

### Multi-Region Routing (Starter+)

```elixir
defmodule WebHost.Infrastructure.GeoRouter do
  def route_request(customer, request_location) do
    case customer.subscription.plan.name do
      :hobby ->
        # Always route to Hetzner
        route_to_hetzner(customer)
      
      plan when plan in [:starter, :professional, :business] ->
        # Route to nearest Fly.io region
        nearest_region = find_nearest_region(request_location)
        route_to_flyio_region(customer, nearest_region)
    end
  end
  
  defp find_nearest_region(location) do
    # Geographic routing logic
    cond do
      location.country in ["US", "CA", "MX"] -> "us-east"
      location.country in ["DE", "FR", "GB", "IT"] -> "fra"
      location.country in ["SG", "JP", "AU", "IN"] -> "sin"
      true -> "us-east"  # Default
    end
  end
end
```

### Cost Optimization Strategy

```elixir
defmodule WebHost.Infrastructure.CostOptimizer do
  def analyze_customer_usage(customer) do
    usage_metrics = get_usage_metrics(customer)
    plan_limits = get_plan_limits(customer.subscription.plan)
    
    cond do
      # Customer is exceeding hobby limits
      usage_metrics.gps_points_per_day > plan_limits.gps_points_per_day * 0.8 ->
        suggest_plan_upgrade(customer, :starter)
      
      # Customer on expensive plan with low usage
      usage_metrics.utilization < 0.2 and customer.subscription.plan.name != :hobby ->
        suggest_plan_downgrade(customer, :hobby)
      
      # Customer is on optimal plan
      true ->
        :optimal
    end
  end
end
```

---

## Multi-Tenancy Strategy

All customer data uses **attribute-based multi-tenancy** with `customer_id`:

```elixir
# Every resource with customer data:
multitenancy do
  strategy :attribute
  attribute :customer_id
end

# Query syntax:
Resource
|> Ash.Query.for_read(:read, tenant: customer_id)
|> Ash.read!()

# Impossible to query without tenant! Compile-time safety!
```

---

## Accounts Domain Resources

### 1. Token Resource (Required for AshAuthentication)

Create `lib/webhost/accounts/token.ex`:

```elixir
defmodule WebHost.Accounts.Token do
  use Ash.Resource,
    domain: WebHost.Accounts,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshAuthentication.TokenResource]

  postgres do
    table "tokens"
    repo WebHost.Repo
  end

  token do
    # Token configuration handled by extension
  end
end
```

### 2. Platform User (Staff/Admin)

Create `lib/webhost/accounts/platform_user.ex`:

```elixir
defmodule WebHost.Accounts.PlatformUser do
  use Ash.Resource,
    domain: WebHost.Accounts,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshAuthentication, AshGraphql.Resource]

  postgres do
    table "platform_users"
    repo WebHost.Repo
  end

  authentication do
    strategies do
      password :password do
        identity_field :email
        hashed_password_field :hashed_password
        
        resettable do
          sender WebHost.Accounts.UserNotifier
        end
      end
    end

    tokens do
      enabled? true
      token_resource WebHost.Accounts.Token
      signing_secret fn _, _ ->
        {:ok, Application.fetch_env!(:webhost, :token_signing_secret)}
      end
      
      token_lifetime 168  # 7 days in hours
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :email, :ci_string do
      allow_nil? false
      public? true
    end

    attribute :hashed_password, :string do
      allow_nil? false
      sensitive? true
      private? true
    end

    attribute :name, :string, public?: true

    attribute :role, :atom do
      allow_nil? false
      default :staff
      constraints one_of: [:admin, :staff]
      public? true
    end

    attribute :active, :boolean, default: true, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  actions do
    defaults [:read, :destroy]

    read :get_by_email do
      argument :email, :ci_string, allow_nil?: false
      get? true
      filter expr(email == ^arg(:email))
    end

    update :update do
      accept [:name, :role, :active]
    end
  end

  identities do
    identity :unique_email, [:email]
  end

  policies do
    bypass AshAuthentication.Checks.AshAuthenticationInteraction do
      authorize_if always()
    end

    policy always() do
      forbid_if always()
    end

    policy action_type(:read) do
      authorize_if expr(id == ^actor(:id))
      authorize_if actor_attribute_equals(:role, :admin)
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if actor_attribute_equals(:role, :admin)
    end
  end

  graphql do
    type :platform_user

    queries do
      get :platform_user, :read
      read_one :current_user, :read
    end

    mutations do
      update :update_platform_user, :update
    end
  end

  # NEW: Infrastructure-aware calculations
  calculations do
    calculate :infrastructure_location, :string do
      calculation fn records, _context ->
        records
        |> Ash.load!(:subscription)
        |> Enum.map(fn customer ->
          case customer.subscription do
            %{plan: %{name: :hobby}} -> "Hetzner Dedicated (Germany)"
            %{plan: %{name: :starter}} -> "Fly.io (US East)"
            %{plan: %{name: :professional}} -> "Fly.io (Global)"
            %{plan: %{name: :business}} -> "Fly.io (Multi-Region)"
            _ -> "Unknown"
          end
        end)
      end
    end

    calculate :can_upgrade_to_flyio, :boolean do
      calculation fn records, _context ->
        records
        |> Ash.load!(:subscription)
        |> Enum.map(fn customer ->
          customer.subscription.plan.name == :hobby
        end)
      end
    end

    calculate :needs_performance_monitoring, :boolean do
      calculation fn records, _context ->
        records
        |> Ash.load!(:subscription)
        |> Enum.map(fn customer ->
          customer.subscription.plan.name in [:professional, :business]
        end)
      end
    end
  end

  # NEW: Infrastructure migration actions
  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:name, :slug, :email, :company_name, :billing_email, :settings]
      
      validate present([:name, :slug, :email])
      validate match(:slug, ~r/^[a-z0-9-]+$/)
    end

    update :update do
      accept [:name, :company_name, :billing_email, :status, :onboarding_completed, :settings, :metadata]
    end

    read :by_slug do
      argument :slug, :string, allow_nil?: false
      get? true
      filter expr(slug == ^arg(:slug))
    end

    update :complete_onboarding do
      accept []
      change set_attribute(:onboarding_completed, true)
    end

    update :suspend do
      accept []
      change set_attribute(:status, :suspended)
    end

    # NEW: Infrastructure migration actions
    update :migrate_to_flyio do
      accept []
      argument :target_region, :string, default: "us-east"
      
      validate present([:target_region])
      validate attribute_equals(:status, :active)
      
      change fn changeset, _context ->
        customer = Ash.Changeset.get_data(changeset)
        target_region = Ash.Changeset.get_argument(changeset, :target_region)
        
        # This would trigger the actual migration process
        case WebHost.Infrastructure.Sync.migrate_customer_to_flyio(customer, target_region) do
          :ok -> changeset
          {:error, reason} -> Ash.Changeset.add_error(changeset, :migration, "Failed to migrate: #{reason}")
        end
      end
      
      # Update metadata to reflect new infrastructure
      change set_attribute(:metadata, fn metadata ->
        Map.put(metadata || %{}, "infrastructure", %{
          "provider" => "flyio",
          "region" => Ash.Changeset.get_argument(changeset, :target_region),
          "migrated_at" => DateTime.utc_now() |> DateTime.to_iso8601()
        })
      end)
    end

    update :migrate_to_hetzner do
      accept []
      
      validate attribute_equals(:status, :active)
      
      change fn changeset, _context ->
        customer = Ash.Changeset.get_data(changeset)
        
        # This would trigger the actual migration process
        case WebHost.Infrastructure.Sync.migrate_customer_to_hetzner(customer) do
          :ok -> changeset
          {:error, reason} -> Ash.Changeset.add_error(changeset, :migration, "Failed to migrate: #{reason}")
        end
      end
      
      # Update metadata to reflect new infrastructure
      change set_attribute(:metadata, fn metadata ->
        Map.put(metadata || %{}, "infrastructure", %{
          "provider" => "hetzner",
          "migrated_at" => DateTime.utc_now() |> DateTime.to_iso8601()
        })
      end)
    end

    read :customers_on_infrastructure do
      argument :provider, :string, allow_nil?: false
      
      prepare fn query, _context ->
        provider = Ash.Query.get_argument(query, :provider)
        
        query
        |> Ash.Query.filter(
          fragment("(metadata->'infrastructure'->>'provider') = ?", ^provider)
        )
      end
    end
  end
end
```

### 3. Customer (Multi-Tenant Root)

Create `lib/webhost/accounts/customer.ex`:

```elixir
defmodule WebHost.Accounts.Customer do
  use Ash.Resource,
    domain: WebHost.Accounts,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource, AshJsonApi.Resource]

  postgres do
    table "customers"
    repo WebHost.Repo
  end

  attributes do
    uuid_primary_key :id

    attribute :name, :string do
      allow_nil? false
      public? true
    end

    attribute :slug, :string do
      allow_nil? false
      public? true
    end

    attribute :email, :ci_string do
      allow_nil? false
      public? true
    end

    attribute :company_name, :string, public?: true
    attribute :billing_email, :ci_string, public?: true

    attribute :status, :atom do
      allow_nil? false
      default :active
      constraints one_of: [:active, :suspended, :cancelled]
      public? true
    end

    attribute :onboarding_completed, :boolean, default: false, public?: true
    attribute :stripe_customer_id, :string, public?: true
    
    attribute :settings, :map, default: %{}, public?: true
    attribute :metadata, :map, default: %{}, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    has_one :subscription, WebHost.Billing.Subscription
    has_many :vehicles, WebHost.Fleet.Vehicle
    has_many :drivers, WebHost.Fleet.Driver
    has_many :gps_positions, WebHost.Tracking.GpsPosition
    has_many :geofences, WebHost.Spatial.Geofence
    has_many :api_keys, WebHost.Accounts.ApiKey
    has_many :customer_users, WebHost.Accounts.CustomerUser
  end

  calculations do
    calculate :trial_expired, :boolean do
      calculation fn records, _context ->
        records
        |> Ash.load!(:subscription)
        |> Enum.map(fn customer ->
          case customer.subscription do
            %{status: :trialing, current_period_end: end_date} ->
              DateTime.compare(DateTime.utc_now(), end_date) == :gt
            _ ->
              false
          end
        end)
      end
    end

    calculate :vehicle_count, :integer do
      calculation fn records, _context ->
        records
        |> Ash.load!(vehicles: [aggregate: [:count, :id]])
        |> Enum.map(fn customer ->
          length(customer.vehicles || [])
        end)
      end
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:name, :slug, :email, :company_name, :billing_email, :settings]
      
      validate present([:name, :slug, :email])
      validate match(:slug, ~r/^[a-z0-9-]+$/)
    end

    update :update do
      accept [:name, :company_name, :billing_email, :status, :onboarding_completed, :settings, :metadata]
    end

    read :by_slug do
      argument :slug, :string, allow_nil?: false
      get? true
      filter expr(slug == ^arg(:slug))
    end

    update :complete_onboarding do
      accept []
      change set_attribute(:onboarding_completed, true)
    end

    update :suspend do
      accept []
      change set_attribute(:status, :suspended)
    end
  end

  identities do
    identity :unique_slug, [:slug]
    identity :unique_email, [:email]
  end

  policies do
    policy action_type(:read) do
      authorize_if actor_present()
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if actor_attribute_equals(:role, :admin)
    end
  end

  graphql do
    type :customer

    queries do
      get :customer, :read
      list :customers, :read
      get :customer_by_slug, :by_slug
    end

    mutations do
      create :create_customer, :create
      update :update_customer, :update
      update :complete_onboarding, :complete_onboarding
    end
  end

  json_api do
    type "customer"

    routes do
      base "/customers"
      get :read
      index :read
      post :create
      patch :update
    end
  end
end
```

### 4. API Key (Multi-Tenant)

Create `lib/webhost/accounts/api_key.ex`:

```elixir
defmodule WebHost.Accounts.ApiKey do
  use Ash.Resource,
    domain: WebHost.Accounts,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource]

  postgres do
    table "api_keys"
    repo WebHost.Repo
  end

  # Multi-tenancy by customer
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

    attribute :key_hash, :string do
      allow_nil? false
      private? true
    end

    attribute :key_prefix, :string do
      allow_nil? false
      public? true
    end

    attribute :key, :string do
      allow_nil? false
      writable? :create
      private? true
      sensitive? true
    end

    attribute :environment, :atom do
      allow_nil? false
      default :production
      constraints one_of: [:production, :development]
      public? true
    end

    attribute :permissions, {:array, :string}, default: [], public?: true
    attribute :last_used_at, :utc_datetime, public?: true
    attribute :expires_at, :utc_datetime, public?: true
    attribute :revoked_at, :utc_datetime, public?: true
    attribute :active, :boolean, default: true, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
      attribute_writable? true
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:name, :environment, :permissions, :customer_id]

      change fn changeset, _context ->
        env = Ash.Changeset.get_attribute(changeset, :environment)
        prefix = if env == :production, do: "whs_live_", else: "whs_test_"
        
        key = prefix <> Base.encode16(:crypto.strong_rand_bytes(32), case: :lower)
        key_hash = :crypto.hash(:sha256, key) |> Base.encode16(case: :lower)
        
        changeset
        |> Ash.Changeset.force_change_attribute(:key, key)
        |> Ash.Changeset.force_change_attribute(:key_hash, key_hash)
        |> Ash.Changeset.force_change_attribute(:key_prefix, prefix)
      end
    end

    read :by_key_hash do
      argument :key, :string, allow_nil?: false
      
      prepare fn query, _context ->
        key = Ash.Query.get_argument(query, :key)
        key_hash = :crypto.hash(:sha256, key) |> Base.encode16(case: :lower)
        
        query
        |> Ash.Query.filter(key_hash == ^key_hash and active == true)
      end
      
      get? true
    end

    update :revoke do
      accept []
      change set_attribute(:active, false)
      change set_attribute(:revoked_at, &DateTime.utc_now/0)
    end

    update :mark_used do
      accept []
      change set_attribute(:last_used_at, &DateTime.utc_now/0)
    end
  end

  identities do
    identity :unique_key_hash, [:key_hash]
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via(:customer)
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if relates_to_actor_via(:customer)
      authorize_if actor_attribute_equals(:role, :admin)
    end
  end

  graphql do
    type :api_key

    queries do
      list :api_keys, :read
    end

    mutations do
      create :create_api_key, :create
      update :revoke_api_key, :revoke
    end
  end
end
```

---

## Fleet Domain Resources (NEW)

### 5. Vehicle Resource

Create `lib/webhost/fleet/vehicle.ex`:

```elixir
defmodule WebHost.Fleet.Vehicle do
  use Ash.Resource,
    domain: WebHost.Fleet,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource, AshJsonApi.Resource]

  postgres do
    table "vehicles"
    repo WebHost.Repo
  end

  # Multi-tenancy: All vehicles belong to a customer
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
      description "License plate, VIN, or fleet number"
    end

    attribute :vehicle_type, :atom do
      allow_nil? false
      constraints one_of: [:car, :truck, :van, :motorcycle, :other]
      public? true
    end

    attribute :make, :string, public?: true
    attribute :model, :string, public?: true
    attribute :year, :integer, public?: true
    attribute :color, :string, public?: true

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

    belongs_to :driver, WebHost.Fleet.Driver do
      attribute_writable? true
    end

    has_many :gps_positions, WebHost.Tracking.GpsPosition
  end

  calculations do
    calculate :latest_position, :map do
      calculation fn records, _context ->
        records
        |> Ash.load!(gps_positions: [
          query: WebHost.Tracking.GpsPosition
                 |> Ash.Query.sort(time: :desc)
                 |> Ash.Query.limit(1)
        ])
        |> Enum.map(fn vehicle ->
          case vehicle.gps_positions do
            [latest | _] -> 
              %{
                latitude: latest.latitude,
                longitude: latest.longitude,
                time: latest.time
              }
            _ -> nil
          end
        end)
      end
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:customer_id, :name, :vehicle_identifier, :vehicle_type, 
              :make, :model, :year, :color, :metadata]
      
      validate present([:name, :vehicle_identifier, :vehicle_type])
    end

    update :update do
      accept [:name, :vehicle_identifier, :vehicle_type, :make, :model, 
              :year, :color, :status, :metadata]
    end

    update :assign_driver do
      argument :driver_id, :uuid, allow_nil?: false
      
      change manage_relationship(:driver_id, :driver, type: :append)
    end

    read :active do
      filter expr(status == :active)
    end
  end

  identities do
    identity :unique_vehicle_identifier, [:customer_id, :vehicle_identifier]
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via(:customer)
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if relates_to_actor_via(:customer)
    end
  end

  graphql do
    type :vehicle

    queries do
      get :vehicle, :read
      list :vehicles, :read
      list :active_vehicles, :active
    end

    mutations do
      create :create_vehicle, :create
      update :update_vehicle, :update
      update :assign_driver_to_vehicle, :assign_driver
    end
  end

  json_api do
    type "vehicle"

    routes do
      base "/vehicles"
      get :read
      index :read
      post :create
      patch :update
    end
  end
end
```

### 6. Driver Resource

Create `lib/webhost/fleet/driver.ex`:

```elixir
defmodule WebHost.Fleet.Driver do
  use Ash.Resource,
    domain: WebHost.Fleet,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource]

  postgres do
    table "drivers"
    repo WebHost.Repo
  end

  # Multi-tenancy
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

    attribute :email, :ci_string, public?: true
    attribute :phone, :string, public?: true
    attribute :license_number, :string, public?: true

    attribute :status, :atom do
      allow_nil? false
      default :active
      constraints one_of: [:active, :inactive, :suspended]
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

    has_many :vehicles, WebHost.Fleet.Vehicle
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:customer_id, :name, :email, :phone, :license_number, :metadata]
      validate present([:name])
    end

    update :update do
      accept [:name, :email, :phone, :license_number, :status, :metadata]
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

  graphql do
    type :driver

    queries do
      get :driver, :read
      list :drivers, :read
    end

    mutations do
      create :create_driver, :create
      update :update_driver, :update
    end
  end
end
```

---

## Tracking Domain Resources (TimescaleDB)

### 7. GPS Position (TimescaleDB Hypertable)

Create `lib/webhost/tracking/gps_position.ex`:

```elixir
defmodule WebHost.Tracking.GpsPosition do
  use Ash.Resource,
    domain: WebHost.Tracking,
    data_layer: AshPostgres.DataLayer

  postgres do
    table "gps_positions"
    repo WebHost.Repo

    # This will become a TimescaleDB hypertable in migration
    custom_indexes do
      index [:vehicle_id, :time], using: :btree
      index [:customer_id, :time], using: :btree
    end
  end

  # Multi-tenancy
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

    attribute :time, :utc_datetime_usec do
      allow_nil? false
      default: &DateTime.utc_now/0
      public? true
    end

    attribute :vehicle_id, :uuid do
      allow_nil? false
      public? true
    end

    attribute :latitude, :decimal do
      allow_nil? false
      public? true
    end

    attribute :longitude, :decimal do
      allow_nil? false
      public? true
    end

    attribute :speed, :decimal, public?: true
    attribute :heading, :decimal, public?: true
    attribute :accuracy, :decimal, public?: true
    attribute :altitude, :decimal, public?: true

    attribute :metadata, :map, default: %{}, public?: true

    create_timestamp :inserted_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
      attribute_writable? true
    end

    belongs_to :vehicle, WebHost.Fleet.Vehicle do
      allow_nil? false
      attribute_writable? true
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:customer_id, :vehicle_id, :time, :latitude, :longitude, 
              :speed, :heading, :accuracy, :altitude, :metadata]
    end

    read :recent_positions do
      argument :vehicle_id, :uuid, allow_nil?: false
      argument :since, :utc_datetime, default: &one_hour_ago/0

      filter expr(vehicle_id == ^arg(:vehicle_id) and time >= ^arg(:since))
      pagination keyset?: true, required?: false, default_limit: 100
    end

    read :in_time_range do
      argument :vehicle_id, :uuid, allow_nil?: false
      argument :start_time, :utc_datetime, allow_nil?: false
      argument :end_time, :utc_datetime, allow_nil?: false

      filter expr(
        vehicle_id == ^arg(:vehicle_id) and
        time >= ^arg(:start_time) and
        time <= ^arg(:end_time)
      )
    end

    read :for_customer_in_range do
      argument :start_time, :utc_datetime, allow_nil?: false
      argument :end_time, :utc_datetime, allow_nil?: false

      filter expr(
        time >= ^arg(:start_time) and
        time <= ^arg(:end_time)
      )
    end
  end

  defp one_hour_ago do
    DateTime.utc_now() |> DateTime.add(-3600, :second)
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via(:customer)
    end

    policy action_type([:create, :destroy]) do
      authorize_if relates_to_actor_via(:customer)
    end
  end
end
```

---

## Spatial Domain Resources (PostGIS)

### 8. Geofence Resource

Create `lib/webhost/spatial/geofence.ex`:

```elixir
defmodule WebHost.Spatial.Geofence do
  use Ash.Resource,
    domain: WebHost.Spatial,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource]

  postgres do
    table "geofences"
    repo WebHost.Repo

    # PostGIS spatial index
    custom_indexes do
      index ["center"], using: :gist
    end
  end

  # Multi-tenancy
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

    attribute :fence_type, :atom do
      allow_nil? false
      constraints one_of: [:circle, :polygon]
      public? true
    end

    # For circular geofences
    attribute :center_lat, :decimal, public?: true
    attribute :center_lng, :decimal, public?: true
    attribute :radius_meters, :integer, public?: true

    # PostGIS geometry column (for both circles and polygons)
    attribute :geometry, :map do
      public? true
      description "GeoJSON geometry"
    end

    attribute :active, :boolean, default: true, public?: true
    attribute :alert_on_enter, :boolean, default: true, public?: true
    attribute :alert_on_exit, :boolean, default: true, public?: true

    attribute :metadata, :map, default: %{}, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
      attribute_writable? true
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:customer_id, :name, :fence_type, :center_lat, :center_lng, 
              :radius_meters, :geometry, :alert_on_enter, :alert_on_exit, :metadata]
      
      validate present([:name, :fence_type])
    end

    update :update do
      accept [:name, :center_lat, :center_lng, :radius_meters, :geometry,
              :active, :alert_on_enter, :alert_on_exit, :metadata]
    end

    read :active do
      filter expr(active == true)
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

  graphql do
    type :geofence

    queries do
      get :geofence, :read
      list :geofences, :read
      list :active_geofences, :active
    end

    mutations do
      create :create_geofence, :create
      update :update_geofence, :update
    end
  end
end
```

---

## Billing Domain Resources

### 9. Plan

Create `lib/webhost/billing/plan.ex`:

```elixir
defmodule WebHost.Billing.Plan do
  use Ash.Resource,
    domain: WebHost.Billing,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource, AshJsonApi.Resource]

  postgres do
    table "plans"
    repo WebHost.Repo
  end

  attributes do
    uuid_primary_key :id

    attribute :name, :string do
      allow_nil? false
      public? true
    end

    attribute :slug, :string do
      allow_nil? false
      public? true
    end

    attribute :price_monthly, :integer do
      allow_nil? false
      public? true
    end

    attribute :price_yearly, :integer, public?: true

    # Limits
    attribute :max_vehicles, :integer, default: 10, public?: true
    attribute :max_drivers, :integer, default: 10, public?: true
    attribute :gps_points_per_day, :integer, default: 100000, public?: true
    attribute :data_retention_days, :integer, default: 90, public?: true
    attribute :geofence_limit, :integer, default: 50, public?: true

    attribute :features, :map, default: %{}, public?: true
    attribute :active, :boolean, default: true, public?: true
    attribute :stripe_price_id, :string, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    has_many :subscriptions, WebHost.Billing.Subscription
  end

  aggregates do
    count :subscriber_count, :subscriptions do
      filter expr(status in [:active, :trialing])
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [
        :name, :slug, :price_monthly, :price_yearly,
        :max_vehicles, :max_drivers, :gps_points_per_day,
        :data_retention_days, :geofence_limit,
        :features, :stripe_price_id
      ]
    end

    update :update do
      accept [
        :name, :price_monthly, :price_yearly,
        :max_vehicles, :max_drivers, :gps_points_per_day,
        :data_retention_days, :geofence_limit,
        :features, :active, :stripe_price_id
      ]
    end

    read :by_slug do
      argument :slug, :string, allow_nil?: false
      get? true
      filter expr(slug == ^arg(:slug) and active == true)
    end

    read :active_plans do
      filter expr(active == true)
    end
  end

  identities do
    identity :unique_slug, [:slug]
  end

  policies do
    policy action_type(:read) do
      authorize_if always()
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if actor_attribute_equals(:role, :admin)
    end
  end

  graphql do
    type :plan

    queries do
      get :plan, :read
      list :plans, :active_plans
      get :plan_by_slug, :by_slug
    end

    mutations do
      create :create_plan, :create
      update :update_plan, :update
    end
  end

  json_api do
    type "plan"

    routes do
      base "/plans"
      get :read
      index :active_plans
    end
  end
end
```

### 10. Subscription

Create `lib/webhost/billing/subscription.ex`:

```elixir
defmodule WebHost.Billing.Subscription do
  use Ash.Resource,
    domain: WebHost.Billing,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource]

  postgres do
    table "subscriptions"
    repo WebHost.Repo
  end

  attributes do
    uuid_primary_key :id

    attribute :status, :atom do
      allow_nil? false
      default :active
      constraints one_of: [:active, :trialing, :past_due, :cancelled, :incomplete]
      public? true
    end

    attribute :billing_cycle, :atom do
      allow_nil? false
      default :monthly
      constraints one_of: [:monthly, :yearly]
      public? true
    end

    attribute :current_period_start, :utc_datetime, public?: true
    attribute :current_period_end, :utc_datetime, public?: true
    attribute :cancel_at_period_end, :boolean, default: false, public?: true
    attribute :stripe_subscription_id, :string, public?: true
    
    attribute :addons, :map, default: %{}, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
      attribute_writable? true
    end

    belongs_to :plan, WebHost.Billing.Plan do
      allow_nil? false
      attribute_writable? true
    end
  end

  calculations do
    calculate :days_remaining, :integer do
      calculation fn records, _context ->
        Enum.map(records, fn sub ->
          if sub.current_period_end do
            Date.diff(DateTime.to_date(sub.current_period_end), Date.utc_today())
          else
            0
          end
        end)
      end
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:customer_id, :plan_id, :status, :billing_cycle, 
              :current_period_start, :current_period_end, :addons]
    end

    update :update do
      accept [:status, :billing_cycle, :current_period_end, 
              :cancel_at_period_end, :addons, :stripe_subscription_id]
    end

    update :cancel do
      accept []
      change set_attribute(:cancel_at_period_end, true)
      change set_attribute(:status, :cancelled)
    end

    update :reactivate do
      accept []
      change set_attribute(:cancel_at_period_end, false)
      change set_attribute(:status, :active)
    end

    read :active_subscriptions do
      filter expr(status in [:active, :trialing])
    end
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via([:customer])
      authorize_if actor_attribute_equals(:role, :admin)
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if actor_attribute_equals(:role, :admin)
      authorize_if relates_to_actor_via([:customer])
    end
  end

  graphql do
    type :subscription

    queries do
      list :subscriptions, :read
    end

    mutations do
      create :create_subscription, :create
      update :update_subscription, :update
      update :cancel_subscription, :cancel
      update :reactivate_subscription, :reactivate
    end
  end
end
```

---

## Generate Migrations

Now generate migrations from all these resources:

```bash
# Generate resource snapshots
mix ash.codegen initial_resources

# Generate migrations
mix ash_postgres.generate_migrations --name create_all_resources
```

Edit the generated migration to add TimescaleDB and PostGIS features:

### priv/repo/migrations/TIMESTAMP_create_all_resources.exs

```elixir
defmodule WebHost.Repo.Migrations.CreateAllResources do
  use Ecto.Migration

  def up do
    # Auto-generated table creation happens here
    # ... (Ash will generate all CREATE TABLE statements)

    # After tables are created, add TimescaleDB hypertable
    execute """
    SELECT create_hypertable('gps_positions', 'time',
      chunk_time_interval => INTERVAL '1 day',
      if_not_exists => TRUE
    );
    """

    # Add compression policy (compress data older than 7 days)
    execute """
    ALTER TABLE gps_positions SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'vehicle_id,customer_id'
    );
    """

    execute """
    SELECT add_compression_policy('gps_positions', INTERVAL '7 days', if_not_exists => TRUE);
    """

    # Add retention policy (delete data older than 90 days)
    execute """
    SELECT add_retention_policy('gps_positions', INTERVAL '90 days', if_not_exists => TRUE);
    """

    # Add PostGIS geometry column for geofences
    execute """
    ALTER TABLE geofences 
    ADD COLUMN center geometry(Point, 4326);
    """

    # Update center column from lat/lng
    execute """
    UPDATE geofences 
    SET center = ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)
    WHERE center_lat IS NOT NULL AND center_lng IS NOT NULL;
    """

    # Create PostGIS spatial index
    execute """
    CREATE INDEX geofences_center_idx ON geofences USING GIST(center);
    """

    # Create function for geofence checking
    execute """
    CREATE OR REPLACE FUNCTION check_geofence(
      lat DECIMAL,
      lng DECIMAL,
      fence_center geometry,
      radius_m INTEGER
    ) RETURNS BOOLEAN AS $
    BEGIN
      RETURN ST_DWithin(
        fence_center::geography,
        ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
        radius_m
      );
    END;
    $ LANGUAGE plpgsql IMMUTABLE;
    """

    # Create composite index for multi-tenant queries
    execute """
    CREATE INDEX gps_positions_customer_vehicle_time_idx 
    ON gps_positions (customer_id, vehicle_id, time DESC);
    """

    execute """
    CREATE INDEX vehicles_customer_status_idx 
    ON vehicles (customer_id, status);
    """

    execute """
    CREATE INDEX geofences_customer_active_idx 
    ON geofences (customer_id, active);
    """
  end

  def down do
    # Drop function
    execute "DROP FUNCTION IF EXISTS check_geofence;"

    # Drop spatial column
    execute "ALTER TABLE geofences DROP COLUMN IF EXISTS center;"

    # TimescaleDB policies are automatically removed when hypertable is dropped
    # Auto-generated drop statements will follow
  end
end
```

Run migrations:

```bash
mix ecto.migrate
```

---

## Seed Data

Create `priv/repo/seeds.exs`:

```elixir
# Create admin user
{:ok, admin} = 
  WebHost.Accounts.PlatformUser
  |> Ash.Changeset.for_create(:register, %{
    email: "admin@webhost.systems",
    password: "SecurePassword123!",
    password_confirmation: "SecurePassword123!",
    name: "Admin User"
  })
  |> Ash.Changeset.force_change_attribute(:role, :admin)
  |> Ash.create!()

IO.puts("✓ Created admin user: admin@webhost.systems")

# Create plans
plans_data = [
  %{
    name: "Hobby",
    slug: "hobby",
    price_monthly: 1500,
    max_vehicles: 5,
    max_drivers: 5,
    gps_points_per_day: 50_000,
    data_retention_days: 30,
    geofence_limit: 10,
    features: %{"support" => "email"}
  },
  %{
    name: "Starter",
    slug: "starter",
    price_monthly: 4900,
    max_vehicles: 25,
    max_drivers: 25,
    gps_points_per_day: 500_000,
    data_retention_days: 90,
    geofence_limit: 50,
    features: %{"support" => "priority_email", "analytics" => true}
  },
  %{
    name: "Professional",
    slug: "professional",
    price_monthly: 14900,
    max_vehicles: 100,
    max_drivers: 100,
    gps_points_per_day: 2_000_000,
    data_retention_days: 365,
    geofence_limit: 200,
    features: %{"support" => "slack", "analytics" => true, "api_access" => true}
  },
  %{
    name: "Business",
    slug: "business",
    price_monthly: 39900,
    max_vehicles: 500,
    max_drivers: 500,
    gps_points_per_day: 10_000_000,
    data_retention_days: 730,
    geofence_limit: 1000,
    features: %{"support" => "phone", "analytics" => true, "api_access" => true, "dedicated_support" => true}
  }
]

Enum.each(plans_data, fn plan_attrs ->
  WebHost.Billing.Plan
  |> Ash.Changeset.for_create(:create, plan_attrs)
  |> Ash.create!()
  
  IO.puts("✓ Created plan: #{plan_attrs.name}")
end)

# Create demo customer
{:ok, customer} =
  WebHost.Accounts.Customer
  |> Ash.Changeset.for_create(:create, %{
    name: "Demo Logistics",
    slug: "demo",
    email: "demo@demologistics.com",
    company_name: "Demo Logistics Corp"
  })
  |> Ash.create!()

IO.puts("✓ Created demo customer: #{customer.slug}")

# Create subscription for demo customer
starter_plan = 
  WebHost.Billing.Plan
  |> Ash.Query.for_read(:by_slug, %{slug: "starter"})
  |> Ash.read_one!()

{:ok, subscription} =
  WebHost.Billing.Subscription
  |> Ash.Changeset.for_create(:create, %{
    customer_id: customer.id,
    plan_id: starter_plan.id,
    status: :trialing,
    current_period_start: DateTime.utc_now(),
    current_period_end: DateTime.utc_now() |> DateTime.add(14, :day)
  })
  |> Ash.create!()

IO.puts("✓ Created trial subscription")

# Create API key for demo customer
{:ok, api_key} =
  WebHost.Accounts.ApiKey
  |> Ash.Changeset.for_create(:create, %{
    customer_id: customer.id,
    name: "Default Production Key",
    environment: :production,
    permissions: ["gps:read", "gps:write", "vehicles:read", "geofences:read"]
  })
  |> Ash.create!()

IO.puts("✓ Created API key: #{api_key.key_prefix}...")

# Create demo vehicles
vehicles_data = [
  %{name: "Truck 01", vehicle_identifier: "TRK-001", vehicle_type: :truck, make: "Ford", model: "F-150", year: 2022},
  %{name: "Van 01", vehicle_identifier: "VAN-001", vehicle_type: :van, make: "Mercedes", model: "Sprinter", year: 2023},
  %{name: "Car 01", vehicle_identifier: "CAR-001", vehicle_type: :car, make: "Toyota", model: "Camry", year: 2021}
]

vehicles = Enum.map(vehicles_data, fn vehicle_attrs ->
  {:ok, vehicle} =
    WebHost.Fleet.Vehicle
    |> Ash.Changeset.for_create(:create, Map.put(vehicle_attrs, :customer_id, customer.id))
    |> Ash.create!()
  
  IO.puts("✓ Created vehicle: #{vehicle.name}")
  vehicle
end)

# Create demo driver
{:ok, driver} =
  WebHost.Fleet.Driver
  |> Ash.Changeset.for_create(:create, %{
    customer_id: customer.id,
    name: "John Driver",
    email: "john@demologistics.com",
    phone: "+1-555-0123",
    license_number: "DL123456"
  })
  |> Ash.create!()

IO.puts("✓ Created driver: #{driver.name}")

# Assign driver to first vehicle
{:ok, _} =
  List.first(vehicles)
  |> Ash.Changeset.for_update(:assign_driver, %{driver_id: driver.id})
  |> Ash.update!()

IO.puts("✓ Assigned driver to vehicle")

# Create sample GPS positions for first vehicle
vehicle = List.first(vehicles)
base_time = DateTime.utc_now() |> DateTime.add(-3600, :second)  # 1 hour ago

# Simulate a route: San Antonio to Austin (rough coordinates)
route_points = [
  {29.4241, -98.4936},  # San Antonio
  {29.5244, -98.4404},  # North SA
  {29.8719, -97.9406},  # San Marcos
  {30.2672, -97.7431}   # Austin
]

Enum.with_index(route_points, fn {lat, lng}, idx ->
  time_offset = idx * 20 * 60  # 20 minutes between points
  
  WebHost.Tracking.GpsPosition
  |> Ash.Changeset.for_create(:create, %{
    customer_id: customer.id,
    vehicle_id: vehicle.id,
    time: DateTime.add(base_time, time_offset, :second),
    latitude: Decimal.from_float(lat),
    longitude: Decimal.from_float(lng),
    speed: Decimal.from_float(65.5),
    heading: Decimal.from_float(0.0),
    accuracy: Decimal.from_float(10.0)
  })
  |> Ash.create!()
end)

IO.puts("✓ Created #{length(route_points)} GPS positions")

# Create demo geofence (circle around Austin)
{:ok, geofence} =
  WebHost.Spatial.Geofence
  |> Ash.Changeset.for_create(:create, %{
    customer_id: customer.id,
    name: "Austin Warehouse",
    fence_type: :circle,
    center_lat: Decimal.from_float(30.2672),
    center_lng: Decimal.from_float(-97.7431),
    radius_meters: 5000,  # 5km radius
    alert_on_enter: true,
    alert_on_exit: true
  })
  |> Ash.create!()

IO.puts("✓ Created geofence: #{geofence.name}")

IO.puts("\n=== Seed data created successfully ===")
IO.puts("Admin: admin@webhost.systems / SecurePassword123!")
IO.puts("API Key: #{api_key.key}")
IO.puts("Customer: #{customer.slug}")
IO.puts("Vehicles: #{length(vehicles)}")
IO.puts("GPS Points: #{length(route_points)}")
```

Run seeds:

```bash
mix run priv/repo/seeds.exs
```

---

## Testing Multi-Tenancy

Create `test/webhost/fleet/vehicle_test.exs`:

```elixir
defmodule WebHost.Fleet.VehicleTest do
  use WebHost.DataCase
  import WebHost.TestHelpers

  describe "multi-tenancy" do
    test "customer can only read their own vehicles" do
      customer1 = create_customer(%{slug: "customer1"})
      customer2 = create_customer(%{slug: "customer2"})

      # Create vehicles for both customers
      {:ok, vehicle1} = create_vehicle(customer1.id, %{name: "Customer 1 Vehicle"})
      {:ok, vehicle2} = create_vehicle(customer2.id, %{name: "Customer 2 Vehicle"})

      # Customer 1 can only see their vehicle
      vehicles = 
        WebHost.Fleet.Vehicle
        |> Ash.Query.for_read(:read, tenant: customer1.id)
        |> Ash.read!()

      assert length(vehicles) == 1
      assert hd(vehicles).id == vehicle1.id

      # Customer 2 can only see their vehicle
      vehicles = 
        WebHost.Fleet.Vehicle
        |> Ash.Query.for_read(:read, tenant: customer2.id)
        |> Ash.read!()

      assert length(vehicles) == 1
      assert hd(vehicles).id == vehicle2.id
    end

    test "cannot query without tenant" do
      # This should raise an error
      assert_raise Ash.Error.Forbidden, fn ->
        WebHost.Fleet.Vehicle
        |> Ash.Query.for_read(:read)  # No tenant!
        |> Ash.read!()
      end
    end

    test "GPS positions are isolated by tenant" do
      customer1 = create_customer(%{slug: "customer1"})
      customer2 = create_customer(%{slug: "customer2"})

      vehicle1 = create_vehicle(customer1.id, %{name: "V1"})
      vehicle2 = create_vehicle(customer2.id, %{name: "V2"})

      # Create GPS positions
      create_gps_position(customer1.id, vehicle1.id)
      create_gps_position(customer2.id, vehicle2.id)

      # Customer 1 can only see their GPS data
      positions = 
        WebHost.Tracking.GpsPosition
        |> Ash.Query.for_read(:read, tenant: customer1.id)
        |> Ash.read!()

      assert length(positions) == 1
      assert hd(positions).customer_id == customer1.id
    end
  end

  describe "GPS tracking" do
    test "creates GPS position with all fields" do
      customer = create_customer()
      vehicle = create_vehicle(customer.id)

      {:ok, position} =
        WebHost.Tracking.GpsPosition
        |> Ash.Changeset.for_create(:create, %{
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          latitude: Decimal.new("29.4241"),
          longitude: Decimal.new("-98.4936"),
          speed: Decimal.new("65.5"),
          heading: Decimal.new("180.0"),
          accuracy: Decimal.new("10.0")
        })
        |> Ash.create!()

      assert position.latitude == Decimal.new("29.4241")
      assert position.vehicle_id == vehicle.id
    end

    test "queries recent positions" do
      customer = create_customer()
      vehicle = create_vehicle(customer.id)

      # Create positions over last hour
      for i <- 1..5 do
        create_gps_position(
          customer.id, 
          vehicle.id,
          DateTime.utc_now() |> DateTime.add(-i * 600, :second)  # Every 10 min
        )
      end

      positions =
        WebHost.Tracking.GpsPosition
        |> Ash.Query.for_read(:recent_positions, %{
          vehicle_id: vehicle.id
        }, tenant: customer.id)
        |> Ash.read!()

      assert length(positions) == 5
    end
  end

  describe "geofencing" do
    test "creates circular geofence" do
      customer = create_customer()

      {:ok, geofence} =
        WebHost.Spatial.Geofence
        |> Ash.Changeset.for_create(:create, %{
          customer_id: customer.id,
          name: "Warehouse Zone",
          fence_type: :circle,
          center_lat: Decimal.new("30.2672"),
          center_lng: Decimal.new("-97.7431"),
          radius_meters: 5000
        })
        |> Ash.create!()

      assert geofence.name == "Warehouse Zone"
      assert geofence.radius_meters == 5000
    end
  end
end
```

Create `test/support/test_helpers.ex`:

```elixir
defmodule WebHost.TestHelpers do
  def create_customer(attrs \\ %{}) do
    defaults = %{
      name: "Test Customer #{:rand.uniform(9999)}",
      slug: "test-#{:rand.uniform(9999)}",
      email: "test#{:rand.uniform(9999)}@example.com"
    }

    WebHost.Accounts.Customer
    |> Ash.Changeset.for_create(:create, Map.merge(defaults, attrs))
    |> Ash.create!()
  end

  def create_vehicle(customer_id, attrs \\ %{}) do
    defaults = %{
      customer_id: customer_id,
      name: "Test Vehicle #{:rand.uniform(9999)}",
      vehicle_identifier: "VEH-#{:rand.uniform(9999)}",
      vehicle_type: :car
    }

    WebHost.Fleet.Vehicle
    |> Ash.Changeset.for_create(:create, Map.merge(defaults, attrs))
    |> Ash.create!()
  end

  def create_gps_position(customer_id, vehicle_id, time \\ nil) do
    WebHost.Tracking.GpsPosition
    |> Ash.Changeset.for_create(:create, %{
      customer_id: customer_id,
      vehicle_id: vehicle_id,
      time: time || DateTime.utc_now(),
      latitude: Decimal.from_float(29.4241 + :rand.uniform() * 0.1),
      longitude: Decimal.from_float(-98.4936 + :rand.uniform() * 0.1),
      speed: Decimal.from_float(50.0 + :rand.uniform() * 30)
    })
    |> Ash.create!()
  end
end
```

Run tests:

```bash
mix test
```

---

## Verification Checklist

- [ ] All resources compile without errors
- [ ] Migrations run successfully
- [ ] TimescaleDB hypertable created for gps_positions
- [ ] PostGIS geometry column and index created for geofences
- [ ] Seed data creates successfully
- [ ] Multi-tenancy tests pass
- [ ] Can query vehicles by tenant
- [ ] Can query GPS positions by tenant
- [ ] Cannot query without tenant (raises error)
- [ ] Geofence creation works
- [ ] All tests pass: `mix test`

---

## GraphQL Testing

Test the auto-generated GraphQL API:

```bash
# Start server
mix phx.server

# Visit GraphiQL
open http://localhost:4000/api/graphql/graphiql
```

**Example queries:**

```graphql
# Get all vehicles for a customer (requires auth)
query {
  vehicles {
    id
    name
    vehicleIdentifier
    vehicleType
    status
    driver {
      name
      email
    }
    latestPosition {
      latitude
      longitude
      time
    }
  }
}

# Get recent GPS positions
query {
  gpsPositions {
    id
    time
    latitude
    longitude
    speed
    heading
    vehicle {
      name
    }
  }
}

# Get active geofences
query {
  activeGeofences {
    id
    name
    fenceType
    centerLat
    centerLng
    radiusMeters
    alertOnEnter
    alertOnExit
  }
}

# Create a vehicle (requires auth)
mutation {
  createVehicle(input: {
    name: "Truck 05"
    vehicleIdentifier: "TRK-005"
    vehicleType: TRUCK
    make: "Ford"
    model: "F-250"
    year: 2023
  }) {
    result {
      id
      name
      vehicleIdentifier
    }
    errors {
      message
    }
  }
}
```

---

## Common Issues & Solutions

### Issue: Multi-tenancy not working
**Solution:** Ensure you're passing `tenant: customer_id` in every query

### Issue: TimescaleDB hypertable creation fails
**Solution:** Verify TimescaleDB extension is loaded: `mix run -e "WebHost.Repo.verify_extensions()"`

### Issue: PostGIS geometry column errors
**Solution:** Ensure PostGIS extension is loaded and geometry type is correct

### Issue: Ash policy errors
**Solution:** Check actor is set correctly: `Ash.Query.for_read(:read, actor: user, tenant: customer_id)`

---

## Key Architecture Benefits

✅ **Multi-tenancy is automatic** - Cannot accidentally query another customer's data
✅ **TimescaleDB handles millions of GPS points** - Automatic compression and retention
✅ **PostGIS enables sub-50ms geofence checks** - With proper spatial indexes
✅ **Authorization is declarative** - Policies enforced everywhere automatically
✅ **APIs auto-generated** - GraphQL + REST with zero boilerplate
✅ **Type-safe** - Compile-time errors for missing tenant

---

## Next Steps

Once Phase 1 is complete, proceed to **Phase 2: Authentication & Yjs Sync Integration**.

---

## Estimated Time
- Resource definition: 4 hours
- Migration setup (TimescaleDB + PostGIS): 2 hours
- Testing & verification: 2 hours
- **Total: 8 hours**

**You now have a fully multi-tenant GPS tracking platform with TimescaleDB and PostGIS ready for Yjs sync integration!** 🚀