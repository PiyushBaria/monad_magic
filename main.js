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
         MONAD NFT Minting Tool       
       Mint NFTs on the Monad Chain                                    
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
    log.info('Fetching contract configuration...');
    const { config } = await getConfigWithFallback(contract);
    log.info('Successfully fetched contract configuration');
    const price = config.publicStage.price;
    log.success(`Price fetched from contract - [${ethers.utils.formatEther(price)} MON]`);
    return price;
  } catch (error) {
    log.warning('Unable to fetch price from contract');
    log.error('Error fetching price:', error.message);
    return null;
  }
};

const DEFAULT_GAS_LIMIT = 100000; // Set a more reasonable gas limit based on successful transactions
const DEFAULT_MONITOR_INTERVAL = 3000; // Default monitoring interval (milliseconds)

const monitorMintStart = async (contract, startCallback) => {
  try {
    const { config } = await getConfigWithFallback(contract);
    const currentTime = Math.floor(Date.now() / 1000);
    const publicStage = config.publicStage;
    
    if (currentTime >= publicStage.startTime.toNumber() && currentTime <= publicStage.endTime.toNumber()) {
      // Check if minting is possible
      try {
        const price = publicStage.price;
        log.success(`Minting detected as started!`);
        log.info(`- Minting price: ${ethers.utils.formatEther(price)} MON`);
        log.info(`- End time: ${new Date(publicStage.endTime.toNumber() * 1000).toLocaleString()}`);
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
    log.info('Creating monitoring contract instance...');
    const contract = new ethers.Contract(contractAddress, ABI, firstWallet);
    
    log.info('Starting to monitor minting status...');
    log.info(`Monitoring interval: ${monitorInterval/1000} seconds`);
    
    let isFirstAttempt = true;
    let isCompleted = false;
    
    const monitor = async () => {
      const startMinting = async (price) => {
        // Execute minting logic
        for (let i = 0; i < wallets.length; i++) {
          const wallet = createWallet(wallets[i].privateKey, provider);
          
          // Check wallet balance
          const balance = await provider.getBalance(wallet.address);
          const requiredAmount = price.mul(mintAmount).add(maxFeePerGas.mul(gasLimit));
          
          if (balance.lt(requiredAmount)) {
            log.error(`Wallet ${i + 1} (${wallet.address}) has insufficient balance`);
            log.info(`Required: ${ethers.utils.formatEther(requiredAmount)} MON`);
            log.info(`Current balance: ${ethers.utils.formatEther(balance)} MON`);
            continue;
          }

          log.info(`Using wallet ${i + 1} (${wallet.address}) to start minting ${mintAmount} NFTs`);
          
          for (let j = 0; j < mintAmount; j++) {
            const result = await executeMint(
              contractAddress,
              wallet,
              gasLimit,
              maxFeePerGas,
              'fourParams', // Prefer using fourParams
              price,
              getTransactionExplorerUrl(null, ENV.NETWORK),
              maxPriorityFeePerGas
            );

            if (result.error && isFirstAttempt) {
              // If the first attempt fails, switch minting method and try again
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
                log.success(`Success using twoParams method!`);
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

    // Continuously monitor until minting starts
    while (!isCompleted) {
      const started = await monitor();
      if (started) {
        log.success('Monitoring ended - Minting completed');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, monitorInterval));
    }
  } catch (error) {
    log.error('Failed to initialize monitoring:', error.message);
    if (error.error) {
      log.error('Detailed error:', error.error);
    }
    throw error;
  }
};

const getGasPrice = async (provider) => {
  try {
    // Attempt to fetch the latest gas price up to 3 times
    for (let i = 0; i < 3; i++) {
      try {
        const feeData = await provider.getFeeData();
        if (!feeData || !feeData.lastBaseFeePerGas) {
          throw new Error('Incomplete Gas price data fetched');
        }

        const baseFee = feeData.lastBaseFeePerGas;
        const currentGasPrice = await provider.getGasPrice();
        
        // Calculate suggested max fee: take the greater of current gas price and base fee * 2
        const baseFeeMul2 = baseFee.mul(2);
        const suggestedMaxFee = currentGasPrice.gt(baseFeeMul2) ? currentGasPrice : baseFeeMul2;
        
        log.info('Current network Gas information:');
        log.info(`- Base Fee: ${ethers.utils.formatUnits(baseFee, 'gwei')} gwei`);
        log.info(`- Current Gas Price: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
        log.info(`- Suggested Max Fee: ${ethers.utils.formatUnits(suggestedMaxFee, 'gwei')} gwei`);
        
        return {
          baseFee,
          currentGasPrice,
          suggestedMaxFee
        };
      } catch (retryError) {
        if (i === 2) throw retryError; // Throw error if the last attempt fails
        log.warning(`Attempt ${i + 1} to fetch Gas price failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retrying
      }
    }
  } catch (error) {
    log.error('Failed to fetch Gas price:', error.message);
    // If all attempts fail, use conservative default values
    const defaultBaseFee = ethers.utils.parseUnits('50', 'gwei');
    const defaultGasPrice = ethers.utils.parseUnits('100', 'gwei');
    log.warning('Using conservative default Gas prices:');
    log.warning(`- Default Base Fee: 50 gwei`);
    log.warning(`- Default Gas Price: 100 gwei`);
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
      log.error('No valid wallet configurations found, please check the .env file');
      return;
    }

    const provider = createProvider(ENV.NETWORK);
    
    // Fetch real-time gas prices
    const { baseFee, currentGasPrice, suggestedMaxFee } = await getGasPrice(provider);
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'mintMode',
        message: 'Minting mode:',
        choices: ['Instant Mint', 'Monitoring Mode', 'Scheduled Mint']
      },
      {
        type: 'input',
        name: 'contractAddress',
        message: 'NFT contract address or Magic Eden link:'
      },
      {
        type: 'list',
        name: 'mintMethod',
        message: 'Select minting method:',
        choices: [
          { name: 'Auto (try fourParams first, fallback to twoParams)', value: 'auto' },
          { name: 'fourParams', value: 'fourParams' },
          { name: 'twoParams', value: 'twoParams' }
        ],
        default: 'auto'
      },
      {
        type: 'confirm',
        name: 'useContractPrice',
        message: 'Fetch price from contract?',
        default: true
      },
      {
        type: 'input',
        name: 'mintAmount',
        message: 'Number of mints per wallet:',
        default: '1',
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 1) {
            return 'Please enter a number greater than 0';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'gasLimit',
        message: 'Gas Limit (recommended 110000):',
        default: '110000',
        validate: (input) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 100000) {
            return 'Gas Limit cannot be less than 100000';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'maxGasPrice',
        message: `Maximum acceptable Gas Price (gwei) (current network suggestion ${ethers.utils.formatUnits(suggestedMaxFee, 'gwei')}, real-time Gas ${ethers.utils.formatUnits(currentGasPrice, 'gwei')}):`,
        default: ethers.utils.formatUnits(suggestedMaxFee, 'gwei'),
        validate: (input) => {
          const num = parseFloat(input);
          if (isNaN(num) || num < parseFloat(ethers.utils.formatUnits(baseFee, 'gwei'))) {
            return `Gas Price cannot be lower than current Base Fee (${ethers.utils.formatUnits(baseFee, 'gwei')} gwei)`;
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'priorityFeePercent',
        message: 'Priority fee percentage (enter a number, e.g., 30 for 30%, default 10%):',
        default: '10',
        validate: (input) => {
          if (input === '') return true;
          const num = parseFloat(input);
          if (isNaN(num) || num <= 0 || num > 100) {
            return 'Please enter a number between 1 and 100';
          }
          return true;
        }
      }
    ]);

    const contractAddress = extractContractAddress(answers.contractAddress);
    const mintAmount = parseInt(answers.mintAmount);
    const gasLimit = parseInt(answers.gasLimit);
    
    log.info(`Using contract address: ${contractAddress}`);
    
    try {
      // Fetch collection information
      log.info('Fetching collection information...');
      const { name, symbol } = await getCollectionInfo(contractAddress, provider);
      log.info(`Collection: ${name} (${symbol})`);

      // Create contract instance for each wallet and fetch configuration
      log.info('Creating contract instance...');
      const firstWallet = createWallet(wallets[0].privateKey, provider);
      const contract = new ethers.Contract(contractAddress, ABI, firstWallet);
      
      // Calculate priority fee
      const priorityFeePercent = parseFloat(answers.priorityFeePercent || '10');
      const priorityFeeGwei = ethers.utils.formatUnits(baseFee.mul(priorityFeePercent).div(100), 'gwei');
      const maxPriorityFeePerGas = ethers.utils.parseUnits(priorityFeeGwei, 'gwei');
      const maxFeePerGas = ethers.utils.parseUnits(answers.maxGasPrice, 'gwei');

      log.info(`Gas settings:`);
      log.info(`- Gas limit: ${gasLimit}`);
      log.info(`- Current Base Fee: ${ethers.utils.formatUnits(baseFee, 'gwei')} gwei`);
      log.info(`- Current Gas Price: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
      log.info(`- Max fee: ${answers.maxGasPrice} gwei`);
      log.info(`- Priority fee: ${priorityFeeGwei} gwei (${priorityFeePercent}% of Base Fee)`);
      log.info(`- Estimated total Gas cost: ${ethers.utils.formatEther(maxFeePerGas.mul(gasLimit))} MON`);

      if (answers.mintMode === 'Monitoring Mode') {
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

      // Fetch contract configuration and correct minting variant
      let mintVariant = 'fourParams';
      log.info('Defaulting to fourParams minting method');

      // Fetch minting price
      let mintPrice;
      if (answers.useContractPrice) {
        log.info('Fetching price from contract...');
        mintPrice = await getMintPrice(contract);
        
        if (!mintPrice) {
          // If unable to fetch price from contract, prompt for manual input
          const priceAnswer = await inquirer.prompt([
            {
              type: 'input',
              name: 'price',
              message: 'Unable to fetch price from contract, please enter minting price (MON):',
              validate: (input) => {
                const num = parseFloat(input);
                if (isNaN(num)) {
                  return 'Please enter a valid number';
                }
                return true;
              }
            }
          ]);
          mintPrice = ethers.utils.parseEther(priceAnswer.price);
          log.info(`Using manually entered price - [${ethers.utils.formatEther(mintPrice)} MON]`);
        }
      } else {
        // Directly input price manually
        const priceAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'price',
            message: 'Please enter minting price (MON):',
            validate: (input) => {
              const num = parseFloat(input);
              if (isNaN(num)) {
                return 'Please enter a valid number';
              }
              return true;
            }
          }
        ]);
        mintPrice = ethers.utils.parseEther(priceAnswer.price);
        log.info(`Using manually entered price - [${ethers.utils.formatEther(mintPrice)} MON]`);
      }

      // If scheduled minting, wait for start time
      if (answers.mintMode === 'Scheduled Mint') {
        try {
          const config = await contract.getConfig();
          const startTime = config.publicStage.startTime.toNumber();
          const currentTime = Math.floor(Date.now() / 1000);
          
          if (currentTime < startTime) {
            const timeLeft = startTime - currentTime;
            log.info(`Waiting for minting to start, time left: ${Math.floor(timeLeft / 3600)} hours ${Math.floor((timeLeft % 3600) / 60)} minutes`);
            
            // Wait until start time
            await new Promise(resolve => setTimeout(resolve, timeLeft * 1000));
          }
        } catch (error) {
          log.warning('Unable to fetch start time, starting minting immediately');
        }
      }

      // Execute minting
      for (let i = 0; i < wallets.length; i++) {
        const wallet = createWallet(wallets[i].privateKey, provider);
        
        // Check wallet balance
        const balance = await provider.getBalance(wallet.address);
        const requiredAmount = mintPrice.mul(mintAmount).add(maxFeePerGas.mul(gasLimit));
        
        if (balance.lt(requiredAmount)) {
          log.error(`Wallet ${i + 1} (${wallet.address}) has insufficient balance`);
          log.info(`Required: ${ethers.utils.formatEther(requiredAmount)} MON`);
          log.info(`Current balance: ${ethers.utils.formatEther(balance)} MON`);
          continue;
        }

        log.info(`Using wallet ${i + 1} (${wallet.address}) to start minting ${mintAmount} NFTs`);
        
        // Loop to mint the specified amount
        for (let j = 0; j < mintAmount; j++) {
          log.info(`Minting ${j + 1}/${mintAmount}...`);
          
          let result;
          if (answers.mintMethod === 'auto') {
            // Try fourParams first
            log.info('Attempting to mint using fourParams method...');
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
              log.warning('fourParams method failed, error:', result.error);
              log.info('Attempting to mint using twoParams method...');
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
                log.error(`twoParams method also failed, error:`, result.error);
              } else {
                log.success(`Success using twoParams method!`);
                if (result.txHash) {
                  log.info(`Transaction hash: ${result.txHash}`);
                  log.info(`Explorer link: ${getTransactionExplorerUrl(result.txHash, ENV.NETWORK)}`);
                }
                if (result.gasUsed) {
                  log.info(`Actual Gas used: ${result.gasUsed}`);
                }
              }
            } else {
              log.success(`Success using fourParams method!`);
              if (result.txHash) {
                log.info(`Transaction hash: ${result.txHash}`);
                log.info(`Explorer link: ${getTransactionExplorerUrl(result.txHash, ENV.NETWORK)}`);
              }
              if (result.gasUsed) {
                log.info(`Actual Gas used: ${result.gasUsed}`);
              }
            }
          } else {
            // Use the user-specified method
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
              log.error(`${answers.mintMethod} method failed, error:`, result.error);
            } else {
              log.success(`Success using ${answers.mintMethod} method!`);
              if (result.txHash) {
                log.info(`Transaction hash: ${result.txHash}`);
                log.info(`Explorer link: ${getTransactionExplorerUrl(result.txHash, ENV.NETWORK)}`);
              }
              if (result.gasUsed) {
                log.info(`Actual Gas used: ${result.gasUsed}`);
              }
            }
          }

          if (result.error) {
            log.error(`Wallet ${i + 1} failed to mint ${j + 1}`);
            log.error(`- Error type: ${result.error.code || 'Unknown'}`);
            log.error(`- Error message: ${result.error.message || result.error}`);
            if (result.error.transaction) {
              log.error(`- Transaction data: ${JSON.stringify(result.error.transaction, null, 2)}`);
            }
            // If auto mode and both methods fail, or if the specified method fails, skip this wallet
            break;
          } else {
            log.success(`Wallet ${i + 1} successfully minted ${j + 1}!`);
            log.info(`- Transaction status: ${result.status || 'Confirmed'}`);
            if (result.blockNumber) {
              log.info(`- Block number: ${result.blockNumber}`);
            }
            if (result.gasUsed) {
              log.info(`- Gas used: ${result.gasUsed}`);
            }
            if (result.effectiveGasPrice) {
              log.info(`- Actual Gas price: ${ethers.utils.formatUnits(result.effectiveGasPrice, 'gwei')} gwei`);
            }
          }
          
          // Wait a short time between each mint
          if (j < mintAmount - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        // Wait longer between different wallets
        if (i < wallets.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      log.success('Minting process completed!');

    } catch (error) {
      log.error('Error during initialization:');
      log.error('- Error message:', error.message);
      if (error.error) {
        log.error('- Detailed error:', error.error);
      }
      if (error.code) {
        log.error('- Error code:', error.code);
      }
      if (error.stack) {
        log.error('- Error stack:', error.stack);
      }
      
      // Try using a simplified ABI
      log.info('Attempting to use a simplified ABI...');
      const simpleABI = [
        "function mintPublic(address to, uint256 qty) payable",
        "function mintPublic(address to, uint256 param2, uint256 param3, bytes data) payable",
        "function name() view returns (string)",
        "function symbol() view returns (string)"
      ];
      
      try {
        const contract = new ethers.Contract(contractAddress, simpleABI, firstWallet);
        log.success('Successfully created contract instance using simplified ABI');
        // ... continue with the rest of the code ...
      } catch (retryError) {
        log.error('Failed to use simplified ABI:', retryError.message);
        throw error; // Throw the original error
      }
    }
  } catch (error) {
    log.error('An error occurred:', error.message);
    if (error.error) {
      log.error('Detailed error:', error.error);
    }
  }
};

main();
