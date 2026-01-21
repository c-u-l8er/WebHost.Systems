
# WebHost Systems Disaster Recovery Plan

This document outlines the disaster recovery procedures for WebHost Systems, including recovery time objectives (RTO), recovery point objectives (RPO), and step-by-step recovery procedures.

## Overview

WebHost Systems uses a multi-cloud architecture with automated backups and redundancy to ensure high availability and quick recovery from disasters.

## Recovery Objectives

| Metric | Target | Description |
|--------|--------|-------------|
| **RTO (Recovery Time Objective)** | 4 hours | Maximum time to restore service after disaster |
| **RPO (Recovery Point Objective)** | 1 hour | Maximum acceptable data loss |
| **Availability SLA** | 99.9% | Minimum uptime guarantee |
| **Data Retention** | 30 days | Backup retention period |

## Disaster Scenarios

### 1. Database Failure

**Severity**: Critical
**Impact**: Complete service outage
**RTO**: 2 hours
**RPO**: 15 minutes

#### Recovery Steps:

1. **Assess the Situation**
   ```bash
   # Check database status
   flyctl pg status -a webhost-prod-db
   
   # Check recent errors
   flyctl logs -a webhost-prod-db --since 1h
   ```

2. **Attempt Database Restart**
   ```bash
   # Restart PostgreSQL
   flyctl pg restart -a webhost-prod-db
   
   # Wait 5 minutes and check status
   flyctl pg status -a webhost-prod-db
   ```

3. **Restore from Backup if Restart Fails**
   ```bash
   # List available backups
   flyctl pg backup list -a webhost-prod-db
   
   # Restore from latest backup
   ./scripts/flyio-backup.sh restore /path/to/latest/backup.dump
   ```

4. **Verify Data Integrity**
   ```bash
   # Connect to database and verify
   flyctl pg connect -a webhost-prod-db -c "SELECT COUNT(*) FROM customers;"
   ```

5. **Restart Application Services**
   ```bash
   # Restart web application
   flyctl restart -a webhost-prod
   
   # Verify service health
   curl https://webhost-prod.fly.dev/health
   ```

### 2. Application Server Failure

**Severity**: High
**Impact**: Service degradation or outage
**RTO**: 30 minutes
**RPO**: 0 (no data loss)

#### Recovery Steps:

1. **Check Application Status**
   ```bash
   # Check app status
   flyctl status -a webhost-prod
   
   # Check recent deployments
   flyctl deployments -a webhost-prod
   ```

2. **Restart Application**
   ```bash
   # Restart all instances
   flyctl restart -a webhost-prod
   
   # Or restart specific machines
   flyctl machine restart -a webhost-prod <machine-id>
   ```

3. **Roll Back if Needed**
   ```bash
   # List recent deployments
   flyctl deployments -a webhost-prod
   
   # Roll back to previous version
   flyctl rollback -a webhost-prod <deployment-id>
   ```

4. **Scale if Necessary**
   ```bash
   # Scale up to handle load
   flyctl scale count 3 -a webhost-prod
   ```

### 3. Hetzner Server Failure

**Severity**: Critical (for hobby tier customers)
**Impact**: Complete outage for affected customers
**RTO**: 4 hours
**RPO**: 1 hour

#### Recovery Steps:

1. **Assess Server Status**
   ```bash
   # Check server status via Hetzner API
   curl -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        https://api.hetzner.cloud/v1/servers/$SERVER_ID
   ```

2. **Attempt Server Recovery**
   ```bash
   # Reboot server
   curl -X POST \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"reboot_type":"soft"}' \
        https://api.hetzner.cloud/v1/servers/$SERVER_ID/actions/reboot
   ```

3. **Provision Replacement Server if Needed**
   ```bash
   # Create new server
   curl -X POST \
        -H "Authorization: Bearer $HETZNER_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d @new-server-config.json \
        https://api.hetzner.cloud/v1/servers
   ```

4. **Restore from Backup**
   ```bash
   # Restore database
   ./scripts/hetzner-backup.sh restore latest
   
   # Restore application files
   rsync -av backup@storage:/backups/app/ /var/www/webhost/
   ```

5. **Update DNS and Configuration**
   ```bash
   # Update DNS to point to new server
   # (automated via Cloudflare API)
   ```

### 4. DNS/Domain Issues

