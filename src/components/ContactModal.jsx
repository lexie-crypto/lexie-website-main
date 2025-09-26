import React, { useState } from 'react';

/**
 * Contact Modal Component for adding/editing contacts
 */
const ContactModal = ({ contact, onSave, onCancel, prefillAddress }) => {
  const [formData, setFormData] = useState({
    id: contact?.id || '',
    type: contact?.type || 'eoa',
    address: contact?.address || contact?.lexieId || prefillAddress || '',
  });
  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};

    // Validate contact name (spaces allowed, will be converted to underscores)
    if (!formData.id.trim()) {
      newErrors.id = 'Contact name is required';
    } else if (formData.id.length < 2 || formData.id.length > 20) {
      newErrors.id = 'Contact name must be 2-20 characters';
    } else {
      // Check if the sanitized version would be valid
      const sanitized = formData.id
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\u2060\u00A0\uFEFF]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();

      if (!sanitized || sanitized.length < 2 || sanitized.length > 20) {
        newErrors.id = 'Contact name must be 2-20 characters after sanitization';
      } else if (!/^[a-zA-Z0-9_]+$/.test(sanitized)) {
        newErrors.id = 'Contact name contains invalid characters';
      }
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Address is required';
    } else if (formData.type === 'eoa' && !/^0x[a-fA-F0-9]{40}$/.test(formData.address)) {
      newErrors.address = 'Invalid Ethereum address format';
    } else if (formData.type === 'lexieId' && !/^[a-zA-Z0-9_]{3,20}$/.test(formData.address)) {
      newErrors.address = 'Invalid Lexie ID format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateForm()) {
      // Construct proper payload based on contact type
      const base = { id: formData.id.trim(), type: formData.type };
      const payload =
        formData.type === 'eoa'
          ? { ...base, address: formData.address.trim() }            // 0x...
          : { ...base, lexieId: formData.address.replace(/^@/, '') } // store in lexieId (remove @ prefix)
      onSave(payload);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-black border border-green-500/30 rounded-lg shadow-2xl max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-green-300">
              {contact ? 'Edit Contact' : 'Add New Contact'}
            </h3>
            <button
              onClick={onCancel}
              className="text-green-400 hover:text-green-300 text-xl"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-green-300 mb-2">
                Contact Name
              </label>
              <input
                type="text"
                value={formData.id}
                onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
                placeholder="e.g., vitalik, my_wallet, Hello Kitty"
                className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
              />
              {errors.id && <p className="text-red-400 text-xs mt-1">{errors.id}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-green-300 mb-2">
                Address Type
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="eoa"
                    checked={formData.type === 'eoa'}
                    onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                    className="mr-2"
                  />
                  <span className="text-sm text-green-200">Wallet Address</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="lexieId"
                    checked={formData.type === 'lexieId'}
                    onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                    className="mr-2"
                  />
                  <span className="text-sm text-green-200">Lexie ID</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-green-300 mb-2">
                {formData.type === 'eoa' ? 'Wallet Address' : 'Lexie ID'}
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                placeholder={formData.type === 'eoa' ? '0x...' : '@lexie or just lexie'}
                className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
              />
              {errors.address && <p className="text-red-400 text-xs mt-1">{errors.address}</p>}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 bg-gray-600/30 hover:bg-gray-600/50 text-gray-200 py-2 px-4 rounded border border-gray-500/40"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 py-2 px-4 rounded border border-emerald-400/40"
              >
                {contact ? 'Update' : 'Add'} Contact
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ContactModal;
