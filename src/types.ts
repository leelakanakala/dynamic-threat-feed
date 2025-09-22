// Environment bindings for Cloudflare Workers
export interface Env {
	THREAT_DATA: KVNamespace;
	CLOUDFLARE_API_TOKEN: string;
	CLOUDFLARE_ACCOUNT_ID: string;
	THREAT_SOURCES_CONFIG: string;
	FEED_NAME: string;
	FEED_DESCRIPTION: string;
	MAX_INDICATORS_PER_BATCH: string;
	FEED_UPDATE_INTERVAL_HOURS: string;
}

// Threat intelligence source configuration
export interface ThreatSource {
	name: string;
	url: string;
	format: 'plain' | 'csv' | 'json';
	weight: number;
	timeout: number;
	user_agent: string;
	enabled: boolean;
	extract_domains: boolean;  // Whether to extract domains from this source
	extract_ips: boolean;      // Whether to extract IPs from this source
}

// Parsed threat indicator (IP or domain)
export interface ThreatIndicator {
	value: string;              // IP address or domain name
	type: 'ip' | 'domain';      // Indicator type
	score: number;              // Threat confidence score
	sources: string[];          // Sources that reported this indicator
	first_seen: string;         // ISO timestamp
	last_seen: string;          // ISO timestamp
	expires_at: string;         // ISO timestamp when indicator expires
}

// Collection result from threat sources
export interface CollectionResult {
	indicators: Map<string, ThreatIndicator>;
	stats: {
		total_sources: number;
		successful_sources: string[];
		failed_sources: string[];
		total_raw_indicators: number;
		unique_ips: number;
		unique_domains: number;
		processing_time_ms: number;
	};
}

// Cloudflare Indicator Feed API types
export interface CloudflareIndicatorFeed {
	id?: string;
	name: string;
	description?: string;
	public?: boolean;
}

export interface CloudflareIndicator {
	item: string;               // IP address or domain
	type: 'ip' | 'domain';      // Indicator type
	metadata?: {
		confidence?: number;
		first_seen?: string;
		last_seen?: string;
		source?: string;
	};
}

export interface CloudflareIndicatorFeedResponse {
	success: boolean;
	errors: any[];
	messages: any[];
	result: CloudflareIndicatorFeed;
}

export interface CloudflareIndicatorUploadResponse {
	success: boolean;
	errors: any[];
	messages: any[];
	result: {
		indicators_created: number;
		indicators_updated: number;
		indicators_failed: number;
	};
}

// Feed management and metadata
export interface FeedMetadata {
	feed_id: string;
	name: string;
	description: string;
	created_at: string;
	last_updated: string;
	total_indicators: number;
	active_indicators: number;
	update_frequency: string;
	sources: string[];
}

export interface FeedUpdateResult {
	success: boolean;
	feed_id: string;
	indicators_added: number;
	indicators_updated: number;
	indicators_removed: number;
	processing_time_ms: number;
	errors: string[];
}

// Storage keys for KV namespace
export const KV_KEYS = {
	FEED_METADATA: 'feed:metadata',
	INDICATORS_PREFIX: 'indicators:',
	LAST_UPDATE: 'feed:last_update',
	UPDATE_STATS: 'feed:update_stats',
	SOURCES_CONFIG: 'config:sources'
} as const;

// API response wrapper
export interface APIResponse<T = any> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: any;
	};
	metadata: {
		timestamp: string;
		processing_time_ms: number;
		version: string;
	};
}

// Domain validation patterns
export const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
export const IP_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
