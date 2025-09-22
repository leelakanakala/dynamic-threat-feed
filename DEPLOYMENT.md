# Deployment Guide

This guide provides step-by-step instructions for deploying the Dynamic Threat Feed system to Cloudflare Workers.

## Prerequisites

Before you begin, ensure you have:

1. **Cloudflare Account**: Free or paid account with Workers enabled
2. **Node.js**: Version 18 or higher
3. **npm**: Comes with Node.js
4. **Wrangler CLI**: Cloudflare's command-line tool

## Step 1: Install Wrangler CLI

```bash
# Install Wrangler globally
npm install -g wrangler

# Verify installation
wrangler --version
```

## Step 2: Authenticate with Cloudflare

```bash
# Login to your Cloudflare account
wrangler login

# This will open a browser window for authentication
# Follow the prompts to authorize Wrangler
```

## Step 3: Get Your Account ID

```bash
# List your accounts to get the Account ID
wrangler whoami

# Or get it from the Cloudflare dashboard:
# Dashboard > Right sidebar > Account ID
```

## Step 4: Create Cloudflare API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Custom token" template
4. Configure permissions:
   - **Account**: `Cloudflare Intelligence:Edit`
   - **Zone**: `Zone Settings:Read` (if needed)
5. Set Account Resources to include your account
6. Click "Continue to summary" and "Create Token"
7. **Save the token securely** - you won't see it again

## Step 5: Create KV Namespace

```bash
# Navigate to your project directory
cd ~/Documents/Projects/dynamic-threat-feed

# Create KV namespace for threat data storage
wrangler kv:namespace create "THREAT_DATA"

# Example output:
# 🌀 Creating namespace with title "dynamic-threat-feed-THREAT_DATA"
# ✨ Success!
# Add the following to your configuration file in your kv_namespaces array:
# { binding = "THREAT_DATA", id = "abc123def456ghi789" }
```

## Step 6: Update Configuration

### Update wrangler.toml

Replace the placeholder KV namespace ID with your actual ID:

```toml
name = "dynamic-threat-feed"
main = "src/index.ts"
compatibility_date = "2025-09-22"

[observability]
enabled = true

[[kv_namespaces]]
binding = "THREAT_DATA"
id = "abc123def456ghi789"  # Replace with your actual KV namespace ID

[triggers]
crons = ["0 2 * * *"]  # Daily at 2 AM UTC

[vars]
FEED_NAME = "custom-threat-feed"
FEED_DESCRIPTION = "Dynamic threat intelligence feed with IPs and domains"
MAX_INDICATORS_PER_BATCH = "1000"
FEED_UPDATE_INTERVAL_HOURS = "24"

[limits]
cpu_ms = 30000  # 30 seconds max execution time
```

## Step 7: Set Secrets

```bash
# Set your Cloudflare API token
wrangler secret put CLOUDFLARE_API_TOKEN
# Enter your API token when prompted

# Set your Cloudflare Account ID
wrangler secret put CLOUDFLARE_ACCOUNT_ID
# Enter your account ID when prompted

# Optional: Set custom threat sources configuration
# (Skip this to use default sources)
wrangler secret put THREAT_SOURCES_CONFIG
# Enter JSON configuration when prompted
```

### Example Threat Sources Configuration

If you want to customize threat sources, use this JSON format:

```json
[
  {
    "name": "Abuse.ch Feodo Tracker",
    "url": "https://feodotracker.abuse.ch/downloads/ipblocklist.txt",
    "format": "plain",
    "weight": 8,
    "timeout": 30000,
    "user_agent": "Dynamic-Threat-Feed/1.0",
    "enabled": true,
    "extract_domains": false,
    "extract_ips": true
  },
  {
    "name": "Malware Domain List",
    "url": "https://www.malwaredomainlist.com/hostslist/hosts.txt",
    "format": "plain",
    "weight": 7,
    "timeout": 30000,
    "user_agent": "Dynamic-Threat-Feed/1.0",
    "enabled": true,
    "extract_domains": true,
    "extract_ips": false
  }
]
```

## Step 8: Install Dependencies

```bash
# Install project dependencies
npm install

# Generate TypeScript types for Cloudflare Workers
npm run cf-typegen
```

## Step 9: Test Locally (Optional)

```bash
# Start local development server
npm run dev

# Test the local server
curl http://localhost:8787/

# Stop the dev server with Ctrl+C when done
```

## Step 10: Deploy to Production

```bash
# Deploy to Cloudflare Workers
npm run deploy

# Example output:
# ✨ Success! Uploaded 1 files (x.xx sec)
# ✨ Deployment complete! Take a flight on your worker at:
# https://dynamic-threat-feed.your-subdomain.workers.dev
```

## Step 11: Initialize the System

