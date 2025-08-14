import { ethers } from 'ethers';

const ORACLE_ADDRESS_BY_CHAIN = {
  1: '0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
  137: '0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
  56: '0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
  43114: '0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
  10: '0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
  42161: '0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
  250: '0x40c57923924b5c5c5455c48d93317139addac8fb',
  42220: '0x40C57923924B5c5c5455c48D93317139ADDaC8fb',
  8453: '0x3A91A31cB3dC49b4db9Ce721F50a9D076c8D739B',
};

const SANCTIONS_ABI = [
  'function isSanctioned(address addr) view returns (bool)'
];

export function getOracleAddress(chainId) {
  return ORACLE_ADDRESS_BY_CHAIN[Number(chainId)] || null;
}

export async function isAddressSanctioned(chainId, address, provider) {
  try {
    const oracleAddress = getOracleAddress(chainId);
    if (!oracleAddress) return false;
    let usedProvider = provider;
    if (!usedProvider) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const { JsonRpcProvider } = ethers;
      usedProvider = new JsonRpcProvider(`${origin}/api/rpc?chainId=${chainId}&provider=auto`);
    }
    const contract = new ethers.Contract(oracleAddress, SANCTIONS_ABI, usedProvider);
    return await contract.isSanctioned(address);
  } catch (_e) {
    return false;
  }
}

export async function assertNotSanctioned(chainId, address, provider) {
  const sanctioned = await isAddressSanctioned(chainId, address, provider);
  if (sanctioned) {
    throw new Error('Operation blocked: address appears on sanctions list');
  }
}


