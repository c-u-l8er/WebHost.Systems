# Phase 2: WebHost Authentication & Authorization with Ash

## Overview
Implement authentication using AshAuthentication for platform users (staff) and API key authentication for customers. Leverage Ash's declarative policy system for authorization.

## Goals
- Set up AshAuthentication for platform users
- Implement API key authentication for customer apps
- Configure token-based auth for web and mobile
- Set up WebSocket authentication
- Define resource-level authorization policies
- Create authentication plugs and helpers

## Dependencies Already Added

From Phase 0, you already have:
- `ash_authentication` - Core auth
- `ash_authentication_phoenix` - Phoenix integration
- `joken` - JWT tokens
- `bcrypt_elixir` - Password hashing

## Token Resource

AshAuthentication requires a token resource for storing tokens.

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
    # Configure token expiry
  end
end
```

Update `lib/webhost/accounts.ex` to include Token:

```elixir
defmodule WebHost.Accounts do
  use Ash.Domain

  resources do
    resource WebHost.Accounts.PlatformUser
    resource WebHost.Accounts.Customer
    resource WebHost.Accounts.CustomerUser
    resource WebHost.Accounts.ApiKey
    resource WebHost.Accounts.Token  # Add this
  end
end
```

## Update Platform User with Full Auth

Update `lib/webhost/accounts/platform_user.ex`:

```elixir
defmodule WebHost.Accounts.PlatformUser do
  use Ash.Resource,
    domain: WebHost.Accounts,
    data_layer: AshPostgres.DataLayer,
    extensions: [
      AshAuthentication,
      AshAuthentication.AddOn.Confirmation,
      AshGraphql.Resource
    ]

  postgres do
    table "platform_users"
    repo WebHost.Repo
  end

  authentication do
    strategies do
      password :password do
        identity_field :email
        hashed_password_field :hashed_password
        
        sign_in_tokens_enabled? true
        
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
      
      # Token lifetime: 7 days
      token_lifetime 168
    end

    add_ons do
      confirmation :confirm do
        monitor_fields [:email]
        confirm_on_create? true
        confirm_on_update? false
        sender WebHost.Accounts.UserNotifier
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

    attribute :name, :string, public?: true

    attribute :role, :atom do
      allow_nil? false
      default :staff
      constraints one_of: [:admin, :staff]
      public? true
    end

    attribute :active, :boolean, default: true, public?: true
    attribute :confirmed_at, :utc_datetime, public?: true

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
    # Allow authentication actions
    bypass AshAuthentication.Checks.AshAuthenticationInteraction do
      authorize_if always()
    end

    # Default: forbid
    policy always() do
      forbid_if always()
    end

    # Anyone can read their own user
    policy action_type(:read) do
      authorize_if expr(id == ^actor(:id))
      authorize_if actor_attribute_equals(:role, :admin)
    end

    # Only admins can create/update/delete
    policy action_type([:create, :update, :destroy]) do
      authorize_if actor_attribute_equals(:role, :admin)
    end
  end

  graphql do
    type :platform_user

    queries do
      get :platform_user, :read
      read_one :current_user, :read do
        prepare fn query, %{actor: actor} ->
          Ash.Query.filter(query, id == ^actor.id)
        end
      end
    end

    mutations do
      update :update_platform_user, :update
    end
  end
end
```

## User Notifier

Create email notifier for password resets and confirmations.

Create `lib/webhost/accounts/user_notifier.ex`:

```elixir
defmodule WebHost.Accounts.UserNotifier do
  @moduledoc """
  Email notifier for user authentication events
  """

  def send_password_reset_email(user, token) do
    # In development, just log
    if Mix.env() == :dev do
      IO.puts("""
      
      ========================================
      Password Reset Email
      ========================================
      To: #{user.email}
      
      Reset your password by visiting:
      http://localhost:4000/password-reset/#{token}
      
      This link expires in 24 hours.
      ========================================
      """)
    else
      # In production, send actual email via your email service
      # deliver_email(user.email, subject, body)
    end
  end

  def send_confirmation_email(user, token) do
    if Mix.env() == :dev do
      IO.puts("""
      
      ========================================
      Confirmation Email
      ========================================
      To: #{user.email}
      
      Confirm your email by visiting:
      http://localhost:4000/confirm/#{token}
      
      ========================================
      """)
    else
      # Production email sending
    end
  end
