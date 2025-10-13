

## Generate Migrations

Now generate migrations from all these resources:

```bash
# Generate resource snapshots
mix ash.codegen initial_resources

# Generate migrations
mix ash_postgres.generate_migrations --name create_all_resources

# Create TimescaleDB hypertable (add to migration)
# Edit the migration file and add:
```

Edit `priv/repo/migrations/*_create_all_resources.exs`:

```elixir
defmodule WebHost.Repo.Migrations.CreateAllResources do
  use Ecto.Migration

  def up do
    # ... auto-generated table creation ...

    # Convert gps_positions to hypertable
    execute """
    SELECT create_hypertable('gps_positions', 'time',
      chunk_time_interval => INTERVAL '1 day');
    """

    # Add compression policy (compress data older than 7 days)
    execute """
    ALTER TABLE gps_positions SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'vehicle_id'
    );
    """

    execute """
    SELECT add_compression_policy('gps_positions', INTERVAL '7 days');
    """

    # Add retention policy (delete data older than 90 days)
    execute """
    SELECT add_retention_policy('gps_positions', INTERVAL '90 days');
    """

    # Create PostGIS spatial index
    execute """
    CREATE INDEX geo_points_location_idx ON geo_points USING GIST(location);
    """
  end

  def down do
    # ... auto-generated drop statements ...
  end
end
```

Run migrations:

```bash
mix ecto.migrate
```

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
    backend_instances: 1,
    frontend_apps: 5,
    custom_domains: 1,
    data_transfer_gb: 100,
    database_storage_gb: 1,
    redis_storage_gb: Decimal.new("1.0"),
    features: %{"support" => "email"}
  },
  %{
    name: "Starter",
    slug: "starter",
    price_monthly: 4900,
    backend_instances: 1,
    frontend_apps: 10,
    custom_domains: 3,
    data_transfer_gb: 500,
    database_storage_gb: 10,
    redis_storage_gb: Decimal.new("2.0"),
    features: %{"support" => "priority_email", "analytics" => true}
  },
  %{
    name: "Professional",
    slug: "professional",
    price_monthly: 14900,
    backend_instances: 3,
    frontend_apps: 50,
    custom_domains: 10,
    data_transfer_gb: 2000,
    database_storage_gb: 50,
    redis_storage_gb: Decimal.new("5.0"),
    features: %{"support" => "slack", "analytics" => true}
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
    name: "Demo Customer",
    slug: "demo",
    email: "demo@example.com",
    company_name: "Demo Corp"
  })
  |> Ash.create!()

IO.puts("✓ Created demo customer")

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

IO.puts("✓ Created subscription")

# Create API key for demo customer
{:ok, api_key} =
  WebHost.Accounts.ApiKey
  |> Ash.Changeset.for_create(:create, %{
    customer_id: customer.id,
    name: "Default Production Key",
    environment: :production,
    permissions: ["sync:read", "sync:write"]
  })
  |> Ash.create!()

IO.puts("✓ Created API key: #{api_key.key}")

IO.puts("\n=== Seed data created successfully ===")
IO.puts("Admin: admin@webhost.systems / SecurePassword123!")
IO.puts("API Key: #{api_key.key}")
```

Run seeds:

```bash
mix run priv/repo/seeds.exs
```

## Testing Resources

### test/support/ash_case.ex

```elixir
defmodule WebHost.AshCase do
  @moduledoc """
  Test case for Ash resources
  """
  use ExUnit.CaseTemplate

  using do
    quote do
      import WebHost.AshCase
    end
  end

  setup tags do
    WebHost.DataCase.setup_sandbox(tags)
    :ok
  end

  def create_platform_user(attrs \\ %{}) do
    defaults = %{
      email: "user#{System.unique_integer()}@example.com",
      password: "password123",
      password_confirmation: "password123",
      name: "Test User"
    }

    WebHost.Accounts.PlatformUser
    |> Ash.Changeset.for_create(:register, Map.merge(defaults, attrs))
    |> Ash.create!()
  end

  def create_customer(attrs \\ %{}) do
    defaults = %{
      name: "Test Customer",
      slug: "test-#{System.unique_integer()}",
      email: "customer#{System.unique_integer()}@example.com"
    }

    WebHost.Accounts.Customer
    |> Ash.Changeset.for_create(:create, Map.merge(defaults, attrs))
    |> Ash.create!()
  end

  def create_plan(attrs \\ %{}) do
    defaults = %{
      name: "Test Plan",
      slug: "test-#{System.unique_integer()}",
      price_monthly: 4900,
      backend_instances: 1,
      frontend_apps: 10,
      custom_domains: 3,
      data_transfer_gb: 500,
      database_storage_gb: 10,
      redis_storage_gb: Decimal.new("2.0")
    }

    WebHost.Billing.Plan
    |> Ash.Changeset.for_create(:create, Map.merge(defaults, attrs))
    |> Ash.create!()
  end
