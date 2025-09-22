import { Env, ThreatIndicator, FeedMetadata, FeedUpdateResult, KV_KEYS } from '../types';

/**
 * KV storage service for managing threat data and metadata
 */
export class StorageService {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	/**
	 * Store feed metadata
	 */
	async storeFeedMetadata(metadata: FeedMetadata): Promise<void> {
		await this.env.THREAT_DATA.put(KV_KEYS.FEED_METADATA, JSON.stringify(metadata));
		console.log(`Stored feed metadata for feed: ${metadata.feed_id}`);
	}

	/**
	 * Get feed metadata
	 */
	async getFeedMetadata(): Promise<FeedMetadata | null> {
		const data = await this.env.THREAT_DATA.get(KV_KEYS.FEED_METADATA);
		if (!data) return null;
		
		try {
			return JSON.parse(data) as FeedMetadata;
		} catch (error) {
			console.error('Failed to parse feed metadata:', error);
			return null;
		}
	}

	/**
	 * Store threat indicators in batches
	 */
	async storeIndicators(indicators: Map<string, ThreatIndicator>): Promise<void> {
		const batchSize = 100; // KV has limits on batch operations
		const entries = Array.from(indicators.entries());
		
		console.log(`Storing ${entries.length} indicators in batches of ${batchSize}`);

		for (let i = 0; i < entries.length; i += batchSize) {
			const batch = entries.slice(i, i + batchSize);
			const promises = batch.map(([key, indicator]) => 
				this.env.THREAT_DATA.put(`${KV_KEYS.INDICATORS_PREFIX}${key}`, JSON.stringify(indicator))
			);

			await Promise.all(promises);
			console.log(`Stored batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(entries.length / batchSize)}`);
		}
	}

	/**
	 * Get all stored indicators
	 */
	async getAllIndicators(): Promise<Map<string, ThreatIndicator>> {
		const indicators = new Map<string, ThreatIndicator>();
		
		// List all keys with the indicators prefix
		const listResult = await this.env.THREAT_DATA.list({ prefix: KV_KEYS.INDICATORS_PREFIX });
		
		if (listResult.keys.length === 0) {
			return indicators;
		}

		console.log(`Loading ${listResult.keys.length} indicators from storage`);

		// Fetch indicators in batches
		const batchSize = 100;
		for (let i = 0; i < listResult.keys.length; i += batchSize) {
			const batch = listResult.keys.slice(i, i + batchSize);
			const promises = batch.map(async (key) => {
				const data = await this.env.THREAT_DATA.get(key.name);
				if (data) {
					try {
						const indicator = JSON.parse(data) as ThreatIndicator;
						const indicatorKey = key.name.replace(KV_KEYS.INDICATORS_PREFIX, '');
						indicators.set(indicatorKey, indicator);
					} catch (error) {
						console.error(`Failed to parse indicator ${key.name}:`, error);
					}
				}
			});

			await Promise.all(promises);
		}

		return indicators;
	}

	/**
	 * Get active (non-expired) indicators
	 */
	async getActiveIndicators(): Promise<Map<string, ThreatIndicator>> {
		const allIndicators = await this.getAllIndicators();
		const activeIndicators = new Map<string, ThreatIndicator>();
		const now = new Date();

		for (const [key, indicator] of allIndicators) {
			if (new Date(indicator.expires_at) > now) {
				activeIndicators.set(key, indicator);
			}
		}

		console.log(`Found ${activeIndicators.size} active indicators out of ${allIndicators.size} total`);
		return activeIndicators;
	}

	/**
	 * Clean up expired indicators
	 */
	async cleanupExpiredIndicators(): Promise<number> {
		const allIndicators = await this.getAllIndicators();
		const now = new Date();
		let expiredCount = 0;

		const expiredKeys: string[] = [];
		for (const [key, indicator] of allIndicators) {
			if (new Date(indicator.expires_at) <= now) {
				expiredKeys.push(`${KV_KEYS.INDICATORS_PREFIX}${key}`);
				expiredCount++;
			}
		}

		if (expiredKeys.length > 0) {
			console.log(`Cleaning up ${expiredKeys.length} expired indicators`);
			
			// Delete in batches
			const batchSize = 100;
			for (let i = 0; i < expiredKeys.length; i += batchSize) {
				const batch = expiredKeys.slice(i, i + batchSize);
				const promises = batch.map(key => this.env.THREAT_DATA.delete(key));
				await Promise.all(promises);
			}
		}

		return expiredCount;
	}

	/**
	 * Store last update timestamp
	 */
	async storeLastUpdate(timestamp: string): Promise<void> {
		await this.env.THREAT_DATA.put(KV_KEYS.LAST_UPDATE, timestamp);
	}

