# Hetzner + Fly.io Infrastructure Strategy

## Overview

This document outlines the new infrastructure strategy for WebHost Systems, replacing the home datacenter approach with a hybrid cloud model using Hetzner for hobby plans and Fly.io for production plans. This change dramatically improves economics, reduces risk, and provides professional infrastructure from day one.

## Executive Summary

**Key Changes:**
- **Hobby Tier ($15/mo)**: Hetzner dedicated servers (95%+ margin vs 20% on Fly.io)
- **Starter+ Tiers ($49+/mo)**: Fly.io multi-region (75-85% margin)
- **Break-even**: 5 customers (vs 15+ on Fly.io-only)
- **Year 1 Profit**: $30K+ (vs $12K on home datacenter)
- **Risk Profile**: Low (no hardware investment, professional SLAs)

---

## 🎯 Strategic Rationale

### Why This Change is a Game-Changer

1. **Economic Transformation**
   - Hobby tier margin: 20% → 95%+
   - Break-even time: 6-8 months → 4-8 weeks
   - No $2,300 upfront hardware investment
   - Professional infrastructure from day one

2. **Risk Reduction**
   - No physical security concerns
   - No 24/7 on-call responsibility
   - No home ISP dependency
   - Professional datacenter SLAs (99.9% uptime)

3. **Scalability & Professionalism**
   - US-based data centers (Ashburn, Hillsboro, Phoenix)
   - DDoS protection included
   - Easy upgrade/downgrade
   - Enterprise-grade infrastructure

---

## 🏗️ Infrastructure Architecture

### Hybrid Multi-Cloud Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    WebHost Systems                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │   Hobby Tier    │    │     Starter+ Tiers           │    │
│  │    ($15/mo)     │    │      ($49+/mo)               │    │
│  │                 │    │                             │    │
│  │  ┌───────────┐  │    │  ┌─────────────────────────┐ │    │
│  │  │ Hetzner   │  │    │  │     Fly.io Multi-Region │ │    │
│  │  │ Dedicated │  │    │  │   (Global Edge Network)  │ │    │
│  │  │  Servers  │  │    │  │                         │ │    │
│  │  │           │  │    │  │ ┌─────┐ ┌─────┐ ┌─────┐ │ │    │
│  │  │ ┌───────┐ │  │    │  │ │ US  │ │ EU  │ │ ASIA│ │ │    │
│  │  │ │AX52    │ │  │    │  │ └─────┘ └─────┘ └─────┘ │ │    │
│  │  │ │AX102   │ │  │    │  └─────────────────────────┘ │    │
│  │  │ └───────┘ │  │    └─────────────────────────────┘    │
│  │  └───────────┘  │                                       │
│  └─────────────────┘                                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Management & Control Plane                 │ │
│  │                                                     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │ │
│  │  │   GitHub    │  │   GitHub    │  │   Stripe    │  │ │
│  │  │   Actions   │  │   Packages  │  │  Billing    │  │ │
│  │  │             │  │             │  │             │  │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Component Details

#### Hetzner Infrastructure (Hobby Tier)

**Option 1: Hetzner AX52 (Launch)**
```
CPU: AMD Ryzen 9 5950X (16 cores, 32 threads)
RAM: 128GB DDR4 ECC
Storage: 2x 512GB NVMe (RAID 1)
Network: 1 Gbit/s (unlimited traffic)
Location: US (Ashburn, Hillsboro, or Phoenix)
Price: $65/month
Capacity: 150-200 hobby customers
```

**Option 2: Hetzner AX102 (Scale)**
```
CPU: AMD EPYC 7502P (32 cores, 64 threads)
RAM: 256GB DDR4 ECC
Storage: 2x 1.92TB NVMe (RAID 1)
Network: 1 Gbit/s
Price: $165/month
Capacity: 400-600 hobby customers
```

**Option 3: Hetzner Cloud CAX41 (Flex)**
```
CPU: 16 vCPUs Ampere Altra (ARM)
RAM: 32GB
Storage: 320GB NVMe
Network: 20TB traffic/month
Price: $32/month
Capacity: 80-100 hobby customers
```

#### Fly.io Infrastructure (Starter+ Tiers)

**Global Edge Network**
- **Regions**: US (East/West), EU (Frankfurt), Asia (Singapore)
- **Automatic Scaling**: Based on customer load
- **Edge Locations**: 20+ global locations
- **Pricing**: $25-50/customer/month based on tier

---

## 💰 Economic Analysis

### Cost Comparison: Updated

#### Hobby Tier ($15/month) - 50 Customers

| Infrastructure | Monthly Cost | Cost/Customer | Margin | Revenue | Profit |
|----------------|--------------|---------------|--------|---------|--------|
| **Home Datacenter** | $178 | $3.56 | 76% | $750 | $572 |
| **Hetzner AX52** | $65 | $1.30 | **91%** | $750 | **$685** |
| **Hetzner Cloud CAX41** | $32 | $0.64 | **96%** | $750 | **$718** |
| **Fly.io** | $600 | $12.00 | 20% | $750 | $150 |

