import { useState, useEffect, useCallback } from 'react';
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

  const contactsManager = new ContactsManager(walletAddress || undefined, railgunWalletID || undefined);

  // Load contacts on mount
  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedContacts = await contactsManager.getContacts();
      setContacts(loadedContacts);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load contacts';
      setError(errorMessage);
      console.error('Failed to load contacts:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

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
  }, []);

  const findContactByAddress = useCallback(async (searchTerm: string): Promise<Contact | null> => {
    return await contactsManager.findContact(searchTerm);
  }, []);

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
