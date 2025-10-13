# Phase 0: WebHost Foundation with Ash Framework (Revised)

## Overview
Set up the foundational infrastructure for WebHost using Ash Framework, optimized for GPS tracking with TimescaleDB and PostGIS. This phase establishes the core technologies and project structure for a multi-tenant, offline-first GPS platform.

## Goals
- Initialize Phoenix project with Ash Framework
- Set up PostgreSQL with TimescaleDB and PostGIS
- Configure Ash domains and resources
- Establish multi-tenancy architecture
- Set up GraphQL and JSON:API
- **NEW:** Prepare for Yjs CRDT sync integration

## Prerequisites
- Elixir 1.15+
- PostgreSQL 14+ (with TimescaleDB and PostGIS)
- Node.js 18+
- Git
- Docker (for local development)

## Technology Stack

### Backend
- **Elixir 1.15+** - Functional programming language
- **Phoenix 1.7+** - Web framework
- **Ash 3.0+** - Resource-based framework with built-in multi-tenancy
- **AshPostgres** - PostgreSQL data layer
- **AshGraphql** - Auto-generated GraphQL API
- **AshJsonApi** - Auto-generated REST API
- **AshAuthentication** - Authentication system with multi-tenancy
- **AshOban** - Background jobs
- **PostgreSQL 14+** - Primary database
- **TimescaleDB Extension** - Time-series optimization for GPS data (REQUIRED)
- **PostGIS Extension** - Spatial data for geofencing (REQUIRED)
- **Redis** - Caching and real-time state

### Frontend (Dashboard)
- **Phoenix LiveView** - Real-time admin dashboard
- **TailwindCSS** - Styling

### Sync Layer (NEW)
- **Yjs** - CRDT sync engine for conflict resolution
- **y-websocket** - Yjs WebSocket provider
- **Dexie.js** - IndexedDB wrapper for client storage

## Project Structure

```
webhost/
├── config/
│   ├── config.exs
│   ├── dev.exs
│   ├── test.exs
│   ├── prod.exs
│   └── runtime.exs
├── lib/
│   ├── webhost/
│   │   ├── accounts/              # Ash Resources
│   │   │   ├── customer.ex
│   │   │   ├── platform_user.ex
│   │   │   ├── customer_user.ex
│   │   │   ├── token.ex
│   │   │   └── api_key.ex
│   │   ├── billing/
│   │   │   ├── plan.ex
│   │   │   └── subscription.ex
│   │   ├── fleet/                 # GPS tracking resources
│   │   │   ├── vehicle.ex
│   │   │   └── driver.ex
│   │   ├── tracking/              # TimescaleDB resources
│   │   │   ├── gps_position.ex
│   │   │   └── usage_metric.ex
│   │   ├── spatial/               # PostGIS resources
│   │   │   ├── geofence.ex
│   │   │   └── route.ex
│   │   ├── sync/                  # NEW: Yjs sync
│   │   │   ├── yjs_server.ex
│   │   │   └── sync_channel.ex
│   │   ├── accounts.ex            # Ash Domain
│   │   ├── billing.ex             # Ash Domain
│   │   ├── fleet.ex               # Ash Domain
│   │   ├── tracking.ex            # Ash Domain
│   │   ├── spatial.ex             # Ash Domain
│   │   ├── repo.ex
│   │   └── application.ex
│   │
│   └── webhost_web/
│       ├── channels/
│       │   ├── user_socket.ex
│       │   └── sync_channel.ex    # NEW: Yjs sync channel
│       ├── controllers/
│       ├── live/
│       ├── graphql/
│       │   └── schema.ex
│       ├── router.ex
│       └── endpoint.ex
│
├── priv/
│   ├── repo/
│   │   ├── migrations/
│   │   └── seeds.exs
│   └── resource_snapshots/        # Ash snapshots
│
├── assets/                         # NEW: Frontend assets
│   ├── js/
│   │   ├── app.js
│   │   └── sync/
│   │       ├── yjs_client.js
│   │       └── dexie_provider.js
│   ├── css/
│   └── package.json
│
├── docker-compose.yml
├── mix.exs
└── README.md
```