end
```

## Phoenix Plugs for Authentication

### Load User from Session

Create `lib/webhost_web/plugs/load_from_session.ex`:

```elixir
defmodule WebHostWeb.Plugs.LoadFromSession do
  @moduledoc """
  Loads the current user from session
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    if user_id = get_session(conn, :user_id) do
      case WebHost.Accounts.PlatformUser
           |> Ash.get(user_id) do
        {:ok, user} ->
          conn
          |> assign(:current_user, user)
          |> assign(:actor, user)
        
        {:error, _} ->
          conn
          |> delete_session(:user_id)
      end
    else
      conn
    end
  end
end
```

### Load User from Bearer Token

Create `lib/webhost_web/plugs/load_from_bearer.ex`:

```elixir
defmodule WebHostWeb.Plugs.LoadFromBearer do
  @moduledoc """
  Loads user from Authorization: Bearer token
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user, _claims} <- AshAuthentication.Jwt.peek(
           WebHost.Accounts.PlatformUser,
           token
         ) do
      conn
      |> assign(:current_user, user)
      |> assign(:actor, user)
    else
      _ -> conn
    end
  end
end
```

### Require Authentication

Create `lib/webhost_web/plugs/require_authenticated.ex`:

```elixir
defmodule WebHostWeb.Plugs.RequireAuthenticated do
  @moduledoc """
  Ensures user is authenticated
  """
  import Plug.Conn
  import Phoenix.Controller

  def init(opts), do: opts

  def call(conn, _opts) do
    if conn.assigns[:current_user] do
      conn
    else
      conn
      |> put_status(:unauthorized)
      |> put_view(json: WebHostWeb.ErrorJSON)
      |> render(:"401")
      |> halt()
    end
  end
end
```

### Require Admin

Create `lib/webhost_web/plugs/require_admin.ex`:

```elixir
defmodule WebHostWeb.Plugs.RequireAdmin do
  @moduledoc """
  Ensures user is an admin
  """
  import Plug.Conn
  import Phoenix.Controller

  def init(opts), do: opts

  def call(conn, _opts) do
    if conn.assigns[:current_user]&.role == :admin do
      conn
    else
      conn
      |> put_status(:forbidden)
      |> put_view(json: WebHostWeb.ErrorJSON)
      |> render(:"403")
      |> halt()
    end
  end
end
```

## API Key Authentication

### API Key Plug

Create `lib/webhost_web/plugs/authenticate_api_key.ex`:

```elixir
defmodule WebHostWeb.Plugs.AuthenticateApiKey do
  @moduledoc """
  Authenticates customer API requests using API keys
  """
  import Plug.Conn
  import Phoenix.Controller
  alias WebHost.Accounts

  def init(opts), do: opts

  def call(conn, _opts) do
    with ["Bearer " <> api_key] <- get_req_header(conn, "authorization"),
         {:ok, key_record} <- Accounts.ApiKey
                              |> Ash.Query.for_read(:by_key_hash, %{key: api_key})
                              |> Ash.read_one(),
         true <- key_record.active,
         {:ok, customer} <- load_customer(key_record) do
      
      # Mark key as used
      key_record
      |> Ash.Changeset.for_update(:mark_used)
      |> Ash.update()

      conn
      |> assign(:current_customer, customer)
      |> assign(:api_key, key_record)
      |> assign(:actor, customer)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> put_view(json: WebHostWeb.ErrorJSON)
        |> render(:"401", message: "Invalid API key")
        |> halt()
    end
  end

  defp load_customer(api_key) do
    api_key
    |> Ash.load(:customer)
    |> case do
      {:ok, loaded} -> {:ok, loaded.customer}
      error -> error
    end
  end
end
```

## Auth Controllers

### Auth Controller

Create `lib/webhost_web/controllers/auth_controller.ex`:

```elixir
defmodule WebHostWeb.AuthController do
  use WebHostWeb, :controller
  use AshAuthentication.Phoenix.Controller

  def success(conn, activity, user, _token) do
    return_to = get_session(conn, :return_to) || ~p"/"

    conn
    |> delete_session(:return_to)
    |> store_in_session(user)
    |> assign(:current_user, user)
    |> redirect(to: return_to)
  end

  def failure(conn, activity, reason) do
    conn
    |> put_status(401)
    |> json(%{
      error: "Authentication failed",
      reason: inspect(reason),
      activity: activity
    })
  end

  def sign_out(conn, _params) do
    return_to = get_session(conn, :return_to) || ~p"/"

    conn
    |> clear_session()
    |> redirect(to: return_to)
  end
