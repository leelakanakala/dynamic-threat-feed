import { ThreatSource, ThreatIndicator, CollectionResult, Env } from '../types';
import { extractIPs, extractDomains, normalizeIndicator } from '../utils/validators';

/**
 * Main threat intelligence collection service
 */
export class ThreatCollector {
	private env: Env;
	private sources: ThreatSource[];

	constructor(env: Env) {
		this.env = env;
		this.sources = this.loadThreatSources();
	}

	/**
	 * Load threat sources from environment configuration
	 */
	private loadThreatSources(): ThreatSource[] {
		try {
			const sourcesConfig = JSON.parse(this.env.THREAT_SOURCES_CONFIG);
			return sourcesConfig.filter((source: ThreatSource) => source.enabled);
		} catch (error) {
			console.error('Failed to load threat sources config:', error);
			return this.getDefaultSources();
		}
	}

	/**
	 * Default threat intelligence sources
	 */
	private getDefaultSources(): ThreatSource[] {
		return [
			{
				name: 'Abuse.ch Feodo Tracker',
				url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt',
				format: 'plain',
				weight: 8,
				timeout: 30000,
				user_agent: 'Dynamic-Threat-Feed/1.0',
				enabled: true,
				extract_domains: false,
				extract_ips: true
			},
			{
				name: 'Malware Domain List',
				url: 'https://www.malwaredomainlist.com/hostslist/hosts.txt',
				format: 'plain',
				weight: 7,
				timeout: 30000,
				user_agent: 'Dynamic-Threat-Feed/1.0',
				enabled: true,
				extract_domains: true,
				extract_ips: false
			},
			{
				name: 'Emerging Threats Compromised IPs',
				url: 'https://rules.emergingthreats.net/fwrules/emerging-Block-IPs.txt',
				format: 'plain',
				weight: 9,
				timeout: 30000,
				user_agent: 'Dynamic-Threat-Feed/1.0',
				enabled: true,
				extract_domains: false,
				extract_ips: true
			},
			{
				name: 'URLVoid Malicious URLs',
				url: 'https://www.urlvoid.com/api/1000/host/',
				format: 'plain',
				weight: 6,
				timeout: 30000,
				user_agent: 'Dynamic-Threat-Feed/1.0',
				enabled: false, // Requires API key
				extract_domains: true,
				extract_ips: false
			}
		];
	}

	/**
	 * Collect threat intelligence from all configured sources
	 */
	async collectThreatIntelligence(): Promise<CollectionResult> {
		const startTime = Date.now();
		const allIndicators = new Map<string, ThreatIndicator>();
		const stats = {
			total_sources: this.sources.length,
			successful_sources: [] as string[],
			failed_sources: [] as string[],
			total_raw_indicators: 0,
			unique_ips: 0,
			unique_domains: 0,
			processing_time_ms: 0
		};

		console.log(`Starting collection from ${this.sources.length} sources`);

		// Fetch from all sources in parallel
		const fetchPromises = this.sources.map(source => 
			this.fetchAndParseSource(source).catch(error => {
				console.error(`Failed to fetch ${source.name}:`, error);
				stats.failed_sources.push(source.name);
				return { ips: [], domains: [] };
			})
		);

		const results = await Promise.all(fetchPromises);

		// Process results from each source
		for (let i = 0; i < results.length; i++) {
			const source = this.sources[i];
			const { ips, domains } = results[i];
			const totalIndicators = ips.length + domains.length;

			if (totalIndicators > 0) {
				stats.successful_sources.push(source.name);
				stats.total_raw_indicators += totalIndicators;

				// Process IPs
				for (const ip of ips) {
					this.addThreatIndicator(allIndicators, ip, 'ip', source);
				}

				// Process domains
				for (const domain of domains) {
					this.addThreatIndicator(allIndicators, domain, 'domain', source);
				}
			}
		}

		// Calculate final stats
		for (const [, indicator] of allIndicators) {
			if (indicator.type === 'ip') {
				stats.unique_ips++;
			} else {
				stats.unique_domains++;
			}
		}

		stats.processing_time_ms = Date.now() - startTime;

		console.log(`Collection complete: ${stats.successful_sources.length}/${stats.total_sources} sources successful`);
		console.log(`Collected ${stats.unique_ips} unique IPs and ${stats.unique_domains} unique domains`);

		return { indicators: allIndicators, stats };
	}

	/**
	 * Fetch and parse data from a single threat source
	 */
	private async fetchAndParseSource(source: ThreatSource): Promise<{ ips: string[], domains: string[] }> {
		console.log(`Fetching ${source.name} from ${source.url}`);

		try {
			const response = await fetch(source.url, {
				headers: {
					'User-Agent': source.user_agent,
					'Accept': 'text/plain, text/html, */*',
				},
				signal: AbortSignal.timeout(source.timeout)
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const text = await response.text();
			console.log(`${source.name}: Fetched ${text.length} bytes`);

			const result = this.parseSourceData(text, source);
			console.log(`${source.name}: Extracted ${result.ips.length} IPs and ${result.domains.length} domains`);

			return result;

		} catch (error) {
			console.error(`${source.name} fetch failed:`, error);
			throw error;
		}
	}

	/**
	 * Parse different data formats to extract IPs and domains
	 */
	private parseSourceData(data: string, source: ThreatSource): { ips: string[], domains: string[] } {
		let ips: string[] = [];
		let domains: string[] = [];

		switch (source.format) {
			case 'plain':
				if (source.extract_ips) {
					ips = extractIPs(data);
				}
				if (source.extract_domains) {
					domains = extractDomains(data);
				}
				break;

			case 'csv':
				// TODO: Implement CSV parsing
				console.warn(`CSV format not yet implemented for ${source.name}`);
				break;

			case 'json':
				// TODO: Implement JSON parsing
				console.warn(`JSON format not yet implemented for ${source.name}`);
				break;

			default:
				throw new Error(`Unsupported format: ${source.format}`);
		}

		return { ips, domains };
	}

	/**
	 * Add or update a threat indicator in the collection
	 */
	private addThreatIndicator(
		indicators: Map<string, ThreatIndicator>,
		value: string,
		type: 'ip' | 'domain',
		source: ThreatSource
	): void {
		const timestamp = new Date().toISOString();
		const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(); // 24 hours from now

		if (indicators.has(value)) {
			// Update existing indicator
			const existing = indicators.get(value)!;
			
			if (!existing.sources.includes(source.name)) {
				existing.sources.push(source.name);
				existing.score += source.weight;
				existing.last_seen = timestamp;
				existing.expires_at = expiresAt; // Extend expiration
			}
		} else {
			// Create new indicator
			const indicator: ThreatIndicator = {
				value,
				type,
				score: source.weight,
				sources: [source.name],
				first_seen: timestamp,
				last_seen: timestamp,
				expires_at: expiresAt
			};

			indicators.set(value, indicator);
		}
	}

	/**
	 * Get active threat sources
	 */
	getActiveSources(): ThreatSource[] {
		return this.sources;
	}

	/**
	 * Update threat sources configuration
	 */
	updateSources(newSources: ThreatSource[]): void {
		this.sources = newSources.filter(source => source.enabled);
	}
}
