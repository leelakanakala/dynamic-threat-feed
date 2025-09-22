import { Env, FeedMetadata, FeedUpdateResult, ThreatIndicator } from '../types';
import { ThreatCollector } from './threatCollector';
import { CloudflareAPIService } from './cloudflareAPI';
import { StorageService } from './storageService';

/**
 * Main feed manager that orchestrates the threat feed update process
 */
export class FeedManager {
	private env: Env;
	private threatCollector: ThreatCollector;
	private cloudflareAPI: CloudflareAPIService;
	private storage: StorageService;

	constructor(env: Env) {
		this.env = env;
		this.threatCollector = new ThreatCollector(env);
		this.cloudflareAPI = new CloudflareAPIService(env);
		this.storage = new StorageService(env);
	}

	/**
	 * Initialize the threat feed system
	 */
	async initialize(): Promise<FeedMetadata> {
		console.log('Initializing dynamic threat feed system...');

		// Validate Cloudflare API credentials
		const credentialsValid = await this.cloudflareAPI.validateCredentials();
		if (!credentialsValid) {
			throw new Error('Invalid Cloudflare API credentials');
		}

		// Get or create the Gateway List
		const gatewayList = await this.cloudflareAPI.getOrCreateGatewayList();
		
		// Create or update feed metadata
		const metadata: FeedMetadata = {
			feed_id: gatewayList.id!,
			name: gatewayList.name,
			description: gatewayList.description || this.env.FEED_DESCRIPTION,
			created_at: gatewayList.created_at || new Date().toISOString(),
			last_updated: gatewayList.updated_at || new Date().toISOString(),
			total_indicators: gatewayList.count || 0,
			active_indicators: gatewayList.count || 0,
			update_frequency: `${this.env.FEED_UPDATE_INTERVAL_HOURS}h`,
			sources: this.threatCollector.getActiveSources().map(s => s.name)
		};

		await this.storage.storeFeedMetadata(metadata);
		console.log(`Initialized Gateway List: ${metadata.name} (${metadata.feed_id})`);

		return metadata;
	}

	/**
	 * Perform a complete threat feed update
	 */
	async updateThreatFeed(): Promise<FeedUpdateResult> {
		const startTime = Date.now();
		console.log('Starting threat feed update...');

		try {
			// Step 1: Clean up expired indicators from storage
			console.log('Step 1: Cleaning up expired indicators...');
			const expiredCount = await this.storage.cleanupExpiredIndicators();
			console.log(`Cleaned up ${expiredCount} expired indicators`);

			// Step 2: Collect fresh threat intelligence
			console.log('Step 2: Collecting threat intelligence...');
			const collectionResult = await this.threatCollector.collectThreatIntelligence();
			console.log(`Collected ${collectionResult.indicators.size} indicators from ${collectionResult.stats.successful_sources.length} sources`);

			// Step 3: Merge with existing indicators
			console.log('Step 3: Merging with existing indicators...');
			const existingIndicators = await this.storage.getActiveIndicators();
			const mergedIndicators = this.mergeIndicators(existingIndicators, collectionResult.indicators);
			console.log(`Merged to ${mergedIndicators.size} total indicators`);

			// Step 4: Store updated indicators
			console.log('Step 4: Storing updated indicators...');
			await this.storage.storeIndicators(mergedIndicators);

			// Step 5: Update Cloudflare Gateway List (SINGLE API CALL)
			console.log('Step 5: Updating Cloudflare Gateway List...');
			const metadata = await this.storage.getFeedMetadata();
			if (!metadata) {
				throw new Error('Feed metadata not found. Run initialize() first.');
			}

			const indicatorsArray = Array.from(mergedIndicators.values());
			console.log(`Uploading ${indicatorsArray.length} indicators in single CSV upload...`);
			
			const uploadResult = await this.cloudflareAPI.updateGatewayListSnapshot(metadata.feed_id, indicatorsArray);

			// Step 6: Update metadata and statistics
			console.log('Step 6: Updating metadata and statistics...');
			const updatedMetadata: FeedMetadata = {
				...metadata,
				last_updated: new Date().toISOString(),
				total_indicators: mergedIndicators.size,
				active_indicators: mergedIndicators.size, // Gateway Lists don't distinguish created/updated
				sources: this.threatCollector.getActiveSources().map(s => s.name)
			};

			await this.storage.storeFeedMetadata(updatedMetadata);
			await this.storage.storeLastUpdate(new Date().toISOString());

			// Create update result - Gateway Lists return operation_id instead of counts
			const updateResult: FeedUpdateResult = {
				success: uploadResult.success,
				feed_id: metadata.feed_id,
				indicators_added: uploadResult.success ? mergedIndicators.size : 0,
				indicators_updated: 0, // Gateway Lists replace all items
				indicators_removed: expiredCount,
				processing_time_ms: Date.now() - startTime,
				errors: uploadResult.errors || []
			};

			await this.storage.storeUpdateStats(updateResult);

			console.log(`Feed update completed successfully:`);
			console.log(`- Added: ${updateResult.indicators_added} indicators`);
			console.log(`- Updated: ${updateResult.indicators_updated} indicators`);
			console.log(`- Removed: ${updateResult.indicators_removed} expired indicators`);
			console.log(`- Processing time: ${updateResult.processing_time_ms}ms`);

			return updateResult;

		} catch (error) {
			console.error('Feed update failed:', error);
			
			const errorResult: FeedUpdateResult = {
				success: false,
				feed_id: '',
				indicators_added: 0,
				indicators_updated: 0,
				indicators_removed: 0,
				processing_time_ms: Date.now() - startTime,
				errors: [error instanceof Error ? error.message : String(error)]
			};

			await this.storage.storeUpdateStats(errorResult);
			throw error;
		}
	}

