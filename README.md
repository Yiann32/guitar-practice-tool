# 吉他练习工具（Web 先行版）

一个移动优先的吉他练习网页，当前先验证网页端能力，暂未接入 Android APK。

## 在线体验

网页版已通过 GitHub Pages 部署：<https://yiann32.github.io/guitar-practice-tool/>

推送到 `main` 分支后，`.github/workflows/deploy-pages.yml` 会自动构建并发布。

## 已实现

- 曲谱练习
  - 导入 Guitar Pro 3–8、MusicXML、Capella、alphaTex 和 PDF
  - alphaTab 渲染五线谱和六线谱
  - 支持六线谱、谱+六线、五线谱切换，默认六线谱
  - 播放 / 暂停 / 停止、25%–200% 变速、节拍器、预备拍、A/B 循环
  - 音轨选择、静音、独奏
  - 多音轨 GP8 默认选中第一轨吉他/贝斯六线谱，避免人声轨和自定义布局干扰
  - 每页 16 小节滚动分页、按钮翻页、播放时自动翻页
  - 曲谱窗口高度可通过底部把手上下拖拽，并自动记忆
  - 暂停保持当前位置；播放时高亮当前弹奏音符
  - 播放时右上角显示当前乐器图标，支持吉他、贝斯、键盘、鼓
  - 演奏模式、跟练模式、陪练模式
  - 跟练模式不播放音频，仅高亮当前目标音；检测到正确音高才进入下一个音
  - 陪练模式实时显示音准、节奏、综合百分比，暂停或播完后弹出总评分
  - 音轨静音/独奏有明确按下状态并实时调整播放通道；同一音轨的 M/S 互斥
  - 切换乐器时自动禁用不可用的谱式；切回吉他会恢复六线谱
  - 可拖动进度条、时间显示和一键定位到当前演奏位置
  - PDF 支持分页阅读、缩放和独立节拍器
  - 曲库列表、收藏、删除、播放进度自动保存
- 指板练习
  - 支持吉他 / 贝斯乐器切换，当前提供贝斯 4 弦、Drop D、五弦和 Eb 调弦
  - 标准、Drop D、Eb、D、Open G、Open D、DADGAD 与自定义调弦
  - 音位识别、音阶序列练习、音集/八度过滤
  - 把位范围：低把位 0–4、中把位 5–8、高把位 9–15、全指板 0–15/0–24
  - 两个八度音阶序列自动滚动到当前音
  - 音位识别将目标音名放大显示在弦品提示之前
  - 音阶支持大调、自然小调、五声、布鲁斯、上下行和 1/2 八度
  - 麦克风实时 YIN 单音检测、音分偏差、输入电平、准确率与连击统计
- 音频转 MIDI
  - 浏览器内置 Basic Pitch 模型
  - 标注 Beta；音频导入后自动识别、量化并直接转换成 GP7 曲谱加入曲谱列表
  - 可选择吉他、贝斯、键盘、鼓四种目标乐器
  - 谱式支持自动/五线谱/六线谱；自动模式为吉他/贝斯六线谱，键盘/鼓五线谱
- 数据
  - IndexedDB 本地保存曲谱、进度和练习统计
  - ZIP 备份导出与导入

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。

麦克风接口在 `localhost` 或 HTTPS 下可用。首次进行音频转 MIDI 时会加载本地 Basic Pitch 模型，浏览器需要 WebGL 或 CPU 后端。

## 构建

```bash
npm run build
npm run preview
```

生产资源输出到 `dist/`。

## Android APK

Android 端使用 Capacitor，包名为 `com.guitarpractice.app`，支持 Android 7.0（API 24）及以上。

当前已生成 debug APK：

`downloads/guitar-practice-debug.apk`

重新构建：

```powershell
.\build-android.ps1
```

脚本默认使用：

- JDK 21：`C:\Users\Unknow\.jdks\jbr-21.0.11`
- Android SDK：`D:\Android\Sdk`
- Gradle 镜像：腾讯云
- Maven 镜像：阿里云 `gradle-mirror.init.gradle`

如果 Android SDK 或 JDK 路径变化，修改 `build-android.ps1` 顶部即可。

## 界面与动效

- 视觉方向：纸张与墨线极简主义，暖白纸面、黑色文字、细线分隔，紫色只作为少量交互强调色。
- 字体：Inter Variable 负责正文与控件，Instrument Serif 负责大标题和数字。
- 动效系统：
  - 顶部/底部导航使用滑动墨色胶囊指示当前模块。
  - 曲谱与指板模块切换使用纸张入场，不做全页无差别淡入。
  - 曲谱翻页使用纸张位移反馈，顶部页边进度线随内部滚动实时推进。
  - 答题卡、目标音符、实时音高、评分弹窗使用短促确认动效。
  - `prefers-reduced-motion` 下保留完整内容，只关闭位移和缩放。

## 当前限制

- 实时识别目前只保证单音，和弦/复音识别由离线音频转 MIDI 负责。
- Basic Pitch 更适合单件乐器录音，复杂混音、鼓和人声环境下的准确率有限。
- 音频转 MIDI 当前可导出 MIDI；暂未把生成结果反渲染成可练习的曲谱条目。
- PDF 只能分页跟弹和节拍器练习，无法解析音符、合成播放或自动高亮。
- 部分 GP8 曲谱自带多小节休止等复杂布局信息，alphaTab 内部会记录一条兼容性错误；界面已静默处理，曲谱仍会完整分页显示。
- 数据只保存在当前浏览器，清除站点数据前请先导出备份。

## 验证截图

- [曲谱练习](docs/screenshots/score-practice.png)
- [曲谱第 2 页](docs/screenshots/score-practice-page2.png)
- [GP8 多音轨曲谱](docs/screenshots/gp8-multitrack.png)
- [指板音位识别](docs/screenshots/fretboard-practice.png)
- [音阶练习](docs/screenshots/scale-practice.png)
- [PDF 曲谱](docs/screenshots/pdf-import.png)
- [音频转 MIDI](docs/screenshots/audio-to-midi.png)
- [极简主义桌面版](docs/screenshots/minimal-desktop.png)
- [移动端布局](docs/screenshots/minimal-mobile.png)
- [减少动效模式](docs/screenshots/minimal-reduced-motion.png)

## GitHub

- 仓库：[Yiann32/guitar-practice-tool](https://github.com/Yiann32/guitar-practice-tool)
- 乐器图标使用 `参考/` 目录下的吉他、贝斯、键盘、架子鼓 SVG，并同步到 `public/icons/`
