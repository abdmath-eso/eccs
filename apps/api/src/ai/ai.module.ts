import { Global, Logger, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { AI_ENGINE, type AiEngine } from './ai-engine.js';
import { AiSettingsService } from './ai-settings.service.js';
import { AiUsageController } from './ai-usage.controller.js';
import { AiUsageService } from './ai-usage.service.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ClaudeEngine } from './claude-engine.js';
import { ContentTranslatorService } from './content-translator.service.js';
import { FakeAiEngine } from './fake-ai-engine.js';
import { TranslationFillerService } from './translation-filler.service.js';

/**
 * The shared AI part (the Claude API). Global, so any feature's service can ask
 * AiService without importing this module.
 *
 * The AI usage page (19 Oct 2026) reads the request log through AiUsageService, and its
 * settings are kept by AiSettingsService, which AiService reads.
 *
 * Which engine answers is chosen once, when the API starts, from AI_ENGINE: the
 * real one ("real", the default), which calls Anthropic with ANTHROPIC_API_KEY, or
 * the stand-in the automated tests use ("fake"). Without a key the real engine is
 * not ready, every feature counts as off, and the app works as it did before AI.
 */
@Global()
@Module({
  controllers: [AiController, AiUsageController],
  providers: [
    AiService,
    AiSettingsService,
    AiUsageService,
    ContentTranslatorService,
    TranslationFillerService,
    {
      provide: AI_ENGINE,
      useFactory: (): AiEngine => {
        const which = env.AI_ENGINE ?? (env.NODE_ENV === 'test' ? 'fake' : 'real');
        if (which === 'fake') return new FakeAiEngine();
        const engine = new ClaudeEngine(env.ANTHROPIC_API_KEY);
        const logger = new Logger('AiEngine');
        if (env.AI_FEATURES === 'off') logger.log('AI features are switched off (AI_FEATURES=off)');
        else if (engine.ready) logger.log('AI features are on (Claude API)');
        else logger.warn('AI features are off: no ANTHROPIC_API_KEY is set');
        return engine;
      },
    },
  ],
  exports: [AiService, AiSettingsService, ContentTranslatorService, TranslationFillerService],
})
export class AiModule {}
