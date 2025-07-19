/**
 * RAILGUN Artifact Utilities
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/artifacts/artifact-util.ts
 */

import { ArtifactName } from '@railgun-community/shared-models';

// IPFS Configuration
const IPFS_GATEWAY = 'https://ipfs-lb.com';
const MASTER_IPFS_HASH_ARTIFACTS = 'QmUsmnK4PFc7zDp2cmC4wBZxYLjNyRgWfs5GNcJJ2uLcpU';
const IPFS_HASH_ARTIFACTS_POI = 'QmZrP9zaZw2LwErT2yA6VpMWm65UdToQiKj4DtStVsUJHr';
export const ARTIFACT_VARIANT_STRING_POI_PREFIX = 'POI';

export const artifactDownloadsDir = (artifactVariantString) => {
  if (artifactVariantString.startsWith(ARTIFACT_VARIANT_STRING_POI_PREFIX)) {
    return `artifacts-v2.1/poi-nov-2-23/${artifactVariantString}`;
  }
  return `artifacts-v2.1/${artifactVariantString}`;
};

export const getArtifactVariantString = (nullifiers, commitments) => {
  return `${nullifiers.toString().padStart(2, '0')}x${commitments.toString().padStart(2, '0')}`;
};

export const getArtifactVariantStringPOI = (maxInputs, maxOutputs) => {
  return `${ARTIFACT_VARIANT_STRING_POI_PREFIX}_${maxInputs}x${maxOutputs}`;
};

export const artifactDownloadsPath = (artifactName, artifactVariantString) => {
  switch (artifactName) {
    case ArtifactName.WASM:
      return `${artifactDownloadsDir(artifactVariantString)}/wasm`;
    case ArtifactName.ZKEY:
      return `${artifactDownloadsDir(artifactVariantString)}/zkey`;
    case ArtifactName.VKEY:
      return `${artifactDownloadsDir(artifactVariantString)}/vkey.json`;
    case ArtifactName.DAT:
      return `${artifactDownloadsDir(artifactVariantString)}/dat`;
    default:
      throw new Error(`Invalid artifact name: ${artifactName}`);
  }
};

export const getArtifactDownloadsPaths = (artifactVariantString) => {
  return {
    [ArtifactName.ZKEY]: artifactDownloadsPath(ArtifactName.ZKEY, artifactVariantString),
    [ArtifactName.WASM]: artifactDownloadsPath(ArtifactName.WASM, artifactVariantString),
    [ArtifactName.VKEY]: artifactDownloadsPath(ArtifactName.VKEY, artifactVariantString),
    [ArtifactName.DAT]: artifactDownloadsPath(ArtifactName.DAT, artifactVariantString),
  };
};

// Brotli decompression - simplified for browser compatibility
export const decompressArtifact = (arrayBuffer) => {
  // For now, return as Uint8Array - you may need to add brotli decompression
  // Install: npm install brotli-decompress
  console.warn('[ArtifactUtil] Brotli decompression not implemented - returning raw data');
  return new Uint8Array(arrayBuffer);
};

const getArtifactIPFSFilepath = (artifactName, artifactVariantString) => {
  switch (artifactName) {
    case ArtifactName.ZKEY:
      return `circuits/${artifactVariantString}/zkey.br`;
    case ArtifactName.WASM:
      return `prover/snarkjs/${artifactVariantString}.wasm.br`;
    case ArtifactName.VKEY:
      return `circuits/${artifactVariantString}/vkey.json`;
    case ArtifactName.DAT:
      return `prover/native/${artifactVariantString}.dat.br`;
    default:
      throw new Error('Invalid artifact.');
  }
};

const getArtifactIPFSFilepathPOI = (artifactName) => {
  switch (artifactName) {
    case ArtifactName.ZKEY:
      return `zkey.br`;
    case ArtifactName.WASM:
      return `wasm.br`;
    case ArtifactName.VKEY:
      return `vkey.json`;
    case ArtifactName.DAT:
      return `dat.br`;
    default:
      throw new Error('Invalid artifact.');
  }
};

export const getArtifactUrl = (artifactName, artifactVariantString) => {
  if (artifactVariantString.startsWith(ARTIFACT_VARIANT_STRING_POI_PREFIX)) {
    if (
      artifactVariantString === getArtifactVariantStringPOI(3, 3) ||
      artifactVariantString === getArtifactVariantStringPOI(13, 13)
    ) {
      return `${IPFS_GATEWAY}/ipfs/${IPFS_HASH_ARTIFACTS_POI}/${artifactVariantString}/${getArtifactIPFSFilepathPOI(
        artifactName,
      )}`;
    }
    throw new Error(`Invalid POI artifact: ${artifactVariantString}.`);
  }

  const artifactFilepath = getArtifactIPFSFilepath(artifactName, artifactVariantString);
  return `${IPFS_GATEWAY}/ipfs/${MASTER_IPFS_HASH_ARTIFACTS}/${artifactFilepath}`;
}; 