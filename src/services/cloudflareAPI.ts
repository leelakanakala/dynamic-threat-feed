import {
	Env,
	CloudflareGatewayList,
	CloudflareGatewayListResponse,
	CloudflareGatewayListUploadResponse,
	CSVRecord,
	ThreatIndicator,
	FeedMetadata
} from '../types';

/**
 * Cloudflare Gateway Lists API integration service
 */
export class CloudflareAPIService {
	private env: Env;
	private baseUrl: string;

	constructor(env: Env) {
		this.env = env;
		this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/gateway/lists`;
	}

	/**
	 * Create a new Gateway List
	 */
	async createGatewayList(name: string, description: string, type: 'IP' | 'DOMAIN'): Promise<CloudflareGatewayList> {
		const response = await this.makeRequest(`${this.baseUrl}`, 'POST', {
			name,
			description,
			type
		});

		const data = response as CloudflareGatewayListResponse;
		
		if (!data.success) {
			throw new Error(`Failed to create Gateway List: ${JSON.stringify(data.errors)}`);
		}

		console.log(`Created Gateway List: ${data.result.id} - ${data.result.name}`);
		return data.result;
	}

	/**
	 * Get existing Gateway List by name
	 */
	async getGatewayList(listName: string): Promise<CloudflareGatewayList | null> {
		try {
			const response = await this.makeRequest(`${this.baseUrl}`);
			const data = response as { success: boolean; result: CloudflareGatewayList[] };

			if (!data.success) {
				throw new Error('Failed to list Gateway Lists');
			}

			const list = data.result.find(l => l.name === listName);
			return list || null;
		} catch (error) {
			console.error('Error getting Gateway List:', error);
			return null;
		}
	}

	/**
	 * Get or create Gateway List
	 */
	async getOrCreateGatewayList(): Promise<CloudflareGatewayList> {
		const listName = this.env.FEED_NAME;
		const listDescription = this.env.FEED_DESCRIPTION;

		// Try to get existing list first
		let list = await this.getGatewayList(listName);
		
		if (!list) {
			// Create new list if it doesn't exist - using IP type for mixed content
			list = await this.createGatewayList(listName, listDescription, 'IP');
		}

		return list;
	}

	/**
	 * Generate CSV content from threat indicators
	 */
	generateCSV(indicators: ThreatIndicator[]): string {
		const csvRecords: CSVRecord[] = indicators.map(indicator => ({
			value: indicator.value,
			description: `${indicator.type.toUpperCase()} - Score: ${indicator.score.toFixed(1)} - Sources: ${indicator.sources.join(', ')} - Last seen: ${indicator.last_seen}`
		}));

		// CSV header
		let csv = 'value,description\n';
		
		// CSV rows
		for (const record of csvRecords) {
			// Escape commas and quotes in description
			const escapedDescription = record.description
				.replace(/"/g, '""')
				.replace(/,/g, ' ');
			
			csv += `"${record.value}","${escapedDescription}"\n`;
		}

		return csv;
	}

	/**
	 * Update Gateway List with indicators (FIXED: Multiple lists for 5000 item limit + Memory optimized)
	 */
	async updateGatewayListSnapshot(listId: string, indicators: ThreatIndicator[]): Promise<CloudflareGatewayListUploadResponse> {
		console.log(`Processing ${indicators.length} indicators for Gateway Lists (Memory usage: ~${Math.round(indicators.length * 0.5 / 1024)}KB)`);
		
		// Filter out expired indicators
		const now = new Date();
		const activeIndicators = indicators.filter(indicator => 
			new Date(indicator.expires_at) > now
		);

		console.log(`Filtered to ${activeIndicators.length} active indicators (${indicators.length - activeIndicators.length} expired)`);
		
		// Check if we need multiple lists due to 5000 item limit
		const maxItemsPerList = 4500; // Conservative limit under 5000
		
		if (activeIndicators.length <= maxItemsPerList) {
			// Single list approach for smaller datasets
			console.log(`Using single Gateway List approach (${activeIndicators.length} ≤ ${maxItemsPerList}) - Memory efficient`);
			return await this.updateSingleList(listId, activeIndicators);
		} else {
			// Multiple lists approach for large datasets
			console.log(`Using multiple Gateway Lists approach (${activeIndicators.length} > ${maxItemsPerList}) - Streaming mode for memory efficiency`);
			
			// Clear the original indicators array to free memory before processing
			indicators.length = 0;
			
			return await this.createMultipleLists(activeIndicators);
		}
	}

	/**
	 * Update a single Gateway List (for datasets under 4500 items)
	 */
	private async updateSingleList(listId: string, indicators: ThreatIndicator[]): Promise<CloudflareGatewayListUploadResponse> {
		console.log(`Updating single Gateway List ${listId} with ${indicators.length} indicators`);
		
		// Convert indicators to Gateway Lists format
		const items = indicators.map(indicator => ({
			value: indicator.value,
			comment: `${indicator.type.toUpperCase()} - Score: ${indicator.score} - Sources: ${indicator.sources.join(', ')} - Last seen: ${indicator.last_seen}`
		}));

		// Process in batches within the single list
		const batchSize = 1000;
		const batches = [];
		
		for (let i = 0; i < items.length; i += batchSize) {
			batches.push(items.slice(i, i + batchSize));
		}

		console.log(`Processing ${items.length} items in ${batches.length} batches for single list`);

		try {
			// Clear the existing list
			await this.clearGatewayList(listId);

			// Process batches sequentially
			let totalProcessed = 0;
			for (let i = 0; i < batches.length; i++) {
				const batch = batches[i];
				console.log(`Processing batch ${i + 1}/${batches.length} with ${batch.length} items`);

				const response = await this.makeRequest(`${this.baseUrl}/${listId}`, 'PATCH', {
					append: batch
				});

				if (!response.success) {
					console.error(`Batch ${i + 1} failed: ${JSON.stringify(response.errors)}`);
					return {
						success: false,
						result: { operation_id: '' },
						errors: response.errors || [`Batch ${i + 1} failed`],
						messages: []
					};
				}

				totalProcessed += batch.length;
				console.log(`Batch ${i + 1} completed. Total processed: ${totalProcessed}/${items.length}`);

				if (i < batches.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}

			console.log(`✅ Single Gateway List updated successfully with ${totalProcessed} items`);
			return {
				success: true,
				result: { operation_id: 'single_list_success' },
				errors: [],
				messages: [`Updated single Gateway List with ${totalProcessed} items`]
			};

		} catch (error) {
			console.error('Single Gateway List update error:', error);
			return {
				success: false,
				result: { operation_id: '' },
				errors: [error instanceof Error ? error.message : 'Update failed'],
				messages: []
			};
		}
	}

	/**
	 * Create multiple Gateway Lists (for datasets over 4500 items)
	 */
	private async createMultipleLists(indicators: ThreatIndicator[]): Promise<CloudflareGatewayListUploadResponse> {
		console.log(`Creating multiple Gateway Lists for ${indicators.length} indicators`);
		
		try {
			// Clean up old Gateway Lists first
			await this.cleanupOldGatewayLists();

			// Split indicators into multiple lists
			const maxItemsPerList = 4500;
			const lists: ThreatIndicator[][] = [];
			
			for (let i = 0; i < indicators.length; i += maxItemsPerList) {
				lists.push(indicators.slice(i, i + maxItemsPerList));
			}

			console.log(`Splitting ${indicators.length} indicators into ${lists.length} Gateway Lists of max ${maxItemsPerList} items each`);

			const createdListIds: string[] = [];

			// Create and populate each Gateway List
			for (let i = 0; i < lists.length; i++) {
				const listItems = lists[i];
				
				if (!listItems || listItems.length === 0) {
					console.warn(`Skipping empty list at index ${i}`);
					continue;
				}
				
				// Improved naming convention
				const listNumber = String(i + 1).padStart(3, '0');
				const totalLists = String(lists.length).padStart(3, '0');
				const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
				const listName = `DynamicThreatFeed-${timestamp}-Part${listNumber}of${totalLists}`;
				const listDescription = `Dynamic Threat Intelligence Feed (${timestamp}) - Part ${listNumber} of ${totalLists} - Contains ${listItems.length} indicators from Abuse.ch, EmergingThreats, and other threat sources`;
				
				console.log(`Creating Gateway List ${i + 1}/${lists.length}: ${listName} with ${listItems.length} items`);
				
				try {
					// Create the Gateway List
					const gatewayList = await this.createGatewayList(listName, listDescription, 'IP');
					
					if (!gatewayList.id) {
						console.error(`Failed to create Gateway List ${listName}: No ID returned`);
						continue;
					}

					// Convert indicators to Gateway Lists format
					const items = listItems.map(indicator => ({
						value: indicator.value,
						comment: `${indicator.type.toUpperCase()} - Score: ${indicator.score} - Sources: ${indicator.sources.join(', ')} - Last seen: ${indicator.last_seen}`
					}));

					// Add items to the list in batches
					const batchSize = 1000;
					const batches = [];
					
					for (let j = 0; j < items.length; j += batchSize) {
						batches.push(items.slice(j, j + batchSize));
					}

					let totalProcessed = 0;
					for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
						const batch = batches[batchIndex];
						console.log(`  Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} items`);

						const response = await this.makeRequest(`${this.baseUrl}/${gatewayList.id}`, 'PATCH', {
							append: batch
						});

						if (!response.success) {
							console.error(`Batch ${batchIndex + 1} failed for list ${listName}: ${JSON.stringify(response.errors)}`);
							throw new Error(`Batch ${batchIndex + 1} failed for list ${listName}`);
						}

						totalProcessed += batch.length;
						console.log(`  Batch ${batchIndex + 1} completed. List progress: ${totalProcessed}/${items.length}`);

						// Small delay between batches
						if (batchIndex < batches.length - 1) {
							await new Promise(resolve => setTimeout(resolve, 500));
						}
					}

					console.log(`✅ Gateway List ${listName} completed with ${totalProcessed} items`);
					createdListIds.push(gatewayList.id);

					// Delay between lists to be respectful
					if (i < lists.length - 1) {
						await new Promise(resolve => setTimeout(resolve, 1000));
					}

				} catch (error) {
					console.error(`Failed to create/populate Gateway List ${listName}:`, error);
					// Continue with other lists even if one fails
				}
			}

			// Store the list IDs for future reference
			await this.storeGatewayListIds(createdListIds);

			console.log(`🎯 Successfully created ${createdListIds.length} Gateway Lists with ${indicators.length} total items`);
			
			return {
				success: true,
				result: { operation_id: `multi_list_success_${createdListIds.length}_lists` },
				errors: [],
				messages: [`Created ${createdListIds.length} Gateway Lists with ${indicators.length} total items`]
			};

		} catch (error) {
			console.error('Multiple Gateway Lists creation error:', error);
			return {
				success: false,
				result: { operation_id: '' },
				errors: [error instanceof Error ? error.message : 'Multiple lists creation failed'],
				messages: []
			};
		}
	}

	/**
	 * Delete a Gateway List
	 */
	async deleteGatewayList(listId: string): Promise<boolean> {
		try {
			const response = await this.makeRequest(`${this.baseUrl}/${listId}`, 'DELETE');
			const data = response as { success: boolean; errors?: any[] };
			
			if (data.success) {
				console.log(`Deleted Gateway List: ${listId}`);
				return true;
			} else {
				console.error(`Failed to delete Gateway List: ${JSON.stringify(data.errors)}`);
				return false;
			}
		} catch (error) {
			console.error('Error deleting Gateway List:', error);
			return false;
		}
	}

	/**
	 * Get Gateway List statistics
	 */
	async getGatewayListStats(listId: string): Promise<any> {
		try {
			const response = await this.makeRequest(`${this.baseUrl}/${listId}`);
			const data = response as { success: boolean; result?: any; errors?: any[] };
			
			if (data.success) {
				return data.result;
			} else {
				throw new Error(`Failed to get Gateway List stats: ${JSON.stringify(data.errors)}`);
			}
		} catch (error) {
			console.error('Error getting Gateway List stats:', error);
			return null;
		}
	}

	/**
	 * Clear a Gateway List
	 */
	private async clearGatewayList(listId: string): Promise<void> {
		try {
			const response = await this.makeRequest(`${this.baseUrl}/${listId}`, 'PATCH', {
				clear: true
			});

			if (!response.success) {
				throw new Error(`Failed to clear Gateway List: ${JSON.stringify(response.errors)}`);
			}

			console.log(`Gateway List cleared: ${listId}`);
		} catch (error) {
			console.error('Error clearing Gateway List:', error);
		}
	}

	/**
	 * Make HTTP request with retry logic for rate limiting
	 */
	private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
		const maxRetries = 3;
		const baseDelay = 2000; // 2 seconds

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const options: RequestInit = {
					method,
					headers: {
						'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
						'Content-Type': 'application/json',
						'User-Agent': 'Dynamic-Threat-Feed/1.0'
					}
				};

				if (body) {
					options.body = JSON.stringify(body);
				}

				console.log(`API Request (attempt ${attempt}): ${method} ${endpoint}`);
				const response = await fetch(endpoint, options);

				if (response.status === 429) {
					// Rate limited - wait and retry
					const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
					console.log(`Rate limited. Waiting ${delay}ms before retry ${attempt}/${maxRetries}`);
					
					if (attempt < maxRetries) {
						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`HTTP ${response.status}: ${errorText}`);
				}

				return await response.json();

			} catch (error) {
				console.error(`API request failed (attempt ${attempt}):`, error);
				
				if (attempt === maxRetries) {
					throw error;
				}
				
				// Wait before retry
				const delay = baseDelay * Math.pow(2, attempt - 1);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	/**
	 * Make file upload request to Cloudflare
	 */
	private async makeFileUploadRequest(endpoint: string, formData: FormData): Promise<any> {
		const maxRetries = 3;
		const baseDelay = 2000; // 2 seconds

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const options: RequestInit = {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
						'User-Agent': 'Dynamic-Threat-Feed/1.0'
						// Don't set Content-Type for FormData - browser will set it with boundary
					},
					body: formData
				};

				console.log(`Making file upload request to ${endpoint} (attempt ${attempt})`);
				
				const response = await fetch(endpoint, options);
				
				if (response.status === 429) {
					// Rate limited - wait and retry
					const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
					console.log(`Rate limited. Waiting ${delay}ms before retry ${attempt}/${maxRetries}`);
					
					if (attempt < maxRetries) {
						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`HTTP ${response.status}: ${errorText}`);
				}

				return await response.json();

			} catch (error) {
				console.error(`File upload request failed (attempt ${attempt}):`, error);
				
				if (attempt === maxRetries) {
					throw error;
				}
				
				// Wait before retry
				const delay = baseDelay * Math.pow(2, attempt - 1);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	/**
	 * Make file upload request to Cloudflare with PATCH method
	 */
	private async makeFileUploadRequestPatch(endpoint: string, formData: FormData): Promise<any> {
		const maxRetries = 3;
		const baseDelay = 2000; // 2 seconds

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const options: RequestInit = {
					method: 'PATCH',
					headers: {
						'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
						'User-Agent': 'Dynamic-Threat-Feed/1.0'
						// Don't set Content-Type for FormData - browser will set it with boundary
					},
					body: formData
				};

				console.log(`Making file upload request to ${endpoint} (attempt ${attempt})`);
				
				const response = await fetch(endpoint, options);
				
				if (response.status === 429) {
					// Rate limited - wait and retry
					const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
					console.log(`Rate limited. Waiting ${delay}ms before retry ${attempt}/${maxRetries}`);
					
					if (attempt < maxRetries) {
						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`HTTP ${response.status}: ${errorText}`);
				}

				return await response.json();

			} catch (error) {
				console.error(`File upload request failed (attempt ${attempt}):`, error);
				
				if (attempt === maxRetries) {
					throw error;
				}
				
				// Wait before retry
				const delay = baseDelay * Math.pow(2, attempt - 1);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}
	}

	/**
	 * Validate API credentials
	 */
	async validateCredentials(): Promise<boolean> {
		try {
			const response = await this.makeRequest(`${this.baseUrl}`);
			return response.success;
		} catch (error) {
			console.error('API credentials validation failed:', error);
			return false;
		}
	}

	// New methods for multiple Gateway Lists strategy
	private async cleanupOldGatewayLists(): Promise<void> {
		try {
			console.log('🧹 Cleaning up old Gateway Lists...');
			
			// Get all existing Gateway Lists
			const response = await this.makeRequest(`${this.baseUrl}`);
			const data = response as { success: boolean; result: CloudflareGatewayList[] };

			if (!data.success) {
				console.error('Failed to list Gateway Lists for cleanup');
				return;
			}

			// Find lists that match our naming pattern
			const feedNamePrefix = 'DynamicThreatFeed-';
			const oldLists = data.result.filter(list => 
				list.name.startsWith(feedNamePrefix)
			);

			console.log(`Found ${oldLists.length} existing Gateway Lists to clean up`);

			// Delete old lists
			for (const list of oldLists) {
				if (!list.id) {
					console.warn(`  Skipping Gateway List with missing ID: ${list.name}`);
					continue;
				}
				
				console.log(`  Deleting old Gateway List: ${list.name} (${list.id})`);
				await this.deleteGatewayList(list.id);
				
				// Small delay between deletions
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			console.log('✅ Cleanup completed');
		} catch (error) {
			console.error('Error during Gateway Lists cleanup:', error);
			// Don't throw - cleanup failure shouldn't stop the main process
		}
	}

	private async storeGatewayListIds(listIds: string[]): Promise<void> {
		try {
			// Store the list IDs in KV for future reference
			const listData = {
				ids: listIds,
				created_at: new Date().toISOString(),
				count: listIds.length
			};

			// Use a simple KV key for storing Gateway List metadata
			await this.env.THREAT_DATA.put('gateway_lists:metadata', JSON.stringify(listData));
			console.log(`📝 Stored ${listIds.length} Gateway List IDs for future reference`);
		} catch (error) {
			console.error('Error storing Gateway List IDs:', error);
			// Don't throw - storage failure shouldn't stop the main process
		}
	}

	/**
	 * Get stored Gateway List IDs
	 */
	async getStoredGatewayListIds(): Promise<string[]> {
		try {
			const data = await this.env.THREAT_DATA.get('gateway_lists:metadata');
			if (!data) {
				return [];
			}

			const listData = JSON.parse(data) as { ids: string[]; created_at: string; count: number };
			return listData.ids || [];
		} catch (error) {
			console.error('Error retrieving stored Gateway List IDs:', error);
			return [];
		}
	}

	// Legacy methods for backward compatibility (can be removed later)
	async getOrCreateIndicatorFeed() {
		return await this.getOrCreateGatewayList();
	}

	async updateFeedSnapshot(feedId: string, indicators: ThreatIndicator[]) {
		return await this.updateGatewayListSnapshot(feedId, indicators);
	}

	async getFeedStats(feedId: string) {
		return await this.getGatewayListStats(feedId);
	}

	// New method for multiple Gateway Lists strategy
	private async createMultipleGatewayLists(indicators: ThreatIndicator[]): Promise<string[]> {
		const maxItemsPerList = 4500; // Conservative limit under 5000
		const lists: ThreatIndicator[][] = [];
		
		for (let i = 0; i < indicators.length; i += maxItemsPerList) {
			lists.push(indicators.slice(i, i + maxItemsPerList));
		}

		console.log(`Splitting ${indicators.length} indicators into ${lists.length} Gateway Lists of max ${maxItemsPerList} items each`);

		const createdListIds: string[] = [];

		// Create multiple Gateway Lists as needed
		for (let i = 0; i < lists.length; i++) {
			const listItems = lists[i];
			
			// Safety check for undefined
			if (!listItems || listItems.length === 0) {
				console.warn(`Skipping empty list at index ${i}`);
				continue;
			}
			
			// Improved naming convention with source reference and clear sequencing
			const listNumber = String(i + 1).padStart(3, '0'); // 001, 002, 003, etc.
			const totalLists = String(lists.length).padStart(3, '0');
			const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
			const listName = `DynamicThreatFeed-${timestamp}-Part${listNumber}of${totalLists}`;
			const listDescription = `Dynamic Threat Intelligence Feed (${timestamp}) - Part ${listNumber} of ${totalLists} - Contains ${listItems.length} indicators from Abuse.ch, EmergingThreats, and other threat sources`;
			
			console.log(`Creating Gateway List ${i + 1}/${lists.length}: ${listName} with ${listItems.length} items`);
			
			try {
				const list = await this.createGatewayList(listName, listDescription, 'IP');
				if (list.id) {
					createdListIds.push(list.id);
				}
			} catch (error) {
				console.error(`Failed to create Gateway List ${listName}:`, error);
			}
		}

		return createdListIds;
	}
}
