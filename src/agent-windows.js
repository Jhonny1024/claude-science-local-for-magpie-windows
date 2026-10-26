// Agent declarations run in Magpie's JS sandbox, not Node.js.
import {agent as baseAgent, connect} from './agent.js';
export const agent = {
  ...baseAgent,
  dir: '~/AppData/Local/Programs/ClaudeScience',
  bin: 'claude-science',
};
export {connect};
