defmodule WebHost.Repo.Migrations.CreateSyncUpdates do
  use Ecto.Migration

  def change do
    create table(:sync_updates, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :document_id, :string, null: false
      add :customer_id, :binary_id, null: false
      add :update_data, :binary, null: false
      add :update_version, :integer, null: false
      add :created_at, :utc_datetime_usec, null: false
      add :metadata, :map, default: %{}

      timestamps()
    end

    # Indexes for efficient querying
    create index(:sync_updates, [:document_id, :customer_id])
    create index(:sync_updates, [:customer_id, :created_at])
    create index(:sync_updates, [:document_id, :update_version])

    # Add foreign key constraint
    alter table(:sync_updates) do
      modify :customer_id, references(:customers, type: :binary_id, on_delete: :delete_all)
    end
  end
end
