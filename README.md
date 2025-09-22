# Dynamic Threat Feed

A Cloudflare Workers-based dynamic threat intelligence feed system that automatically fetches threat data from multiple sources and creates custom Gateway Lists using Cloudflare's Gateway Lists API with CSV format.

## Features

- **Automated Collection**: Fetches threat intelligence from multiple configurable sources
- **Smart Parsing**: Extracts IP addresses and domain names from various threat feeds
- **Cloudflare Gateway Integration**: Creates and manages custom Gateway Lists via Cloudflare API
- **CSV Format**: Uses CSV file uploads for reliable data transfer to Cloudflare
- **Persistent Storage**: Uses Cloudflare KV for data persistence and caching
- **Scheduled Updates**: Automatically updates threat feed data every 24 hours (configurable)
- **RESTful API**: Comprehensive API for management and monitoring
- **Backup & Restore**: Full data backup and restoration capabilities

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Threat Sources │───▶│ Cloudflare Worker │───▶│ Cloudflare API  │
│  (External APIs)│    │  (Processing)     │    │ (Gateway Lists) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │ Cloudflare KV    │
                       │ (Data Storage)   │
                       └──────────────────┘
```

## Quick Start

### 1. Prerequisites

- Cloudflare account with Workers and KV enabled
- Cloudflare API token with Gateway:Edit permissions
- Node.js 18+ and npm

### 2. Installation

```bash
# Clone or create the project
cd ~/Documents/Projects/dynamic-threat-feed

# Install dependencies
npm install

# Generate TypeScript types for Cloudflare Workers
npm run cf-typegen
```

### 3. Configuration

#### Create KV Namespace

```bash
# Create KV namespace for threat data storage
wrangler kv:namespace create "THREAT_DATA"

# Update wrangler.toml with the returned namespace ID
```

#### Set Environment Variables

```bash
# Set your Cloudflare API credentials
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put CLOUDFLARE_ACCOUNT_ID

# Optional: Set custom threat sources configuration
wrangler secret put THREAT_SOURCES_CONFIG
```

#### Update wrangler.toml

```toml
name = "dynamic-threat-feed"
main = "src/index.ts"
compatibility_date = "2025-09-22"

[observability]
enabled = true

[[kv_namespaces]]
binding = "THREAT_DATA"
id = "your-actual-kv-namespace-id"  # Replace with your KV namespace ID

[triggers]
crons = ["0 2 * * *"]  # Daily at 2 AM UTC

[vars]
GATEWAY_LIST_NAME = "custom-threat-list"
GATEWAY_LIST_DESCRIPTION = "Dynamic threat intelligence list with IPs and domains"
MAX_INDICATORS_PER_BATCH = "1000"
GATEWAY_LIST_UPDATE_INTERVAL_HOURS = "24"
```

### 4. Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy

# Test the deployment
curl https://your-worker.your-subdomain.workers.dev/
```

### 5. Initialize the System

```bash
# Initialize the threat feed system
curl -X POST https://your-worker.your-subdomain.workers.dev/initialize
```

## API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | System information and available endpoints |
| `GET` | `/status` | Feed status and statistics |
| `POST` | `/initialize` | Initialize the threat feed system |
| `POST` | `/update` | Manually trigger feed update |

### Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sources` | Get active threat sources |
| `PUT` | `/sources` | Update threat sources configuration |
| `GET` | `/backup` | Download complete feed backup |
| `POST` | `/restore` | Restore feed from backup |
| `POST` | `/reset` | Reset entire feed (dangerous) |

### Query Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/indicator/{value}` | Get specific indicator information |

## Configuration

### Threat Sources

The system supports configurable threat intelligence sources. Default sources include:

- **Abuse.ch Feodo Tracker**: Botnet C&C IPs
- **Malware Domain List**: Malicious domains
- **Emerging Threats**: Compromised IPs

#### Custom Sources Configuration