end
```

### test/webhost/accounts/customer_test.exs

```elixir
defmodule WebHost.Accounts.CustomerTest do
  use WebHost.AshCase
  alias WebHost.Accounts.Customer

  describe "create customer" do
    test "creates customer with valid attributes" do
      attrs = %{
        name: "Acme Corp",
        slug: "acme",
        email: "hello@acme.com"
      }

      assert {:ok, customer} =
        Customer
        |> Ash.Changeset.for_create(:create, attrs)
        |> Ash.create()

      assert customer.name == "Acme Corp"
      assert customer.slug == "acme"
      assert customer.status == :active
    end

    test "validates slug format" do
      attrs = %{
        name: "Bad Slug",
        slug: "Bad Slug!",
        email: "test@example.com"
      }

      assert {:error, changeset} =
        Customer
        |> Ash.Changeset.for_create(:create, attrs)
        |> Ash.create()

      assert changeset.errors != []
    end

    test "enforces unique slug" do
      create_customer(%{slug: "unique"})

      assert {:error, _} =
        Customer
        |> Ash.Changeset.for_create(:create, %{
          name: "Another",
          slug: "unique",
          email: "another@example.com"
        })
        |> Ash.create()
    end
  end

  describe "calculations" do
    test "trial_expired returns true when trial period ended" do
      customer = create_customer()
      plan = create_plan()

      # Create expired trial
      WebHost.Billing.Subscription
      |> Ash.Changeset.for_create(:create, %{
        customer_id: customer.id,
        plan_id: plan.id,
        status: :trialing,
        current_period_end: DateTime.utc_now() |> DateTime.add(-1, :day)
      })
      |> Ash.create!()

      customer = 
        Customer
        |> Ash.get!(customer.id)
        |> Ash.load!(:trial_expired)

      assert customer.trial_expired == true
    end
  end
end
```

### test/webhost/billing/subscription_test.exs

```elixir
defmodule WebHost.Billing.SubscriptionTest do
  use WebHost.AshCase
  alias WebHost.Billing.Subscription

  describe "subscription lifecycle" do
    test "creates subscription with trial" do
      customer = create_customer()
      plan = create_plan()

      attrs = %{
        customer_id: customer.id,
        plan_id: plan.id,
        status: :trialing,
        current_period_start: DateTime.utc_now(),
        current_period_end: DateTime.utc_now() |> DateTime.add(14, :day)
      }

      assert {:ok, subscription} =
        Subscription
        |> Ash.Changeset.for_create(:create, attrs)
        |> Ash.create()

      assert subscription.status == :trialing
    end

    test "cancel subscription" do
      customer = create_customer()
      plan = create_plan()

      {:ok, subscription} =
        Subscription
        |> Ash.Changeset.for_create(:create, %{
          customer_id: customer.id,
          plan_id: plan.id,
          status: :active
        })
        |> Ash.create()

      {:ok, cancelled} =
        subscription
        |> Ash.Changeset.for_update(:cancel)
        |> Ash.update()

      assert cancelled.status == :cancelled
      assert cancelled.cancel_at_period_end == true
    end

    test "calculates days remaining" do
      customer = create_customer()
      plan = create_plan()

      {:ok, subscription} =
        Subscription
        |> Ash.Changeset.for_create(:create, %{
          customer_id: customer.id,
          plan_id: plan.id,
          current_period_end: DateTime.utc_now() |> DateTime.add(10, :day)
        })
        |> Ash.create()

      subscription = Ash.load!(subscription, :days_remaining)

      assert subscription.days_remaining == 10
    end
  end