	/**
	 * Merge new indicators with existing ones
	 */
	private mergeIndicators(
		existing: Map<string, ThreatIndicator>,
		newIndicators: Map<string, ThreatIndicator>
	): Map<string, ThreatIndicator> {
		const merged = new Map(existing);

		for (const [key, newIndicator] of newIndicators) {
			if (merged.has(key)) {
				// Update existing indicator
				const existingIndicator = merged.get(key)!;
				
				// Merge sources (avoid duplicates)
				const allSources = [...new Set([...existingIndicator.sources, ...newIndicator.sources])];
				
				// Calculate new score (average of existing and new, weighted by source count)
				const totalWeight = allSources.length;
				const newScore = (existingIndicator.score + newIndicator.score) / 2;

				const updatedIndicator: ThreatIndicator = {
					...existingIndicator,
					score: Math.min(100, newScore), // Cap at 100
					sources: allSources,
					last_seen: newIndicator.last_seen,
					expires_at: newIndicator.expires_at // Use newer expiration
				};

				merged.set(key, updatedIndicator);
			} else {
				// Add new indicator
				merged.set(key, newIndicator);
			}
		}

		return merged;
	}

	/**
	 * Get feed status and statistics
	 */
	async getFeedStatus(): Promise<{
		metadata: FeedMetadata | null;
		last_update: string | null;
		update_stats: FeedUpdateResult | null;
		storage_stats: any;
		cloudflare_stats: any;
	}> {
		const metadata = await this.storage.getFeedMetadata();
		const lastUpdate = await this.storage.getLastUpdate();
		const updateStats = await this.storage.getUpdateStats();
		const storageStats = await this.storage.getStorageStats();
		
		let cloudflareStats = null;
		if (metadata) {
			try {
				cloudflareStats = await this.cloudflareAPI.getGatewayListStats(metadata.feed_id);
			} catch (error) {
				console.error('Failed to get Cloudflare Gateway List stats:', error);
			}
		}

		return {
			metadata,
			last_update: lastUpdate,
			update_stats: updateStats,
			storage_stats: storageStats,
			cloudflare_stats: cloudflareStats
		};
	}

	/**
	 * Check if an update is needed based on the configured interval
	 */
	async isUpdateNeeded(): Promise<boolean> {
		const lastUpdate = await this.storage.getLastUpdate();
		if (!lastUpdate) {
			return true; // Never updated before
		}

		const lastUpdateTime = new Date(lastUpdate);
		const now = new Date();
		const intervalHours = parseInt(this.env.FEED_UPDATE_INTERVAL_HOURS);
		const intervalMs = intervalHours * 60 * 60 * 1000;

		return (now.getTime() - lastUpdateTime.getTime()) >= intervalMs;
	}

	/**
	 * Force a feed update regardless of schedule
	 */
	async forceUpdate(): Promise<FeedUpdateResult> {
		console.log('Forcing threat feed update...');
		return await this.updateThreatFeed();
	}

	/**
	 * Get threat sources configuration
	 */
	getActiveSources() {
		return this.threatCollector.getActiveSources();
	}

	/**
	 * Update threat sources configuration
	 */
	async updateSourcesConfiguration(sources: any[]): Promise<void> {
		await this.storage.storeSourcesConfig(sources);
		this.threatCollector.updateSources(sources);
		console.log(`Updated threat sources configuration with ${sources.length} sources`);
	}

	/**
	 * Backup all feed data
	 */
	async backupFeedData(): Promise<{
		metadata: FeedMetadata | null;
		indicators: string;
		sources: any[] | null;
		timestamp: string;
	}> {
		const metadata = await this.storage.getFeedMetadata();
		const indicators = await this.storage.backupIndicators();
		const sources = await this.storage.getSourcesConfig();

		return {
			metadata,
			indicators,
			sources,
			timestamp: new Date().toISOString()
		};
	}

	/**
	 * Restore feed data from backup
	 */
	async restoreFeedData(backup: {
		metadata: FeedMetadata;
		indicators: string;
		sources: any[];
	}): Promise<void> {
		console.log('Restoring feed data from backup...');
		
		await this.storage.storeFeedMetadata(backup.metadata);
		await this.storage.restoreIndicators(backup.indicators);
		await this.storage.storeSourcesConfig(backup.sources);
		
		console.log('Feed data restored successfully');
	}

	/**
	 * Reset the entire feed (use with caution)
	 */
	async resetFeed(): Promise<void> {
		console.warn('Resetting entire threat feed...');
		
		// Clear all storage
		await this.storage.clearAllData();
		
		// Reinitialize
		await this.initialize();
		
		console.log('Feed reset completed');
	}
}
