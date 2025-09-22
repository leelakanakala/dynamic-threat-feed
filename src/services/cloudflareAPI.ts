import {
	Env,
	CloudflareIndicatorFeed,
	CloudflareIndicator,
	CloudflareIndicatorFeedResponse,
	CloudflareIndicatorUploadResponse,
	ThreatIndicator,
	FeedMetadata
} from '../types';

/**
 * Cloudflare Indicator Feed API integration service
 */
export class CloudflareAPIService {
	private env: Env;
	private baseUrl: string;

	constructor(env: Env) {
		this.env = env;
		this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/intel/indicator-feeds`;
	}

	/**
	 * Create a new indicator feed
	 */
	async createIndicatorFeed(name: string, description: string): Promise<CloudflareIndicatorFeed> {
		const response = await this.makeAPIRequest('POST', '', {
			name,
			description,
			public: false
		});

		const data = await response.json() as CloudflareIndicatorFeedResponse;
		
		if (!data.success) {
			throw new Error(`Failed to create indicator feed: ${JSON.stringify(data.errors)}`);
		}

		console.log(`Created indicator feed: ${data.result.id} - ${data.result.name}`);
		return data.result;
	}

	/**
	 * Get existing indicator feed by name
	 */
	async getIndicatorFeed(feedName: string): Promise<CloudflareIndicatorFeed | null> {
		try {
			const response = await this.makeAPIRequest('GET', '');
			const data = await response.json() as { success: boolean; result: CloudflareIndicatorFeed[] };

			if (!data.success) {
				throw new Error('Failed to list indicator feeds');
			}

			const feed = data.result.find(f => f.name === feedName);
			return feed || null;
		} catch (error) {
			console.error('Error getting indicator feed:', error);
			return null;
		}
	}

	/**
	 * Get or create indicator feed
	 */
	async getOrCreateIndicatorFeed(): Promise<CloudflareIndicatorFeed> {
		const feedName = this.env.FEED_NAME;
		const feedDescription = this.env.FEED_DESCRIPTION;

		// Try to get existing feed first
		let feed = await this.getIndicatorFeed(feedName);
		
		if (!feed) {
			// Create new feed if it doesn't exist
			feed = await this.createIndicatorFeed(feedName, feedDescription);
		}

		return feed;
	}

	/**
	 * Upload indicators to the feed
	 */
	async uploadIndicators(feedId: string, indicators: ThreatIndicator[]): Promise<CloudflareIndicatorUploadResponse> {
		const maxBatchSize = parseInt(this.env.MAX_INDICATORS_PER_BATCH);
		const batches = this.chunkArray(indicators, maxBatchSize);
		
		let totalCreated = 0;
		let totalUpdated = 0;
		let totalFailed = 0;
		const errors: string[] = [];

		console.log(`Uploading ${indicators.length} indicators in ${batches.length} batches`);

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} indicators)`);