**Severity**: High
**Impact**: Service inaccessible
**RTO**: 1 hour
**RPO**: 0

#### Recovery Steps:

1. **Check DNS Status**
   ```bash
   # Check DNS propagation
   dig webhost.systems
   
   # Check Cloudflare status
   curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        https://api.cloudflare.com/client/v4/zones
   ```

2. **Verify DNS Records**
   ```bash
   # List all DNS records
   curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"
   ```

3. **Update Records if Needed**
   ```bash
   # Update A record
   curl -X PUT \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"type":"A","name":"@","content":"NEW_IP","ttl":300}' \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID"
   ```

### 5. Complete Region Outage

**Severity**: Critical
**Impact**: Regional service outage
**RTO**: 4 hours
**RPO**: 1 hour

#### Recovery Steps:

1. **Activate Disaster Recovery Site**
   ```bash
   # Switch to backup region
   flyctl regions switch fra -a webhost-prod
   
   # Update DNS to point to backup region
   # (automated via failover script)
   ```

2. **Promote Replica Database**
   ```bash
   # Promote read replica to primary
   flyctl pg promote -a webhost-prod-db-replica
   ```

3. **Update Application Configuration**
   ```bash
   # Update database connection strings
   flyctl secrets set DATABASE_URL=new_primary_url -a webhost-prod
   ```

