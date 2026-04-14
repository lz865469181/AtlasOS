import { agentRegistry } from '../../core/AgentRegistry.js';
import { CodexBackend } from './CodexBackend.js';

agentRegistry.register('codex', (opts) => new CodexBackend(opts));