## Step 1: Create Phoenix Project

```bash
# Install Phoenix and Ash archives
mix archive.install hex phx_new
mix archive.install hex ash_postgres

# Create new Phoenix project
mix phx.new webhost --database postgres

cd webhost
```

## Step 2: Add Ash Dependencies

### mix.exs

```elixir
defp deps do
  [
    # Phoenix
    {:phoenix, "~> 1.7.14"},
    {:phoenix_ecto, "~> 4.5"},
    {:phoenix_html, "~> 4.0"},
    {:phoenix_live_reload, "~> 1.4", only: :dev},
    {:phoenix_live_view, "~> 0.20.2"},
    {:phoenix_live_dashboard, "~> 0.8"},
    {:floki, ">= 0.30.0", only: :test},
    {:esbuild, "~> 0.8", runtime: Mix.env() == :dev},
    {:tailwind, "~> 0.2", runtime: Mix.env() == :dev},
    {:telemetry_metrics, "~> 1.0"},
    {:telemetry_poller, "~> 1.0"},
    {:gettext, "~> 0.24"},
    {:jason, "~> 1.4"},
    {:dns_cluster, "~> 0.1.1"},
    {:plug_cowboy, "~> 2.7"},
    
    # Database
    {:ecto_sql, "~> 3.11"},
    {:postgrex, ">= 0.0.0"},
    
    # Ash Framework
    {:ash, "~> 3.0"},
    {:ash_postgres, "~> 2.0"},
    {:ash_phoenix, "~> 2.0"},
    {:ash_graphql, "~> 1.0"},
    {:ash_json_api, "~> 1.0"},
    {:ash_authentication, "~> 4.0"},
    {:ash_authentication_phoenix, "~> 2.0"},
    {:ash_oban, "~> 0.2"},
    {:ash_paper_trail, "~> 0.1"},  # Audit logging
    
    # Background Jobs
    {:oban, "~> 2.17"},
    
    # Authentication
    {:bcrypt_elixir, "~> 3.0"},
    {:joken, "~> 2.6"},
    
    # External APIs
    {:tesla, "~> 1.8"},
    {:hackney, "~> 1.20"},
    
    # Redis
    {:redix, "~> 1.5"},
    
    # Utilities
    {:cors_plug, "~> 3.0"},
    {:nanoid, "~> 2.1"},
    
    # GraphQL
    {:absinthe, "~> 1.7"},
    {:absinthe_plug, "~> 1.5"}
  ]
end
```

Install dependencies:

```bash
mix deps.get
mix deps.compile
```

## Step 3: Configure PostgreSQL with Extensions

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: timescale/timescaledb-ha:pg16-latest
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: webhost_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./priv/repo/init.sql:/docker-entrypoint-initdb.d/init.sql
    command: 
      - "postgres"
      - "-c"
      - "shared_preload_libraries=timescaledb,pg_stat_statements"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  maildev:
    image: maildev/maildev
    ports:
      - "1080:1080"  # Web UI
      - "1025:1025"  # SMTP

volumes:
  postgres_data:
  redis_data:
```

### priv/repo/init.sql

```sql
-- Enable extensions on database creation
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS citext;  -- Case-insensitive text
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- For time+space indexes

-- Verify extensions
SELECT extname, extversion FROM pg_extension 
WHERE extname IN ('timescaledb', 'postgis', 'uuid-ossp');
```

Start services:

```bash
docker-compose up -d
```

## Step 4: Configure Ash Framework

### config/config.exs

```elixir
import Config

# Configure Ash
config :webhost,
  ash_domains: [
    WebHost.Accounts,
    WebHost.Billing,
    WebHost.Fleet,
    WebHost.Tracking,
    WebHost.Spatial
  ]

# Configure AshPostgres
config :ash_postgres, :json_type, :jsonb

# Configure Oban
config :webhost, Oban,
  engine: Oban.Engines.Basic,
  queues: [
    provisioning: 5,
    monitoring: 10,
    cleanup: 2,
    sync: 20  # NEW: For sync operations
  ],
  repo: WebHost.Repo

