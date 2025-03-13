import { ethers } from "ethers";
import chalk from "chalk";
import { ABI } from "../../config/ABI.js";
import { createContract } from "../core/blockchain.js";
import { log } from "../utils/helpers.js";

export const getConfigWithFallback = async (contract) => {
  let config;
  try {
    config = await contract.getConfig();
    return { config, variant: "twoParams" };
  } catch (err) {}

  let fallbackConfig;
  const fallbackIds = [0, 1, 2, 3];
  for (let id of fallbackIds) {
    try {
      fallbackConfig = await contract["getConfig(uint256)"](id);
      return { config: fallbackConfig, variant: "fourParams" };
    } catch (err) {}
  }

  if (fallbackConfig) {
    return { config: fallbackConfig, variant: "fourParams" };
  } else {
    throw new Error("Unable to retrieve configuration");
  }
};

const validateContractAddress = (address) => {
  if (!ethers.utils.isAddress(address)) {
    throw new Error('合约地址格式无效');
  }
};

export const getCollectionInfo = async (address, provider) => {
  validateContractAddress(address);
  try {
    const nameABI = ["function name() view returns (string)"];
    const symbolABI = ["function symbol() view returns (string)"];
    const nameContract = new ethers.Contract(address, nameABI, provider);
    const symbolContract = new ethers.Contract(address, symbolABI, provider);

    let name = "Unknown";
    let symbol = "Unknown";

    try {
      name = await nameContract.name();
    } catch (err) {}

    try {
      symbol = await symbolContract.symbol();
    } catch (err) {}

    return { name, symbol };
  } catch (error) {
    return { name: "Unknown", symbol: "Unknown" };
  }
};

export const executeMint = async (
  contractAddress,
  wallet,
  gasLimit,
  fee,
  mintVariant,
  mintPrice,
  explorerUrl
) => {
  const contractWithWallet = createContract(contractAddress, ABI, wallet);
  log.info("钱包正在铸造 1 个 NFT");

  try {
    let tx;
    try {
      if (mintVariant === "fourParams") {
        tx = await contractWithWallet[
          "mintPublic(address,uint256,uint256,bytes)"
        ](wallet.address, 0, 1, "0x", {
          gasLimit,
          maxFeePerGas: fee,
          maxPriorityFeePerGas: fee,
          value: mintPrice,
        });
      } else {
        tx = await contractWithWallet["mintPublic(address,uint256)"](
          wallet.address,
          1,
          {
            gasLimit,
            maxFeePerGas: fee,
            maxPriorityFeePerGas: fee,
            value: mintPrice,
          }
        );
      }
    } catch (err) {
      if (
        err.code === ethers.errors.CALL_EXCEPTION ||
        err.message.includes("CALL_EXCEPTION")
      ) {
        log.warning("CALL_EXCEPTION error, retrying with alternate variant");
        const alternateVariant =
          mintVariant === "twoParams" ? "fourParams" : "twoParams";

        if (alternateVariant === "fourParams") {
          tx = await contractWithWallet[
            "mintPublic(address,uint256,uint256,bytes)"
          ](wallet.address, 0, 1, "0x", {
            gasLimit,
            maxFeePerGas: fee,
            maxPriorityFeePerGas: fee,
            value: mintPrice,
          });
        } else {
          tx = await contractWithWallet["mintPublic(address,uint256)"](
            wallet.address,
            1,
            {
              gasLimit,
              maxFeePerGas: fee,
              maxPriorityFeePerGas: fee,
              value: mintPrice,
            }
          );
        }

        return { tx, successVariant: alternateVariant };
      } else {
        throw err;
      }
    }

    log.success(
      `铸造交易已发送! [${tx.hash.substring(0, 6)}...${tx.hash.substring(
        tx.hash.length - 4
      )}]`
    );
    log.dim(explorerUrl + tx.hash);

    const receipt = await tx.wait();
    log.success(`交易已在区块 [${receipt.blockNumber}] 中确认`);

    return { tx, successVariant: mintVariant };
  } catch (err) {
    if (err.code === ethers.errors.CALL_EXCEPTION) {
      log.error("调用异常错误");
    } else if (err.message.includes("INSUFFICIENT_FUNDS")) {
      log.error("余额不足");
    } else {
      log.error(`错误: ${err.message.substring(0, 50)}`);
    }
    return { error: err.message };
  }
};

export default {
  getConfigWithFallback,
  getCollectionInfo,
  executeMint,
};
