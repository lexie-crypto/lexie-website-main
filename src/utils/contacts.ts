/**
 * Contacts Utility
 * Core business logic for managing contacts with localStorage adapter
 */

export interface Contact {
  id: string;        // alias, e.g. "lexielaine"
  type: 'eoa' | 'lexieId';
  address?: `0x${string}`; // EOA wallet address
  lexieId?: string;  // Lexie ID without @ prefix
  createdAt: number;
  updatedAt: number;
}

export interface ContactValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedContact?: Partial<Contact>;
}

/**
 * Storage adapter interface - allows swapping localStorage for Redis later
 */
export interface ContactStorageAdapter {
  getContacts(): Promise<Contact[]>;
  saveContacts(contacts: Contact[]): Promise<void>;
}

/**
 * Redis implementation of contact storage using backend API
 */
export class RedisContactAdapter implements ContactStorageAdapter {
  private walletAddress?: string;
  private walletId?: string;

  constructor(walletAddress?: string, walletId?: string) {
    this.walletAddress = walletAddress;
    this.walletId = walletId;
  }

  private async apiCall(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: any): Promise<any> {
    // Build URL with action parameter: /api/wallet-metadata?action=contacts&walletAddress=...&walletId=...
    const params = new URLSearchParams({
      action: 'contacts',
      ...(this.walletAddress && { walletAddress: this.walletAddress }),
      ...(this.walletId && { walletId: this.walletId }),
      ...(endpoint && { subaction: endpoint }),
    });

    const url = `/api/wallet-metadata?${params.toString()}`;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const config: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `API call failed: ${response.status}`);
    }

    return await response.json();
  }

  async getContacts(): Promise<Contact[]> {
    try {
      const response = await this.apiCall('');
      return response.success ? response.contacts || [] : [];
    } catch (error) {
      console.error('Failed to load contacts from Redis:', error);
      return [];
    }
  }

  async saveContacts(contacts: Contact[]): Promise<void> {
    try {
      await this.apiCall('', 'PUT', { contacts });
    } catch (error) {
      console.error('Failed to save contacts to Redis:', error);
      throw error;
    }
  }
}

/**
 * Sanitize address input - removes whitespace, zero-width chars, etc.
 */
export function sanitizeAddress(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\u00A0\uFEFF]/g, '') // ZW* + NBSP + BOM
    .replace(/\s+/g, '')                                // kill all spaces
    .trim();
}

/**
 * Sanitize contact ID - converts spaces to underscores, removes other whitespace
 */
export function sanitizeContactId(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\u00A0\uFEFF]/g, '') // ZW* + NBSP + BOM
    .replace(/\s+/g, '_')                               // convert spaces to underscores
    .replace(/_{2,}/g, '_')                             // collapse multiple underscores
    .replace(/^_+|_+$/g, '')                            // remove leading/trailing underscores
    .toLowerCase();
}

/**
 * Validate Ethereum address format
 */
