/**
 * RAILGUN Artifact Downloader - Official Implementation
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/artifacts/artifact-downloader.ts
 * Converted from TypeScript to JavaScript for integration
 */

import {
  ArtifactName,
  isDefined,
  promiseTimeout,
} from '@railgun-community/shared-models';
import axios from 'axios';
import {
  artifactDownloadsDir,
  artifactDownloadsPath,
  decompressArtifact,
  getArtifactDownloadsPaths,
  getArtifactUrl,
} from './artifactUtil.js';
import { ArtifactStore } from '@railgun-community/wallet';
import { reportAndSanitizeError } from './utils.js';
import { sendMessage } from './logger.js';
import { validateArtifactDownload } from './artifactHash.js';

export class ArtifactDownloader {
  constructor(artifactStore, useNativeArtifacts = false) {
    this.artifactStore = artifactStore;
    this.useNativeArtifacts = useNativeArtifacts;
  }

  downloadArtifacts = async (artifactVariantString) => {
    sendMessage(`Downloading artifacts: ${artifactVariantString}`);

    const [vkeyPath, zkeyPath, wasmOrDatPath] = await promiseTimeout(
      Promise.all([
        this.downloadArtifact(ArtifactName.VKEY, artifactVariantString),
        this.downloadArtifact(ArtifactName.ZKEY, artifactVariantString),
        this.downloadArtifact(
          this.useNativeArtifacts ? ArtifactName.DAT : ArtifactName.WASM,
          artifactVariantString,
        ),
      ]),
      45000,
      new Error(
        `Timed out downloading artifact files for ${artifactVariantString} circuit. Please try again.`,
      ),
    );

    if (!isDefined(vkeyPath)) {
      throw new Error('Could not download vkey artifact.');
    }
    if (!isDefined(zkeyPath)) {
      throw new Error('Could not download zkey artifact.');
    }
    if (!isDefined(wasmOrDatPath)) {
      throw new Error(
        this.useNativeArtifacts
          ? 'Could not download dat artifact.'
          : 'Could not download wasm artifact.',
      );
    }
  };

  downloadArtifact = async (artifactName, artifactVariantString) => {
    const path = artifactDownloadsPath(artifactName, artifactVariantString);
    if (await this.artifactStore.exists(path)) {
      return path;
    }
    try {
      const url = getArtifactUrl(artifactName, artifactVariantString);

      const { data } = await axios.get(url, {
        method: 'GET',
        responseType: ArtifactDownloader.artifactResponseType(artifactName),
        headers: {
          'Accept-Encoding': 'br,gzip,deflate',
        },
      });

      // NodeJS downloads as Buffer.
      // Browser downloads as ArrayBuffer.
      // Both will validate with the same hash.

      let dataFormatted;

      if (data instanceof ArrayBuffer || data instanceof Buffer) {
        dataFormatted = data;
      } else if (typeof data === 'object') {
        dataFormatted = JSON.stringify(data);
      } else if (typeof data === 'string') {
        dataFormatted = JSON.stringify(JSON.parse(data));
      } else {
        throw new Error('Unexpected response data type');
      }

      const decompressedData = await ArtifactDownloader.getArtifactData(
        dataFormatted,
        artifactName,
      );

      const isValid = await validateArtifactDownload(
        decompressedData,
        artifactName,
        artifactVariantString,
      );
      if (isValid) {
        await this.artifactStore.store(
          artifactDownloadsDir(artifactVariantString),
          path,
          decompressedData,
        );
      } else {
        throw new Error(
          `Invalid hash for artifact download: ${artifactName} for ${artifactVariantString}.`,
        );
      }

      return path;
    } catch (err) {
      throw reportAndSanitizeError(this.downloadArtifact.name, err);
    }
  };

  static getArtifactData = async (data, artifactName) => {
    switch (artifactName) {
      case ArtifactName.VKEY:
        return data;
      case ArtifactName.ZKEY:
      case ArtifactName.DAT:
      case ArtifactName.WASM:
        return await decompressArtifact(data);
    }
  };

  static artifactResponseType = (artifactName) => {
    switch (artifactName) {
      case ArtifactName.VKEY:
        return 'text';
      case ArtifactName.ZKEY:
      case ArtifactName.DAT:
      case ArtifactName.WASM:
        return 'arraybuffer';
    }
  };

  getDownloadedArtifact = async (path) => {
    try {
      const storedItem = await this.artifactStore.get(path);
      return storedItem;
    } catch (err) {
      return null;
    }
  };

  getDownloadedArtifacts = async (artifactVariantString) => {
    const artifactDownloadsPaths = getArtifactDownloadsPaths(
      artifactVariantString,
    );

    const [vkeyString, zkeyBuffer, datBuffer, wasmBuffer] = await Promise.all([
      this.getDownloadedArtifact(artifactDownloadsPaths[ArtifactName.VKEY]),
      this.getDownloadedArtifact(artifactDownloadsPaths[ArtifactName.ZKEY]),
      this.useNativeArtifacts
        ? this.getDownloadedArtifact(artifactDownloadsPaths[ArtifactName.DAT])
        : Promise.resolve(undefined),
      !this.useNativeArtifacts
        ? this.getDownloadedArtifact(artifactDownloadsPaths[ArtifactName.WASM])
        : Promise.resolve(undefined),
    ]);
    if (vkeyString == null) {
      throw new Error('Could not retrieve vkey artifact.');
    }
    if (zkeyBuffer == null) {
      throw new Error('Could not retrieve zkey artifact.');
    }
    if (this.useNativeArtifacts && datBuffer == null) {
      throw new Error('Could not retrieve dat artifact.');
    }
    if (!this.useNativeArtifacts && wasmBuffer == null) {
      throw new Error('Could not retrieve wasm artifact.');
    }

    return {
      vkey: JSON.parse(vkeyString),
      zkey: zkeyBuffer,
      wasm: wasmBuffer || undefined,
      dat: datBuffer || undefined,
    };
  };
} 