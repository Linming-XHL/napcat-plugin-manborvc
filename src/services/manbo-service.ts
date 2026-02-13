import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { pluginState } from '../core/state';

interface ManboApiResponse {
    code: number;
    msg?: string;
    url?: string;
    api_source?: string;
}

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

class ManboRateLimiter {
    private requests = new Map<string, RateLimitEntry>();
    private windowSize = 60000;

    check(key: string, limit: number): boolean {
        if (limit === -1) return true;
        if (limit === 0) return false;

        const now = Date.now();
        const entry = this.requests.get(key);

        if (!entry || now - entry.windowStart >= this.windowSize) {
            this.requests.set(key, { count: 1, windowStart: now });
            return true;
        }

        if (entry.count >= limit) {
            return false;
        }

        entry.count++;
        return true;
    }

    getRemaining(key: string, limit: number): number {
        if (limit === -1) return -1;
        if (limit === 0) return 0;

        const entry = this.requests.get(key);
        if (!entry) return limit;

        const now = Date.now();
        if (now - entry.windowStart >= this.windowSize) {
            return limit;
        }

        return Math.max(0, limit - entry.count);
    }

    reset(key: string): void {
        this.requests.delete(key);
    }

    clear(): void {
        this.requests.clear();
    }
}

const rateLimiter = new ManboRateLimiter();

export async function generateManboVoice(ctx: NapCatPluginContext, text: string, groupId?: number): Promise<{ success: boolean; audioUrl?: string; error?: string }> {
    const config = pluginState.config;
    const apiUrl = config.manboApiUrl?.trim();
    const rateLimit = config.manboRateLimit ?? -1;

    if (!apiUrl) {
        return { success: false, error: '曼波API地址未配置' };
    }

    const rateLimitKey = groupId ? `group:${groupId}` : 'global';

    if (!rateLimiter.check(rateLimitKey, rateLimit)) {
        return { success: false, error: '请求过于频繁，请稍后再试' };
    }

    try {
        const url = new URL(apiUrl);
        url.searchParams.append('text', text);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }

        const result: ManboApiResponse = await response.json();

        if (result.code === 200 && result.url) {
            return { success: true, audioUrl: result.url };
        } else {
            return { success: false, error: result.msg || '生成语音失败' };
        }
    } catch (error) {
        ctx.logger.error('调用曼波API失败:', error);
        return { success: false, error: `API调用失败: ${error instanceof Error ? error.message : String(error)}` };
    }
}

export function getRateLimitRemaining(groupId?: number): number {
    const config = pluginState.config;
    const rateLimit = config.manboRateLimit ?? -1;
    const rateLimitKey = groupId ? `group:${groupId}` : 'global';
    return rateLimiter.getRemaining(rateLimitKey, rateLimit);
}

export function resetRateLimit(groupId?: number): void {
    const rateLimitKey = groupId ? `group:${groupId}` : 'global';
    rateLimiter.reset(rateLimitKey);
}

export function clearAllRateLimits(): void {
    rateLimiter.clear();
}
