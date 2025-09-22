# Dynamic Threat Feed

A Cloudflare Workers-based dynamic threat intelligence feed system that automatically fetches threat data from multiple sources and creates custom indicator feeds using Cloudflare's Indicator Feed API.

## Features

- **Automated Collection**: Fetches threat intelligence from multiple configurable sources
- **Smart Parsing**: Extracts IP addresses and domain names (Cloudflare indicator feeds only accept these)
- **Cloudflare Integration**: Creates and manages custom indicator feeds via Cloudflare API
- **Persistent Storage**: Uses Cloudflare KV for data persistence and caching
- **Scheduled Updates**: Automatically updates threat feed data every 24 hours (configurable)
- **RESTful API**: Comprehensive API for management and monitoring
- **Backup & Restore**: Full data backup and restoration capabilities

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Threat Sources │───▶│ Cloudflare Worker │───▶│ Cloudflare API  │
│  (External APIs)│    │  (Processing)     │    │ (Indicator Feed)│
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
- Cloudflare API token with Intel:Edit permissions
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
FEED_NAME = "custom-threat-feed"
FEED_DESCRIPTION = "Dynamic threat intelligence feed with IPs and domains"
MAX_INDICATORS_PER_BATCH = "1000"
FEED_UPDATE_INTERVAL_HOURS = "24"
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
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Intel:Edit permissions | Required |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Required |
| `FEED_NAME` | Name of the indicator feed | `custom-threat-feed` |
| `FEED_DESCRIPTION` | Description of the indicator feed | `Dynamic threat intelligence feed...` |
| `MAX_INDICATORS_PER_BATCH` | Maximum indicators per API batch | `1000` |
| `FEED_UPDATE_INTERVAL_HOURS` | Update interval in hours | `24` |
| `THREAT_SOURCES_CONFIG` | JSON configuration of threat sources | Uses defaults |

## Usage Examples

### Check System Status

```bash
curl https://your-worker.your-subdomain.workers.dev/status
```

### Manually Trigger Update

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/update
```

### Update Threat Sources

```bash
curl -X PUT https://your-worker.your-subdomain.workers.dev/sources \
  -H "Content-Type: application/json" \
  -d '[{"name":"Custom Source","url":"https://example.com/feed.txt","format":"plain","weight":5,"timeout":30000,"user_agent":"Dynamic-Threat-Feed/1.0","enabled":true,"extract_domains":true,"extract_ips":true}]'
```

### Backup Feed Data

```bash
curl https://your-worker.your-subdomain.workers.dev/backup > backup.json
```

### Restore from Backup

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/restore \
  -H "Content-Type: application/json" \
  -d @backup.json
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
- `Account:Cloudflare Intelligence:Edit`

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

#### "Failed to create indicator feed"

- Check API token permissions include Intel:Edit
- Verify account has access to Cloudflare Intelligence features
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
3. Check Cloudflare Intelligence API documentation
4. Open an issue in the project repository

## Changelog

### v1.0.0
- Initial release
- Basic threat intelligence collection
- Cloudflare Indicator Feed integration
- Scheduled updates
- RESTful API
- Backup/restore functionality