```json
[
  {
    "name": "Custom Threat Source",
    "url": "https://example.com/threat-feed.txt",
    "format": "plain",
    "weight": 8,
    "timeout": 30000,
    "user_agent": "Dynamic-Threat-Feed/1.0",
    "enabled": true,
    "extract_domains": true,
    "extract_ips": true
  }
]
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Gateway:Edit permissions | Required |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Required |
| `GATEWAY_LIST_NAME` | Name of the Gateway List | `custom-threat-list` |
| `GATEWAY_LIST_DESCRIPTION` | Description of the Gateway List | `Dynamic threat intelligence list...` |
| `MAX_INDICATORS_PER_BATCH` | Maximum indicators per API batch | `1000` |
| `GATEWAY_LIST_UPDATE_INTERVAL_HOURS` | Update interval in hours | `24` |
| `THREAT_SOURCES_CONFIG` | JSON configuration of threat sources | Uses defaults |

## Usage Examples

### 1. Initialize the System (Required First Step)

```bash
# Initialize the threat feed system
curl -X POST https://dynamic-threat-feed.zero-security.workers.dev/initialize
```

Expected response:
```json
{
  "success": true,
  "data": {
    "list_id": "abc123...",
    "name": "custom-threat-list",
    "description": "Dynamic threat intelligence list with IPs and domains",
    "created_at": "2025-09-22T13:59:18.116Z",
    "last_updated": "2025-09-22T13:59:18.116Z",
    "total_indicators": 0,
    "active_indicators": 0,
    "update_frequency": "24h",
    "sources": ["Abuse.ch Feodo Tracker", "Malware Domain List"]
  }
}
```

### 2. Check System Status

```bash
# Get comprehensive system status
curl https://dynamic-threat-feed.zero-security.workers.dev/status
```

This returns:
- Feed metadata (last update time, indicator counts)
- Last update timestamp
- Update statistics (success/failure rates)
- Storage statistics
- Cloudflare feed status

### 3. Manually Trigger Feed Update

```bash
# Force an immediate update
curl -X POST https://dynamic-threat-feed.zero-security.workers.dev/update
```

Expected response:
```json
{
  "success": true,
  "data": {
    "success": true,
    "list_id": "abc123...",
    "indicators_added": 1250,
    "indicators_updated": 45,
    "indicators_removed": 12,
    "processing_time_ms": 15420,
    "errors": []
  }
}
```

### 4. Check Active Threat Sources

```bash
# View configured threat intelligence sources
curl https://dynamic-threat-feed.zero-security.workers.dev/sources
```

### 5. Monitor Feed Updates

To verify your feed is being updated:

1. **Check last update time**:
   ```bash
   curl https://dynamic-threat-feed.zero-security.workers.dev/status | jq '.data.last_update'
   ```

2. **Check indicator counts**:
   ```bash
   curl https://dynamic-threat-feed.zero-security.workers.dev/status | jq '.data.metadata.total_indicators'
   ```

3. **View update statistics**:
   ```bash
   curl https://dynamic-threat-feed.zero-security.workers.dev/status | jq '.data.update_stats'
   ```

### 6. Update Threat Sources (Optional)

```bash
curl -X PUT https://dynamic-threat-feed.zero-security.workers.dev/sources \
  -H "Content-Type: application/json" \
  -d '[{"name":"Custom Source","url":"https://example.com/feed.txt","format":"plain","weight":5,"timeout":30000,"user_agent":"Dynamic-Threat-Feed/1.0","enabled":true,"extract_domains":true,"extract_ips":true}]'
```

### 7. Backup Feed Data

```bash
# Download complete backup
curl https://dynamic-threat-feed.zero-security.workers.dev/backup > backup-$(date +%Y%m%d).json
```

### 8. Restore from Backup

```bash
curl -X POST https://dynamic-threat-feed.zero-security.workers.dev/restore \
  -H "Content-Type: application/json" \
  -d @backup-20250922.json
```

### 9. Reset Feed (Dangerous)

```bash
# Complete reset - use with caution!
curl -X POST https://dynamic-threat-feed.zero-security.workers.dev/reset
```

## Monitoring

### Logs

Monitor your Worker logs in the Cloudflare dashboard or via CLI:

```bash
wrangler tail
```

### Metrics

The system provides detailed metrics including:

- Collection statistics (sources, success/failure rates)
- Processing metrics (indicators processed, duplicates removed)
- Upload results (indicators created/updated in Cloudflare)
- Storage statistics (KV usage, cleanup operations)

### Alerts

Set up alerts based on:

- Failed scheduled updates
- High error rates from threat sources
- Cloudflare API failures
- Storage quota approaching limits

## Security Considerations

### API Token Permissions

Ensure your Cloudflare API token has minimal required permissions:
- `Zone:Zone Settings:Read` (if using zone-specific features)
- `Account:Cloudflare Gateway:Edit`

### Data Privacy

- Threat indicators are stored in Cloudflare KV (encrypted at rest)
- No personal data is collected or processed
- All external API calls use appropriate User-Agent headers

### Rate Limiting

The system implements:
- Configurable timeouts for external API calls
- Batch processing to respect Cloudflare API limits
- Delays between batch uploads to prevent rate limiting

## Troubleshooting

### Common Issues

#### "Invalid Cloudflare API credentials"

- Verify your API token has correct permissions
- Check that the account ID is correct
- Ensure secrets are properly set in Wrangler

#### "Failed to create Gateway List"

- Check API token permissions include Gateway:Edit
- Verify account has access to Cloudflare Gateway features
- Check Cloudflare dashboard for any account limitations

#### "KV namespace not found"

- Ensure KV namespace is created: `wrangler kv:namespace create "THREAT_DATA"`
- Update wrangler.toml with correct namespace ID
- Redeploy after configuration changes

#### Scheduled updates not running

- Verify cron trigger is configured in wrangler.toml
- Check Worker logs for scheduled event execution
- Ensure Worker has sufficient CPU time limits

### Debug Mode

Enable verbose logging by checking Worker logs:

```bash
wrangler tail --format pretty
```

## Development

### Local Development

```bash
# Start local development server
npm run dev

# Run tests
npm test

# Type checking
npm run cf-typegen
```

### Project Structure

```
src/
├── index.ts                 # Main Worker entry point
├── types.ts                 # TypeScript type definitions
├── utils/
│   └── validators.ts        # IP/domain validation utilities
└── services/
    ├── threatCollector.ts   # Threat intelligence collection
    ├── cloudflareAPI.ts     # Cloudflare API integration
    ├── storageService.ts    # KV storage management
    └── feedManager.ts       # Main orchestration service
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review Cloudflare Workers documentation
3. Check Cloudflare Gateway API documentation
4. Open an issue in the project repository

## Changelog

### v1.0.0
- Initial release
- Basic threat intelligence collection
- Cloudflare Gateway List integration
- Scheduled updates
- RESTful API
- Backup/restore functionality