end
```

### test/webhost/tracking/gps_position_test.exs

```elixir
defmodule WebHost.Tracking.GpsPositionTest do
  use WebHost.AshCase
  alias WebHost.Tracking.GpsPosition

  describe "GPS position tracking" do
    test "creates GPS position" do
      customer = create_customer()

      attrs = %{
        customer_id: customer.id,
        vehicle_id: Ash.UUID.generate(),
        latitude: Decimal.new("29.4241"),
        longitude: Decimal.new("-98.4936"),
        speed: Decimal.new("65.5"),
        heading: Decimal.new("180")
      }

      assert {:ok, position} =
        GpsPosition
        |> Ash.Changeset.for_create(:create, attrs)
        |> Ash.create()

      assert position.latitude == Decimal.new("29.4241")
      assert position.time
    end

    test "queries recent positions" do
      customer = create_customer()
      vehicle_id = Ash.UUID.generate()

      # Create positions
      for i <- 1..5 do
        GpsPosition
        |> Ash.Changeset.for_create(:create, %{
          customer_id: customer.id,
          vehicle_id: vehicle_id,
          latitude: Decimal.new("29.#{i}"),
          longitude: Decimal.new("-98.#{i}"),
          time: DateTime.utc_now() |> DateTime.add(-i * 60, :second)
        })
        |> Ash.create!()
      end

      positions =
        GpsPosition
        |> Ash.Query.for_read(:recent_positions, %{vehicle_id: vehicle_id})
        |> Ash.read!()

      assert length(positions) == 5
    end
  end
end
```

### test/webhost/spatial/geo_point_test.exs

```elixir
defmodule WebHost.Spatial.GeoPointTest do
  use WebHost.AshCase
  alias WebHost.Spatial.GeoPoint

  describe "spatial queries" do
    test "creates geo point with PostGIS" do
      customer = create_customer()

      attrs = %{
        customer_id: customer.id,
        name: "Office Location",
        latitude: Decimal.new("29.4241"),
        longitude: Decimal.new("-98.4936"),
        properties: %{"type" => "office"}
      }

      assert {:ok, point} =
        GeoPoint
        |> Ash.Changeset.for_create(:create, attrs)
        |> Ash.create()

      assert point.location.coordinates == {-98.4936, 29.4241}
    end

    test "finds points within radius" do
      customer = create_customer()

      # Create points
      GeoPoint
      |> Ash.Changeset.for_create(:create, %{
        customer_id: customer.id,
        name: "Close Point",
        latitude: Decimal.new("29.4241"),
        longitude: Decimal.new("-98.4936")
      })
      |> Ash.create!()

      GeoPoint
      |> Ash.Changeset.for_create(:create, %{
        customer_id: customer.id,
        name: "Far Point",
        latitude: Decimal.new("30.2672"),
        longitude: Decimal.new("-97.7431")
      })
      |> Ash.create!()

      # Query within 5km of first point
      nearby =
        GeoPoint
        |> Ash.Query.for_read(:within_radius, %{
          center_lat: Decimal.new("29.4241"),
          center_lng: Decimal.new("-98.4936"),
          radius_meters: 5000
        })
        |> Ash.read!()

      assert length(nearby) == 1
      assert hd(nearby).name == "Close Point"
    end
  end
end
```

## GraphQL Testing

Test GraphQL API with GraphiQL at http://localhost:4000/api/graphql/graphiql

### Example Queries

```graphql
# Get all plans
query {
  plans {
    id
    name
    slug
    priceMonthly
    features
    subscriberCount
  }
}

# Get customer with relationships
query {
  customer(id: "customer-uuid") {
    name
    email
    trialExpired
    subscription {
      status
      plan {
        name
      }
      daysRemaining
    }
    deployments {
      status
      apiUrl
      healthStatus
    }
  }
}

# Create customer
mutation {
  createCustomer(input: {
    name: "New Corp"
    slug: "newcorp"
    email: "hello@newcorp.com"
  }) {
    result {
      id
      name
      slug
    }
  }
}
```

## JSON:API Testing

Test REST API:

```bash
# Get all plans
curl http://localhost:4000/api/json/plans

# Get customer
curl http://localhost:4000/api/json/customers/{id} \
  -H "Authorization: Bearer {api_key}"

# Create customer
curl -X POST http://localhost:4000/api/json/customers \
  -H "Content-Type: application/vnd.api+json" \
  -H "Authorization: Bearer {admin_token}" \
  -d '{
    "data": {
      "type": "customer",
      "attributes": {
        "name": "Test Corp",
        "slug": "testcorp",
        "email": "test@corp.com"
      }
    }
  }'
