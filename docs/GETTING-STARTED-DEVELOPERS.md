# Getting Started Guide for Developers

Welcome to WebHost Systems! This guide will help you get up and running with the development environment and understand the codebase structure.

## 🎯 Overview

WebHost Systems is a multi-tenant GPS tracking platform built with:
- **Backend**: Elixir + Phoenix + Ash Framework
- **Database**: PostgreSQL + TimescaleDB + PostGIS
- **Frontend**: Phoenix LiveView + JavaScript SDK
- **Infrastructure**: Hybrid Hetzner + Fly.io deployment
- **Real-time Sync**: Yjs CRDT with WebSocket connections

## 🚀 Quick Start (15 minutes)

### Prerequisites

```bash
# Required software versions
Elixir >= 1.15
Erlang >= 26
PostgreSQL >= 14 with TimescaleDB and PostGIS extensions
Node.js >= 18 (for frontend assets)
Git
```

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/c-u-l8er/WebHost.Systems.git
cd webhost-systems

# Install Elixir dependencies
mix deps.get

# Install Node.js dependencies
cd assets && npm install && cd ..

# Copy environment configuration
cp .env.example .env.local
```

### 2. Database Setup

```bash
# Start PostgreSQL with required extensions
# (See HETZNER-SETUP-GUIDE.md for detailed setup)

# Create and migrate database
mix ecto.create
mix ecto.migrate

# Load seed data
mix run priv/repo/seeds.exs
```

### 3. Start Development Server

```bash
# Start Phoenix server
mix phx.server

# Or start with IEx console
iex -S mix phx.server
```

Visit `http://localhost:4000` to see the application!

## 📁 Project Structure

```
webhost-systems/
├── lib/                          # Application code
│   ├── webhost/                  # Main application
│   │   ├── accounts/             # User management
│   │   ├── billing/              # Subscription management
│   │   ├── fleet/                # Vehicle management
│   │   ├── tracking/             # GPS tracking
│   │   ├── spatial/              # Geofencing
│   │   ├── infrastructure/       # Infrastructure management
│   │   └── web/                  # Web interface
│   └── webhost_web/              # Phoenix web layer
├── priv/                         # Private files
│   ├── repo/                     # Database migrations
│   └── static/                   # Static assets
├── assets/                       # Frontend assets
├── scripts/                      # Utility scripts
├── docs/                         # Documentation
└── test/                         # Test files
```

## 🏗️ Core Concepts

### Multi-Tenancy with Ash Framework

WebHost uses **attribute-based multi-tenancy** - every customer's data is isolated:

```elixir
# All customer data resources have multi-tenancy
multitenancy do
  strategy :attribute
  attribute :customer_id
end

# Query syntax (tenant is required!)
Resource
|> Ash.Query.for_read(:read, tenant: customer_id)
|> Ash.read!()
```

### TimescaleDB for GPS Data

GPS positions are stored in TimescaleDB hypertables for optimal performance:

```elixir
# GPS positions are automatically partitioned by time
# Queries are optimized for time-series data
positions = GpsPosition
|> Ash.Query.for_read(:in_time_range, %{
  vehicle_id: vehicle.id,
  start_time: DateTime.add(DateTime.utc_now(), -24, :hour),
  end_time: DateTime.utc_now()
}, tenant: customer.id)
|> Ash.read!()
```

### PostGIS for Geofencing

Spatial queries use PostGIS for high-performance geofence checks:

```elixir
# Check if vehicle is within geofence
within_fence = Geofence
|> Ash.Query.for_read(:contains_point, %{
  latitude: vehicle.latest_position.latitude,
  longitude: vehicle.latest_position.longitude
}, tenant: customer.id)
|> Ash.read!()
```

### Yjs Real-time Sync

Real-time collaboration uses Yjs CRDTs with WebSocket sync:

