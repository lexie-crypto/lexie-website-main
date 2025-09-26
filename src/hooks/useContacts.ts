import { useState, useEffect, useCallback, useMemo } from 'react';
import { Contact, ContactsManager, searchContacts as searchContactsUtil } from '../utils/contacts';
import { useWallet } from '../contexts/WalletContext';

/**
 * React hook for managing contacts state and operations
 */
export function useContacts() {
  const [contacts, setContacts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const { address: walletAddress, railgunWalletID } = useWallet();

  // Create contacts manager with current wallet context
  const contactsManager = useMemo(() => {
    return new ContactsManager(walletAddress || undefined, railgunWalletID || undefined);
  }, [walletAddress, railgunWalletID]);

  const loadContacts = useCallback(async () => {
    console.log('🔄 [useContacts] loadContacts called');
    setIsLoading(true);
    setError(null);

    try {
      console.log('📡 [useContacts] Calling contactsManager.getContacts()');
      const loadedContacts = await contactsManager.getContacts();
      console.log('✅ [useContacts] Loaded contacts:', loadedContacts.length, 'contacts');
      setContacts(loadedContacts);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load contacts';
      setError(errorMessage);
      console.error('❌ [useContacts] Failed to load contacts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [contactsManager]);

  // Load contacts when wallet context is available
  useEffect(() => {
    console.log('🔄 [useContacts] Wallet context check:', { walletAddress, railgunWalletID });
    if (walletAddress && railgunWalletID) {
      console.log('📞 [useContacts] Loading contacts for wallet:', walletAddress.slice(0, 8) + '...');
      loadContacts();
    } else {
      console.log('⏳ [useContacts] Waiting for wallet context...');
    }
  }, [walletAddress, railgunWalletID, loadContacts]);

  const addContact = useCallback(async (contactData: Omit<Contact, 'createdAt' | 'updatedAt'>) => {
    setError(null);

    try {
      const newContact = await contactsManager.addContact(contactData);
      setContacts(prev => [...prev, newContact]);
      return newContact;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add contact';
      setError(errorMessage);
      throw err;
    }
  }, [contactsManager]);

  const updateContact = useCallback(async (contactId: string, updates: Partial<Omit<Contact, 'id' | 'createdAt'>>) => {
    setError(null);

    try {
      const updatedContact = await contactsManager.updateContact(contactId, updates);
      setContacts(prev => prev.map(c =>
        c.id.toLowerCase() === contactId.toLowerCase() ? updatedContact : c
      ));
      return updatedContact;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update contact';
      setError(errorMessage);
      throw err;
    }
  }, [contactsManager]);

  const removeContact = useCallback(async (contactId: string) => {
    setError(null);

    try {
      await contactsManager.removeContact(contactId);
      setContacts(prev => prev.filter(c => c.id.toLowerCase() !== contactId.toLowerCase()));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove contact';
      setError(errorMessage);
      throw err;
    }
  }, [contactsManager]);

  const clearContacts = useCallback(async () => {
    setError(null);

    try {
      await contactsManager.clearAllContacts();
      setContacts([]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to clear contacts';
      setError(errorMessage);
      throw err;
    }
  }, [contactsManager]);

  const findContactByAddress = useCallback(async (searchTerm: string): Promise<Contact | null> => {
    return await contactsManager.findContact(searchTerm);
  }, [contactsManager]);

  const searchContacts = useCallback((query: string, limit?: number): Contact[] => {
    return searchContactsUtil(contacts, query, limit);
  }, [contacts]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    contacts,
    isLoading,
    error,
    loadContacts,
    addContact,
    updateContact,
    removeContact,
    clearContacts,
    findContactByAddress,
    searchContacts,
    clearError,
  };
}