4. **Verify Service Health**
   ```bash
   # Test all endpoints
   curl https://webhost-prod.fly.dev/health
   
   # Run smoke tests
   mix test --only smoke
   ```
   
   ### 6. Hetzner Storage Box Failure
   
   **Severity**: High
   **Impact**: Backup storage unavailable, potential data loss
   **RTO**: 2 hours
   **RPO**: 24 hours (last successful backup)
   
   #### Recovery Steps:
   
   1. **Check Storage Box Status**
      ```bash
      # Check storage box connectivity
      ssh backup@storage.box.hetzner.com "df -h"
      
      # Check backup integrity
      ssh backup@storage.box.hetzner.com "ls -la /backups/"
      ```
   
   2. **Attempt Storage Box Recovery**
      ```bash
      # Restart storage box services
      ssh backup@storage.box.hetzner.com "sudo systemctl restart sshd"
      
      # Check disk space
      ssh backup@storage.box.hetzner.com "du -sh /backups/*"
      ```
   
   3. **Provision Replacement Storage Box if Needed**
      ```bash
      # Order new storage box via Hetzner API
      curl -X POST \
           -H "Authorization: Bearer $HETZNER_API_TOKEN" \
           -H "Content-Type: application/json" \
           -d '{"name":"backup-replacement","server_type":"storage-box","location":"nbg1"}' \
           https://api.hetzner.cloud/v1/storage_boxes
      
      # Transfer backups to new storage
      rsync -av --progress old-storage:/backups/ new-storage:/backups/
      ```
   
   4. **Verify Backup Chain Integrity**
      ```bash
      # Verify latest database backup
      gunzip -t /backups/db_$(date +%Y%m%d).sql.gz
      
      # Verify sync updates backup
      tar -tzf /backups/sync_$(date +%Y%m%d_%H).tar.gz | head -10
      ```
   
   ### 7. Docker Container Failure on Hetzner
   
   **Severity**: Medium
   **Impact**: Application service unavailable
   **RTO**: 30 minutes
   **RPO**: 0 (no data loss)
   
   #### Recovery Steps:
   
   1. **Check Container Status**
      ```bash
      # Check running containers
      docker ps -a
      
      # Check container logs
      docker logs webhost-app --tail 100
      ```
   
   2. **Restart Failed Containers**
      ```bash
      # Restart all services
      cd /var/www/webhost
      docker-compose restart
      
      # Or restart specific service
      docker-compose restart webhost-app
      ```
   
   3. **Rebuild Container if Needed**
      ```bash
      # Pull latest image
      docker-compose pull webhost-app
      
      # Rebuild and restart
      docker-compose up -d --force-recreate webhost-app
      ```
   
   4. **Verify Application Health**
      ```bash
      # Check health endpoint
      curl -f http://localhost:4000/health || echo "Health check failed"
      
      # Check database connectivity
      docker-compose exec webhost-app mix ecto.ping
      ```
   
   ### 8. Cross-Infrastructure Failover (Hetzner → Fly.io)
   
   **Severity**: Critical
   **Impact**: Emergency migration during extended Hetzner outage
   **RTO**: 4 hours
   **RPO**: 1 hour
   
   #### Recovery Steps:
   
   1. **Declare Emergency Failover**
      ```bash
      # Trigger emergency workflow
      ./scripts/emergency-failover.sh trigger hetzner-to-flyio
      ```
   
   2. **Provision Emergency Fly.io Resources**
      ```bash
      # Scale up Fly.io to handle hobby tier load
      flyctl scale count 5 -a webhost-prod
      flyctl scale memory 2048 -a webhost-prod
      
      # Provision temporary database
      flyctl pg create --name webhost-emergency-db --region fra
      ```
   
   3. **Export Latest Hetzner Data**
      ```bash
      # Export customer data
      ./scripts/hetzner-backup.sh export-customers
      
      # Export GPS data (last 24 hours)
      ./scripts/hetzner-backup.sh export-gps --since "24 hours ago"
      
      # Export sync updates
      ./scripts/hetzner-backup.sh export-sync-updates
      ```
   
   4. **Import to Fly.io**
      ```bash
      # Import to emergency database
      flyctl pg import -a webhost-emergency-db /tmp/customer_export.sql
      flyctl pg import -a webhost-emergency-db /tmp/gps_export.sql
      flyctl pg import -a webhost-emergency-db /tmp/sync_export.sql
      ```
   
   5. **Update DNS Configuration**
      ```bash
      # Update DNS to point to Fly.io
      curl -X PUT \
           -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
           -H "Content-Type: application/json" \
           -d '{"type":"A","name":"@","content":"FLY_IO_IP","ttl":60}' \
           "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID"
      ```
   
   6. **Verify Emergency Operations**
      ```bash
      # Test API endpoints
      curl https://webhost-prod.fly.dev/api/health
      
      # Verify customer access
      curl -H "Authorization: Bearer $TEST_API_KEY" \
           https://webhost-prod.fly.dev/api/vehicles
      ```
   
   ## Hetzner-Specific Recovery Procedures
   
   ### Storage Box Backup & Restore
   
   #### Daily Backup Verification
   ```bash
   #!/bin/bash
   # /scripts/verify-hetzner-backups.sh
   
   DATE=$(date +%Y%m%d)
   BACKUP_DIR="/backups"
   
   # Verify database backup exists and is valid
   if [ -f "$BACKUP_DIR/db_$DATE.sql.gz" ]; then
       echo "✓ Database backup exists"
       if gunzip -t "$BACKUP_DIR/db_$DATE.sql.gz"; then
           echo "✓ Database backup is valid"
       else
           echo "✗ Database backup is corrupted"
           exit 1
       fi
   else
       echo "✗ Database backup missing"
       exit 1
   fi
   
   # Verify sync updates backup
   SYNC_BACKUP=$(find $BACKUP_DIR -name "sync_$DATE_*.tar.gz" | sort | tail -1)
   if [ -n "$SYNC_BACKUP" ]; then
       echo "✓ Sync updates backup exists"
       if tar -tzf "$SYNC_BACKUP" >/dev/null 2>&1; then
           echo "✓ Sync updates backup is valid"
       else
           echo "✗ Sync updates backup is corrupted"
           exit 1
       fi
   else
       echo "✗ Sync updates backup missing"
       exit 1
   fi
   
   echo "All backups verified successfully"
   ```
   
   #### Complete Storage Box Restore
   ```bash
   #!/bin/bash
   # /scripts/restore-hetzner-storage.sh
   
   BACKUP_DATE=$1
   if [ -z "$BACKUP_DATE" ]; then
       BACKUP_DATE=$(date +%Y%m%d)
   fi
   
   BACKUP_DIR="/backups"
   DB_BACKUP="$BACKUP_DIR/db_$BACKUP_DATE.sql.gz"
   SYNC_BACKUP=$(find $BACKUP_DIR -name "sync_$BACKUP_DATE_*.tar.gz" | sort | tail -1)
   
   echo "Restoring from backup date: $BACKUP_DATE"
   
   # Stop application services
   docker-compose stop webhost-app
   
   # Restore database
   if [ -f "$DB_BACKUP" ]; then
       echo "Restoring database..."
       gunzip -c "$DB_BACKUP" | psql -U postgres webhost_prod
       echo "✓ Database restored"
   else
       echo "✗ Database backup not found: $DB_BACKUP"
       exit 1
   fi
   
   # Restore sync updates
   if [ -f "$SYNC_BACKUP" ]; then
       echo "Restoring sync updates..."
       tar -xzf "$SYNC_BACKUP" -C /var/lib/postgresql/
       chown -R postgres:postgres /var/lib/postgresql/sync_updates/
       echo "✓ Sync updates restored"
   else
       echo "✗ Sync updates backup not found"
       exit 1
   fi
   
   # Restart services
   docker-compose start webhost-app
   
   # Verify restoration
   sleep 10
   if curl -f http://localhost:4000/health; then
       echo "✓ Application restored successfully"
   else
       echo "✗ Application health check failed"
       exit 1
   fi
   ```
   
   ### Docker Container Recovery
   
   #### Container Health Monitoring
   ```bash
   #!/bin/bash
   # /scripts/monitor-docker-health.sh
   
   CONTAINER_NAME="webhost-app"
   MAX_RESTARTS=3
   RESTART_COUNT=0
   
   check_container() {
       if ! docker ps | grep -q $CONTAINER_NAME; then
           echo "Container $CONTAINER_NAME is not running"
           
           if [ $RESTART_COUNT -lt $MAX_RESTARTS ]; then
               echo "Attempting restart ($((RESTART_COUNT + 1))/$MAX_RESTARTS)"
               docker-compose restart $CONTAINER_NAME
               RESTART_COUNT=$((RESTART_COUNT + 1))
               sleep 30
               return 1
           else
               echo "Maximum restart attempts reached"
               return 2
           fi
       fi
       
       # Check health endpoint
       if curl -f http://localhost:4000/health >/dev/null 2>&1; then
           echo "✓ Container is healthy"
           RESTART_COUNT=0
           return 0
       else
           echo "Container health check failed"
           return 1
       fi
   }
   
   # Monitor for 5 minutes
   for i in {1..10}; do
       check_container
       case $? in
           0) echo "Container is healthy"; exit 0 ;;
           1) echo "Retrying..." ;;
           2) echo "Container recovery failed"; exit 1 ;;
       esac
       sleep 30
   done
   ```
   
   #### Complete Container Rebuild
   ```bash
   #!/bin/bash
   # /scripts/rebuild-container.sh
   
   echo "Rebuilding WebHost container..."
   
   # Backup current configuration
   docker-compose config > docker-compose.backup.yml
   
   # Pull latest images
   docker-compose pull
   
   # Stop all services
   docker-compose down
   
   # Clean up unused images and containers
   docker system prune -f
   
   # Rebuild and start services
   docker-compose up -d --build
   
   # Wait for services to start
   sleep 60
   
   # Verify all services are running
   if docker-compose ps | grep -q "Up"; then
       echo "✓ Services rebuilt successfully"
   else
       echo "✗ Some services failed to start"
       docker-compose logs
       exit 1
   fi
   
   # Run health checks
   if curl -f http://localhost:4000/health; then
       echo "✓ Application is healthy"
   else
       echo "✗ Application health check failed"
       exit 1
   fi
   ```
   
   ## Backup and Recovery Procedures

