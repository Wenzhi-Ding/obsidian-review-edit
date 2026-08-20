import type { App, ButtonComponent, Plugin, SettingDefinitionItem } from 'obsidian';
import { Modal, PluginSettingTab, Setting } from 'obsidian';

import { uiStrings } from './strings';

export interface ReviewEditSettings {
  ownSnapshotsEnabled: boolean;
  burstThresholdMinutes: number;
  retentionDays: number;
  /** 首次全量基线是否已完成；purge 不重置它（重建由用户显式触发） */
  baselined: boolean;
}

export const DEFAULT_SETTINGS: ReviewEditSettings = {
  ownSnapshotsEnabled: true,
  burstThresholdMinutes: 1,
  retentionDays: 30,
  baselined: false,
};

/** 设置面板的宿主：main.ts 的插件实例实现这个接口 */
export interface SettingsHost {
  settings: ReviewEditSettings;
  saveSettings(): Promise<void>;
  enableOwnSnapshots(): Promise<void>;
  disableOwnSnapshots(): void;
  rebuildBaseline(): Promise<void>;
  purgeSnapshots(): Promise<void>;
  /** 诊断锚点：写入插件目录 rebuild.log（定位全库扫描冻死用） */
  diagLog(line: string): void;
  /** 设置页注入的进度显示回调：重建进行中按钮文本实时更新；null 恢复原文本 */
  onBaselineProgressUI: ((text: string | null) => void) | null;
}

class PurgeConfirmModal extends Modal {
  constructor(app: App, private host: SettingsHost) {
    super(app);
  }

  onOpen(): void {
    const t = uiStrings();
    this.titleEl.setText(t.confirmPurgeTitle);
    this.contentEl.createEl('p', { text: t.confirmPurgeBody });
    new Setting(this.contentEl)
      .addButton(b =>
        // 危险样式 API：setWarning 已弃用、setDestructive 需 1.13（minAppVersion 1.5），
        // 防误触由本确认弹窗承担，用普通按钮
        b.setButtonText(t.confirmPurgeConfirm).onClick(() => {
          void this.host.purgeSnapshots().finally(() => this.close());
        })
      )
      .addButton(b => b.setButtonText(t.confirmPurgeCancel).onClick(() => this.close()));
  }
}

