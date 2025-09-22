import { IP_REGEX, DOMAIN_REGEX } from '../types';

/**
 * Validates if a string is a valid IPv4 address
 */
export function isValidIP(ip: string): boolean {
	return IP_REGEX.test(ip);
}

/**
 * Validates if a string is a valid domain name
 */
export function isValidDomain(domain: string): boolean {
	// Basic length checks
	if (!domain || domain.length > 253) {
		return false;
	}
	
	// Remove trailing dot if present
	const cleanDomain = domain.endsWith('.') ? domain.slice(0, -1) : domain;
	
	// Check against regex pattern
	if (!DOMAIN_REGEX.test(cleanDomain)) {
		return false;
	}
	
	// Additional checks for domain structure
	const labels = cleanDomain.split('.');
	
	// Must have at least 2 labels (e.g., example.com)
	if (labels.length < 2) {
		return false;
	}
	
	// Each label must be valid
	for (const label of labels) {
		if (label.length === 0 || label.length > 63) {
			return false;
		}
		
		// Labels cannot start or end with hyphens
		if (label.startsWith('-') || label.endsWith('-')) {
			return false;
		}
	}
	
	return true;
}

/**
 * Extracts IP addresses from text content
 */
export function extractIPs(text: string): string[] {
	const ips: string[] = [];
	const lines = text.split('\n');
	
	for (const line of lines) {
		const trimmed = line.trim();
		
		// Skip empty lines and comments
		if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) {
			continue;
		}
		
		// Look for IP addresses in the line
		const ipMatches = trimmed.match(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g);
		
		if (ipMatches) {
			for (const ip of ipMatches) {
				if (isValidIP(ip) && !isPrivateIP(ip)) {
					ips.push(ip);
				}
			}
		}
	}
	
	return [...new Set(ips)]; // Remove duplicates
}

/**
 * Extracts domain names from text content
 */
export function extractDomains(text: string): string[] {
	const domains: string[] = [];
	const lines = text.split('\n');
	
	for (const line of lines) {
		const trimmed = line.trim();
		
		// Skip empty lines and comments
		if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) {
			continue;
		}
		
		// Remove common prefixes and extract potential domains
		let cleanLine = trimmed
			.replace(/^https?:\/\//, '')  // Remove http/https
			.replace(/^www\./, '')        // Remove www prefix
			.split(/[\s,;|]+/)[0]         // Take first part before whitespace/separators
			.split('/')[0];               // Remove path components
		
		// Check if it looks like a domain
		if (isValidDomain(cleanLine)) {
			domains.push(cleanLine.toLowerCase());
		}
		
		// Also look for domains in URLs within the text
		const urlMatches = trimmed.match(/https?:\/\/([a-zA-Z0-9.-]+)/g);
		if (urlMatches) {
			for (const url of urlMatches) {
				const domain = url.replace(/^https?:\/\//, '').split('/')[0];
				if (isValidDomain(domain)) {
					domains.push(domain.toLowerCase());
				}
			}
		}
	}
	
	return [...new Set(domains)]; // Remove duplicates
}

/**
 * Checks if an IP address is in private/reserved ranges
 */
export function isPrivateIP(ip: string): boolean {
	if (!isValidIP(ip)) {
		return false;
	}
	
	const parts = ip.split('.').map(Number);
	const first = parts[0];
	const second = parts[1];
	
	// Private ranges
	if (first === 10) return true;                          // 10.0.0.0/8
	if (first === 172 && second >= 16 && second <= 31) return true;  // 172.16.0.0/12
	if (first === 192 && second === 168) return true;      // 192.168.0.0/16
	
	// Loopback
	if (first === 127) return true;                         // 127.0.0.0/8
	
	// Link-local
	if (first === 169 && second === 254) return true;      // 169.254.0.0/16
	
	// Multicast and reserved
	if (first >= 224) return true;                          // 224.0.0.0/4 and above
	
	return false;
}

/**
 * Normalizes an indicator value (IP or domain)
 */
export function normalizeIndicator(value: string): { normalized: string; type: 'ip' | 'domain' | null } {
	const trimmed = value.trim().toLowerCase();
	
	if (isValidIP(trimmed)) {
		return { normalized: trimmed, type: 'ip' };
	}
	
	if (isValidDomain(trimmed)) {
		return { normalized: trimmed, type: 'domain' };
	}
	
	return { normalized: trimmed, type: null };
}

/**
 * Converts IP address to integer for comparison operations
 */
export function ipToInt(ip: string): number {
	const parts = ip.split('.').map(Number);
	return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/**
 * Checks if an IP is within a CIDR range
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
	try {
		const [rangeIp, prefixLengthStr] = cidr.split('/');
		const prefixLength = parseInt(prefixLengthStr, 10);
		
		if (!isValidIP(ip) || !isValidIP(rangeIp) || isNaN(prefixLength)) {
			return false;
		}
		
		if (prefixLength < 0 || prefixLength > 32) {
			return false;
		}
		
		const mask = ~(Math.pow(2, 32 - prefixLength) - 1);
		const ipInt = ipToInt(ip);
		const rangeInt = ipToInt(rangeIp);
		
		return (ipInt & mask) === (rangeInt & mask);
	} catch (error) {
		console.warn(`CIDR check failed for ${ip} in ${cidr}:`, error);
		return false;
	}
}