### Automated Backups

#### Fly.io (Production)
```bash
# Daily automated backups
0 2 * * * cd /app && ./scripts/flyio-backup.sh backup

# Weekly verification
0 6 * * 0 cd /app && ./scripts/flyio-backup.sh verify latest
```

#### Hetzner (Hobby Tier)
```bash
# Daily database backups
0 2 * * * pg_dump webhost_prod | gzip > /backups/db_$(date +\%Y\%m\%d).sql.gz

# Hourly sync updates backup
0 * * * * tar -czf /backups/sync_$(date +\%Y\%m\%d_\%H).tar.gz /var/lib/postgresql/sync_updates/
```

### Manual Backup Procedures

#### Create Full Backup
```bash
# Fly.io
./scripts/flyio-backup.sh backup

# Hetzner
./scripts/hetzner-backup.sh full
```

#### Verify Backup Integrity
```bash
# Fly.io
./scripts/flyio-backup.sh verify /path/to/backup.dump

# Hetzner
./scripts/hetzner-backup.sh verify /path/to/backup.tar.gz
```

### Restoration Procedures

#### Database Restoration
```bash
# Fly.io
flyctl pg backup restore -a webhost-prod-db /path/to/backup.dump

# Hetzner
gunzip -c /backups/db_20240101.sql.gz | psql webhost_prod
```

