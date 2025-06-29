import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { QualityInfo, QualityMetrics } from './interfaces/quality-info.interface';

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  /**
   * Extract quality parameters from Jellyfin HLS URL
   */
  extractQualityFromUrl(url: string): QualityInfo {
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;

      const qualityInfo: QualityInfo = {
        // Video quality parameters (try both PascalCase and camelCase)
        maxVideoBitrate: params.get('maxVideoBitrate') || params.get('MaxVideoBitrate') || undefined,
        videoCodec: params.get('videoCodec') || params.get('VideoCodec') || undefined,
        maxWidth: params.get('maxWidth') || params.get('MaxWidth') || undefined,
        maxHeight: params.get('maxHeight') || params.get('MaxHeight') || undefined,
        videoLevel: params.get('videoLevel') || params.get('VideoLevel') || undefined,
        profile: params.get('profile') || params.get('Profile') || undefined,
        maxFramerate: params.get('maxFramerate') || params.get('MaxFramerate') || undefined,
        videoBitDepth: params.get('videoBitDepth') || params.get('VideoBitDepth') || undefined,

        // Audio quality parameters
        audioCodec: params.get('audioCodec') || params.get('AudioCodec') || undefined,
        audioChannels: params.get('audioChannels') || params.get('AudioChannels') || undefined,
        audioBitrate: params.get('audioBitrate') || params.get('AudioBitrate') || undefined,
        audioSampleRate: params.get('audioSampleRate') || params.get('AudioSampleRate') || undefined,

        // Container parameters (from URL we see 'container=ts')
        container: params.get('container') || params.get('Container') || undefined,
        segmentContainer: params.get('segmentContainer') || params.get('SegmentContainer') || undefined,

        // Subtitle parameters
        subtitleCodec: params.get('subtitleCodec') || params.get('SubtitleCodec') || undefined,

        // Audio/Subtitle stream selection parameters (CRITICAL for proper caching)
        // NOTE: Jellyfin uses camelCase, not PascalCase!
        audioStreamIndex: params.get('audioStreamIndex') || undefined,
        subtitleStreamIndex: params.get('subtitleStreamIndex') || undefined,
        audioLanguage: params.get('audioLanguage') || undefined,
        subtitleLanguage: params.get('subtitleLanguage') || undefined,
        maxAudioChannels: params.get('maxAudioChannels') || undefined,
        transcodingMaxAudioChannels: params.get('transcodingMaxAudioChannels') || undefined,
        subtitleMethod: params.get('subtitleMethod') || undefined,
        startTimeTicks: params.get('startTimeTicks') || undefined,

        // Session-specific (will be excluded from hash)
        mediaSourceId: params.get('MediaSourceId') || undefined,
        deviceId: params.get('DeviceId') || undefined,
        playSessionId: params.get('PlaySessionId') || undefined,
      };

      // Remove undefined values to keep hash consistent
      Object.keys(qualityInfo).forEach(key => {
        if (qualityInfo[key] === undefined) {
          delete qualityInfo[key];
        }
      });

      this.logger.debug(`Extracted quality info: ${JSON.stringify(qualityInfo)}`);
      return qualityInfo;
    } catch (error) {
      this.logger.error(`Error extracting quality from URL: ${error.message}`);
      return {};
    }
  }

  /**
   * Generate a hash from quality parameters
   */
  generateQualityHash(qualityInfo: QualityInfo): string {
    // Sort keys to ensure consistent hashing
    const sortedKeys = Object.keys(qualityInfo).sort();
    const sortedQuality = {};
    
    sortedKeys.forEach(key => {
      // Skip session-specific parameters that don't affect quality
      // BUT INCLUDE audio/subtitle stream selection parameters for proper caching
      if (!['deviceId', 'playSessionId', 'mediaSourceId'].includes(key)) {
        sortedQuality[key] = qualityInfo[key];
      }
    });

    const qualityString = JSON.stringify(sortedQuality);

    const hash = createHash('md5')
      .update(qualityString)
      .digest('hex')
      .substring(0, 12); // 12 character hash for readability

    this.logger.debug(`Generated quality hash: ${hash} for ${qualityString}`);
    return hash;
  }

  /**
   * Get a human-readable quality description
   */
  getQualityDescription(qualityInfo: QualityInfo): string {
    const parts: string[] = [];

    // Resolution
    if (qualityInfo.maxWidth && qualityInfo.maxHeight) {
      parts.push(`${qualityInfo.maxWidth}x${qualityInfo.maxHeight}`);
    }

    // Video bitrate
    if (qualityInfo.maxVideoBitrate) {
      const bitrateMbps = Math.round(parseInt(qualityInfo.maxVideoBitrate) / 1000000);
      parts.push(`${bitrateMbps}Mbps`);
    }

    // Video codec
    if (qualityInfo.videoCodec) {
      parts.push(qualityInfo.videoCodec.toUpperCase());
    }

    // Audio codec and language
    if (qualityInfo.audioCodec) {
      let audioPart = qualityInfo.audioCodec.toUpperCase();
      if (qualityInfo.audioLanguage) {
        audioPart += ` (${qualityInfo.audioLanguage})`;
      }
      if (qualityInfo.audioStreamIndex) {
        audioPart += ` [Track ${qualityInfo.audioStreamIndex}]`;
      }
      parts.push(audioPart);
    }

    // Subtitle info
    if (qualityInfo.subtitleStreamIndex || qualityInfo.subtitleLanguage) {
      let subPart = 'Subs';
      if (qualityInfo.subtitleLanguage) {
        subPart += ` (${qualityInfo.subtitleLanguage})`;
      }
      if (qualityInfo.subtitleStreamIndex) {
        subPart += ` [Track ${qualityInfo.subtitleStreamIndex}]`;
      }
      parts.push(subPart);
    }

    return parts.length > 0 ? parts.join(' ') : 'Unknown Quality';
  }

  /**
   * Compare two quality infos to see if they're the same
   */
  areQualitiesEqual(quality1: QualityInfo, quality2: QualityInfo): boolean {
    return this.generateQualityHash(quality1) === this.generateQualityHash(quality2);
  }

  /**
   * Get quality score for sorting (higher = better quality)
   */
  getQualityScore(qualityInfo: QualityInfo): number {
    let score = 0;

    // Video bitrate contributes most to score
    if (qualityInfo.maxVideoBitrate) {
      score += parseInt(qualityInfo.maxVideoBitrate) / 1000; // Convert to kbps
    }

    // Resolution contributes to score
    if (qualityInfo.maxWidth && qualityInfo.maxHeight) {
      const pixels = parseInt(qualityInfo.maxWidth) * parseInt(qualityInfo.maxHeight);
      score += pixels / 1000; // Normalize pixel count
    }

    // Audio bitrate contributes less
    if (qualityInfo.audioBitrate) {
      score += parseInt(qualityInfo.audioBitrate) / 10;
    }

    return score;
  }

  /**
   * Get quality metrics for analysis
   */
  getQualityMetrics(qualityInfo: QualityInfo): QualityMetrics {
    const score = this.getQualityScore(qualityInfo);
    const description = this.getQualityDescription(qualityInfo);
    
    // Rough estimation of file size based on bitrate
    let estimatedSize = 0;
    if (qualityInfo.maxVideoBitrate) {
      // Assume 2 hour movie for estimation
      const bitrateKbps = parseInt(qualityInfo.maxVideoBitrate) / 1000;
      estimatedSize = bitrateKbps * 7200 * 1000 / 8; // 2 hours in bytes
    }

    return {
      score,
      description,
      estimatedSize,
    };
  }
}
