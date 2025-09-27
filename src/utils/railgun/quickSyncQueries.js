/**
 * RAILGUN QuickSync State Queries
 * Optimized queries for near-instant wallet sync using merkletree state
 */

// GraphQL queries for merkletree state
export const MERKLETREE_STATE_QUERIES = {
  // Query for latest merkletree metadata
  LatestMerkletreeState: `
    query LatestMerkletreeState {
      merkletrees(orderBy: [treeNumber_DESC], limit: 1) {
        treeNumber
        root
        height
        latestCommitmentIndex
        blockNumber
      }
    }
  `,

  // Query for merkletree leaves in a specific range
  MerkletreeLeaves: `
    query MerkletreeLeaves($treeNumber: Int!, $startIndex: Int!, $limit: Int!) {
      merkletreeLeaves(
        where: { treeNumber_eq: $treeNumber, index_gte: $startIndex }
        orderBy: [index_ASC]
        limit: $limit
      ) {
        index
        hash
      }
    }
  `,

  // Query for latest commitments since a specific index
  LatestCommitments: `
    query LatestCommitments($startIndex: Int!, $limit: Int!) {
      commitments(
        where: { treePosition_gte: $startIndex }
        orderBy: [treePosition_ASC]
        limit: $limit
      ) {
        id
        treeNumber
        treePosition
        blockNumber
        transactionHash
        hash
        commitmentType
      }
    }
  `,

  // Query for latest nullifiers since a specific index
  LatestNullifiers: `
    query LatestNullifiers($startIndex: Int!, $limit: Int!) {
      nullifiers(
        where: { treePosition_gte: $startIndex }
        orderBy: [treePosition_ASC]
        limit: $limit
      ) {
        id
        treePosition
        nullifier
        transactionHash
        blockNumber
      }
    }
  `
};

// Utility function to check if GraphQL endpoint supports state queries
export const supportsStateQueries = async (graphClient) => {
  try {
    // Try to execute a simple state query to check support
    const testQuery = `
      query TestStateSupport {
        merkletrees(limit: 1) {
          treeNumber
        }
      }
    `;

    await graphClient.request(testQuery);
    return true;
  } catch (error) {
    console.log('[QuickSync] State queries not supported by GraphQL endpoint:', error.message);
    return false;
  }
};