```

## Verification Checklist

- [ ] All resources compile without errors
- [ ] Migrations run successfully
- [ ] TimescaleDB hypertable created for gps_positions
- [ ] PostGIS spatial index created for geo_points
- [ ] Seed data creates successfully
- [ ] GraphQL API accessible at /api/graphql/graphiql
- [ ] JSON:API routes work
- [ ] All tests pass: `mix test`
- [ ] Resource calculations work
- [ ] Resource policies enforce authorization
- [ ] Relationships load correctly

## Run Tests

```bash
# Run all tests
mix test

# Run with coverage
mix test --cover

# Run specific test file
mix test test/webhost/accounts/customer_test.exs

# Run tests matching pattern
mix test --only gps
```

## Common Issues & Solutions

### Issue: Ash compilation errors about missing functions
**Solution:** Run `mix deps.compile ash --force`

### Issue: Migration fails with "hypertable already exists"
**Solution:** Drop and recreate database: `mix ecto.reset`

### Issue: PostGIS functions not found
**Solution:** Ensure postgis extension is loaded in init.sql

### Issue: GraphQL schema errors
**Solution:** Ensure all resources are in domain's `resources` block

### Issue: Can't query relationships
**Solution:** Use `Ash.load!/2` to load relationships

## Key Differences from Vanilla Ecto

| Aspect | Vanilla Ecto | Ash Framework |
|--------|--------------|---------------|
| **Schemas** | Ecto.Schema | Ash.Resource |
| **Changesets** | Manual | Declarative actions |
| **Queries** | Ecto.Query | Ash.Query |
| **APIs** | Manual controllers | Auto-generated GraphQL/REST |
| **Authorization** | Plugs/guards | Declarative policies |
| **Multi-tenancy** | Manual scoping | Built-in `tenant:` param |
| **Calculations** | Virtual fields | Declarative calculations |
| **Aggregates** | Manual queries | Declarative aggregates |

## Benefits Realized

✅ **No controller boilerplate** - GraphQL and REST auto-generated
✅ **No JSON serializers** - Handled by Ash extensions
✅ **Declarative authorization** - Policies instead of plugs
✅ **Type-safe** - Compile-time checks on resources
✅ **TimescaleDB integration** - Hypertables via AshPostgres
✅ **PostGIS integration** - Spatial queries via AshPostgis
✅ **Multi-tenancy ready** - Built into framework
✅ **Audit logging ready** - Add AshPaperTrail extension

## Next Steps

Proceed to Phase 2: Authentication & Authorization with Ash

## Estimated Time
- Resource definition: 4 hours
- Testing setup: 2 hours
- Migrations & seeds: 1 hour
- GraphQL/API testing: 1 hour
- **Total: 8 hours** (vs 16 hours without Ash)

## Code Reduction

**Lines of code comparison:**

| Component | Without Ash | With Ash | Reduction |
|-----------|-------------|----------|-----------|
| Models | ~800 lines | ~600 lines | 25% |
| Controllers | ~400 lines | 0 lines | 100% |
| JSON Views | ~300 lines | 0 lines | 100% |
| GraphQL | ~500 lines | ~50 lines | 90% |
| **Total** | **~2000** | **~650** | **67%**

You wrote **67% less code** using Ash Framework! 🎉# Phase 1: WebHost Core Resources with Ash Framework

## Overview
Define all core Ash resources for WebHost platform including accounts, billing, infrastructure, tracking (TimescaleDB), and spatial data (PostGIS). Ash resources replace traditional Ecto schemas and provide auto-generated APIs, validations, and authorization.

## Goals
- Define Ash resources for all domain entities
- Configure multi-tenancy
- Set up resource relationships
- Implement calculations and aggregates
- Define actions and policies
- Generate and run migrations

## Resource Overview

```
Domains:
├── Accounts (7 resources)
│   ├── PlatformUser (staff)
│   ├── Customer (tenants)
│   ├── CustomerUser
│   └── ApiKey
├── Billing (2 resources)
│   ├── Plan
│   └── Subscription
├── Infrastructure (2 resources)
│   ├── Deployment
│   └── FrontendApp
├── Tracking (2 resources - TimescaleDB)
│   ├── GpsPosition
│   └── UsageMetric
└── Spatial (2 resources - PostGIS)
    ├── GeoPoint
    └── GeoPolygon
