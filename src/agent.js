import {SCIENCE_ICON} from './icon.js';

// Magpie owns writing and restoring this file; this module performs no I/O.
export const agent = {
  id: 'science-local',
  name: 'Claude Science Local for Magpie',
  config: '~/.config/magpie/science-local.json',
  format: 'json',
  // Shared by the native macOS and Windows app; no platform APIs in this sandbox.
  dir: '~/.claude-science',
  icon: SCIENCE_ICON,
  notice:
    '本地接入：首次使用须按插件 README 初始化本地服务；仅安装插件还不能启动 Science。在 Claude Science 的模型菜单中选择模型；Magpie 中可挑选开放给它的模型。列表改变后重开 Science 窗口。',
};

export function connect({gateway, models}) {
  return {
    gateway: gateway.url,
    key: gateway.key,
    models: (models || []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      context: model.context || 0,
      output: model.output || 0,
      images: !!model.images,
      efforts: model.efforts || [],
    })),
  };
}
