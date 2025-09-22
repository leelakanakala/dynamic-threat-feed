import { Env, APIResponse } from './types';
import { FeedManager } from './services/feedManager';

/**
 * Main Cloudflare Worker entry point
 */
export default {
	/**
	 * Handle HTTP requests (API endpoints)
	 */
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		console.log(`${method} ${path}`);

		try {
			const feedManager = new FeedManager(env);

			// Route handling
			switch (true) {
				case path === '/' && method === 'GET':
					return handleRoot();

				case path === '/status' && method === 'GET':
					return await handleStatus(feedManager);

				case path === '/update' && method === 'POST':
					return await handleManualUpdate(feedManager);

				case path === '/initialize' && method === 'POST':
					return await handleInitialize(feedManager);

				case path === '/sources' && method === 'GET':
					return await handleGetSources(feedManager);

				case path === '/sources' && method === 'PUT':
					return await handleUpdateSources(feedManager, request);

				case path === '/backup' && method === 'GET':
					return await handleBackup(feedManager);

				case path === '/restore' && method === 'POST':
					return await handleRestore(feedManager, request);

				case path === '/reset' && method === 'POST':
					return await handleReset(feedManager);

				case path.startsWith('/indicator/') && method === 'GET':
					return await handleGetIndicator(feedManager, path);

				default:
					return createErrorResponse('Not Found', 404);
			}

		} catch (error) {
			console.error('Request handling error:', error);
			return createErrorResponse(
				error instanceof Error ? error.message : 'Internal Server Error',
				500
			);
		}
	},

	/**
	 * Handle scheduled events (cron triggers)
	 */
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log('Scheduled event triggered:', event.cron);

		try {
			const feedManager = new FeedManager(env);

			// Check if update is needed
			const updateNeeded = await feedManager.isUpdateNeeded();
			
			if (updateNeeded) {
				console.log('Update needed, starting threat feed update...');
				const result = await feedManager.updateThreatFeed();
				
				if (result.success) {
					console.log(`Scheduled update completed successfully: ${result.indicators_added} added, ${result.indicators_updated} updated`);
				} else {
					console.error(`Scheduled update failed: ${result.errors.join(', ')}`);
				}
			} else {
				console.log('Update not needed, skipping...');
			}

		} catch (error) {
			console.error('Scheduled event error:', error);
			// Don't throw - we don't want to fail the scheduled event
		}
	}
};

/**
 * Handle root endpoint - basic info
 */
function handleRoot(): Response {
	const info = {
		name: 'Dynamic Threat Feed',
		version: '1.0.0',
		description: 'Cloudflare Workers-based dynamic threat intelligence feed system',
		endpoints: {
			'GET /': 'This information',
			'GET /status': 'Get feed status and statistics',
			'POST /update': 'Manually trigger feed update',
			'POST /initialize': 'Initialize the threat feed system',
			'GET /sources': 'Get active threat sources',
			'PUT /sources': 'Update threat sources configuration',
			'GET /backup': 'Backup all feed data',
			'POST /restore': 'Restore feed data from backup',
			'POST /reset': 'Reset entire feed (dangerous)',
			'GET /indicator/{value}': 'Get specific indicator information'
		},
		scheduled: 'Automatic updates via cron trigger'
	};

	return createSuccessResponse(info);
}

/**
 * Handle status endpoint
 */
async function handleStatus(feedManager: FeedManager): Promise<Response> {
	const status = await feedManager.getFeedStatus();
	return createSuccessResponse(status);
}

/**
 * Handle manual update trigger
 */
async function handleManualUpdate(feedManager: FeedManager): Promise<Response> {
	const result = await feedManager.forceUpdate();
	return createSuccessResponse(result);
}

/**
 * Handle initialization
 */
async function handleInitialize(feedManager: FeedManager): Promise<Response> {
	const metadata = await feedManager.initialize();
	return createSuccessResponse(metadata);
}

/**
 * Handle get sources
 */
async function handleGetSources(feedManager: FeedManager): Promise<Response> {
	const sources = feedManager.getActiveSources();
	return createSuccessResponse(sources);
}

/**
 * Handle update sources
 */
async function handleUpdateSources(feedManager: FeedManager, request: Request): Promise<Response> {
	try {
		const sources = await request.json();
		if (!Array.isArray(sources)) {
			return createErrorResponse('Sources must be an array', 400);
		}

		await feedManager.updateSourcesConfiguration(sources);
		return createSuccessResponse({ message: 'Sources updated successfully', count: sources.length });

	} catch (error) {
		return createErrorResponse('Invalid JSON in request body', 400);
	}
}

/**
 * Handle backup
 */
async function handleBackup(feedManager: FeedManager): Promise<Response> {
	const backup = await feedManager.backupFeedData();
	
	// Return as downloadable JSON file
	return new Response(JSON.stringify(backup, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="threat-feed-backup-${new Date().toISOString().split('T')[0]}.json"`
		}
	});
}

/**
 * Handle restore
 */
async function handleRestore(feedManager: FeedManager, request: Request): Promise<Response> {
	try {
		const backup = await request.json() as any;
		const backupData = backup as any;
		if (!backup || typeof backup !== 'object' || 
			!backupData.metadata || !backupData.indicators || !backupData.sources) {
			return createErrorResponse('Invalid backup format', 400);
		}

		await feedManager.restoreFeedData(backupData);
		return createSuccessResponse({ message: 'Feed data restored successfully' });

	} catch (error) {
		return createErrorResponse('Invalid backup data', 400);
	}
}

/**
 * Handle reset
 */
async function handleReset(feedManager: FeedManager): Promise<Response> {
	await feedManager.resetFeed();
	return createSuccessResponse({ message: 'Feed reset completed' });
}

/**
 * Handle get specific indicator
 */
async function handleGetIndicator(feedManager: FeedManager, path: string): Promise<Response> {
	const indicatorValue = decodeURIComponent(path.split('/indicator/')[1]);
	
	if (!indicatorValue) {
		return createErrorResponse('Indicator value required', 400);
	}

	// This would require adding a method to FeedManager to get individual indicators
	// For now, return a placeholder
	return createErrorResponse('Indicator lookup not yet implemented', 501);
}

/**
 * Create success response
 */
function createSuccessResponse<T>(data: T): Response {
	const response: APIResponse<T> = {
		success: true,
		data,
		metadata: {
			timestamp: new Date().toISOString(),
			processing_time_ms: 0, // Would need to track this properly
			version: '1.0.0'
		}
	};

	return new Response(JSON.stringify(response, null, 2), {
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization'
		}
	});
}

/**
 * Create error response
 */
function createErrorResponse(message: string, status: number = 500): Response {
	const response: APIResponse = {
		success: false,
		error: {
			code: status.toString(),
			message
		},
		metadata: {
			timestamp: new Date().toISOString(),
			processing_time_ms: 0,
			version: '1.0.0'
		}
	};

	return new Response(JSON.stringify(response, null, 2), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization'
		}
	});
}
