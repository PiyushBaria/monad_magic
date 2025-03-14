import inquirer from 'inquirer';
import chalk from 'chalk';
import { ethers } from 'ethers';
import { createProvider, createWallet, getRandomGasLimit, getTransactionExplorerUrl } from './api/core/blockchain.js';
import { loadWallets, ENV } from './config/env.chain.js';
import { executeMint, getCollectionInfo, getConfigWithFallback } from './api/services/nft.js';
import { log } from './api/utils/helpers.js';

const displayBanner = () => {
  console.log(chalk.cyan(`
┌─────────────────────────────────┐
│         MONAD NFT 铸造工具       │
│       在 Monad 链上铸造 NFT       │
│                                 │
└─────────────────────────────────┘
`));
};

const extractContractAddress = (input) => {
  if (input.includes('magiceden.io')) {
    const parts = input.split('/');
    return parts[parts.length - 1];
  }
  return input;
};

const getMintPrice = async (contract) => {
  try {
    const { config } = await getConfigWithFallback(contract);
    return config.publicStage.price;
  } catch (error) {
    return ethers.utils.parseEther('0.0001');
  }
};

const DEFAULT_GAS_LIMIT = 100000; // 根据成功交易设置更合理的 gas limit

const main = async () => {
  try {
    displayBanner();

    // 加载钱包
    const wallets = loadWallets();
    if (wallets.length === 0) {
      log.error('没有找到有效的钱包配置，请检查 .env 文件');
      return;
    }

    // 创建提供者
    const provider = createProvider(ENV.NETWORK);
    
    // 获取用户输入
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'mintMode',
        message: '铸造模式:',
        choices: ['即时铸造', '定时铸造']
      },
      {
        type: 'input',
        name: 'contractAddress',
        message: 'NFT 合约地址或 Magic Eden 链接:'
      },
      {
        type: 'confirm',
        name: 'useContractPrice',
        message: '从合约获取价格?',
        default: true
      },
      {
        type: 'input',
        name: 'mintAmount',
        message: '每个钱包铸造数量:',
        default: '1',
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 1) {
            return '请输入大于 0 的数字';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'gasLimit',
        message: 'Gas Limit (建议 100000):',
        default: '100000',
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 90000) { // 最小值设为 90000
            return 'Gas Limit 不能小于 90000';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'maxGasPrice',
        message: '最大可接受的 Gas Price (gwei) (建议 55):',
        default: '55',
        validate: (input) => {
          const num = parseFloat(input);
          if (isNaN(num) || num < 50) { // 最小值设为 50
            return 'Gas Price 不能小于 50 gwei';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'maxPriorityFee',
        message: '最大可接受的 Priority Fee (gwei) (建议 2):',
        default: '2',
        validate: (input) => {
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0) {
            return '请输入有效的 Priority Fee';
          }
          return true;
        }
      }
    ]);

    const contractAddress = extractContractAddress(answers.contractAddress);
    const mintAmount = parseInt(answers.mintAmount);
    const gasLimit = parseInt(answers.gasLimit);

    log.info(`使用合约地址: ${contractAddress}`);
    log.info(`每个钱包铸造数量: ${mintAmount}`);

    // 获取系列信息
    const { name, symbol } = await getCollectionInfo(contractAddress, provider);
    log.info(`系列: ${name} (${symbol})`);

    // 为每个钱包创建合约实例并获取配置
    const firstWallet = createWallet(wallets[0].privateKey, provider);
    const contract = new ethers.Contract(contractAddress, ['function mintPublic(address,uint256)'], firstWallet);
    
    // 获取合约配置和正确的铸造变体
    let mintVariant = 'fourParams';
    log.info('默认使用 fourParams 铸造方式');

    // 获取铸造价格
    let mintPrice;
    if (answers.useContractPrice) {
      mintPrice = await getMintPrice(contract);
      log.success(`从合约获取的价格 - [${ethers.utils.formatEther(mintPrice)} MON]`);
    } else {
      const priceAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'price',
          message: '输入铸造价格 (MON):',
          default: '0.0001'
        }
      ]);
      mintPrice = ethers.utils.parseEther(priceAnswer.price);
    }

    // 如果是定时铸造，等待开始时间
    if (answers.mintMode === '定时铸造') {
      try {
        const config = await contract.getConfig();
        const startTime = config.publicStage.startTime.toNumber();
        const currentTime = Math.floor(Date.now() / 1000);
        
        if (currentTime < startTime) {
          const timeLeft = startTime - currentTime;
          log.info(`等待铸造开始，剩余时间: ${Math.floor(timeLeft / 3600)}小时${Math.floor((timeLeft % 3600) / 60)}分钟`);
          
          // 等待直到开始时间
          await new Promise(resolve => setTimeout(resolve, timeLeft * 1000));
        }
      } catch (error) {
        log.warning('无法获取开始时间，将立即开始铸造');
      }
    }

    // 获取当前 gas 价格并设置合理的默认值
    const feeData = await provider.getFeeData();
    const baseFee = feeData.lastBaseFeePerGas || ethers.utils.parseUnits('50', 'gwei');
    const maxFeePerGas = ethers.utils.parseUnits(answers.maxGasPrice, 'gwei');
    const maxPriorityFeePerGas = ethers.utils.parseUnits(answers.maxPriorityFee, 'gwei');

    log.info(`Gas 设置:`);
    log.info(`- Gas 限制: ${gasLimit}`);
    log.info(`- Base Fee: ${ethers.utils.formatUnits(baseFee, 'gwei')} gwei`);
    log.info(`- Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
    log.info(`- Priority Fee: ${ethers.utils.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);

    // 执行铸造
    for (let i = 0; i < wallets.length; i++) {
      const wallet = createWallet(wallets[i].privateKey, provider);
      
      // 检查钱包余额
      const balance = await provider.getBalance(wallet.address);
      const requiredAmount = mintPrice.mul(mintAmount).add(maxFeePerGas.mul(gasLimit));
      
      if (balance.lt(requiredAmount)) {
        log.error(`钱包 ${i + 1} (${wallet.address}) 余额不足`);
        log.info(`需要: ${ethers.utils.formatEther(requiredAmount)} MON`);
        log.info(`当前余额: ${ethers.utils.formatEther(balance)} MON`);
        continue;
      }

      log.info(`使用钱包 ${i + 1} (${wallet.address}) 开始铸造 ${mintAmount} 个 NFT`);
      
      // 循环铸造指定数量
      for (let j = 0; j < mintAmount; j++) {
        log.info(`正在铸造第 ${j + 1}/${mintAmount} 个...`);
        
        const result = await executeMint(
          contractAddress,
          wallet,
          gasLimit,
          maxFeePerGas,
          mintVariant,
          mintPrice,
          getTransactionExplorerUrl(null, ENV.NETWORK),
          maxPriorityFeePerGas
        );

        if (result.error) {
          log.error(`钱包 ${i + 1} 第 ${j + 1} 个铸造失败: ${result.error}`);
          if (i === 0 && j === 0) {
            log.warning('尝试使用另一种铸造方式...');
            const altVariant = mintVariant === 'twoParams' ? 'fourParams' : 'twoParams';
            mintVariant = altVariant;
            const retryResult = await executeMint(
              contractAddress,
              wallet,
              gasLimit,
              maxFeePerGas,
              altVariant,
              mintPrice,
              getTransactionExplorerUrl(null, ENV.NETWORK),
              maxPriorityFeePerGas
            );
            if (!retryResult.error) {
              log.success(`使用 ${altVariant} 方式成功！`);
            } else {
              // 如果两种方式都失败，跳过这个钱包
              break;
            }
          }
        } else {
          log.success(`钱包 ${i + 1} 第 ${j + 1} 个铸造成功！`);
        }
        
        // 在每次铸造之间等待一小段时间
        if (j < mintAmount - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // 在不同钱包之间等待更长时间
      if (i < wallets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    log.success('铸造过程完成!');

  } catch (error) {
    log.error('发生错误:', error.message);
    if (error.error) {
      log.error('详细错误:', error.error.message);
    }
  }
};

main(); 