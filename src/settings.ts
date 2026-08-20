import type { App, Plugin } from 'obsidian';
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

  display(): void {
    const t = uiStrings();
    const { containerEl } = this;
    containerEl.empty();

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
      .addButton(b =>
        b.setButtonText(t.settingBaselineName).onClick(() => void this.plugin.rebuildBaseline())
      );

    new Setting(containerEl)
      .setName(t.settingPurgeName)
      .setDesc(t.settingPurgeDesc)
      .addButton(b =>
        b.setButtonText(t.settingPurgeName).onClick(() => new PurgeConfirmModal(this.app, this.plugin).open())
      );
  }
}
