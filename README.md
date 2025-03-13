# Monad NFT 铸造工具

一个模块化的命令行工具，用于在 Monad 区块链上铸造 NFT。通过自动检测正确的铸造函数和参数，简化了与 NFT 合约交互的过程。

## 功能特点

- **模块化架构**: 清晰的关注点分离，便于维护和扩展
- **多种铸造模式**: 可选择即时铸造或定时铸造
- **智能合约集成**: 自动检测正确的铸造函数和参数
- **自动价格检测**: 自动从合约获取铸造价格
- **定时铸造**: 可在合约指定的发布时间自动开始铸造
- **简单钱包管理**: 通过环境变量轻松配置
- **系列详情**: 显示系列名称和供应信息（如可用）
- **Magic Eden 链接支持**: 直接粘贴 Magic Eden 铸造链接即可提取合约地址

## 安装说明

1. 克隆仓库:

```bash
git clone https://github.com/0xbaiwan/monad_magiceden_nft.git
cd monad_magiceden_nft
```

2. 安装依赖:

```bash
npm install
```

3. 配置钱包:

   在 `.env` 文件中添加你的私钥:

   ```
   NETWORK=monad-testnet
   MAX_CONCURRENT_MINTS=10
   DEFAULT_GAS_LIMIT_MIN=180000
   DEFAULT_GAS_LIMIT_MAX=280000

   PRIVATEKEY=0x你的私钥
   ```

   ⚠️ **重要提示**: 切勿分享你的 `.env` 文件或泄露你的私钥。

## 使用方法

启动铸造工具:

```bash
#设置 .env
npm run setup

#启动
npm start
```

按照交互提示进行操作:

1. 选择即时铸造或定时铸造
2. 输入 NFT 合约地址或 Magic Eden 链接
   - 可以粘贴链接如 `https://magiceden.io/mint-terminal/monad-testnet/0x0000000000000`
   - 或直接输入合约地址
3. 选择从合约获取铸造价格或手动输入

### 使用示例

```
┌─────────────────────────────────┐
│         MONAD NFT 铸造工具       │
│       在 Monad 链上铸造 NFT       │
│                                 │
└─────────────────────────────────┘

? 铸造模式: 即时铸造
? NFT 合约地址或 Magic Eden 链接: https://magiceden.io/mint-terminal/monad-testnet/0x000000000000000
> 使用合约地址: 0x00000000000000
> 系列: MyNFTCollection (MNFT)
? 从合约获取价格? 是
+ 从合约获取的价格 - [0.0001 MON]
> 供应量: 999999
> 使用 gas 限制: [267348] 全局铸造变体: [fourParams]
> 钱包正在铸造 1 个 NFT
+ 铸造交易已发送! [0x0000...000]
  https://testnet.monadexplorer.com/tx/000000000
+ 交易已在区块 [6290517] 中确认
+ 铸造过程完成!
```

## 项目结构

```
|— api/
|   |— core/           # 核心组件，用于网络请求
|   |   |— blockchain.js # 区块链交互工具
|   |   |— http.js     # HTTP 客户端
|   |— services/       # API 服务，如钱包、系列等
|   |   |— magiceden.js # Magic Eden API 集成
|   |   |— nft.js      # NFT 合约交互
|   |— utils/          # 辅助工具
|   |   |— helpers.js  # 通用辅助函数
|   |— index.js        # API 入口点
|— config/
|   |— ABI.js          # 合约 ABI 定义
|   |— chain.js        # 区块链配置
|   |— env.chain.js    # 区块链环境变量
|— .env                # API 和钱包配置
|— main.js             # 应用程序入口点
```

## 支持的网络

目前支持 Monad 测试网。

欢迎贡献！请随时提出问题或提交拉取请求。
## 许可证

本项目采用 MIT 许可证 - 详见 LICENSE 文件

