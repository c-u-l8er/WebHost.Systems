# Phase 0: WebHost Foundation with Ash Framework

## Overview
Set up the foundational infrastructure for WebHost using Ash Framework. This establishes the core technologies, development environment, and project structure optimized for Ash's declarative resource approach.

## Goals
- Initialize Phoenix project with Ash Framework
- Set up PostgreSQL with TimescaleDB and PostGIS via Ash extensions
- Configure Ash domains and resources
- Establish project architecture for multi-tenancy
- Set up GraphQL and JSON:API

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
- **Ash 3.0+** - Resource-based framework
- **AshPostgres** - PostgreSQL data layer
- **AshGraphql** - Auto-generated GraphQL API
- **AshJsonApi** - Auto-generated REST API
- **AshAuthentication** - Authentication system
- **AshOban** - Background jobs
- **PostgreSQL 14+** - Primary database
- **TimescaleDB Extension** - Time-series optimization via Ash
- **PostGIS Extension** - Spatial data via AshPostgis
- **Redis** - Caching and real-time state

### Frontend (Dashboard)
- **Phoenix LiveView** - Real-time admin dashboard
- **TailwindCSS** - Styling

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
│   │   │   └── api_key.ex
│   │   ├── billing/
│   │   │   ├── plan.ex
│   │   │   └── subscription.ex
│   │   ├── infrastructure/
│   │   │   ├── deployment.ex
│   │   │   └── frontend_app.ex
│   │   ├── tracking/              # TimescaleDB resources
│   │   │   ├── gps_position.ex
│   │   │   └── usage_metric.ex
│   │   ├── spatial/               # PostGIS resources
│   │   │   ├── geo_point.ex
│   │   │   └── geo_polygon.ex
│   │   ├── accounts.ex            # Ash Domain
│   │   ├── billing.ex             # Ash Domain
│   │   ├── infrastructure.ex      # Ash Domain
│   │   ├── tracking.ex            # Ash Domain
│   │   ├── spatial.ex             # Ash Domain
│   │   ├── repo.ex
│   │   └── application.ex
│   │
│   └── webhost_web/
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
    {:phoenix, "~> 1.7.10"},
    {:phoenix_ecto, "~> 4.4"},
    {:phoenix_html, "~> 4.0"},
    {:phoenix_live_reload, "~> 1.2", only: :dev},
    {:phoenix_live_view, "~> 0.20.0"},
    {:phoenix_live_dashboard, "~> 0.8"},
    {:floki, ">= 0.30.0", only: :test},
    {:esbuild, "~> 0.8", runtime: Mix.env() == :dev},
    {:tailwind, "~> 0.2", runtime: Mix.env() == :dev},
    {:telemetry_metrics, "~> 0.6"},
    {:telemetry_poller, "~> 1.0"},
    {:gettext, "~> 0.20"},
    {:jason, "~> 1.2"},
    {:dns_cluster, "~> 0.1.1"},
    {:plug_cowboy, "~> 2.5"},
    
    # Database
    {:ecto_sql, "~> 3.10"},
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
    
    # Ash Extensions
    {:ash_postgres_timescale, "~> 0.1"},  # TimescaleDB support
    {:ash_postgis, "~> 0.1"},              # PostGIS support
    
    # Background Jobs
    {:oban, "~> 2.17"},
    
    # Authentication
    {:bcrypt_elixir, "~> 3.0"},
    {:joken, "~> 2.6"},
    
    # External APIs
    {:tesla, "~> 1.8"},
    {:hackney, "~> 1.18"},
    
    # Redis
    {:redix, "~> 1.3"},
    
    # Utilities
    {:cors_plug, "~> 3.0"},
    {:nanoid, "~> 2.1"}
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
    WebHost.Infrastructure,
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
    cleanup: 2
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
  version: "3.3.2",
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
  pool_size: 10,
  # Enable TimescaleDB and PostGIS
  after_connect: {WebHost.Repo, :set_extensions, []}

# Endpoint configuration
config :webhost, WebHostWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "development_secret_key_base_minimum_64_characters_long_required",
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

# Do not include metadata in development logs
config :logger, :console, format: "[$level] $message\n"

# Set a higher stacktrace during development
config :phoenix, :stacktrace_depth, 20

# Initialize plugs at runtime for faster dev compilation
config :phoenix, :plug_init_mode, :runtime

# Disable swoosh api client for dev
config :swoosh, :api_client, false
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
  secret_key_base: "test_secret_key_base_minimum_64_characters_long_required_for_testing",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime
