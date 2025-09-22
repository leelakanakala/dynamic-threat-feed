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
	 * Store threat indicators (OPTIMIZED: Chunked storage for large datasets)
	 */
	async storeIndicators(indicators: Map<string, ThreatIndicator>): Promise<void> {
		console.log(`Storing ${indicators.size} indicators using chunked storage`);
		
		// Convert Map to object for JSON serialization
		const indicatorsObject = Object.fromEntries(indicators);
		const fullData = JSON.stringify(indicatorsObject);
		
		// Check if data fits in single KV entry (20MB limit to be safe)
		const maxChunkSize = 20 * 1024 * 1024; // 20MB
		
		if (fullData.length <= maxChunkSize) {
			// Store in single entry
			await this.env.THREAT_DATA.put(KV_KEYS.ALL_INDICATORS, fullData);
			// Clear any existing chunks
			await this.env.THREAT_DATA.delete(KV_KEYS.INDICATORS_INDEX);
			console.log(`Stored ${indicators.size} indicators in single entry (${Math.round(fullData.length / 1024 / 1024 * 100) / 100}MB)`);
		} else {
			// Split into chunks
			console.log(`Data size ${Math.round(fullData.length / 1024 / 1024 * 100) / 100}MB exceeds limit, splitting into chunks`);
			
			const chunks: string[] = [];
			for (let i = 0; i < fullData.length; i += maxChunkSize) {
				chunks.push(fullData.slice(i, i + maxChunkSize));
			}
			
			console.log(`Split into ${chunks.length} chunks`);
			
			// Store chunks
			const chunkPromises = chunks.map((chunk, index) => 
				this.env.THREAT_DATA.put(`${KV_KEYS.INDICATORS_CHUNKS}${index}`, chunk)
			);
			
			// Store chunk index
			const chunkIndex = {
				total_chunks: chunks.length,
				total_size: fullData.length,
				created_at: new Date().toISOString()
			};
			
			await Promise.all([
				...chunkPromises,
				this.env.THREAT_DATA.put(KV_KEYS.INDICATORS_INDEX, JSON.stringify(chunkIndex))
			]);
			
			// Clear single entry if it exists
			await this.env.THREAT_DATA.delete(KV_KEYS.ALL_INDICATORS);
			
			console.log(`Successfully stored ${indicators.size} indicators in ${chunks.length} chunks`);
		}
	}

	/**
	 * Get all stored indicators (OPTIMIZED: Chunked storage support)
	 */
	async getAllIndicators(): Promise<Map<string, ThreatIndicator>> {
		console.log('Loading indicators from storage');
		
		// Check if we have chunked data
		const chunkIndexData = await this.env.THREAT_DATA.get(KV_KEYS.INDICATORS_INDEX);
		
		if (chunkIndexData) {
			// Load from chunks
			const chunkIndex = JSON.parse(chunkIndexData) as {
				total_chunks: number;
				total_size: number;
				created_at: string;
			};
			
			console.log(`Loading ${chunkIndex.total_chunks} chunks (${Math.round(chunkIndex.total_size / 1024 / 1024 * 100) / 100}MB total)`);
			
			// Load all chunks in parallel
			const chunkPromises = Array.from({ length: chunkIndex.total_chunks }, (_, index) =>
				this.env.THREAT_DATA.get(`${KV_KEYS.INDICATORS_CHUNKS}${index}`)
			);
			
			const chunks = await Promise.all(chunkPromises);
			
			// Reconstruct full data
			const fullData = chunks.join('');
			
			try {
				const indicatorsObject = JSON.parse(fullData) as Record<string, ThreatIndicator>;
				const indicators = new Map(Object.entries(indicatorsObject));
				
				console.log(`Loaded ${indicators.size} indicators from ${chunkIndex.total_chunks} chunks`);
				return indicators;
			} catch (error) {
				console.error('Failed to parse chunked indicators:', error);
				return new Map();
			}
		} else {
			// Try to load from single entry (legacy support)
			const data = await this.env.THREAT_DATA.get(KV_KEYS.ALL_INDICATORS);
			
			if (!data) {
				console.log('No indicators found in storage');
				return new Map();
			}

			try {
				const indicatorsObject = JSON.parse(data) as Record<string, ThreatIndicator>;
				const indicators = new Map(Object.entries(indicatorsObject));
				
				console.log(`Loaded ${indicators.size} indicators from single entry`);
				return indicators;
			} catch (error) {
				console.error('Failed to parse indicators from storage:', error);
				return new Map();
			}
		}
	}

	/**
	 * Get active indicators (non-expired)
	 */
	async getActiveIndicators(): Promise<Map<string, ThreatIndicator>> {
		const allIndicators = await this.getAllIndicators();
		const activeIndicators = new Map<string, ThreatIndicator>();
		const now = new Date();

		for (const [key, indicator] of allIndicators) {
			const expiresAt = new Date(indicator.expires_at);
			if (expiresAt > now) {
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
				expiredKeys.push(key);
				expiredCount++;
			}
		}

		if (expiredKeys.length > 0) {
			console.log(`Cleaning up ${expiredKeys.length} expired indicators`);
			
			// Delete in batches
			const batchSize = 100;
			for (let i = 0; i < expiredKeys.length; i += batchSize) {
				const batch = expiredKeys.slice(i, i + batchSize);
				const promises = batch.map(key => this.env.THREAT_DATA.delete(`${KV_KEYS.INDICATORS_PREFIX}${key}`));
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
	 * Clear all indicator data (including chunks)
	 */
	async clearAllIndicatorData(): Promise<void> {
		console.log('Clearing all indicator data...');
		
		// Clear single entry
		await this.env.THREAT_DATA.delete(KV_KEYS.ALL_INDICATORS);
		
		// Clear chunked data
		const chunkIndexData = await this.env.THREAT_DATA.get(KV_KEYS.INDICATORS_INDEX);
		if (chunkIndexData) {
			const chunkIndex = JSON.parse(chunkIndexData) as { total_chunks: number };
			
			// Delete all chunks
			const deletePromises = Array.from({ length: chunkIndex.total_chunks }, (_, index) =>
				this.env.THREAT_DATA.delete(`${KV_KEYS.INDICATORS_CHUNKS}${index}`)
			);
			
			await Promise.all([
				...deletePromises,
				this.env.THREAT_DATA.delete(KV_KEYS.INDICATORS_INDEX)
			]);
			
			console.log(`Cleared ${chunkIndex.total_chunks} chunks`);
		}
		
		console.log('All indicator data cleared');
	}

	/**
	 * Clear all data from storage (OPTIMIZED: Chunked storage support)
	 */
	async clearAllData(): Promise<void> {
		console.warn('Clearing all data from KV storage');
		
		// Clear all indicator data (including chunks)
		await this.clearAllIndicatorData();
		
		// Clear other data
		await Promise.all([
			this.env.THREAT_DATA.delete(KV_KEYS.FEED_METADATA),
			this.env.THREAT_DATA.delete(KV_KEYS.LAST_UPDATE),
			this.env.THREAT_DATA.delete(KV_KEYS.UPDATE_STATS),
			this.env.THREAT_DATA.delete(KV_KEYS.SOURCES_CONFIG)
		]);
		
		console.log('All data cleared from storage');
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
			const backup = JSON.parse(backupData) as { indicators: Record<string, ThreatIndicator> };
			const indicators = new Map<string, ThreatIndicator>();
			
			// Convert backup object to Map with proper typing
			for (const [key, value] of Object.entries(backup.indicators)) {
				indicators.set(key, value);
			}
			
			await this.storeIndicators(indicators);
			console.log(`Restored ${indicators.size} indicators from backup`);
			
			return indicators.size;
		} catch (error) {
			console.error('Error restoring indicators:', error);
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