			try {
				const cloudflareIndicators: CloudflareIndicator[] = batch.map(indicator => ({
					item: indicator.value,
					type: indicator.type,
					metadata: {
						confidence: Math.min(100, Math.max(1, Math.round(indicator.score * 10))), // Scale to 1-100
						first_seen: indicator.first_seen,
						last_seen: indicator.last_seen,
						source: indicator.sources.join(', ')
					}
				}));

				const response = await this.makeAPIRequest('PUT', `/${feedId}/snapshot`, {
					indicators: cloudflareIndicators
				});

				const data = await response.json() as CloudflareIndicatorUploadResponse;

				if (data.success) {
					totalCreated += data.result.indicators_created;
					totalUpdated += data.result.indicators_updated;
					totalFailed += data.result.indicators_failed;
				} else {
					errors.push(`Batch ${i + 1} failed: ${JSON.stringify(data.errors)}`);
					totalFailed += batch.length;
				}

				// Add delay between batches to avoid rate limiting
				if (i < batches.length - 1) {
					await this.delay(1000); // 1 second delay
				}

			} catch (error) {
				const errorMsg = `Batch ${i + 1} error: ${error}`;
				console.error(errorMsg);
				errors.push(errorMsg);
				totalFailed += batch.length;
			}
		}

		const result: CloudflareIndicatorUploadResponse = {
			success: errors.length === 0,
			errors: errors,
			messages: [],
			result: {
				indicators_created: totalCreated,
				indicators_updated: totalUpdated,
				indicators_failed: totalFailed
			}
		};

		console.log(`Upload complete: ${totalCreated} created, ${totalUpdated} updated, ${totalFailed} failed`);
		return result;
	}

	/**
	 * Update feed with new indicators (replaces all existing indicators)
	 */
	async updateFeedSnapshot(feedId: string, indicators: ThreatIndicator[]): Promise<CloudflareIndicatorUploadResponse> {
		console.log(`Updating feed snapshot with ${indicators.length} indicators`);
		
		// Filter out expired indicators
		const now = new Date();
		const activeIndicators = indicators.filter(indicator => 
			new Date(indicator.expires_at) > now
		);

		console.log(`Filtered to ${activeIndicators.length} active indicators (${indicators.length - activeIndicators.length} expired)`);

		return await this.uploadIndicators(feedId, activeIndicators);
	}

	/**
	 * Delete an indicator feed
	 */
	async deleteIndicatorFeed(feedId: string): Promise<boolean> {
		try {
			const response = await this.makeAPIRequest('DELETE', `/${feedId}`);
			const data = await response.json();
			
			if (data.success) {
				console.log(`Deleted indicator feed: ${feedId}`);
				return true;
			} else {
				console.error(`Failed to delete feed: ${JSON.stringify(data.errors)}`);
				return false;
			}
		} catch (error) {
			console.error('Error deleting indicator feed:', error);
			return false;
		}
	}

	/**
	 * Get feed statistics
	 */
	async getFeedStats(feedId: string): Promise<any> {
		try {
			const response = await this.makeAPIRequest('GET', `/${feedId}/data`);
			const data = await response.json();
			
			if (data.success) {
				return data.result;
			} else {
				throw new Error(`Failed to get feed stats: ${JSON.stringify(data.errors)}`);
			}
		} catch (error) {
			console.error('Error getting feed stats:', error);
			return null;
		}
	}

	/**
	 * Make authenticated API request to Cloudflare
	 */
	private async makeAPIRequest(method: string, endpoint: string, body?: any): Promise<Response> {
		const url = `${this.baseUrl}${endpoint}`;
		
		const options: RequestInit = {
			method,
			headers: {
				'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
				'Content-Type': 'application/json',
				'User-Agent': 'Dynamic-Threat-Feed/1.0'
			}
		};

		if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
			options.body = JSON.stringify(body);
		}

		console.log(`Making ${method} request to ${url}`);
		
		const response = await fetch(url, options);
		
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`HTTP ${response.status}: ${errorText}`);
		}

		return response;
	}

	/**
	 * Split array into chunks of specified size
	 */
	private chunkArray<T>(array: T[], chunkSize: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += chunkSize) {
			chunks.push(array.slice(i, i + chunkSize));
		}
		return chunks;
	}

	/**
	 * Delay execution for specified milliseconds
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Validate API credentials
	 */
	async validateCredentials(): Promise<boolean> {
		try {
			const response = await this.makeAPIRequest('GET', '');
			return response.ok;
		} catch (error) {
			console.error('API credentials validation failed:', error);
			return false;
		}
	}

	/**
	 * Convert threat indicators to Cloudflare format
	 */
	convertToCloudflareFormat(indicators: ThreatIndicator[]): CloudflareIndicator[] {
		return indicators.map(indicator => ({
			item: indicator.value,
			type: indicator.type,
			metadata: {
				confidence: Math.min(100, Math.max(1, Math.round(indicator.score * 10))),
				first_seen: indicator.first_seen,
				last_seen: indicator.last_seen,
				source: indicator.sources.join(', ')
			}
		}));
	}
}