end
```

### API Auth Controller

Create `lib/webhost_web/controllers/api/auth_controller.ex`:

```elixir
defmodule WebHostWeb.API.AuthController do
  use WebHostWeb, :controller
  alias WebHost.Accounts

  def sign_in(conn, %{"email" => email, "password" => password}) do
    case AshAuthentication.Strategy.Password.sign_in(
           Accounts.PlatformUser,
           %{
             "email" => email,
             "password" => password
           },
           []
         ) do
      {:ok, user} ->
        {:ok, token, _claims} = AshAuthentication.Jwt.token_for_user(user)

        json(conn, %{
          token: token,
          user: %{
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
          }
        })

      {:error, _reason} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Invalid credentials"})
    end
  end

  def me(conn, _params) do
    user = conn.assigns.current_user

    json(conn, %{
      user: %{
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    })
  end

  def refresh(conn, %{"token" => token}) do
    case AshAuthentication.Jwt.peek(Accounts.PlatformUser, token) do
      {:ok, user, _claims} ->
        {:ok, new_token, _claims} = AshAuthentication.Jwt.token_for_user(user)

        json(conn, %{
          token: new_token,
          user: %{
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
          }
        })

      {:error, _reason} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Invalid token"})
    end
  end
end
```

## WebSocket Authentication

### User Socket with Multi-Auth

Update `lib/webhost_web/channels/user_socket.ex`:

```elixir
defmodule WebHostWeb.UserSocket do
  use Phoenix.Socket

  ## Channels
  channel "customer:*", WebHostWeb.CustomerChannel
  channel "sync:*", WebHostWeb.SyncChannel

  @impl true
  def connect(%{"token" => token, "type" => "jwt"}, socket, _connect_info) do
    # JWT token (platform user)
    case AshAuthentication.Jwt.peek(WebHost.Accounts.PlatformUser, token) do
      {:ok, user, _claims} ->
        {:ok, 
         socket
         |> assign(:user_id, user.id)
         |> assign(:user, user)
         |> assign(:auth_type, :jwt)}

      {:error, _} ->
        :error
    end
  end

  def connect(%{"token" => api_key, "type" => "api_key"}, socket, _connect_info) do
    # API key (customer)
    case WebHost.Accounts.ApiKey
         |> Ash.Query.for_read(:by_key_hash, %{key: api_key})
         |> Ash.read_one() do
      {:ok, key_record} when key_record.active ->
        {:ok, loaded} = Ash.load(key_record, :customer)

        {:ok,
         socket
         |> assign(:customer_id, loaded.customer.id)
         |> assign(:customer, loaded.customer)
         |> assign(:auth_type, :api_key)}

      _ ->
        :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket) do
    case socket.assigns.auth_type do
      :jwt -> "user_socket:#{socket.assigns.user_id}"
      :api_key -> "customer_socket:#{socket.assigns.customer_id}"
      _ -> nil
    end
  end
end
```

## Update Router with Auth

Update `lib/webhost_web/router.ex`:

```elixir
defmodule WebHostWeb.Router do
  use WebHostWeb, :router
  use AshAuthentication.Phoenix.Router

  import WebHostWeb.Plugs.LoadFromSession
  import WebHostWeb.Plugs.LoadFromBearer
  import WebHostWeb.Plugs.RequireAuthenticated
  import WebHostWeb.Plugs.RequireAdmin
  import WebHostWeb.Plugs.AuthenticateApiKey

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

  pipeline :api_key_auth do
    plug :accepts, ["json"]
    plug :authenticate_api_key
  end

  pipeline :require_auth do
    plug :require_authenticated
  end

  pipeline :require_admin_role do
    plug :require_admin
  end

  # Public routes
  scope "/", WebHostWeb do
    pipe_through :browser

    get "/", PageController, :home
    
    # AshAuthentication routes
    sign_in_route()
    sign_out_route AuthController
    auth_routes_for WebHost.Accounts.PlatformUser, to: AuthController
    reset_route []
  end

  # Public API routes
  scope "/api", WebHostWeb.API do
    pipe_through :api

    post "/auth/sign-in", AuthController, :sign_in
    post "/auth/refresh", AuthController, :refresh
    get "/health", HealthController, :index
  end

  # Authenticated API routes
  scope "/api", WebHostWeb.API do
    pipe_through [:api, :require_auth]

    get "/auth/me", AuthController, :me
    
    resources "/customers", CustomerController, except: [:new, :edit]
    resources "/plans", PlanController, only: [:index, :show]
  end

  # Admin-only API routes
  scope "/api/admin", WebHostWeb.API.Admin, as: :admin do
    pipe_through [:api, :require_auth, :require_admin_role]

    resources "/plans", PlanController
    resources "/customers", CustomerController
    get "/metrics", MetricsController, :index
  end

  # Customer API routes (API key auth)
  scope "/api/v1", WebHostWeb.API.V1 do
    pipe_through :api_key_auth

    get "/status", StatusController, :index
    get "/deployment", DeploymentController, :show
    resources "/frontend-apps", FrontendAppController, only: [:index, :create]
  end

  # JSON API (auto-generated, with auth)
  scope "/api/json" do
    pipe_through [:api, :require_auth]

    forward "/", AshJsonApi.Router,
      domains: [
        WebHost.Accounts,
        WebHost.Billing,
        WebHost.Infrastructure
      ],
      forward_target: AshJsonApi.Router,
      json_schema: "/api/json/open_api"
  end

  # GraphQL API
  scope "/api/graphql" do
    pipe_through :api

    forward "/", Absinthe.Plug,
      schema: WebHostWeb.GraphQL.Schema,
      context: %{actor: nil}  # Actor set by plug

    if Mix.env() == :dev do
      forward "/graphiql", Absinthe.Plug.GraphiQL,
        schema: WebHostWeb.GraphQL.Schema,
        interface: :playground
    end
  end

  # Health check
  scope "/api" do
    get "/health", WebHostWeb.HealthController, :index
  end

  # LiveDashboard (requires auth)
  if Application.compile_env(:webhost, :dev_routes) do
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through [:browser, :require_auth, :require_admin_role]

      live_dashboard "/dashboard", metrics: WebHostWeb.Telemetry
    end
  end
