import inquirer from 'inquirer';
import chalk from 'chalk';
import { ethers } from 'ethers';
import { createProvider, createWallet, getRandomGasLimit, getTransactionExplorerUrl } from './api/core/blockchain.js';
import { loadWallets, ENV } from './config/env.chain.js';
import { executeMint, getCollectionInfo, getConfigWithFallback } from './api/services/nft.js';
import { log } from './api/utils/helpers.js';
import { ABI } from './config/ABI.js';

const displayBanner = () => {
  console.log(chalk.cyan(`
─────────────────────────────────
         MONAD NFT 铸造工具       
       在 Monad 链上铸造 NFT                                    
─────────────────────────────────
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
    log.info('正在获取合约配置...');
    const { config } = await getConfigWithFallback(contract);
    log.info('成功获取合约配置');
    const price = config.publicStage.price;
    log.success(`从合约获取的价格 - [${ethers.utils.formatEther(price)} MON]`);
    return price;
  } catch (error) {
    log.warning('无法从合约获取价格');
    log.error('获取价格错误:', error.message);
    return null;
  }
};

const DEFAULT_GAS_LIMIT = 100000; // 根据成功交易设置更合理的 gas limit
const DEFAULT_MONITOR_INTERVAL = 3000; // 默认监控间隔时间（毫秒）

const monitorMintStart = async (contract, startCallback) => {
  try {
    const { config } = await getConfigWithFallback(contract);
    const currentTime = Math.floor(Date.now() / 1000);
    const publicStage = config.publicStage;
    
    if (currentTime >= publicStage.startTime.toNumber() && currentTime <= publicStage.endTime.toNumber()) {
      // 检查是否可以铸造
      try {
        const price = publicStage.price;
        log.success(`检测到铸造已开始！`);
        log.info(`- 铸造价格: ${ethers.utils.formatEther(price)} MON`);
        log.info(`- 结束时间: ${new Date(publicStage.endTime.toNumber() * 1000).toLocaleString()}`);
        await startCallback(price);
        return true;
      } catch (err) {
        return false;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
};

const startMonitoring = async (
  contractAddress,
  provider,
  wallets,
  mintAmount,
  gasLimit,
  maxFeePerGas,
  maxPriorityFeePerGas,
  monitorInterval = DEFAULT_MONITOR_INTERVAL
) => {
  try {
    const firstWallet = createWallet(wallets[0].privateKey, provider);
    log.info('正在创建监控合约实例...');
    const contract = new ethers.Contract(contractAddress, ABI, firstWallet);
    
    log.info('开始监控铸造状态...');
    log.info(`监控间隔: ${monitorInterval/1000} 秒`);
    
    let isFirstAttempt = true;
    let isCompleted = false;
    
    const monitor = async () => {
      const startMinting = async (price) => {
        // 执行铸造逻辑
        for (let i = 0; i < wallets.length; i++) {
          const wallet = createWallet(wallets[i].privateKey, provider);
          
          // 检查钱包余额
          const balance = await provider.getBalance(wallet.address);
          const requiredAmount = price.mul(mintAmount).add(maxFeePerGas.mul(gasLimit));
          
          if (balance.lt(requiredAmount)) {
            log.error(`钱包 ${i + 1} (${wallet.address}) 余额不足`);
            log.info(`需要: ${ethers.utils.formatEther(requiredAmount)} MON`);
            log.info(`当前余额: ${ethers.utils.formatEther(balance)} MON`);
            continue;
          }

          log.info(`使用钱包 ${i + 1} (${wallet.address}) 开始铸造 ${mintAmount} 个 NFT`);
          
          for (let j = 0; j < mintAmount; j++) {
            const result = await executeMint(
              contractAddress,
              wallet,
              gasLimit,
              maxFeePerGas,
              'fourParams', // 优先使用 fourParams
              price,
              getTransactionExplorerUrl(null, ENV.NETWORK),
              maxPriorityFeePerGas
            );

            if (result.error && isFirstAttempt) {
              // 如果是第一次尝试失败，切换铸造方式再试一次
              isFirstAttempt = false;
              const retryResult = await executeMint(
                contractAddress,
                wallet,
                gasLimit,
                maxFeePerGas,
                'twoParams',
                price,
                getTransactionExplorerUrl(null, ENV.NETWORK),
                maxPriorityFeePerGas
              );
              if (!retryResult.error) {
                log.success(`使用 twoParams 方式成功！`);
              }
            }
            
            if (j < mintAmount - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
          
          if (i < wallets.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      };

      const started = await monitorMintStart(contract, startMinting);
      if (started) {
        isCompleted = true;
        return true;
      }
      return false;
    };

    // 持续监控直到铸造开始
    while (!isCompleted) {
      const started = await monitor();
      if (started) {
        log.success('监控结束 - 铸造已完成');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, monitorInterval));
    }
  } catch (error) {
    log.error('监控初始化失败:', error.message);
    if (error.error) {
      log.error('详细错误:', error.error);
    }
    throw error;
  }
};

const getGasPrice = async (provider) => {
  try {
    // 尝试最多3次获取最新的gas价格
    for (let i = 0; i < 3; i++) {
      try {
        const feeData = await provider.getFeeData();
        if (!feeData || !feeData.lastBaseFeePerGas) {
          throw new Error('获取 Gas 价格数据不完整');
        }

        const baseFee = feeData.lastBaseFeePerGas;
        const currentGasPrice = await provider.getGasPrice();
        
        // 计算建议的最大费用：取当前 gas price 和 base fee * 2 的较大值
        const baseFeeMul2 = baseFee.mul(2);
        const suggestedMaxFee = currentGasPrice.gt(baseFeeMul2) ? currentGasPrice : baseFeeMul2;
        
        log.info('当前网络 Gas 信息:');
        log.info(`- Base Fee: ${ethers.utils.formatUnits(baseFee, 'gwei')} gwei`);
        log.info(`- 当前 Gas Price: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
        log.info(`- 建议最大费用: ${ethers.utils.formatUnits(suggestedMaxFee, 'gwei')} gwei`);
        
        return {
          baseFee,
          currentGasPrice,
          suggestedMaxFee
        };
      } catch (retryError) {
        if (i === 2) throw retryError; // 最后一次尝试失败则抛出错误
        log.warning(`第 ${i + 1} 次获取 Gas 价格失败，正在重试...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒后重试
      }
    }
  } catch (error) {
    log.error('获取 Gas 价格失败:', error.message);
    // 如果实在无法获取，使用保守的默认值
    const defaultBaseFee = ethers.utils.parseUnits('50', 'gwei');
    const defaultGasPrice = ethers.utils.parseUnits('100', 'gwei');
    log.warning('使用保守的默认 Gas 价格:');
    log.warning(`- 默认 Base Fee: 50 gwei`);
    log.warning(`- 默认 Gas Price: 100 gwei`);
    return {
      baseFee: defaultBaseFee,
      currentGasPrice: defaultGasPrice,
      suggestedMaxFee: defaultGasPrice
    };
  }
};

const main = async () => {
  try {
    displayBanner();

    const wallets = loadWallets();
    if (wallets.length === 0) {
      log.error('没有找到有效的钱包配置，请检查 .env 文件');
      return;
    }

    const provider = createProvider(ENV.NETWORK);
    
    // 获取实时 gas 价格
    const { baseFee, currentGasPrice, suggestedMaxFee } = await getGasPrice(provider);
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'mintMode',
        message: '铸造模式:',
        choices: ['即时铸造', '监控模式', '定时铸造']
      },
      {
        type: 'input',
        name: 'contractAddress',
        message: 'NFT 合约地址或 Magic Eden 链接:'
      },
      {
        type: 'list',
        name: 'mintMethod',
        message: '选择铸造方法:',
        choices: [
          { name: '自动 (先尝试 fourParams，失败后尝试 twoParams)', value: 'auto' },
          { name: 'fourParams', value: 'fourParams' },
          { name: 'twoParams', value: 'twoParams' }
        ],
        default: 'auto'
      },
      {
        type: 'confirm',
        name: 'useContractPrice',
        message: '是否从合约获取价格?',
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
        message: 'Gas Limit (建议 110000):',
        default: '110000',
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 100000) {
            return 'Gas Limit 不能小于 100000';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'maxGasPrice',
        message: `最大可接受的 Gas Price (gwei) (当前网络建议 ${ethers.utils.formatUnits(suggestedMaxFee, 'gwei')}, 实时 Gas ${ethers.utils.formatUnits(currentGasPrice, 'gwei')}):`,
        default: ethers.utils.formatUnits(suggestedMaxFee, 'gwei'),
        validate: (input) => {
          const num = parseFloat(input);
          if (isNaN(num) || num < parseFloat(ethers.utils.formatUnits(baseFee, 'gwei'))) {
            return `Gas Price 不能低于当前 Base Fee (${ethers.utils.formatUnits(baseFee, 'gwei')} gwei)`;
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'priorityFeePercent',
        message: '优先费用百分比 (直接输入数字，如 30 表示 30%, 回车默认 10%):',
        default: '10',
        validate: (input) => {
          if (input === '') return true;
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0 || num > 100) {
            return '请输入 1-100 之间的数字';
          }
          return true;
        }
      }
    ]);

    const contractAddress = extractContractAddress(answers.contractAddress);
    const mintAmount = parseInt(answers.mintAmount);
    const gasLimit = parseInt(answers.gasLimit);
    
    log.info(`使用合约地址: ${contractAddress}`);
    
    try {
      // 获取系列信息
      log.info('正在获取系列信息...');
      const { name, symbol } = await getCollectionInfo(contractAddress, provider);
      log.info(`系列: ${name} (${symbol})`);

      // 为每个钱包创建合约实例并获取配置
      log.info('正在创建合约实例...');
      const firstWallet = createWallet(wallets[0].privateKey, provider);
      const contract = new ethers.Contract(contractAddress, ABI, firstWallet);
      
      // 计算优先费用
      const priorityFeePercent = parseFloat(answers.priorityFeePercent || '10');
      const priorityFeeGwei = ethers.utils.formatUnits(baseFee.mul(priorityFeePercent).div(100), 'gwei');
      const maxPriorityFeePerGas = ethers.utils.parseUnits(priorityFeeGwei, 'gwei');
      const maxFeePerGas = ethers.utils.parseUnits(answers.maxGasPrice, 'gwei');

      log.info(`Gas 设置:`);
      log.info(`- Gas 限制: ${gasLimit}`);
      log.info(`- 当前 Base Fee: ${ethers.utils.formatUnits(baseFee, 'gwei')} gwei`);
      log.info(`- 当前 Gas Price: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
      log.info(`- 最大费用: ${answers.maxGasPrice} gwei`);
      log.info(`- 优先费用: ${priorityFeeGwei} gwei (Base Fee 的 ${priorityFeePercent}%)`);
      log.info(`- 预计最大总 Gas 费用: ${ethers.utils.formatEther(maxFeePerGas.mul(gasLimit))} MON`);

      if (answers.mintMode === '监控模式') {
        const monitorInterval = parseInt(answers.monitorInterval) * 1000;
        await startMonitoring(
          contractAddress,
          provider,
          wallets,
          mintAmount,
          gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
          monitorInterval
        );
        return;
      }

      // 获取合约配置和正确的铸造变体
      let mintVariant = 'fourParams';
      log.info('默认使用 fourParams 铸造方式');

      // 获取铸造价格
      let mintPrice;
      if (answers.useContractPrice) {
        log.info('正在从合约获取价格...');
        mintPrice = await getMintPrice(contract);
        
        if (!mintPrice) {
          // 如果无法从合约获取价格，提示手动输入
          const priceAnswer = await inquirer.prompt([
            {
              type: 'input',
              name: 'price',
              message: '无法从合约获取价格，请输入铸造价格 (MON):',
              validate: (input) => {
                const num = parseFloat(input);
                if (isNaN(num)) {
                  return '请输入有效的数字';
                }
                return true;
              }
            }
          ]);
          mintPrice = ethers.utils.parseEther(priceAnswer.price);
          log.info(`使用手动输入的价格 - [${ethers.utils.formatEther(mintPrice)} MON]`);
        }
      } else {
        // 直接手动输入价格
        const priceAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'price',
            message: '请输入铸造价格 (MON):',
            validate: (input) => {
              const num = parseFloat(input);
              if (isNaN(num)) {
                return '请输入有效的数字';
              }
              return true;
            }
          }
        ]);
        mintPrice = ethers.utils.parseEther(priceAnswer.price);
        log.info(`使用手动输入的价格 - [${ethers.utils.formatEther(mintPrice)} MON]`);
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
          
          let result;
          if (answers.mintMethod === 'auto') {
            // 先尝试 fourParams
            log.info('尝试使用 fourParams 方法铸造...');
            result = await executeMint(
              contractAddress,
              wallet,
              gasLimit,
              maxFeePerGas,
              'fourParams',
              mintPrice,
              getTransactionExplorerUrl(null, ENV.NETWORK),
              maxPriorityFeePerGas
            );

            if (result.error) {
              log.warning('fourParams 方法失败，错误信息:', result.error);
              log.info('尝试使用 twoParams 方法铸造...');
              result = await executeMint(
                contractAddress,
                wallet,
                gasLimit,
                maxFeePerGas,
                'twoParams',
                mintPrice,
                getTransactionExplorerUrl(null, ENV.NETWORK),
                maxPriorityFeePerGas
              );
              
              if (result.error) {
                log.error(`twoParams 方法也失败了，错误信息:`, result.error);
              } else {
                log.success(`使用 twoParams 方式铸造成功！`);
                if (result.txHash) {
                  log.info(`交易哈希: ${result.txHash}`);
                  log.info(`浏览器链接: ${getTransactionExplorerUrl(result.txHash, ENV.NETWORK)}`);
                }
                if (result.gasUsed) {
                  log.info(`实际使用的 Gas: ${result.gasUsed}`);
                }
              }
            } else {
              log.success(`使用 fourParams 方式铸造成功！`);
              if (result.txHash) {
                log.info(`交易哈希: ${result.txHash}`);
                log.info(`浏览器链接: ${getTransactionExplorerUrl(result.txHash, ENV.NETWORK)}`);
              }
              if (result.gasUsed) {
                log.info(`实际使用的 Gas: ${result.gasUsed}`);
              }
            }
          } else {
            // 使用用户指定的方法
            result = await executeMint(
              contractAddress,
              wallet,
              gasLimit,
              maxFeePerGas,
              answers.mintMethod,
              mintPrice,
              getTransactionExplorerUrl(null, ENV.NETWORK),
              maxPriorityFeePerGas
            );

            if (result.error) {
              log.error(`${answers.mintMethod} 方法铸造失败，错误信息:`, result.error);
            } else {
              log.success(`使用 ${answers.mintMethod} 方式铸造成功！`);
              if (result.txHash) {
                log.info(`交易哈希: ${result.txHash}`);
                log.info(`浏览器链接: ${getTransactionExplorerUrl(result.txHash, ENV.NETWORK)}`);
              }
              if (result.gasUsed) {
                log.info(`实际使用的 Gas: ${result.gasUsed}`);
              }
            }
          }

          if (result.error) {
            log.error(`钱包 ${i + 1} 第 ${j + 1} 个铸造失败`);
            log.error(`- 错误类型: ${result.error.code || '未知'}`);
            log.error(`- 错误信息: ${result.error.message || result.error}`);
            if (result.error.transaction) {
              log.error(`- 交易数据: ${JSON.stringify(result.error.transaction, null, 2)}`);
            }
            // 如果是自动模式且两种方法都失败，或者是指定方法失败，跳过这个钱包
            break;
          } else {
            log.success(`钱包 ${i + 1} 第 ${j + 1} 个铸造成功！`);
            log.info(`- 交易状态: ${result.status || '已确认'}`);
            if (result.blockNumber) {
              log.info(`- 区块号: ${result.blockNumber}`);
            }
            if (result.gasUsed) {
              log.info(`- Gas 使用: ${result.gasUsed}`);
            }
            if (result.effectiveGasPrice) {
              log.info(`- 实际 Gas 价格: ${ethers.utils.formatUnits(result.effectiveGasPrice, 'gwei')} gwei`);
            }
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
      log.error('初始化过程中发生错误:');
      log.error('- 错误信息:', error.message);
      if (error.error) {
        log.error('- 详细错误:', error.error);
      }
      if (error.code) {
        log.error('- 错误代码:', error.code);
      }
      if (error.stack) {
        log.error('- 错误堆栈:', error.stack);
      }
      
      // 尝试使用简化的 ABI
      log.info('尝试使用简化的 ABI...');
      const simpleABI = [
        "function mintPublic(address to, uint256 qty) payable",
        "function mintPublic(address to, uint256 param2, uint256 param3, bytes data) payable",
        "function name() view returns (string)",
        "function symbol() view returns (string)"
      ];
      
      try {
        const contract = new ethers.Contract(contractAddress, simpleABI, firstWallet);
        log.success('使用简化 ABI 成功创建合约实例');
        // ... continue with the rest of the code ...
      } catch (retryError) {
        log.error('使用简化 ABI 仍然失败:', retryError.message);
        throw error; // 抛出原始错误
      }
    }
  } catch (error) {
    log.error('发生错误:', error.message);
    if (error.error) {
      log.error('详细错误:', error.error);
    }
  }
};

main(); 