```

## Accounts Domain Resources

### 1. Platform User (Staff)

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
      end
    end

    tokens do
      enabled? true
      token_resource WebHost.Accounts.Token
      signing_secret fn _, _ ->
        Application.fetch_env(:webhost, :token_signing_secret)
      end
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

    attribute :name, :string do
      public? true
    end

    attribute :role, :atom do
      allow_nil? false
      default :staff
      constraints one_of: [:admin, :staff]
      public? true
    end

    attribute :active, :boolean do
      default true
      public? true
    end

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

    create :register do
      accept [:email, :name]
      argument :password, :string, allow_nil?: false, sensitive?: true
      argument :password_confirmation, :string, allow_nil?: false, sensitive?: true

      validate confirm(:password, :password_confirmation)

      change AshAuthentication.Strategy.Password.HashPasswordChange
      change set_attribute(:active, true)
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
      authorize_if actor_present()
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if actor_attribute_equals(:role, :admin)
    end
  end

  graphql do
    type :platform_user

    queries do
      get :platform_user, :read
      read_one :current_platform_user, :read
    end

    mutations do
      create :register_platform_user, :register
      update :update_platform_user, :update
    end
  end
end
```

### 2. Customer (Multi-Tenant)

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
    attribute :support_email, :ci_string, public?: true

    attribute :status, :atom do
      allow_nil? false
      default :active
      constraints one_of: [:active, :suspended, :cancelled]
      public? true
    end

    attribute :onboarding_completed, :boolean do
      default false
      public? true
    end
    
    attribute :stripe_customer_id, :string, public?: true
    
    attribute :settings, :map do
      default %{}
      public? true
    end

    attribute :metadata, :map do
      default %{}
      public? true
    end

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    has_one :subscription, WebHost.Billing.Subscription
    has_many :deployments, WebHost.Infrastructure.Deployment
    has_many :api_keys, WebHost.Accounts.ApiKey
    has_many :customer_users, WebHost.Accounts.CustomerUser
    has_many :frontend_apps, WebHost.Infrastructure.FrontendApp
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

    calculate :days_until_trial_end, :integer do
      calculation fn records, _context ->
        records
        |> Ash.load!(:subscription)
        |> Enum.map(fn customer ->
          case customer.subscription do
            %{status: :trialing, current_period_end: end_date} ->
              Date.diff(DateTime.to_date(end_date), Date.utc_today())
            _ ->
              0
          end
        end)
      end
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:name, :slug, :email, :company_name, :billing_email, :support_email, :settings]
      
      validate present([:name, :slug, :email])
      validate match(:slug, ~r/^[a-z0-9-]+$/)
    end

    update :update do
      accept [:name, :company_name, :billing_email, :support_email, :status, :onboarding_completed, :settings, :metadata]
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

  validations do
    validate present(:name)
    validate present(:email)
    validate match(:slug, ~r/^[a-z0-9-]+$/)
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

### 3. API Key

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

  attributes do
    uuid_primary_key :id

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

    attribute :permissions, {:array, :string} do
      default []
      public? true
    end

    attribute :last_used_at, :utc_datetime, public?: true
    attribute :expires_at, :utc_datetime, public?: true
    attribute :revoked_at, :utc_datetime, public?: true
    
    attribute :active, :boolean do
      default true
      public? true
    end

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:name, :environment, :permissions]
      argument :customer_id, :uuid, allow_nil?: false

      change relate_actor(:customer)
      change fn changeset, _context ->
        # Generate API key
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

## Billing Domain Resources

### 4. Plan

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
    attribute :backend_instances, :integer, default: 1, public?: true
    attribute :frontend_apps, :integer, default: 5, public?: true
    attribute :custom_domains, :integer, default: 1, public?: true
    attribute :data_transfer_gb, :integer, default: 100, public?: true
    attribute :database_storage_gb, :integer, default: 1, public?: true
    attribute :redis_storage_gb, :decimal, default: Decimal.new("1.0"), public?: true

    # Features
    attribute :features, :map do
      default %{}
      public? true
    end

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

    sum :total_monthly_revenue, :subscriptions, :plan_price do
      filter expr(status == :active)
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [
        :name, :slug, :price_monthly, :price_yearly,
        :backend_instances, :frontend_apps, :custom_domains,
        :data_transfer_gb, :database_storage_gb, :redis_storage_gb,
        :features, :stripe_price_id
      ]
    end

    update :update do
      accept [
        :name, :price_monthly, :price_yearly,
        :backend_instances, :frontend_apps, :custom_domains,
        :data_transfer_gb, :database_storage_gb, :redis_storage_gb,
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

### 5. Subscription

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
    
    attribute :addons, :map do
      default %{}
      public? true
    end

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
    end

    belongs_to :plan, WebHost.Billing.Plan do
      allow_nil? false
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

    calculate :plan_price, :integer do
      calculation fn records, _context ->
        records
        |> Ash.load!(:plan)
        |> Enum.map(fn sub ->
          case sub.billing_cycle do
            :monthly -> sub.plan.price_monthly
            :yearly -> sub.plan.price_yearly || sub.plan.price_monthly * 12
          end
        end)
      end
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:status, :billing_cycle, :current_period_start, :current_period_end, :addons]
      argument :customer_id, :uuid, allow_nil?: false
      argument :plan_id, :uuid, allow_nil?: false

      change manage_relationship(:customer_id, :customer, type: :append)
      change manage_relationship(:plan_id, :plan, type: :append)
    end

    update :update do
      accept [:status, :billing_cycle, :current_period_end, :cancel_at_period_end, :addons, :stripe_subscription_id]
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
    end
  end
