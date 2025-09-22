# Dynamic Threat Feed - Quick Reference

## 🚨 Most Common Issues

### "list size is limited to 5000 items"
**Fix**: Multiple Gateway Lists strategy is already implemented
- System automatically splits 186K+ indicators into ~42 lists of 4500 items each
- Check: `DynamicThreatFeed-YYYYMMDD-PartXXXofYYY` naming pattern

### "Worker exceeded memory limit"
**Fix**: Memory-efficient streaming is already implemented
- Processes one Gateway List at a time (~3MB vs ~120MB)
- Check: Memory usage logs in Worker output

### HTTP 405 Error
**Fix**: JSON API with PATCH method is already implemented
- Uses correct `/gateway/lists/{id}` endpoint
- Batches of 1000 items with sequential processing

## ⚡ Quick Commands

```bash
# Check compilation
npx tsc --noEmit

# Deploy
wrangler deploy

# Test
curl -X POST https://dynamic-threat-feed.zero-security.workers.dev/update

# Monitor logs
wrangler tail
```

## 📊 Expected Results

- **Gateway Lists Created**: ~42 lists for 186K indicators
- **Memory Usage**: ~3MB maximum
- **Processing Time**: <25 seconds
- **List Names**: `DynamicThreatFeed-20250123-Part001of042`

## 🔧 Emergency Fixes

### If still getting 5000 item error:
1. Check if `createMultipleLists()` method is being called
2. Verify `maxItemsPerList = 4500` in code

### If memory limit exceeded:
1. Reduce `maxItemsPerList` to 3000
2. Increase delays between operations

### If rate limited:
1. Increase delays from 500ms to 1000ms
2. Reduce batch size from 1000 to 500

## 📍 Key File Locations

- **Main Logic**: `src/services/cloudflareAPI.ts`
- **Storage**: `src/services/storageService.ts`
- **Feed Manager**: `src/services/feedManager.ts`
- **Full Documentation**: `TROUBLESHOOTING.md`

---
*For detailed information, see TROUBLESHOOTING.md*
