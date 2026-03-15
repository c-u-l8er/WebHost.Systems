#!/bin/bash
# Fly.io Backup Scripts for WebHost Systems
# This script automates database backups for Fly.io PostgreSQL instances

set -euo pipefail

# Configuration
FLY_APP_NAME="${FLY_APP_NAME:-webhost-prod}"
DB_NAME="${DB_NAME:-webhost-prod-db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
S3_BUCKET="${S3_BUCKET:-webhost-backups}"  # Optional: for offsite backup

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if flyctl is installed
check_flyctl() {
    if ! command -v flyctl &> /dev/null; then
        log_error "flyctl is not installed. Please install it first:"
        echo "curl -L https://fly.io/install.sh | sh"
        exit 1
    fi
}

# Check if user is authenticated with Fly.io
check_auth() {
    if ! flyctl auth whoami &> /dev/null; then
        log_error "Not authenticated with Fly.io. Run 'flyctl auth login' first."
        exit 1
    fi
}

# Create backup directory
create_backup_dir() {
    mkdir -p "$BACKUP_DIR"
    log_info "Backup directory: $BACKUP_DIR"
}

# Create database backup
create_backup() {
    local timestamp=$(date -u +"%Y%m%d_%H%M%S")
    local backup_file="${BACKUP_DIR}/${DB_NAME}_${timestamp}.dump"
    
    log_info "Creating backup of $DB_NAME..."
    
    if flyctl pg backup create -a "$DB_NAME" --output "$backup_file"; then
        log_info "Backup created: $backup_file"
        echo "$backup_file"
    else
        log_error "Failed to create backup"
        exit 1
    fi
}

# List existing backups
list_backups() {
    log_info "Listing available backups:"
    flyctl pg backup list -a "$DB_NAME"
}

# Delete old backups (local cleanup)
cleanup_old_backups() {
    log_info "Cleaning up local backups older than $RETENTION_DAYS days..."
    
    find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -type f -mtime +$RETENTION_DAYS -exec rm -v {} \;
    
    log_info "Local cleanup completed"
}

# Upload backup to S3 (optional)
upload_to_s3() {
    local backup_file="$1"
    
    if [[ -n "${S3_BUCKET:-}" ]] && command -v aws &> /dev/null; then
        log_info "Uploading backup to S3: $S3_BUCKET"
        
        local s3_key="backups/$(basename "$backup_file")"
        
        if aws s3 cp "$backup_file" "s3://$S3_BUCKET/$s3_key"; then
            log_info "Backup uploaded to S3 successfully"
        else
            log_warn "Failed to upload to S3"
        fi
    else
        log_warn "S3 bucket not configured or AWS CLI not installed. Skipping S3 upload."
    fi
}

# Restore database from backup
restore_backup() {
    local backup_file="$1"
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi
    
    log_warn "WARNING: This will replace all data in $DB_NAME"
    read -p "Are you sure you want to continue? (yes/no): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Restoring database from $backup_file..."
        
        if flyctl pg backup restore -a "$DB_NAME" "$backup_file"; then
            log_info "Database restored successfully"
        else
            log_error "Failed to restore database"
            exit 1
        fi
    else
        log_info "Restore cancelled"
    fi
}

# Verify backup integrity
verify_backup() {
    local backup_file="$1"
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
        return 1
    fi
    
    # Check file size
    local file_size=$(stat -f%z "$backup_file" 2>/dev/null || stat -c%s "$backup_file" 2>/dev/null)
    
    if [[ $file_size -lt 1000 ]]; then
        log_error "Backup file seems too small: $file_size bytes"
        return 1
    fi
    
    # Try to read the backup header
    if pg_restore --list "$backup_file" &> /dev/null; then
        log_info "Backup file appears to be valid"
        return 0
    else
        log_error "Backup file appears to be corrupted"
        return 1
    fi
}

# Generate backup report
generate_report() {
    local report_file="${BACKUP_DIR}/backup_report_$(date -u +"%Y%m%d").txt"
    
    {
        echo "WebHost Systems Backup Report"
        echo "Generated: $(date -u)"
        echo "================================"
        echo ""
        echo "Database: $DB_NAME"
        echo "App: $FLY_APP_NAME"
        echo ""
        echo "Recent Backups:"
        ls -lh "$BACKUP_DIR"/${DB_NAME}_*.dump | tail -10
        echo ""
        echo "Total Backups: $(ls -1 "$BACKUP_DIR"/${DB_NAME}_*.dump 2>/dev/null | wc -l)"
        echo "Total Size: $(du -sh "$BACKUP_DIR"/${DB_NAME}_*.dump 2>/dev/null | tail -1 | cut -f1)"
    } > "$report_file"
    
    log_info "Backup report generated: $report_file"
}

# Main function
main() {
    local command="${1:-backup}"
    
    case "$command" in
        "backup")
            check_flyctl
            check_auth
            create_backup_dir
            backup_file=$(create_backup)
            upload_to_s3 "$backup_file"
            verify_backup "$backup_file"
            cleanup_old_backups
            generate_report
            log_info "Backup process completed successfully"
            ;;
            
        "list")
            check_flyctl
            check_auth
            list_backups
            ;;
            
        "restore")
            check_flyctl
            check_auth
            if [[ -z "${2:-}" ]]; then
                log_error "Please provide backup file path"
                echo "Usage: $0 restore <backup_file>"
                exit 1
            fi
            restore_backup "$2"
            ;;
            
        "cleanup")
            create_backup_dir
            cleanup_old_backups
            ;;
            
        "verify")
            if [[ -z "${2:-}" ]]; then
                log_error "Please provide backup file path"
                echo "Usage: $0 verify <backup_file>"
                exit 1
            fi
            verify_backup "$2"
            ;;
            
        "report")
            create_backup_dir
            generate_report
            ;;
            
        *)
            echo "WebHost Systems Backup Script"
            echo "Usage: $0 {backup|list|restore|cleanup|verify|report}"
            echo ""
            echo "Commands:"
            echo "  backup    - Create a new database backup"
            echo "  list      - List available backups"
            echo "  restore   - Restore from backup file"
            echo "  cleanup   - Delete old local backups"
            echo "  verify    - Verify backup integrity"
            echo "  report    - Generate backup report"
            echo ""
            echo "Environment variables:"
            echo "  FLY_APP_NAME - Fly.io app name (default: webhost-prod)"
            echo "  DB_NAME      - Database name (default: webhost-prod-db)"
            echo "  BACKUP_DIR   - Backup directory (default: ./backups)"
            echo "  RETENTION_DAYS - Backup retention in days (default: 30)"
            echo "  S3_BUCKET    - S3 bucket for offsite backup (optional)"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"