export class ReviewEditSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SettingsHost) {
    super(app, plugin as unknown as Plugin);
  }

  /**
   * 1.13+ 声明式设置：返回非空数组后 Obsidian 用它渲染设置页并索引进设置搜索，
   * display() 只作为 1.13 之前的回退路径（minAppVersion 1.5）。两条路径的
   * 结构须保持一致：控件项改这里，按钮项改 wireBaselineButton/PurgeConfirmModal。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const t = uiStrings();
    // 与 display() 的 'settings-display' 对应：声明式渲染下框架每次渲染都调用本方法
    if (__DIAG__) this.plugin.diagLog('settings-definitions');
    return [
      {
        type: 'group',
        heading: t.settingsOwnSnapshotsSection,
        items: [
          {
            name: t.settingOwnSnapshotsName,
            desc: t.settingOwnSnapshotsDesc,
            control: {
              type: 'toggle',
              key: 'ownSnapshotsEnabled',
              defaultValue: DEFAULT_SETTINGS.ownSnapshotsEnabled,
            },
          },
          {
            name: t.settingThresholdName,
            desc: t.settingThresholdDesc,
            control: {
              type: 'number',
              key: 'burstThresholdMinutes',
              defaultValue: DEFAULT_SETTINGS.burstThresholdMinutes,
              min: 1,
              max: 60,
              step: 1,
              validate: v => (Number.isInteger(v) && v >= 1 && v <= 60 ? undefined : t.settingThresholdInvalid),
            },
          },
          {
            name: t.settingRetentionName,
            desc: t.settingRetentionDesc,
            control: {
              type: 'number',
              key: 'retentionDays',
              defaultValue: DEFAULT_SETTINGS.retentionDays,
              min: 1,
              max: 365,
              step: 1,
              validate: v => (Number.isInteger(v) && v >= 1 && v <= 365 ? undefined : t.settingRetentionInvalid),
            },
          },
          {
            name: t.settingBaselineName,
            desc: t.settingBaselineDesc,
            // 重建期间要禁用按钮并把进度文案实时写在按钮上，须持有 ButtonComponent，走命令式 render
            render: setting => {
              setting.addButton(b => this.wireBaselineButton(b));
              return () => {
                this.plugin.onBaselineProgressUI = null;
              };
            },
          },
          {
            name: t.settingPurgeName,
            desc: t.settingPurgeDesc,
            action: () => {
              new PurgeConfirmModal(this.app, this.plugin).open();
            },
          },
        ],
      },
    ];
  }

  /** 声明式控件取值：宿主是 SettingsHost 接口，显式覆写而非依赖基类对 plugin.settings 的默认读取 */
  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  /** 声明式控件写值：持久化后分发 ownSnapshotsEnabled 的启停副作用（等价于 display() 路径的 onChange） */
  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
    if (key === 'ownSnapshotsEnabled') {
      if (value) await this.plugin.enableOwnSnapshots();
      else this.plugin.disableOwnSnapshots();
    }
  }

  /** <1.13 的回退渲染；1.13+ 框架改用 getSettingDefinitions，本方法不再被调用 */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // 若设置页被反复重渲染，rebuild.log 会堆满本行——直接暴露渲染风暴
    if (__DIAG__) this.plugin.diagLog('settings-display');
    try {
      this.render();
      if (__DIAG__) this.plugin.diagLog('display-ok attached=' + containerEl.isConnected);
    } catch (e) {
      if (__DIAG__) this.plugin.diagLog('display-error: ' + (e instanceof Error ? e.message : String(e)));
      throw e;
    }
  }

  onClose(): void {
    this.plugin.onBaselineProgressUI = null;
  }

  private render(): void {
    const t = uiStrings();
    const { containerEl } = this;

    new Setting(containerEl).setName(t.settingsOwnSnapshotsSection).setHeading();

    new Setting(containerEl)
      .setName(t.settingOwnSnapshotsName)
      .setDesc(t.settingOwnSnapshotsDesc)
      .addToggle(tg =>
        tg.setValue(this.plugin.settings.ownSnapshotsEnabled).onChange(async v => {
          this.plugin.settings.ownSnapshotsEnabled = v;
          await this.plugin.saveSettings();
          if (v) await this.plugin.enableOwnSnapshots();
          else this.plugin.disableOwnSnapshots();
        })
      );

    new Setting(containerEl)
      .setName(t.settingThresholdName)
      .setDesc(t.settingThresholdDesc)
      .addText(tx =>
        tx.setValue(String(this.plugin.settings.burstThresholdMinutes)).onChange(async v => {
          const n = Math.round(Number(v));
          if (Number.isFinite(n) && n >= 1 && n <= 60) {
            this.plugin.settings.burstThresholdMinutes = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName(t.settingRetentionName)
      .setDesc(t.settingRetentionDesc)
      .addText(tx =>
        tx.setValue(String(this.plugin.settings.retentionDays)).onChange(async v => {
          const n = Math.round(Number(v));
          if (Number.isFinite(n) && n >= 1 && n <= 365) {
            this.plugin.settings.retentionDays = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName(t.settingBaselineName)
      .setDesc(t.settingBaselineDesc)
      .addButton(b => this.wireBaselineButton(b))

    new Setting(containerEl)
      .setName(t.settingPurgeName)
      .setDesc(t.settingPurgeDesc)
      .addButton(b =>
        b.setButtonText(t.settingPurgeName).onClick(() => new PurgeConfirmModal(this.app, this.plugin).open())
      );
  }

  /** 重建按钮的命令式逻辑：display() 回退路径与 getSettingDefinitions 的 render 定义共用 */
  private wireBaselineButton(b: ButtonComponent): void {
    const t = uiStrings();
    b.setButtonText(t.settingBaselineName).onClick(() => {
      if (__DIAG__) this.plugin.diagLog('settings-button-clicked');
      b.setDisabled(true);
      void this.plugin.rebuildBaseline().finally(() => {
        b.setDisabled(false);
        if (__DIAG__) this.plugin.diagLog('button-reenabled');
      });
    });
    // 诊断锚点：不依赖文本匹配即可从 DOM 定位本按钮（eval 复现/截图标注用）
    if (__DIAG__) b.buttonEl.addClass('review-edit-rebuild-btn');
    // 进度直接显示在按钮上，不弹常驻通知（悬浮通知在主窗口的行为是冻死嫌疑对象）
    this.plugin.onBaselineProgressUI = text => {
      b.setButtonText(text ?? t.settingBaselineName);
    };
  }
}