```

### config/runtime.exs

```elixir
import Config

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
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
  Called after database connection is established.
  Enables extensions if needed.
  """
  def set_extensions(conn) do
    # Extensions are already enabled in init.sql
    # This is just for reference if you need runtime checks
    {:ok, conn}
  end

  @doc """
  Dynamically loads the repository url from the DATABASE_URL environment variable.
  """
  def init(_, opts) do
    {:ok, Keyword.put(opts, :url, System.get_env("DATABASE_URL"))}
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

### lib/webhost/infrastructure.ex

```elixir
defmodule WebHost.Infrastructure do
  use Ash.Domain

  resources do
    resource WebHost.Infrastructure.Deployment
    resource WebHost.Infrastructure.FrontendApp
  end
end
```

### lib/webhost/tracking.ex

```elixir
defmodule WebHost.Tracking do
  @moduledoc """
  Domain for time-series tracking data (GPS, usage metrics)
  Uses TimescaleDB via AshPostgres
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
  Uses PostGIS via AshPostgis
  """
  use Ash.Domain

  resources do
    resource WebHost.Spatial.GeoPoint
    resource WebHost.Spatial.GeoPolygon
  end
end
```

## Step 8: GraphQL and JSON:API Setup

### lib/webhost_web/graphql/schema.ex

```elixir
defmodule WebHostWeb.GraphQL.Schema do
  use Absinthe.Schema

  @domains [
    WebHost.Accounts,
    WebHost.Billing,
    WebHost.Infrastructure,
    WebHost.Tracking,
    WebHost.Spatial
  ]

  use AshGraphql, domains: @domains

  query do
    # Custom queries can be added here
  end

  mutation do
    # Custom mutations can be added here
  end
end
```

### lib/webhost_web/router.ex (initial)

```elixir
defmodule WebHostWeb.Router do
  use WebHostWeb, :router
  use AshAuthentication.Phoenix.Router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {WebHostWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
    plug :load_from_session
  end

  pipeline :api do
    plug :accepts, ["json"]
    plug :load_from_bearer
  end

  pipeline :graphql do
    plug :accepts, ["json"]
    plug AshGraphql.Plug
  end

  scope "/", WebHostWeb do
    pipe_through :browser

    get "/", PageController, :home
    
    # Auth routes
    sign_in_route()
    sign_out_route AuthController
    auth_routes_for WebHost.Accounts.PlatformUser, to: AuthController
    reset_route []
  end

  # JSON API routes (auto-generated by AshJsonApi)
  scope "/api/json" do
    pipe_through :api

    forward "/", AshJsonApi.Router,
      domains: [
        WebHost.Accounts,
        WebHost.Billing,
        WebHost.Infrastructure
      ]
  end

  # GraphQL API
  scope "/api/graphql" do
    pipe_through :graphql

    forward "/", Absinthe.Plug, schema: WebHostWeb.GraphQL.Schema

    if Mix.env() == :dev do
      forward "/graphiql", Absinthe.Plug.GraphiQL,
        schema: WebHostWeb.GraphQL.Schema,
        interface: :playground
    end
  end

  # Health check
  scope "/api" do
    pipe_through :api

    get "/health", WebHostWeb.HealthController, :index
  end

  # LiveDashboard
  if Application.compile_env(:webhost, :dev_routes) do
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: WebHostWeb.Telemetry
    end
  end
end
```

## Step 9: Environment Variables

### .env.example

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webhost_dev

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Phoenix
SECRET_KEY_BASE=generate_with_mix_phx_gen_secret
PHX_HOST=localhost
PORT=4000

# External APIs (for production)
FLY_API_TOKEN=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Email (Development)
SMTP_HOST=localhost
SMTP_PORT=1025
```

## Step 10: Initialize Database

```bash
# Create database
mix ecto.create

# Generate initial Ash resource snapshots
mix ash.codegen initial_snapshots

# This creates migration files based on your Ash resources
mix ash_postgres.generate_migrations --name initial_setup

# Run migrations
mix ecto.migrate
```

## Step 11: Verification

Start the server:

```bash
mix phx.server
```

Visit:
- **App:** http://localhost:4000
- **GraphiQL:** http://localhost:4000/api/graphql/graphiql
- **LiveDashboard:** http://localhost:4000/dev/dashboard

## Verification Checklist

- [ ] Phoenix server starts without errors
- [ ] PostgreSQL connection successful
- [ ] TimescaleDB extension loaded
- [ ] PostGIS extension loaded
- [ ] Redis connection successful
- [ ] GraphiQL playground accessible
- [ ] No compilation warnings
- [ ] Docker services running
- [ ] Ash domains configured

## Common Issues & Solutions

### Issue: Ash compile errors
**Solution:** Run `mix deps.clean --all && mix deps.get && mix deps.compile`

### Issue: TimescaleDB extension not found
**Solution:** Ensure you're using timescale/timescaledb-ha Docker image

### Issue: GraphQL schema errors
**Solution:** Ensure all domains are listed in schema.ex @domains

### Issue: Migration generation fails
**Solution:** Run `mix ash.codegen initial_snapshots` before generating migrations

## Next Steps

Once Phase 0 is complete, proceed to Phase 1: Core Resources with Ash Framework.

## Estimated Time
- Installation & setup: 1-2 hours
- Configuration: 1-2 hours  
- Verification: 1 hour
- **Total: 3-5 hours**

## Benefits of Ash Setup

✅ **80% less boilerplate** than vanilla Phoenix
✅ **GraphQL API** auto-generated
✅ **REST API** auto-generated  
✅ **Multi-tenancy** built-in
✅ **PostGIS support** via AshPostgis
✅ **TimescaleDB support** via AshPostgresTimescale
✅ **Type-safe** resource definitions
✅ **Authorization** declarative policies