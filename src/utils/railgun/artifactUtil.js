/**
 * RAILGUN Artifact Utilities
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/artifacts/artifact-util.ts
 */

import { ArtifactName } from '@railgun-community/shared-models';
import brotliDecompress from 'brotli/decompress';

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

// Decompress artifact - matches Railgun SDK implementation
export const decompressArtifact = (arrayBuffer) => {
  try {
    const decompress = brotliDecompress;
    return decompress(Buffer.from(arrayBuffer));
  } catch (error) {
    console.warn('[ArtifactUtil] Brotli decompression failed, trying gzip fallback:', error.message);

    // Fallback to gzip - matches Railgun SDK pattern
    try {
      const { ungzip } = require('pako');
      return ungzip(new Uint8Array(arrayBuffer));
    } catch (gzipError) {
      console.error('[ArtifactUtil] Both Brotli and gzip decompression failed:', gzipError.message);
      throw new Error('Failed to decompress artifact');
    }
  }
};

// Validate quicksync artifact header (QKSY magic + version)
export const validateQuicksyncHeader = (data) => {
  if (!(data instanceof Uint8Array)) {
    throw new Error('Quicksync data must be Uint8Array');
  }

  if (data.length < 8) {
    throw new Error('Quicksync data too short for header validation');
  }

  // Check QKSY magic bytes (0x51 0x4B 0x53 0x59)
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== 'QKSY') {
    throw new Error(`Invalid quicksync magic: expected QKSY, got ${magic}`);
  }

  // Read version (uint32, big-endian)
  const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];

  console.log(`[ArtifactUtil] Validated quicksync header: magic=${magic}, version=${version}`);

  return { magic, version };
};

// Enhanced decompress function with quicksync validation
export const decompressQuicksyncArtifact = async (arrayBuffer, validateHeader = true) => {
  const decompressed = await decompressArtifact(arrayBuffer);

  if (validateHeader) {
    try {
      validateQuicksyncHeader(decompressed);
    } catch (error) {
      console.error('[ArtifactUtil] Quicksync header validation failed:', error.message);
      throw error;
    }
  }

  return decompressed;
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