#### Starter Tier ($49/month) - 20 Customers

| Infrastructure | Monthly Cost | Cost/Customer | Margin | Revenue | Profit |
|----------------|--------------|---------------|--------|---------|--------|
| **Hetzner AX52** | $65 | $3.25 | **93%** | $980 | **$915** |
| **Hetzner AX102** | $165 | $8.25 | **83%** | $980 | **$815** |
| **Fly.io** | $500 | $25.00 | 49% | $980 | $480 |

### Break-Even Analysis

#### Hetzner Cloud CAX41 ($32/month)
```
Break-even: 3 customers
Time to break-even: 2-4 weeks (realistic)
Profit at 50 customers: $718/month
ROI: 2,244%
```

#### Hetzner AX52 ($65/month)
```
Break-even: 5 customers
Time to break-even: 4-8 weeks (realistic)
Profit at 100 customers: $1,435/month
ROI: 2,208%
```

---

## 📈 Phased Rollout Strategy

### Phase 1: Launch (Month 1-3)
```
Infrastructure: 1x Hetzner Cloud CAX41 ($32/month)
Capacity: 80-100 hobby customers
Target: 30 customers
Cost: $32/month
Revenue: $450/month
Profit: $418/month (93% margin)
```

**Focus:**
- Core GPS tracking functionality
- Basic REST API
- Stripe integration
- Simple dashboard

### Phase 2: Growth (Month 4-8)
```
Infrastructure: 1x Hetzner AX52 ($65/month)
Capacity: 150-200 customers (all tiers)
Target: 50 hobby + 10 starter
Cost: $65/month
Revenue: $1,240/month
Profit: $1,175/month (95% margin)
```

**Focus:**
- Fix critical bugs
- Add most-requested features
- Improve documentation
- Customer success

### Phase 3: Scale (Month 9-12)
```
Infrastructure: 1x AX52 (hobby) + Fly.io regions (starter+)
Capacity: 150 hobby + unlimited paid tiers
Target: 100 hobby + 20 starter + 5 pro
Cost: $65 + $400 = $465/month
Revenue: $3,235/month
Profit: $2,770/month (86% margin)
```

**Focus:**
- Marketing & content
- API ecosystem
- Partner integrations
- Enterprise features

---

## 🔧 Technical Implementation

### Multi-Tenant Architecture

#### Customer Routing Logic

```elixir
defmodule WebHost.Infrastructure.Router do
  def route_customer(customer) do
    case customer.subscription.plan do
      %Plan{name: :hobby} -> 
        {:ok, get_hetzner_server(customer)}
      
      %Plan{name: :starter} -> 
        {:ok, get_flyio_region(customer, "us-east")}
      
      %Plan{name: :professional} -> 
        {:ok, get_flyio_region(customer, "global")}
      
      %Plan{name: :business} -> 
        {:ok, get_flyio_region(customer, "multi-region")}
    end
  end
  
  defp get_hetzner_server(customer) do
    # Load balancing logic for Hetzner servers
    server = :ets.lookup(:hetzner_servers, :available)
    |> Enum.random()
    
    %{host: server.ip, port: 4000, protocol: :http}
  end
  
  defp get_flyio_region(customer, region_type) do
    # Geographic routing logic
    region = case customer.location do
      "US" -> "us-east"
      "EU" -> "fra" 
      "ASIA" -> "sin"
      _ -> "us-east" # Default
    end
    
    %{host: "#{customer.slug}.fly.dev", port: 443, protocol: :https}
  end
end
```

#### Database Strategy

```elixir
# Hobby Tier - Single Hetzner Server
# PostgreSQL + TimescaleDB + PostGIS (local)

# Starter+ Tiers - Fly.io
# PostgreSQL + TimescaleDB + PostGIS (regional)
# Read replicas for global performance

# Sync Strategy
# Ash Framework handles multi-tenant data isolation
# Yjs handles offline-first sync
# Automatic failover between regions
```

---

## 🚀 Deployment Architecture

### Hetzner Deployment (Hobby)

```bash
# 1. Server Provisioning
hetzner server create \
  --type ax52 \
  --location nbg1 \
  --image ubuntu-22.04 \
  --ssh-key webhost-prod

# 2. Docker Setup
curl -fsSL https://get.docker.com | sh
docker-compose up -d

# 3. Application Deployment
git clone https://github.com/webhost/systems
cd systems
mix release
./_build/prod/rel/webhost/bin/webhost start
```

### Fly.io Deployment (Starter+)

```bash
# 1. App Creation
fly launch --region us-east
fly scale count 2 --region us-east
fly scale count 1 --region fra
fly scale count 1 --region sin

# 2. Database Setup
fly postgres create --region us-east
fly postgres attach --app webhost-prod

# 3. Application Deployment
fly deploy
fly secrets set DATABASE_URL=...
fly secrets set SECRET_KEY_BASE=...
```

---

## 📊 Monitoring & Observability

### Hetzner Monitoring