```bash
# Initialize the threat feed system
curl -X POST https://dynamic-threat-feed.your-subdomain.workers.dev/initialize

# Expected response:
# {
#   "success": true,
#   "data": {
#     "feed_id": "feed-abc123",
#     "name": "custom-threat-feed",
#     "description": "Dynamic threat intelligence feed with IPs and domains",
#     ...
#   }
# }
```

## Step 12: Verify Deployment

### Test Basic Functionality

```bash
# Check system status
curl https://dynamic-threat-feed.your-subdomain.workers.dev/status

# Get system information
curl https://dynamic-threat-feed.your-subdomain.workers.dev/

# Manually trigger an update
curl -X POST https://dynamic-threat-feed.your-subdomain.workers.dev/update
```

### Check Cloudflare Dashboard

1. Go to [Cloudflare Workers Dashboard](https://dash.cloudflare.com/workers)
2. Find your `dynamic-threat-feed` worker
3. Check the "Metrics" tab for invocation statistics
4. Review "Logs" for any errors

### Verify Indicator Feed

1. Go to [Cloudflare Security Center](https://dash.cloudflare.com/security-center)
2. Navigate to "Intelligence" > "Indicator Feeds"
3. Look for your custom feed (e.g., "custom-threat-feed")
4. Verify it contains indicators

## Step 13: Monitor and Maintain

### Set Up Monitoring

1. **Worker Metrics**: Monitor in Cloudflare dashboard
2. **Logs**: Use `wrangler tail` for real-time logs
3. **Alerts**: Set up email notifications for failures

```bash
# Monitor real-time logs
wrangler tail --format pretty
```

### Regular Maintenance

1. **Check logs weekly** for any errors or warnings
2. **Monitor KV storage usage** to avoid quota limits
3. **Review threat sources** periodically for availability
4. **Update dependencies** regularly for security

## Troubleshooting Deployment

### Common Issues

#### 1. "Namespace not found" Error

```bash
# Recreate the KV namespace
wrangler kv:namespace create "THREAT_DATA"

# Update wrangler.toml with the new ID
# Redeploy
npm run deploy
```

#### 2. "Invalid API Token" Error

```bash
# Check token permissions in Cloudflare dashboard
# Recreate token if necessary
wrangler secret put CLOUDFLARE_API_TOKEN
```

#### 3. "Account ID not found" Error

```bash
# Verify your account ID
wrangler whoami

# Update the secret
wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

#### 4. Cron Triggers Not Working

- Verify cron syntax in wrangler.toml
- Check Worker logs for scheduled events
- Ensure Worker has sufficient CPU time

#### 5. Memory or CPU Limits

```toml
# Increase limits in wrangler.toml
[limits]
cpu_ms = 60000  # 60 seconds
```

### Getting Help

1. **Wrangler Issues**: Check [Wrangler documentation](https://developers.cloudflare.com/workers/wrangler/)
2. **Workers Issues**: Check [Workers documentation](https://developers.cloudflare.com/workers/)
3. **API Issues**: Check [Cloudflare API documentation](https://developers.cloudflare.com/api/)

## Production Considerations

### Security

- **Rotate API tokens** regularly
- **Monitor access logs** for unusual activity
- **Use least-privilege permissions** for API tokens

### Performance

- **Monitor CPU usage** and optimize if needed
- **Track KV operations** to stay within limits
- **Optimize batch sizes** for better performance

### Reliability

- **Set up monitoring alerts** for failures
- **Have a rollback plan** for deployments
- **Test updates** in development first

### Cost Management

- **Monitor Workers invocations** to track costs
- **Optimize KV storage usage** to minimize costs
- **Review and remove unused resources**

## Updating the System

### Code Updates

```bash
# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Generate updated types
npm run cf-typegen

# Deploy updates
npm run deploy
```

### Configuration Updates

```bash
# Update secrets if needed
wrangler secret put CLOUDFLARE_API_TOKEN

# Update environment variables in wrangler.toml
# Redeploy after changes
npm run deploy
```

### Rollback Procedure

```bash
# If you need to rollback to a previous version
wrangler rollback

# Or deploy a specific version
git checkout <previous-commit>
npm run deploy
```

## Success Checklist

- [ ] Wrangler CLI installed and authenticated
- [ ] KV namespace created and configured
- [ ] API token created with correct permissions
- [ ] Secrets set (API token, Account ID)
- [ ] Configuration updated (wrangler.toml)
- [ ] Dependencies installed
- [ ] Successfully deployed to Cloudflare Workers
- [ ] System initialized via API call
- [ ] Basic functionality tested
- [ ] Scheduled updates configured
- [ ] Monitoring set up
- [ ] Documentation reviewed

Your Dynamic Threat Feed system should now be fully deployed and operational!
