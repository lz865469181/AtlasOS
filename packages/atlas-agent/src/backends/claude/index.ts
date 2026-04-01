import { agentRegistry } from '../../core/AgentRegistry.js';
import { ClaudeBackend } from './ClaudeBackend.js';

agentRegistry.register('claude', (opts) => new ClaudeBackend(opts, 'sonnet'));