#### Application Restoration
```bash
# Restore application code
git checkout <stable-tag>
mix deps.get --only prod
mix release

# Restart services
sudo systemctl restart webhost
```

## Communication Plan

### Internal Notification

1. **Immediate (0-15 minutes)**
   - Alert on-call engineering team
   - Create incident channel
   - Initial assessment

2. **Update (15-60 minutes)**
   - Status update to team
   - Assign incident commander
   - Begin recovery procedures

3. **Resolution (1-4 hours)**
   - Service restored notification
   - Post-mortem scheduled
   - Documentation updates

### Customer Communication

1. **Service Disruption (>5 minutes)**
   - Update status page
   - Post on Twitter
   - Send email to affected customers

2. **Extended Outage (>30 minutes)**
   - Detailed status update
   - Estimated recovery time
   - Alternative access methods if available

3. **Resolution**
   - Service restored notification
   - Incident summary
   - Credit/compensation if applicable

## Testing and Drills

### Monthly Tests

1. **Backup Verification**
   - Restore latest backup to staging
   - Verify data integrity
   - Test application functionality

2. **Failover Testing**
   - Test DNS failover
   - Verify backup region access
   - Measure recovery time

### Quarterly Drills

1. **Full Disaster Simulation**
   - Simulate complete region outage
   - Execute full recovery plan
   - Document lessons learned

2. **Cross-Team Coordination**
   - Involve all stakeholders
   - Test communication procedures
   - Review SLA compliance

## Contact Information

### Emergency Contacts

| Role | Person | Contact | Backup |
|------|--------|---------|--------|
| Incident Commander | [Name] | [Phone/Email] | [Backup Name] |
| Engineering Lead | [Name] | [Phone/Email] | [Backup Name] |
| DevOps Engineer | [Name] | [Phone/Email] | [Backup Name] |
| Customer Support | [Name] | [Phone/Email] | [Backup Name] |

### Service Providers

| Service | Contact | Priority |
|---------|---------|----------|
| Fly.io Support | support@fly.io | High |
| Hetzner Support | support@hetzner.com | High |
| Cloudflare Support | support@cloudflare.com | Medium |
| Stripe Support | support@stripe.com | Low |

## Checklist

### Pre-Disaster Preparation

- [ ] Backups are current and verified
- [ ] Documentation is up to date
- [ ] Emergency contacts are current
- [ ] Access credentials are secure and accessible
- [ ] Monitoring alerts are configured
- [ ] Status page is operational

### During Disaster Response

- [ ] Incident declared and team notified
- [ ] Severity assessed and documented
- [ ] Recovery plan initiated
- [ ] Customers informed if necessary
- [ ] Progress tracked and communicated
- [ ] Resolution verified

### Post-Disaster Review

- [ ] Post-mortem conducted
- [ ] Lessons learned documented
- [ ] Procedures updated
- [ ] Customers notified of resolution
- [ ] SLA credits applied if needed
- [ ] Prevention measures implemented

## Appendix

### Useful Commands

```bash
# Check system health
flyctl status -a webhost-prod
flyctl pg status -a webhost-prod-db

# View logs
flyctl logs -a webhost-prod --since 1h
flyctl logs -a webhost-prod-db --since 1h

# Scale resources
flyctl scale count 3 -a webhost-prod
flyctl scale memory 1024 -a webhost-prod

# Database operations
flyctl pg connect -a webhost-prod-db
flyctl pg backup create -a webhost-prod-db
flyctl pg backup list -a webhost-prod-db
```

### Recovery Time Targets by Component

| Component | RTO | RPO | Notes |
|-----------|-----|-----|-------|
| Database (Fly.io) | 2 hours | 15 minutes | Automated backups |
| Database (Hetzner) | 4 hours | 1 hour | Manual intervention |
| Application Server (Fly.io) | 30 minutes | 0 | Auto-scaling available |
| Application Server (Hetzner) | 2 hours | 0 | Requires manual restart |
| DNS/Domain | 1 hour | 0 | Cloudflare redundancy |
| Complete Region Outage | 4 hours | 1 hour | Multi-region failover |