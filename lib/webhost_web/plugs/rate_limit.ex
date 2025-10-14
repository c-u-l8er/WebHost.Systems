defmodule WebHostWeb.Plugs.RateLimit do
  @moduledoc """
  Rate limiting plug for API endpoints.

  Uses Redis for distributed rate limiting across multiple instances.
  Default limits: 1000 requests per hour per API key/IP combination.
  """
  import Plug.Conn

  @default_limit 1000
  @default_window 3600  # 1 hour in seconds

  def init(opts) do
    limit = Keyword.get(opts, :limit, @default_limit)
    window = Keyword.get(opts, :window, @default_window)

    %{limit: limit, window: window}
  end

  def call(conn, %{limit: limit, window: window} = opts) do
    key = get_rate_limit_key(conn, opts)

    case check_rate_limit(key, limit, window) do
      {:ok, _count} ->
        conn
        |> put_resp_header("x-ratelimit-limit", to_string(limit))
        |> put_resp_header("x-ratelimit-remaining", get_remaining(key, limit))
        |> put_resp_header("x-ratelimit-reset", get_reset_time(window))

      {:error, :rate_limited} ->
        conn
        |> put_status(429)
        |> put_resp_header("retry-after", to_string(window))
        |> put_resp_header("x-ratelimit-limit", to_string(limit))
        |> put_resp_header("x-ratelimit-remaining", "0")
        |> put_resp_header("x-ratelimit-reset", get_reset_time(window))
        |> halt()
    end
  end

  # Private functions

  defp get_rate_limit_key(conn, opts) do
    case get_auth_type(conn) do
      {:api_key, api_key} ->
        # Rate limit by API key
        "rate_limit:api_key:#{api_key}"

      {:customer_token, token} ->
        # Rate limit by customer token
        "rate_limit:customer:#{token}"

      {:jwt, user_id} ->
        # Rate limit by user ID
        "rate_limit:user:#{user_id}"

      :anonymous ->
        # Rate limit by IP address
        ip = get_client_ip(conn)
        "rate_limit:ip:#{ip}"
    end
  end

  defp get_auth_type(conn) do
    case get_req_header(conn, "authorization") do
      [<<"Bearer ", token::binary>>] ->
        # Check if it's an API key
        if String.starts_with?(token, "whs_live_") or String.starts_with?(token, "whs_test_") do
          {:api_key, token}
        else
          # Try to decode as JWT
          case WebHostWeb.Token.verify(token) do
            {:ok, %{"sub" => user_id}} -> {:jwt, user_id}
            {:error, _} -> :anonymous
          end
        end

      _ ->
        # Check for API key in query params (for WebSocket connections)
        case conn.query_params do
          %{"token" => token} when is_binary(token) ->
            if String.starts_with?(token, "whs_live_") or String.starts_with?(token, "whs_test_") do
              {:api_key, token}
            else
              {:customer_token, token}
            end

          _ ->
            :anonymous
        end
    end
  end

  defp get_client_ip(conn) do
    # Check for forwarded headers first (load balancers, proxies)
    case get_req_header(conn, "x-forwarded-for") do
      [ip | _] -> ip
      [] ->
        case get_req_header(conn, "x-real-ip") do
          [ip] -> ip
          [] ->
            # Fallback to connection remote IP
            case conn.remote_ip do
              {a, b, c, d} -> "#{a}.#{b}.#{c}.#{d}"
              {a, b, c, d, e, f, g, h} ->
                # IPv6 - convert to string
                <<a::16, b::16, c::16, d::16, e::16, f::16, g::16, h::16>>
                |> :inet.ntoa()
                |> to_string()
            end
        end
    end
  end

  defp check_rate_limit(key, limit, window) do
    current_time = System.system_time(:second)
    window_start = current_time - window

    # Use Redis for distributed rate limiting
    redix_key = "#{key}:#{current_time}"

    case Redix.command(:redix, ["INCR", redix_key]) do
      {:ok, count} when count <= limit ->
        # Set expiry on the key
        Redix.command(:redix, ["EXPIRE", redix_key, window])
        {:ok, count}

      {:ok, _count} ->
        {:error, :rate_limited}

      {:error, _reason} ->
        # If Redis is unavailable, fail open (allow the request)
        # In production, you might want to fail closed
        IO.warn("Rate limiting Redis unavailable, allowing request")
        {:ok, 1}
    end
  end

  defp get_remaining(key, limit) do
    # Get current count from Redis
    current_time = System.system_time(:second)
    redix_key = "#{key}:#{current_time}"

    case Redix.command(:redix, ["GET", redix_key]) do
      {:ok, count} when is_binary(count) ->
        remaining = limit - String.to_integer(count)
        if remaining < 0, do: 0, else: remaining

      _ ->
        limit
    end
  end

  defp get_reset_time(window) do
    current_time = System.system_time(:second)
    next_window = current_time + window
    to_string(next_window)
  end
end