end
```

## Infrastructure Domain Resources

### 6. Deployment

Create `lib/webhost/infrastructure/deployment.ex`:

```elixir
defmodule WebHost.Infrastructure.Deployment do
  use Ash.Resource,
    domain: WebHost.Infrastructure,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshGraphql.Resource, AshJsonApi.Resource]

  postgres do
    table "deployments"
    repo WebHost.Repo
  end

  attributes do
    uuid_primary_key :id

    # Fly.io details
    attribute :fly_app_name, :string, public?: true
    attribute :fly_app_id, :string, public?: true
    attribute :fly_region, :string, default: "dfw", public?: true

    # Database details
    attribute :database_name, :string, public?: true
    attribute :database_url, :string, sensitive?: true
    attribute :database_size_gb, :decimal, public?: true

    # Redis details
    attribute :redis_name, :string, public?: true
    attribute :redis_url, :string, sensitive?: true

    # Cloudflare details
    attribute :cloudflare_pages_project_id, :string, public?: true
    attribute :cloudflare_pages_url, :string, public?: true

    # Status
    attribute :status, :atom do
      allow_nil? false
      default :provisioning
      constraints one_of: [:provisioning, :active, :failed, :suspended]
      public?: true
    end

    attribute :provisioned_at, :utc_datetime, public?: true
    attribute :last_health_check, :utc_datetime, public?: true
    attribute :health_status, :atom, constraints: [one_of: [:healthy, :unhealthy, :unknown]], public?: true

    attribute :config, :map, default: %{}, public?: true
    attribute :metadata, :map, default: %{}, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
    end

    has_many :frontend_apps, WebHost.Infrastructure.FrontendApp
  end

  calculations do
    calculate :api_url, :string do
      calculation fn records, _context ->
        Enum.map(records, fn deployment ->
          if deployment.fly_app_name do
            "https://#{deployment.fly_app_name}.fly.dev"
          else
            nil
          end
        end)
      end
    end

    calculate :is_healthy, :boolean do
      calculation fn records, _context ->
        Enum.map(records, fn deployment ->
          deployment.status == :active and deployment.health_status == :healthy
        end)
      end
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:fly_region, :config]
      argument :customer_id, :uuid, allow_nil?: false

      change manage_relationship(:customer_id, :customer, type: :append)
      change set_attribute(:status, :provisioning)
    end

    update :update do
      accept [
        :fly_app_name, :fly_app_id, :database_name, :database_url,
        :database_size_gb, :redis_name, :redis_url,
        :cloudflare_pages_project_id, :cloudflare_pages_url,
        :status, :provisioned_at, :last_health_check, :health_status,
        :config, :metadata
      ]
    end

    update :mark_provisioned do
      accept []
      change set_attribute(:status, :active)
      change set_attribute(:provisioned_at, &DateTime.utc_now/0)
      change set_attribute(:health_status, :healthy)
    end

    update :mark_failed do
      accept [:metadata]
      change set_attribute(:status, :failed)
    end

    update :update_health do
      argument :health_status, :atom, allow_nil?: false
      
      change set_attribute(:last_health_check, &DateTime.utc_now/0)
      change fn changeset, _context ->
        health = Ash.Changeset.get_argument(changeset, :health_status)
        Ash.Changeset.force_change_attribute(changeset, :health_status, health)
      end
    end
  end

  identities do
    identity :unique_fly_app_name, [:fly_app_name]
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via([:customer])
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if actor_attribute_equals(:role, :admin)
    end
  end

  graphql do
    type :deployment

    queries do
      get :deployment, :read
      list :deployments, :read
    end

    mutations do
      create :create_deployment, :create
      update :update_deployment, :update
    end
  end

  json_api do
    type "deployment"

    routes do
      base "/deployments"
      get :read
      index :read
    end
  end
