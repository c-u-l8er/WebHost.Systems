defmodule WebHost.Repo.Migrations.AddMissingIndexes do
  use Ecto.Migration

  def change do
    # Index for geofence lookups mentioned in PHASE1.md
    create index(:vehicles, [:customer_id, :status])

    # Additional performance indexes for multi-tenant queries
    create index(:gps_positions, [:customer_id, :vehicle_id])
    create index(:gps_positions, [:customer_id, :time])

    # Indexes for API key lookups
    create index(:api_keys, [:key_prefix])
    create index(:api_keys, [:customer_id, :status])

    # Indexes for subscription queries
    create index(:subscriptions, [:customer_id, :status])
    create index(:subscriptions, [:plan_id, :status])

    # Indexes for deployment queries
    create index(:deployments, [:customer_id, :status])
    create index(:deployments, [:status, :created_at])

    # Composite index for sync_updates queries
    create index(:sync_updates, [:customer_id, :document_id, :created_at])
  end
end