```elixir
# WebSocket channel for sync
defmodule WebHostWeb.SyncChannel do
  use Phoenix.Channel

  def join("sync:" <> customer_id, _params, socket) do
    {:ok, assign(socket, :customer_id, customer_id)}
  end

  def handle_in("sync_update", %{"update" => update}, socket) do
    # Broadcast Yjs update to all clients
    broadcast!(socket, "sync_update", %{"update" => update})
    {:noreply, socket}
  end
end
```

## 🔧 Development Workflow

### 1. Adding New Resources

```bash
# Generate new Ash resource
mix ash.gen.resource Fleet.Vehicle

# Create migration
mix ash_postgres.generate_migrations --name add_vehicle

# Run migration
mix ecto.migrate

# Add tests
touch test/webhost/fleet/vehicle_test.exs
```

### 2. Testing

```bash
# Run all tests
mix test

# Run specific test file
mix test test/webhost/fleet/vehicle_test.exs

# Run with coverage
mix test --cover

# Run only unit tests
mix test --only unit
```

### 3. Database Operations

```bash
# Create new migration
mix ecto.gen.migration add_new_feature

# Rollback migration
mix ecto.rollback

# Reset database
mix ecto.reset

# Drop database
mix ecto.drop
```

### 4. Code Quality

```bash
# Format code
mix format

# Check code quality
mix credo

# Check for security issues
mix sobelow

# Run dialyzer (type checking)
mix dialyzer
```

## 📱 Frontend Development

### Phoenix LiveView

LiveView handles real-time UI updates:

```elixir
defmodule WebHostWeb.DashboardLive do
  use WebHostWeb, :live_view

  def mount(_params, _session, socket) do
    {:ok, socket |> assign(:vehicles, load_vehicles())}
  end

  def handle_info({:vehicle_update, vehicle}, socket) do
    {:noreply, socket |> update_vehicle(vehicle)}
  end
end
```

### JavaScript SDK

Customers use our NPM package for integration:

```javascript
import { WebHostClient } from '@webhost.systems/client';

const client = new WebHostClient({
  apiUrl: 'https://your-app.fly.dev',
  apiKey: 'your-api-key'
});

const db = await client.connect({
  vehicles: '++id, name, status'
});

// Real-time sync happens automatically!
await db.vehicles.add({
  name: 'Truck 01',
  status: 'active'
});
```

## 🔐 Authentication & Authorization

### API Key Authentication

```elixir
# API keys are used for external access
defmodule WebHostWeb.Plugs.ApiKeyAuth do
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> key] <- get_req_header(conn, "authorization"),
         {:ok, api_key} <- find_api_key(key) do
      assign(conn, :current_customer, api_key.customer)
    else
      _ -> send_resp(conn, 401, "Unauthorized") |> halt()
    end
  end
end
```

### Ash Policies

Authorization is handled by Ash policies:

```elixir
policies do
  policy action_type(:read) do
    authorize_if relates_to_actor_via(:customer)
  end

  policy action_type([:create, :update, :destroy]) do
    authorize_if relates_to_actor_via(:customer)
  end
end
```

## 📊 Monitoring & Debugging

### Logging

```elixir
# Structured logging
require Logger

Logger.info("Vehicle position received", %{
  vehicle_id: vehicle.id,
  latitude: position.latitude,
  longitude: position.longitude,
  customer_id: customer_id
})
```

### Telemetry

```elixir
# Custom telemetry events
:telemetry.execute([:webhost, :gps, :received], %{
  count: 1
}, %{
  customer_id: customer_id,
  vehicle_id: vehicle.id
})
```

### Debugging in IEx

```bash
# Start with IEx
iex -S mix phx.server

# Inspect Ash resources
WebHost.Accounts.Customer |> Ash.read!()

# Check query performance
WebHost.Fleet.Vehicle
|> Ash.Query.for_read(:read, tenant: customer_id)
|> Ash.Query.to_sql()
```

## 🚀 Deployment

### Local Development

```bash
# Build for production
mix release

# Start release
./_build/prod/rel/webhost/bin/webhost start
```

### Fly.io Deployment