end
```

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

    # TimescaleDB configuration
    custom_indexes do
      # Create hypertable after table creation
      index [:time], using: :btree
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :time, :utc_datetime_usec do
      allow_nil? false
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
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:time, :vehicle_id, :latitude, :longitude, :speed, :heading, :accuracy, :altitude, :metadata]
      argument :customer_id, :uuid, allow_nil?: false

      change manage_relationship(:customer_id, :customer, type: :append)
      change fn changeset, _context ->
        # Auto-set time if not provided
        if is_nil(Ash.Changeset.get_attribute(changeset, :time)) do
          Ash.Changeset.force_change_attribute(changeset, :time, DateTime.utc_now())
        else
          changeset
        end
      end
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
  end

  defp one_hour_ago do
    DateTime.utc_now() |> DateTime.add(-3600, :second)
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via([:customer])
    end

    policy action_type([:create, :destroy]) do
      authorize_if relates_to_actor_via([:customer])
    end
  end
end
```

## Spatial Domain Resources (PostGIS)

### 8. Geo Point (PostGIS)

Create `lib/webhost/spatial/geo_point.ex`:

```elixir
defmodule WebHost.Spatial.GeoPoint do
  use Ash.Resource,
    domain: WebHost.Spatial,
    data_layer: AshPostgres.DataLayer,
    extensions: [AshPostgis]

  postgres do
    table "geo_points"
    repo WebHost.Repo
  end

  postgis do
    # PostGIS configuration
  end

  attributes do
    uuid_primary_key :id

    attribute :name, :string do
      allow_nil? false
      public? true
    end

    # PostGIS geometry attribute
    attribute :location, AshPostgis.Point do
      allow_nil? false
      public? true
    end

    attribute :latitude, :decimal, public?: true
    attribute :longitude, :decimal, public?: true

    attribute :properties, :map, default: %{}, public?: true

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :customer, WebHost.Accounts.Customer do
      allow_nil? false
    end
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      accept [:name, :latitude, :longitude, :properties]
      argument :customer_id, :uuid, allow_nil?: false

      change manage_relationship(:customer_id, :customer, type: :append)
      
      # Create PostGIS point from lat/lng
      change fn changeset, _context ->
        lat = Ash.Changeset.get_attribute(changeset, :latitude)
        lng = Ash.Changeset.get_attribute(changeset, :longitude)
        
        if lat && lng do
          point = %Geo.Point{coordinates: {lng, lat}, srid: 4326}
          Ash.Changeset.force_change_attribute(changeset, :location, point)
        else
          changeset
        end
      end
    end

    update :update do
      accept [:name, :latitude, :longitude, :properties]
      
      # Update PostGIS point if lat/lng changed
      change fn changeset, _context ->
        lat = Ash.Changeset.get_attribute(changeset, :latitude)
        lng = Ash.Changeset.get_attribute(changeset, :longitude)
        
        if lat && lng do
          point = %Geo.Point{coordinates: {lng, lat}, srid: 4326}
          Ash.Changeset.force_change_attribute(changeset, :location, point)
        else
          changeset
        end
      end
    end

    read :within_radius do
      argument :center_lat, :decimal, allow_nil?: false
      argument :center_lng, :decimal, allow_nil?: false
      argument :radius_meters, :integer, allow_nil?: false

      # PostGIS spatial query
      prepare fn query, context ->
        lat = Ash.Query.get_argument(query, :center_lat)
        lng = Ash.Query.get_argument(query, :center_lng)
        radius = Ash.Query.get_argument(query, :radius_meters)
        
        center = %Geo.Point{coordinates: {lng, lat}, srid: 4326}
        
        # This will generate ST_DWithin query
        Ash.Query.filter(query, AshPostgis.Functions.st_dwithin(location, ^center, ^radius))
      end
    end
  end

  policies do
    policy action_type(:read) do
      authorize_if relates_to_actor_via([:customer])
    end

    policy action_type([:create, :update, :destroy]) do
      authorize_if relates_to_actor_via([:customer])
    end
  end
end
```