```elixir
# lib/webhost/monitoring/hetzner.ex
defmodule WebHost.Monitoring.Hetzner do
  def check_server_health(server) do
    # CPU, RAM, Disk usage
    # Network latency
    # Database performance
    # Backup status
  end
  
  def auto_scale() do
    customers = count_hobby_customers()
    capacity = get_server_capacity()
    
    if customers / capacity > 0.8 do
      provision_new_server()
    end
  end
end
```

### Fly.io Monitoring

```elixir
# lib/webhost/monitoring/flyio.ex
defmodule WebHost.Monitoring.FlyIO do
  def check_region_health(region) do
    # Response times
    # Error rates
    # Resource usage
    # Database replication lag
  end
  
  def geo_routing() do
    # Route customers to nearest region
    # Automatic failover
    # Load balancing
  end
end
```

---

## 🔒 Security & Compliance

### Hetzner Security

- **DDoS Protection**: Included (up to 10Gbps)
- **Firewall**: Hetzner Cloud Firewall
- **Backups**: Automated daily snapshots
- **SSL**: Let's Encrypt certificates
- **Compliance**: US-based infrastructure (US data privacy)

### Fly.io Security

- **DDoS Protection**: Fly.io edge network
- **Firewall**: Fly.io platform security
- **Backups**: Automated point-in-time recovery
- **SSL**: Automatic TLS certificates
- **Compliance**: SOC 2, GDPR, HIPAA eligible

---

## 🔄 Migration Strategy

### From Home Datacenter to Hetzner

```bash
# Phase 1: Parallel Operation
1. Set up Hetzner server
2. Sync database to Hetzner
3. Test with subset of customers
4. Monitor performance

# Phase 2: Gradual Migration
1. Migrate 10% of hobby customers
2. Monitor for issues
3. Continue 10% increments
4. Full migration within 2 weeks

# Phase 3: Decommission
1. Run home server for 1 month as backup
2. Decommission home hardware
3. Update documentation
```

---

## 📈 Financial Projections

### Year 1 (Conservative)
```
Customers: 100 hobby + 15 starter + 3 pro
Revenue: $2,682/month × 12 = $32,184/year
Costs: $265/month × 12 = $3,180/year
Profit: $28,944/year
Margin: 90%
Time investment: 300 hours
Hourly rate: $96/hour (good!)
```

### Year 2 (Moderate)
```
Customers: 200 hobby + 40 starter + 12 pro
Revenue: $6,408/month × 12 = $76,896/year
Costs: $665/month × 12 = $7,980/year
Profit: $68,916/year
Margin: 90%
Time investment: 200 hours (maintenance)
Hourly rate: $345/hour (excellent!)
```

### Year 3 (Optimistic)
```
Customers: 300 hobby + 80 starter + 30 pro + 8 business
Revenue: $13,412/month × 12 = $160,944/year
Costs: $1,530/month × 12 = $18,360/year
Profit: $142,584/year
Margin: 89%
Time investment: 400 hours (scaling)
Hourly rate: $356/hour (amazing!)
```

---

## 🎯 Action Plan: Start TODAY

### Week 1: Setup ($100)
```bash
1. Register domain: webhost.systems ($15/year)
2. Hetzner Cloud CAX41: $32/month
3. Hetzner Storage Box: $3/month (backups)
4. Stripe account: $0 (free)
5. Email service: $10/month (Postmark)
Total: ~$50 first month
```

### Week 2-3: MVP Development (60 hours)
```
- Phoenix + Ash Framework setup
- Basic GPS tracking (TimescaleDB)
- REST API with API key auth
- Stripe billing integration
- Simple dashboard (LiveView)
```

### Week 4: Launch (20 hours)
```
- Deploy to Hetzner
- Documentation
- Landing page
- Product Hunt launch
- Indie Hackers post
```

### Month 2: First Customers
```
Goal: 10 paying customers = $150/month
Profit: $118/month (79% margin)
Status: Profitable!
```

---

## 🏆 Final Verdict: BUILD IT

**This is now a no-brainer:**

1. **Start with Hetzner Cloud CAX41** ($32/month)
2. **Build simplified MVP** (skip Yjs initially)
3. **Launch in 4 weeks**
4. **Get to 10 customers** (1-2 months)
5. **Upgrade to AX52** when you hit 50 customers
6. **Add Fly.io** for enterprise customers later

**Expected outcome:**
- Month 6: $1,000/month profit (part-time income)
- Month 12: $2,500/month profit (serious side business)
- Month 24: $5,000/month profit (could quit job)

**Risk level:** LOW (only $32/month + your time)

**This is the best side-project-to-business path I've seen. The economics are incredible with Hetzner.** 🚀

---

## 📚 Next Steps

1. **Update PHASE0.md** with Hetzner + Fly.io infrastructure
2. **Create Hetzner setup guide** for automated provisioning
3. **Create Fly.io deployment guide** for multi-region setup
4. **Update economic analysis** with new cost structure
5. **Update architecture diagrams** to reflect hybrid approach
6. **Create migration guide** from home datacenter approach

Ship it! 🚀