	/**
	 * Get last update timestamp
	 */
	async getLastUpdate(): Promise<string | null> {
		return await this.env.THREAT_DATA.get(KV_KEYS.LAST_UPDATE);
	}

	/**
	 * Store update statistics
	 */
	async storeUpdateStats(stats: FeedUpdateResult): Promise<void> {
		await this.env.THREAT_DATA.put(KV_KEYS.UPDATE_STATS, JSON.stringify(stats));
	}

	/**
	 * Get update statistics
	 */
	async getUpdateStats(): Promise<FeedUpdateResult | null> {
		const data = await this.env.THREAT_DATA.get(KV_KEYS.UPDATE_STATS);
		if (!data) return null;
		
		try {
			return JSON.parse(data) as FeedUpdateResult;
		} catch (error) {
			console.error('Failed to parse update stats:', error);
			return null;
		}
	}

	/**
	 * Store threat sources configuration
	 */
	async storeSourcesConfig(sources: any[]): Promise<void> {
		await this.env.THREAT_DATA.put(KV_KEYS.SOURCES_CONFIG, JSON.stringify(sources));
	}

	/**
	 * Get threat sources configuration
	 */
	async getSourcesConfig(): Promise<any[] | null> {
		const data = await this.env.THREAT_DATA.get(KV_KEYS.SOURCES_CONFIG);
		if (!data) return null;
		
		try {
			return JSON.parse(data);
		} catch (error) {
			console.error('Failed to parse sources config:', error);
			return null;
		}
	}

	/**
	 * Get storage statistics
	 */
	async getStorageStats(): Promise<{
		total_keys: number;
		indicators_count: number;
		metadata_size: number;
		last_cleanup: string | null;
	}> {
		// Get all keys
		const allKeys = await this.env.THREAT_DATA.list();
		const indicatorKeys = allKeys.keys.filter(key => key.name.startsWith(KV_KEYS.INDICATORS_PREFIX));
		
		// Get metadata size
		const metadata = await this.env.THREAT_DATA.get(KV_KEYS.FEED_METADATA);
		const metadataSize = metadata ? metadata.length : 0;

		return {
			total_keys: allKeys.keys.length,
			indicators_count: indicatorKeys.length,
			metadata_size: metadataSize,
			last_cleanup: await this.getLastUpdate()
		};
	}

	/**
	 * Clear all data (use with caution)
	 */
	async clearAllData(): Promise<void> {
		console.warn('Clearing all data from KV storage');
		
		const allKeys = await this.env.THREAT_DATA.list();
		const deletePromises = allKeys.keys.map(key => this.env.THREAT_DATA.delete(key.name));
		
		await Promise.all(deletePromises);
		console.log(`Cleared ${allKeys.keys.length} keys from storage`);
	}

	/**
	 * Backup indicators to a single JSON blob
	 */
	async backupIndicators(): Promise<string> {
		const indicators = await this.getAllIndicators();
		const backup = {
			timestamp: new Date().toISOString(),
			count: indicators.size,
			indicators: Object.fromEntries(indicators)
		};
		
		return JSON.stringify(backup, null, 2);
	}

	/**
	 * Restore indicators from backup
	 */
	async restoreIndicators(backupData: string): Promise<number> {
		try {
			const backup = JSON.parse(backupData);
			const indicators = new Map(Object.entries(backup.indicators));
			
			await this.storeIndicators(indicators);
			console.log(`Restored ${indicators.size} indicators from backup`);
			
			return indicators.size;
		} catch (error) {
			console.error('Failed to restore indicators from backup:', error);
			throw error;
		}
	}

	/**
	 * Get indicator by value
	 */
	async getIndicator(value: string): Promise<ThreatIndicator | null> {
		const data = await this.env.THREAT_DATA.get(`${KV_KEYS.INDICATORS_PREFIX}${value}`);
		if (!data) return null;
		
		try {
			return JSON.parse(data) as ThreatIndicator;
		} catch (error) {
			console.error(`Failed to parse indicator ${value}:`, error);
			return null;
		}
	}

	/**
	 * Check if indicator exists
	 */
	async hasIndicator(value: string): Promise<boolean> {
		const data = await this.env.THREAT_DATA.get(`${KV_KEYS.INDICATORS_PREFIX}${value}`);
		return data !== null;
	}

	/**
	 * Update single indicator
	 */
	async updateIndicator(value: string, indicator: ThreatIndicator): Promise<void> {
		await this.env.THREAT_DATA.put(`${KV_KEYS.INDICATORS_PREFIX}${value}`, JSON.stringify(indicator));
	}

	/**
	 * Delete single indicator
	 */
	async deleteIndicator(value: string): Promise<void> {
		await this.env.THREAT_DATA.delete(`${KV_KEYS.INDICATORS_PREFIX}${value}`);
	}
}