```bash
# Deploy to Fly.io
fly deploy

# Check deployment status
fly status

# View logs
fly logs
```

### Hetzner Deployment

See [HETZNER-SETUP-GUIDE.md](HETZNER-SETUP-GUIDE.md) for complete Hetzner setup.

## 🧪 Testing Guidelines

### Unit Tests

```elixir
defmodule WebHost.Fleet.VehicleTest do
  use WebHost.DataCase
  import WebHost.TestHelpers

  test "creates vehicle with valid attributes" do
    customer = create_customer()
    
    attrs = %{
      customer_id: customer.id,
      name: "Test Vehicle",
      vehicle_identifier: "TEST-001",
      vehicle_type: :truck
    }

    assert {:ok, vehicle} = Fleet.Vehicle |> Ash.Changeset.for_create(:create, attrs) |> Ash.create()
    assert vehicle.name == "Test Vehicle"
  end
end
```

### Integration Tests

```elixir
defmodule WebHostWeb.VehicleAPITest do
  use WebHostWeb.ConnCase

  test "POST /api/vehicles creates vehicle" do
    conn = build_conn()
    |> put_req_header("authorization", "Bearer #{api_key.key}")
    |> post("/api/vehicles", %{name: "Test Vehicle", vehicle_identifier: "TEST-001"})

    assert json_response(conn, 201)["data"]["name"] == "Test Vehicle"
  end
end
```

## 📚 Learning Resources

### Essential Reading

1. **[PHASE0.md](PHASE0.md)** - Project foundation and setup
2. **[PHASE1.md](PHASE1.md)** - Core resources and multi-tenancy
3. **[PHASE2.md](PHASE2.md)** - Authentication and sync
4. **[ASH Framework Docs](https://ash-hq.org/)** - Framework documentation
5. **[Phoenix Docs](https://hexdocs.pm/phoenix/)** - Web framework

### Advanced Topics

1. **[ARCHITECTURE-UPDATE.md](ARCHITECTURE-UPDATE.md)** - Infrastructure decisions
2. **[ECONOMIC-ANALYSIS.md](ECONOMIC-ANALYSIS.md)** - Business context
3. **[DISASTER-RECOVERY.md](DISASTER-RECOVERY.md)** - Operations procedures

### External Resources

- [Ash Framework Guide](https://ash-hq.org/docs/guide)
- [Phoenix LiveView Tutorial](https://hexdocs.pm/phoenix_live_view/)
- [TimescaleDB Documentation](https://docs.timescale.com/)
- [PostGIS Manual](https://postgis.net/docs/)

## 🤝 Contributing

### Code Style

- Follow Elixir style guide
- Use `mix format` before committing
- Write tests for new features
- Update documentation for API changes

### Pull Request Process

1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Ensure all tests pass
5. Submit pull request with description

### Getting Help

- **Technical Questions**: Create GitHub issue
- **Architecture Decisions**: Discuss in issue first
- **Bug Reports**: Include reproduction steps
- **Documentation**: Update relevant docs

## 🔍 Common Issues

### Database Connection Errors

```elixir
# Check environment variables
Application.get_env(:webhost, WebHost.Repo)

# Verify database is running
mix ecto.ping
```

### Ash Policy Errors

```elixir
# Ensure tenant is set
Resource |> Ash.Query.for_read(:read, tenant: customer_id)

# Check actor is set
Resource |> Ash.Query.for_read(:read, actor: user, tenant: customer_id)
```

### Compilation Errors

```bash
# Clean and recompile
mix clean --deps
mix deps.get
mix compile
```

## 📈 Next Steps

1. **Complete PHASE0-6** implementation guides
2. **Review test suite** and add missing tests
3. **Study deployment guides** for target infrastructure
4. **Join community** discussions and contribute
5. **Build your first feature** following the patterns

---

**Happy coding!** 🚀

If you need help, check the [DOCUMENTATION-INDEX.md](DOCUMENTATION-INDEX.md) for comprehensive documentation navigation.