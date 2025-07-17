const rpcUrlMap: Record<number, string> = {
  1: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  137: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  56: `https://bsc-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`, // BSC endpoint
  42161: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { chainId, method, params } = req.body;

  if (!chainId || !method) {
    return res.status(400).json({ error: 'Missing chainId or method' });
  }

  const rpcUrl = rpcUrlMap[chainId];
  if (!rpcUrl) {
    return res.status(400).json({ error: `Unsupported chainId: ${chainId}` });
  }

  if (!process.env.ALCHEMY_API_KEY) {
    return res.status(500).json({ error: 'ALCHEMY_API_KEY not configured' });
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params: params || [],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error });
    }

    return res.status(200).json({ result: data.result });
  } catch (error) {
    console.error('RPC call error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
} 