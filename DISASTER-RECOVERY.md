
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
| Database (Hetzner) | 4 hours | 1 hour | Manual intervention