end
```

## GraphQL Context with Actor

Update `lib/webhost_web/graphql/schema.ex`:

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

  def context(ctx) do
    # Set actor from connection assigns
    actor = Map.get(ctx, :current_user) || Map.get(ctx, :current_customer)
    
    Map.put(ctx, :actor, actor)
  end

  def plugins do
    [Absinthe.Middleware.Dataloader | Absinthe.Plugin.defaults()]
  end

  query do
    # Custom queries
  end

  mutation do
    # Custom mutations
  end
end
```

## Configuration

### Add to config/config.exs:

```elixir
config :webhost, :token_signing_secret, "change_this_in_production_to_64_char_secret"

# AshAuthentication
config :ash_authentication, :authentication,
  subject_name: :user,
  token_lifetime: 168  # 7 days in hours
```

### Add to config/runtime.exs (production):

```elixir
if config_env() == :prod do
  config :webhost, :token_signing_secret,
    System.get_env("TOKEN_SIGNING_SECRET") ||
      raise("TOKEN_SIGNING_SECRET environment variable is missing")
end
```

## Generate Migration for Tokens

```bash
mix ash_postgres.generate_migrations --name add_tokens
mix ecto.migrate
```

## Testing Authentication

### test/webhost_web/plugs/authenticate_api_key_test.exs

```elixir
defmodule WebHostWeb.Plugs.AuthenticateApiKeyTest do
  use WebHostWeb.ConnCase
  import WebHost.AshCase

  describe "AuthenticateApiKey plug" do
    test "assigns current_customer with valid API key", %{conn: conn} do
      customer = create_customer()
      
      {:ok, api_key} =
        WebHost.Accounts.ApiKey
        |> Ash.Changeset.for_create(:create, %{
          customer_id: customer.id,
          name: "Test Key",
          environment: :production,
          permissions: ["sync:read"]
        })
        |> Ash.create()

      conn =
        conn
        |> put_req_header("authorization", "Bearer #{api_key.key}")
        |> WebHostWeb.Plugs.AuthenticateApiKey.call([])

      assert conn.assigns.current_customer.id == customer.id
      refute conn.halted
    end

    test "halts with invalid API key", %{conn: conn} do
      conn =
        conn
        |> put_req_header("authorization", "Bearer invalid_key")
        |> WebHostWeb.Plugs.AuthenticateApiKey.call([])

      assert conn.halted
      assert conn.status == 401
    end
  end
end
```

### test/webhost_web/controllers/api/auth_controller_test.exs