export function isValidEOA(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate Lexie ID format
 */
export function isValidLexieId(lexieId: string): boolean {
  if (!lexieId || typeof lexieId !== 'string') return false;

  // Remove @ prefix if present
  const cleanId = lexieId.startsWith('@') ? lexieId.substring(1) : lexieId;

  // Must be 3-20 chars, letters/numbers/underscores only
  return /^[a-zA-Z0-9_]{3,20}$/.test(cleanId);
}

/**
 * Sanitize and validate contact input
 */
export function validateAndSanitizeContact(input: {
  id: string;
  type: 'eoa' | 'lexieId';
  address?: string;
  lexieId?: string;
}): ContactValidationResult {
  const errors: string[] = [];
  const sanitized: Partial<Contact> = {
    id: sanitizeContactId(input.id),
    type: input.type,
  };

  // Validate alias/ID
  if (!input.id.trim()) {
    errors.push('Contact name is required');
  } else if (!sanitized.id || sanitized.id.length < 2 || sanitized.id.length > 20) {
    errors.push('Contact name must be 2-20 characters');
  } else if (!/^[a-zA-Z0-9_]+$/.test(sanitized.id!)) {
    errors.push('Contact name can only contain letters, numbers, and underscores');
  }

  // Validate based on type
  if (input.type === 'eoa') {
    const address = sanitizeAddress(input.address || '');
    if (!address) {
      errors.push('Wallet address is required');
    } else if (!isValidEOA(address)) {
      errors.push('Invalid Ethereum address format');
    } else {
      sanitized.address = address as `0x${string}`;
    }
  } else if (input.type === 'lexieId') {
    const lexieId = sanitizeAddress(input.lexieId || '');
    if (!lexieId) {
      errors.push('Lexie ID is required');
    } else if (!isValidLexieId(lexieId)) {
      errors.push('Invalid Lexie ID format (3-20 characters, letters/numbers/underscores only)');
    } else {
      // Remove @ prefix if present
      sanitized.lexieId = lexieId.startsWith('@') ? lexieId.substring(1) : lexieId;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitizedContact: errors.length === 0 ? sanitized as Partial<Contact> : undefined,
  };
}

/**
 * Default unknown input type detection
 */
export function detectContactType(input: string): 'eoa' | 'lexieId' {
  const sanitized = sanitizeAddress(input);

  // Check if it's a valid EOA address
  if (isValidEOA(sanitized)) {
    return 'eoa';
  }

  // Default to lexieId for everything else
  return 'lexieId';
}

/**
 * Resolve contact by alias or address
 */
export function resolveContact(contacts: Contact[], searchTerm: string): Contact | null {
  if (!searchTerm || !Array.isArray(contacts)) return null;

  const sanitizedSearch = sanitizeAddress(searchTerm).toLowerCase();

  // Try exact match by ID first
  const byId = contacts.find(c => c.id.toLowerCase() === sanitizedSearch);
  if (byId) return byId;

  // Try by address for EOA contacts
  if (sanitizedSearch.startsWith('0x')) {
    const byAddress = contacts.find(c =>
      c.type === 'eoa' &&
      c.address?.toLowerCase() === sanitizedSearch
    );
    if (byAddress) return byAddress;
  }

  // Try by lexieId
  const byLexieId = contacts.find(c =>
    c.type === 'lexieId' &&
    c.lexieId?.toLowerCase() === sanitizedSearch
  );
  if (byLexieId) return byLexieId;

  // Try partial matches for autocomplete
  const partialMatches = contacts.filter(c =>
    c.id.toLowerCase().includes(sanitizedSearch) ||
    (c.type === 'eoa' && c.address?.toLowerCase().includes(sanitizedSearch)) ||
    (c.type === 'lexieId' && c.lexieId?.toLowerCase().includes(sanitizedSearch))
  );

  return partialMatches.length === 1 ? partialMatches[0] : null;
}

/**
 * Search contacts for autocomplete
 */
export function searchContacts(contacts: Contact[], query: string, limit: number = 5): Contact[] {
  if (!query || !Array.isArray(contacts)) return [];

  const sanitizedQuery = sanitizeAddress(query).toLowerCase();

  return contacts
    .filter(contact => {
      const idMatch = contact.id.toLowerCase().includes(sanitizedQuery);
      const addressMatch = contact.type === 'eoa' && contact.address?.toLowerCase().includes(sanitizedQuery);
      const lexieIdMatch = contact.type === 'lexieId' && contact.lexieId?.toLowerCase().includes(sanitizedQuery);

      return idMatch || addressMatch || lexieIdMatch;
    })
    .slice(0, limit);
}

/**
 * Core contacts manager with CRUD operations
 */
export class ContactsManager {
  private adapter: ContactStorageAdapter;

  constructor(adapterOrWalletAddress?: ContactStorageAdapter | string, walletId?: string) {
    if (typeof adapterOrWalletAddress === 'object' && adapterOrWalletAddress !== null) {
      // It's a ContactStorageAdapter instance
      this.adapter = adapterOrWalletAddress;
    } else {
      // Create Redis adapter with wallet context
      this.adapter = new RedisContactAdapter(adapterOrWalletAddress, walletId);
    }
  }

  async getContacts(): Promise<Contact[]> {
    return await this.adapter.getContacts();
  }

  async addContact(contactData: Omit<Contact, 'createdAt' | 'updatedAt'>): Promise<Contact> {
    const validation = validateAndSanitizeContact(contactData);

    if (!validation.isValid) {
      throw new Error(`Invalid contact: ${validation.errors.join(', ')}`);
    }

    const contacts = await this.getContacts();

    // Check for duplicate ID
    if (contacts.some(c => c.id.toLowerCase() === validation.sanitizedContact!.id!.toLowerCase())) {
      throw new Error(`Contact with name "${validation.sanitizedContact!.id}" already exists`);
    }

    const now = Date.now();
    const newContact: Contact = {
      ...validation.sanitizedContact,
      createdAt: now,
      updatedAt: now,
    } as Contact;

    contacts.push(newContact);
    await this.adapter.saveContacts(contacts);

    return newContact;
  }

  async updateContact(contactId: string, updates: Partial<Omit<Contact, 'createdAt'>>): Promise<Contact> {
    const contacts = await this.getContacts();
    const contactIndex = contacts.findIndex(c => c.id.toLowerCase() === contactId.toLowerCase());

    if (contactIndex === -1) {
      throw new Error(`Contact "${contactId}" not found`);
    }

    // Validate updates
    const updatedData = { ...contacts[contactIndex], ...updates };
    const validation = validateAndSanitizeContact(updatedData);

    if (!validation.isValid) {
      throw new Error(`Invalid updates: ${validation.errors.join(', ')}`);
    }

    // Check for duplicate ID if name changed
    if (updates.id !== undefined && updates.id.toLowerCase() !== contactId.toLowerCase()) {
      if (contacts.some(c => c.id.toLowerCase() === updates.id!.toLowerCase())) {
        throw new Error(`Contact with name "${updates.id}" already exists`);
      }
    }

    const sanitized = validation.sanitizedContact!;
    const updatedContact: Contact = {
      id: updates.id !== undefined ? updates.id : contacts[contactIndex].id,
      type: sanitized.type!,
      address: sanitized.address,
      lexieId: sanitized.lexieId,
      createdAt: contacts[contactIndex].createdAt,
      updatedAt: Date.now(),
    };

    contacts[contactIndex] = updatedContact;
    await this.adapter.saveContacts(contacts);

    return updatedContact;
  }

  async removeContact(contactId: string): Promise<void> {
    const contacts = await this.getContacts();
    const filteredContacts = contacts.filter(c => c.id.toLowerCase() !== contactId.toLowerCase());

    if (filteredContacts.length === contacts.length) {
      throw new Error(`Contact "${contactId}" not found`);
    }

    await this.adapter.saveContacts(filteredContacts);
  }

  async clearAllContacts(): Promise<void> {
    await this.adapter.saveContacts([]);
  }

  async findContact(searchTerm: string): Promise<Contact | null> {
    const contacts = await this.getContacts();
    return resolveContact(contacts, searchTerm);
  }

  async searchContacts(query: string, limit?: number): Promise<Contact[]> {
    const contacts = await this.getContacts();
    return searchContacts(contacts, query, limit);
  }
}

// Note: No default instance - wallet context required for Redis storage