# Configure endpoint
config :webhost, WebHostWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Phoenix.Endpoint.Cowboy2Adapter,
  render_errors: [
    formats: [html: WebHostWeb.ErrorHTML, json: WebHostWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: WebHost.PubSub,
  live_view: [signing_salt: "change_this_secret"]

# Configure Ecto repos
config :webhost,
  ecto_repos: [WebHost.Repo]

# Configure generators
config :webhost, :generators,
  migration: true,
  binary_id: true,
  sample_binary_id: "11111111-1111-1111-1111-111111111111"

# Configures Elixir's Logger
config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing
config :phoenix, :json_library, Jason

# Configure esbuild
config :esbuild,
  version: "0.17.11",
  default: [
    args:
      ~w(js/app.js --bundle --target=es2017 --outdir=../priv/static/assets --external:/fonts/* --external:/images/*),
    cd: Path.expand("../assets", __DIR__),
    env: %{"NODE_PATH" => Path.expand("../deps", __DIR__)}
  ]

# Configure tailwind
config :tailwind,
  version: "3.4.0",
  default: [
    args: ~w(
      --config=tailwind.config.js
      --input=css/app.css
      --output=../priv/static/assets/app.css
    ),
    cd: Path.expand("../assets", __DIR__)
  ]

# Import environment specific config
import_config "#{config_env()}.exs"
```

### config/dev.exs

```elixir
import Config

# Database configuration
config :webhost, WebHost.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "webhost_dev",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

# Endpoint configuration
config :webhost, WebHostWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "development_secret_key_base_minimum_64_characters_long_required_here",
  watchers: [
    esbuild: {Esbuild, :install_and_run, [:default, ~w(--sourcemap=inline --watch)]},
    tailwind: {Tailwind, :install_and_run, [:default, ~w(--watch)]}
  ],
  live_reload: [
    patterns: [
      ~r"priv/static/.*(js|css|png|jpeg|jpg|gif|svg)$",
      ~r"priv/gettext/.*(po)$",
      ~r"lib/webhost_web/(controllers|live|components)/.*(ex|heex)$"
    ]
  ]

# Redis configuration
config :webhost, :redis,
  host: "localhost",
  port: 6379

# Token signing
config :webhost, :token_signing_secret, 
  "dev_token_secret_min_64_chars_long_for_jwt_signing_replace_in_prod"

# Do not include metadata in development logs
config :logger, :console, format: "[$level] $message\n"

# Set a higher stacktrace during development
config :phoenix, :stacktrace_depth, 20

# Initialize plugs at runtime for faster dev compilation
config :phoenix, :plug_init_mode, :runtime

# Disable swoosh api client for dev
config :swoosh, :api_client, false

# Enable dev routes for dashboard and mailbox
config :webhost, dev_routes: true
```

### config/test.exs

```elixir
import Config

# Database for tests
config :webhost, WebHost.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "webhost_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: 10

# Endpoint for tests
config :webhost, WebHostWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test_secret_key_base_minimum_64_characters_long_required_for_testing_here",
  server: false

# Token signing for tests
config :webhost, :token_signing_secret, 
  "test_token_secret_min_64_chars_long_for_jwt_signing_in_tests_only"

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Disable swoosh in tests
config :swoosh, :api_client, false
```

### config/runtime.exs

```elixir
import Config

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :webhost, WebHost.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    socket_options: maybe_ipv6

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"
  port = String.to_integer(System.get_env("PORT") || "4000")

  config :webhost, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :webhost, WebHostWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      ip: {0, 0, 0, 0, 0, 0, 0, 0},
      port: port
    ],
    secret_key_base: secret_key_base

  # Token signing secret
  config :webhost, :token_signing_secret,
    System.get_env("TOKEN_SIGNING_SECRET") ||
      raise("TOKEN_SIGNING_SECRET environment variable is missing")

  # External APIs
  config :webhost,
    fly_api_token: System.get_env("FLY_API_TOKEN"),
    fly_org_id: System.get_env("FLY_ORG_ID"),
    cloudflare_api_token: System.get_env("CLOUDFLARE_API_TOKEN"),
    cloudflare_account_id: System.get_env("CLOUDFLARE_ACCOUNT_ID"),
    stripe_secret_key: System.get_env("STRIPE_SECRET_KEY"),
    stripe_webhook_secret: System.get_env("STRIPE_WEBHOOK_SECRET")
end
```

## Step 5: Set Up Repo with Extensions

### lib/webhost/repo.ex

```elixir
defmodule WebHost.Repo do
  use AshPostgres.Repo,
    otp_app: :webhost

  @doc """
  Dynamically loads the repository url from the DATABASE_URL environment variable.
  """
  def init(_, opts) do
    {:ok, Keyword.put(opts, :url, System.get_env("DATABASE_URL"))}
  end

  @doc """
  Verifies that TimescaleDB and PostGIS extensions are loaded.
  Run this in dev/staging to verify setup.
  """
  def verify_extensions do
    result = query!("""
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname IN ('timescaledb', 'postgis', 'uuid-ossp')
    """)

    extensions = Enum.map(result.rows, fn [name, version] -> {name, version} end)
    
    required = ["timescaledb", "postgis", "uuid-ossp"]
    loaded = Enum.map(extensions, fn {name, _} -> name end)
    
    case required -- loaded do
      [] -> 
        IO.puts("✓ All required extensions loaded:")
        Enum.each(extensions, fn {name, version} ->
          IO.puts("  - #{name} (#{version})")
        end)
        :ok
      
      missing ->
        IO.puts("✗ Missing extensions: #{Enum.join(missing, ", ")}")
        IO.puts("Run: docker-compose down -v && docker-compose up -d")
        {:error, :missing_extensions}
    end
  end
end
```

## Step 6: Application Setup

### lib/webhost/application.ex

```elixir
defmodule WebHost.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Telemetry setup
      WebHostWeb.Telemetry,
      
      # Database
      WebHost.Repo,
      
      # PubSub for real-time features
      {Phoenix.PubSub, name: WebHost.PubSub},
      
      # Finch for HTTP requests
      {Finch, name: WebHost.Finch},
      
      # Redis connection
      {Redix, 
        host: Application.get_env(:webhost, :redis)[:host] || "localhost",
        port: Application.get_env(:webhost, :redis)[:port] || 6379,
        name: :redix
      },
      
      # Background job processing
      {Oban, Application.fetch_env!(:webhost, Oban)},
      
      # DNS cluster for distributed systems
      {DNSCluster, query: Application.get_env(:webhost, :dns_cluster_query) || :ignore},
      
      # Start the endpoint last
      WebHostWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: WebHost.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    WebHostWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
```

## Step 7: Create Ash Domains

### lib/webhost/accounts.ex

```elixir
defmodule WebHost.Accounts do
  use Ash.Domain

  resources do
    resource WebHost.Accounts.PlatformUser
    resource WebHost.Accounts.Customer
    resource WebHost.Accounts.CustomerUser
    resource WebHost.Accounts.ApiKey
    resource WebHost.Accounts.Token
  end
end
```

### lib/webhost/billing.ex

```elixir
defmodule WebHost.Billing do
  use Ash.Domain

  resources do
    resource WebHost.Billing.Plan
    resource WebHost.Billing.Subscription
  end
end
```

### lib/webhost/fleet.ex (NEW)

```elixir
defmodule WebHost.Fleet do
  @moduledoc """
  Domain for fleet management (vehicles, drivers)
  """
  use Ash.Domain

  resources do
    resource WebHost.Fleet.Vehicle
    resource WebHost.Fleet.Driver
  end
end
```

### lib/webhost/tracking.ex

```elixir
defmodule WebHost.Tracking do
  @moduledoc """
  Domain for time-series tracking data (GPS, usage metrics)
  Uses TimescaleDB via AshPostgres for high-frequency GPS data
  """
  use Ash.Domain

  resources do
    resource WebHost.Tracking.GpsPosition
    resource WebHost.Tracking.UsageMetric
  end
end
```

### lib/webhost/spatial.ex

```elixir
defmodule WebHost.Spatial do
  @moduledoc """
  Domain for spatial/GIS data
  Uses PostGIS via AshPostgres for geofencing and spatial queries
  """
  use Ash.Domain

  resources do
    resource WebHost.Spatial.Geofence
    resource WebHost.Spatial.Route
  end
end
```

## Step 8: Setup NPM for Client-Side Sync (NEW)

### assets/package.json

```json
{
  "name": "webhost-assets",
  "version": "1.0.0",
  "description": "WebHost frontend assets with Yjs sync",
  "scripts": {
    "deploy": "cd .. && mix assets.deploy && rm -f _build/esbuild*"
  },
  "dependencies": {
    "phoenix": "file:../deps/phoenix",
    "phoenix_html": "file:../deps/phoenix_html",
    "phoenix_live_view": "file:../deps/phoenix_live_view",
    "yjs": "^13.6.10",
    "y-websocket": "^1.5.0",
    "y-indexeddb": "^9.0.12",
    "dexie": "^3.2.4",
    "lib0": "^0.2.94"
  },
  "devDependencies": {
    "@types/phoenix": "^1.6.0",
    "esbuild": "~0.17.11"
  }
}
```

Install:

```bash
cd assets
npm install
cd ..
```

## Step 9: Initialize Database

```bash
# Create database
mix ecto.create

# Verify extensions
mix run -e "WebHost.Repo.verify_extensions()"

# Should output:
# ✓ All required extensions loaded:
#   - timescaledb (2.x.x)
#   - postgis (3.x.x)
#   - uuid-ossp (1.x)
```

## Step 10: Environment Variables

### .env.example

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webhost_dev

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Phoenix
SECRET_KEY_BASE=generate_with_mix_phx_gen_secret
TOKEN_SIGNING_SECRET=generate_with_mix_phx_gen_secret
PHX_HOST=localhost
PORT=4000

# External APIs (for production)
FLY_API_TOKEN=
FLY_ORG_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Email (Development)
SMTP_HOST=localhost
SMTP_PORT=1025
```

Generate secrets:

```bash
mix phx.gen.secret 64  # For SECRET_KEY_BASE
mix phx.gen.secret 64  # For TOKEN_SIGNING_SECRET
```

## Step 11: Verification

Start the server:

```bash
mix phx.server
```

Visit:
- **App:** http://localhost:4000
- **LiveDashboard:** http://localhost:4000/dev/dashboard

## Verification Checklist

- [ ] Phoenix server starts without errors
- [ ] PostgreSQL connection successful
- [ ] TimescaleDB extension loaded (verify_extensions)
- [ ] PostGIS extension loaded (verify_extensions)
- [ ] Redis connection successful
- [ ] No compilation warnings
- [ ] Docker services running
- [ ] Ash domains configured
- [ ] NPM packages installed

## Common Issues & Solutions

### Issue: Ash compile errors
**Solution:** Run `mix deps.clean --all && mix deps.get && mix deps.compile`

### Issue: TimescaleDB extension not found
**Solution:** Ensure you're using timescale/timescaledb-ha Docker image

### Issue: PostGIS functions not working
**Solution:** Run `mix run -e "WebHost.Repo.verify_extensions()"` to check

### Issue: NPM packages not installing
**Solution:** Node 18+ required. Run `node --version` to check

## Next Steps

Once Phase 0 is complete, proceed to **Phase 1: Core Resources with Multi-Tenancy**.

## Estimated Time
- Installation & setup: 1-2 hours
- Configuration: 1-2 hours
- NPM setup: 30 minutes
- Verification: 1 hour
- **Total: 3.5-5.5 hours**

## Key Architecture Decisions

✅ **Ash Framework** - Provides built-in multi-tenancy, auto-generated APIs, declarative authorization
✅ **TimescaleDB** - Essential for GPS data (millions of points/day)
✅ **PostGIS** - Required for geofencing and spatial queries
✅ **Yjs + Dexie.js** - CRDT-based sync for offline-first capability
✅ **Home + Cloud Hybrid** - Best economics (83% margin on hobby tier)

**This foundation supports 80-150 hobby tier customers on a single home server while maintaining professional architecture for enterprise customers in the cloud.**