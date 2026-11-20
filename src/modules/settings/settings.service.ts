import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_SETTINGS,
  type HelloFitSettings,
  type SettingsKey,
} from './settings.defaults';

/**
 * Reads the admin-configurable policy values, falling back to the spec
 * defaults. Cached in memory because slot search and pricing read these on
 * every request; `invalidate()` is called whenever an admin saves a setting.
 *
 * **An `app_settings` row beats `settings.defaults.ts`, and the cache is only
 * filled at module init.** So editing a default has no effect while a row
 * overrides that group, and editing the row by hand has no effect until the
 * process restarts — there is no reload route. Change both, then restart.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache: HelloFitSettings = DEFAULT_SETTINGS;
  private loadedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** One policy group, e.g. settings.get('refundSlabs'). */
  get<K extends SettingsKey>(key: K): HelloFitSettings[K] {
    return this.cache[key];
  }

  all(): HelloFitSettings {
    return this.cache;
  }

  async reload(): Promise<void> {
    try {
      const rows = await this.prisma.appSetting.findMany();
      const merged: HelloFitSettings = structuredClone(DEFAULT_SETTINGS);

      for (const row of rows) {
        if (!(row.key in merged)) continue;

        // Shallow-merge so a partial override keeps the remaining defaults.
        // The cast is needed because TypeScript widens the indexed write to
        // the intersection of every policy group.
        const key = row.key as SettingsKey;
        (merged as Record<SettingsKey, object>)[key] = {
          ...merged[key],
          ...(row.value as object),
        };
      }

      this.cache = merged;
      this.loadedAt = Date.now();
      this.logger.log(`Settings loaded (${rows.length} overrides)`);
    } catch (error) {
      // Never let a settings read failure take the API down; the spec
      // defaults are a safe operating position.
      this.logger.error(
        'Failed to load settings, using defaults',
        error instanceof Error ? error.stack : String(error),
      );
      this.cache = DEFAULT_SETTINGS;
    }
  }

  /** Persists an override and refreshes the cache. */
  async upsert(
    key: SettingsKey,
    value: object,
    description?: string,
  ): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value, description, group: 'policy' },
      update: { value, description },
    });
    await this.reload();
  }

  get lastLoadedAt(): number {
    return this.loadedAt;
  }
}