```elixir
defmodule WebHostWeb.API.AuthControllerTest do
  use WebHostWeb.ConnCase
  import WebHost.AshCase

  describe "POST /api/auth/sign-in" do
    test "returns token with valid credentials", %{conn: conn} do
      WebHost.Accounts.PlatformUser
      |> Ash.Changeset.for_create(:register, %{
        email: "test@example.com",
        password: "SecurePass123!",
        password_confirmation: "SecurePass123!"
      })
      |> Ash.create!()

      conn = post(conn, ~p"/api/auth/sign-in", %{
        email: "test@example.com",
        password: "SecurePass123!"
      })

      assert %{"token" => token, "user" => user} = json_response(conn, 200)
      assert is_binary(token)
      assert user["email"] == "test@example.com"
    end

    test "returns error with invalid credentials", %{conn: conn} do
      conn = post(conn, ~p"/api/auth/sign-in", %{
        email: "wrong@example.com",
        password: "wrongpass"
      })

      assert %{"error" => "Invalid credentials"} = json_response(conn, 401)
    end
  end

  describe "GET /api/auth/me" do
    test "returns current user when authenticated", %{conn: conn} do
      user = create_platform_user()
      {:ok, token, _claims} = AshAuthentication.Jwt.token_for_user(user)

      conn =
        conn
        |> put_req_header("authorization", "Bearer #{token}")
        |> get(~p"/api/auth/me")

      assert %{"user" => returned_user} = json_response(conn, 200)
      assert returned_user["id"] == user.id
    end

    test "returns unauthorized without token", %{conn: conn} do
      conn = get(conn, ~p"/api/auth/me")
      assert json_response(conn, 401)
    end
  end
end
```

## Documentation

Create `docs/authentication.md`:

```markdown
# Authentication

WebHost uses AshAuthentication for flexible, secure authentication.

## Platform Authentication (Staff/Admin)

### Sign In

**POST** `/api/auth/sign-in`

```json
{
  "email": "admin@webhost.systems",
  "password": "your-password"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "admin@webhost.systems",
    "name": "Admin User",
    "role": "admin"
  }
}
```

### Authenticated Requests

Include JWT in Authorization header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Token Refresh

**POST** `/api/auth/refresh`

```json
{
  "token": "current-token"
}
```

## Customer API Authentication

Customers authenticate their apps using API keys.

### Using API Keys

Include API key in Authorization header:

```
Authorization: Bearer whs_live_abc123def456...
```

### WebSocket Authentication

**JWT (Platform Users):**
```javascript
const socket = new Phoenix.Socket("/socket", {
  params: { 
    token: "jwt-token",
    type: "jwt"
  }
});
```

**API Key (Customers):**
```javascript
const socket = new Phoenix.Socket("/socket", {
  params: { 
    token: "whs_live_...",
    type: "api_key"
  }
});
```

## GraphQL Authentication

Set actor in context:

```graphql
# HTTP Header
Authorization: Bearer <token>

# Query with auth
query {
  currentUser {
    id
    email
    name
  }
}
```

## Authorization Policies

All resources have declarative policies:

```elixir
policies do
  # Read own data
  policy action_type(:read) do
    authorize_if expr(id == ^actor(:id))
  end

  # Admins can do anything
  policy action_type(:*) do
    authorize_if actor_attribute_equals(:role, :admin)
  end
end
```
```

## Verification Checklist

- [ ] Token resource created
- [ ] Platform user auth working
- [ ] API key auth working
- [ ] WebSocket auth working (both JWT and API key)
- [ ] GraphQL auth working
- [ ] All plugs working
- [ ] Authorization policies enforced
- [ ] Tests pass
- [ ] Password reset flow working
- [ ] Email confirmation working (in dev mode)

## Security Best Practices

✅ **Tokens:** 7-day expiry, refresh mechanism
✅ **Passwords:** Bcrypt hashing
✅ **API Keys:** SHA-256 hashed, prefix for identification
✅ **Policies:** Declarative, resource-level
✅ **HTTPS Only:** Enforced in production
✅ **Rate Limiting:** Add with PlugRateLimit
✅ **Audit Logging:** Use AshPaperTrail extension

## Common Issues & Solutions

### Issue: Token verification fails
**Solution:** Ensure TOKEN_SIGNING_SECRET is set and 64+ characters

### Issue: API key not found
**Solution:** Verify key includes prefix (whs_live_ or whs_test_)

### Issue: GraphQL auth not working
**Solution:** Check actor is set in schema context/3 callback

### Issue: WebSocket connection refused
**Solution:** Verify token format and type parameter

## Next Steps

Proceed to Phase 3: Infrastructure Provisioning with AshOban

## Estimated Time
- AshAuthentication setup: 2 hours
- Plugs and controllers: 2 hours
- WebSocket auth: 1 hour
- Testing: 2 hours
- **Total: 7 hours** (vs 10 hours without Ash - **30% faster!**)

## Benefits with AshAuthentication

✅ **Password management** - Built-in password hashing, resets
✅ **Token management** - Automatic JWT generation and validation
✅ **Confirmation** - Email confirmation addon
✅ **Multi-strategy** - Easy to add OAuth, magic links, etc.
✅ **Policy integration** - Auth checks in resource policies
✅ **Type-safe** - Compile-time auth checks