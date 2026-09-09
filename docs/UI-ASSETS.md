# UI 素材说明

2026-09-09 淡桃粉界面使用12张最终运行PNG。宝宝角色和幸福文案由图像生成模型制作，再按维护者授权进行本地去背景、裁边与等比缩放；其余图标从项目已确认的生成设计中提取。深色尿布使用相同轮廓与透明通道调整配色。图片不包含真实宝宝或家庭照片。

公开仓保留最终素材和本制作来源说明，不包含编辑原图、生成提示词或内部设计记录。`assets/ui/manifest.json` 的 `source.reference` 指向本说明；它是来源记录，不是可重新生成全部图片的原始工程。逐项方法仍记录在清单中。

`npm run test:ui-assets` 保持完整PNG检查：固定文件集合、尺寸、颜色模式、真实透明像素、边缘留白、模板色值和SHA-256，并核对来源说明文件存在。公开版没有跳过素材检查，也不依赖仓库外文件。

| 文件 | 尺寸 | 颜色模式 | SHA-256 |
| --- | --- | --- | --- |
| `baby-sleeping.png` | 480×320 | `full-color` | `8db66b17bda16aa88bdcbefa2ef180390048b8b933f0160b9d3c4e2a34000292` |
| `baby-smile.png` | 384×384 | `full-color` | `6c4173ddfafcfd669cfda6f9fc15746b11ad4439fb2cd156a706fbd9b6f63acd` |
| `brand-flower.png` | 96×96 | `template` | `6e408bef095fb3e40afec4f38d78c0d476fcf821bb2fd7d2e9ab1e7eccf46a0f` |
| `breastfeeding.png` | 144×144 | `template` | `54c2c0b2f7f5ea76a966965244d9891922397118e8760d40154db58b9d23a7d3` |
| `feeding.png` | 144×144 | `template` | `9fed7658929140d4a548c89ec98f71b6e50deb7bdc71571346e64f28d9ca43f3` |
| `happiness-note.png` | 480×200 | `template` | `8049981766c792033f36d833108f8512f9578df9ad705bd8446dcf0c2a04ab99` |
| `milk-volume.png` | 144×144 | `template` | `e201c925dbe61be0c5c8c05cb97527d989bfbc94eb3179fc86dbf891dce8d49e` |
| `other.png` | 144×144 | `template` | `4569fb201e6724b7e0e38e916a19d3034ae0ef0658239dfc5d82a61806359b79` |
| `pee.png` | 144×144 | `template` | `9e4b84c9c9e0f9b4ffeb064e26173545d7098de12ee26760fdbedd4f06036bef` |
| `poop-dark.png` | 144×144 | `full-color` | `cad60f8dd6814a1505a30202bb572f45e3f46092b1f589181a68ffcbb7cf7f27` |
| `poop-light.png` | 144×144 | `full-color` | `bb9e8674a5305a9b4ed1d184fa51b7584b437320b27e01dc04acdaf8320bf4a0` |
| `sleep.png` | 144×144 | `template` | `aa81d7d8550e841d76f7f82367c4b97fc8f2fa00de6853957f7950056d2072ac` |

单色模板由应用主题着色，宝宝与双色尿布保留彩色。所有图片都有真实透明通道；它们不是整页截图，不替代真实文字、控件或业务数据。

来源及权利说明见 [第三方声明](../THIRD_PARTY_NOTICES.md)。新增图形不因为项目使用 Expo、Material Symbols 或 MIT 代码许可而自动获得这些第三方的素材授权。
